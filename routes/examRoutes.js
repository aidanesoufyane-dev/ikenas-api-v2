/**
 * Routes Examens
 */
const express = require('express');
const router = express.Router();
const {
  createExam,
  getExams,
  getExam,
  updateExam,
  deleteExam,
  getResultsTemplate,
  saveResults,
  getResults,
  getMyResults,
} = require('../controllers/examController');
const { protect, roleCheck } = require('../middleware/auth');

// Résultats de l'élève connecté
router.get('/my-results', protect, roleCheck('student', 'parent'), getMyResults);
router.get('/results-template', protect, roleCheck('admin', 'teacher'), getResultsTemplate);

// CRUD examens
router
  .route('/')
  .get(protect, getExams)
  .post(protect, roleCheck('admin', 'teacher'), createExam);

router
  .route('/:id')
  .get(protect, getExam)
  .put(protect, roleCheck('admin', 'teacher'), updateExam)
  .delete(protect, roleCheck('admin', 'teacher'), deleteExam);

// Résultats d'un examen
router
  .route('/:id/results')
  .get(protect, getResults)
  .post(protect, roleCheck('admin', 'teacher'), saveResults);

module.exports = router;
