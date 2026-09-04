const {
  MarketingWorkflow, EmailCampaign, EmailTemplate, CustomerSegment, User,
} = require('../models');
const { AppError } = require('../utils/AppError');
const emailService = require('./email.service');
const CrmService = require('./crm.service');
const logger = require('../config/logger');

const DEFAULT_WORKFLOWS = [
  { name: 'User inactive 7 days', slug: 'user-inactive-7d', trigger: { type: 'user_inactive_7d' } },
  { name: 'User inactive 30 days', slug: 'user-inactive-30d', trigger: { type: 'user_inactive_30d' } },
  { name: 'Cart abandoned', slug: 'cart-abandoned', trigger: { type: 'cart_abandoned' } },
  { name: 'Rental expiring soon', slug: 'rental-expiring', trigger: { type: 'rental_expiring' } },
  { name: 'Welcome email', slug: 'welcome', trigger: { type: 'welcome' } },
  { name: 'Thank you after rental', slug: 'thank-you', trigger: { type: 'thank_you' } },
  { name: 'Review reminder', slug: 'review-reminder', trigger: { type: 'review_reminder' } },
  { name: 'Birthday wishes', slug: 'birthday', trigger: { type: 'birthday' } },
  { name: 'Coupon expiry reminder', slug: 'coupon-expiry', trigger: { type: 'coupon_expiry' } },
  { name: 'Wishlist reminder', slug: 'wishlist-reminder', trigger: { type: 'wishlist_reminder' } },
  { name: 'Interest detected offer', slug: 'interest-detected', trigger: { type: 'interest_detected' } },
];

class MarketingAutomationService {
  async seedDefaultWorkflows(adminId) {
    for (const wf of DEFAULT_WORKFLOWS) {
      await MarketingWorkflow.findOneAndUpdate(
        { slug: wf.slug },
        { ...wf, isEnabled: false, metadata: { createdBy: adminId } },
        { upsert: true, new: true },
      );
    }
    return MarketingWorkflow.find().sort({ name: 1 }).lean();
  }

  async listWorkflows() {
    const workflows = await MarketingWorkflow.find().sort({ name: 1 }).lean();
    if (!workflows.length) return this.seedDefaultWorkflows();
    return workflows;
  }

  async toggleWorkflow(slug, isEnabled) {
    const wf = await MarketingWorkflow.findOneAndUpdate(
      { slug },
      { isEnabled },
      { new: true },
    );
    if (!wf) throw new AppError('Workflow not found', 404);
    return wf;
  }

  async updateWorkflow(slug, payload) {
    return MarketingWorkflow.findOneAndUpdate({ slug }, payload, { new: true });
  }

  // Email templates
  async listTemplates(filter = {}) {
    const q = {};
    if (filter.category) q.category = filter.category;
    if (filter.isActive !== undefined) q.isActive = filter.isActive;
    return EmailTemplate.find(q).sort({ updatedAt: -1 }).lean();
  }

  async createTemplate(payload, adminId) {
    return EmailTemplate.create({ ...payload, metadata: { createdBy: adminId } });
  }

  async updateTemplate(id, payload, adminId) {
    return EmailTemplate.findByIdAndUpdate(
      id,
      { ...payload, 'metadata.updatedBy': adminId },
      { new: true },
    );
  }

  // Campaigns
  async listCampaigns({ page = 1, limit = 20, status } = {}) {
    const filter = {};
    if (status) filter.status = status;
    const skip = (page - 1) * limit;
    const [campaigns, total] = await Promise.all([
      EmailCampaign.find(filter).populate('template').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      EmailCampaign.countDocuments(filter),
    ]);
    return { campaigns, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async createCampaign(payload, adminId) {
    return EmailCampaign.create({ ...payload, metadata: { createdBy: adminId } });
  }

  async scheduleCampaign(campaignId, scheduledAt) {
    return EmailCampaign.findByIdAndUpdate(
      campaignId,
      { status: 'scheduled', scheduledAt },
      { new: true },
    );
  }

  async sendCampaign(campaignId) {
    const campaign = await EmailCampaign.findById(campaignId).populate('template');
    if (!campaign) throw new AppError('Campaign not found', 404);

    let userIds = [];
    if (campaign.audience.type === 'all') {
      userIds = await User.find({ role: 'user', 'status.isActive': true }).distinct('_id');
    } else if (campaign.audience.type === 'selected') {
      userIds = campaign.audience.userIds;
    } else if (campaign.audience.type === 'segment' && campaign.audience.segmentId) {
      const segment = await CustomerSegment.findById(campaign.audience.segmentId);
      userIds = segment?.userIds || [];
    }

    const subject = campaign.subject || campaign.template?.subject;
    const html = campaign.htmlBody || campaign.template?.htmlBody;

    const result = await CrmService.sendBulkEmail({
      userIds: userIds.map(String),
      subject,
      htmlBody: html,
    });

    campaign.status = 'sent';
    campaign.sentAt = new Date();
    campaign.stats = {
      ...campaign.stats,
      targeted: userIds.length,
      sent: result.sent,
      failed: result.failed,
    };
    await campaign.save();

    return campaign;
  }

  // Segments
  async listSegments() {
    return CustomerSegment.find().sort({ name: 1 }).lean();
  }

  async createSegment(payload, adminId) {
    return CustomerSegment.create({ ...payload, metadata: { createdBy: adminId } });
  }

  async updateSegment(id, payload) {
    return CustomerSegment.findByIdAndUpdate(id, payload, { new: true });
  }

  async deleteCampaign(campaignId) {
    return EmailCampaign.findByIdAndDelete(campaignId);
  }

  async deleteTemplate(templateId) {
    return EmailTemplate.findByIdAndDelete(templateId);
  }

  async deleteSegment(segmentId) {
    return CustomerSegment.findByIdAndDelete(segmentId);
  }

  /**
   * Real campaign analytics for the marketing charts — aggregates what actually
   * exists in the EmailCampaign collection (no fabricated numbers).
   */
  async getCampaignAnalytics({ days = 14 } = {}) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const campaigns = await EmailCampaign.find({ createdAt: { $gte: since } })
      .select('name status audience scheduledAt sentAt createdAt metadata')
      .lean();

    // Engagement timeline: one bucket per day (last N days), with opens/clicks
    // summed from each campaign's metadata when tracking data exists.
    const dayMap = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const label = d.toISOString().slice(0, 10);
      dayMap.set(label, { label, opens: 0, clicks: 0, campaigns: 0 });
    }
    campaigns.forEach((c) => {
      const created = c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : null;
      const bucket = dayMap.get(created);
      if (bucket) {
        bucket.campaigns += 1;
        bucket.opens += Number(c.metadata?.opened ?? 0);
        bucket.clicks += Number(c.metadata?.clicked ?? 0);
      }
    });

    const totals = campaigns.reduce(
      (acc, c) => {
        acc.campaigns += 1;
        acc.targeted += Number(c.metadata?.targeted ?? 0);
        acc.sent += Number(c.metadata?.sent ?? 0);
        acc.opened += Number(c.metadata?.opened ?? 0);
        acc.clicked += Number(c.metadata?.clicked ?? 0);
        acc.bounced += Number(c.metadata?.bounced ?? 0);
        acc.revenue += Number(c.metadata?.revenue ?? 0);
        return acc;
      },
      { campaigns: 0, targeted: 0, sent: 0, opened: 0, clicked: 0, bounced: 0, revenue: 0 },
    );

    return {
      deliveryTimeline: [...dayMap.values()],
      // Device/hourly/geography need an email tracking integration (open/click
      // pixels report device, time and location) — return empty so the charts
      // show "no data" instead of fabricated numbers.
      deviceBreakdown: [],
      opensByHour: [],
      geography: [],
      totals,
    };
  }
}

module.exports = new MarketingAutomationService();
