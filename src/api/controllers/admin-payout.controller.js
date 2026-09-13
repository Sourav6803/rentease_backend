/**
 * controllers/admin-payout.controller.js
 *
 * HTTP layer for vendor payouts. Every handler delegates to
 * services/settlement.service.js — the state machine, the ledger rules and the
 * money maths all live there, so the behaviour is identical whether a payout is
 * triggered from the admin UI, a job or a test.
 */
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const settlement = require('../../services/settlement.service');

class AdminPayoutController {
  /**
   * GET /admin/payouts
   * Paginated payout list, filterable by status, vendor and manual-transfer need.
   */
  listPayouts = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, status, vendorId, requiresManualTransfer } = req.query;

    const result = await settlement.listPayouts({
      page,
      limit,
      status: status || undefined,
      vendorId: vendorId || undefined,
      requiresManualTransfer:
        requiresManualTransfer === true || requiresManualTransfer === 'true' ? true : undefined,
    });

    return ApiResponse.success(res, 200, 'Payouts retrieved successfully', result);
  });

  /**
   * GET /admin/payouts/summary
   * Headline balances and counts for the payout dashboard.
   */
  getOverview = catchAsync(async (req, res) => {
    const overview = await settlement.getPayoutOverview();
    return ApiResponse.success(res, 200, 'Payout overview retrieved successfully', overview);
  });

  /**
   * GET /admin/payouts/vendors
   * Vendors that have money owed to them, with their balances. Feeds the vendor
   * picker in the create-payout flow so an admin can see who is payable before
   * choosing.
   */
  listPayableVendors = catchAsync(async (req, res) => {
    const vendors = await settlement.getVendorsWithBalances({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      config: await settlement.getPayoutConfig(),
    });

    return ApiResponse.success(res, 200, 'Payable vendors retrieved successfully', vendors);
  });

  /**
   * GET /admin/payouts/ledger/summary
   * Ledger balances for one vendor.
   */
  getLedgerSummary = catchAsync(async (req, res) => {
    const { vendorId } = req.query;
    if (!vendorId) throw new AppError('vendorId is required', 400);

    const summary = await settlement.getVendorLedgerSummary(vendorId);
    return ApiResponse.success(res, 200, 'Ledger summary retrieved successfully', summary);
  });

  /**
   * GET /admin/payouts/ledger
   * Paged ledger statement for one vendor.
   */
  listLedger = catchAsync(async (req, res) => {
    const { vendorId, page, limit, type, status } = req.query;
    if (!vendorId) throw new AppError('vendorId is required', 400);

    const result = await settlement.listVendorLedger(vendorId, { page, limit, type, status });
    return ApiResponse.success(res, 200, 'Ledger entries retrieved successfully', result);
  });

  /**
   * POST /admin/payouts
   * Create a payout for a vendor out of their available (released) earnings.
   */
  createPayout = catchAsync(async (req, res) => {
    const { vendorId, periodStart, periodEnd, notes } = req.body;
    if (!vendorId) throw new AppError('vendorId is required', 400);

    const payout = await settlement.createPayout({
      vendorId,
      periodStart,
      periodEnd,
      notes,
      adminId: req.admin?._id,
    });

    return ApiResponse.created(res, 'Payout created successfully', { payout });
  });

  /**
   * GET /admin/payouts/:id
   */
  getPayout = catchAsync(async (req, res) => {
    const payout = await settlement.getPayout(req.params.id);
    const entries = await settlement.listVendorLedgerEntriesForPayout(payout._id);
    return ApiResponse.success(res, 200, 'Payout retrieved successfully', { payout, entries });
  });

  /**
   * POST /admin/payouts/:id/process
   * Move pending|failed -> processing and attempt the transfer. When the gateway
   * flag is off the payout stays pending with requiresManualTransfer=true.
   */
  processPayout = catchAsync(async (req, res) => {
    const payout = await settlement.processPayout(req.params.id, req.admin?._id);

    const message =
      payout.status === 'paid'
        ? 'Payout processed and transferred'
        : payout.requiresManualTransfer
          ? 'Payout is ready but needs a manual bank transfer (gateway payouts are disabled)'
          : 'Payout processing attempted';

    return ApiResponse.success(res, 200, message, { payout });
  });

  /**
   * POST /admin/payouts/:id/mark-paid
   * Finance confirms a manual transfer. A UTR is mandatory — without it there is
   * no evidence the money left.
   */
  markPaid = catchAsync(async (req, res) => {
    const { utr, note } = req.body;
    const payout = await settlement.markPayoutPaidManually(
      req.params.id,
      { utr, note },
      req.admin?._id,
    );

    return ApiResponse.success(res, 200, 'Payout marked as paid', { payout });
  });

  /**
   * POST /admin/payouts/:id/cancel
   * Cancels an unpaid payout and returns its entries to the payable pool.
   */
  cancelPayout = catchAsync(async (req, res) => {
    const { reason } = req.body;
    const payout = await settlement.cancelPayout(req.params.id, reason, req.admin?._id);

    return ApiResponse.success(res, 200, 'Payout cancelled', { payout });
  });

  /**
   * GET /admin/payouts/:id/receipt
   */
  getReceipt = catchAsync(async (req, res) => {
    const receipt = await settlement.getPayoutReceipt(req.params.id);
    return ApiResponse.success(res, 200, 'Payout receipt retrieved successfully', receipt);
  });

  /**
   * POST /admin/payouts/release-earnings
   * Moves every earning past its hold window into the payable pool. Safe to call
   * repeatedly; normally run by a scheduled job.
   */
  releaseEarnings = catchAsync(async (req, res) => {
    const result = await settlement.releaseDueEntries();
    return ApiResponse.success(res, 200, 'Earnings released', result);
  });

  /**
   * POST /admin/payouts/sweep-payments
   * Expires abandoned payments. Exposed for an admin to clear a stuck backlog;
   * the same logic runs on a schedule.
   */
  sweepPayments = catchAsync(async (req, res) => {
    const result = await settlement.expireStalePayments({
      timeoutMinutes: req.body?.timeoutMinutes,
    });
    logger.info('Admin triggered a stale-payment sweep', {
      cancelled: result.cancelled.length,
      needsReconciliation: result.needsReconciliation.length,
    });
    return ApiResponse.success(res, 200, 'Stale payments swept', result);
  });
}

module.exports = new AdminPayoutController();
