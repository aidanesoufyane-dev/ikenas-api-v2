/**
 * Routes Événements
 */
const express = require('express');
const router = express.Router();
const {
  createEvent,
  getEvents,
  getEvent,
  updateEvent,
  deleteEvent,
  respondToEvent,
} = require('../controllers/eventController');
const { protect, roleCheck } = require('../middleware/auth');

router
  .route('/')
  .get(protect, getEvents)
  .post(protect, roleCheck('admin', 'supervisor'), createEvent);

router.put('/:id/respond', protect, roleCheck('teacher', 'student', 'parent'), respondToEvent);

router
  .route('/:id')
  .get(protect, getEvent)
  .put(protect, roleCheck('admin', 'supervisor'), updateEvent)
  .delete(protect, roleCheck('admin', 'supervisor'), deleteEvent);

module.exports = router;
