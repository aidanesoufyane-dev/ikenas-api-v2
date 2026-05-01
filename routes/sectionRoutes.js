/**
 * Routes Sections
 */
const express = require('express');
const router = express.Router();
const { createSection, getSections, getSection, updateSection, deleteSection } = require('../controllers/sectionController');
const { protect, roleCheck } = require('../middleware/auth');

router
  .route('/')
  .get(protect, getSections)
  .post(protect, roleCheck('admin'), createSection);

router
  .route('/:id')
  .get(protect, getSection)
  .put(protect, roleCheck('admin'), updateSection)
  .delete(protect, roleCheck('admin'), deleteSection);

module.exports = router;
