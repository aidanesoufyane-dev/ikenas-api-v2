/**
 * Routes Élèves
 */
const express = require('express');
const router = express.Router();
const {
  createStudent, getStudents, getStudent, updateStudent, deleteStudent,
  uploadPhoto, importStudents, getMyChildren,
} = require('../controllers/studentController');
const { getBehaviorSummary, getBehaviorHistory } = require('../controllers/behaviorController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadAvatar, uploadExcel } = require('../middleware/upload');

// Import en masse (must be before /:id to avoid conflict)
router.post('/import', protect, roleCheck('admin'), uploadExcel.single('file'), importStudents);
router.get('/parent/children', protect, roleCheck('parent'), getMyChildren);

router
  .route('/')
  .get(protect, roleCheck('admin', 'teacher', 'reception'), getStudents)
  .post(protect, roleCheck('admin'), createStudent);

router
  .route('/:id')
  .get(protect, roleCheck('admin'), getStudent)
  .put(protect, roleCheck('admin'), updateStudent)
  .delete(protect, roleCheck('admin'), deleteStudent);

// Photo upload
router.put('/:id/photo', protect, roleCheck('admin'), uploadAvatar.single('avatar'), uploadPhoto);

// Behavior sub-routes (Flutter app calls /students/:studentId/behavior/*)
router.get('/:studentId/behavior/summary', protect, (req, res, next) => {
  req.query.studentId = req.params.studentId;
  next();
}, getBehaviorSummary);
router.get('/:studentId/behavior/history', protect, (req, res, next) => {
  req.query.studentId = req.params.studentId;
  next();
}, getBehaviorHistory);

module.exports = router;
