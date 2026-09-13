/**
 * routes/v1/admin-payout.routes.js
 *
 * Admin vendor-payout endpoints, mounted at /api/v1/admin/payouts.
 *
 * Role guard: super_admin, admin and finance_manager. finance_manager is
 * included because the finance role's own sidebar exposes Payouts — without it
 * the menu item would lead to a 403.
 *
 * Registered in routes/v1/index.js BEFORE the generic `/admin` router, because
 * that router would otherwise run its own auth chain first and swallow these
 * paths.
 */
const express = require('express');
const router = express.Router();
const adminPayoutController = require('../../controllers/admin-payout.controller');
const { protectAdmin, restrictTo } = require('../../middlewares/admin-auth.middleware');

router.use(protectAdmin);
router.use(restrictTo('super_admin', 'admin', 'finance_manager'));

// ── static paths first: they must not be captured by /:id ────────────────────
router.get('/summary', adminPayoutController.getOverview);
router.get('/vendors', adminPayoutController.listPayableVendors);
router.get('/ledger/summary', adminPayoutController.getLedgerSummary);
router.get('/ledger', adminPayoutController.listLedger);

// Maintenance actions that mirror the scheduled jobs.
router.post('/release-earnings', adminPayoutController.releaseEarnings);
router.post('/sweep-payments', adminPayoutController.sweepPayments);

// ── collection ───────────────────────────────────────────────────────────────
router.route('/').get(adminPayoutController.listPayouts).post(adminPayoutController.createPayout);

// ── single payout ────────────────────────────────────────────────────────────
router.get('/:id', adminPayoutController.getPayout);
router.get('/:id/receipt', adminPayoutController.getReceipt);
router.post('/:id/process', adminPayoutController.processPayout);
router.post('/:id/mark-paid', adminPayoutController.markPaid);
router.post('/:id/cancel', adminPayoutController.cancelPayout);

module.exports = router;
