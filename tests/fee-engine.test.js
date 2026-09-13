/**
 * tests/fee-engine.test.js
 *
 * Exhaustive tests for src/utils/feeCalculator.js.
 *
 * Note on the runner: package.json declares jest (`npm test`), but jest is not
 * installed in this repo, so these use Node's built-in assert and run with
 * `node tests/fee-engine.test.js`. The structure (named cases + equality
 * assertions) maps 1:1 onto jest's describe/it/expect if it is ever installed.
 *
 * This module needs no database and no network, so it is safe to run anywhere.
 */
const assert = require('assert');
const fee = require('../src/utils/feeCalculator');

// ── tiny harness ──────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, message: error.message });
  }
}

function eq(actual, expected, label) {
  assert.strictEqual(
    actual,
    expected,
    `${label || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function deepEq(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, label);
}

// ── fixtures ──────────────────────────────────────────────────────────────────
const CATEGORY_A = '6a00000000000000000000a1';
const CATEGORY_B = '6a00000000000000000000b2';

const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

const settings = (over = {}) => ({
  defaultRate: 10,
  minRate: 5,
  maxRate: 25,
  type: 'percentage',
  platformFee: 0,
  platformFeeType: 'percentage',
  ...over,
});

// ═══ 1. Commission precedence — all five layers ══════════════════════════════

test('layer 1: vendor category specialRate wins over everything', () => {
  const r = fee.resolveCommission(
    {
      rate: 12,
      type: 'percentage',
      specialRates: [{ category: CATEGORY_A, rate: 7, validUntil: future }],
    },
    settings({ categoryRates: [{ categoryId: CATEGORY_A, rate: 20 }] }),
    { categoryId: CATEGORY_A, rentalCount: 9 },
  );
  eq(r.source, 'vendor_category', 'source');
  eq(r.rate, 7, 'rate');
});

test('layer 1: an EXPIRED specialRate is skipped and falls through to the vendor rate', () => {
  const r = fee.resolveCommission(
    {
      rate: 12,
      type: 'percentage',
      specialRates: [{ category: CATEGORY_A, rate: 1, validUntil: past }],
    },
    settings(),
    { categoryId: CATEGORY_A },
  );
  eq(r.source, 'vendor_rate', 'source');
  eq(r.rate, 12, 'rate');
});

test('layer 1: a specialRate for a DIFFERENT category is ignored', () => {
  const r = fee.resolveCommission(
    { rate: 12, type: 'percentage', specialRates: [{ category: CATEGORY_B, rate: 1 }] },
    settings(),
    { categoryId: CATEGORY_A },
  );
  eq(r.source, 'vendor_rate', 'source');
});

test('layer 1: specialRate with no validUntil never expires', () => {
  const r = fee.resolveCommission(
    { rate: 12, specialRates: [{ category: CATEGORY_A, rate: 4 }] },
    settings(),
    { categoryId: CATEGORY_A },
  );
  eq(r.source, 'vendor_category', 'source');
  eq(r.rate, 4, 'rate');
});

test('layer 2: vendor fixed type uses fixedAmount, not rate', () => {
  const r = fee.resolveCommission({ rate: 12, type: 'fixed', fixedAmount: 250 }, settings(), {});
  eq(r.source, 'vendor_fixed', 'source');
  eq(r.type, 'fixed', 'type');
  eq(r.fixedAmount, 250, 'fixedAmount');
});

test('layer 3: vendor rate beats a settings category rate', () => {
  const r = fee.resolveCommission(
    { rate: 12, type: 'percentage' },
    settings({ categoryRates: [{ categoryId: CATEGORY_A, rate: 20 }] }),
    { categoryId: CATEGORY_A },
  );
  eq(r.source, 'vendor_rate', 'source');
  eq(r.rate, 12, 'rate');
});

test('layer 4: settings category rate is used when the vendor has none', () => {
  const r = fee.resolveCommission({}, settings({ categoryRates: [{ categoryId: CATEGORY_A, rate: 18 }] }), {
    categoryId: CATEGORY_A,
  });
  eq(r.source, 'settings_category', 'source');
  eq(r.rate, 18, 'rate');
});

test('layer 4: settings categoryRates accepts the admin UI field name `categoryId`', () => {
  const r = fee.resolveCommission({}, settings({ categoryRates: [{ categoryId: CATEGORY_A, rate: 18 }] }), {
    categoryId: CATEGORY_A,
  });
  eq(r.rate, 18, 'rate from categoryId key');
});

test('layer 4: settings categoryRates also accepts the schema field name `category`', () => {
  const r = fee.resolveCommission({}, settings({ categoryRates: [{ category: CATEGORY_A, rate: 18 }] }), {
    categoryId: CATEGORY_A,
  });
  eq(r.rate, 18, 'rate from category key');
});

test('layer 5: settings tier is chosen by rental count', () => {
  const tiers = [
    { minRentals: 0, maxRentals: 5, rate: 15 },
    { minRentals: 6, maxRentals: 20, rate: 12 },
    { minRentals: 21, maxRentals: null, rate: 9 },
  ];
  eq(fee.resolveCommission({}, settings({ vendorTiers: tiers }), { rentalCount: 0 }).rate, 15, 'tier 1');
  eq(fee.resolveCommission({}, settings({ vendorTiers: tiers }), { rentalCount: 5 }).rate, 15, 'tier 1 upper bound');
  eq(fee.resolveCommission({}, settings({ vendorTiers: tiers }), { rentalCount: 6 }).rate, 12, 'tier 2');
  eq(fee.resolveCommission({}, settings({ vendorTiers: tiers }), { rentalCount: 50 }).rate, 9, 'open ended tier');
});

test('layer 5: tier is skipped when no rental count is supplied', () => {
  const r = fee.resolveCommission({}, settings({ vendorTiers: [{ minRentals: 0, maxRentals: 5, rate: 15 }] }), {});
  eq(r.source, 'settings_default', 'falls through to default');
});

test('layer 6: settings defaultRate is the last resort', () => {
  const r = fee.resolveCommission({}, settings(), {});
  eq(r.source, 'settings_default', 'source');
  eq(r.rate, 10, 'rate');
});

test('no configuration at all resolves to source "none" with a zero rate', () => {
  const r = fee.resolveCommission(undefined, undefined, {});
  eq(r.source, 'none', 'source');
  eq(r.rate, 0, 'rate');
});

// ═══ 2. Guardrails ══════════════════════════════════════════════════════════

test('settings rate below minRate is clamped up to the floor', () => {
  const r = fee.resolveCommission({}, settings({ defaultRate: 2, minRate: 5, maxRate: 25 }), {});
  eq(r.rate, 5, 'clamped to min');
});

test('settings rate above maxRate is clamped down to the ceiling', () => {
  const r = fee.resolveCommission({}, settings({ defaultRate: 90, minRate: 5, maxRate: 25 }), {});
  eq(r.rate, 25, 'clamped to max');
});

test('a vendor-level rate is NOT clamped: an explicit admin override is authoritative', () => {
  const r = fee.resolveCommission({ rate: 40, type: 'percentage' }, settings({ minRate: 5, maxRate: 25 }), {});
  eq(r.rate, 40, 'vendor rate passes through');
  eq(r.source, 'vendor_rate', 'source');
});

test('negative or nonsense rates become zero, never negative', () => {
  eq(fee.resolveCommission({ rate: -5 }, undefined, {}).rate, 0, 'negative rate');
  eq(fee.resolveCommission({ rate: 'abc' }, undefined, {}).rate, 0, 'NaN rate');
  eq(fee.clampRate(-10, 5, 25), 5, 'clampRate floors negatives to min');
});

// ═══ 3. Commission amount ════════════════════════════════════════════════════

test('percentage commission is amount x rate / 100', () => {
  eq(fee.commissionAmountFor(10000, { type: 'percentage', rate: 10 }), 1000, 'exact');
});

test('percentage commission rounds to 2 decimals on awkward inputs', () => {
  eq(fee.commissionAmountFor(3333.33, { type: 'percentage', rate: 10 }), 333.33, 'rounds down');
  eq(fee.commissionAmountFor(1234.56, { type: 'percentage', rate: 2.5 }), 30.86, 'rounds half-up');
});

test('fixed commission is capped at the base it is charged on', () => {
  eq(fee.commissionAmountFor(1000, { type: 'fixed', fixedAmount: 250 }), 250, 'normal');
  eq(fee.commissionAmountFor(100, { type: 'fixed', fixedAmount: 5000 }), 100, 'cannot exceed base');
});

test('a zero rate yields zero commission', () => {
  eq(fee.commissionAmountFor(10000, { type: 'percentage', rate: 0 }), 0, 'zero rate');
  eq(fee.commissionAmountFor(10000, null), 0, 'null resolution');
});

test('commission can never exceed the base even at 100 percent', () => {
  eq(fee.commissionAmountFor(10000, { type: 'percentage', rate: 100 }), 10000, 'at 100%');
  eq(fee.commissionAmountFor(10000, { type: 'percentage', rate: 250 }), 10000, 'above 100% clamps');
});

// ═══ 4. Period caps (the monthly cap bug) ════════════════════════════════════

test('remaining allowance shrinks as commission is already charged', () => {
  eq(fee.remainingCapAllowance([{ commission: 30000 }], 50000), 20000, 'partially used');
  eq(fee.remainingCapAllowance([{ commission: 50000 }], 50000), 0, 'fully used');
  eq(fee.remainingCapAllowance([{ commission: 60000 }], 50000), 0, 'never negative');
  eq(fee.remainingCapAllowance([], 0), Number.POSITIVE_INFINITY, 'no cap means unlimited');
});

test('applyPeriodCap reports the capped total across a period', () => {
  const under = fee.applyPeriodCap([{ commission: 100 }, { commission: 200 }], 50000);
  eq(under.capApplied, false, 'not applied');
  eq(under.cappedCommission, 300, 'total');

  const over = fee.applyPeriodCap([{ commission: 30000 }, { commission: 25000 }], 50000);
  eq(over.capApplied, true, 'applied');
  eq(over.totalCommission, 55000, 'uncapped total');
  eq(over.cappedCommission, 50000, 'capped total');
});

test('a monthly cap reduces the commission on a later charge in the same month', () => {
  const result = fee.calculatePaymentFees({
    baseAmount: 100000,
    vendorCommission: { rate: 10, type: 'percentage', monthlyCap: 12000 },
    monthCommissionBefore: 10000,
    settingsCommission: settings(),
  });
  // 10% of 100000 is 10000, but only 2000 of the 12000 cap is left.
  eq(result.commission, 2000, 'commission limited by remaining cap');
});

test('a yearly cap reduces the commission once the year is nearly used', () => {
  const result = fee.calculatePaymentFees({
    baseAmount: 100000,
    vendorCommission: { rate: 10, type: 'percentage', yearlyCap: 100000 },
    yearCommissionBefore: 99500,
    settingsCommission: settings(),
  });
  eq(result.commission, 500, 'commission limited by remaining yearly cap');
});

// ═══ 5. Full breakdown ══════════════════════════════════════════════════════

test('full split with commission, platform fee, tax and a capped convenience fee', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 10000,
    paymentType: 'rent',
    tenureMonths: 3,
    vendorCommission: { rate: 10, type: 'percentage' },
    settingsCommission: settings({ platformFee: 2, platformFeeType: 'percentage' }),
    tax: { enabled: true, rate: 18 },
    convenienceFee: { enabled: true, rate: 2, cap: 100 },
  });

  deepEq(
    {
      baseAmount: r.baseAmount,
      discount: r.discount,
      taxableAmount: r.taxableAmount,
      commissionSource: r.commissionSource,
      commissionRate: r.commissionRate,
      commission: r.commission,
      platformFee: r.platformFee,
      tax: r.tax,
      convenienceFee: r.convenienceFee,
      total: r.total,
      vendorNet: r.vendorNet,
      platformNet: r.platformNet,
    },
    {
      baseAmount: 10000,
      discount: 0,
      taxableAmount: 10000,
      commissionSource: 'vendor_rate',
      commissionRate: 10,
      commission: 1000,
      platformFee: 200,
      tax: 1800,
      convenienceFee: 100, // 2% of 10000 = 200, capped at 100
      total: 11900, // 10000 + 1800 tax + 100 fee
      vendorNet: 8800, // 10000 - 1000 - 200
      platformNet: 1300, // 1000 + 200 + 100, tax excluded
    },
    'breakdown',
  );
});

test('tax is excluded from platform profit because it is a pass-through', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 1000,
    vendorCommission: { rate: 0 },
    tax: { enabled: true, rate: 18 },
  });
  eq(r.tax, 180, 'tax charged');
  eq(r.platformNet, 0, 'platform earns nothing from tax');
});

test('disabled tax and convenience fee contribute exactly zero', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 1000,
    vendorCommission: { rate: 10 },
    tax: { enabled: false, rate: 18 },
    convenienceFee: { enabled: false, rate: 2, cap: 100 },
  });
  eq(r.tax, 0, 'no tax');
  eq(r.convenienceFee, 0, 'no convenience fee');
  eq(r.total, 1000, 'customer pays only the base');
});

test('a convenience fee below its cap is charged in full', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 1000,
    vendorCommission: { rate: 0 },
    convenienceFee: { enabled: true, rate: 2, cap: 100 },
  });
  eq(r.convenienceFee, 20, 'uncapped');
});

test('a six-month rent payment gets the long-tenure discount, and commission follows the discounted value', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 10000,
    paymentType: 'rent',
    tenureMonths: 6,
    vendorCommission: { rate: 10 },
    discount: { longTenureMonths: 6, longTenureRate: 5 },
  });
  eq(r.discount, 500, 'discount');
  eq(r.taxableAmount, 9500, 'taxable');
  eq(r.commission, 950, 'commission is on the discounted value');
});

test('the long-tenure discount does not apply to a security deposit', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 10000,
    paymentType: 'security_deposit',
    tenureMonths: 12,
    vendorCommission: { rate: 0 },
    discount: { longTenureMonths: 6, longTenureRate: 5 },
  });
  eq(r.discount, 0, 'no discount on a deposit');
});

test('a fixed platform fee is capped at the taxable value', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 500,
    vendorCommission: { rate: 0 },
    settingsCommission: settings({ platformFee: 2000, platformFeeType: 'fixed' }),
  });
  eq(r.platformFee, 500, 'capped at base');
  eq(r.vendorNet, 0, 'vendor net floors at zero');
});

// ═══ 6. Degenerate and hostile inputs ═══════════════════════════════════════

test('zero base produces an all-zero breakdown', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 0,
    vendorCommission: { rate: 10 },
    tax: { enabled: true, rate: 18 },
    convenienceFee: { enabled: true, rate: 2, cap: 100 },
  });
  eq(r.total, 0, 'total');
  eq(r.commission, 0, 'commission');
  eq(r.vendorNet, 0, 'vendorNet');
  eq(r.platformNet, 0, 'platformNet');
});

test('a negative base is treated as zero, never as a credit', () => {
  const r = fee.calculatePaymentFees({ baseAmount: -5000, vendorCommission: { rate: 10 } });
  eq(r.baseAmount, 0, 'base');
  eq(r.total, 0, 'total');
  eq(r.vendorNet, 0, 'vendorNet');
});

test('NaN and undefined amounts do not leak into the result', () => {
  const r = fee.calculatePaymentFees({ baseAmount: Number.NaN, vendorCommission: { rate: 10 } });
  eq(r.total, 0, 'total is a number');
  eq(r.commission, 0, 'commission is a number');
  assert.ok(Number.isFinite(r.vendorNet), 'vendorNet must be finite');
});

test('vendorNet never goes negative when deductions exceed the base', () => {
  const r = fee.calculatePaymentFees({
    baseAmount: 1000,
    vendorCommission: { rate: 50 }, // 500
    settingsCommission: settings({ platformFee: 800, platformFeeType: 'fixed' }),
  });
  eq(r.vendorNet, 0, 'floors at zero');
  eq(r.commission, 500, 'commission unchanged');
  eq(r.platformFee, 800, 'platform fee unchanged');
});

test('the customer total always equals taxable + tax + convenience fee', () => {
  const base = 4321.09;
  const r = fee.calculatePaymentFees({
    baseAmount: base,
    vendorCommission: { rate: 7.5 },
    settingsCommission: settings({ platformFee: 1.5 }),
    tax: { enabled: true, rate: 18 },
    convenienceFee: { enabled: true, rate: 1, cap: 50 },
  });
  eq(r.total, fee.roundMoney(r.taxableAmount + r.tax + r.convenienceFee), 'identity holds');
  assert.ok(r.total >= 0, 'total non-negative');
  assert.ok(r.vendorNet >= 0, 'vendorNet non-negative');
  assert.ok(r.platformNet >= 0, 'platformNet non-negative');
});

// ═══ 7. Refund splitting ════════════════════════════════════════════════════

test('a full refund reverses every component', () => {
  const breakdown = {
    total: 11900,
    commission: 1000,
    platformFee: 200,
    tax: 1800,
    convenienceFee: 100,
    vendorNet: 8800,
  };
  const r = fee.splitRefund(breakdown, 11900);
  eq(r.refund, 11900, 'refund');
  eq(r.commission, 1000, 'commission');
  eq(r.platformFee, 200, 'platformFee');
  eq(r.tax, 1800, 'tax');
  eq(r.convenienceFee, 100, 'convenienceFee');
  eq(r.vendorNet, 8800, 'vendorNet');
});

test('a partial refund reverses components proportionally', () => {
  const breakdown = {
    total: 11900,
    commission: 1000,
    platformFee: 200,
    tax: 1800,
    convenienceFee: 100,
    vendorNet: 8800,
  };
  const r = fee.splitRefund(breakdown, 5950); // exactly half
  eq(r.commission, 500, 'half commission');
  eq(r.vendorNet, 4400, 'half vendorNet');
});

test('a refund larger than the payment is clamped to the payment total', () => {
  const breakdown = { total: 1000, commission: 100, platformFee: 0, tax: 0, convenienceFee: 0, vendorNet: 900 };
  const r = fee.splitRefund(breakdown, 999999);
  eq(r.refund, 1000, 'clamped');
});

test('a zero or negative refund request yields nothing', () => {
  const breakdown = { total: 1000, commission: 100, vendorNet: 900 };
  eq(fee.splitRefund(breakdown, 0).refund, 0, 'zero');
  eq(fee.splitRefund(breakdown, -50).refund, 0, 'negative');
  eq(fee.splitRefund(null, 100).refund, 0, 'no breakdown');
});

// ═══ 8. Rounding contract ═══════════════════════════════════════════════════

test('roundMoney rounds half-up on paise', () => {
  eq(fee.roundMoney(1.005), 1.01, '1.005');
  eq(fee.roundMoney(1.004), 1, '1.004');
  eq(fee.roundMoney(11604.228), 11604.23, 'real value from the dev database');
  eq(fee.roundMoney('12.345'), 12.35, 'numeric string');
  eq(fee.roundMoney(Number.NaN), 0, 'NaN');
  eq(fee.roundMoney(Number.POSITIVE_INFINITY), 0, 'Infinity');
});

test('repeated percentage maths does not accumulate float drift', () => {
  let total = 0;
  for (let i = 0; i < 100; i += 1) {
    total = fee.roundMoney(total + fee.commissionAmountFor(10.1, { type: 'percentage', rate: 10 }));
  }
  eq(total, 101, '100 x 1.01 is exactly 101');
});

// ── report ────────────────────────────────────────────────────────────────────
console.log('');
console.log('  fee-engine.test.js');
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failures.length}`);
if (failures.length) {
  console.log('');
  failures.forEach((failure) => {
    console.log(`  x ${failure.name}`);
    console.log(`      ${failure.message}`);
  });
}
console.log('');

process.exit(failures.length > 0 ? 1 : 0);
