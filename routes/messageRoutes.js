/**
 * Routes Messages
 */
const express = require('express');
const router = express.Router();
const {
  sendMessage,
  getMessages,
  markAsRead,
  updateMessage,
  deleteMessage,
  getRecipients,
  replyToMessage,
} = require('../controllers/messageController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadMessageAttachments } = require('../middleware/upload');

router.get('/recipients', protect, roleCheck('admin', 'teacher', 'supervisor'), getRecipients);

router
  .route('/')
  .get(protect, getMessages)
  .post(
    protect,
    roleCheck('admin', 'teacher', 'supervisor'),
    uploadMessageAttachments.array('attachments', 10),
    sendMessage
  );

router.put('/:id/read', protect, markAsRead);
router.put('/:id', protect, updateMessage);
router.delete('/:id', protect, deleteMessage);
router.post('/:id/reply', protect, uploadMessageAttachments.array('attachments', 10), replyToMessage);

module.exports = router;
