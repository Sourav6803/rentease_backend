// services/delivery-proof.service.js - Proof of Delivery Service
const { Delivery } = require('../models');
const { addJob } = require('../jobs');
const logger = require('../config/logger');
const cloudinary = require('cloudinary').v2;

class DeliveryProofService {
  constructor() {
    // Configure Cloudinary (add to your .env)
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }

  /**
   * Upload signature image
   */
  async uploadSignature(deliveryId, signatureData, capturedBy) {
    try {
      let signatureUrl = null;
      
      if (signatureData.base64) {
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(signatureData.base64, {
          folder: `delivery-signatures/${deliveryId}`,
          public_id: `signature_${Date.now()}`,
          transformation: [{ width: 800, crop: 'limit' }]
        });
        signatureUrl = result.secure_url;
      } else if (signatureData.url) {
        signatureUrl = signatureData.url;
      }
      
      const delivery = await Delivery.findById(deliveryId);
      if (!delivery) {
        throw new Error('Delivery not found');
      }
      
      delivery.proof = delivery.proof || {};
      delivery.proof.signature = {
        data: signatureUrl,
        capturedAt: new Date(),
        capturedBy,
        deviceInfo: signatureData.deviceInfo
      };
      
      await delivery.save();
      
      return {
        uploaded: true,
        signatureUrl,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error uploading signature:', error);
      throw error;
    }
  }

  /**
   * Upload delivery photos
   */
  async uploadDeliveryPhotos(deliveryId, photos, uploadedBy) {
    try {
      const uploadedPhotos = [];
      
      for (const photo of photos) {
        let photoUrl = null;
        
        if (photo.base64) {
          const result = await cloudinary.uploader.upload(photo.base64, {
            folder: `delivery-photos/${deliveryId}`,
            public_id: `photo_${Date.now()}_${uploadedPhotos.length}`,
            transformation: [{ width: 1200, crop: 'limit' }]
          });
          photoUrl = result.secure_url;
        } else if (photo.url) {
          photoUrl = photo.url;
        }
        
        uploadedPhotos.push({
          url: photoUrl,
          caption: photo.caption || '',
          timestamp: new Date(),
          uploadedBy,
          location: photo.location
        });
      }
      
      const delivery = await Delivery.findById(deliveryId);
      if (!delivery) {
        throw new Error('Delivery not found');
      }
      
      delivery.proof = delivery.proof || {};
      delivery.proof.photos = [...(delivery.proof.photos || []), ...uploadedPhotos];
      
      await delivery.save();
      
      return {
        uploaded: uploadedPhotos.length,
        photos: uploadedPhotos
      };
    } catch (error) {
      logger.error('Error uploading photos:', error);
      throw error;
    }
  }

  /**
   * Add delivery notes
   */
  async addDeliveryNotes(deliveryId, notes, addedBy) {
    try {
      const delivery = await Delivery.findById(deliveryId);
      if (!delivery) {
        throw new Error('Delivery not found');
      }
      
      delivery.proof = delivery.proof || {};
      delivery.proof.notes = delivery.proof.notes || [];
      delivery.proof.notes.push({
        content: notes,
        timestamp: new Date(),
        addedBy
      });
      
      await delivery.save();
      
      return {
        added: true,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Error adding delivery notes:', error);
      throw error;
    }
  }

  /**
   * Complete delivery with full proof
   */
  async completeDeliveryWithProof(deliveryId, proofData, completedBy) {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const delivery = await Delivery.findById(deliveryId).session(session);
      if (!delivery) {
        throw new Error('Delivery not found');
      }
      
      // Upload signature if provided
      if (proofData.signature) {
        await this.uploadSignature(deliveryId, proofData.signature, completedBy);
      }
      
      // Upload photos if provided
      if (proofData.photos && proofData.photos.length > 0) {
        await this.uploadDeliveryPhotos(deliveryId, proofData.photos, completedBy);
      }
      
      // Add notes if provided
      if (proofData.notes) {
        await this.addDeliveryNotes(deliveryId, proofData.notes, completedBy);
      }
      
      // Update delivery status
      delivery.status = 'delivered';
      delivery.tracking.actualArrival = new Date();
      delivery.deliveredBy = completedBy;
      delivery.deliveredAt = new Date();
      
      // Add recipient info
      delivery.proof.recipient = {
        name: proofData.recipientName,
        phone: proofData.recipientPhone,
        receivedAt: new Date()
      };
      
      delivery.tracking.timeline.push({
        status: 'delivered',
        timestamp: new Date(),
        note: `Delivery completed by ${completedBy}`,
        updatedBy: completedBy
      });
      
      await delivery.save({ session });
      
      // Update rental status
      const Rental = require('../models/Rental.model');
      await Rental.findByIdAndUpdate(
        delivery.rental,
        {
          status: 'delivered',
          'delivery.actualDate': new Date(),
          'delivery.status': 'delivered',
          'delivery.receivedBy': proofData.recipientName,
          'delivery.signature': proofData.signature?.url
        },
        { session }
      );
      
      await session.commitTransaction();
      
      return {
        completed: true,
        deliveryId,
        timestamp: new Date(),
        proof: {
          hasSignature: !!proofData.signature,
          photoCount: proofData.photos?.length || 0,
          hasNotes: !!proofData.notes
        }
      };
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error completing delivery with proof:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Generate delivery report PDF
   */
  async generateDeliveryReport(deliveryId) {
    try {
      const delivery = await Delivery.findById(deliveryId)
        .populate('rental')
        .populate('address')
        .lean();
      
      if (!delivery) {
        throw new Error('Delivery not found');
      }
      
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument();
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      
      // Add header
      doc.fontSize(20).text('Delivery Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Delivery Number: ${delivery.deliveryNumber}`);
      doc.text(`Date: ${new Date().toLocaleDateString()}`);
      doc.text(`Status: ${delivery.status}`);
      doc.moveDown();
      
      // Add delivery details
      doc.fontSize(14).text('Delivery Details');
      doc.fontSize(12);
      doc.text(`Customer: ${delivery.contact?.name || 'N/A'}`);
      doc.text(`Phone: ${delivery.contact?.phone || 'N/A'}`);
      doc.text(`Address: ${delivery.address?.fullAddress || 'N/A'}`);
      doc.moveDown();
      
      // Add timeline
      doc.fontSize(14).text('Delivery Timeline');
      delivery.tracking?.timeline?.forEach(event => {
        doc.fontSize(10).text(`${new Date(event.timestamp).toLocaleString()}: ${event.status} - ${event.note || ''}`);
      });
      
      doc.end();
      
      return new Promise((resolve) => {
        doc.on('end', () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });
      });
    } catch (error) {
      logger.error('Error generating delivery report:', error);
      throw error;
    }
  }
}

module.exports = new DeliveryProofService();