const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

// Stub endpoints — security/geofencing feature not implemented
router.get('/status', protect, (req, res) => {
  res.status(200).json({
    success: true,
    data: { enabled: false, status: 'inactive', zones: [] },
  });
});

router.get('/alerts', protect, (req, res) => {
  res.status(200).json({
    success: true,
    data: [],
  });
});

module.exports = router;
