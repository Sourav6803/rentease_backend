const moment = require('moment');
const { Delivery, DeliveryPerson } = require('../models');
const { AppError } = require('../utils/AppError');
const logger = require('../config/logger');
const DeliveryService = require('./delivery.service');
const DeliveryAIService = require('./delivery-ai.service');

const DELIVERY_EARNING_PER_STOP = 85;

class DeliveryPartnerService {
  async resolvePersonByUserId(userId) {
    const person = await DeliveryPerson.findOne({ user: userId })
      .populate('user', 'profile.firstName profile.lastName email phone profile.avatar')
      .lean();

    if (!person) {
      throw new AppError('Delivery partner profile not found', 404);
    }
    return person;
  }

  personDeliveryQuery(personId) {
    return {
      $or: [
        { assignedDeliveryPerson: personId },
        { deliveryPerson: personId },
      ],
    };
  }

  formatDeliveryForPartner(delivery) {
    const address = delivery.address || {};
    const slot = delivery.schedule?.scheduledSlot;
    const slotLabel =
      slot?.label ||
      (slot?.start && slot?.end ? `${slot.start} - ${slot.end}` : 'Flexible slot');

    return {
      _id: delivery._id,
      deliveryNumber: delivery.deliveryNumber,
      type: delivery.type,
      status: delivery.status,
      priority: delivery.priority || 'medium',
      schedule: {
        scheduledDate: delivery.schedule?.scheduledDate,
        scheduledSlot: slotLabel,
        deadline: delivery.schedule?.deadline,
      },
      address: {
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        contactName: delivery.contact?.name || address.contactDetails?.name,
        contactPhone: delivery.contact?.phone || address.contactDetails?.phone,
        coordinates: address.coordinates,
      },
      items: (delivery.items || []).map((item) => ({
        name: item.name,
        quantity: item.quantity || 1,
        sku: item.sku,
      })),
      distance: delivery.route?.distance || null,
      estimatedDuration: delivery.route?.duration || null,
      earnings: delivery.charges?.totalCharge || DELIVERY_EARNING_PER_STOP,
      rental: delivery.rental,
    };
  }

  formatDeliveryForNavigate(delivery) {
    const base = this.formatDeliveryForPartner(delivery);
    return {
      ...base,
      stopSequence: delivery.stopSequence ?? null,
      dispatchBatch: delivery.dispatchBatch ?? null,
      route: delivery.route
        ? {
            distance: delivery.route.distance,
            duration: delivery.route.duration,
            polyline: delivery.route.polyline,
            geometry: delivery.route.polyline,
            waypoints: delivery.route.waypoints,
            optimized: delivery.route.optimized,
          }
        : null,
      tracking: delivery.tracking
        ? {
            currentLocation: delivery.tracking.currentLocation,
            estimatedArrival: delivery.tracking.estimatedArrival,
            actualArrival: delivery.tracking.actualArrival,
            timeline: delivery.tracking.timeline,
          }
        : null,
    };
  }

  async enrichStopWithLiveRoute(stop, partnerLocation) {
    const destCoords = stop.address?.coordinates?.coordinates;
    const originCoords = partnerLocation?.coordinates;

    if (!destCoords?.length || !originCoords?.length) {
      return stop;
    }

    if (stop.route?.polyline || stop.route?.geometry) {
      return stop;
    }

    const liveRoute = await DeliveryService.calculateRoute(
      { lat: originCoords[1], lng: originCoords[0] },
      { lat: destCoords[1], lng: destCoords[0] },
    );

    if (!liveRoute) {
      return stop;
    }

    return {
      ...stop,
      route: {
        ...(stop.route || {}),
        ...liveRoute,
      },
      distance: liveRoute.distance,
      estimatedDuration: liveRoute.duration,
    };
  }

  async getNavigateData(userId) {
    const person = await this.resolvePersonByUserId(userId);

    const deliveries = await Delivery.find({
      ...this.personDeliveryQuery(person._id),
      status: { $in: ['assigned', 'out_for_delivery', 'in_transit', 'reached', 'batched'] },
    })
      .populate('address')
      .sort({ stopSequence: 1, 'schedule.scheduledDate': 1 })
      .lean();

    const partnerLocation = person.availability?.currentLocation || null;
    let optimizedRoute = null;

    if (deliveries.length > 0) {
      optimizedRoute = await DeliveryAIService.optimizeRoute(
        person._id,
        deliveries.map((d) => d._id),
      );
    }

    const stops = await Promise.all(
      deliveries.map(async (d) => {
        const formatted = this.formatDeliveryForNavigate(d);
        return this.enrichStopWithLiveRoute(formatted, partnerLocation);
      }),
    );

    if (optimizedRoute?.optimizedOrder?.length) {
      const orderMap = new Map(
        optimizedRoute.optimizedOrder.map((item, index) => [
          item.deliveryId.toString(),
          index + 1,
        ]),
      );
      stops.forEach((stop) => {
        stop.optimizedSequence = orderMap.get(stop._id.toString()) || null;
      });
      stops.sort(
        (a, b) =>
          (a.optimizedSequence || 999) - (b.optimizedSequence || 999),
      );
    }

    return {
      partnerLocation,
      zone: person.zone,
      isOnDuty: person.availability?.isOnDuty ?? false,
      isAvailable: person.availability?.isAvailable ?? false,
      vehicle: person.vehicle,
      activeStops: stops,
      optimizedOrder: optimizedRoute?.optimizedOrder || [],
      totalDistance: optimizedRoute?.totalDistance ?? 0,
      totalETA: optimizedRoute?.estimatedTime ?? 0,
      count: stops.length,
    };
  }

  async optimizePartnerRoute(userId, deliveryIds = []) {
    const person = await this.resolvePersonByUserId(userId);
    let ids = deliveryIds;

    if (!ids.length) {
      const active = await Delivery.find({
        ...this.personDeliveryQuery(person._id),
        status: { $in: ['assigned', 'out_for_delivery', 'in_transit', 'reached', 'batched'] },
      })
        .select('_id')
        .lean();
      ids = active.map((d) => d._id);
    }

    if (!ids.length) {
      return {
        optimizedOrder: [],
        totalDistance: 0,
        estimatedTime: 0,
        startPoint: person.availability?.currentLocation?.coordinates || null,
      };
    }

    return DeliveryAIService.optimizeRoute(person._id, ids);
  }

  async getProfile(userId) {
    const person = await this.resolvePersonByUserId(userId);
    const activeCount = await Delivery.countDocuments({
      ...this.personDeliveryQuery(person._id),
      status: { $in: ['assigned', 'out_for_delivery', 'in_transit', 'reached', 'batched'] },
    });

    return {
      ...person,
      rating: person.performance?.averageRating || 0,
      activeAssignmentsCount: activeCount,
    };
  }

  async updateAvailability(userId, { isAvailable, isOnDuty }) {
    const person = await DeliveryPerson.findOne({ user: userId });
    if (!person) throw new AppError('Delivery partner profile not found', 404);

    if (typeof isAvailable === 'boolean') {
      person.availability.isAvailable = isAvailable;
    }
    if (typeof isOnDuty === 'boolean') {
      person.availability.isOnDuty = isOnDuty;
    }
    await person.save();

    return {
      isAvailable: person.availability.isAvailable,
      isOnDuty: person.availability.isOnDuty,
    };
  }

  async getStats(userId) {
    const person = await this.resolvePersonByUserId(userId);
    const personId = person._id;
    const todayStart = moment().startOf('day').toDate();
    const todayEnd = moment().endOf('day').toDate();
    const weekStart = moment().startOf('week').toDate();

    const baseQuery = this.personDeliveryQuery(personId);

    const [todayTotal, completedToday, pendingToday, weekDeliveries] = await Promise.all([
      Delivery.countDocuments({
        ...baseQuery,
        'schedule.scheduledDate': { $gte: todayStart, $lte: todayEnd },
        status: { $nin: ['cancelled'] },
      }),
      Delivery.countDocuments({
        ...baseQuery,
        status: 'delivered',
        'tracking.actualArrival': { $gte: todayStart, $lte: todayEnd },
      }),
      Delivery.countDocuments({
        ...baseQuery,
        'schedule.scheduledDate': { $gte: todayStart, $lte: todayEnd },
        status: { $in: ['scheduled', 'batched', 'assigned', 'out_for_delivery', 'in_transit', 'reached'] },
      }),
      Delivery.find({
        ...baseQuery,
        status: 'delivered',
        'tracking.actualArrival': { $gte: weekStart },
      }).select('charges.totalCharge').lean(),
    ]);

    const thisWeekEarnings = weekDeliveries.reduce(
      (sum, d) => sum + (d.charges?.totalCharge || DELIVERY_EARNING_PER_STOP),
      0,
    );

    const perf = person.performance || {};
    const total = perf.totalDeliveries || 0;
    const completed = perf.completedDeliveries || 0;

    return {
      todayDeliveries: todayTotal,
      completedToday,
      pendingToday,
      activeDeliveries: pendingToday,
      totalEarnings: perf.totalEarnings || thisWeekEarnings,
      thisWeekEarnings,
      todayEarnings: completedToday * DELIVERY_EARNING_PER_STOP,
      rating: perf.averageRating || 0,
      onTimeRate: perf.onTimeRate || 0,
      totalDeliveries: total,
      acceptanceRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      avgDeliveryTime: 28,
      employeeId: person.employeeId,
      zone: person.zone,
    };
  }

  async getTodaysDeliveries(userId) {
    const person = await this.resolvePersonByUserId(userId);
    const todayStart = moment().startOf('day').toDate();
    const todayEnd = moment().endOf('day').toDate();

    const deliveries = await Delivery.find({
      ...this.personDeliveryQuery(person._id),
      'schedule.scheduledDate': { $gte: todayStart, $lte: todayEnd },
      status: { $nin: ['cancelled', 'failed'] },
    })
      .populate('address')
      .populate({ path: 'rental', select: 'rentalNumber' })
      .sort({ priority: -1, 'schedule.scheduledDate': 1 })
      .lean();

    return {
      deliveries: deliveries.map((d) => this.formatDeliveryForPartner(d)),
      count: deliveries.length,
    };
  }

  async getActiveDeliveries(userId) {
    const person = await this.resolvePersonByUserId(userId);

    const deliveries = await Delivery.find({
      ...this.personDeliveryQuery(person._id),
      status: { $in: ['assigned', 'out_for_delivery', 'in_transit', 'reached', 'batched'] },
    })
      .populate('address')
      .sort({ 'schedule.scheduledDate': 1 })
      .lean();

    return {
      deliveries: deliveries.map((d) => this.formatDeliveryForPartner(d)),
      count: deliveries.length,
    };
  }

  async getEarnings(userId, period = 'week') {
    const person = await this.resolvePersonByUserId(userId);
    let startDate = moment().startOf('week');

    if (period === 'month') startDate = moment().startOf('month');
    if (period === 'year') startDate = moment().startOf('year');

    const deliveries = await Delivery.find({
      ...this.personDeliveryQuery(person._id),
      status: 'delivered',
      'tracking.actualArrival': { $gte: startDate.toDate() },
    })
      .select('deliveryNumber tracking.actualArrival charges charges.totalCharge')
      .lean();

    const breakdown = deliveries.map((d) => ({
      deliveryNumber: d.deliveryNumber,
      date: d.tracking?.actualArrival,
      amount: d.charges?.totalCharge || DELIVERY_EARNING_PER_STOP,
    }));

    const total = breakdown.reduce((s, b) => s + b.amount, 0);

    return {
      period,
      total,
      breakdown,
      currency: 'INR',
    };
  }

  async getPerformance(userId, period = 'month') {
    const person = await this.resolvePersonByUserId(userId);
    const perf = person.performance || {};

    return {
      period,
      onTimeRate: perf.onTimeRate || 0,
      averageRating: perf.averageRating || 0,
      totalDeliveries: perf.totalDeliveries || 0,
      completedDeliveries: perf.completedDeliveries || 0,
      failedDeliveries: perf.failedDeliveries || 0,
      totalDistance: perf.totalDistance || 0,
      totalEarnings: perf.totalEarnings || 0,
    };
  }

  async getRecentActivity(userId, limit = 10) {
    const person = await this.resolvePersonByUserId(userId);

    const deliveries = await Delivery.find({
      ...this.personDeliveryQuery(person._id),
    })
      .populate('address')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    const activities = deliveries.flatMap((d) => {
      const customer =
        d.contact?.name ||
        d.address?.contactDetails?.name ||
        'Customer';
      const items = [];

      const lastTimeline = d.tracking?.timeline?.slice(-1)[0];
      if (lastTimeline) {
        items.push({
          id: `${d._id}-${lastTimeline.timestamp}`,
          action: this.timelineToAction(lastTimeline.status),
          customer,
          time: moment(lastTimeline.timestamp).format('hh:mm A'),
          earnings:
            lastTimeline.status === 'delivered'
              ? d.charges?.totalCharge || DELIVERY_EARNING_PER_STOP
              : undefined,
          rating: d.feedback?.rating,
          status: this.timelineToStatus(lastTimeline.status),
          deliveryNumber: d.deliveryNumber,
        });
      } else {
        items.push({
          id: `${d._id}-created`,
          action: `Delivery ${d.status}`,
          customer,
          time: moment(d.updatedAt).format('hh:mm A'),
          status: 'pending',
          deliveryNumber: d.deliveryNumber,
        });
      }
      return items;
    });

    return { activities: activities.slice(0, limit) };
  }

  timelineToAction(status) {
    const map = {
      assigned: 'Assigned new delivery',
      out_for_delivery: 'Started delivery',
      in_transit: 'In transit',
      reached: 'Reached location',
      delivered: 'Completed delivery',
      failed: 'Delivery failed',
      scheduled: 'Delivery scheduled',
    };
    return map[status] || `Delivery ${status}`;
  }

  timelineToStatus(status) {
    if (status === 'delivered') return 'success';
    if (status === 'failed') return 'warning';
    if (['assigned', 'scheduled'].includes(status)) return 'warning';
    return 'pending';
  }
}

module.exports = new DeliveryPartnerService();
