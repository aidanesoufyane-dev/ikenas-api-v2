/**
 * Routes Classes
 */
const express = require('express');
const router = express.Router();
const {
  createClass, getClasses, getClass, updateClass, deleteClass,
  deleteClassGroup, addSections,
} = require('../controllers/classController');
const { protect, roleCheck } = require('../middleware/auth');

// Ajout de sections à un groupe existant
router.post('/add-sections', protect, roleCheck('admin'), addSections);

// Suppression d'un groupe entier
router.delete('/group/:baseName', protect, roleCheck('admin'), deleteClassGroup);

router
  .route('/')
  .get(protect, getClasses)
  .post(protect, roleCheck('admin'), createClass);

router
  .route('/:id')
  .get(protect, getClass)
  .put(protect, roleCheck('admin'), updateClass)
  .delete(protect, roleCheck('admin'), deleteClass);

module.exports = router;
