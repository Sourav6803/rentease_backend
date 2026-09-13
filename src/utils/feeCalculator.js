/**
 * utils/feeCalculator.js
 *
 * Pure money maths for the payment pipeline.
 *
 * Deliberately has NO requires: models (Vendor), services (payment, settlement)
 * and the test runner all need these functions, and requiring a service from a
 * model would create a cycle. Everything here is side-effect free and takes an
 * already-resolved config, so the caller decides where configuration comes from
 * (SystemSettings, env fallbacks, tests) and this module only does arithmetic.
 *
 * Money convention: amounts are rupee floats as stored by the rest of the app
 * (`rentalDetails.totalAmount` is a float). Intermediate rounding happens on
 * paise so 0.1 + 0.2 style drift cannot accumulate into a stored value.
 */

/** Commission can be expressed two ways. */
const COMMISSION_TYPES = ['percentage', 'fixed'];

/** Where a resolved commission rate came from — surfaced to the UI and ledger. */
const COMMISSION_SOURCES = [
  'vendor_category', // vendor.commission.specialRates matched the category
  'vendor_rate', // vendor.commission.rate (percentage)
  'vendor_fixed', // vendor.commission.fixedAmount
  'settings_category', // settings.commission.categoryRates matched
  'settings_tier', // settings.commission.vendorTiers matched the rental count
  'settings_default', // settings.commission.defaultRate
  'none', // nothing configured anywhere
];

/**
 * Round a rupee amount to 2 decimals, half-up.
 * Number.EPSILON nudges values like 1.005 that are stored a hair below.
 */
function roundMoney(value) {
  // Coerce like toPositive does: aggregation results and form input can arrive as
  // numeric strings, and rejecting them would silently produce a zero amount.
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

/** Coerce anything to a finite, non-negative number. */
function toPositive(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/** Clamp a rate into [min, max] when those bounds are configured. */
function clampRate(rate, minRate, maxRate) {
  let result = toPositive(rate);
  if (typeof minRate === 'number' && Number.isFinite(minRate) && result < minRate) {
    result = minRate;
  }
  if (typeof maxRate === 'number' && Number.isFinite(maxRate) && result > maxRate) {
    result = maxRate;
  }
  return result;
}

/**
 * Does a specialRates entry still apply?
 * A missing/`null` validUntil means "no expiry".
 */
function isSpecialRateActive(entry, now = new Date()) {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.validUntil) return true;
  const expiry = new Date(entry.validUntil);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() > now.getTime();
}

/** Does a tier apply to this rental count? `maxRentals: null` means open-ended. */
function doesTierMatch(tier, rentalCount) {
  if (!tier || typeof tier !== 'object') return false;
  const count = toPositive(rentalCount);
  const min = toPositive(tier.minRentals);
  const hasMax = typeof tier.maxRentals === 'number' && Number.isFinite(tier.maxRentals);
  if (count < min) return false;
  if (hasMax && count > tier.maxRentals) return false;
  return true;
}

/**
 * Resolve which commission applies, honouring the intended precedence:
 *
 *   1. vendor specialRates for this category (not expired)
 *   2. vendor fixedAmount            (when vendor type === 'fixed')
 *   3. vendor rate                   (when vendor type === 'percentage')
 *   4. settings categoryRates for this category
 *   5. settings vendorTiers for the vendor's rental count
 *   6. settings defaultRate
 *
 * A vendor-level value always wins over a settings-level one, because the vendor
 * record is the more specific override.
 *
 * @returns {{ rate: number, type: string, fixedAmount: number|null, source: string }}
 */
function resolveCommission(vendorCommission, settingsCommission, options = {}) {
  const vendor = vendorCommission || {};
  const settings = settingsCommission || {};
  const categoryId = options.categoryId ? String(options.categoryId) : null;
  const rentalCount = options.rentalCount;
  const now = options.now || new Date();

  // 1. vendor category override
  if (categoryId && Array.isArray(vendor.specialRates)) {
    const match = vendor.specialRates.find(
      (entry) => entry && entry.category && String(entry.category) === categoryId && isSpecialRateActive(entry, now),
    );
    if (match) {
      return {
        rate: toPositive(match.rate),
        type: 'percentage',
        fixedAmount: null,
        source: 'vendor_category',
      };
    }
  }

  // 2/3. vendor-level rate or fixed amount
  if (vendor.type === 'fixed' && vendor.fixedAmount !== undefined && vendor.fixedAmount !== null) {
    return {
      rate: 0,
      type: 'fixed',
      fixedAmount: toPositive(vendor.fixedAmount),
      source: 'vendor_fixed',
    };
  }
  if (vendor.rate !== undefined && vendor.rate !== null) {
    return {
      rate: toPositive(vendor.rate),
      type: COMMISSION_TYPES.includes(vendor.type) ? vendor.type : 'percentage',
      fixedAmount: null,
      source: 'vendor_rate',
    };
  }

  // 4. settings category rate
  if (categoryId && Array.isArray(settings.categoryRates)) {
    const match = settings.categoryRates.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      // The admin UI posts `categoryId`; the schema declares `category`. Accept
      // both so a saved value is not silently ignored.
      const key = entry.categoryId ?? entry.category;
      return key && String(key) === categoryId;
    });
    if (match) {
      return {
        rate: clampRate(match.rate, settings.minRate, settings.maxRate),
        type: 'percentage',
        fixedAmount: null,
        source: 'settings_category',
      };
    }
  }

  // 5. settings tier by rental count
  if (Array.isArray(settings.vendorTiers) && rentalCount !== undefined && rentalCount !== null) {
    const match = settings.vendorTiers.find((tier) => doesTierMatch(tier, rentalCount));
    if (match) {
      return {
        rate: clampRate(match.rate, settings.minRate, settings.maxRate),
        type: 'percentage',
        fixedAmount: null,
        source: 'settings_tier',
      };
    }
  }

  // 6. settings default
  if (settings.defaultRate !== undefined && settings.defaultRate !== null) {
    return {
      rate: clampRate(settings.defaultRate, settings.minRate, settings.maxRate),
      type: 'percentage',
      fixedAmount: null,
      source: 'settings_default',
    };
  }

  return { rate: 0, type: 'percentage', fixedAmount: null, source: 'none' };
}

/** Turn a resolved commission into an amount, in rupees, on the given base. */
function commissionAmountFor(baseAmount, resolved) {
  const base = toPositive(baseAmount);
  if (!resolved) return 0;
  if (resolved.type === 'fixed') return roundMoney(Math.min(toPositive(resolved.fixedAmount), base));
  const rate = toPositive(resolved.rate);
  if (rate <= 0) return 0;
  const raw = (base * rate) / 100;
  // A percentage commission can never exceed the base it is charged on.
  return roundMoney(Math.min(raw, base));
}

/** Percentage fee with an optional flat cap — used by the convenience fee. */
function percentageFee(baseAmount, rate, cap) {
  const base = toPositive(baseAmount);
  const computed = roundMoney((base * toPositive(rate)) / 100);
  const capValue = toPositive(cap);
  if (capValue > 0 && computed > capValue) return roundMoney(capValue);
  return computed;
}

/** Normalise the discount rules into a rupee figure. */
function resolveDiscount(baseAmount, paymentType, tenureMonths, discount) {
  const base = toPositive(baseAmount);
  const rules = discount || {};
  if (rules.disabled) return 0;

  // Long-tenure rent discount (the behaviour the old inline code had).
  if (rules.longTenureMonths > 0 && paymentType === 'rent') {
    const months = toPositive(tenureMonths);
    if (months >= rules.longTenureMonths && rules.longTenureRate > 0) {
      return roundMoney(Math.min((base * rules.longTenureRate) / 100, base));
    }
  }

  const flat = toPositive(rules.flatAmount);
  if (flat > 0) return roundMoney(Math.min(flat, base));

  return 0;
}

/**
 * The full split for one payment.
 *
 * Tax is charged to the customer and is a pass-through liability, so it is part
 * of `total` but excluded from `platformNet`. Commission is charged to the
 * vendor on the rental value (base minus discount), never on tax.
 *
 * @returns {object} every component plus the two nets. Never returns a negative
 *   `vendorNet`, and never lets `total` fall below zero.
 */
function calculatePaymentFees(input = {}) {
  const baseAmount = roundMoney(toPositive(input.baseAmount));

  const discount = resolveDiscount(
    baseAmount,
    input.paymentType,
    input.tenureMonths,
    input.discount,
  );
  const taxableAmount = roundMoney(Math.max(0, baseAmount - discount));

  const commissionConfig = input.settingsCommission || {};
  const taxConfig = input.tax || {};
  const feeConfig = input.convenienceFee || {};

  // ── vendor-side deductions ─────────────────────────────────────────────────
  const resolved = resolveCommission(input.vendorCommission, commissionConfig, {
    categoryId: input.categoryId,
    rentalCount: input.rentalCount,
    now: input.now,
  });

  let commission = commissionAmountFor(taxableAmount, resolved);

  // Per-vendor monthly/yearly caps apply on top of the per-transaction figure.
  const monthlyCap = toPositive(input.vendorCommission?.monthlyCap);
  if (monthlyCap > 0 && input.monthCommissionBefore !== undefined) {
    const alreadyCharged = toPositive(input.monthCommissionBefore);
    const remaining = Math.max(0, monthlyCap - alreadyCharged);
    commission = roundMoney(Math.min(commission, remaining));
  }
  const yearlyCap = toPositive(input.vendorCommission?.yearlyCap);
  if (yearlyCap > 0 && input.yearCommissionBefore !== undefined) {
    const alreadyCharged = toPositive(input.yearCommissionBefore);
    const remaining = Math.max(0, yearlyCap - alreadyCharged);
    commission = roundMoney(Math.min(commission, remaining));
  }
  commission = roundMoney(Math.min(commission, taxableAmount));

  const platformFeeType = commissionConfig.platformFeeType === 'fixed' ? 'fixed' : 'percentage';
  const platformFeeRaw = toPositive(commissionConfig.platformFee);
  const platformFee =
    platformFeeType === 'fixed'
      ? roundMoney(Math.min(platformFeeRaw, taxableAmount))
      : percentageFee(taxableAmount, platformFeeRaw, 0);

  // ── customer-side additions ────────────────────────────────────────────────
  const taxEnabled = taxConfig.enabled === true;
  const tax = taxEnabled ? percentageFee(taxableAmount, taxConfig.rate, 0) : 0;

  const feeEnabled = feeConfig.enabled === true;
  const convenienceFee = feeEnabled ? percentageFee(taxableAmount, feeConfig.rate, feeConfig.cap) : 0;

  // ── totals ────────────────────────────────────────────────────────────────
  const total = roundMoney(Math.max(0, taxableAmount + tax + convenienceFee));

  const vendorDeductions = roundMoney(commission + platformFee);
  // vendorNet can never go negative: deductions are clamped to the taxable value.
  const vendorNet = roundMoney(Math.max(0, taxableAmount - Math.min(vendorDeductions, taxableAmount)));

  // Tax is a pass-through, so it is not platform income.
  const platformNet = roundMoney(commission + platformFee + convenienceFee);

  return {
    baseAmount,
    discount,
    taxableAmount,
    commissionRate: resolved.type === 'fixed' ? null : roundMoney(resolved.rate),
    commissionType: resolved.type,
    commissionSource: resolved.source,
    commission,
    platformFee,
    platformFeeType,
    taxRate: taxEnabled ? toPositive(taxConfig.rate) : 0,
    tax,
    convenienceFee,
    total,
    vendorNet,
    platformNet,
  };
}

/**
 * Cap enforcement across a billing period.
 *
 * A monthly cap is a *period* limit, not a per-payment one: the old code applied
 * `Math.min(commission, monthlyCap)` to a single transaction, so a vendor with a
 * ₹50,000 monthly cap still paid ₹50,000 commission on one ₹10L rental and then
 * another ₹50,000 on the next.
 *
 * @param {Array<{amount:number, commission:number, at?:Date}>} entries charges in the period
 * @returns {{ totalCommission:number, cappedCommission:number, capApplied:boolean }}
 */
function applyPeriodCap(entries, cap) {
  const list = Array.isArray(entries) ? entries : [];
  const total = roundMoney(list.reduce((sum, entry) => sum + toPositive(entry?.commission), 0));
  const capValue = toPositive(cap);
  if (capValue <= 0 || total <= capValue) {
    return { totalCommission: total, cappedCommission: total, capApplied: false };
  }
  return { totalCommission: total, cappedCommission: roundMoney(capValue), capApplied: true };
}

/**
 * Given charges already recorded in a period, how much commission may still be
 * taken on a new charge before the cap is hit.
 */
function remainingCapAllowance(entries, cap) {
  const capValue = toPositive(cap);
  if (capValue <= 0) return Number.POSITIVE_INFINITY;
  const used = roundMoney(
    (Array.isArray(entries) ? entries : []).reduce(
      (sum, entry) => sum + toPositive(entry?.commission),
      0,
    ),
  );
  return roundMoney(Math.max(0, capValue - used));
}

/** Split a refund proportionally, so partial refunds reverse the right amounts. */
function splitRefund(breakdown, refundAmount) {
  const total = toPositive(breakdown?.total);
  const requested = Math.min(toPositive(refundAmount), total);
  if (total <= 0 || requested <= 0) {
    return { refund: 0, commission: 0, platformFee: 0, tax: 0, convenienceFee: 0, vendorNet: 0 };
  }
  const ratio = requested / total;
  const scale = (value) => roundMoney(toPositive(value) * ratio);

  return {
    refund: roundMoney(requested),
    commission: scale(breakdown.commission),
    platformFee: scale(breakdown.platformFee),
    tax: scale(breakdown.tax),
    convenienceFee: scale(breakdown.convenienceFee),
    vendorNet: scale(breakdown.vendorNet),
  };
}

module.exports = {
  COMMISSION_TYPES,
  COMMISSION_SOURCES,
  roundMoney,
  clampRate,
  isSpecialRateActive,
  doesTierMatch,
  resolveCommission,
  commissionAmountFor,
  percentageFee,
  resolveDiscount,
  calculatePaymentFees,
  applyPeriodCap,
  remainingCapAllowance,
  splitRefund,
};
