// controllers/upload.controller.js
const cloudinary = require('cloudinary').v2;
const catchAsync = require('../../utils/catchAsync');
const { ApiResponse } = require('../../utils/apiResponse');
const { AppError } = require('../../utils/AppError');
const logger = require('../../config/logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

class UploadController {
  /**
   * Upload single image
   */
  uploadImage = catchAsync(async (req, res) => {
    try {
      // Handle both file upload (multer) and base64
      let imageFile;
      
      if (req.file) {
        // File uploaded via multer
        imageFile = req.file.path;
      } else if (req.body.image) {
        // Base64 image
        imageFile = req.body.image;
      } else {
        throw new AppError('No image provided', 400);
      }

      const folder = req.body.folder || 'categories';
      
      // Upload to Cloudinary
      const result = await cloudinary.uploader.upload(imageFile, {
        folder: folder,
        transformation: [
          { width: 800, height: 800, crop: 'limit', quality: 'auto' }
        ]
      });

      // Generate thumbnail URL
      const thumbnail = cloudinary.url(result.public_id, {
        width: 200,
        height: 200,
        crop: 'fill',
        quality: 'auto'
      });

      return ApiResponse.success(res, 200, 'Image uploaded successfully', {
        url: result.secure_url,
        thumbnail: thumbnail,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        size: result.bytes
      });
    } catch (error) {
      logger.error('Error uploading image:', error);
      throw new AppError(error.message || 'Failed to upload image', 500);
    }
  });

  /**
   * Upload multiple images
   */
  uploadMultipleImages = catchAsync(async (req, res) => {
    try {
      const files = req.files;
      
      if (!files || files.length === 0) {
        // Check for base64 array
        if (req.body.images && Array.isArray(req.body.images)) {
          const uploadPromises = req.body.images.map(image => 
            cloudinary.uploader.upload(image, {
              folder: req.body.folder || 'categories',
              transformation: [
                { width: 800, height: 800, crop: 'limit', quality: 'auto' }
              ]
            })
          );
          
          const results = await Promise.all(uploadPromises);
          
          const uploadedImages = results.map(result => ({
            url: result.secure_url,
            thumbnail: cloudinary.url(result.public_id, {
              width: 200,
              height: 200,
              crop: 'fill',
              quality: 'auto'
            }),
            publicId: result.public_id
          }));

          return ApiResponse.success(res, 200, 'Images uploaded successfully', {
            images: uploadedImages
          });
        }
        throw new AppError('No images provided', 400);
      }

      // Upload multer files
      const uploadPromises = files.map(file => 
        cloudinary.uploader.upload(file.path, {
          folder: req.body.folder || 'categories',
          transformation: [
            { width: 800, height: 800, crop: 'limit', quality: 'auto' }
          ]
        })
      );

      const results = await Promise.all(uploadPromises);
      
      const uploadedImages = results.map(result => ({
        url: result.secure_url,
        thumbnail: cloudinary.url(result.public_id, {
          width: 200,
          height: 200,
          crop: 'fill',
          quality: 'auto'
        }),
        publicId: result.public_id
      }));

      return ApiResponse.success(res, 200, 'Images uploaded successfully', {
        images: uploadedImages
      });
    } catch (error) {
      logger.error('Error uploading multiple images:', error);
      throw new AppError(error.message || 'Failed to upload images', 500);
    }
  });

  /**
   * Delete image from Cloudinary
   */
  deleteImage = catchAsync(async (req, res) => {
    try {
      const { publicId } = req.body;
      
      if (!publicId) {
        throw new AppError('Public ID is required', 400);
      }

      const result = await cloudinary.uploader.destroy(publicId);

      if (result.result === 'ok') {
        return ApiResponse.success(res, 200, 'Image deleted successfully');
      } else {
        throw new AppError('Failed to delete image', 400);
      }
    } catch (error) {
      logger.error('Error deleting image:', error);
      throw new AppError(error.message || 'Failed to delete image', 500);
    }
  });

  /**
   * Generate upload signature for direct frontend upload
   */
  generateUploadSignature = catchAsync(async (req, res) => {
    try {
      const timestamp = Math.round(new Date().getTime() / 1000);
      const folder = req.body.folder || 'categories';
      
      const signature = cloudinary.utils.api_sign_request(
        {
          timestamp: timestamp,
          folder: folder,
        },
        process.env.CLOUDINARY_API_SECRET
      );

      return ApiResponse.success(res, 200, 'Signature generated', {
        signature,
        timestamp,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        folder
      });
    } catch (error) {
      logger.error('Error generating signature:', error);
      throw new AppError('Failed to generate signature', 500);
    }
  });
}

module.exports = new UploadController();