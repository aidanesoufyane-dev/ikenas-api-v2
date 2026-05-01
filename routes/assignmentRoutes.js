/**
 * Routes Devoirs et Soumissions
 */
const express = require('express');
const router = express.Router();
const {
  createAssignment, getAssignments, getAssignment,
  deleteAssignment, submitAssignment, getSubmissions, getSubmissionStatus,
} = require('../controllers/assignmentController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadAssignment, uploadSubmission } = require('../middleware/upload');

// CRUD Devoirs
router
  .route('/')
  .get(protect, getAssignments)
  .post(protect, roleCheck('teacher'), uploadAssignment.array('files', 5), createAssignment);

router
  .route('/:id')
  .get(protect, getAssignment)
  .delete(protect, roleCheck('teacher', 'admin'), deleteAssignment);

// Soumissions
router.post('/:id/submit', protect, roleCheck('student', 'parent'), uploadSubmission.array('files', 3), submitAssignment);
router.get('/:id/submissions', protect, roleCheck('teacher', 'admin', 'supervisor'), getSubmissions);
router.get('/:id/submissions-status', protect, roleCheck('teacher', 'admin', 'supervisor'), getSubmissionStatus);

module.exports = router;
