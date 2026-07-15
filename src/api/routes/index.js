const express = require('express');
const router = express.Router();

// Import versioned routes
const v1Routes = require('./v1');

// Health check
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
    version: 'v1',
  });
});

// API documentation redirect
router.get('/', (req, res) => {
  res.redirect('/api-docs');
});

// Mount versioned routes
router.use('/', v1Routes);

// API version info
router.get('/version', (req, res) => {
  res.json({
    currentVersion: 'v1',
    supportedVersions: ['v1'],
    latestVersion: 'v1',
    deprecationDate: null,
    sunsetDate: null,
  });
});

// Test route directly on this router
router.get('/test', (req, res) => {
  res.json({ message: 'API router test works!' });
});

module.exports = router;