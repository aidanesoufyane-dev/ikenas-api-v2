/**
 * Controller LeaveRequest - Demandes de congé professeurs
 */
const LeaveRequest = require('../models/LeaveRequest');
const Teacher     = require('../models/Teacher');
const User        = require('../models/User');
const { asyncHandler } = require('../utils/helpers');
const { sendNotification } = require('../utils/notify');

/* ────────────────────────────────────────────────
   PROF — Créer une demande (absence ou retour)
──────────────────────────────────────────────── */
const createLeaveRequest = asyncHandler(async (req, res) => {
  const { requestType, type, startDate, endDate, returnDate, reason } = req.body;

  // requestType: 'absence' ou 'return' (défaut: 'absence')
  const reqType = requestType || 'absence';

  if (reqType === 'absence') {
    if (!type || !startDate || !returnDate) {
      return res.status(400).json({
        success: false,
        message: 'Type, date de début et date de retour sont requis.',
      });
    }

    if (new Date(returnDate) < new Date(startDate)) {
      return res.status(400).json({
        success: false,
        message: 'La date de retour doit être après la date de début.',
      });
    }
  } else if (reqType === 'return') {
    if (!type || !returnDate) {
      return res.status(400).json({
        success: false,
        message: 'Type et date de retour sont requis.',
      });
    }
  }

  const teacher = await Teacher.findOne({ user: req.user.id });
  if (!teacher) {
    return res.status(404).json({ success: false, message: 'Profil professeur introuvable.' });
  }

  const attachments = (req.files || []).map((file) => ({
    filename:     file.filename,
    originalName: file.originalname,
    mimetype:     file.mimetype,
    size:         file.size,
    url:          `/uploads/leaves/${file.filename}`,
  }));

  const leaveData = {
    teacher:    teacher._id,
    requestType: reqType,
    type,
    startDate,
    endDate: endDate || null,
    returnDate,
    reason,
    attachments,
  };

  const leave = await LeaveRequest.create(leaveData);

  const populated = await LeaveRequest.findById(leave._id)
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName email' } });

  // Récupérer le nom du prof pour la notification
  const teacherUser = await User.findById(req.user.id).select('firstName lastName');
  const teacherName = teacherUser ? `${teacherUser.firstName} ${teacherUser.lastName}` : 'Un professeur';

  const notifTitle = reqType === 'absence' ? 'Nouvelle demande d\'absence' : 'Nouvelle demande de reprise de travail';
  const notifMsg = reqType === 'absence'
    ? `${teacherName} a soumis une demande d'absence (${type}).`
    : `${teacherName} a soumis une demande de reprise de travail.`;

  // Notification persistée + socket pour l'admin
  await sendNotification(req.io, {
    type:          'leave_request_submitted',
    title:         notifTitle,
    message:       notifMsg,
    link:          '/admin/teachers/leave-requests',
    recipientRole: 'admin',
    createdBy:     req.user.id,
  });

  res.status(201).json({ success: true, data: populated });
});

/* ────────────────────────────────────────────────
   PROF — Voir ses propres demandes
──────────────────────────────────────────────── */
const getMyLeaveRequests = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findOne({ user: req.user.id });
  if (!teacher) return res.status(200).json({ success: true, data: [] });

  const requests = await LeaveRequest.find({ teacher: teacher._id })
    .sort('-createdAt');

  res.status(200).json({ success: true, data: requests });
});


/* ────────────────────────────────────────────────
   ADMIN — Voir toutes les demandes
──────────────────────────────────────────────── */
const getAllLeaveRequests = asyncHandler(async (req, res) => {
  const { status, requestType } = req.query;
  const filter = {};
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    filter.status = status;
  }
  if (requestType && ['absence', 'return'].includes(requestType)) {
    filter.requestType = requestType;
  }

  const requests = await LeaveRequest.find(filter)
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName email avatar' } })
    .sort('-createdAt');

  res.status(200).json({ success: true, data: requests });
});

/* ────────────────────────────────────────────────
   ADMIN — Approuver ou rejeter une demande
──────────────────────────────────────────────── */
const updateLeaveStatus = asyncHandler(async (req, res) => {
  const { status, adminComment } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Statut invalide (approved | rejected).' });
  }

  const leave = await LeaveRequest.findById(req.params.id)
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } });

  if (!leave) {
    return res.status(404).json({ success: false, message: 'Demande introuvable.' });
  }

  leave.status       = status;
  leave.adminComment = adminComment || '';
  await leave.save();

  // Notification persistée + socket pour le prof
  if (leave.teacher?.user) {
    const notifType = status === 'approved' ? 'leave_request_approved' : 'leave_request_rejected';
    const notifTitle = status === 'approved' ? 'Demande de congé approuvée' : 'Demande de congé rejetée';
    const notifMsg   = status === 'approved'
      ? `Votre demande de congé a été approuvée.${leave.adminComment ? ' Commentaire : ' + leave.adminComment : ''}`
      : `Votre demande de congé a été rejetée.${leave.adminComment ? ' Raison : ' + leave.adminComment : ''}`;

    await sendNotification(req.io, {
      type:      notifType,
      title:     notifTitle,
      message:   notifMsg,
      link:      '/teacher/leave/request',
      recipient: leave.teacher.user._id,
      createdBy: req.user.id,
    });
  }

  res.status(200).json({ success: true, data: leave });
});

module.exports = {
  createLeaveRequest,
  getMyLeaveRequests,
  getAllLeaveRequests,
  updateLeaveStatus,
};
