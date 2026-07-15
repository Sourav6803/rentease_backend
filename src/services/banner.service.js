// services/banner.service.js
const { Banner } = require('../models');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

class BannerService {
  /**
   * Public: get live banners (active + within schedule), optionally by type.
   * @param {Object} opts { type, placement, limit }
   */
  async getActiveBanners({ type, limit } = {}) {
    try {
      const now = new Date();

      const query = {
        isActive: true,
        $and: [
          { $or: [{ 'schedule.startDate': null }, { 'schedule.startDate': { $lte: now } }] },
          { $or: [{ 'schedule.endDate': null }, { 'schedule.endDate': { $gte: now } }] },
        ],
      };

      if (type) query.type = type;

      let q = Banner.find(query)
        .sort({ displayOrder: 1, createdAt: -1 })
        .populate('targetCategory', 'name slug')
        .lean();

      if (limit) q = q.limit(parseInt(limit));

      const banners = await q;
      return banners;
    } catch (error) {
      logger.error('Error in getActiveBanners:', error);
      throw error;
    }
  }

  /**
   * Public: get live banners grouped by type — one call powers the whole homepage.
   */
  async getHomeBanners() {
    try {
      const banners = await this.getActiveBanners({});
      const grouped = { hero: [], promo: [], strip: [], deal: [] };
      for (const b of banners) {
        if (grouped[b.type]) grouped[b.type].push(b);
      }
      return grouped;
    } catch (error) {
      logger.error('Error in getHomeBanners:', error);
      throw error;
    }
  }

  /**
   * Track an impression or click (best-effort, never throws to the caller path).
   */
  async trackEvent(bannerId, event = 'click') {
    try {
      const field = event === 'impression' ? 'stats.impressions' : 'stats.clicks';
      await Banner.findByIdAndUpdate(bannerId, { $inc: { [field]: 1 } });
    } catch (error) {
      logger.error('Error in trackEvent:', error);
    }
  }

  // ==================== ADMIN ====================

  async getAllBanners({ page = 1, limit = 20, type, isActive } = {}) {
    try {
      const skip = (page - 1) * limit;
      const query = {};
      if (type) query.type = type;
      if (isActive !== undefined) query.isActive = isActive === 'true' || isActive === true;

      const [banners, total] = await Promise.all([
        Banner.find(query)
          .sort({ displayOrder: 1, createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate('targetCategory', 'name slug')
          .lean(),
        Banner.countDocuments(query),
      ]);

      return {
        banners,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error('Error in getAllBanners:', error);
      throw error;
    }
  }

  async getBannerById(id) {
    const banner = await Banner.findById(id).populate('targetCategory', 'name slug');
    if (!banner) throw new AppError('Banner not found', 404);
    return banner;
  }

  async createBanner(data, adminId) {
    try {
      const banner = await Banner.create({
        ...data,
        metadata: { createdBy: adminId, updatedBy: adminId },
      });
      return banner;
    } catch (error) {
      logger.error('Error in createBanner:', error);
      throw error;
    }
  }

  async updateBanner(id, data, adminId) {
    try {
      const banner = await Banner.findByIdAndUpdate(
        id,
        { $set: { ...data, 'metadata.updatedBy': adminId } },
        { new: true, runValidators: true }
      );
      if (!banner) throw new AppError('Banner not found', 404);
      return banner;
    } catch (error) {
      logger.error('Error in updateBanner:', error);
      throw error;
    }
  }

  async toggleStatus(id, adminId) {
    const banner = await Banner.findById(id);
    if (!banner) throw new AppError('Banner not found', 404);
    banner.isActive = !banner.isActive;
    banner.metadata.updatedBy = adminId;
    await banner.save();
    return banner;
  }

  async deleteBanner(id) {
    const banner = await Banner.findByIdAndDelete(id);
    if (!banner) throw new AppError('Banner not found', 404);
    return { message: 'Banner deleted successfully' };
  }
}

module.exports = new BannerService();
