const express = require('express');
const router = express.Router();
const { getSettings, updateSettings, toggleSetting } = require('../controllers/settingsController');
const { protect, roleCheck } = require('../middleware/auth');

// Get all settings (accessible to all authenticated users, but only admin can modify)
router.get('/', protect, getSettings);

// Update settings (admin only)
router.put('/', protect, roleCheck('admin'), updateSettings);

// Toggle single setting (admin only)
router.put('/:setting/toggle', protect, roleCheck('admin'), toggleSetting);

module.exports = router;
