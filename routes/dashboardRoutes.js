/**
 * Routes Dashboard
 */
const express = require('express');
const router = express.Router();
const { getStats, getGradeEvolution } = require('../controllers/dashboardController');
const { protect, roleCheck } = require('../middleware/auth');

router.get('/stats', protect, roleCheck('admin'), getStats);
router.get('/evolution', protect, getGradeEvolution);

module.exports = router;
