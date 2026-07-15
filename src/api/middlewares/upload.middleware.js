

const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const AppError = require('../../utils/AppError');
const sharp = require('sharp');
const { Readable } = require('stream');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// File filter for all file types
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|mp4|mov|avi/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(file.originalname.toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new AppError(`File type not allowed. Allowed types: images, PDF, DOC, DOCX, MP4, MOV, AVI`, 400));
};

// Memory storage for all uploads
const memoryStorage = multer.memoryStorage();

// Create base multer instances with different limits
const createMulterInstance = (maxSize) => {
  return multer({
    storage: memoryStorage,
    limits: { fileSize: maxSize },
    fileFilter
  });
};

// Upload to Cloudinary function
const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'rentease/uploads',
        resource_type: options.resource_type || 'auto',
        format: options.format,
        transformation: options.transformation,
        public_id: options.public_id,
        allowed_formats: options.allowed_formats
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    const readableStream = new Readable();
    readableStream.push(buffer);
    readableStream.push(null);
    readableStream.pipe(uploadStream);
  });
};

// Create multer instances with different configurations
const uploadImage = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload an image file', 400));
    }
  }
});

// const uploadDocument = multer({
//   storage: memoryStorage,
//   limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
//   fileFilter: (req, file, cb) => {
//     const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
//     if (allowedTypes.includes(file.mimetype)) {
//       cb(null, true);
//     } else {
//       cb(new AppError('Please upload a PDF or DOC file', 400));
//     }
//   }
// });

const uploadDocument = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      // PDF & DOC
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

      // Images
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload PDF, DOC, DOCX, or Image (jpg, png, webp)', 400), false);
    }
  }
});

const uploadVideo = multer({
  storage: memoryStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload a video file', 400));
    }
  }
});

const uploadMultiple = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

const uploadMemory = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

// Process and upload image with Sharp
const processAndUploadImage = async (file, folder = 'rentease/images') => {
  try {
    // Process image with Sharp
    const processedImage = await sharp(file.buffer)
      .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // Generate unique public_id
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const publicId = `${file.fieldname || 'image'}-${uniqueSuffix}`;

    // Upload to Cloudinary
    const result = await uploadToCloudinary(processedImage, {
      folder,
      format: 'webp',
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      transformation: [
        { width: 1000, height: 1000, crop: 'limit' },
        { quality: 'auto' }
      ],
      public_id: publicId
    });

    return result;
  } catch (error) {
    throw new AppError('Error processing image: ' + error.message, 500);
  }
};

// Upload document to Cloudinary
const uploadDocumentToCloudinary = async (file, folder = 'rentease/documents') => {
  try {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const publicId = `${file.fieldname || 'document'}-${uniqueSuffix}`;

    const result = await uploadToCloudinary(file.buffer, {
      folder,
      resource_type: 'raw',
      allowed_formats: ['pdf', 'doc', 'docx', 'jpeg', 'jpg', 'png', 'webp'],
      public_id: publicId
    });

    return result;
  } catch (error) {
    throw new AppError('Error uploading document: ' + error.message, 500);
  }
};

// Upload video to Cloudinary
const uploadVideoToCloudinary = async (file, folder = 'rentease/videos') => {
  try {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const publicId = `${file.fieldname || 'video'}-${uniqueSuffix}`;

    const result = await uploadToCloudinary(file.buffer, {
      folder,
      resource_type: 'video',
      allowed_formats: ['mp4', 'mov', 'avi'],
      public_id: publicId
    });

    return result;
  } catch (error) {
    throw new AppError('Error uploading video: ' + error.message, 500);
  }
};

// Middleware for handling multiple file uploads with processing
const uploadAndProcessImages = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next();
  }

  try {
    const uploadPromises = req.files.map(file => 
      processAndUploadImage(file, 'rentease/products')
    );

    const results = await Promise.all(uploadPromises);
    
    req.uploadedFiles = results.map(result => ({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      size: result.bytes
    }));

    next();
  } catch (error) {
    next(error);
  }
};

// Delete file from Cloudinary
const deleteFile = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });
    return result;
  } catch (error) {
    throw new AppError('Error deleting file: ' + error.message, 500);
  }
};

// Get file info
const getFileInfo = async (publicId) => {
  try {
    const result = await cloudinary.api.resource(publicId);
    return result;
  } catch (error) {
    throw new AppError('Error getting file info: ' + error.message, 500);
  }
};

// Generate signed URL for private files
const getSignedUrl = (publicId, options = {}) => {
  const timestamp = Math.round((new Date).getTime() / 1000);
  const signature = cloudinary.utils.api_sign_request({
    timestamp,
    ...options
  }, process.env.CLOUDINARY_API_SECRET);

  return cloudinary.url(publicId, {
    sign_url: true,
    timestamp,
    ...options
  });
};

// Middleware to handle upload errors
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('File too large. Max size: 5MB for images, 10MB for documents, 50MB for videos', 400));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new AppError('Too many files', 400));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError('Unexpected field', 400));
    }
  }
  next(err);
};

// Profile picture upload middleware
const uploadProfilePicture = [
  uploadImage.single('avatar'),
  handleUploadError,
  async (req, res, next) => {
    if (!req.file) {
      return next();
    }

    try {
      const result = await processAndUploadImage(req.file, 'rentease/profiles');
      req.fileUrl = result.secure_url;
      req.filePublicId = result.public_id;
      req.file = {
        ...req.file,
        path: result.secure_url,
        filename: result.public_id
      };
      next();
    } catch (error) {
      next(error);
    }
  }
];

// Product images upload middleware
const uploadProductImages = [
  uploadMemory.array('images', 10),
  handleUploadError,
  uploadAndProcessImages,
  (req, res, next) => {
    if (req.uploadedFiles) {
      req.body.images = req.uploadedFiles;
    }
    next();
  }
];

// KYC document upload middleware
const uploadKycDocuments = [
  uploadDocument.fields([
    { name: 'aadharFront', maxCount: 1 },
    { name: 'aadharBack', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'businessProof', maxCount: 1 }
  ]),
  
  handleUploadError,
  async (req, res, next) => {
    const documents = {};
    
    if (req.files) {
      try {
        const uploadPromises = [];
        
        Object.keys(req.files).forEach(key => {
          const file = req.files[key][0];
          const promise = uploadDocumentToCloudinary(file, 'rentease/kyc')
            .then(result => {
              documents[key] = {
                url: result.secure_url,
                publicId: result.public_id
              };
              // Add path and filename to the file object for backward compatibility
              file.path = result.secure_url;
              file.filename = result.public_id;
            });
          uploadPromises.push(promise);
        });
        
        await Promise.all(uploadPromises);
        req.kycDocuments = documents;
        next();
      } catch (error) {
        next(error);
      }
    } else {
      next();
    }
  },
];

// Single image upload middleware (for backward compatibility)
const uploadSingleImage = [
  uploadImage.single('image'),
  handleUploadError,
  async (req, res, next) => {
    if (!req.file) {
      return next();
    }

    try {
      const result = await processAndUploadImage(req.file, 'rentease/images');
      req.file.path = result.secure_url;
      req.file.filename = result.public_id;
      next();
    } catch (error) {
      next(error);
    }
  }
];

// Single document upload middleware
const uploadSingleDocument = [
  uploadDocument.single('document'),
  handleUploadError,
  async (req, res, next) => {
    if (!req.file) {
      return next();
    }

    try {
      const result = await uploadDocumentToCloudinary(req.file, 'rentease/documents');
      req.file.path = result.secure_url;
      req.file.filename = result.public_id;
      next();
    } catch (error) {
      next(error);
    }
  }
];

// Single video upload middleware
const uploadSingleVideo = [
  uploadVideo.single('video'),
  handleUploadError,
  async (req, res, next) => {
    if (!req.file) {
      return next();
    }

    try {
      const result = await uploadVideoToCloudinary(req.file, 'rentease/videos');
      req.file.path = result.secure_url;
      req.file.filename = result.public_id;
      next();
    } catch (error) {
      next(error);
    }
  }
];

// Vendor document upload configuration
const uploadVendorDocuments = [
  uploadDocument.fields([
    { name: 'gstCertificate', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'businessProof', maxCount: 1 },
    { name: 'addressProof', maxCount: 1 },
    { name: 'bankStatement', maxCount: 1 },
    { name: 'logo', maxCount: 1 }
  ]),

  handleUploadError,

  async (req, res, next) => {
    const documents = {};

    if (req.files) {
      try {
        const uploadPromises = [];

        Object.keys(req.files).forEach((key) => {
          const file = req.files[key][0];

          // 🔥 Decide folder dynamically
          let folder = 'rentease/vendor-docs';

          if (key === 'logo') {
            folder = 'rentease/vendor-logos';
          }

          const promise = uploadDocumentToCloudinary(file, folder)
            .then((result) => {
              documents[key] = {
                url: result.secure_url,
                publicId: result.public_id,
              };

              // backward compatibility
              file.path = result.secure_url;
              file.filename = result.public_id;
            });

          uploadPromises.push(promise);
        });

        await Promise.all(uploadPromises);

        // ✅ attach to request
        req.vendorDocuments = documents;

        next();
      } catch (error) {
        next(error);
      }
    } else {
      next();
    }
  }
];

// Create a generic upload instance with fields support
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB default
  fileFilter
});

// Also create a dedicated delivery upload instance
const uploadDelivery = multer({
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB for delivery photos/signatures
  fileFilter: (req, file, cb) => {
    // Allow only images for delivery
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload an image file', 400), false);
    }
  }
});

module.exports = {
  // Original multer instances
  uploadImage,
  uploadDocument,
  uploadVideo,
  uploadMultiple,
  uploadMemory,

  upload,           // Generic upload with fields support
  uploadDelivery,   // Dedicated delivery upload instance
  
  // Combined middleware
  uploadProfilePicture,
  uploadProductImages,
  uploadKycDocuments,

  uploadVendorDocuments,
  
  // Helper functions
  processAndUploadImage,
  deleteFile,
  getFileInfo,
  getSignedUrl,
  handleUploadError,
  
  // Additional exports for flexibility
  uploadSingleImage,
  uploadSingleDocument,
  uploadSingleVideo,
  uploadDocumentToCloudinary,
  uploadVideoToCloudinary
};