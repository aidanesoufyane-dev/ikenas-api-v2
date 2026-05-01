const express = require('express');
const router = express.Router();
const { getMe, updateProfile } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Alias: GET /api/profile → GET /api/auth/me
router.get('/', protect, getMe);
// Alias: PATCH /api/profile → PUT /api/auth/profile
router.patch('/', protect, updateProfile);

module.exports = router;
