/**
 * Routes LeaveRequest — Demandes de congé / absence professeurs
 */
const express    = require('express');
const router     = express.Router();
const {
  createLeaveRequest,
  getMyLeaveRequests,
  getAllLeaveRequests,
  updateLeaveStatus,
} = require('../controllers/leaveRequestController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadLeaveAttachments } = require('../middleware/upload');

// Prof
router.get ('/my',         protect, roleCheck('teacher'), getMyLeaveRequests);
router.post('/',           protect, roleCheck('teacher'), uploadLeaveAttachments.array('attachments', 5), createLeaveRequest);

// Admin
router.get ('/',           protect, roleCheck('admin'), getAllLeaveRequests);
router.put ('/:id/status', protect, roleCheck('admin'), updateLeaveStatus);

module.exports = router;
