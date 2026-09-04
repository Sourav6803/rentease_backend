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

    // Slot can be:
    //   - object: { start: '11:00' } or { start: '3 PM' }
    //   - string: '2026-08-31T04:05:38.918Z|11 AM – 3 PM' (from checkout)
    //   - plain string: '11 AM – 3 PM'
    let rawStart = null;
    if (slot && typeof slot === 'object') {
      rawStart = slot.start != null ? String(slot.start) : null;
    } else if (typeof slot === 'string') {
      rawStart = slot.includes('|') ? (slot.split('|')[1] || slot) : slot;
    }

    let hour = null;
    let minute = 0;
    if (rawStart) {
      // 24h format first: "11:00" / "14:30"
      const hm = rawStart.match(/(\d{1,2}):(\d{2})/);
      const ampm = rawStart.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
      if (hm) {
        hour = parseInt(hm[1], 10);
        minute = parseInt(hm[2], 10);
      } else if (ampm) {
        let h = parseInt(ampm[1], 10) % 12;
        if (/PM/i.test(ampm[3])) h += 12;
        hour = h;
        minute = parseInt(ampm[2] || '0', 10);
      }
    }

    console.log('[DEBUG-AUTOASSIGN] 🕐 _scheduledReferenceDate | scheduledDate:', base,
      '| slot:', JSON.stringify(slot), '| parsed start:', rawStart,
      '| hour:', hour, 'minute:', minute);

    if (hour != null && !Number.isNaN(hour)) {
      // Interpret the slot hour as IST wall-clock and set it on the date.
      const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
      ist.setUTCHours(hour, minute, 0, 0);
      const ref = new Date(ist.getTime() - 5.5 * 60 * 60 * 1000);
      console.log('[DEBUG-AUTOASSIGN] 🕐 Reference (IST):',
        new Date(ref.getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16));
      return ref;
    }

    // Fallback: keep scheduledDate; isWithinShift evaluates it in IST.
    console.log('[DEBUG-AUTOASSIGN] 🕐 No slot time parsed — using scheduledDate raw.');
    return date;
  }

  async _loadDeliveryContext(deliveryId) {
    const delivery = await Delivery.findById(deliveryId).lean();
    if (!delivery) {
      console.log('[DEBUG-AUTOASSIGN] ❌ Delivery not found:', deliveryId);
      throw new Error('Delivery not found');
    }
    const address = await Address.findById(delivery.address).lean();
    if (!address) {
      console.log('[DEBUG-AUTOASSIGN] ❌ Address not found for delivery:', deliveryId);
      throw new Error('Delivery address not found');
    }
    if (!address.pincode) {
      console.log('[DEBUG-AUTOASSIGN] ❌ Address missing pincode:', address._id);
      throw new Error('Delivery address missing pincode');
    }
    console.log('[DEBUG-AUTOASSIGN] ✅ Context loaded | delivery:', delivery.deliveryNumber,
      '| status:', delivery.status, '| address pincode:', address.pincode);
    return { delivery, address };
  }

  async _findCandidatePersons(pincode) {
    console.log('[DEBUG-AUTOASSIGN] 🔍 Searching candidates for pincode:', pincode);
    const persons = await DeliveryPerson.find({
      'status.isActive': true,
      'status.verificationStatus': { $nin: ['rejected', 'suspended'] },
      $or: [{ serviceablePincodes: pincode }, { zone: 'all' }],
    })
      .populate('user', 'profile.firstName profile.lastName phone email')
      .lean();

    console.log('[DEBUG-AUTOASSIGN] 🔍 Candidates found for pincode', pincode, ':', persons.length,
      persons.map((p) => `{id:${p._id}, employeeId:${p.employeeId}, verified:${p.status?.verificationStatus}, active:${p.status?.isActive}, pincodes:${JSON.stringify(p.serviceablePincodes)}, zone:${p.zone}}`).join(' | ') || '(NONE — verification/pincode filter may be blocking)');
    return persons;
  }

  /**
   * Full ranked list with eligible + ineligible (for admin transparency).
   */
  async getRankedSuggestions(deliveryId, options = {}) {
    const { delivery, address } = await this._loadDeliveryContext(deliveryId);
    const scheduledAt = this._scheduledReferenceDate(delivery);
    const pincode = address.pincode;
    console.log('pincode-->>', pincode)
    const addressCoords = address.coordinates?.coordinates;
    console.log('addressCoords-->>', addressCoords)
    const limit = options.limit ?? 10;
    const minScoreThreshold = options.minScoreThreshold ?? 0;

    const candidates = await this._findCandidatePersons(pincode);
    console.log('candidates--->>', candidates)

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

      console.log('[DEBUG-AUTOASSIGN] 🧮 Candidate', person.employeeId,
        '| eligible:', scoreResult.eligible,
        '| score:', scoreResult.score,
        '| reasons:', JSON.stringify(scoreResult.reasons || []),
        '| distanceKm:', dist);

      return formatPersonSuggestion(person, scoreResult, 0);
    });

    console.log('scored-->>', scored)

    scored.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    });

    scored.forEach((row, i) => {
      row.rank = i + 1;
    });

    const qualified = scored.filter((s) => s.eligible && s.score >= minScoreThreshold);
    const ineligible = scored.filter((s) => !s.eligible);

    console.log('[DEBUG-AUTOASSIGN] 📊 Ranked: qualified:', qualified.length,
      '| ineligible:', ineligible.length,
      '| bestMatch:', qualified[0]
        ? `{id:${qualified[0].personId}, score:${qualified[0].score}}`
        : '❌ NONE — qualified list empty (see per-candidate reasons above)');

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
      // Threshold 0: eligibility gates (pincode/availability/shift/capacity)
      // already filtered candidates in computeScore — score is used for
      // RANKING only, not for blocking auto-assign. A hard threshold like 60
      // permanently blocks new riders (0 rating/on-time => max ~65 score).
      minScoreThreshold: options.minScoreThreshold ?? 0,
      limit: options.limit ?? 20,
      additionalStops: options.additionalStops || 0,
    });

    console.log('[DEBUG-AUTOASSIGN] 🎯 findBestDeliveryPerson | bestMatch personId:', result.bestMatch?.personId || 'NONE');

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
    console.log("result-->", result)

    if (result.bestMatch?.person) {
      const { person, score, eta, distance } = result.bestMatch;

      console.log('[DEBUG-AUTOASSIGN] ✅ Best match found | personId:', person._id,
        '| name:', person.user?.profile?.firstName, person.user?.profile?.lastName,
        '| score:', score, '| eta:', eta, 'min');

      try {
        const DeliveryPersonnelService = require('./delivery-personnel.service');
        const assignResult = await DeliveryPersonnelService.assignDeliveryToPersonnel(deliveryId, {
          type: 'person',
          personId: person._id,
          notes: `AI Auto-assigned score ${score}%, ETA ${eta} min`,
          assignedBy: options.assignedBy || null,
        });

        console.log('[DEBUG-AUTOASSIGN] ✅ assignDeliveryToPersonnel completed for delivery:', deliveryId,
          '| result status:', assignResult?.delivery?.status || 'OK');

        return {
          assigned: true,
          assignedTo: person,
          score,
          eta,
          distance,
          alternatives: result.alternatives,
        };
      } catch (assignError) {
        // Best match passed AI scoring but the final availability gate
        // (e.g. current-time shift check inside isAvailableForDelivery)
        // rejected it. Fall through to the Tier-2 fallback instead of
        // throwing — a paid order must never end up unassigned.
        console.log('[DEBUG-AUTOASSIGN] ⚠️ Best match assign FAILED:',
          assignError.message, '| falling back to Tier 2');
      }
    }

    // ---- Tier 2 fallback: assign ANY eligible available partner ----
    // AI scoring failed (no qualified candidate / edge case). We must NOT
    // leave a paid order unassigned, so fall back to a plain availability
    // query: active + not rejected/suspended + on duty + pincode coverage +
    // capacity. Least-loaded partner wins.
    if (options.allowFallback !== false) {
      try {
        const fallback = await this._fallbackAssignDelivery(deliveryId, options);
        if (fallback.assigned) return fallback;
        return {
          assigned: false,
          reason: fallback.reason || 'No eligible delivery person found',
          suggestions: result.allScores.slice(0, 5),
          ineligible: result.ineligible?.slice(0, 5),
        };
      } catch (fallbackError) {
        console.log('[DEBUG-AUTOASSIGN] ❌ Fallback assign failed:', fallbackError.message);
        return {
          assigned: false,
          reason: 'No suitable delivery person found',
          suggestions: result.allScores.slice(0, 5),
          ineligible: result.ineligible?.slice(0, 5),
          fallbackError: fallbackError.message,
        };
      }
    }

    return {
      assigned: false,
      reason: 'No suitable delivery person found',
      suggestions: result.allScores.slice(0, 5),
      ineligible: result.ineligible?.slice(0, 5),
    };
  }

  /**
   * Tier-2 fallback: find the least-loaded partner that is simply AVAILABLE
   * (isActive, not rejected/suspended, isAvailable, isOnDuty, covers pincode,
   * under maxConcurrent). Works even when the delivery time is outside shift
   * hours or address coordinates are missing — the only hard requirements are
   * pincode coverage + availability + capacity.
   */
  async _fallbackAssignDelivery(deliveryId, options = {}) {
    const { delivery, address } = await this._loadDeliveryContext(deliveryId);
    const pincode = address.pincode;

    console.log('[DEBUG-AUTOASSIGN] 🛟 FALLBACK: finding ANY available partner for pincode:', pincode);

    const persons = await DeliveryPerson.find({
      'status.isActive': true,
      'status.verificationStatus': { $nin: ['rejected', 'suspended'] },
      'availability.isAvailable': true,
      'availability.isOnDuty': true,
      $or: [{ serviceablePincodes: pincode }, { zone: 'all' }],
    })
      .select('employeeId user serviceablePincodes zone availability currentAssignments maxConcurrentDeliveries')
      .lean();

    console.log('[DEBUG-AUTOASSIGN] 🛟 Fallback candidates found:', persons.length);

    // Filter by capacity in memory (currentAssignments.length < maxConcurrent)
    const available = persons
      .filter((p) => (p.currentAssignments || []).length < (p.maxConcurrentDeliveries ?? 5))
      .sort(
        (a, b) =>
          (a.currentAssignments || []).length - (b.currentAssignments || []).length,
      );

    if (available.length === 0) {
      const reason = persons.length
        ? 'All matching partners are at capacity'
        : `No partner covers pincode ${pincode}`;
      console.log('[DEBUG-AUTOASSIGN] 🛟 Fallback failed:', reason);
      return { assigned: false, reason };
    }

    const partner = available[0];
    console.log('[DEBUG-AUTOASSIGN] 🛟 Fallback partner selected:', partner.employeeId, partner._id);

    const DeliveryPersonnelService = require('./delivery-personnel.service');
    // skipAvailabilityCheck: the fallback query already filtered on
    // isAvailable + isOnDuty + pincode + capacity, and the shift-time check
    // inside isAvailableForDelivery would re-reject the same candidates that
    // AI scoring rejected — defeating the fallback's purpose.
    const assignResult = await DeliveryPersonnelService.assignDeliveryToPersonnel(deliveryId, {
      type: 'person',
      personId: partner._id,
      notes: 'Fallback auto-assign (AI scoring failed, availability-based)',
      assignedBy: options.assignedBy || null,
      skipAvailabilityCheck: true,
    });

    console.log('[DEBUG-AUTOASSIGN] 🛟 Fallback assign completed | status:', assignResult?.delivery?.status || 'OK');

    return {
      assigned: true,
      assignedTo: partner,
      score: null,
      eta: null,
      distance: null,
      fallback: true,
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
