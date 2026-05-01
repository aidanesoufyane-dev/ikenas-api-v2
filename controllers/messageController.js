/**
 * Controller Messages - Messagerie temps réel avec Socket.io
 */
const Message = require('../models/Message');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');
const { resolveActingStudent } = require('../utils/studentAccess');

const isSupervisorEquivalent = (role) => role === 'supervisor' || role === 'pedagogical_director';

const parseBoolean = (value, defaultValue = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
};

const resolveMessageActor = async (user, req) => {
  if (user.role !== 'parent') {
    return {
      actorUserId: user.id,
      actorRole: user.role,
      actorClassId: null,
    };
  }

  const actingStudent = await resolveActingStudent(req, { required: true });
  return {
    actorUserId: actingStudent.user,
    actorRole: 'student',
    actorClassId: actingStudent.classe,
  };
};

const buildMessageFilter = async (user, req) => {
  const filter = { isActive: true };
  const actor = await resolveMessageActor(user, req);

  if (user.role === 'admin' || isSupervisorEquivalent(user.role)) {
    return filter;
  }

  if (actor.actorRole === 'teacher') {
    const teacher = await Teacher.findOne({ user: user.id });
    const teacherClasses = teacher?.classes || [];

    filter.$or = [
      { recipientType: 'broadcast' },
      { recipientType: 'class', targetClass: { $in: teacherClasses } },
      { targetUser: actor.actorUserId },
      { sender: actor.actorUserId },
    ];
    return filter;
  }

  filter.$or = [
    { recipientType: 'broadcast' },
    ...(actor.actorClassId ? [{ recipientType: 'class', targetClass: actor.actorClassId }] : []),
    { targetUser: actor.actorUserId },
    { sender: actor.actorUserId },
  ];

  return filter;
};

const normalizeIdArray = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  const single = String(value || '').trim();
  return single ? [single] : [];
};

const isUserMessageRecipient = async (user, message, req) => {
  const actor = await resolveMessageActor(user, req);
  const messageSenderId = String(message.sender?._id || message.sender || '');
  if (messageSenderId === String(actor.actorUserId)) {
    return false;
  }

  if (message.recipientType === 'broadcast') {
    return true;
  }

  if (message.recipientType === 'individual') {
    return String(message.targetUser?._id || message.targetUser || '') === String(actor.actorUserId);
  }

  if (message.recipientType === 'class') {
    const targetClassId = String(message.targetClass?._id || message.targetClass || '');
    if (!targetClassId) return false;

    if (actor.actorRole === 'teacher') {
      const teacher = await Teacher.findOne({ user: user.id }).select('classes');
      return (teacher?.classes || []).some((classId) => String(classId) === targetClassId);
    }

    return String(actor.actorClassId || '') === targetClassId;
  }

  return false;
};

const canManageMessage = (user, message) => {
  if (user.role === 'admin' || isSupervisorEquivalent(user.role)) return true;
  return String(message.sender?._id || message.sender || '') === String(user.id);
};

/**
 * @desc    Envoyer un message
 * @route   POST /api/messages
 * @access  Private/Admin,Teacher
 */
const sendMessage = asyncHandler(async (req, res) => {
  const {
    content,
    recipientType,
    targetClass,
    targetUser,
    targetClasses,
    targetUsers,
    allowReply,
  } = req.body;

  const resolvedTargetClasses = normalizeIdArray(targetClasses).length > 0
    ? normalizeIdArray(targetClasses)
    : normalizeIdArray(targetClass);

  const resolvedTargetUsers = normalizeIdArray(targetUsers).length > 0
    ? normalizeIdArray(targetUsers)
    : normalizeIdArray(targetUser);

  const normalizedContent = (content || '').trim();
  const allowReplyForRecipients = parseBoolean(allowReply, false);
  const attachments = (req.files || []).map((file) => ({
    filename: file.filename,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    url: `/uploads/messages/${file.filename}`,
  }));

  if (!normalizedContent && attachments.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Le message doit contenir du texte ou au moins une pièce jointe.',
    });
  }

  if (!recipientType || !['broadcast', 'class', 'individual'].includes(recipientType)) {
    return res.status(400).json({
      success: false,
      message: 'Type de destinataire invalide.',
    });
  }

  // Validation selon le type de destinataire
  if (recipientType === 'class' && resolvedTargetClasses.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Au moins une classe cible est requise pour un message de type "class".',
    });
  }

  if (recipientType === 'individual' && resolvedTargetUsers.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Au moins un utilisateur cible est requis pour un message individuel.',
    });
  }

  if (req.user.role === 'teacher' && recipientType === 'class') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    const teacherClassIds = new Set((teacher?.classes || []).map((classId) => classId.toString()));
    const hasUnauthorizedClass = resolvedTargetClasses.some(
      (classId) => !teacherClassIds.has(classId)
    );
    if (hasUnauthorizedClass) {
      return res.status(403).json({
        success: false,
        message: 'Vous ne pouvez envoyer des messages qu\'à vos classes.',
      });
    }
  }

  if (req.user.role === 'teacher' && recipientType === 'broadcast') {
    return res.status(403).json({
      success: false,
      message: 'Vous ne pouvez envoyer des messages qu\'à vos classes ou à vos élèves.',
    });
  }

  if (req.user.role === 'teacher' && recipientType === 'individual') {
    const teacher = await Teacher.findOne({ user: req.user.id }).select('classes');
    const students = await Student.find({ classe: { $in: teacher?.classes || [] } }).select('user');
    const allowedUserIds = new Set(students.map((student) => String(student.user)));

    const hasUnauthorizedUser = resolvedTargetUsers.some((userId) => !allowedUserIds.has(userId));
    if (hasUnauthorizedUser) {
      return res.status(403).json({
        success: false,
        message: 'Vous ne pouvez envoyer des messages individuels qu\'à vos élèves.',
      });
    }
  }

  const payloads = [];
  if (recipientType === 'broadcast') {
    payloads.push({ recipientType, targetClass: null, targetUser: null });
  }

  if (recipientType === 'class') {
    resolvedTargetClasses.forEach((classId) => {
      payloads.push({ recipientType, targetClass: classId, targetUser: null });
    });
  }

  if (recipientType === 'individual') {
    resolvedTargetUsers.forEach((userId) => {
      payloads.push({ recipientType, targetClass: null, targetUser: userId });
    });
  }

  const createdMessages = await Message.insertMany(
    payloads.map((payload) => ({
      sender: req.user.id,
      content: normalizedContent,
      recipientType: payload.recipientType,
      targetClass: payload.targetClass,
      targetUser: payload.targetUser,
      attachments,
      allowReply: allowReplyForRecipients,
    }))
  );

  const createdIds = createdMessages.map((message) => message._id);
  const populatedMessages = await Message.find({ _id: { $in: createdIds } })
    .populate('sender', 'firstName lastName role')
    .populate('targetClass', 'name')
    .populate('targetUser', 'firstName lastName')
    .sort({ createdAt: 1 });

  // Émettre via Socket.io (le socket est attaché à req via middleware)
  if (req.io) {
    populatedMessages.forEach((message) => {
      if (message.recipientType === 'broadcast') {
        req.io.emit('new-message', message);
      } else if (message.recipientType === 'class' && message.targetClass) {
        req.io.to(`class-${message.targetClass._id || message.targetClass}`).emit('new-message', message);
      } else if (message.recipientType === 'individual' && message.targetUser) {
        req.io.to(`user-${message.targetUser._id || message.targetUser}`).emit('new-message', message);
        req.io.to(`user-${req.user.id}`).emit('new-message', message);
      }
    });
  }

  res.status(201).json({
    success: true,
    data: populatedMessages,
    meta: { count: populatedMessages.length },
  });
});

/**
 * @desc    Répondre à un message si autorisé
 * @route   POST /api/messages/:id/reply
 * @access  Private
 */
const replyToMessage = asyncHandler(async (req, res) => {
  const originalMessage = await Message.findById(req.params.id)
    .populate('sender', 'firstName lastName role');

  if (!originalMessage || !originalMessage.isActive) {
    return res.status(404).json({ success: false, message: 'Message introuvable.' });
  }

  if (!originalMessage.allowReply) {
    return res.status(403).json({ success: false, message: 'Réponse non autorisée pour ce message.' });
  }

  const actor = await resolveMessageActor(req.user, req);
  const isRecipient = await isUserMessageRecipient(req.user, originalMessage, req);
  if (!isRecipient) {
    return res.status(403).json({ success: false, message: 'Vous ne pouvez pas répondre à ce message.' });
  }

  const normalizedContent = String(req.body?.content || '').trim();
  const attachments = (req.files || []).map((file) => ({
    filename: file.filename,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    url: `/uploads/messages/${file.filename}`,
  }));

  if (!normalizedContent && attachments.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'La réponse doit contenir du texte ou au moins une pièce jointe.',
    });
  }

  const originalSenderId = String(originalMessage.sender?._id || originalMessage.sender || '');
  if (!originalSenderId || originalSenderId === String(actor.actorUserId)) {
    return res.status(400).json({ success: false, message: 'Réponse invalide.' });
  }

  const replyMessage = await Message.create({
    sender: actor.actorUserId,
    content: normalizedContent,
    recipientType: 'individual',
    targetClass: null,
    targetUser: originalSenderId,
    attachments,
    allowReply: false,
  });

  const populatedReply = await Message.findById(replyMessage._id)
    .populate('sender', 'firstName lastName role')
    .populate('targetClass', 'name')
    .populate('targetUser', 'firstName lastName role');

  if (req.io && populatedReply?.targetUser) {
    req.io.to(`user-${populatedReply.targetUser._id || populatedReply.targetUser}`).emit('new-message', populatedReply);
    req.io.to(`user-${actor.actorUserId}`).emit('new-message', populatedReply);
  }

  res.status(201).json({
    success: true,
    data: populatedReply,
  });
});

/**
 * @desc    Récupérer les messages (avec filtrage selon le rôle)
 * @route   GET /api/messages
 * @access  Private
 */
const getMessages = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const filter = await buildMessageFilter(req.user, req);

  const [messages, total] = await Promise.all([
    Message.find(filter)
      .populate('sender', 'firstName lastName role')
      .populate('targetClass', 'name')
      .populate('targetUser', 'firstName lastName role')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit),
    Message.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: messages,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  });
});

/**
 * @desc    Marquer un message comme lu
 * @route   PUT /api/messages/:id/read
 * @access  Private
 */
const markAsRead = asyncHandler(async (req, res) => {
  const visibilityFilter = await buildMessageFilter(req.user, req);
  const actor = await resolveMessageActor(req.user, req);
  const message = await Message.findOne({
    _id: req.params.id,
    ...visibilityFilter,
  });

  if (!message) {
    return res.status(404).json({ success: false, message: 'Message non trouvé.' });
  }

  // Vérifier si déjà lu par cet utilisateur
  const alreadyRead = message.readBy.some(
    (r) => r.user.toString() === String(actor.actorUserId)
  );

  if (!alreadyRead) {
    message.readBy.push({ user: actor.actorUserId });
    await message.save();

    if (req.io) {
      req.io.emit('message-read', {
        messageId: String(message._id),
        userId: String(actor.actorUserId),
        readAt: new Date(),
      });
    }
  }

  res.status(200).json({ success: true, message: 'Message marqué comme lu.' });
});

/**
 * @desc    Modifier un message
 * @route   PUT /api/messages/:id
 * @access  Private
 */
const updateMessage = asyncHandler(async (req, res) => {
  const visibilityFilter = await buildMessageFilter(req.user, req);
  const message = await Message.findOne({ _id: req.params.id, ...visibilityFilter });

  if (!message) {
    return res.status(404).json({ success: false, message: 'Message non trouvé.' });
  }

  const actor = await resolveMessageActor(req.user, req);
  if (!canManageMessage({ ...req.user, id: actor.actorUserId }, message)) {
    return res.status(403).json({ success: false, message: 'Modification non autorisée.' });
  }

  const normalizedContent = String(req.body?.content || '').trim();
  if (!normalizedContent) {
    return res.status(400).json({ success: false, message: 'Le contenu du message est requis.' });
  }

  message.content = normalizedContent;
  await message.save();

  const populated = await Message.findById(message._id)
    .populate('sender', 'firstName lastName role')
    .populate('targetClass', 'name')
    .populate('targetUser', 'firstName lastName role');

  if (req.io) {
    req.io.emit('message-updated', populated);
  }

  res.status(200).json({ success: true, data: populated, message: 'Message modifié.' });
});

/**
 * @desc    Supprimer un message
 * @route   DELETE /api/messages/:id
 * @access  Private
 */
const deleteMessage = asyncHandler(async (req, res) => {
  const visibilityFilter = await buildMessageFilter(req.user, req);
  const message = await Message.findOne({ _id: req.params.id, ...visibilityFilter });

  if (!message) {
    return res.status(404).json({ success: false, message: 'Message non trouvé.' });
  }

  const actor = await resolveMessageActor(req.user, req);
  if (!canManageMessage({ ...req.user, id: actor.actorUserId }, message)) {
    return res.status(403).json({ success: false, message: 'Suppression non autorisée.' });
  }

  await Message.deleteOne({ _id: message._id });

  if (req.io) {
    req.io.emit('message-deleted', { _id: message._id });
  }

  res.status(200).json({ success: true, message: 'Message supprimé.' });
});

/**
 * @desc    Récupérer la liste des destinataires possibles
 * @route   GET /api/messages/recipients
 * @access  Private/Admin,Teacher
 */
const getRecipients = asyncHandler(async (req, res) => {
  let users = [];

  if (req.user.role === 'admin' || isSupervisorEquivalent(req.user.role)) {
    users = await User.find({ isActive: true, _id: { $ne: req.user.id } })
      .select('firstName lastName role')
      .sort({ firstName: 1, lastName: 1 });
  } else if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id }).select('classes');
    const students = await Student.find({ classe: { $in: teacher?.classes || [] } }).select('user');
    const studentUserIds = students.map((student) => student.user);

    users = await User.find({ _id: { $in: studentUserIds }, isActive: true })
      .select('firstName lastName role')
      .sort({ firstName: 1, lastName: 1 });
  }

  res.status(200).json({ success: true, data: users });
});

module.exports = {
  sendMessage,
  getMessages,
  markAsRead,
  updateMessage,
  deleteMessage,
  getRecipients,
  replyToMessage,
};
