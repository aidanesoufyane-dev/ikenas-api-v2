const express = require('express');
const router = express.Router();
const { getEvents } = require('../controllers/eventController');
const { protect } = require('../middleware/auth');

// Alias: GET /api/calendar/events → GET /api/events
router.get('/events', protect, getEvents);

module.exports = router;
