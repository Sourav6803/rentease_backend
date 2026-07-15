const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const AdminIntelligenceService = require('../../services/admin-intelligence.service');
const BehaviorTrackingService = require('../../services/behavior-tracking.service');
const InterestDetectionService = require('../../services/interest-detection.service');
const CrmService = require('../../services/crm.service');
const MarketingAutomationService = require('../../services/marketing-automation.service');

class AdminIntelligenceController {
  // ─── Module 1: Admin Analytics Dashboard ───────────────────────────────────
  getOverview = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getOverviewCards(req.query);
    return ApiResponse.success(res, 200, 'Overview cards retrieved', data);
  });

  getRentalCharts = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getRentalAnalyticsCharts(req.query);
    return ApiResponse.success(res, 200, 'Rental analytics retrieved', data);
  });

  getTopProducts = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getTopProducts(req.query);
    return ApiResponse.success(res, 200, 'Top products retrieved', data);
  });

  getLeastProducts = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getLeastProducts(req.query);
    return ApiResponse.success(res, 200, 'Least performing products retrieved', data);
  });

  getCustomerAnalytics = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getCustomerAnalyticsExtended(req.query);
    return ApiResponse.success(res, 200, 'Customer analytics retrieved', data);
  });

  // ─── Module 2: Coupons (wraps existing discount service) ─────────────────
  getCouponAnalytics = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getCouponAnalytics(req.query);
    return ApiResponse.success(res, 200, 'Coupon analytics retrieved', data);
  });

  // ─── Module 3: CRM ───────────────────────────────────────────────────────
  listCustomers = catchAsync(async (req, res) => {
    const data = await CrmService.listCustomers(req.query);
    return ApiResponse.success(res, 200, 'Customers retrieved', data);
  });

  getCustomer = catchAsync(async (req, res) => {
    const data = await CrmService.getCustomerProfile(req.params.userId);
    return ApiResponse.success(res, 200, 'Customer profile retrieved', data);
  });

  sendCustomerEmail = catchAsync(async (req, res) => {
    const data = await CrmService.sendEmailToCustomer(req.params.userId, req.body);
    return ApiResponse.success(res, 200, 'Email sent', data);
  });

  sendBulkEmail = catchAsync(async (req, res) => {
    const data = await CrmService.sendBulkEmail(req.body);
    return ApiResponse.success(res, 200, 'Bulk email processed', data);
  });

  // ─── Module 4: Marketing automation ─────────────────────────────────────
  listWorkflows = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.listWorkflows();
    return ApiResponse.success(res, 200, 'Workflows retrieved', { workflows: data });
  });

  toggleWorkflow = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.toggleWorkflow(req.params.slug, req.body.isEnabled);
    return ApiResponse.success(res, 200, 'Workflow updated', { workflow: data });
  });

  updateWorkflow = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.updateWorkflow(req.params.slug, req.body);
    return ApiResponse.success(res, 200, 'Workflow updated', { workflow: data });
  });

  listTemplates = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.listTemplates(req.query);
    return ApiResponse.success(res, 200, 'Email templates retrieved', { templates: data });
  });

  createTemplate = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.createTemplate(req.body, req.admin?._id || req.user._id);
    return ApiResponse.created(res, 'Email template created', { template: data });
  });

  updateTemplate = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.updateTemplate(req.params.id, req.body, req.admin?._id || req.user._id);
    return ApiResponse.success(res, 200, 'Email template updated', { template: data });
  });

  listCampaigns = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.listCampaigns(req.query);
    return ApiResponse.success(res, 200, 'Campaigns retrieved', data);
  });

  createCampaign = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.createCampaign(req.body, req.admin?._id || req.user._id);
    return ApiResponse.created(res, 'Campaign created', { campaign: data });
  });

  scheduleCampaign = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.scheduleCampaign(req.params.id, req.body.scheduledAt);
    return ApiResponse.success(res, 200, 'Campaign scheduled', { campaign: data });
  });

  sendCampaign = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.sendCampaign(req.params.id);
    return ApiResponse.success(res, 200, 'Campaign sent', { campaign: data });
  });

  listSegments = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.listSegments();
    return ApiResponse.success(res, 200, 'Segments retrieved', { segments: data });
  });

  createSegment = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.createSegment(req.body, req.admin?._id || req.user._id);
    return ApiResponse.created(res, 'Segment created', { segment: data });
  });

  updateSegment = catchAsync(async (req, res) => {
    const data = await MarketingAutomationService.updateSegment(req.params.id, req.body);
    return ApiResponse.success(res, 200, 'Segment updated', { segment: data });
  });

  // ─── Module 5: Product intelligence ──────────────────────────────────────
  getProductIntelligence = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getProductIntelligence(req.query);
    return ApiResponse.success(res, 200, 'Product intelligence retrieved', data);
  });

  // ─── Module 6: Behavior analytics ────────────────────────────────────────
  getBehaviorAnalytics = catchAsync(async (req, res) => {
    const data = await BehaviorTrackingService.getAnalytics(req.query);
    return ApiResponse.success(res, 200, 'Behavior analytics retrieved', data);
  });

  // ─── Module 7: Interest detection ────────────────────────────────────────
  listInterests = catchAsync(async (req, res) => {
    const data = await InterestDetectionService.listInterests(req.query);
    return ApiResponse.success(res, 200, 'Product interests retrieved', data);
  });

  // ─── Module 9: Vendor performance ────────────────────────────────────────
  getVendorPerformance = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getVendorPerformance(req.query);
    return ApiResponse.success(res, 200, 'Vendor performance retrieved', data);
  });

  // ─── Module 11: Operations ─────────────────────────────────────────────────
  getOperations = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getOperationsDashboard(req.query);
    return ApiResponse.success(res, 200, 'Operations dashboard retrieved', data);
  });

  // ─── Module 12: AI insights ────────────────────────────────────────────────
  getAiInsights = catchAsync(async (req, res) => {
    const data = await AdminIntelligenceService.getAiInsights(req.query);
    return ApiResponse.success(res, 200, 'AI insights retrieved', data);
  });
}

module.exports = new AdminIntelligenceController();
