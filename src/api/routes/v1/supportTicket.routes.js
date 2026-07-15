// routes/supportTicket.routes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middlewares/auth.middleware');
const { supportTicketValidations } = require('../../middlewares/validation.middleware');
const { validate } = require('../../middlewares/validation.middleware');
const supportTicketController = require('../../controllers/supportTicket.controller');
const { restrictTo } = require('../../middlewares/permissions.middleware');

// All routes require authentication
router.use(protect);

// ==================== ADMIN ROUTES ====================
// NOTE: Admin routes are declared FIRST and each is guarded individually with
// restrictTo('admin', 'super-admin'). Previously a global router.use(restrictTo('vendor'))
// sat above these, making every admin route return 403 before it was ever reached.
const adminOnly = restrictTo('admin', 'super-admin');

// Get all tickets
router.get(
  '/admin/tickets',
  adminOnly,
  validate(supportTicketValidations.getTickets),
  supportTicketController.getAllTickets
);

// Get dashboard stats
router.get(
  '/admin/dashboard/stats',
  adminOnly,
  supportTicketController.getDashboardStats
);

// Get a single ticket (admin can view any ticket)
router.get(
  '/admin/tickets/:ticketId',
  adminOnly,
  validate(supportTicketValidations.getTicket),
  supportTicketController.getTicketByIdAdmin
);

// Reply / add message to a ticket
router.post(
  '/admin/tickets/:ticketId/messages',
  adminOnly,
  validate(supportTicketValidations.addMessage),
  supportTicketController.adminAddMessage
);

// Update ticket status
router.patch(
  '/admin/tickets/:ticketId/status',
  adminOnly,
  validate(supportTicketValidations.updateStatus),
  supportTicketController.updateStatus
);

// Assign ticket
router.post(
  '/admin/tickets/:ticketId/assign',
  adminOnly,
  validate(supportTicketValidations.assignTicket),
  supportTicketController.assignTicket
);

// ==================== VENDOR ROUTES ====================
const vendorOnly = restrictTo('vendor');

// Create ticket
router.post(
  '/tickets',
  vendorOnly,
  validate(supportTicketValidations.createTicket),
  supportTicketController.createTicket
);

// Get user tickets
router.get(
  '/tickets',
  vendorOnly,
  validate(supportTicketValidations.getTickets),
  supportTicketController.getUserTickets
);

// Get ticket stats
router.get(
  '/tickets/stats',
  vendorOnly,
  supportTicketController.getTicketStats
);

// Get single ticket
router.get(
  '/tickets/:ticketId',
  vendorOnly,
  validate(supportTicketValidations.getTicket),
  supportTicketController.getTicketById
);

// Add message to ticket
router.post(
  '/tickets/:ticketId/messages',
  vendorOnly,
  validate(supportTicketValidations.addMessage),
  supportTicketController.addMessage
);

// Provide feedback
router.post(
  '/tickets/:ticketId/feedback',
  vendorOnly,
  validate(supportTicketValidations.provideFeedback),
  supportTicketController.provideFeedback
);

module.exports = router;
