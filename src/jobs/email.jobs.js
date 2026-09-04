const logger = require('../config/logger');
const emailService = require('../services/email.service');

// Email job processor
const process = async (type, data) => {
  logger.info(`Processing email job: ${type}`);

  switch (type) {
    case 'send':
      return await emailService.sendEmail(data);
      
    case 'welcome':
      return await emailService.sendEmail({
        to: data.to,
        subject: 'Welcome to RentEase!',
        template: 'welcome',
        data: {
          name: data.name,
          userId: data.userId,
        },
      });
      
    case 'rental-created':
      return await emailService.sendEmail({
        to: data.to,
        subject: `New Rental Order #${data.rentalNumber} - Action Required`,
        template: 'rental-created',
        data: {
          vendorName: data.vendorName,
          customerName: data.customerName,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          startDate: data.startDate,
          endDate: data.endDate,
          monthlyRent: data.monthlyRent,
          securityDeposit: data.securityDeposit,
          totalAmount: data.totalAmount,
          deliveryAddress: data.deliveryAddress,
          verifyUrl: data.verifyUrl,
        },
      });

    case 'rental-confirmed':
      return await emailService.sendEmail({
        to: data.to,
        subject: `Rental Confirmed #${data.rentalNumber} - RentEase`,
        template: 'rental-confirmed',
        data: {
          name: data.name,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          startDate: data.startDate,
          endDate: data.endDate,
          monthlyRent: data.monthlyRent,
          securityDeposit: data.securityDeposit,
          totalAmount: data.totalAmount,
          deliveryAddress: data.deliveryAddress,
          trackUrl: data.trackUrl,
        },
      });
      
    case 'payment-success':
      return await emailService.sendEmail({
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
      return await emailService.sendEmail({
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
      return await emailService.sendEmail({
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
      return await emailService.sendEmail({
        to: data.to,
        subject: 'KYC Approved - RentEase',
        template: 'kyc-approved',
        data: {
          name: data.name,
        },
      });
      
    case 'kyc-rejected':
      return await emailService.sendEmail({
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
      return await emailService.sendEmail({
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
      return await emailService.sendEmail({
        to: data.to,
        subject: data.subject,
        template: 'newsletter',
        data: typeof data.content === 'string'
          ? { title: data.subject || 'RentEase Updates', body: data.content }
          : (data.content || {}),
      });
      
    case 'delivery-out-for-delivery':
      return await emailService.sendEmail({
        to: data.to,
        subject: `Your Order Is Out for Delivery #${data.deliveryNumber} - RentEase`,
        template: 'delivery-out-for-delivery',
        data: {
          name: data.name,
          deliveryNumber: data.deliveryNumber,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          deliveryDate: data.deliveryDate,
          deliverySlot: data.deliverySlot,
          address: data.address,
          trackUrl: data.trackUrl,
        },
      });

    case 'delivery-in-transit':
      return await emailService.sendEmail({
        to: data.to,
        subject: `Your Delivery Is On the Way #${data.deliveryNumber} - RentEase`,
        template: 'delivery-in-transit',
        data: {
          name: data.name,
          deliveryNumber: data.deliveryNumber,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          estimatedArrival: data.estimatedArrival,
          address: data.address,
          trackUrl: data.trackUrl,
        },
      });

    case 'delivery-reached':
      return await emailService.sendEmail({
        to: data.to,
        subject: `Your Delivery Partner Has Arrived #${data.deliveryNumber} - RentEase`,
        template: 'delivery-reached',
        data: {
          name: data.name,
          deliveryNumber: data.deliveryNumber,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          address: data.address,
          trackUrl: data.trackUrl,
        },
      });

    case 'delivery-delivered':
      return await emailService.sendEmail({
        to: data.to,
        subject: data.isVendor
          ? `Delivery Completed #${data.deliveryNumber} - RentEase`
          : `Your Order Has Been Delivered #${data.deliveryNumber} - RentEase`,
        template: 'delivery-delivered',
        data: {
          name: data.name,
          isVendor: data.isVendor,
          deliveryNumber: data.deliveryNumber,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          receivedBy: data.receivedBy,
          address: data.address,
          trackUrl: data.trackUrl,
        },
      });

    case 'delivery-failed':
      return await emailService.sendEmail({
        to: data.to,
        subject: data.isVendor
          ? `Delivery Failed #${data.deliveryNumber} - Action Required`
          : `Delivery Attempt Failed #${data.deliveryNumber} - RentEase`,
        template: 'delivery-failed',
        data: {
          name: data.name,
          isVendor: data.isVendor,
          deliveryNumber: data.deliveryNumber,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          reason: data.reason,
          rescheduled: data.rescheduled,
          address: data.address,
          trackUrl: data.trackUrl,
        },
      });

    case 'delivery-cancelled':
      return await emailService.sendEmail({
        to: data.to,
        subject: `Order Cancelled #${data.rentalNumber} - RentEase`,
        template: 'delivery-cancelled',
        data: {
          name: data.name,
          isVendor: data.isVendor,
          deliveryNumber: data.deliveryNumber,
          rentalNumber: data.rentalNumber,
          productName: data.productName,
          reason: data.reason,
          refundAmount: data.refundAmount,
          address: data.address,
          trackUrl: data.trackUrl,
        },
      });

    case 'delivery-otp':
      return await emailService.sendEmail({
        to: data.to,
        subject: `Your Delivery OTP - RentEase`,
        template: 'delivery-otp',
        data: {
          name: data.name,
          otp: data.otp,
          deliveryNumber: data.deliveryNumber,
          expiryMinutes: data.expiryMinutes,
        },
      });

    default:
      throw new Error(`Unknown email job type: ${type}`);
  }
};

module.exports = { process };
