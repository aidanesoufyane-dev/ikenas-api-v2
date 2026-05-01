/**
 * Controller Événements - CRUD admin/supervisor + RSVP prof/élève
 */
const Event = require('../models/Event');
const { asyncHandler } = require('../utils/helpers');
const { sendNotification } = require('../utils/notify');
const { resolveActingStudent } = require('../utils/studentAccess');

const normalizeAudience = (value) => {
  if (value === 'teachers' || value === 'students' || value === 'all') return value;
  // Legacy value: keep events visible instead of failing validation
  if (value === 'admin') return 'all';
  return 'all';
};

/**
 * @desc    Créer un événement
 * @route   POST /api/events
 * @access  Private/Admin,Supervisor
 */
const createEvent = asyncHandler(async (req, res) => {
  req.body.targetAudience = normalizeAudience(req.body.targetAudience);
  req.body.createdBy = req.user.id;
  const event = await Event.create(req.body);

  const populated = await Event.findById(event._id)
    .populate('createdBy', 'firstName lastName');

  // Notification temps réel à tous
  await sendNotification(req.io, {
    type: 'event_created',
    title: 'Nouvel événement',
    message: `${populated.title} — ${new Date(populated.date).toLocaleDateString('fr-FR')}`,
    link: `/${req.user.role}/events`,
    createdBy: req.user.id,
  });

  res.status(201).json({ success: true, data: populated });
});

/**
 * @desc    Lister les événements
 * @route   GET /api/events
 * @access  Private
 */
const getEvents = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const actingStudent = req.user.role === 'parent'
    ? await resolveActingStudent(req)
    : null;
  const actorUserId = actingStudent?.user || req.user.id;

  if (req.query.type) filter.type = req.query.type;
  if (req.query.upcoming === 'true') {
    filter.date = { $gte: new Date() };
  }

  if (req.user.role === 'teacher') {
    filter.targetAudience = { $in: ['all', 'teachers'] };
  } else if (req.user.role === 'student' || req.user.role === 'parent') {
    filter.targetAudience = { $in: ['all', 'students'] };
  }

  const events = await Event.find(filter)
    .populate('createdBy', 'firstName lastName')
    .populate('attendees.user', 'firstName lastName role')
    .sort({ date: 1 });

  const withMeta = events.map((eventDoc) => {
    const eventObj = eventDoc.toObject();
    const myAttendance = eventObj.attendees.find(
      (attendee) => String(attendee.user?._id || attendee.user || '') === String(actorUserId)
    ) || null;

    return {
      ...eventObj,
      myAttendance,
      goingCount: eventObj.attendees.filter((attendee) => attendee.status === 'going').length,
    };
  });

  res.status(200).json({ success: true, data: withMeta });
});

/**
 * @desc    Obtenir un événement
 * @route   GET /api/events/:id
 * @access  Private
 */
const getEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id)
    .populate('createdBy', 'firstName lastName')
    .populate('attendees.user', 'firstName lastName role');

  if (!event) {
    return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
  }

  res.status(200).json({ success: true, data: event });
});

/**
 * @desc    Mettre à jour un événement
 * @route   PUT /api/events/:id
 * @access  Private/Admin,Supervisor
 */
const updateEvent = asyncHandler(async (req, res) => {
  if (req.body.targetAudience !== undefined) {
    req.body.targetAudience = normalizeAudience(req.body.targetAudience);
  }

  const event = await Event.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('createdBy', 'firstName lastName');

  if (!event) {
    return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
  }

  // Notification temps réel à tous
  await sendNotification(req.io, {
    type: 'event_updated',
    title: 'Événement modifié',
    message: `${event.title} a été mis à jour.`,
    createdBy: req.user.id,
  });

  res.status(200).json({ success: true, data: event });
});

/**
 * @desc    Supprimer un événement
 * @route   DELETE /api/events/:id
 * @access  Private/Admin,Supervisor
 */
const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });

  if (!event) {
    return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
  }

  res.status(200).json({ success: true, message: 'Événement supprimé avec succès.' });
});

/**
 * @desc    Répondre à un événement (présent / absent)
 * @route   PUT /api/events/:id/respond
 * @access  Private/Teacher,Student
 */
const respondToEvent = asyncHandler(async (req, res) => {
  if (!['teacher', 'student', 'parent'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Accès refusé.' });
  }

  const actingStudent = req.user.role === 'parent'
    ? await resolveActingStudent(req)
    : null;
  const actorUserId = actingStudent?.user || req.user.id;
  const actorRole = req.user.role === 'teacher' ? 'teacher' : 'student';

  const { status } = req.body;
  if (!['going', 'not_going'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Statut invalide.' });
  }

  const event = await Event.findById(req.params.id);
  if (!event || !event.isActive) {
    return res.status(404).json({ success: false, message: 'Événement non trouvé.' });
  }

  const allowedByAudience =
    event.targetAudience === 'all' ||
    (event.targetAudience === 'teachers' && actorRole === 'teacher') ||
    (event.targetAudience === 'students' && actorRole === 'student');

  if (!allowedByAudience) {
    return res.status(403).json({ success: false, message: 'Cet événement ne vous est pas destiné.' });
  }

  const currentIndex = event.attendees.findIndex(
    (attendee) => String(attendee.user) === String(actorUserId)
  );

  if (currentIndex >= 0) {
    event.attendees[currentIndex].status = status;
    event.attendees[currentIndex].respondedAt = new Date();
  } else {
    event.attendees.push({
      user: actorUserId,
      status,
      respondedAt: new Date(),
    });
  }

  await event.save();

  const populated = await Event.findById(event._id)
    .populate('createdBy', 'firstName lastName')
    .populate('attendees.user', 'firstName lastName role');

  res.status(200).json({ success: true, data: populated, message: 'Réponse enregistrée.' });
});

module.exports = {
  createEvent,
  getEvents,
  getEvent,
  updateEvent,
  deleteEvent,
  respondToEvent,
};
