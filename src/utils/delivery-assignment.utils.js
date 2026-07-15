/**
 * Pure helpers for delivery personnel scoring & eligibility (unit-testable).
 */

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const DEFAULT_WEIGHTS = {
  distance: 0.35,
  workload: 0.25,
  rating: 0.2,
  onTimeRate: 0.15,
  battery: 0.05,
};

function haversineKm(lat1, lon1, lat2, lon2) {
  if (
    lat1 == null ||
    lon1 == null ||
    lat2 == null ||
    lon2 == null ||
    (lat1 === 0 && lon1 === 0) ||
    (lat2 === 0 && lon2 === 0)
  ) {
    return null;
  }

  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':').map(Number);
  if (Number.isNaN(parts[0])) return null;
  return parts[0] * 60 + (parts[1] || 0);
}

function isWorkingDay(person, date = new Date()) {
  const workingDays = person?.availability?.shifts?.workingDays;
  if (!workingDays?.length) return true;
  return workingDays.includes(DAY_NAMES[date.getDay()]);
}

/**
 * Shift check against a reference datetime (scheduled slot), not only "now".
 */
function isWithinShift(person, referenceDate = new Date()) {
  if (!isWorkingDay(person, referenceDate)) {
    return { ok: false, reason: 'Not a working day for this partner' };
  }

  const start = parseTimeToMinutes(person?.availability?.shifts?.start);
  const end = parseTimeToMinutes(person?.availability?.shifts?.end);
  if (start == null || end == null) {
    return { ok: true };
  }

  const refMinutes = referenceDate.getHours() * 60 + referenceDate.getMinutes();
  if (refMinutes < start || refMinutes > end) {
    return { ok: false, reason: 'Outside partner shift hours for scheduled time' };
  }

  return { ok: true };
}

function coversPincode(person, pincode) {
  if (!pincode) return { ok: false, reason: 'Delivery address has no pincode' };
  if (person?.zone === 'all') return { ok: true };
  const list = person?.serviceablePincodes || [];
  if (list.includes(pincode)) return { ok: true };
  return { ok: false, reason: `Pincode ${pincode} not in service area` };
}

function activeAssignmentCount(person) {
  const assignments = person?.currentAssignments || [];
  return assignments.filter((a) => a.status === 'assigned' || a.status === 'started').length;
}

function getEligibility(person, { pincode, scheduledAt = new Date(), additionalStops = 0 }) {
  const reasons = [];

  if (!person?.status?.isActive) reasons.push('Partner is inactive');
  if (person?.status?.verificationStatus !== 'verified') {
    reasons.push(`Verification status: ${person?.status?.verificationStatus || 'unknown'}`);
  }
  if (!person?.availability?.isAvailable) reasons.push('Marked unavailable');
  if (!person?.availability?.isOnDuty) reasons.push('Not on duty');

  const pincodeCheck = coversPincode(person, pincode);
  if (!pincodeCheck.ok) reasons.push(pincodeCheck.reason);

  const shiftCheck = isWithinShift(person, scheduledAt);
  if (!shiftCheck.ok) reasons.push(shiftCheck.reason);

  const load = activeAssignmentCount(person) + additionalStops;
  const max = person?.maxConcurrentDeliveries ?? 5;
  if (load >= max) {
    reasons.push(`At capacity (${load}/${max} active assignments)`);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    activeLoad: activeAssignmentCount(person),
    maxConcurrent: max,
  };
}

function distanceKm(personCoords, addressCoords) {
  if (!personCoords?.length || !addressCoords?.length) return null;
  return haversineKm(
    personCoords[1],
    personCoords[0],
    addressCoords[1],
    addressCoords[0],
  );
}

function computeScore(person, context = {}) {
  const {
    distanceKm: distKm,
    weights = DEFAULT_WEIGHTS,
    referenceDate = new Date(),
  } = context;

  const eligibility = getEligibility(person, context);
  if (!eligibility.eligible) {
    return {
      score: 0,
      eligible: false,
      reasons: eligibility.reasons,
      breakdown: {},
      distanceKm: distKm,
      etaMinutes: null,
    };
  }

  const max = person.maxConcurrentDeliveries || 5;
  const load = eligibility.activeLoad;
  const breakdown = {};

  const dist = distKm == null ? 8 : distKm;
  const distanceScore = Math.max(0, 100 - (dist / 5) * 20);
  breakdown.distance = Math.round(distanceScore * weights.distance);

  const workloadScore = Math.max(0, 100 - (load / max) * 100);
  breakdown.workload = Math.round(workloadScore * weights.workload);

  const rating = person.performance?.averageRating || 0;
  breakdown.rating = Math.round((rating / 5) * 100 * weights.rating);

  const onTime = person.performance?.onTimeRate || 0;
  breakdown.onTime = Math.round(onTime * weights.onTimeRate);

  let battery = 100;
  if (person.availability?.currentLocation?.battery != null) {
    battery = person.availability.currentLocation.battery;
  }
  breakdown.battery = Math.round(battery * weights.battery);

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const avgSpeed = 30;
  const etaMinutes = distKm != null ? Math.round((distKm / avgSpeed) * 60) : null;

  return {
    score: Math.round(score),
    eligible: true,
    reasons: [],
    breakdown,
    distanceKm: distKm == null ? null : Math.round(distKm * 10) / 10,
    etaMinutes,
    activeLoad: load,
    maxConcurrent: max,
  };
}

function formatPersonSuggestion(person, scoreResult, rank) {
  const user = person.user;
  const name = user?.profile
    ? `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim()
    : person.employeeId;

  return {
    rank,
    personId: person._id?.toString?.() || person._id,
    employeeId: person.employeeId,
    name: name || 'Delivery Partner',
    phone: user?.phone,
    vehicle: person.vehicle,
    zone: person.zone,
    score: scoreResult.score,
    eligible: scoreResult.eligible,
    reasons: scoreResult.reasons,
    breakdown: scoreResult.breakdown,
    distanceKm: scoreResult.distanceKm,
    etaMinutes: scoreResult.etaMinutes,
    activeLoad: scoreResult.activeLoad,
    maxConcurrent: scoreResult.maxConcurrent,
    serviceablePincodes: person.serviceablePincodes,
  };
}

function slotBucketFromDelivery(delivery) {
  const slot = delivery?.schedule?.scheduledSlot;
  const start = slot?.start;
  if (!start) return 'flexible';

  const hour = parseInt(String(start).split(':')[0], 10);
  if (Number.isNaN(hour)) return 'flexible';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function deliveriesShareCompatibleSlot(deliveries) {
  if (!deliveries?.length) return { ok: false, reason: 'No deliveries selected' };
  if (deliveries.length === 1) return { ok: true };

  const buckets = deliveries.map(slotBucketFromDelivery);
  const unique = [...new Set(buckets)];
  if (unique.length > 1 && !unique.includes('flexible')) {
    return {
      ok: false,
      reason: `Incompatible time slots: ${unique.join(', ')}`,
    };
  }

  const dates = deliveries.map((d) => {
    const dt = d.schedule?.scheduledDate || d.schedule?.requestedDate;
    return dt ? new Date(dt).toISOString().slice(0, 10) : null;
  });
  const uniqueDates = [...new Set(dates.filter(Boolean))];
  if (uniqueDates.length > 1) {
    return { ok: false, reason: 'Deliveries must share the same scheduled date' };
  }

  return { ok: true };
}

module.exports = {
  DAY_NAMES,
  DEFAULT_WEIGHTS,
  haversineKm,
  parseTimeToMinutes,
  isWorkingDay,
  isWithinShift,
  coversPincode,
  activeAssignmentCount,
  getEligibility,
  distanceKm,
  computeScore,
  formatPersonSuggestion,
  slotBucketFromDelivery,
  deliveriesShareCompatibleSlot,
};
