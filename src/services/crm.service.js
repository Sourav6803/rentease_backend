const {
  User, Rental, Payment, SupportTicket, Wishlist, UserBehaviorEvent, Product,
} = require('../models');
const { AppError } = require('../utils/AppError');
const emailService = require('./email.service');
const AnalyticsService = require('./analytics.service');
const logger = require('../config/logger');

class CrmService {
  async listCustomers({ page = 1, limit = 20, search = '' } = {}) {
    const skip = (page - 1) * limit;
    const filter = { role: 'user' };
    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } },
      ];
    }

    const [customers, total] = await Promise.all([
      User.find(filter)
        .select('email phone profile stats verification status createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return {
      customers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getCustomerProfile(userId) {
    const user = await User.findById(userId)
      .select('-password')
      .lean();
    if (!user) throw new AppError('Customer not found', 404);

    const [rentals, payments, tickets, wishlist, recentBehavior, ltv] = await Promise.all([
      Rental.find({ user: userId })
        .populate('product', 'basicInfo.name')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Payment.find({ user: userId }).sort({ createdAt: -1 }).limit(20).lean(),
      SupportTicket.find({ createdBy: userId }).sort({ createdAt: -1 }).limit(10).lean(),
      Wishlist.find({ user: userId }).populate('product', 'basicInfo.name pricing.monthlyRent').lean(),
      UserBehaviorEvent.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean(),
      Payment.aggregate([
        { $match: { user: userId, status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' }, orders: { $sum: 1 } } },
      ]),
    ]);

    const recentlyViewed = await UserBehaviorEvent.aggregate([
      { $match: { user: userId, eventType: 'product_view', product: { $ne: null } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$product', lastViewed: { $first: '$createdAt' }, views: { $sum: 1 } } },
      { $limit: 10 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $project: { name: '$product.basicInfo.name', lastViewed: 1, views: 1 } },
    ]);

    return {
      profile: user,
      rentalHistory: rentals,
      paymentHistory: payments,
      supportTickets: tickets,
      wishlist,
      favoriteProducts: wishlist,
      recentlyViewed,
      recentBehavior,
      lifetimeValue: ltv[0]?.total || 0,
      totalOrders: ltv[0]?.orders || 0,
    };
  }

  async sendEmailToCustomer(userId, { subject, htmlBody, textBody }) {
    const user = await User.findById(userId);
    if (!user) throw new AppError('Customer not found', 404);

    await emailService.sendEmail({
      to: user.email,
      subject,
      template: 'crm-email',
      data: {
        body: htmlBody,
        logoUrl: `${process.env.CLIENT_URL || 'http://localhost:3000'}/icon.svg`,
      },
      text: textBody || emailService.stripHtml(htmlBody),
    });

    return { sent: true, to: user.email };
  }

  async sendBulkEmail({ userIds, subject, htmlBody, textBody }) {
    const users = await User.find({ _id: { $in: userIds } }).select('email').lean();
    const logoUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/icon.svg`;
    const results = await Promise.allSettled(
      users.map((u) =>
        emailService.sendEmail({
          to: u.email,
          subject,
          template: 'crm-email',
          data: { body: htmlBody, logoUrl },
          text: textBody || emailService.stripHtml(htmlBody),
        }),
      ),
    );
    return {
      targeted: users.length,
      sent: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  }
}

module.exports = new CrmService();
