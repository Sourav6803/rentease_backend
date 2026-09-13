const mongoose = require('mongoose');
const { Rental } = require('../models');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * Vendor-scoped customer directory.
 *
 * There is no Customer collection: a vendor's customers are the distinct
 * `Rental.user` values on rentals where `Rental.vendor === <Vendor doc _id>`.
 * (Rental.vendor is ref'd to Vendor and is written from Product.vendor, which is
 * itself the Vendor document _id — see product.service.js and the comment in
 * vendor.service.js getVendorDashboard.)
 *
 * Everything is returned from ONE aggregation pass via $facet, so the list, its
 * total, the header stats and the segment counts cannot drift apart.
 */

const COMPLETED_STATUS = 'completed';
const CANCELLED_STATUS = 'cancelled';

/** Segments the UI can filter by. `all` means no filter. */
const SEGMENTS = ['all', 'vip', 'frequent', 'regular', 'new', 'inactive'];

/** Spend (in INR) at or above which a customer is a VIP. */
const VIP_SPEND_THRESHOLD = 50000;
/** Days without a rental after which a customer is considered inactive. */
const INACTIVE_AFTER_DAYS = 90;

const SORTABLE = {
  totalSpent: { totalSpent: -1 },
  totalRentals: { totalRentals: -1 },
  lastRentalAt: { lastRentalAt: -1 },
  firstRentalAt: { firstRentalAt: -1 },
  name: { fullName: 1 },
};

const MAX_SEARCH_TOKENS = 5;

/**
 * Aggregations do not cast, so a string id silently matches nothing. Fail loudly
 * instead of returning an empty list.
 */
function toObjectId(value, label) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  throw new AppError(`Invalid ${label}`, 400);
}

/** User input is compiled into a RegExp, so metacharacters must be neutralised. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class VendorCustomerService {
  /**
   * One row per customer, already carrying every derived field the UI needs.
   * Stops short of filtering, sorting and paginating so both public methods can
   * reuse it.
   */
  buildBasePipeline(vendorObjectId, now) {
    const inactiveBefore = new Date(now.getTime() - INACTIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    return [
      { $match: { vendor: vendorObjectId } },
      // Sort before grouping so $first picks the most recent rental. $top would
      // be terser but needs MongoDB 5.0+.
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$user',
          totalRentals: { $sum: 1 },
          totalSpent: { $sum: { $ifNull: ['$rentalDetails.totalAmount', 0] } },
          completedRentals: {
            $sum: { $cond: [{ $eq: ['$status', COMPLETED_STATUS] }, 1, 0] },
          },
          cancelledRentals: {
            $sum: { $cond: [{ $eq: ['$status', CANCELLED_STATUS] }, 1, 0] },
          },
          firstRentalAt: { $min: '$createdAt' },
          lastRentalAt: { $max: '$createdAt' },
          products: { $addToSet: '$product' },
          lastRentalNumber: { $first: '$rentalNumber' },
          lastRentalStatus: { $first: '$status' },
          lastRentalId: { $first: '$_id' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'customer',
        },
      },
      // preserveNull keeps a customer row alive even if the User document was
      // removed, so historical revenue is never silently dropped from the list.
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          customerId: '$_id',
          firstName: '$customer.profile.firstName',
          lastName: '$customer.profile.lastName',
          email: '$customer.email',
          phone: '$customer.phone',
          avatar: '$customer.profile.avatar',
          customerSince: '$customer.createdAt',
          accountStatus: '$customer.status',
          totalRentals: 1,
          totalSpent: 1,
          completedRentals: 1,
          cancelledRentals: 1,
          activeRentals: {
            $subtract: [
              '$totalRentals',
              { $add: ['$completedRentals', '$cancelledRentals'] },
            ],
          },
          firstRentalAt: 1,
          lastRentalAt: 1,
          lastRentalNumber: 1,
          lastRentalStatus: 1,
          lastRentalId: 1,
          uniqueProducts: { $size: { $setDifference: ['$products', [null]] } },
          avgOrderValue: {
            $cond: [
              { $gt: ['$totalRentals', 0] },
              { $divide: ['$totalSpent', '$totalRentals'] },
              0,
            ],
          },
        },
      },
      // $concat returns null when any input is null, so guard every part — the
      // existing getCustomerInsights concat drops the whole name when a customer
      // has only one name set.
      {
        $addFields: {
          fullName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$firstName', ''] },
                  ' ',
                  { $ifNull: ['$lastName', ''] },
                ],
              },
            },
          },
        },
      },
      // First matching branch wins, so this list IS the precedence order and the
      // segments cannot overlap or leave gaps.
      {
        $addFields: {
          segment: {
            $switch: {
              branches: [
                { case: { $gte: ['$totalSpent', VIP_SPEND_THRESHOLD] }, then: 'vip' },
                { case: { $lt: ['$lastRentalAt', inactiveBefore] }, then: 'inactive' },
                { case: { $gte: ['$totalRentals', 3] }, then: 'frequent' },
                { case: { $eq: ['$totalRentals', 2] }, then: 'regular' },
                { case: { $eq: ['$totalRentals', 1] }, then: 'new' },
              ],
              default: 'regular',
            },
          },
        },
      },
    ];
  }

  /**
   * Every token must appear somewhere in the name, email or phone, so
   * "priya 98" narrows rather than widens the result set.
   */
  buildSearchMatch(search) {
    const tokens = String(search || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, MAX_SEARCH_TOKENS);

    if (tokens.length === 0) return null;

    return {
      $and: tokens.map((token) => {
        const rx = new RegExp(escapeRegex(token), 'i');
        return { $or: [{ fullName: rx }, { email: rx }, { phone: rx }] };
      }),
    };
  }

  async listCustomers(vendorId, options = {}) {
    try {
      const vendorObjectId = toObjectId(vendorId, 'vendor id');

      const page = Math.max(1, parseInt(options.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
      const skip = (page - 1) * limit;

      const segment = SEGMENTS.includes(options.segment) ? options.segment : 'all';
      const sort = SORTABLE[options.sort] ? SORTABLE[options.sort] : SORTABLE.totalSpent;

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const searchMatch = this.buildSearchMatch(options.search);
      const filters = [
        ...(segment === 'all' ? [] : [{ $match: { segment } }]),
        ...(searchMatch ? [{ $match: searchMatch }] : []),
      ];

      const [result] = await Rental.aggregate([
        ...this.buildBasePipeline(vendorObjectId, now),
        {
          $facet: {
            // Facets all receive the same input stream, so the filtered
            // sub-pipelines repeat the $match while stats stay vendor-wide.
            customers: [...filters, { $sort: sort }, { $skip: skip }, { $limit: limit }],
            total: [...filters, { $count: 'value' }],
            stats: [
              {
                $group: {
                  _id: null,
                  totalCustomers: { $sum: 1 },
                  totalRevenue: { $sum: '$totalSpent' },
                  avgSpendPerCustomer: { $avg: '$totalSpent' },
                  avgRentalsPerCustomer: { $avg: '$totalRentals' },
                  returningCustomers: {
                    $sum: { $cond: [{ $gt: ['$totalRentals', 1] }, 1, 0] },
                  },
                  oneTimeCustomers: {
                    $sum: { $cond: [{ $eq: ['$totalRentals', 1] }, 1, 0] },
                  },
                  activeCustomers: {
                    $sum: { $cond: [{ $gt: ['$activeRentals', 0] }, 1, 0] },
                  },
                  newThisMonth: {
                    $sum: { $cond: [{ $gte: ['$firstRentalAt', startOfMonth] }, 1, 0] },
                  },
                  activeLast30Days: {
                    $sum: { $cond: [{ $gte: ['$lastRentalAt', thirtyDaysAgo] }, 1, 0] },
                  },
                },
              },
            ],
            bySegment: [{ $group: { _id: '$segment', count: { $sum: 1 } } }],
          },
        },
      ]);

      const total = result?.total?.[0]?.value || 0;
      const rawStats = result?.stats?.[0] || {};

      const segmentCounts = SEGMENTS.reduce((acc, key) => {
        acc[key] = 0;
        return acc;
      }, {});
      for (const entry of result?.bySegment || []) {
        if (entry && entry._id in segmentCounts) segmentCounts[entry._id] = entry.count;
      }
      segmentCounts.all = rawStats.totalCustomers || 0;

      const stats = {
        totalCustomers: rawStats.totalCustomers || 0,
        totalRevenue: rawStats.totalRevenue || 0,
        avgSpendPerCustomer: rawStats.avgSpendPerCustomer || 0,
        avgRentalsPerCustomer: rawStats.avgRentalsPerCustomer || 0,
        returningCustomers: rawStats.returningCustomers || 0,
        oneTimeCustomers: rawStats.oneTimeCustomers || 0,
        activeCustomers: rawStats.activeCustomers || 0,
        newThisMonth: rawStats.newThisMonth || 0,
        activeLast30Days: rawStats.activeLast30Days || 0,
        vipCount: segmentCounts.vip || 0,
        repeatRate: rawStats.totalCustomers
          ? ((rawStats.returningCustomers || 0) / rawStats.totalCustomers) * 100
          : 0,
      };

      return {
        customers: result?.customers || [],
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
        stats,
        segments: segmentCounts,
      };
    } catch (error) {
      logger.error('Error in VendorCustomerService.listCustomers:', error);
      throw error;
    }
  }

  /**
   * A customer is only visible through a rental with this vendor. Anyone who has
   * never rented here gets a 404 rather than an empty profile, which keeps the
   * endpoint from being a user-directory lookup.
   */
  async getCustomerDetail(vendorId, customerId) {
    try {
      const vendorObjectId = toObjectId(vendorId, 'vendor id');
      const customerObjectId = toObjectId(customerId, 'customer id');

      const now = new Date();
      // aggregate() resolves to an ARRAY of documents, so destructuring already
      // yields the row itself. Indexing the destructured value (rows[0]) looks up
      // the key "0" on a plain object, which is always undefined — that is what
      // made every detail request 404 even though the aggregation had matched.
      const [customer] = await Rental.aggregate([
        ...this.buildBasePipeline(vendorObjectId, now),
        { $match: { customerId: customerObjectId } },
        { $limit: 1 },
      ]);

      if (!customer) {
        throw new AppError('Customer not found for this vendor', 404);
      }

      const rentals = await Rental.find({
        vendor: vendorObjectId,
        user: customerObjectId,
      })
        .populate('product', 'basicInfo.name basicInfo.images pricing.monthlyRent')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      return { customer, rentals };
    } catch (error) {
      logger.error('Error in VendorCustomerService.getCustomerDetail:', error);
      throw error;
    }
  }
}

module.exports = new VendorCustomerService();
module.exports.SEGMENTS = SEGMENTS;
module.exports.INACTIVE_AFTER_DAYS = INACTIVE_AFTER_DAYS;
module.exports.VIP_SPEND_THRESHOLD = VIP_SPEND_THRESHOLD;
