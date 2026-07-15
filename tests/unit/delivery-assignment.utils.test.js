const {
  haversineKm,
  getEligibility,
  computeScore,
  deliveriesShareCompatibleSlot,
  slotBucketFromDelivery,
  coversPincode,
  isWithinShift,
} = require('../../src/utils/delivery-assignment.utils');

const basePerson = () => ({
  status: { isActive: true, verificationStatus: 'verified' },
  availability: {
    isAvailable: true,
    isOnDuty: true,
    shifts: {
      start: '09:00',
      end: '18:00',
      workingDays: [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ],
    },
    currentLocation: { coordinates: [77.5946, 12.9716] },
  },
  serviceablePincodes: ['560001'],
  zone: 'central',
  maxConcurrentDeliveries: 5,
  currentAssignments: [],
  performance: { averageRating: 4.5, onTimeRate: 90 },
  employeeId: 'DLV001',
});

describe('delivery-assignment.utils', () => {
  test('haversineKm returns null for missing coordinates', () => {
    expect(haversineKm(0, 0, null, null)).toBeNull();
  });

  test('haversineKm calculates positive distance', () => {
    const d = haversineKm(12.97, 77.59, 12.98, 77.6);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(5);
  });

  test('coversPincode accepts listed pincode', () => {
    expect(coversPincode(basePerson(), '560001').ok).toBe(true);
  });

  test('coversPincode rejects unknown pincode when zone is not all', () => {
    expect(coversPincode(basePerson(), '110001').ok).toBe(false);
  });

  test('getEligibility fails when at capacity', () => {
    const person = basePerson();
    person.currentAssignments = Array(5).fill({ status: 'assigned' });
    const result = getEligibility(person, { pincode: '560001' });
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('capacity'))).toBe(true);
  });

  test('computeScore returns 0 when ineligible', () => {
    const person = basePerson();
    person.availability.isOnDuty = false;
    const score = computeScore(person, { pincode: '560001', distanceKm: 2 });
    expect(score.eligible).toBe(false);
    expect(score.score).toBe(0);
  });

  test('computeScore returns positive score when eligible', () => {
    const person = basePerson();
    const score = computeScore(person, {
      pincode: '560001',
      distanceKm: 2,
      scheduledAt: new Date('2026-05-18T10:00:00'),
    });
    expect(score.eligible).toBe(true);
    expect(score.score).toBeGreaterThan(0);
  });

  test('isWithinShift respects reference time inside shift', () => {
    const person = basePerson();
    const ref = new Date('2026-05-18T10:00:00');
    expect(isWithinShift(person, ref).ok).toBe(true);
  });

  test('isWithinShift fails outside shift hours', () => {
    const person = basePerson();
    const ref = new Date('2026-05-18T22:00:00');
    expect(isWithinShift(person, ref).ok).toBe(false);
  });

  test('slotBucketFromDelivery maps morning slot', () => {
    const bucket = slotBucketFromDelivery({
      schedule: { scheduledSlot: { start: '09:00', end: '12:00' } },
    });
    expect(bucket).toBe('morning');
  });

  test('deliveriesShareCompatibleSlot rejects mixed dates', () => {
    const result = deliveriesShareCompatibleSlot([
      { schedule: { scheduledDate: new Date('2026-05-18'), scheduledSlot: { start: '09:00' } } },
      { schedule: { scheduledDate: new Date('2026-05-19'), scheduledSlot: { start: '09:00' } } },
    ]);
    expect(result.ok).toBe(false);
  });

  test('deliveriesShareCompatibleSlot accepts same date morning slots', () => {
    const date = new Date('2026-05-18');
    const result = deliveriesShareCompatibleSlot([
      { schedule: { scheduledDate: date, scheduledSlot: { start: '09:00' } } },
      { schedule: { scheduledDate: date, scheduledSlot: { start: '10:00' } } },
    ]);
    expect(result.ok).toBe(true);
  });

  test('deliveriesShareCompatibleSlot rejects morning + evening', () => {
    const date = new Date('2026-05-18');
    const result = deliveriesShareCompatibleSlot([
      { schedule: { scheduledDate: date, scheduledSlot: { start: '09:00' } } },
      { schedule: { scheduledDate: date, scheduledSlot: { start: '18:00' } } },
    ]);
    expect(result.ok).toBe(false);
  });
});
