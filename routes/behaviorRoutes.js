const express = require('express');
const router = express.Router();
const { getBehaviorSummary, getBehaviorHistory, createBehavior } = require('../controllers/behaviorController');
const { protect } = require('../middleware/auth');

router.get('/summary', protect, getBehaviorSummary);
router.get('/history', protect, getBehaviorHistory);
router.post('/', protect, createBehavior);

module.exports = router;
