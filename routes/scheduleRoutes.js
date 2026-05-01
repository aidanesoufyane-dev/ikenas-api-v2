/**
 * Routes Emploi du Temps
 */
const express = require('express');
const router = express.Router();
const {
  createSchedule, getSchedules, getMyScheduleTeacher,
  getMyScheduleStudent, updateSchedule, deleteSchedule,
  getScheduleSettings, updateScheduleSettings,
} = require('../controllers/scheduleController');
const {
  getGenerationBootstrap,
  saveGenerationConfig,
  validateGenerationConfig,
  runGeneration,
} = require('../controllers/scheduleGenerationController');
const { protect, roleCheck } = require('../middleware/auth');

// Vue spécifique prof
router.get('/my-schedule', protect, roleCheck('teacher'), getMyScheduleTeacher);

// Vue spécifique élève
router.get('/my-schedule-student', protect, roleCheck('student', 'parent'), getMyScheduleStudent);

// Paramètres d'emploi du temps (généraux + exceptions)
router
  .route('/settings')
  .get(protect, getScheduleSettings)
  .put(protect, roleCheck('admin'), updateScheduleSettings);

// Génération automatique des créneaux (admin école)
router.get('/generation/bootstrap', protect, roleCheck('admin'), getGenerationBootstrap);
router.put('/generation/config', protect, roleCheck('admin'), saveGenerationConfig);
router.post('/generation/validate', protect, roleCheck('admin'), validateGenerationConfig);
router.post('/generation/run', protect, roleCheck('admin'), runGeneration);

// CRUD admin
router
  .route('/')
  .get(protect, getSchedules)
  .post(protect, roleCheck('admin'), createSchedule);

router
  .route('/:id')
  .put(protect, roleCheck('admin'), updateSchedule)
  .delete(protect, roleCheck('admin'), deleteSchedule);

module.exports = router;
