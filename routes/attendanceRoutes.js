/**
 * Routes Absences
 */
const express = require('express');
const router = express.Router();
const {
  createAttendance, createBulkAttendance, getAttendances,
  getClassScheduleForDate, updateAttendance, approveAttendance, approveBulk, getDailyReport,
  getMyAttendances, justifyAttendance,
} = require('../controllers/attendanceController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadAttendanceJustification } = require('../middleware/upload');

// Vue élève (présence/absence)
router.get('/me', protect, roleCheck('student', 'parent'), getMyAttendances);
router.put('/:id/justify', protect, roleCheck('student', 'parent'), uploadAttendanceJustification.single('attachment'), justifyAttendance);

// Rapport journalier admin (classe + date → tableau élèves)
router.get('/daily-report', protect, roleCheck('admin'), getDailyReport);

// Emploi du temps d'une classe pour une date (pour le prof)
router.get('/class-schedule', protect, roleCheck('admin', 'teacher', 'reception'), getClassScheduleForDate);

// Absences en masse
router.post('/bulk', protect, roleCheck('admin', 'teacher', 'reception'), createBulkAttendance);

// Approbation en masse admin
router.put('/approve-bulk', protect, roleCheck('admin'), approveBulk);

router
  .route('/')
  .get(protect, roleCheck('admin', 'teacher', 'reception'), getAttendances)
  .post(protect, roleCheck('admin', 'teacher'), createAttendance);

// Approbation admin
router.put('/:id', protect, roleCheck('admin'), updateAttendance);
router.put('/:id/approve', protect, roleCheck('admin'), approveAttendance);

module.exports = router;
