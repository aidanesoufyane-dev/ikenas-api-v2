/**
 * Routes Matières
 */
const express = require('express');
const router = express.Router();
const { createSubject, getSubjects, getSubject, updateSubject, deleteSubject } = require('../controllers/subjectController');
const { protect, roleCheck } = require('../middleware/auth');

router
  .route('/')
  .get(protect, getSubjects)
  .post(protect, roleCheck('admin'), createSubject);

router
  .route('/:id')
  .get(protect, getSubject)
  .put(protect, roleCheck('admin'), updateSubject)
  .delete(protect, roleCheck('admin'), deleteSubject);

module.exports = router;
