// services/supportTicket.service.js
const SupportTicket = require('../models/SupportTicket.model');
const User = require('../models/User.model');
const Admin = require('../models/Admin.model');
const Vendor = require('../models/Vendor.model');
const Rental = require('../models/Rental.model');
const Payment = require('../models/Payment.model');
const Product = require('../models/Product.model');
const { AppError } = require('../utils/AppError');
// const { sendEmail } = require('../utils/email');
// const { addNotification } = require('../utils/notifications');
const { eventEmitter, EVENTS } = require('../events');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const { SUPPORT_PRIORITIES, SUPPORT_STATUSES, SLA_HOURS } = require('../config/constants');
const emailService = require('./email.service');

class SupportTicketService {
  /**
   * Normalize a caller role (e.g. 'vendor', 'user', 'admin', 'super-admin')
   * to a schema-valid persona type. The SupportTicket schema only allows
   * ['user', 'admin', 'system'] for message/timeline actors, so anyone who
   * is not an admin/system actor is treated as a 'user' (customer side).
   */
  normalizePersonaType(userType) {
    if (userType === 'admin' || userType === 'super-admin' || userType === 'super_admin') {
      return 'admin';
    }
    if (userType === 'system') {
      return 'system';
    }
    return 'user';
  }

  /**
   * Generate ticket number
   */
  async generateTicketNumber() {
    const count = await SupportTicket.countDocuments();
    const timestamp = Date.now().toString().slice(-8);
    return `TKT${timestamp}${(count + 1).toString().padStart(4, '0')}`;
  }

  /**
   * Create a new support ticket
   */
  async createTicket(userId, userType, ticketData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        type,
        priority = SUPPORT_PRIORITIES.MEDIUM,
        subject,
        description,
        relatedTo,
        attachments,
        metadata
      } = ticketData;

      // Get user details
      let user = await User.findById(userId).session(session);
      let userRole = userType;

      // Create ticket
      const ticketNumber = await this.generateTicketNumber();
      
      // Set SLA based on priority
      const slaConfig = SLA_HOURS[priority];
      const responseDue = new Date(Date.now() + slaConfig.response * 60 * 60 * 1000);
      const resolutionDue = new Date(Date.now() + slaConfig.resolution * 60 * 60 * 1000);

      const ticket = await SupportTicket.create([{
        ticketNumber,
        type,
        priority,
        status: SUPPORT_STATUSES.OPEN,
        createdBy: userId,
        subject,
        description,
        attachments: attachments || [],
        relatedTo,
        sla: { responseDue, resolutionDue },
        metadata: {
          source: metadata?.source || 'web',
          browserInfo: metadata?.browserInfo,
          ipAddress: metadata?.ipAddress,
          tags: metadata?.tags || []
        },
        timeline: [{
          action: 'created',
          performedBy: { type: this.normalizePersonaType(userType), id: userId },
          note: `Ticket created with priority: ${priority}`,
          timestamp: new Date()
        }]
      }], { session });

      // Send confirmation email
      await emailService.sendEmail({
        to: user.email,
        subject: `Support Ticket Created - ${ticketNumber}`,
        template: 'ticket-created',
        data: {
          ticketNumber,
          subject,
          description,
          priority,
          name: user.profile?.firstName || 'User'
        }
      });

      // Add notification for user
    //   await addNotification({
    //     userId,
    //     type: 'support',
    //     title: 'Support Ticket Created',
    //     message: `Your ticket ${ticketNumber} has been created. Our team will respond shortly.`,
    //     data: { ticketId: ticket[0]._id, ticketNumber }
    //   });

      // Emit event for admin dashboard
      eventEmitter.emit(EVENTS.SUPPORT.TICKET_CREATED, {
        ticketId: ticket[0]._id,
        ticketNumber,
        priority,
        userId,
        userName: user.profile?.firstName
      });

      await session.commitTransaction();

      return ticket[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createTicket:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get ticket by ID
   */
  async getTicketById(ticketId, userId, userType) {
    try {
      const ticket = await SupportTicket.findById(ticketId)
        .populate('createdBy', 'email profile.firstName profile.lastName phone')
        .populate('assignedTo', 'email profile.firstName profile.lastName')
        .populate('resolution.resolvedBy', 'email profile.firstName profile.lastName')
        .lean();

      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      // Check authorization — anyone who is not an admin must own the ticket
      const isAdmin = userType === 'admin' || userType === 'super-admin' || userType === 'super_admin';
      if (!isAdmin && ticket.createdBy._id.toString() !== userId.toString()) {
        throw new AppError('You are not authorized to view this ticket', 403);
      }

      // Mark admin messages as read (for the ticket owner / non-admin viewer)
      if (!isAdmin) {
        const unreadMessages = ticket.messages.filter(
          msg => msg.sender?.type === 'admin' && !msg.readBy?.some(r => r.toString() === userId.toString())
        );
        
        if (unreadMessages.length > 0) {
          await SupportTicket.updateOne(
            { _id: ticketId, 'messages._id': { $in: unreadMessages.map(m => m._id) } },
            { $push: { 'messages.$.readBy': { admin: userId, readAt: new Date() } } }
          );
        }
      }

      // Get related entity details if exists
      if (ticket.relatedTo?.id && ticket.relatedTo?.type) {
        let relatedModel;
        switch (ticket.relatedTo.type) {
          case 'rental':
            relatedModel = Rental;
            break;
          case 'payment':
            relatedModel = Payment;
            break;
          case 'product':
            relatedModel = Product;
            break;
          case 'vendor':
            relatedModel = Vendor;
            break;
          default:
            relatedModel = null;
        }

        if (relatedModel) {
          const relatedEntity = await relatedModel.findById(ticket.relatedTo.id)
            .select('_id status amount rentalNumber productName')
            .lean();
          ticket.relatedEntity = relatedEntity;
        }
      }

      return ticket;
    } catch (error) {
      logger.error('Error in getTicketById:', error);
      throw error;
    }
  }

  /**
   * Get user tickets (vendor view)
   */
  async getUserTickets(userId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = { createdBy: userId };
      
      if (filters.status) query.status = filters.status;
      if (filters.priority) query.priority = filters.priority;
      if (filters.type) query.type = filters.type;
      if (filters.search) {
        query.$or = [
          { ticketNumber: { $regex: filters.search, $options: 'i' } },
          { subject: { $regex: filters.search, $options: 'i' } }
        ];
      }

      const [tickets, total] = await Promise.all([
        SupportTicket.find(query)
          .select('ticketNumber type priority status subject createdAt updatedAt messages resolution')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        SupportTicket.countDocuments(query)
      ]);

      // Add unread count for each ticket
      const ticketsWithUnread = tickets.map(ticket => {
        const unreadCount = ticket.messages?.filter(
          msg => msg.sender.type === 'admin' && !msg.readBy?.some(r => r.toString() === userId.toString())
        ).length || 0;
        
        return {
          ...ticket,
          unreadCount,
          lastMessage: ticket.messages?.[ticket.messages.length - 1]
        };
      });

      return {
        tickets: ticketsWithUnread,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getUserTickets:', error);
      throw error;
    }
  }

  /**
   * Add message to ticket
   */
  async addMessage(ticketId, userId, userType, messageData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const ticket = await SupportTicket.findById(ticketId).session(session);
      
      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      // Check authorization
      if (userType === 'user' && ticket.createdBy.toString() !== userId.toString()) {
        throw new AppError('You are not authorized to reply to this ticket', 403);
      }

      // Don't allow replies to closed/resolved tickets
      if (ticket.status === SUPPORT_STATUSES.CLOSED || ticket.status === SUPPORT_STATUSES.RESOLVED) {
        throw new AppError('Cannot reply to a closed or resolved ticket', 400);
      }

      const { message, isInternal = false, attachments = [] } = messageData;

      const personaType = this.normalizePersonaType(userType);
      const isAdmin = personaType === 'admin';

      const newMessage = {
        sender: {
          type: personaType,
          id: userId,
          name: isAdmin ? 'Support Team' : 'Customer'
        },
        message,
        attachments,
        isInternal,
        createdAt: new Date(),
        readBy: []
      };

      ticket.messages.push(newMessage);

      // Update ticket status if needed
      if (!isAdmin && ticket.status === SUPPORT_STATUSES.PENDING) {
        // Customer replied to a pending ticket -> reopen it for the team
        ticket.status = SUPPORT_STATUSES.OPEN;
      } else if (isAdmin && ticket.status === SUPPORT_STATUSES.OPEN) {
        ticket.status = SUPPORT_STATUSES.ASSIGNED;
      }

      // Add to timeline
      ticket.timeline.push({
        action: 'message_added',
        performedBy: { type: personaType, id: userId },
        note: `New message added by ${personaType}`,
        timestamp: new Date()
      });

      await ticket.save({ session });

      // Send notifications
    //   if (userType === 'user') {
    //     // Notify admins
    //     await addNotification({
    //       role: 'admin',
    //       type: 'support',
    //       title: 'New Reply on Ticket',
    //       message: `User replied to ticket ${ticket.ticketNumber}`,
    //       data: { ticketId, ticketNumber: ticket.ticketNumber }
    //     });
    //   } else {
    //     // Notify user
    //     await addNotification({
    //       userId: ticket.createdBy,
    //       type: 'support',
    //       title: 'New Update on Your Ticket',
    //       message: `Support team replied to ticket ${ticket.ticketNumber}`,
    //       data: { ticketId, ticketNumber: ticket.ticketNumber }
    //     });

    //     // Send email notification
    //     const user = await User.findById(ticket.createdBy);
    //     if (user) {
    //       await sendEmail({
    //         to: user.email,
    //         subject: `Update on Support Ticket ${ticket.ticketNumber}`,
    //         template: 'ticket-update',
    //         data: {
    //           ticketNumber: ticket.ticketNumber,
    //           message: message.substring(0, 200),
    //           name: user.profile?.firstName || 'User'
    //         }
    //       });
    //     }
    //   }

      await session.commitTransaction();

      return newMessage;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in addMessage:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update ticket status
   */
  async updateStatus(ticketId, adminId, statusData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { status, note } = statusData;
      
      const ticket = await SupportTicket.findById(ticketId).session(session);
      
      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      const oldStatus = ticket.status;
      ticket.status = status;

      // Handle resolution
      if (status === SUPPORT_STATUSES.RESOLVED && oldStatus !== SUPPORT_STATUSES.RESOLVED) {
        ticket.resolution = {
          resolvedAt: new Date(),
          resolvedBy: adminId
        };
        ticket.sla.resolutionDue = new Date();
      }

      // Handle reopening
      if (status === SUPPORT_STATUSES.REOPENED && oldStatus === SUPPORT_STATUSES.RESOLVED) {
        ticket.resolution = null;
      }

      // Add to timeline
      ticket.timeline.push({
        action: 'status_changed',
        performedBy: { type: 'admin', id: adminId },
        note: note || `Status changed from ${oldStatus} to ${status}`,
        timestamp: new Date()
      });

      await ticket.save({ session });

      // Notify user
    //   await addNotification({
    //     userId: ticket.createdBy,
    //     type: 'support',
    //     title: `Ticket Status Updated`,
    //     message: `Your ticket ${ticket.ticketNumber} status changed to ${status}`,
    //     data: { ticketId, ticketNumber: ticket.ticketNumber, status }
    //   });

      await session.commitTransaction();

      return ticket;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateStatus:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Assign ticket to admin
   */
  async assignTicket(ticketId, adminId, assignData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validator sends `adminId`; keep `assignedAdminId` for backward compatibility
      const { adminId: targetAdminId, assignedAdminId, note } = assignData;
      const assigneeId = targetAdminId || assignedAdminId;

      const ticket = await SupportTicket.findById(ticketId).session(session);

      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      const admin = await Admin.findById(assigneeId).session(session);
      if (!admin) {
        throw new AppError('Admin not found', 404);
      }

      const adminName = `${admin.profile?.firstName || ''} ${admin.profile?.lastName || ''}`.trim() || admin.email;

      const oldAssignedTo = ticket.assignedTo;
      ticket.assignedTo = assigneeId;
      ticket.status = SUPPORT_STATUSES.ASSIGNED;

      // Add to timeline
      ticket.timeline.push({
        action: 'assigned',
        performedBy: { type: 'admin', id: adminId },
        note: note || `Ticket assigned to ${adminName}`,
        timestamp: new Date()
      });

      await ticket.save({ session });

      await session.commitTransaction();

      return ticket;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in assignTicket:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Provide feedback for resolved ticket
   */
  async provideFeedback(ticketId, userId, feedbackData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { rating, comment } = feedbackData;
      
      const ticket = await SupportTicket.findById(ticketId).session(session);
      
      if (!ticket) {
        throw new AppError('Ticket not found', 404);
      }

      // Check authorization
      if (ticket.createdBy.toString() !== userId.toString()) {
        throw new AppError('You are not authorized to provide feedback for this ticket', 403);
      }

      // Check if ticket is resolved
      if (ticket.status !== SUPPORT_STATUSES.RESOLVED && ticket.status !== SUPPORT_STATUSES.CLOSED) {
        throw new AppError('Feedback can only be provided for resolved tickets', 400);
      }

      ticket.resolution.feedback = {
        rating,
        comment,
        providedAt: new Date()
      };

      await ticket.save({ session });

      await session.commitTransaction();

      return ticket.resolution.feedback;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in provideFeedback:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get ticket statistics for vendor
   */
  async getTicketStats(userId) {
    try {
      const stats = await SupportTicket.aggregate([
        { $match: { createdBy: userId } },
        {
          $facet: {
            total: [{ $count: 'count' }],
            byStatus: [
              { $group: { _id: '$status', count: { $sum: 1 } } },
              { $sort: { count: -1 } }
            ],
            byPriority: [
              { $group: { _id: '$priority', count: { $sum: 1 } } },
              { $sort: { count: -1 } }
            ],
            recentActivity: [
              { $sort: { updatedAt: -1 } },
              { $limit: 5 },
              { $project: { ticketNumber: 1, status: 1, priority: 1, updatedAt: 1 } }
            ],
            averageResolutionTime: [
              { $match: { 'resolution.resolvedAt': { $exists: true } } },
              {
                $group: {
                  _id: null,
                  avgTime: {
                    $avg: {
                      $subtract: ['$resolution.resolvedAt', '$createdAt']
                    }
                  }
                }
              }
            ]
          }
        }
      ]);

      return {
        total: stats[0]?.total[0]?.count || 0,
        byStatus: stats[0]?.byStatus || [],
        byPriority: stats[0]?.byPriority || [],
        recentActivity: stats[0]?.recentActivity || [],
        averageResolutionHours: stats[0]?.averageResolutionTime[0]?.avgTime 
          ? Math.round(stats[0].averageResolutionTime[0].avgTime / (1000 * 60 * 60))
          : 0
      };
    } catch (error) {
      logger.error('Error in getTicketStats:', error);
      throw error;
    }
  }

  /**
   * Get all tickets (admin)
   */
  async getAllTickets(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      const query = {};
      if (filters.status) query.status = filters.status;
      if (filters.priority) query.priority = filters.priority;
      if (filters.type) query.type = filters.type;
      if (filters.assignedTo) query.assignedTo = filters.assignedTo;
      if (filters.search) {
        query.$or = [
          { ticketNumber: { $regex: filters.search, $options: 'i' } },
          { subject: { $regex: filters.search, $options: 'i' } }
        ];
      }

      const [tickets, total] = await Promise.all([
        SupportTicket.find(query)
          .populate('createdBy', 'email profile.firstName profile.lastName')
          .populate('assignedTo', 'email profile.firstName profile.lastName')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        SupportTicket.countDocuments(query)
      ]);

      // Add SLA breach info
      const ticketsWithSLA = tickets.map(ticket => {
        const now = new Date();
        const isResponseBreached = ticket.sla?.responseDue && new Date(ticket.sla.responseDue) < now && ticket.status !== SUPPORT_STATUSES.RESOLVED;
        const isResolutionBreached = ticket.sla?.resolutionDue && new Date(ticket.sla.resolutionDue) < now && ticket.status !== SUPPORT_STATUSES.RESOLVED;
        
        return {
          ...ticket,
          slaBreached: isResponseBreached || isResolutionBreached
        };
      });

      return {
        tickets: ticketsWithSLA,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getAllTickets:', error);
      throw error;
    }
  }

  /**
   * Get dashboard stats (admin)
   */
  async getDashboardStats() {
    try {
      const now = new Date();
      
      const stats = await SupportTicket.aggregate([
        {
          $facet: {
            openTickets: [
              { $match: { status: { $in: ['open', 'assigned', 'in_progress'] } } },
              { $count: 'count' }
            ],
            pendingTickets: [
              { $match: { status: 'pending' } },
              { $count: 'count' }
            ],
            resolvedToday: [
              { 
                $match: { 
                  'resolution.resolvedAt': { 
                    $gte: new Date(now.setHours(0, 0, 0, 0)),
                    $lt: new Date(now.setHours(23, 59, 59, 999))
                  }
                }
              },
              { $count: 'count' }
            ],
            avgResponseTime: [
              { 
                $match: { 
                  'timeline.action': 'assigned',
                  'timeline.0.timestamp': { $exists: true }
                }
              },
              {
                $project: {
                  responseTime: {
                    $subtract: [
                      { $arrayElemAt: ['$timeline.timestamp', 0] },
                      '$createdAt'
                    ]
                  }
                }
              },
              { $group: { _id: null, avg: { $avg: '$responseTime' } } }
            ],
            byPriority: [
              { $group: { _id: '$priority', count: { $sum: 1 } } }
            ]
          }
        }
      ]);

      return {
        open: stats[0]?.openTickets[0]?.count || 0,
        pending: stats[0]?.pendingTickets[0]?.count || 0,
        resolvedToday: stats[0]?.resolvedToday[0]?.count || 0,
        avgResponseHours: stats[0]?.avgResponseTime[0]?.avg 
          ? Math.round(stats[0].avgResponseTime[0].avg / (1000 * 60 * 60))
          : 0,
        byPriority: stats[0]?.byPriority || []
      };
    } catch (error) {
      logger.error('Error in getDashboardStats:', error);
      throw error;
    }
  }
}

module.exports = new SupportTicketService();