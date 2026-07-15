const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const AppError = require('../../utils/AppError');
const constants = require('./constants');
const logger = require('./logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Ensure upload directories exist
const createUploadDirs = () => {
  const dirs = [
    'uploads/temp',
    'uploads/images',
    'uploads/documents',
    'uploads/videos'
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

createUploadDirs();

// File filter function
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = constants.ALLOWED_FILE_TYPES.IMAGES;
  const allowedDocumentTypes = constants.ALLOWED_FILE_TYPES.DOCUMENTS;
  const allowedVideoTypes = constants.ALLOWED_FILE_TYPES.VIDEOS;

  if (allowedImageTypes.includes(file.mimetype)) {
    file.fileType = 'image';
    cb(null, true);
  } else if (allowedDocumentTypes.includes(file.mimetype)) {
    file.fileType = 'document';
    cb(null, true);
  } else if (allowedVideoTypes.includes(file.mimetype)) {
    file.fileType = 'video';
    cb(null, true);
  } else {
    cb(new AppError(`File type not allowed. Allowed types: ${[...allowedImageTypes, ...allowedDocumentTypes, ...allowedVideoTypes].join(', ')}`, 400), false);
  }
};

// Local storage configuration
const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = 'uploads/temp';
    
    if (file.fileType === 'image') {
      uploadPath = 'uploads/images';
    } else if (file.fileType === 'document') {
      uploadPath = 'uploads/documents';
    } else if (file.fileType === 'video') {
      uploadPath = 'uploads/videos';
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

// Cloudinary storage for images
const imageCloudStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'rentease/images',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [
      { width: 1000, height: 1000, crop: 'limit' },
      { quality: 'auto' },
      { fetch_format: 'auto' }
    ],
    format: async (req, file) => 'webp', // Convert to webp for better compression
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const fieldName = file.fieldname || 'file';
      return `${fieldName}-${uniqueSuffix}`;
    }
  }
});

// Cloudinary storage for documents
const documentCloudStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'rentease/documents',
    allowed_formats: ['pdf', 'doc', 'docx'],
    resource_type: 'raw',
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const fieldName = file.fieldname || 'document';
      return `${fieldName}-${uniqueSuffix}`;
    }
  }
});

// Cloudinary storage for videos
const videoCloudStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'rentease/videos',
    allowed_formats: ['mp4', 'mov', 'avi', 'webm'],
    resource_type: 'video',
    chunk_size: 6000000, // 6MB chunks for large videos
    eager: [
      { width: 300, height: 300, crop: 'pad', audio_codec: 'none' }, // thumbnail
      { streaming_profile: 'hd', format: 'm3u8' } // HLS format for streaming
    ],
    eager_async: true,
    public_id: (req, file) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const fieldName = file.fieldname || 'video';
      return `${fieldName}-${uniqueSuffix}`;
    }
  }
});

// Dynamic storage selector based on file type
const getCloudStorage = (file) => {
  if (file.fileType === 'image') return imageCloudStorage;
  if (file.fileType === 'document') return documentCloudStorage;
  if (file.fileType === 'video') return videoCloudStorage;
  return imageCloudStorage; // default
};

// Cloudinary storage with dynamic type selection
const cloudStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, null); // Will be handled by Cloudinary
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

// Multer upload instances

// 1. Single image upload (for profile pictures, etc.)
const uploadSingleImage = multer({
  storage: process.env.NODE_ENV === 'production' ? imageCloudStorage : localStorage,
  limits: {
    fileSize: constants.UPLOAD_LIMITS.IMAGE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload an image file', 400));
    }
  }
});

// 2. Multiple images upload (for products)
const uploadMultipleImages = multer({
  storage: process.env.NODE_ENV === 'production' ? imageCloudStorage : localStorage,
  limits: {
    fileSize: constants.UPLOAD_LIMITS.IMAGE,
    files: constants.UPLOAD_LIMITS.MAX_IMAGES_PER_PRODUCT
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload an image file', 400));
    }
  }
});

// 3. Document upload (for KYC, etc.)
const uploadDocument = multer({
  storage: process.env.NODE_ENV === 'production' ? documentCloudStorage : localStorage,
  limits: {
    fileSize: constants.UPLOAD_LIMITS.DOCUMENT,
    files: 5
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = constants.ALLOWED_FILE_TYPES.DOCUMENTS;
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload a PDF or DOC file', 400));
    }
  }
});

// 4. Video upload
const uploadVideo = multer({
  storage: process.env.NODE_ENV === 'production' ? videoCloudStorage : localStorage,
  limits: {
    fileSize: constants.UPLOAD_LIMITS.VIDEO,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new AppError('Please upload a video file', 400));
    }
  }
});

// 5. Mixed files upload (any type)
const uploadMixed = multer({
  storage: process.env.NODE_ENV === 'production' ? cloudStorage : localStorage,
  limits: {
    fileSize: constants.UPLOAD_LIMITS.VIDEO, // Use max limit
    files: 10
  },
  fileFilter
});

// 6. Memory storage (for processing before upload)
const memoryStorage = multer.memoryStorage();
const uploadMemory = multer({
  storage: memoryStorage,
  limits: {
    fileSize: constants.UPLOAD_LIMITS.IMAGE,
    files: 10
  },
  fileFilter
});

// 7. Custom upload with field mapping
const uploadFields = (fields) => {
  return multer({
    storage: process.env.NODE_ENV === 'production' ? cloudStorage : localStorage,
    limits: {
      fileSize: constants.UPLOAD_LIMITS.VIDEO,
    },
    fileFilter
  }).fields(fields);
};

// 8. Bulk upload (array of files)
const uploadArray = (fieldName, maxCount = 10) => {
  return multer({
    storage: process.env.NODE_ENV === 'production' ? cloudStorage : localStorage,
    limits: {
      fileSize: constants.UPLOAD_LIMITS.IMAGE,
      files: maxCount
    },
    fileFilter
  }).array(fieldName, maxCount);
};

// Cleanup temporary files
const cleanupTempFiles = (files) => {
  if (!files) return;
  
  const filesArray = Array.isArray(files) ? files : [files];
  
  filesArray.forEach(file => {
    if (file.path && file.path.includes('temp')) {
      fs.unlink(file.path, (err) => {
        if (err) logger.error('Error deleting temp file:', err);
      });
    }
  });
};

// Get file info from Cloudinary
const getCloudinaryFileInfo = async (publicId) => {
  try {
    const result = await cloudinary.api.resource(publicId);
    return result;
  } catch (error) {
    logger.error('Error getting Cloudinary file info:', error);
    return null;
  }
};

// Delete file from Cloudinary
const deleteCloudinaryFile = async (publicId, resourceType = 'image') => {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });
    return result.result === 'ok';
  } catch (error) {
    logger.error('Error deleting Cloudinary file:', error);
    return false;
  }
};

// Generate signed URL for private files
const getSignedUrl = (publicId, options = {}) => {
  const timestamp = Math.round(Date.now() / 1000);
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

// Upload to Cloudinary with custom options
const uploadToCloudinary = async (filePath, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: options.folder || 'rentease/uploads',
      resource_type: options.resourceType || 'auto',
      ...options
    });
    return result;
  } catch (error) {
    logger.error('Error uploading to Cloudinary:', error);
    throw new AppError('Error uploading file', 500);
  }
};

// Create multer error handler
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(`File too large. Max size: ${constants.UPLOAD_LIMITS.IMAGE / (1024 * 1024)}MB`, 400));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new AppError(`Too many files. Max: ${constants.UPLOAD_LIMITS.MAX_IMAGES_PER_PRODUCT} files`, 400));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError('Unexpected field name', 400));
    }
    return next(new AppError(err.message, 400));
  }
  next(err);
};

// Pre-configured upload middlewares for common use cases

// Profile picture upload
const uploadProfilePicture = [
  uploadSingleImage.single('avatar'),
  handleMulterError,
  (req, res, next) => {
    if (!req.file) {
      return next();
    }
    req.fileUrl = req.file.path || req.file.secure_url;
    req.filePublicId = req.file.filename || req.file.public_id;
    next();
  }
];

// Product images upload
const uploadProductImages = [
  uploadMultipleImages.array('images', constants.UPLOAD_LIMITS.MAX_IMAGES_PER_PRODUCT),
  handleMulterError,
  (req, res, next) => {
    if (!req.files || req.files.length === 0) {
      return next();
    }
    req.uploadedFiles = req.files.map(file => ({
      url: file.path || file.secure_url,
      publicId: file.filename || file.public_id,
      size: file.size,
      mimetype: file.mimetype
    }));
    next();
  }
];

// KYC documents upload
const uploadKycDocuments = uploadFields([
  { name: 'aadharFront', maxCount: 1 },
  { name: 'aadharBack', maxCount: 1 },
  { name: 'panCard', maxCount: 1 },
  { name: 'businessProof', maxCount: 1 },
  { name: 'addressProof', maxCount: 1 }
]);

// Category image upload
const uploadCategoryImage = [
  uploadSingleImage.single('image'),
  handleMulterError,
  (req, res, next) => {
    if (!req.file) {
      return next();
    }
    req.imageUrl = req.file.path || req.file.secure_url;
    req.imagePublicId = req.file.filename || req.file.public_id;
    next();
  }
];

// Product video upload
const uploadProductVideo = [
  uploadVideo.single('video'),
  handleMulterError,
  (req, res, next) => {
    if (!req.file) {
      return next();
    }
    req.videoUrl = req.file.path || req.file.secure_url;
    req.videoPublicId = req.file.filename || req.file.public_id;
    req.videoDuration = req.file.duration;
    next();
  }
];

// Chat attachment upload
const uploadChatAttachment = uploadMixed.single('attachment');

module.exports = {
  // Upload instances
  uploadSingleImage,
  uploadMultipleImages,
  uploadDocument,
  uploadVideo,
  uploadMixed,
  uploadMemory,
  uploadFields,
  uploadArray,
  
  // Pre-configured middlewares
  uploadProfilePicture,
  uploadProductImages,
  uploadKycDocuments,
  uploadCategoryImage,
  uploadProductVideo,
  uploadChatAttachment,
  
  // Utility functions
  cleanupTempFiles,
  getCloudinaryFileInfo,
  deleteCloudinaryFile,
  getSignedUrl,
  uploadToCloudinary,
  handleMulterError,
  
  // Constants
  limits: constants.UPLOAD_LIMITS,
  allowedTypes: constants.ALLOWED_FILE_TYPES
};