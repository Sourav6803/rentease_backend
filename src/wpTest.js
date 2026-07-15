// // services/smsService.js
// const twilio = require('twilio');

// // Initialize the Twilio client with credentials from environment variables
// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;
// const client = twilio(accountSid, authToken);

// console.log('accountSid-->', accountSid)
// console.log('authToken-->', authToken)
// console.log('phone_number-->', process.env.TWILIO_PHONE_NUMBER)
// console.log('verify_service_sid-->', process.env.TWILIO_VERIFY_SERVICE_SID)

// /**
//  * Sends an SMS message to a recipient.
//  * @param {string} to - The recipient's phone number in E.164 format (e.g., +15551234567).
//  * @param {string} body - The text content of the message.
//  * @returns {Promise<object>} The Twilio message object.
//  */
// async function sendSMS(to, body) {
//   try {
//     const message = await client.messages.create({
//       body: body,
//       from: process.env.TWILIO_PHONE_NUMBER,
//       to: to,
//     });
//     console.log(`Message sent successfully. SID: ${message.sid}`);
//     return message;
//   } catch (error) {
//     console.error(`Failed to send SMS: ${error.message}`);
//     throw new Error(`Twilio Error: ${error.message}`);
//   }
// }

// sendSMS('+7908104094', 'Hello from RentEase! This is a test message dssdds.')

// // module.exports = { sendSMS };