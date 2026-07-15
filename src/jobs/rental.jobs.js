const logger = require('../config/logger');
const { Rental, User, Product } = require('../models');
const { emitEvent, EVENTS } = require('../events');
const { addJob } = require('./index');

// Rental job processor
const process = async (type, data) => {
  logger.info(`Processing rental job: ${type}`, { data });

  switch (type) {
    case 'confirmation-reminder':
      return await handleConfirmationReminder(data);
      
    case 'completion-reminder':
      return await handleCompletionReminder(data);
      
    case 'return-reminder':
      return await handleReturnReminder(data);
      
    case 'review-reminder':
      return await handleReviewReminder(data);
      
    case 'check-overdue':
      return await handleCheckOverdue(data);
      
    case 'auto-cancel-pending':
      return await handleAutoCancelPending(data);
      
    case 'calculate-late-fees':
      return await handleCalculateLateFees(data);
      
    case 'generate-rental-report':
      return await handleGenerateRentalReport(data);
      
    default:
      throw new Error(`Unknown rental job type: ${type}`);
  }
};

// Handle confirmation reminder
const handleConfirmationReminder = async (data) => {
  const { rentalId, vendorId } = data;
  
  const rental = await Rental.findById(rentalId)
    .populate('user', 'email profile.firstName phone')
    .populate('vendor', 'user')
    .populate('product', 'basicInfo.name');

  if (!rental) {
    logger.error(`Rental not found for reminder: ${rentalId}`);
    return;
  }

  // Check if still pending
  if (rental.status === 'pending') {
    // Send reminder to vendor
    await addJob('notification', 'create', {
      userId: vendorId,
      type: 'in_app',
      title: 'Pending Rental Action Required',
      content: `Rental #${rental.rentalNumber} is still pending. Please confirm or reject.`,
      data: { rentalId: rental._id, rentalNumber: rental.rentalNumber },
    });

    // If pending for more than 48 hours, auto-cancel
    const pendingHours = (Date.now() - rental.createdAt) / (1000 * 60 * 60);
    if (pendingHours > 48) {
      await handleAutoCancelPending({ rentalId });
    }
  }
};

// Handle completion reminder
const handleCompletionReminder = async (data) => {
  const { rentalId, userId, endDate } = data;
  
  const daysLeft = Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24));
  
  if (daysLeft > 0 && daysLeft <= 3) {
    await addJob('notification', 'create', {
      userId,
      type: 'in_app',
      title: 'Rental Ending Soon',
      content: `Your rental ends in ${daysLeft} days. Please schedule return or request extension.`,
      data: { rentalId, daysLeft },
    });

    // Send email reminder
    await addJob('email', 'rental-reminder', {
      to: data.userEmail,
      name: data.userName,
      rentalNumber: data.rentalNumber,
      daysLeft,
      returnDate: endDate,
    });
  }
};

// Handle return reminder
const handleReturnReminder = async (data) => {
  const { userId, rentalId } = data;
  
  const rental = await Rental.findById(rentalId);
  if (!rental) return;

  await addJob('notification', 'create', {
    userId,
    type: 'in_app',
    title: 'Return Schedule',
    content: `Your rental return is scheduled for ${new Date(rental.rentalDetails.endDate).toLocaleDateString()}. Please ensure product is ready.`,
    data: { rentalId, endDate: rental.rentalDetails.endDate },
  });
};

// Handle review reminder
const handleReviewReminder = async (data) => {
  const { userId, rentalId } = data;
  
  await addJob('notification', 'create', {
    userId,
    type: 'in_app',
    title: 'How was your rental?',
    content: 'Please take a moment to review your rental experience.',
    data: { rentalId },
  });
};

// Handle check overdue
const handleCheckOverdue = async (data) => {
  const now = new Date();
  
  const overdueRentals = await Rental.find({
    status: 'active',
    'rentalDetails.endDate': { $lt: now },
  }).populate('user', 'email phone profile.firstName');

  for (const rental of overdueRentals) {
    const daysOverdue = Math.ceil((now - rental.rentalDetails.endDate) / (1000 * 60 * 60 * 24));
    const lateFee = daysOverdue * (rental.rentalDetails.monthlyRent / 30); // Daily rate
    
    // Update rental with overdue status
    rental.status = 'overdue';
    rental.lateFee = lateFee;
    await rental.save();

    // Emit overdue event
    emitEvent(EVENTS.RENTAL.OVERDUE, {
      _id: rental._id,
      rentalNumber: rental.rentalNumber,
      userId: rental.user,
      vendorId: rental.vendor,
      daysOverdue,
      lateFee,
    });
  }
};

// Handle auto cancel pending
const handleAutoCancelPending = async (data) => {
  const { rentalId } = data;
  
  const rental = await Rental.findById(rentalId)
    .populate('user', 'email phone profile.firstName');

  if (!rental || rental.status !== 'pending') return;

  // Cancel the rental
  rental.status = 'cancelled';
  rental.cancellation = {
    reason: 'Auto-cancelled due to no response',
    cancelledAt: new Date(),
    autoCancelled: true,
  };
  await rental.save();

  // Release inventory
  if (rental.inventory) {
    const Inventory = require('../models/Inventory.model');
    await Inventory.findByIdAndUpdate(rental.inventory, {
      status: 'available',
      currentRental: null,
    });
  }

  // Notify user
  await addJob('notification', 'create', {
    userId: rental.user._id,
    type: 'in_app',
    title: 'Rental Auto-cancelled',
    content: `Your rental #${rental.rentalNumber} has been auto-cancelled due to no response from vendor.`,
    data: { rentalId: rental._id, rentalNumber: rental.rentalNumber },
  });

  emitEvent(EVENTS.RENTAL.CANCELLED, {
    _id: rental._id,
    rentalNumber: rental.rentalNumber,
    userId: rental.user._id,
    vendorId: rental.vendor,
    reason: 'Auto-cancelled due to no response',
  });
};

// Handle calculate late fees
const handleCalculateLateFees = async (data) => {
  const overdueRentals = await Rental.find({
    status: 'overdue',
    'rentalDetails.endDate': { $lt: new Date() },
  });

  for (const rental of overdueRentals) {
    const daysOverdue = Math.ceil((new Date() - rental.rentalDetails.endDate) / (1000 * 60 * 60 * 24));
    const dailyRate = rental.rentalDetails.monthlyRent / 30;
    const lateFee = daysOverdue * dailyRate;
    
    rental.lateFee = lateFee;
    await rental.save();

    // Notify user
    await addJob('notification', 'create', {
      userId: rental.user,
      type: 'in_app',
      title: 'Late Fee Updated',
      content: `Late fee for rental #${rental.rentalNumber} is now ₹${lateFee}`,
      data: { rentalId: rental._id, lateFee },
    });
  }
};

// Handle generate rental report
const handleGenerateRentalReport = async (data) => {
  const { startDate, endDate, format = 'csv' } = data;
  
  const rentals = await Rental.find({
    createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) },
  })
    .populate('user', 'email phone profile')
    .populate('product', 'basicInfo.name')
    .lean();

  // Format data for report
  const reportData = rentals.map(rental => ({
    'Rental Number': rental.rentalNumber,
    'User Name': rental.user?.profile?.firstName + ' ' + rental.user?.profile?.lastName,
    'User Email': rental.user?.email,
    'Product': rental.product?.basicInfo?.name,
    'Start Date': rental.rentalDetails.startDate,
    'End Date': rental.rentalDetails.endDate,
    'Total Amount': rental.rentalDetails.totalAmount,
    'Status': rental.status,
    'Created At': rental.createdAt,
  }));

  // Generate file based on format
  let fileContent, contentType, fileName;
  
  if (format === 'csv') {
    const { Parser } = require('json2csv');
    const parser = new Parser();
    fileContent = parser.parse(reportData);
    contentType = 'text/csv';
    fileName = `rental-report-${Date.now()}.csv`;
  } else if (format === 'excel') {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(reportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Rentals');
    fileContent = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fileName = `rental-report-${Date.now()}.xlsx`;
  }

  // Send report via email if requested
  if (data.email) {
    await addJob('email', 'send', {
      to: data.email,
      subject: 'Rental Report',
      template: 'report',
      data: {
        startDate,
        endDate,
        totalRentals: rentals.length,
        totalAmount: rentals.reduce((sum, r) => sum + r.rentalDetails.totalAmount, 0),
      },
      attachments: [{
        filename: fileName,
        content: fileContent,
        contentType,
      }],
    });
  }

  return {
    success: true,
    data: reportData,
    fileContent,
    fileName,
    contentType,
  };
};

module.exports = { process };