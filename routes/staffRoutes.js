const express = require('express');
const { createStaff, getStaff, updateStaff, deleteStaff } = require('../controllers/staffController');
const { protect, roleCheck } = require('../middleware/auth');

const router = express.Router();

router
  .route('/')
  .get(protect, roleCheck('admin'), getStaff)
  .post(protect, roleCheck('admin'), createStaff);

router
  .route('/:id')
  .put(protect, roleCheck('admin'), updateStaff)
  .delete(protect, roleCheck('admin'), deleteStaff);

module.exports = router;