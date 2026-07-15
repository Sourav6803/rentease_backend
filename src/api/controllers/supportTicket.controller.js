// controllers/supportTicket.controller.js
// const SupportTicketService = require('../services/supportTicket.service');
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { AppError } = require('../../utils/AppError');
const logger = require('../../config/logger');
const SupportTicketService = require('../../services/supportTicket.service');

class SupportTicketController {
  /**
   * Create a new support ticket (Vendor)
   */
  createTicket = catchAsync(async (req, res) => {
    const userId = req.user._id;
    const userType = req.userRole; // 'user' or 'vendor'
    
    const ticket = await SupportTicketService.createTicket(userId, userType, req.body);
    
    return ApiResponse.success(res, 201, 'Support ticket created successfully', {
      ticket
    });
  });

  /**
   * Get ticket by ID (Vendor)
   */
  getTicketById = catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const userId = req.user._id;
    const userType = req.userRole;
    
    const ticket = await SupportTicketService.getTicketById(ticketId, userId, userType);
    
    return ApiResponse.success(res, 200, 'Ticket retrieved successfully', {
      ticket
    });
  });

  /**
   * Get user tickets (Vendor)
   */
  getUserTickets = catchAsync(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 10, status, priority, type, search } = req.query;
    
    const tickets = await SupportTicketService.getUserTickets(userId, parseInt(page), parseInt(limit), {
      status,
      priority,
      type,
      search
    });
    
    return ApiResponse.success(res, 200, 'Tickets retrieved successfully', tickets);
  });

  /**
   * Add message to ticket (Vendor)
   */
  addMessage = catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const userId = req.user._id;
    const userType = req.userRole;
    
    const message = await SupportTicketService.addMessage(ticketId, userId, userType, req.body);
    
    return ApiResponse.success(res, 200, 'Message added successfully', {
      message
    });
  });

  /**
   * Provide feedback for resolved ticket (Vendor)
   */
  provideFeedback = catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const userId = req.user._id;
    
    const feedback = await SupportTicketService.provideFeedback(ticketId, userId, req.body);
    
    return ApiResponse.success(res, 200, 'Feedback submitted successfully', {
      feedback
    });
  });

  /**
   * Get ticket statistics (Vendor)
   */
  getTicketStats = catchAsync(async (req, res) => {
    const userId = req.user._id;
    
    const stats = await SupportTicketService.getTicketStats(userId);
    
    return ApiResponse.success(res, 200, 'Ticket statistics retrieved successfully', stats);
  });

  // ==================== ADMIN ROUTES ====================

  /**
   * Get all tickets (Admin)
   */
  getAllTickets = catchAsync(async (req, res) => {
    const { page = 1, limit = 20, status, priority, type, assignedTo, search } = req.query;
    
    const tickets = await SupportTicketService.getAllTickets(
      parseInt(page), 
      parseInt(limit), 
      { status, priority, type, assignedTo, search }
    );
    
    return ApiResponse.success(res, 200, 'All tickets retrieved successfully', tickets);
  });

  /**
   * Update ticket status (Admin)
   */
  updateStatus = catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const adminId = req.admin._id;
    
    const ticket = await SupportTicketService.updateStatus(ticketId, adminId, req.body);
    
    return ApiResponse.success(res, 200, 'Ticket status updated successfully', {
      ticket
    });
  });

  /**
   * Assign ticket to admin (Admin)
   */
  assignTicket = catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const adminId = req.admin._id;
    
    const ticket = await SupportTicketService.assignTicket(ticketId, adminId, req.body);
    
    return ApiResponse.success(res, 200, 'Ticket assigned successfully', {
      ticket
    });
  });

  /**
   * Get single ticket by ID (Admin) — admins can view any ticket
   */
  getTicketByIdAdmin = catchAsync(async (req, res) => {
    const { ticketId } = req.params;

    const ticket = await SupportTicketService.getTicketById(ticketId, req.admin._id, 'admin');

    return ApiResponse.success(res, 200, 'Ticket retrieved successfully', {
      ticket
    });
  });

  /**
   * Add reply / message to a ticket (Admin)
   */
  adminAddMessage = catchAsync(async (req, res) => {
    const { ticketId } = req.params;
    const adminId = req.admin._id;

    const message = await SupportTicketService.addMessage(ticketId, adminId, 'admin', req.body);

    return ApiResponse.success(res, 200, 'Reply sent successfully', {
      message
    });
  });

  /**
   * Get dashboard stats (Admin)
   */
  getDashboardStats = catchAsync(async (req, res) => {
    const stats = await SupportTicketService.getDashboardStats();

    return ApiResponse.success(res, 200, 'Dashboard stats retrieved successfully', stats);
  });
}

module.exports = new SupportTicketController();