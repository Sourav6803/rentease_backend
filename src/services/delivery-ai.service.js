const { DeliveryPerson, Delivery, Address } = require('../models');
const logger = require('../config/logger');
const {
  DEFAULT_WEIGHTS,
  distanceKm,
  computeScore,
  formatPersonSuggestion,
  getEligibility,
} = require('../utils/delivery-assignment.utils');

class DeliveryAIService {
  constructor() {
    this.weights = { ...DEFAULT_WEIGHTS };
  }

  _scheduledReferenceDate(delivery) {
    const base = delivery.schedule?.scheduledDate || delivery.schedule?.requestedDate;
    const date = base ? new Date(base) : new Date();
    const slot = delivery.schedule?.scheduledSlot;
    if (slot?.start) {
      const [h, m] = String(slot.start).split(':').map(Number);
      if (!Number.isNaN(h)) {
        date.setHours(h, m || 0, 0, 0);
      }
    }
    return date;
  }

  async _loadDeliveryContext(deliveryId) {
    const delivery = await Delivery.findById(deliveryId).lean();
    if (!delivery) {
      throw new Error('Delivery not found');
    }
    const address = await Address.findById(delivery.address).lean();
    if (!address) {
      throw new Error('Delivery address not found');
    }
    if (!address.pincode) {
      throw new Error('Delivery address missing pincode');
    }
    return { delivery, address };
  }

  async _findCandidatePersons(pincode) {
    return DeliveryPerson.find({
      'status.isActive': true,
      'status.verificationStatus': 'verified',
      $or: [{ serviceablePincodes: pincode }, { zone: 'all' }],
    })
      .populate('user', 'profile.firstName profile.lastName phone email')
      .lean();
  }

  /**
   * Full ranked list with eligible + ineligible (for admin transparency).
   */
  async getRankedSuggestions(deliveryId, options = {}) {
    const { delivery, address } = await this._loadDeliveryContext(deliveryId);
    const scheduledAt = this._scheduledReferenceDate(delivery);
    const pincode = address.pincode;
    const addressCoords = address.coordinates?.coordinates;
    const limit = options.limit ?? 10;
    const minScoreThreshold = options.minScoreThreshold ?? 0;

    const candidates = await this._findCandidatePersons(pincode);

    const scored = candidates.map((person) => {
      const personCoords = person.availability?.currentLocation?.coordinates;
      const dist = distanceKm(personCoords, addressCoords);

      const scoreResult = computeScore(person, {
        pincode,
        scheduledAt,
        distanceKm: dist,
        weights: this.weights,
        additionalStops: options.additionalStops || 0,
      });

      return formatPersonSuggestion(person, scoreResult, 0);
    });

    scored.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    });

    scored.forEach((row, i) => {
      row.rank = i + 1;
    });

    const qualified = scored.filter((s) => s.eligible && s.score >= minScoreThreshold);
    const ineligible = scored.filter((s) => !s.eligible);

    return {
      deliveryId,
      pincode,
      scheduledAt,
      bestMatch: qualified[0] || null,
      suggestions: scored.slice(0, limit),
      qualified,
      ineligible,
      meta: {
        totalCandidates: candidates.length,
        qualifiedCount: qualified.length,
        weights: this.weights,
      },
    };
  }

  async calculateSmartScore(deliveryPerson, delivery, trafficData = null) {
    const address = await Address.findById(delivery.address);
    const scheduledAt = this._scheduledReferenceDate(delivery);
    const dist = distanceKm(
      deliveryPerson.availability?.currentLocation?.coordinates,
      address?.coordinates?.coordinates,
    );

    const scoreResult = computeScore(deliveryPerson, {
      pincode: address?.pincode,
      scheduledAt,
      distanceKm: dist,
      weights: this.weights,
    });

    if (trafficData?.[deliveryPerson._id]) {
      const factor = Math.max(0, 100 - trafficData[deliveryPerson._id].congestion * 2);
      scoreResult.score = Math.round(scoreResult.score * (factor / 100));
    }

    return {
      score: scoreResult.score,
      breakdown: scoreResult.breakdown,
      distance: scoreResult.distanceKm,
      eta: scoreResult.etaMinutes,
      eligible: scoreResult.eligible,
      reasons: scoreResult.reasons,
    };
  }

  async calculateDistance(deliveryPerson, delivery) {
    const address = await Address.findById(delivery.address);
    const dist = distanceKm(
      deliveryPerson.availability?.currentLocation?.coordinates,
      address?.coordinates?.coordinates,
    );
    return dist == null ? 10 : dist;
  }

  async calculateETA(distance, trafficData = null) {
    const avgSpeed = trafficData ? 25 : 30;
    return Math.round((distance / avgSpeed) * 60);
  }

  async isWithinShiftTime(deliveryPerson, referenceDate = new Date()) {
    const { getEligibility: ge } = require('../utils/delivery-assignment.utils');
    return ge(deliveryPerson, { pincode: '000000', scheduledAt: referenceDate }).eligible;
  }

  async findBestDeliveryPerson(deliveryId, options = {}) {
    const result = await this.getRankedSuggestions(deliveryId, {
      minScoreThreshold: options.minScoreThreshold ?? 60,
      limit: options.limit ?? 20,
      additionalStops: options.additionalStops || 0,
    });

    return {
      bestMatch: result.bestMatch
        ? {
            person: await DeliveryPerson.findById(result.bestMatch.personId).populate(
              'user',
              'profile.firstName profile.lastName phone',
            ),
            score: result.bestMatch.score,
            eta: result.bestMatch.etaMinutes,
            distance: result.bestMatch.distanceKm,
          }
        : null,
      alternatives: result.qualified.slice(1, 4),
      allScores: result.qualified,
      ineligible: result.ineligible,
    };
  }

  async autoAssignDelivery(deliveryId, options = {}) {
    const result = await this.findBestDeliveryPerson(deliveryId, options);

    if (result.bestMatch?.person) {
      const { person, score, eta, distance } = result.bestMatch;

      const DeliveryPersonnelService = require('./delivery-personnel.service');
      await DeliveryPersonnelService.assignDeliveryToPersonnel(deliveryId, {
        type: 'person',
        personId: person._id,
        notes: `AI Auto-assigned score ${score}%, ETA ${eta} min`,
        assignedBy: options.assignedBy || null,
      });

      return {
        assigned: true,
        assignedTo: person,
        score,
        eta,
        distance,
        alternatives: result.alternatives,
      };
    }

    return {
      assigned: false,
      reason: 'No suitable delivery person found',
      suggestions: result.allScores.slice(0, 5),
      ineligible: result.ineligible?.slice(0, 5),
    };
  }

  async batchAutoAssignDeliveries(deliveryIds, options = {}) {
    const assignedDeliveries = [];
    const failedDeliveries = [];

    for (const deliveryId of deliveryIds) {
      try {
        const result = await this.autoAssignDelivery(deliveryId, options);
        if (result.assigned) {
          assignedDeliveries.push({ deliveryId, assignedTo: result.assignedTo, score: result.score });
        } else {
          failedDeliveries.push({ deliveryId, reason: result.reason });
        }
      } catch (error) {
        failedDeliveries.push({ deliveryId, reason: error.message });
      }
    }

    return {
      total: deliveryIds.length,
      assigned: assignedDeliveries.length,
      failed: failedDeliveries.length,
      assignedDeliveries,
      failedDeliveries,
    };
  }

  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const { haversineKm } = require('../utils/delivery-assignment.utils');
    return haversineKm(lat1, lon1, lat2, lon2);
  }

  async optimizeRoute(deliveryPersonId, deliveryIds) {
    const person = await DeliveryPerson.findById(deliveryPersonId);
    const deliveries = await Delivery.find({ _id: { $in: deliveryIds } }).populate('address');

    const startPoint = person.availability.currentLocation?.coordinates || [0, 0];
    const locations = deliveries.map((delivery) => ({
      id: delivery._id,
      coordinates: delivery.address?.coordinates?.coordinates || [0, 0],
      address: delivery.address,
    }));

    const optimizedOrder = [];
    let currentPoint = startPoint;
    const remaining = [...locations];

    while (remaining.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const d = this.calculateHaversineDistance(
          currentPoint[1],
          currentPoint[0],
          remaining[i].coordinates[1],
          remaining[i].coordinates[0],
        );
        if (d < nearestDistance) {
          nearestDistance = d;
          nearestIndex = i;
        }
      }

      optimizedOrder.push(remaining[nearestIndex]);
      currentPoint = remaining[nearestIndex].coordinates;
      remaining.splice(nearestIndex, 1);
    }

    let totalDistance = 0;
    currentPoint = startPoint;
    for (const stop of optimizedOrder) {
      totalDistance += this.calculateHaversineDistance(
        currentPoint[1],
        currentPoint[0],
        stop.coordinates[1],
        stop.coordinates[0],
      );
      currentPoint = stop.coordinates;
    }

    return {
      optimizedOrder: optimizedOrder.map((stop, index) => ({
        sequence: index + 1,
        deliveryId: stop.id,
        address: stop.address,
      })),
      totalDistance: Math.round(totalDistance * 10) / 10,
      estimatedTime: Math.round((totalDistance / 30) * 60),
      startPoint,
    };
  }
}

module.exports = new DeliveryAIService();
