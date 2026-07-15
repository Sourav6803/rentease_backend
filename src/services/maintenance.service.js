const { Maintenance, Rental, User, Vendor, Product, Inventory, Notification } = require('../models');
const { AppError } = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const moment = require('moment');

class MaintenanceService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes
    
    // SLA targets in hours
    this.slaTargets = {
      emergency: 1,
      urgent: 4,
      high: 24,
      medium: 48,
      low: 72
    };
  }

  /**
   * Generate unique request number
   */
  generateRequestNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `MNT${timestamp}${random}`;
  }

  /**
   * Calculate SLA deadline
   */
  calculateSLADeadline(priority) {
    const hours = this.slaTargets[priority] || 48;
    return moment().add(hours, 'hours').toDate();
  }

  /**
   * Check if SLA is breached
   */
  checkSLABreach(maintenance) {
    if (maintenance.status === 'completed' || maintenance.status === 'cancelled') {
      return false;
    }

    const now = moment();
    const deadline = moment(maintenance.sla?.responseDue || maintenance.createdAt);
    
    return now.isAfter(deadline);
  }

  /**
   * Create maintenance request
   */
  async createRequest(userId, requestData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { rentalId, issueType, description, priority, attachments, scheduledDate } = requestData;

      // Get rental details
      const rental = await Rental.findById(rentalId)
        .populate('product')
        .populate('vendor')
        .session(session);

      if (!rental) {
        throw new AppError('Rental not found', 404);
      }

      // Verify user owns this rental
      if (rental.user.toString() !== userId.toString()) {
        throw new AppError('Unauthorized to create maintenance request for this rental', 403);
      }

      // Check if rental is active
      if (!['active', 'delivered'].includes(rental.status)) {
        throw new AppError('Maintenance requests can only be created for active rentals', 400);
      }

      // Check for existing pending requests
      const existingRequest = await Maintenance.findOne({
        rental: rentalId,
        status: { $in: ['pending', 'assigned', 'scheduled', 'in_progress'] }
      }).session(session);

      if (existingRequest) {
        throw new AppError('A maintenance request is already pending for this rental', 400);
      }

      // Calculate SLA deadline
      const slaDeadline = this.calculateSLADeadline(priority || 'medium');

      // Create maintenance request
      const requestNumber = this.generateRequestNumber();
      
      const maintenance = await Maintenance.create([{
        requestNumber,
        rental: rentalId,
        user: userId,
        vendor: rental.vendor._id,
        product: rental.product._id,
        inventory: rental.inventory,
        issueType,
        priority: priority || 'medium',
        status: 'pending',
        description: {
          issue: description,
          steps: [],
          whenStarted: new Date()
        },
        attachments: attachments || [],
        schedule: scheduledDate ? {
          requestedDate: new Date(scheduledDate)
        } : undefined,
        sla: {
          responseDue: slaDeadline,
          resolutionDue: moment(slaDeadline).add(this.slaTargets[priority || 'medium'], 'hours').toDate()
        },
        timeline: [{
          status: 'pending',
          timestamp: new Date(),
          note: 'Maintenance request created',
          updatedBy: userId
        }],
        metadata: {
          createdBy: userId,
          source: 'web'
        }
      }], { session });

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.MAINTENANCE.REQUESTED, {
        maintenanceId: maintenance[0]._id,
        requestNumber: maintenance[0].requestNumber,
        userId,
        vendorId: rental.vendor._id,
        rentalId,
        issueType,
        priority: priority || 'medium'
      });

      // Notify vendor
      await addJob('notification', 'create', {
        userId: rental.vendor._id,
        type: 'in_app',
        title: 'New Maintenance Request',
        content: `Maintenance request #${maintenance[0].requestNumber} received for ${rental.product.basicInfo.name}`,
        data: {
          maintenanceId: maintenance[0]._id,
          rentalId,
          issueType
        }
      });

      // Schedule SLA breach check
      await addJob('maintenance', 'check-sla', {
        maintenanceId: maintenance[0]._id,
        scheduledAt: slaDeadline
      });

      return maintenance[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createRequest:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get maintenance request by ID
   */
  async getRequest(requestId, userId, userRole = 'user') {
    try {
      const cacheKey = `maintenance:${requestId}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const request = await Maintenance.findById(requestId)
        .populate('user', 'profile.firstName profile.lastName email phone')
        .populate('vendor', 'business.name business.phone supportEmail')
        .populate({
          path: 'rental',
          select: 'rentalNumber rentalDetails.startDate rentalDetails.endDate',
          populate: {
            path: 'product',
            select: 'basicInfo.name basicInfo.sku'
          }
        })
        .populate('assignedTo', 'profile.firstName profile.lastName')
        .populate('assignedTeam', 'profile.firstName profile.lastName')
        .populate('timeline.updatedBy', 'profile.firstName profile.lastName')
        .lean();

      if (!request) {
        throw new AppError('Maintenance request not found', 404);
      }

      // Check authorization
      if (userRole === 'user' && request.user._id.toString() !== userId.toString()) {
        throw new AppError('Unauthorized to view this request', 403);
      }

      if (userRole === 'vendor' && request.vendor._id.toString() !== userId.toString()) {
        throw new AppError('Unauthorized to view this request', 403);
      }

      // Check SLA breach
      request.slaBreached = this.checkSLABreach(request);

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(request));
      }

      return request;
    } catch (error) {
      logger.error('Error in getRequest:', error);
      throw error;
    }
  }

  /**
   * Get user maintenance requests
   */
  async getUserRequests(userId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { user: userId };
      
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.priority) {
        query.priority = filters.priority;
      }

      if (filters.issueType) {
        query.issueType = filters.issueType;
      }

      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
      }

      const [requests, total] = await Promise.all([
        Maintenance.find(query)
          .populate('rental', 'rentalNumber')
          .populate('product', 'basicInfo.name')
          .populate('assignedTo', 'profile.firstName profile.lastName')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Maintenance.countDocuments(query)
      ]);

      // Get statistics
      const stats = await Maintenance.aggregate([
        { $match: { user: userId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const statusCounts = stats.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {});

      return {
        requests,
        stats: {
          total,
          ...statusCounts
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getUserRequests:', error);
      throw error;
    }
  }

  /**
   * Get vendor maintenance requests
   */
  async getVendorRequests(vendorId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { vendor: vendorId };
      
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.priority) {
        query.priority = filters.priority;
      }

      if (filters.assignedTo) {
        query.assignedTo = filters.assignedTo;
      }

      const [requests, total] = await Promise.all([
        Maintenance.find(query)
          .populate('user', 'profile.firstName profile.lastName email phone')
          .populate('rental', 'rentalNumber')
          .populate('product', 'basicInfo.name')
          .populate('assignedTo', 'profile.firstName profile.lastName')
          .sort({ 
            priority: -1,
            'sla.responseDue': 1,
            createdAt: -1 
          })
          .skip(skip)
          .limit(limit)
          .lean(),
        Maintenance.countDocuments(query)
      ]);

      // Get SLA breach count
      const slaBreached = requests.filter(r => this.checkSLABreach(r)).length;

      // Get priority distribution
      const priorityStats = await Maintenance.aggregate([
        { $match: { vendor: vendorId } },
        {
          $group: {
            _id: '$priority',
            count: { $sum: 1 }
          }
        }
      ]);

      return {
        requests,
        stats: {
          total,
          slaBreached,
          byPriority: priorityStats.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {})
        },
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getVendorRequests:', error);
      throw error;
    }
  }

  /**
   * Assign technician
   */
  async assignTechnician(requestId, vendorId, technicianId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const request = await Maintenance.findOne({
        _id: requestId,
        vendor: vendorId,
        status: 'pending'
      }).session(session);

      if (!request) {
        throw new AppError('Maintenance request not found or cannot be assigned', 404);
      }

      request.assignedTo = technicianId;
      request.status = 'assigned';
      request.timeline.push({
        status: 'assigned',
        timestamp: new Date(),
        note: `Assigned to technician`,
        updatedBy: vendorId
      });

      await request.save({ session });

      await session.commitTransaction();

      // Notify technician
      await addJob('notification', 'create', {
        userId: technicianId,
        type: 'in_app',
        title: 'New Maintenance Assignment',
        content: `You have been assigned to maintenance request #${request.requestNumber}`,
        data: {
          maintenanceId: request._id,
          requestNumber: request.requestNumber
        }
      });

      // Notify user
      await addJob('notification', 'create', {
        userId: request.user,
        type: 'in_app',
        title: 'Maintenance Request Assigned',
        content: `A technician has been assigned to your maintenance request #${request.requestNumber}`,
        data: {
          maintenanceId: request._id
        }
      });

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in assignTechnician:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Schedule maintenance visit
   */
  async scheduleVisit(requestId, vendorId, scheduleData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { scheduledDate, scheduledSlot, notes } = scheduleData;

      const request = await Maintenance.findOne({
        _id: requestId,
        vendor: vendorId,
        status: { $in: ['assigned', 'pending'] }
      }).session(session);

      if (!request) {
        throw new AppError('Maintenance request not found', 404);
      }

      request.status = 'scheduled';
      request.schedule = {
        ...request.schedule,
        scheduledDate: new Date(scheduledDate),
        scheduledSlot,
        rescheduledCount: (request.schedule?.rescheduledCount || 0)
      };
      
      request.timeline.push({
        status: 'scheduled',
        timestamp: new Date(),
        note: `Visit scheduled for ${moment(scheduledDate).format('DD/MM/YYYY HH:mm')}${scheduledSlot ? ` (${scheduledSlot})` : ''}`,
        updatedBy: vendorId
      });

      if (notes) {
        request.metadata.internalNotes = notes;
      }

      await request.save({ session });

      await session.commitTransaction();

      // Notify user
      await addJob('notification', 'create', {
        userId: request.user,
        type: 'in_app',
        title: 'Maintenance Visit Scheduled',
        content: `Your maintenance visit has been scheduled for ${moment(scheduledDate).format('DD/MM/YYYY HH:mm')}`,
        data: {
          maintenanceId: request._id,
          scheduledDate
        }
      });

      // Schedule reminder
      await addJob('maintenance', 'visit-reminder', {
        maintenanceId: request._id,
        userId: request.user,
        technicianId: request.assignedTo,
        scheduledAt: moment(scheduledDate).subtract(2, 'hours').toDate()
      });

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in scheduleVisit:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Start maintenance work
   */
  async startWork(requestId, technicianId, startData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { findings, images } = startData;

      const request = await Maintenance.findOne({
        _id: requestId,
        assignedTo: technicianId,
        status: 'scheduled'
      }).session(session);

      if (!request) {
        throw new AppError('Maintenance request not found or not scheduled', 404);
      }

      request.status = 'in_progress';
      request.schedule.actualStartDate = new Date();
      request.diagnosis = {
        findings,
        diagnosedBy: technicianId,
        diagnosedAt: new Date()
      };

      if (images) {
        request.attachments.push(...images.map(img => ({
          type: 'image',
          url: img,
          uploadedBy: technicianId,
          uploadedAt: new Date()
        })));
      }

      request.timeline.push({
        status: 'in_progress',
        timestamp: new Date(),
        note: 'Maintenance work started',
        updatedBy: technicianId
      });

      await request.save({ session });

      await session.commitTransaction();

      // Notify user
      await addJob('notification', 'create', {
        userId: request.user,
        type: 'in_app',
        title: 'Maintenance Work Started',
        content: `The technician has started working on your maintenance request #${request.requestNumber}`,
        data: {
          maintenanceId: request._id
        }
      });

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in startWork:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Complete maintenance
   */
  async completeWork(requestId, technicianId, completionData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { resolution, partsUsed, cost, images, notes } = completionData;

      const request = await Maintenance.findOne({
        _id: requestId,
        assignedTo: technicianId,
        status: 'in_progress'
      }).session(session);

      if (!request) {
        throw new AppError('Maintenance request not found or not in progress', 404);
      }

      // Calculate total cost
      const partsCost = partsUsed?.reduce((sum, part) => sum + (part.cost * part.quantity), 0) || 0;
      const labourCost = cost?.labour || 0;
      const travelCost = cost?.travel || 0;
      const totalCost = partsCost + labourCost + travelCost;

      // Determine if chargeable
      const isChargeable = this.isMaintenanceChargeable(request, totalCost);

      request.status = 'completed';
      request.schedule.actualEndDate = new Date();
      request.resolution = {
        action: resolution,
        partsUsed: partsUsed || [],
        cost: {
          parts: partsCost,
          labour: labourCost,
          travel: travelCost,
          other: cost?.other || 0,
          total: totalCost
        },
        resolvedBy: technicianId,
        resolvedAt: new Date(),
        notes
      };

      request.charges = {
        isChargeable,
        estimate: totalCost,
        actual: totalCost,
        status: isChargeable ? 'pending' : 'waived'
      };

      if (images) {
        request.attachments.push(...images.map(img => ({
          type: 'image',
          url: img,
          uploadedBy: technicianId,
          uploadedAt: new Date()
        })));
      }

      request.timeline.push({
        status: 'completed',
        timestamp: new Date(),
        note: `Maintenance completed. Total cost: ₹${totalCost}`,
        updatedBy: technicianId
      });

      await request.save({ session });

      // Update inventory if parts were replaced
      if (partsUsed?.length > 0) {
        // This would update inventory if you track parts
      }

      await session.commitTransaction();

      // Notify user
      await addJob('notification', 'create', {
        userId: request.user,
        type: 'in_app',
        title: 'Maintenance Completed',
        content: `Your maintenance request #${request.requestNumber} has been completed.${isChargeable ? ` Total charges: ₹${totalCost}` : ''}`,
        data: {
          maintenanceId: request._id,
          cost: totalCost,
          isChargeable
        }
      });

      // Request feedback
      await addJob('maintenance', 'request-feedback', {
        maintenanceId: request._id,
        userId: request.user,
        scheduledAt: moment().add(1, 'day').toDate()
      });

      // Create payment if chargeable
      if (isChargeable && totalCost > 0) {
        await addJob('payment', 'create', {
          userId: request.user,
          rentalId: request.rental,
          amount: totalCost,
          type: 'maintenance',
          metadata: {
            maintenanceId: request._id,
            requestNumber: request.requestNumber
          }
        });
      }

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in completeWork:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Determine if maintenance is chargeable
   */
  isMaintenanceChargeable(request, cost) {
    // Check warranty
    // Check if issue is due to user negligence
    // Check if within free maintenance period
    
    // For now, assume chargeable if cost > 0
    return cost > 0;
  }

  /**
   * Cancel maintenance request
   */
  async cancelRequest(requestId, userId, userRole, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const query = { _id: requestId };
      
      if (userRole === 'user') {
        query.user = userId;
      } else if (userRole === 'vendor') {
        query.vendor = userId;
      }

      const request = await Maintenance.findOne(query).session(session);

      if (!request) {
        throw new AppError('Maintenance request not found', 404);
      }

      // Check if request can be cancelled
      const cancellableStatuses = ['pending', 'assigned', 'scheduled'];
      if (!cancellableStatuses.includes(request.status)) {
        throw new AppError('Maintenance request cannot be cancelled at this stage', 400);
      }

      request.status = 'cancelled';
      request.timeline.push({
        status: 'cancelled',
        timestamp: new Date(),
        note: `Request cancelled by ${userRole}. Reason: ${reason}`,
        updatedBy: userId
      });

      await request.save({ session });

      await session.commitTransaction();

      // Notify relevant parties
      if (userRole === 'user') {
        await addJob('notification', 'create', {
          userId: request.vendor,
          type: 'in_app',
          title: 'Maintenance Request Cancelled',
          content: `Maintenance request #${request.requestNumber} has been cancelled by the user.`,
          data: {
            maintenanceId: request._id
          }
        });
      } else {
        await addJob('notification', 'create', {
          userId: request.user,
          type: 'in_app',
          title: 'Maintenance Request Cancelled',
          content: `Your maintenance request #${request.requestNumber} has been cancelled.`,
          data: {
            maintenanceId: request._id
          }
        });
      }

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in cancelRequest:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Add parts required
   */
  async addPartsRequired(requestId, vendorId, parts) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const request = await Maintenance.findOne({
        _id: requestId,
        vendor: vendorId,
        status: { $in: ['assigned', 'in_progress'] }
      }).session(session);

      if (!request) {
        throw new AppError('Maintenance request not found', 404);
      }

      if (!request.diagnosis) {
        request.diagnosis = {};
      }

      request.diagnosis.partsRequired = parts;
      request.timeline.push({
        status: request.status,
        timestamp: new Date(),
        note: `Parts required added: ${parts.length} item(s)`,
        updatedBy: vendorId
      });

      await request.save({ session });

      await session.commitTransaction();

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in addPartsRequired:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Add feedback
   */
  async addFeedback(requestId, userId, feedbackData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { rating, comment, serviceQuality, timeliness, professionalism } = feedbackData;

      const request = await Maintenance.findOne({
        _id: requestId,
        user: userId,
        status: 'completed'
      }).session(session);

      if (!request) {
        throw new AppError('Completed maintenance request not found', 404);
      }

      if (request.feedback) {
        throw new AppError('Feedback already provided for this request', 400);
      }

      request.feedback = {
        rating,
        comment,
        serviceQuality,
        timeliness,
        professionalism,
        submittedAt: new Date()
      };

      await request.save({ session });

      await session.commitTransaction();

      // Update vendor rating
      await this.updateVendorRating(request.vendor);

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in addFeedback:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update vendor rating based on maintenance feedback
   */
  async updateVendorRating(vendorId) {
    try {
      const stats = await Maintenance.aggregate([
        { $match: { vendor: vendorId, 'feedback.rating': { $exists: true } } },
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$feedback.rating' },
            totalFeedbacks: { $sum: 1 },
            serviceQuality: { $avg: '$feedback.serviceQuality' },
            timeliness: { $avg: '$feedback.timeliness' },
            professionalism: { $avg: '$feedback.professionalism' }
          }
        }
      ]);

      if (stats.length > 0) {
        await Vendor.findByIdAndUpdate(vendorId, {
          $set: {
            'performance.maintenanceRating': stats[0].averageRating,
            'performance.maintenanceFeedbacks': stats[0].totalFeedbacks,
            'performance.maintenanceMetrics': {
              serviceQuality: stats[0].serviceQuality,
              timeliness: stats[0].timeliness,
              professionalism: stats[0].professionalism
            }
          }
        });
      }
    } catch (error) {
      logger.error('Error in updateVendorRating:', error);
    }
  }

  /**
   * Get maintenance statistics
   */
  async getMaintenanceStats(userId, role = 'user') {
    try {
      const match = role === 'user' ? { user: userId } : { vendor: userId };

      const stats = await Maintenance.aggregate([
        { $match: match },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalRequests: { $sum: 1 },
                  openRequests: {
                    $sum: {
                      $cond: [
                        { $in: ['$status', ['pending', 'assigned', 'scheduled', 'in_progress']] },
                        1,
                        0
                      ]
                    }
                  },
                  completedRequests: {
                    $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                  },
                  cancelledRequests: {
                    $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                  },
                  averageResolutionTime: {
                    $avg: {
                      $cond: [
                        { $and: [
                          { $ne: ['$schedule.actualEndDate', null] },
                          { $ne: ['$createdAt', null] }
                        ]},
                        { $subtract: ['$schedule.actualEndDate', '$createdAt'] },
                        null
                      ]
                    }
                  }
                }
              }
            ],
            byPriority: [
              {
                $group: {
                  _id: '$priority',
                  count: { $sum: 1 }
                }
              }
            ],
            byIssueType: [
              {
                $group: {
                  _id: '$issueType',
                  count: { $sum: 1 }
                }
              }
            ],
            byStatus: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 }
                }
              }
            ],
            monthly: [
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' }
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1 } }
            ],
            slaCompliance: [
              {
                $match: {
                  status: 'completed',
                  'sla.responseDue': { $exists: true }
                }
              },
              {
                $project: {
                  withinSLA: {
                    $lte: ['$schedule.actualStartDate', '$sla.responseDue']
                  }
                }
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  withinSLA: { $sum: { $cond: ['$withinSLA', 1, 0] } }
                }
              }
            ]
          }
        }
      ]);

      const result = stats[0] || {};
      
      // Calculate SLA compliance percentage
      if (result.slaCompliance?.[0]) {
        const sla = result.slaCompliance[0];
        result.slaCompliance = {
          total: sla.total,
          withinSLA: sla.withinSLA,
          percentage: sla.total > 0 ? (sla.withinSLA / sla.total) * 100 : 0
        };
      }

      return result;
    } catch (error) {
      logger.error('Error in getMaintenanceStats:', error);
      throw error;
    }
  }

  /**
   * Check SLA breaches (cron job)
   */
  async checkSLABreaches() {
    try {
      const activeRequests = await Maintenance.find({
        status: { $in: ['pending', 'assigned', 'scheduled', 'in_progress'] },
        'sla.responseDue': { $lt: new Date() }
      });

      for (const request of activeRequests) {
        const breached = this.checkSLABreach(request);
        
        if (breached) {
          request.slaBreached = true;
          await request.save();

          // Escalate based on priority
          if (request.priority === 'emergency' || request.priority === 'urgent') {
            await this.escalateRequest(request._id);
          }

          // Notify vendor
          await addJob('notification', 'create', {
            userId: request.vendor,
            type: 'in_app',
            title: '⚠️ SLA Breached',
            content: `Maintenance request #${request.requestNumber} has breached SLA response time.`,
            data: {
              maintenanceId: request._id,
              priority: request.priority
            },
            priority: 'high'
          });
        }
      }

      return activeRequests.length;
    } catch (error) {
      logger.error('Error in checkSLABreaches:', error);
      throw error;
    }
  }

  /**
   * Escalate request
   */
  async escalateRequest(requestId) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const request = await Maintenance.findById(requestId).session(session);

      if (!request) {
        throw new AppError('Request not found', 404);
      }

      request.status = 'escalated';
      request.timeline.push({
        status: 'escalated',
        timestamp: new Date(),
        note: 'Request escalated due to SLA breach'
      });

      await request.save({ session });

      await session.commitTransaction();

      // Notify admins
      await addJob('notification', 'create', {
        role: 'admin',
        type: 'in_app',
        title: '🚨 Maintenance Request Escalated',
        content: `Request #${request.requestNumber} has been escalated due to SLA breach.`,
        data: {
          maintenanceId: request._id,
          priority: request.priority
        },
        priority: 'urgent'
      });

      return request;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in escalateRequest:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get technician workload
   */
  async getTechnicianWorkload(technicianId) {
    try {
      const activeCount = await Maintenance.countDocuments({
        assignedTo: technicianId,
        status: { $in: ['assigned', 'scheduled', 'in_progress'] }
      });

      const completedToday = await Maintenance.countDocuments({
        assignedTo: technicianId,
        status: 'completed',
        'schedule.actualEndDate': {
          $gte: moment().startOf('day').toDate(),
          $lte: moment().endOf('day').toDate()
        }
      });

      const upcoming = await Maintenance.find({
        assignedTo: technicianId,
        status: 'scheduled',
        'schedule.scheduledDate': { $gte: new Date() }
      })
      .sort({ 'schedule.scheduledDate': 1 })
      .limit(5)
      .lean();

      return {
        activeCount,
        completedToday,
        upcoming
      };
    } catch (error) {
      logger.error('Error in getTechnicianWorkload:', error);
      throw error;
    }
  }

  /**
   * Generate maintenance report
   */
  async generateReport(vendorId, startDate, endDate) {
    try {
      const report = await Maintenance.aggregate([
        {
          $match: {
            vendor: vendorId,
            createdAt: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalRequests: { $sum: 1 },
                  completedRequests: {
                    $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                  },
                  totalCost: { $sum: '$resolution.cost.total' },
                  averageResolutionTime: {
                    $avg: {
                      $cond: [
                        { $and: [
                          { $ne: ['$schedule.actualEndDate', null] },
                          { $ne: ['$createdAt', null] }
                        ]},
                        { $subtract: ['$schedule.actualEndDate', '$createdAt'] },
                        null
                      ]
                    }
                  }
                }
              }
            ],
            byIssueType: [
              {
                $group: {
                  _id: '$issueType',
                  count: { $sum: 1 },
                  cost: { $sum: '$resolution.cost.total' }
                }
              }
            ],
            byPriority: [
              {
                $group: {
                  _id: '$priority',
                  count: { $sum: 1 },
                  avgResolutionTime: {
                    $avg: {
                      $subtract: ['$schedule.actualEndDate', '$createdAt']
                    }
                  }
                }
              }
            ],
            monthly: [
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  cost: { $sum: '$resolution.cost.total' }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1 } }
            ],
            technicianPerformance: [
              {
                $group: {
                  _id: '$assignedTo',
                  completed: {
                    $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                  },
                  avgResolutionTime: {
                    $avg: {
                      $subtract: ['$schedule.actualEndDate', '$createdAt']
                    }
                  },
                  totalCost: { $sum: '$resolution.cost.total' }
                }
              },
              {
                $lookup: {
                  from: 'users',
                  localField: '_id',
                  foreignField: '_id',
                  as: 'technician'
                }
              },
              { $unwind: '$technician' }
            ]
          }
        }
      ]);

      return report[0];
    } catch (error) {
      logger.error('Error in generateReport:', error);
      throw error;
    }
  }

  /**
   * Invalidate cache
   */
  async invalidateMaintenanceCache(maintenanceId) {
    try {
      if (this.redisClient) {
        const patterns = [
          `maintenance:${maintenanceId}`,
          `maintenance:${maintenanceId}:*`,
          'maintenance:user:*',
          'maintenance:vendor:*',
          'maintenance:stats:*'
        ];
        
        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error('Error invalidating maintenance cache:', error);
    }
  }
}

module.exports = new MaintenanceService();