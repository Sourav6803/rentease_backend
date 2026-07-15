const mongoose = require('mongoose');
const moment = require('moment');
const {
  Delivery,
  Rental,
  Address,
  DeliveryPerson,
  DispatchBatch,
} = require('../models');
const { AppError } = require('../utils/AppError');
const logger = require('../config/logger');
const DeliveryAIService = require('./delivery-ai.service');
const DeliveryPersonnelService = require('./delivery-personnel.service');
const {
  slotBucketFromDelivery,
  deliveriesShareCompatibleSlot,
} = require('../utils/delivery-assignment.utils');

const ASSIGNABLE_STATUSES = ['scheduled', 'batched'];
const POOL_STATUSES = ['scheduled', 'batched'];

class DispatchService {
  /**
   * Deliveries waiting for assignment (not on active batch, no person).
   */
  async getDispatchPool(page = 1, limit = 20, filters = {}) {
    const skip = (page - 1) * limit;
    const query = {
      status: { $in: POOL_STATUSES },
      $or: [
        { assignedDeliveryPerson: null },
        { assignedDeliveryPerson: { $exists: false } },
      ],
    };

    if (filters.inBatch === 'true') {
      delete query.$or;
      query.dispatchBatch = { $ne: null };
    } else {
      query.$and = [
        {
          $or: [
            { dispatchBatch: null },
            { dispatchBatch: { $exists: false } },
          ],
        },
      ];
    }

    if (filters.priority) query.priority = filters.priority;
    if (filters.type) query.type = filters.type;
    if (filters.pincode) {
      const addressIds = await Address.find({ pincode: filters.pincode }).distinct('_id');
      query.address = { $in: addressIds };
    }
    if (filters.vendorId) {
      const rentalIds = await Rental.find({ vendor: filters.vendorId }).distinct('_id');
      query.rental = { $in: rentalIds };
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
          select: 'rentalNumber user vendor status rentalDetails',
          populate: [
            { path: 'user', select: 'profile.firstName profile.lastName phone email' },
            { path: 'vendor', select: 'business.name' },
          ],
        })
        .populate('address')
        .populate({ path: 'items.product', select: 'basicInfo.name' })
        .sort({ priority: -1, 'schedule.scheduledDate': 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Delivery.countDocuments(query),
    ]);

    const includeSuggestions = filters.includeSuggestions === true
      || filters.includeSuggestions === 'true';

    let enriched = deliveries.map((d) => this._mapPoolItem(d));

    console.log('enriched-->', enriched)

    if (includeSuggestions && enriched.length > 0) {
      enriched = await Promise.all(
        enriched.map(async (item) => {
          const suggestions = await DeliveryAIService.getRankedSuggestions(
            item._id,
            { minScoreThreshold: 0, limit: 5 },
          );
          return { ...item, topSuggestions: suggestions.suggestions };
        }),
      );
    }

    return {
      deliveries: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    };
  }

  _mapPoolItem(delivery) {
    const pincode = delivery.address?.pincode;
    const slot = delivery.schedule?.scheduledSlot;
    return {
      ...delivery,
      assignmentStatus: delivery.assignedDeliveryPerson || delivery.deliveryPerson
        ? 'assigned'
        : 'unassigned',
      addressSummary: this._addressSummary(delivery.address),
      pincode,
      slotBucket: slotBucketFromDelivery(delivery),
      scheduledSlotLabel:
        slot?.label || (slot?.start && slot?.end ? `${slot.start} - ${slot.end}` : null),
      itemCount: delivery.items?.length || 0,
    };
  }

  _addressSummary(address) {
    if (!address) return null;
    return [address.addressLine1, address.city, address.state, address.pincode]
      .filter(Boolean)
      .join(', ');
  }

  /**
   * Ranked personnel for one delivery (admin UI).
   */
  async getSuggestionsForDelivery(deliveryId, options = {}) {
    return DeliveryAIService.getRankedSuggestions(deliveryId, options);
  }

  /**
   * Create batch from delivery IDs.
   */
  async createBatch(deliveryIds, createdBy, metadata = {}) {
    if (!deliveryIds?.length) {
      throw new AppError('At least one delivery is required', 400);
    }

    const uniqueIds = [...new Set(deliveryIds.map(String))];
    const deliveries = await Delivery.find({ _id: { $in: uniqueIds } }).populate('address');

    if (deliveries.length !== uniqueIds.length) {
      throw new AppError('One or more deliveries not found', 404);
    }

    for (const d of deliveries) {
      if (!ASSIGNABLE_STATUSES.includes(d.status)) {
        throw new AppError(
          `Delivery ${d.deliveryNumber} cannot be batched (status: ${d.status})`,
          400,
        );
      }
      if (d.assignedDeliveryPerson || d.deliveryPerson) {
        throw new AppError(
          `Delivery ${d.deliveryNumber} is already assigned to personnel`,
          400,
        );
      }
      if (d.dispatchBatch) {
        const existing = await DispatchBatch.findById(d.dispatchBatch);
        if (existing && !['cancelled', 'completed'].includes(existing.status)) {
          throw new AppError(
            `Delivery ${d.deliveryNumber} is already in batch ${existing.batchNumber}`,
            400,
          );
        }
      }
    }

    const slotCheck = deliveriesShareCompatibleSlot(deliveries);
    if (!slotCheck.ok) {
      throw new AppError(slotCheck.reason, 400);
    }

    const dispatchDate =
      deliveries[0].schedule?.scheduledDate ||
      deliveries[0].schedule?.requestedDate ||
      new Date();

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const batchNumber = await DispatchBatch.generateBatchNumber();
      const stops = deliveries.map((d, index) => ({
        delivery: d._id,
        sequence: index + 1,
        status: 'pending',
      }));

      const [batch] = await DispatchBatch.create(
        [
          {
            batchNumber,
            zone: metadata.zone || 'all',
            slotBucket: slotBucketFromDelivery(deliveries[0]),
            dispatchDate: moment(dispatchDate).startOf('day').toDate(),
            status: 'open',
            stops,
            metadata: { createdBy, notes: metadata.notes, tags: metadata.tags || [] },
          },
        ],
        { session },
      );

      await Delivery.updateMany(
        { _id: { $in: uniqueIds } },
        {
          $set: {
            dispatchBatch: batch._id,
            status: 'batched',
          },
        },
        { session },
      );

      await session.commitTransaction();

      return await DispatchBatch.findById(batch._id)
        .populate({
          path: 'stops.delivery',
          populate: [{ path: 'rental', select: 'rentalNumber' }, { path: 'address' }],
        })
        .lean();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Assign entire batch to one delivery person.
   */
  async assignBatch(batchId, assignData) {
    const { personId, type = 'person', notes, assignedBy, force = false } = assignData;

    const batch = await DispatchBatch.findById(batchId);
    if (!batch) throw new AppError('Dispatch batch not found', 404);
    if (['completed', 'cancelled'].includes(batch.status)) {
      throw new AppError(`Batch is ${batch.status}`, 400);
    }

    const deliveryIds = batch.stops.map((s) => s.delivery);

    if (type !== 'person') {
      throw new AppError('Only person batch assignment is supported currently', 501);
    }
    if (!personId) throw new AppError('personId is required', 400);

    const person = await DeliveryPerson.findById(personId);
    if (!person) throw new AppError('Delivery person not found', 404);

    const deliveries = await Delivery.find({ _id: { $in: deliveryIds } }).populate('address');
    const activeCount = person.currentAssignments.filter(
      (a) => a.status === 'assigned' || a.status === 'started',
    ).length;

    if (activeCount + deliveryIds.length > person.maxConcurrentDeliveries && !force) {
      throw new AppError(
        `Partner cannot take ${deliveryIds.length} stops (capacity ${person.maxConcurrentDeliveries})`,
        400,
      );
    }

    const results = [];
    for (let i = 0; i < deliveryIds.length; i++) {
      const stop = batch.stops[i];
      const delivery = await DeliveryPersonnelService.assignDeliveryToPersonnel(deliveryIds[i], {
        type: 'person',
        personId,
        notes: notes || `Batch ${batch.batchNumber} · stop ${stop?.sequence || i + 1}`,
        assignedBy,
        force,
        skipAvailabilityCheck: force,
      });
      await Delivery.findByIdAndUpdate(deliveryIds[i], {
        stopSequence: stop?.sequence ?? i + 1,
        dispatchBatch: batch._id,
      });
      results.push(delivery);
    }

    batch.assignedPerson = personId;
    batch.status = 'assigned';
    await batch.save();

    return {
      batch: await DispatchBatch.findById(batchId)
        .populate('assignedPerson')
        .populate({ path: 'stops.delivery', populate: 'address' })
        .lean(),
      assignments: results,
    };
  }

  /**
   * Manual single delivery assign (delegates with validation).
   */
  async assignSingleDelivery(deliveryId, assignData) {
    const delivery = await Delivery.findById(deliveryId);
    if (!delivery) throw new AppError('Delivery not found', 404);

    if (!ASSIGNABLE_STATUSES.includes(delivery.status)) {
      throw new AppError(`Cannot assign delivery in status: ${delivery.status}`, 400);
    }

    if (
      delivery.assignedDeliveryPerson &&
      String(delivery.assignedDeliveryPerson) !== String(assignData.personId) &&
      !assignData.force
    ) {
      throw new AppError('Delivery already assigned. Use force:true to reassign.', 409);
    }

    if (delivery.dispatchBatch) {
      const batch = await DispatchBatch.findById(delivery.dispatchBatch);
      if (batch && batch.status === 'assigned') {
        throw new AppError('Remove from batch before reassigning individual stop', 400);
      }
    }

    return DeliveryPersonnelService.assignDeliveryToPersonnel(deliveryId, assignData);
  }

  async listBatches(filters = {}, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const query = {};
    if (filters.status) query.status = filters.status;
    if (filters.date) {
      const start = moment(filters.date).startOf('day').toDate();
      const end = moment(filters.date).endOf('day').toDate();
      query.dispatchDate = { $gte: start, $lte: end };
    }

    const [batches, total] = await Promise.all([
      DispatchBatch.find(query)
        .populate('assignedPerson')
        .populate({ path: 'stops.delivery', select: 'deliveryNumber status schedule' })
        .sort({ dispatchDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DispatchBatch.countDocuments(query),
    ]);

    return {
      batches,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 0 },
    };
  }

  async cancelBatch(batchId, adminId) {
    const batch = await DispatchBatch.findById(batchId);
    if (!batch) throw new AppError('Batch not found', 404);
    if (['completed', 'in_progress'].includes(batch.status)) {
      throw new AppError('Cannot cancel batch in current status', 400);
    }

    const deliveryIds = batch.stops.map((s) => s.delivery);
    await Delivery.updateMany(
      { _id: { $in: deliveryIds }, status: 'batched' },
      { $set: { status: 'scheduled', dispatchBatch: null, stopSequence: null } },
    );
    batch.status = 'cancelled';
    batch.metadata = batch.metadata || {};
    batch.metadata.cancelledBy = adminId;
    await batch.save();
    return batch;
  }
}

module.exports = new DispatchService();
