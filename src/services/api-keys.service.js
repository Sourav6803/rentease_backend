const ApiKey = require('../models/ApiKey.model');
const mongoose = require('mongoose');
const crypto = require('crypto');

class ApiKeysService {
  async getAllKeys(page = 1, limit = 10, filters = {}) {
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { key: { $regex: filters.search, $options: 'i' } }
      ];
    }

    const [keys, total] = await Promise.all([
      ApiKey.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ApiKey.countDocuments(query)
    ]);

    return {
      keys: keys.map(k => ({ ...k, secret: undefined })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    };
  }

  async getKeyStats() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalKeys, activeKeys, revokedKeys, expiredKeys, totalRequestsAgg, usageByDayAgg] = await Promise.all([
      ApiKey.countDocuments({}),
      ApiKey.countDocuments({ status: 'active' }),
      ApiKey.countDocuments({ status: 'revoked' }),
      ApiKey.countDocuments({ status: 'expired' }),
      ApiKey.aggregate([
        { $group: { _id: null, totalRequests: { $sum: '$usageCount' } } }
      ]),
      ApiKey.aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    const totalRequests = totalRequestsAgg[0]?.totalRequests || 0;
    const averageRequestsPerDay = Math.round(totalRequests / 30);

    const topKeys = await ApiKey.find({ status: 'active' })
      .sort({ usageCount: -1 })
      .limit(10)
      .select('name usageCount _id')
      .lean();

    return {
      totalKeys,
      activeKeys,
      revokedKeys,
      expiredKeys,
      totalRequests,
      averageRequestsPerDay,
      topKeys: topKeys.map(k => ({ keyId: k._id, name: k.name, usageCount: k.usageCount })),
      usageByDay: usageByDayAgg.map(d => ({ date: d._id, count: d.count }))
    };
  }

  async createKey(data, createdBy) {
    const { name, permissions = [], rateLimit, allowedIPs = [], allowedDomains = [], expiresInDays } = data;

    if (!name) throw new AppError('Key name is required', 400);

    const apiKey = await ApiKey.create({
      name,
      key: crypto.randomBytes(24).toString('hex'),
      secret: crypto.randomBytes(32).toString('hex'),
      permissions,
      rateLimit: rateLimit || { enabled: false, limit: 100, window: 60 },
      allowedIPs,
      allowedDomains,
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
      createdBy: {
        _id: createdBy._id,
        name: createdBy.name || createdBy.profile?.firstName + ' ' + createdBy.profile?.lastName || 'Admin',
        email: createdBy.email || ''
      }
    });

    return apiKey.toJSON();
  }

  async revokeKey(id) {
    const apiKey = await ApiKey.findById(id);
    if (!apiKey) throw new AppError('API key not found', 404);

    apiKey.status = 'revoked';
    await apiKey.save();

    return { message: 'API key revoked successfully' };
  }

  async regenerateKey(id) {
    const apiKey = await ApiKey.findById(id);
    if (!apiKey) throw new AppError('API key not found', 404);

    const newSecret = crypto.randomBytes(32).toString('hex');

    apiKey.secret = newSecret;
    apiKey.status = 'active';
    await apiKey.save();

    return {
      message: 'API key regenerated successfully',
      keyId: apiKey._id,
      name: apiKey.name,
      key: apiKey.key,
      secret: newSecret
    };
  }
}

module.exports = new ApiKeysService();
