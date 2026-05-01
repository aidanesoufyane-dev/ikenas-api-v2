/**
 * Routes Notifications
 */
const express = require('express');
const router = express.Router();
const {
  getMyNotifications,
  markAsRead,
  getUnreadCount,
  deleteNotification,
  clearNotifications,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');

router.get('/', protect, getMyNotifications);
router.get('/unread-count', protect, getUnreadCount);
router.put('/read', protect, markAsRead);
router.post('/read', protect, markAsRead);
router.post('/mark-all-read', protect, (req, res, next) => {
  req.body = {};
  next();
}, markAsRead);
router.delete('/', protect, clearNotifications);
router.delete('/:id', protect, deleteNotification);

module.exports = router;
