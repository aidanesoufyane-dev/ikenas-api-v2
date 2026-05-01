/**
 * Routes d'authentification
 */
const express = require('express');
const router = express.Router();
const { login, register, getMe, getAvatarPresets, updateMyAvatar, updatePassword, updateFcmToken, updateProfile } = require('../controllers/authController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');

// Routes publiques
router.post('/login', login);

// Routes protégées
router.post('/register', protect, roleCheck('admin'), register);
router.get('/me', protect, getMe);
router.get('/avatar-presets', protect, getAvatarPresets);
router.put('/avatar', protect, uploadAvatar.single('avatar'), updateMyAvatar);
router.put('/update-password', protect, updatePassword);
router.post('/fcm-token', protect, updateFcmToken);
router.put('/profile', protect, updateProfile);

module.exports = router;
