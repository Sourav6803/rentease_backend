const logger = require('../config/logger');
const { sendEmail } = require('../services/email.service');

// Email job processor
const process = async (type, data) => {
  logger.info(`Processing email job: ${type}`);

  switch (type) {
    case 'send':
      return await sendEmail(data);
      
    case 'welcome':
      return await sendEmail({
        to: data.to,
        subject: 'Welcome to RentEase!',
        template: 'welcome',
        data: {
          name: data.name,
          userId: data.userId,
        },
      });
      
    case 'rental-confirmed':
      return await sendEmail({
        to: data.to,
        subject: 'Rental Confirmed - RentEase',
        template: 'rental-confirmed',
        data: {
          name: data.name,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          startDate: data.startDate,
          endDate: data.endDate,
          totalAmount: data.totalAmount,
        },
      });
      
    case 'payment-success':
      return await sendEmail({
        to: data.to,
        subject: 'Payment Successful - RentEase',
        template: 'payment-success',
        data: {
          name: data.name,
          amount: data.amount,
          paymentId: data.paymentId,
          rentalNumber: data.rentalNumber,
          date: data.date,
        },
      });
      
    case 'payment-failed':
      return await sendEmail({
        to: data.to,
        subject: 'Payment Failed - RentEase',
        template: 'payment-failed',
        data: {
          name: data.name,
          amount: data.amount,
          rentalNumber: data.rentalNumber,
          reason: data.reason,
        },
      });
      
    case 'rental-reminder':
      return await sendEmail({
        to: data.to,
        subject: 'Rental Reminder - RentEase',
        template: 'rental-reminder',
        data: {
          name: data.name,
          rentalNumber: data.rentalNumber,
          daysLeft: data.daysLeft,
          returnDate: data.returnDate,
        },
      });
      
    case 'kyc-approved':
      return await sendEmail({
        to: data.to,
        subject: 'KYC Approved - RentEase',
        template: 'kyc-approved',
        data: {
          name: data.name,
        },
      });
      
    case 'kyc-rejected':
      return await sendEmail({
        to: data.to,
        subject: 'KYC Update - RentEase',
        template: 'kyc-rejected',
        data: {
          name: data.name,
          reason: data.reason,
          comments: data.comments,
        },
      });
      
    case 'invoice':
      return await sendEmail({
        to: data.to,
        subject: `Invoice #${data.invoiceNumber} - RentEase`,
        template: 'invoice',
        data: {
          name: data.name,
          invoiceNumber: data.invoiceNumber,
          items: data.items,
          total: data.total,
          dueDate: data.dueDate,
        },
        attachments: data.attachments,
      });
      
    case 'newsletter':
      return await sendEmail({
        to: data.to,
        subject: data.subject,
        template: 'newsletter',
        data: data.content,
      });
      
    default:
      throw new Error(`Unknown email job type: ${type}`);
  }
};

module.exports = { process };