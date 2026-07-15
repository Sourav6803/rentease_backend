const { Delivery, Rental, User, Vendor, Address, DeliveryPerson } = require('../models');
const { AppError } = require('../utils/AppError');
const { addJob } = require('../jobs');
const { eventEmitter, EVENTS } = require('../events');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const moment = require('moment');
const axios = require('axios');

class DeliveryService {
  constructor() {
    this.redisClient = getRedisClient();
    this.defaultTTL = 1800; // 30 minutes
    
    // Delivery time slots
    this.timeSlots = [
      { start: '09:00', end: '12:00', label: 'Morning (9 AM - 12 PM)' },
      { start: '12:00', end: '15:00', label: 'Afternoon (12 PM - 3 PM)' },
      { start: '15:00', end: '18:00', label: 'Evening (3 PM - 6 PM)' },
      { start: '18:00', end: '21:00', label: 'Night (6 PM - 9 PM)' }
    ];

    // Distance matrix API (Google Maps or OSRM)
    this.distanceApiUrl = process.env.DISTANCE_MATRIX_API_URL || 'http://router.project-osrm.org/route/v1/driving/';
  }

  /**
   * Generate unique delivery number
   */
  generateDeliveryNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `DLV${timestamp}${random}`;
  }

  /**
   * Calculate distance and duration between two points
   */
  async calculateRoute(origin, destination, waypoints = []) {
    try {
      const points = [
        `${origin.lng},${origin.lat}`,
        ...waypoints.map((w) => `${w.lng},${w.lat}`),
        `${destination.lng},${destination.lat}`,
      ];

      const response = await axios.get(
        `${this.distanceApiUrl}${points.join(';')}?overview=full&geometries=geojson&alternatives=false&steps=false`,
      );

      if (response.data.code === 'Ok') {
        const route = response.data.routes[0];
        return {
          distance: Math.round((route.distance / 1000) * 10) / 10,
          duration: Math.round(route.duration / 60),
          polyline: route.geometry,
          geometry: route.geometry,
        };
      }

      return null;
    } catch (error) {
      logger.error('Error calculating route:', error);
      const distance = this.calculateStraightLineDistance(origin, destination);
      return {
        distance: Math.round(distance * 10) / 10,
        duration: Math.round(distance * 2),
        polyline: null,
        geometry: null,
      };
    }
  }

  partnerDeliveryQuery(personId) {
    return {
      $or: [{ deliveryPerson: personId }, { assignedDeliveryPerson: personId }],
    };
  }

  /**
   * Calculate straight-line distance between coordinates
   */
  calculateStraightLineDistance(origin, destination) {
    const R = 6371; // Earth's radius in km
    const lat1 = origin.lat * Math.PI / 180;
    const lat2 = destination.lat * Math.PI / 180;
    const deltaLat = (destination.lat - origin.lat) * Math.PI / 180;
    const deltaLng = (destination.lng - origin.lng) * Math.PI / 180;

    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }

  /**
   * Create delivery
   */
  async createDelivery(rentalId, vendorId, deliveryData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { type, scheduledDate, scheduledSlot, addressId, items, notes } = deliveryData;

      // Get rental details
      const rental = await Rental.findOne({
        _id: rentalId,
        vendor: vendorId
      }).populate('user').populate('product').session(session);

      if (!rental) {
        throw new AppError('Rental not found or unauthorized', 404);
      }

      // Get address
      const address = await Address.findById(addressId || rental.address).session(session);
      if (!address) {
        throw new AppError('Address not found', 404);
      }

      // Calculate route if coordinates available
      let route = null;
      if (address.coordinates?.coordinates) {
        // Assuming vendor has a default warehouse location
        const vendorWarehouse = await this.getVendorWarehouseLocation(vendorId);
        if (vendorWarehouse) {
          route = await this.calculateRoute(
            vendorWarehouse,
            {
              lat: address.coordinates.coordinates[1],
              lng: address.coordinates.coordinates[0]
            }
          );
        }
      }

      // Create delivery
      const deliveryNumber = this.generateDeliveryNumber();
      
      const delivery = await Delivery.create([{
        deliveryNumber,
        rental: rentalId,
        type,
        status: 'scheduled',
        priority: this.calculatePriority(rental, type),
        schedule: {
          requestedDate: new Date(scheduledDate),
          scheduledDate: new Date(scheduledDate),
          scheduledSlot
        },
        address: address._id,
        contact: {
          name: address.contactDetails?.name || `${rental.user.profile.firstName} ${rental.user.profile.lastName}`,
          phone: address.contactDetails?.phone || rental.user.phone,
          email: address.contactDetails?.email || rental.user.email
        },
        items: items || [{
          product: rental.product._id,
          inventory: rental.inventory,
          name: rental.product.basicInfo.name,
          quantity: 1
        }],
        route: route ? {
          distance: route.distance,
          duration: route.duration,
          polyline: route.polyline,
          waypoints: [{
            type: 'Point',
            coordinates: [address.coordinates.coordinates[0], address.coordinates.coordinates[1]],
            address: address.getFullAddress?.(),
            stopType: 'delivery'
          }]
        } : undefined,
        metadata: {
          createdBy: vendorId,
          notes
        }
      }], { session });

      // Update rental with delivery reference
      rental.deliveries = rental.deliveries || [];
      rental.deliveries.push(delivery[0]._id);
      await rental.save({ session });

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.DELIVERY.SCHEDULED, {
        deliveryId: delivery[0]._id,
        deliveryNumber: delivery[0].deliveryNumber,
        rentalId,
        userId: rental.user._id,
        vendorId,
        scheduledDate
      });

      // Schedule reminder
      await this.scheduleDeliveryReminders(delivery[0]);

      return delivery[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in createDelivery:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Calculate delivery priority
   */
  calculatePriority(rental, type) {
    if (type === 'pickup' && moment(rental.rentalDetails.endDate).diff(moment(), 'days') <= 1) {
      return 'high';
    }
    if (type === 'delivery' && moment(rental.rentalDetails.startDate).diff(moment(), 'days') <= 1) {
      return 'high';
    }
    return 'medium';
  }

  /**
   * Get vendor warehouse location
   */
  async getVendorWarehouseLocation(vendorId) {
    try {
      const vendor = await Vendor.findOne({ user: vendorId })
        .populate({
          path: 'addresses.warehouse',
          match: { 'coordinates.coordinates': { $exists: true } }
        });

      if (vendor?.addresses?.warehouse?.[0]?.coordinates?.coordinates) {
        const coords = vendor.addresses.warehouse[0].coordinates.coordinates;
        return {
          lat: coords[1],
          lng: coords[0]
        };
      }
      return null;
    } catch (error) {
      logger.error('Error getting vendor warehouse:', error);
      return null;
    }
  }

  /**
   * Get delivery by ID
   */
  async getDelivery(deliveryId, userId, userRole = 'user') {
    try {
      const cacheKey = `delivery:${deliveryId}`;
      
      // Try cache first
      if (this.redisClient) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const delivery = await Delivery.findById(deliveryId)
        .populate({
          path: 'rental',
          select: 'rentalNumber user vendor product rentalDetails',
          populate: {
            path: 'product',
            select: 'basicInfo.name'
          }
        })
        .populate('address')
        .populate('deliveryPerson', 'profile.firstName profile.lastName phone')
        .populate('assignedTeam', 'profile.firstName profile.lastName')
        .populate('items.product', 'basicInfo.name')
        .populate('items.inventory', 'sku')
        .lean();

      if (!delivery) {
        throw new AppError('Delivery not found', 404);
      }

      // Check authorization
      if (userRole === 'user' && delivery.rental.user.toString() !== userId.toString()) {
        throw new AppError('Unauthorized to view this delivery', 403);
      }

      if (userRole === 'vendor' && delivery.rental.vendor.toString() !== userId.toString()) {
        throw new AppError('Unauthorized to view this delivery', 403);
      }

      const partnerRoles = ['delivery', 'delivery_partner', 'delivery_boy', 'delivery_team'];
      if (partnerRoles.includes(userRole)) {
        const person = await DeliveryPerson.findOne({ user: userId }).select('_id').lean();
        if (!person) {
          throw new AppError('Unauthorized to view this delivery', 403);
        }
        const assignedPersonId = (
          delivery.deliveryPerson?._id || delivery.deliveryPerson
        )?.toString();
        const assignedAltId = (
          delivery.assignedDeliveryPerson?._id || delivery.assignedDeliveryPerson
        )?.toString();
        const isAssigned =
          assignedPersonId === person._id.toString() ||
          assignedAltId === person._id.toString();
        if (!isAssigned) {
          throw new AppError('Unauthorized to view this delivery', 403);
        }
      }

      // Calculate estimated arrival if in transit
      if (delivery.status === 'in_transit' && delivery.tracking?.currentLocation) {
        delivery.estimatedArrival = await this.calculateEstimatedArrival(delivery);
      }

      // Cache the result
      if (this.redisClient) {
        await this.redisClient.setex(cacheKey, 300, JSON.stringify(delivery));
      }

      return delivery;
    } catch (error) {
      logger.error('Error in getDelivery:', error);
      throw error;
    }
  }

  /**
   * Get user deliveries
   */
  async getUserDeliveries(userId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      // First get user's rentals
      const rentals = await Rental.find({ user: userId }).distinct('_id');

      const query = { rental: { $in: rentals } };
      
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.startDate || filters.endDate) {
        query['schedule.scheduledDate'] = {};
        if (filters.startDate) query['schedule.scheduledDate'].$gte = new Date(filters.startDate);
        if (filters.endDate) query['schedule.scheduledDate'].$lte = new Date(filters.endDate);
      }

      const [deliveries, total] = await Promise.all([
        Delivery.find(query)
          .populate({
            path: 'rental',
            select: 'rentalNumber product',
            populate: {
              path: 'product',
              select: 'basicInfo.name'
            }
          })
          .populate('address')
          .sort({ 'schedule.scheduledDate': 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Delivery.countDocuments(query)
      ]);

      return {
        deliveries,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getUserDeliveries:', error);
      throw error;
    }
  }

  /**
   * Get vendor deliveries
   */
  async getVendorDeliveries(vendorId, page = 1, limit = 10, filters = {}) {
    try {
      const skip = (page - 1) * limit;

      // Get rentals for this vendor
      const rentals = await Rental.find({ vendor: vendorId }).distinct('_id');

      const query = { rental: { $in: rentals } };
      
      if (filters.status) {
        query.status = filters.status;
      }

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.deliveryPerson) {
        query.deliveryPerson = filters.deliveryPerson;
      }

      if (filters.startDate || filters.endDate) {
        query['schedule.scheduledDate'] = {};
        if (filters.startDate) query['schedule.scheduledDate'].$gte = new Date(filters.startDate);
        if (filters.endDate) query['schedule.scheduledDate'].$lte = new Date(filters.endDate);
      }

      const [deliveries, total, summary] = await Promise.all([
        Delivery.find(query)
          .populate({
            path: 'rental',
            select: 'rentalNumber user',
            populate: {
              path: 'user',
              select: 'profile.firstName profile.lastName phone'
            }
          })
          .populate('address')
          .populate('deliveryPerson', 'profile.firstName profile.lastName')
          .sort({ priority: -1, 'schedule.scheduledDate': 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Delivery.countDocuments(query),
        this.getDeliverySummary(vendorId)
      ]);

      return {
        deliveries,
        summary,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error in getVendorDeliveries:', error);
      throw error;
    }
  }

  /**
   * Get scheduled deliveries for admin assignment board (all vendors or filtered).
   * Default: status=scheduled, unassigned only.
   */
  async getScheduledDeliveries(page = 1, limit = 20, filters = {}) {
    try {
      const skip = (page - 1) * limit;
      const query = {};

      const statusFilter = filters.status || 'scheduled';
      if (statusFilter === 'pending_assignment') {
        query.status = { $in: ['scheduled', 'batched'] };
        query.assignedDeliveryPerson = null;
        query.dispatchBatch = null;
      } else if (statusFilter !== 'all') {
        query.status = statusFilter;
        if (filters.unassignedOnly === true || filters.unassignedOnly === 'true') {
          query.assignedDeliveryPerson = null;
        }
      }

      if (filters.type) {
        query.type = filters.type;
      }

      if (filters.priority) {
        query.priority = filters.priority;
      }

      if (filters.startDate || filters.endDate) {
        query['schedule.scheduledDate'] = {};
        if (filters.startDate) {
          query['schedule.scheduledDate'].$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query['schedule.scheduledDate'].$lte = new Date(filters.endDate);
        }
      }

      if (filters.vendorId) {
        const rentalIds = await Rental.find({ vendor: filters.vendorId }).distinct('_id');
        query.rental = { $in: rentalIds };
      }

      if (filters.pincode) {
        const addressIds = await Address.find({ pincode: filters.pincode }).distinct('_id');
        query.address = { $in: addressIds };
      }

      const [deliveries, total] = await Promise.all([
        Delivery.find(query)
          .populate({
            path: 'rental',
            select: 'rentalNumber user vendor status rentalDetails.startDate',
            populate: [
              {
                path: 'user',
                select: 'profile.firstName profile.lastName phone email',
              },
              {
                path: 'vendor',
                select: 'business.name business.phone',
              },
            ],
          })
          .populate('address')
          .populate({
            path: 'items.product',
            select: 'basicInfo.name basicInfo.sku media.images',
          })
          .populate({
            path: 'assignedDeliveryPerson',
            select: 'employeeId vehicle user',
            populate: { path: 'user', select: 'profile.firstName profile.lastName phone' },
          })
          .sort({ priority: -1, 'schedule.scheduledDate': 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Delivery.countDocuments(query),
      ]);

      const pincodes = [
        ...new Set(
          deliveries
            .map((d) => d.address?.pincode)
            .filter(Boolean),
        ),
      ];

      const personnelByPincode = {};
      if (pincodes.length > 0) {
        const counts = await DeliveryPerson.aggregate([
          {
            $match: {
              'availability.isAvailable': true,
              'availability.isOnDuty': true,
              'status.isActive': true,
              'status.verificationStatus': 'verified',
              serviceablePincodes: { $in: pincodes },
            },
          },
          { $unwind: '$serviceablePincodes' },
          { $match: { serviceablePincodes: { $in: pincodes } } },
          {
            $group: {
              _id: '$serviceablePincodes',
              count: { $sum: 1 },
            },
          },
        ]);
        counts.forEach((row) => {
          personnelByPincode[row._id] = row.count;
        });
      }

      const enriched = deliveries.map((delivery) => {
        const pincode = delivery.address?.pincode;
        const slot = delivery.schedule?.scheduledSlot;
        const slotLabel =
          slot?.label ||
          (slot?.start && slot?.end ? `${slot.start} - ${slot.end}` : null);

        return {
          ...delivery,
          assignmentStatus:
            delivery.assignedDeliveryPerson || delivery.deliveryPerson
              ? 'assigned'
              : 'unassigned',
          dispatchBatchId: delivery.dispatchBatch || null,
          addressSummary: delivery.address
            ? [
                delivery.address.addressLine1,
                delivery.address.addressLine2,
                delivery.address.city,
                delivery.address.state,
                delivery.address.pincode,
              ]
                .filter(Boolean)
                .join(', ')
            : null,
          pincode,
          scheduledSlotLabel: slotLabel,
          itemCount: delivery.items?.length || 0,
          availablePersonnelInPincode: pincode
            ? personnelByPincode[pincode] || 0
            : 0,
        };
      });

      return {
        deliveries: enriched,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit) || 0,
        },
      };
    } catch (error) {
      logger.error('Error in getScheduledDeliveries:', error);
      throw error;
    }
  }

  /**
   * Get delivery summary
   */
  async getDeliverySummary(vendorId) {
    try {
      const rentals = await Rental.find({ vendor: vendorId }).distinct('_id');

      const summary = await Delivery.aggregate([
        { $match: { rental: { $in: rentals } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        scheduled: 0,
        assigned: 0,
        out_for_delivery: 0,
        in_transit: 0,
        delivered: 0,
        failed: 0,
        cancelled: 0,
        total: 0
      };

      summary.forEach(s => {
        result[s._id] = s.count;
        result.total += s.count;
      });

      // Get today's deliveries
      const today = moment().startOf('day').toDate();
      const tomorrow = moment().endOf('day').toDate();

      result.today = await Delivery.countDocuments({
        rental: { $in: rentals },
        'schedule.scheduledDate': { $gte: today, $lte: tomorrow }
      });

      return result;
    } catch (error) {
      logger.error('Error in getDeliverySummary:', error);
      return {};
    }
  }

  /**
   * Assign delivery person
   */
  async assignDeliveryPerson(deliveryId, vendorId, assignData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { deliveryPersonId, team, vehicle } = assignData;

      const vendorRentalIds = await Rental.find({ vendor: vendorId })
        .distinct('_id')
        .session(session);

      const delivery = await Delivery.findOne({
        _id: deliveryId,
        rental: { $in: vendorRentalIds },
        status: 'scheduled',
      }).session(session);

      if (!delivery) {
        throw new AppError('Delivery not found or cannot be assigned', 404);
      }

      delivery.deliveryPerson = deliveryPersonId;
      delivery.assignedDeliveryPerson = deliveryPersonId;
      if (team) delivery.assignedTeam = team;
      if (vehicle) delivery.vehicle = vehicle;
      
      delivery.status = 'assigned';
      delivery.tracking.timeline.push({
        status: 'assigned',
        timestamp: new Date(),
        note: `Assigned to delivery person`,
        updatedBy: vendorId
      });

      await delivery.save({ session });

      await session.commitTransaction();

      // Notify delivery person
      await addJob('notification', 'create', {
        userId: deliveryPersonId,
        type: 'in_app',
        title: 'New Delivery Assignment',
        content: `You have been assigned to delivery #${delivery.deliveryNumber}`,
        data: {
          deliveryId: delivery._id,
          deliveryNumber: delivery.deliveryNumber
        }
      });

      // Notify customer
      await addJob('notification', 'create', {
        userId: delivery.rental.user,
        type: 'in_app',
        title: 'Delivery Person Assigned',
        content: `A delivery person has been assigned for your delivery #${delivery.deliveryNumber}`,
        data: {
          deliveryId: delivery._id
        }
      });

      // Invalidate cache
      await this.invalidateDeliveryCache(deliveryId);

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in assignDeliveryPerson:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Start delivery
   */
  async startDelivery(deliveryId, deliveryPersonId, startData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { location, notes } = startData;

      if (!location?.lat || !location?.lng) {
        throw new AppError('Start location is required', 400);
      }

      const delivery = await Delivery.findOne({
        _id: deliveryId,
        ...this.partnerDeliveryQuery(deliveryPersonId),
        status: { $in: ['assigned', 'batched'] },
      })
        .populate('rental')
        .session(session);

      if (!delivery) {
        throw new AppError('Delivery not found or not assigned to you', 404);
      }

      delivery.status = 'out_for_delivery';
      if (!delivery.tracking) {
        delivery.tracking = { timeline: [] };
      }
      delivery.tracking.currentLocation = {
        type: 'Point',
        coordinates: [location.lng, location.lat],
        updatedAt: new Date(),
      };
      delivery.tracking.timeline.push({
        status: 'out_for_delivery',
        timestamp: new Date(),
        location: {
          coordinates: [location.lng, location.lat]
        },
        note: notes || 'Delivery started',
        updatedBy: deliveryPersonId
      });

      await delivery.save({ session });

      await session.commitTransaction();

      // Notify customer
      await addJob('notification', 'create', {
        userId: delivery.rental.user,
        type: 'in_app',
        title: 'Delivery Started',
        content: `Your delivery #${delivery.deliveryNumber} is on the way!`,
        data: {
          deliveryId: delivery._id,
          trackingUrl: `${process.env.CLIENT_URL}/deliveries/track/${delivery.deliveryNumber}`
        }
      });

      // Send SMS
      await addJob('sms', 'send', {
        to: delivery.contact.phone,
        message: `Your RentEase delivery #${delivery.deliveryNumber} is on the way! Track here: ${process.env.CLIENT_URL}/deliveries/track/${delivery.deliveryNumber}`
      });

      // Invalidate cache
      await this.invalidateDeliveryCache(deliveryId);

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in startDelivery:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update delivery location
   */
  async updateLocation(deliveryId, deliveryPersonId, location) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const delivery = await Delivery.findOne({
        _id: deliveryId,
        ...this.partnerDeliveryQuery(deliveryPersonId),
        status: { $in: ['out_for_delivery', 'in_transit', 'reached'] },
      })
        .populate('address')
        .populate('rental', 'user')
        .session(session);

      if (!delivery) {
        throw new AppError('Delivery not found or not in transit', 404);
      }

      delivery.tracking.currentLocation = {
        type: 'Point',
        coordinates: [location.lng, location.lat],
        updatedAt: new Date(),
      };

      if (delivery.address?.coordinates?.coordinates) {
        const remainingDistance = await this.calculateRemainingDistance(
          { lat: location.lat, lng: location.lng },
          {
            lat: delivery.address.coordinates.coordinates[1],
            lng: delivery.address.coordinates.coordinates[0],
          },
        );

        delivery.tracking.estimatedArrival = new Date(
          Date.now() + (remainingDistance / 30) * 60 * 60 * 1000,
        );
      }

      await delivery.save({ session });

      await session.commitTransaction();

      eventEmitter.emit('delivery:location-updated', {
        deliveryId: delivery._id,
        deliveryNumber: delivery.deliveryNumber,
        location,
        estimatedArrival: delivery.tracking.estimatedArrival,
        customerUserId: delivery.rental?.user,
        personId: deliveryPersonId,
      });

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateLocation:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Update delivery progress (in_transit / reached)
   */
  async updateDeliveryProgress(deliveryId, deliveryPersonId, progressData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { status, location, notes } = progressData;
      const statusMap = {
        in_transit: 'in_transit',
        reached_location: 'reached',
      };
      const newStatus = statusMap[status];

      if (!newStatus) {
        throw new AppError('Invalid progress status', 400);
      }

      const delivery = await Delivery.findOne({
        _id: deliveryId,
        ...this.partnerDeliveryQuery(deliveryPersonId),
        status: { $in: ['assigned', 'out_for_delivery', 'in_transit', 'reached', 'batched'] },
      })
        .populate('address')
        .populate('rental', 'user')
        .session(session);

      if (!delivery) {
        throw new AppError('Delivery not found or not assigned to you', 404);
      }

      delivery.status = newStatus;

      if (location?.lat != null && location?.lng != null) {
        delivery.tracking.currentLocation = {
          type: 'Point',
          coordinates: [location.lng, location.lat],
          updatedAt: new Date(),
        };

        if (delivery.address?.coordinates?.coordinates) {
          delivery.tracking.estimatedArrival = await this.calculateEstimatedArrival(delivery);
        }
      }

      if (newStatus === 'reached') {
        delivery.tracking.actualArrival = new Date();
      }

      delivery.tracking.timeline.push({
        status: newStatus,
        timestamp: new Date(),
        location: location
          ? { coordinates: [location.lng, location.lat] }
          : undefined,
        note: notes || status,
        updatedBy: deliveryPersonId,
      });

      await delivery.save({ session });
      await session.commitTransaction();

      await this.invalidateDeliveryCache(deliveryId);

      const eventName =
        newStatus === 'reached' ? EVENTS.DELIVERY.REACHED : EVENTS.DELIVERY.IN_TRANSIT;
      eventEmitter.emit(eventName, {
        deliveryId: delivery._id,
        deliveryNumber: delivery.deliveryNumber,
        status: newStatus,
        userId: delivery.rental?.user,
      });

      eventEmitter.emit('delivery:location-updated', {
        deliveryId: delivery._id,
        deliveryNumber: delivery.deliveryNumber,
        location,
        status: newStatus,
        estimatedArrival: delivery.tracking.estimatedArrival,
        customerUserId: delivery.rental?.user,
        personId: deliveryPersonId,
      });

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in updateDeliveryProgress:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Calculate remaining distance
   */
  async calculateRemainingDistance(current, destination) {
    try {
      const route = await this.calculateRoute(current, destination);
      return route?.distance || 0;
    } catch (error) {
      return this.calculateStraightLineDistance(current, destination);
    }
  }

  /**
   * Calculate estimated arrival
   */
  async calculateEstimatedArrival(delivery) {
    if (!delivery.tracking?.currentLocation || !delivery.address?.coordinates) {
      return null;
    }

    const remaining = await this.calculateRemainingDistance(
      {
        lat: delivery.tracking.currentLocation.coordinates[1],
        lng: delivery.tracking.currentLocation.coordinates[0]
      },
      {
        lat: delivery.address.coordinates.coordinates[1],
        lng: delivery.address.coordinates.coordinates[0]
      }
    );

    // Assuming average speed of 30 km/h
    const minutesRemaining = (remaining / 30) * 60;
    return moment().add(minutesRemaining, 'minutes').toDate();
  }

  /**
   * Mark as delivered
   */
  async markAsDelivered(deliveryId, deliveryPersonId, proofData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { signature, photos, otp, notes } = proofData;

      const delivery = await Delivery.findOne({
        _id: deliveryId,
        deliveryPerson: deliveryPersonId,
        status: { $in: ['out_for_delivery', 'in_transit'] }
      }).populate('rental').session(session);

      if (!delivery) {
        throw new AppError('Delivery not found or not in transit', 404);
      }

      // Verify OTP if required
      if (delivery.proof?.otp && delivery.proof.otp !== otp) {
        throw new AppError('Invalid OTP', 400);
      }

      delivery.status = 'delivered';
      delivery.tracking.actualArrival = new Date();
      delivery.proof = {
        deliveredTo: delivery.contact.name,
        signature,
        photos: photos || [],
        otp: otp ? { verified: true, verifiedAt: new Date() } : undefined
      };

      delivery.tracking.timeline.push({
        status: 'delivered',
        timestamp: new Date(),
        note: notes || 'Delivery completed',
        updatedBy: deliveryPersonId
      });

      await delivery.save({ session });

      // Update rental status
      if (delivery.type === 'delivery') {
        delivery.rental.status = 'delivered';
        delivery.rental.delivery = {
          actualDate: new Date(),
          status: 'delivered',
          deliveredBy: deliveryPersonId,
          receivedBy: delivery.contact.name,
          signature
        };
        await delivery.rental.save({ session });
      } else if (delivery.type === 'pickup') {
        delivery.rental.status = 'completed';
        delivery.rental.rentalDetails.actualEndDate = new Date();
        await delivery.rental.save({ session });
      }

      await session.commitTransaction();

      // Emit event
      eventEmitter.emit(EVENTS.DELIVERY.DELIVERED, {
        deliveryId: delivery._id,
        deliveryNumber: delivery.deliveryNumber,
        rentalId: delivery.rental._id,
        userId: delivery.rental.user,
        type: delivery.type
      });

      // Request review if delivery completed
      if (delivery.type === 'delivery') {
        await addJob('rental', 'review-reminder', {
          rentalId: delivery.rental._id,
          userId: delivery.rental.user,
          scheduledAt: moment().add(3, 'days').toDate()
        });
      }

      // Invalidate cache
      await this.invalidateDeliveryCache(deliveryId);

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in markAsDelivered:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Mark as failed
   */
  async markAsFailed(deliveryId, deliveryPersonId, failureData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { reason, notes, reschedule } = failureData;

      const delivery = await Delivery.findOne({
        _id: deliveryId,
        deliveryPerson: deliveryPersonId
      }).populate('rental').session(session);

      if (!delivery) {
        throw new AppError('Delivery not found', 404);
      }

      delivery.status = 'failed';
      delivery.issues = delivery.issues || [];
      delivery.issues.push({
        type: reason,
        description: notes,
        reportedAt: new Date(),
        reportedBy: deliveryPersonId
      });

      delivery.tracking.timeline.push({
        status: 'failed',
        timestamp: new Date(),
        note: `Delivery failed: ${reason} - ${notes || ''}`,
        updatedBy: deliveryPersonId
      });

      await delivery.save({ session });

      // Create rescheduled delivery if requested
      if (reschedule) {
        const newDelivery = await this.createDelivery(
          delivery.rental._id,
          delivery.rental.vendor,
          {
            type: delivery.type,
            scheduledDate: reschedule.date,
            scheduledSlot: reschedule.slot,
            addressId: delivery.address,
            items: delivery.items,
            notes: `Rescheduled from failed delivery #${delivery.deliveryNumber}`
          }
        );

        delivery.rescheduledTo = newDelivery._id;
        await delivery.save({ session });
      }

      await session.commitTransaction();

      // Notify customer
      await addJob('notification', 'create', {
        userId: delivery.rental.user,
        type: 'in_app',
        title: 'Delivery Failed',
        content: `Your delivery #${delivery.deliveryNumber} failed. Reason: ${reason}`,
        data: {
          deliveryId: delivery._id,
          rescheduled: !!reschedule
        }
      });

      // Invalidate cache
      await this.invalidateDeliveryCache(deliveryId);

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in markAsFailed:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Reschedule delivery
   */
  async rescheduleDelivery(deliveryId, vendorId, rescheduleData) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { newDate, newSlot, reason } = rescheduleData;

      const delivery = await Delivery.findOne({
        _id: deliveryId,
        'rental.vendor': vendorId,
        status: { $in: ['scheduled', 'assigned', 'failed'] }
      }).populate('rental').session(session);

      if (!delivery) {
        throw new AppError('Delivery not found or cannot be rescheduled', 404);
      }

      // Update schedule
      delivery.schedule = {
        ...delivery.schedule,
        previousDate: delivery.schedule.scheduledDate,
        scheduledDate: new Date(newDate),
        scheduledSlot: newSlot,
        rescheduledCount: (delivery.schedule.rescheduledCount || 0) + 1,
        rescheduleReason: reason
      };

      delivery.status = 'rescheduled';
      delivery.tracking.timeline.push({
        status: 'rescheduled',
        timestamp: new Date(),
        note: `Delivery rescheduled to ${moment(newDate).format('DD/MM/YYYY')} ${newSlot || ''}. Reason: ${reason}`,
        updatedBy: vendorId
      });

      await delivery.save({ session });

      await session.commitTransaction();

      // Notify customer
      await addJob('notification', 'create', {
        userId: delivery.rental.user,
        type: 'in_app',
        title: 'Delivery Rescheduled',
        content: `Your delivery #${delivery.deliveryNumber} has been rescheduled to ${moment(newDate).format('DD/MM/YYYY')}`,
        data: {
          deliveryId: delivery._id,
          newDate,
          newSlot
        }
      });

      // Schedule new reminders
      await this.scheduleDeliveryReminders(delivery);

      // Invalidate cache
      await this.invalidateDeliveryCache(deliveryId);

      return delivery;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error in rescheduleDelivery:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Schedule delivery reminders
   */
  async scheduleDeliveryReminders(delivery) {
    const scheduledDate = moment(delivery.schedule.scheduledDate);

    // Reminder 24 hours before
    await addJob('delivery', 'reminder', {
      deliveryId: delivery._id,
      userId: delivery.rental.user,
      type: '24h',
      scheduledAt: scheduledDate.clone().subtract(24, 'hours').toDate()
    });

    // Reminder 2 hours before
    await addJob('delivery', 'reminder', {
      deliveryId: delivery._id,
      userId: delivery.rental.user,
      type: '2h',
      scheduledAt: scheduledDate.clone().subtract(2, 'hours').toDate()
    });

    // If delivery person assigned, remind them 1 hour before
    if (delivery.deliveryPerson) {
      await addJob('delivery', 'staff-reminder', {
        deliveryId: delivery._id,
        userId: delivery.deliveryPerson,
        scheduledAt: scheduledDate.clone().subtract(1, 'hour').toDate()
      });
    }
  }

  /**
   * Get available time slots
   */
  getAvailableTimeSlots(date, existingDeliveries = []) {
    const slots = [...this.timeSlots];
    const dateStr = moment(date).format('YYYY-MM-DD');

    // Count deliveries per slot
    const slotCounts = {};
    existingDeliveries.forEach(d => {
      if (moment(d.schedule.scheduledDate).format('YYYY-MM-DD') === dateStr) {
        const slot = d.schedule.scheduledSlot;
        slotCounts[slot] = (slotCounts[slot] || 0) + 1;
      }
    });

    // Mark slots as unavailable if too many bookings (e.g., > 5 per slot)
    return slots.map(slot => ({
      ...slot,
      available: (slotCounts[slot.label] || 0) < 5,
      bookings: slotCounts[slot.label] || 0
    }));
  }

  /**
   * Get delivery tracking
   */
  async getDeliveryTracking(trackingNumber) {
    try {
      const delivery = await Delivery.findOne({ deliveryNumber: trackingNumber })
        .populate('address')
        .populate('deliveryPerson', 'profile.firstName profile.lastName phone')
        .lean();

      if (!delivery) {
        throw new AppError('Delivery not found', 404);
      }

      // Remove sensitive information
      delete delivery.proof?.signature;

      return {
        deliveryNumber: delivery.deliveryNumber,
        status: delivery.status,
        type: delivery.type,
        scheduledDate: delivery.schedule.scheduledDate,
        estimatedArrival: delivery.tracking?.estimatedArrival,
        currentLocation: delivery.tracking?.currentLocation,
        timeline: delivery.tracking?.timeline,
        address: delivery.address,
        deliveryPerson: delivery.deliveryPerson ? {
          name: `${delivery.deliveryPerson.profile.firstName} ${delivery.deliveryPerson.profile.lastName}`,
          phone: delivery.deliveryPerson.phone
        } : null
      };
    } catch (error) {
      logger.error('Error in getDeliveryTracking:', error);
      throw error;
    }
  }

  /**
   * Get delivery analytics
   */
  async getDeliveryAnalytics(vendorId, startDate, endDate) {
    try {
      const rentals = await Rental.find({ vendor: vendorId }).distinct('_id');

      const analytics = await Delivery.aggregate([
        {
          $match: {
            rental: { $in: rentals },
            createdAt: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalDeliveries: { $sum: 1 },
                  successfulDeliveries: {
                    $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                  },
                  failedDeliveries: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                  },
                  averageDuration: {
                    $avg: {
                      $cond: [
                        { $and: [
                          { $ne: ['$tracking.actualArrival', null] },
                          { $ne: ['$tracking.timeline.0.timestamp', null] }
                        ]},
                        { $subtract: ['$tracking.actualArrival', '$tracking.timeline.0.timestamp'] },
                        null
                      ]
                    }
                  }
                }
              }
            ],
            byType: [
              {
                $group: {
                  _id: '$type',
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
            daily: [
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  count: { $sum: 1 },
                  successful: {
                    $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                  }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ],
            byDeliveryPerson: [
              {
                $group: {
                  _id: '$deliveryPerson',
                  count: { $sum: 1 },
                  successful: {
                    $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                  }
                }
              },
              {
                $lookup: {
                  from: 'users',
                  localField: '_id',
                  foreignField: '_id',
                  as: 'person'
                }
              },
              { $unwind: '$person' },
              {
                $project: {
                  name: { $concat: ['$person.profile.firstName', ' ', '$person.profile.lastName'] },
                  count: 1,
                  successful: 1,
                  successRate: { $multiply: [{ $divide: ['$successful', '$count'] }, 100] }
                }
              },
              { $sort: { count: -1 } }
            ],
            peakHours: [
              {
                $group: {
                  _id: { $hour: '$schedule.scheduledDate' },
                  count: { $sum: 1 }
                }
              },
              { $sort: { count: -1 } },
              { $limit: 5 }
            ]
          }
        }
      ]);

      return analytics[0];
    } catch (error) {
      logger.error('Error in getDeliveryAnalytics:', error);
      throw error;
    }
  }

  /**
   * Get delivery person performance
   */
  async getDeliveryPersonPerformance(personId, startDate, endDate) {
    try {
      const performance = await Delivery.aggregate([
        {
          $match: {
            deliveryPerson: personId,
            createdAt: {
              $gte: new Date(startDate),
              $lte: new Date(endDate)
            }
          }
        },
        {
          $facet: {
            overview: [
              {
                $group: {
                  _id: null,
                  totalAssignments: { $sum: 1 },
                  completedDeliveries: {
                    $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
                  },
                  failedDeliveries: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                  },
                  averageDuration: {
                    $avg: {
                      $cond: [
                        { $and: [
                          { $ne: ['$tracking.actualArrival', null] },
                          { $ne: ['$tracking.timeline.0.timestamp', null] }
                        ]},
                        { $subtract: ['$tracking.actualArrival', '$tracking.timeline.0.timestamp'] },
                        null
                      ]
                    }
                  }
                }
              }
            ],
            daily: [
              {
                $group: {
                  _id: {
                    year: { $year: '$createdAt' },
                    month: { $month: '$createdAt' },
                    day: { $dayOfMonth: '$createdAt' }
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
            ],
            issues: [
              {
                $match: { 'issues.0': { $exists: true } }
              },
              {
                $unwind: '$issues'
              },
              {
                $group: {
                  _id: '$issues.type',
                  count: { $sum: 1 }
                }
              }
            ]
          }
        }
      ]);

      return performance[0];
    } catch (error) {
      logger.error('Error in getDeliveryPersonPerformance:', error);
      throw error;
    }
  }

  /**
   * Invalidate delivery cache
   */
  async invalidateDeliveryCache(deliveryId) {
    try {
      if (this.redisClient) {
        const patterns = [
          `delivery:${deliveryId}`,
          `delivery:${deliveryId}:*`,
          'deliveries:user:*',
          'deliveries:vendor:*',
          'delivery:tracking:*'
        ];
        
        for (const pattern of patterns) {
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(keys);
          }
        }
      }
    } catch (error) {
      logger.error('Error invalidating delivery cache:', error);
    }
  }
}

module.exports = new DeliveryService();