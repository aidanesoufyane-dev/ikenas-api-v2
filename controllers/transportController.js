/**
 * Controller Transport
 */
const Transport = require('../models/Transport');
const Staff     = require('../models/Staff');
const Student   = require('../models/Student');
const User      = require('../models/User');
const Class     = require('../models/Class');
const { asyncHandler } = require('../utils/helpers');
const { sendNotification } = require('../utils/notify');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const getPaymentState = (dueDate, isPaid) => {
  if (!dueDate) return { status: 'unset', daysLeft: null };
  if (isPaid) return { status: 'paid', daysLeft: null };

  const today = new Date();
  const due = new Date(dueDate);
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const daysLeft = Math.round((due - today) / MS_PER_DAY);

  if (daysLeft < 0) return { status: 'overdue', daysLeft };
  if (daysLeft <= 7) return { status: 'due-soon', daysLeft };
  return { status: 'ok', daysLeft };
};

const maybeSendPaymentNotification = async (io, transport, createdBy, force = false) => {
  const now = new Date();
  const shouldNotify = (paymentField, type, label) => {
    const state = getPaymentState(paymentField.dueDate, paymentField.isPaid);
    if (!['due-soon', 'overdue'].includes(state.status)) {
      return false;
    }

    if (force) {
      return true;
    }

    if (!paymentField.lastNotifiedAt) {
      return true;
    }

    const last = new Date(paymentField.lastNotifiedAt);
    const due = paymentField.dueDate ? new Date(paymentField.dueDate) : null;

    if (!due) return false;
    return last.toDateString() !== due.toDateString();
  };

  if (shouldNotify(transport.vignette || {}, 'transport_vignette_due', 'vignette')) {
    const vignetteState = getPaymentState(transport.vignette?.dueDate, transport.vignette?.isPaid);
    await sendNotification(io, {
      type: 'transport_vignette_due',
      title: 'Échéance vignette',
      message:
        vignetteState.status === 'overdue'
          ? `La vignette du véhicule ${transport.name} (${transport.matricule}) est en retard.`
          : `La vignette du véhicule ${transport.name} (${transport.matricule}) arrive à échéance bientôt.`,
      link: '/admin/transport/assurance',
      recipientRole: 'admin',
      createdBy,
    });
    transport.vignette.lastNotifiedAt = now;
  }

  if (shouldNotify(transport.assurance || {}, 'transport_assurance_due', 'assurance')) {
    const assuranceState = getPaymentState(transport.assurance?.dueDate, transport.assurance?.isPaid);
    await sendNotification(io, {
      type: 'transport_assurance_due',
      title: 'Échéance assurance',
      message:
        assuranceState.status === 'overdue'
          ? `L'assurance du véhicule ${transport.name} (${transport.matricule}) est en retard.`
          : `L'assurance du véhicule ${transport.name} (${transport.matricule}) arrive à échéance bientôt.`,
      link: '/admin/transport/assurance',
      recipientRole: 'admin',
      createdBy,
    });
    transport.assurance.lastNotifiedAt = now;
  }
};

const TRANSPORT_STATUS = {
  WITH: 'with_transport',
  WITHOUT: 'without_transport',
  PENDING: 'pending',
};

const applyTransportState = (student, status, reason, changedBy) => {
  student.transport = student.transport || {};
  student.transport.status = status;
  student.transport.history = student.transport.history || [];
  student.transport.history.push({
    status,
    reason: reason || '',
    changedAt: new Date(),
    changedBy: changedBy || null,
  });
};

const getBusLoadStats = async () => {
  const transports = await Transport.find({ isActive: true })
    .select('name matricule capacity')
    .sort({ createdAt: -1 });

  const assignments = await Student.aggregate([
    {
      $match: {
        'transport.status': TRANSPORT_STATUS.WITH,
        'transport.assignment.transport': { $ne: null },
      },
    },
    {
      $group: {
        _id: '$transport.assignment.transport',
        assignedCount: { $sum: 1 },
      },
    },
  ]);

  const assignedMap = new Map(assignments.map((item) => [String(item._id), item.assignedCount]));

  return transports.map((transport) => {
    const assigned = assignedMap.get(String(transport._id)) || 0;
    const capacity = transport.capacity || 0;
    const occupancyRate = capacity > 0 ? Math.round((assigned / capacity) * 100) : 0;
    return {
      transportId: transport._id,
      name: transport.name,
      matricule: transport.matricule,
      capacity,
      assignedCount: assigned,
      availableSeats: Math.max(capacity - assigned, 0),
      occupancyRate,
      overloaded: assigned > capacity,
    };
  });
};

const buildPaymentAlerts = (transports) => {
  const alerts = [];

  transports.forEach((transport) => {
    const vignetteState = getPaymentState(transport.vignette?.dueDate, transport.vignette?.isPaid);
    if (['due-soon', 'overdue'].includes(vignetteState.status)) {
      alerts.push({
        type: 'vignette',
        severity: vignetteState.status === 'overdue' ? 'high' : 'medium',
        message:
          vignetteState.status === 'overdue'
            ? `Vignette en retard: ${transport.name} (${transport.matricule})`
            : `Vignette proche échéance: ${transport.name} (${transport.matricule})`,
      });
    }

    const assuranceState = getPaymentState(transport.assurance?.dueDate, transport.assurance?.isPaid);
    if (['due-soon', 'overdue'].includes(assuranceState.status)) {
      alerts.push({
        type: 'assurance',
        severity: assuranceState.status === 'overdue' ? 'high' : 'medium',
        message:
          assuranceState.status === 'overdue'
            ? `Assurance en retard: ${transport.name} (${transport.matricule})`
            : `Assurance proche échéance: ${transport.name} (${transport.matricule})`,
      });
    }
  });

  return alerts;
};

/* ── GET /api/transports/students ── */
const getTransportStudents = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const { status, classe, section, search } = req.query;
  const filter = {};

  if ([TRANSPORT_STATUS.WITH, TRANSPORT_STATUS.WITHOUT, TRANSPORT_STATUS.PENDING].includes(status)) {
    filter['transport.status'] = status;
  }

  if (classe) {
    filter.classe = classe;
  } else if (section) {
    const classes = await Class.find({ section: { $regex: `^${section}$`, $options: 'i' } }).select('_id');
    filter.classe = { $in: classes.map((item) => item._id) };
  }

  if (search) {
    const users = await User.find({
      role: 'student',
      $or: [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');

    filter.$or = [
      { user: { $in: users.map((item) => item._id) } },
      { matricule: { $regex: search, $options: 'i' } },
    ];
  }

  const [students, total] = await Promise.all([
    Student.find(filter)
      .populate('user', 'firstName lastName email')
      .populate('classe', 'name section level')
      .populate('transport.assignment.transport', 'name matricule capacity')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Student.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: students,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

/* ── POST /api/transports/students/:studentId/request ── */
const createTransportRequest = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { note } = req.body;

  const student = await Student.findById(studentId).populate('user', 'firstName lastName');
  if (!student) {
    return res.status(404).json({ success: false, message: 'Élève introuvable.' });
  }

  if (req.user.role === 'student' && String(student.user._id) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Accès refusé pour cette demande.' });
  }

  student.transport = student.transport || {};
  student.transport.request = {
    requestedAt: new Date(),
    requestedByRole: req.user.role === 'student' ? 'student' : 'admin',
    note: note || '',
  };

  if (student.transport.status !== TRANSPORT_STATUS.PENDING) {
    applyTransportState(student, TRANSPORT_STATUS.PENDING, note || 'Demande d\'inscription transport', req.user._id);
  }

  await student.save();

  await sendNotification(req.io, {
    type: 'general',
    title: 'Nouvelle demande transport',
    message: `Demande transport soumise pour ${student.user.firstName} ${student.user.lastName}.`,
    link: '/admin/transport/students',
    recipientRole: 'admin',
    createdBy: req.user._id,
  });

  const populated = await Student.findById(student._id)
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name section');

  res.status(200).json({ success: true, data: populated });
});

/* ── PUT /api/transports/students/:studentId/status ── */
const updateTransportStudentStatus = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { status, reason } = req.body;

  if (![TRANSPORT_STATUS.WITH, TRANSPORT_STATUS.WITHOUT, TRANSPORT_STATUS.PENDING].includes(status)) {
    return res.status(400).json({ success: false, message: 'Statut transport invalide.' });
  }

  const student = await Student.findById(studentId);
  if (!student) {
    return res.status(404).json({ success: false, message: 'Élève introuvable.' });
  }

  const currentStatus = student.transport?.status || TRANSPORT_STATUS.WITHOUT;
  if (currentStatus !== status) {
    applyTransportState(student, status, reason, req.user._id);
  }

  if (status === TRANSPORT_STATUS.WITHOUT) {
    student.transport.assignment = {
      transport: null,
      stopName: '',
      outboundTime: '',
      returnTime: '',
      assignedAt: null,
    };
  }

  await student.save();

  const populated = await Student.findById(student._id)
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name section')
    .populate('transport.assignment.transport', 'name matricule capacity');

  res.status(200).json({ success: true, data: populated });
});

/* ── PUT /api/transports/students/:studentId/assignment ── */
const assignStudentTransport = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { transportId, stopName, outboundTime, returnTime, reason } = req.body;

  if (!transportId) {
    return res.status(400).json({ success: false, message: 'Le bus est requis pour l\'affectation.' });
  }

  const [student, transport] = await Promise.all([
    Student.findById(studentId),
    Transport.findById(transportId),
  ]);

  if (!student) {
    return res.status(404).json({ success: false, message: 'Élève introuvable.' });
  }

  if (!transport || !transport.isActive) {
    return res.status(404).json({ success: false, message: 'Bus introuvable.' });
  }

  const assignedCount = await Student.countDocuments({
    _id: { $ne: student._id },
    'transport.status': TRANSPORT_STATUS.WITH,
    'transport.assignment.transport': transport._id,
  });

  if (assignedCount + 1 > (transport.capacity || 0)) {
    return res.status(400).json({
      success: false,
      message: `Capacité dépassée pour ${transport.name}. ${assignedCount}/${transport.capacity} déjà assignés.`,
    });
  }

  student.transport = student.transport || {};
  student.transport.assignment = {
    transport: transport._id,
    stopName: stopName || '',
    outboundTime: outboundTime || '',
    returnTime: returnTime || '',
    assignedAt: new Date(),
  };

  if (student.transport.status !== TRANSPORT_STATUS.WITH) {
    applyTransportState(student, TRANSPORT_STATUS.WITH, reason || 'Affectation bus validée', req.user._id);
  }

  await student.save();

  const populated = await Student.findById(student._id)
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name section')
    .populate('transport.assignment.transport', 'name matricule capacity');

  res.status(200).json({ success: true, data: populated });
});

/* ── GET /api/transports/load-balance ── */
const getTransportLoadBalance = asyncHandler(async (req, res) => {
  const data = await getBusLoadStats();
  res.status(200).json({ success: true, data });
});

/* ── GET /api/transports/students/dashboard ── */
const getTransportStudentsDashboard = asyncHandler(async (req, res) => {
  const [withTransport, pendingRequests, withoutTransport, transports, busLoad] = await Promise.all([
    Student.countDocuments({ 'transport.status': TRANSPORT_STATUS.WITH }),
    Student.countDocuments({ 'transport.status': TRANSPORT_STATUS.PENDING }),
    Student.countDocuments({
      $or: [
        { 'transport.status': TRANSPORT_STATUS.WITHOUT },
        { transport: { $exists: false } },
      ],
    }),
    Transport.find({ isActive: true }).select('name matricule vignette assurance'),
    getBusLoadStats(),
  ]);

  const overloadedBuses = busLoad.filter((item) => item.overloaded);
  const paymentAlerts = buildPaymentAlerts(transports);
  const paymentOverdueCount = paymentAlerts.filter((item) => item.severity === 'high').length;
  const averageOccupancy = busLoad.length
    ? Math.round(busLoad.reduce((sum, item) => sum + item.occupancyRate, 0) / busLoad.length)
    : 0;

  const topAlerts = [
    ...overloadedBuses.map((item) => ({
      severity: 'high',
      type: 'overload',
      message: `Bus surchargé: ${item.name} (${item.assignedCount}/${item.capacity})`,
    })),
    ...paymentAlerts,
  ].slice(0, 10);

  res.status(200).json({
    success: true,
    data: {
      kpis: {
        engagedStudents: withTransport,
        pendingRequests,
        nonEngagedStudents: withoutTransport,
        busCount: transports.length,
        averageOccupancy,
        paymentOverdueCount,
      },
      busLoad,
      topAlerts,
    },
  });
});

/* ── GET /api/transports ── */
const getTransports = asyncHandler(async (req, res) => {
  const transports = await Transport.find({ isActive: true })
    .populate('driver', 'firstName lastName phone employeeId')
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, data: transports });
});

/* ── GET /api/transports/drivers ── liste des chauffeurs dispo ── */
const getDrivers = asyncHandler(async (req, res) => {
  const drivers = await Staff.find({ type: 'driver', isActive: true })
    .select('firstName lastName phone employeeId')
    .sort({ firstName: 1 });

  res.status(200).json({ success: true, data: drivers });
});

/* ── POST /api/transports ── */
const createTransport = asyncHandler(async (req, res) => {
  const { name, matricule, capacity, route, driver, notes } = req.body;

  if (!name || !matricule) {
    return res.status(400).json({
      success: false,
      message: 'Le nom et la plaque d\'immatriculation sont requis.',
    });
  }

  const existing = await Transport.findOne({ matricule: matricule.trim().toUpperCase() });
  if (existing && existing.isActive) {
    return res.status(400).json({
      success: false,
      message: 'Un transport avec cette plaque existe déjà.',
    });
  }

  // Vérifier que le chauffeur est bien de type 'driver'
  if (driver) {
    const driverDoc = await Staff.findById(driver);
    if (!driverDoc || driverDoc.type !== 'driver') {
      return res.status(400).json({
        success: false,
        message: 'Le chauffeur sélectionné est invalide.',
      });
    }
  }

  const transport = await Transport.create({
    name,
    matricule: matricule.trim().toUpperCase(),
    type:     'bus',
    capacity: capacity || 30,
    route:    route    || '',
    driver:   driver   || null,
    notes:    notes    || '',
    vignette: {
      dueDate: null,
      isPaid: false,
      paidAt: null,
      lastNotifiedAt: null,
    },
    assurance: {
      dueDate: null,
      isPaid: false,
      paidAt: null,
      lastNotifiedAt: null,
    },
  });

  const populated = await Transport.findById(transport._id)
    .populate('driver', 'firstName lastName phone employeeId');

  res.status(201).json({ success: true, data: populated });
});

/* ── PUT /api/transports/:id ── */
const updateTransport = asyncHandler(async (req, res) => {
  const transport = await Transport.findById(req.params.id);
  if (!transport || !transport.isActive) {
    return res.status(404).json({ success: false, message: 'Transport introuvable.' });
  }

  const { name, matricule, capacity, route, driver, notes } = req.body;

  if (matricule && matricule.trim().toUpperCase() !== transport.matricule) {
    const conflict = await Transport.findOne({
      matricule: matricule.trim().toUpperCase(),
      _id: { $ne: transport._id },
    });
    if (conflict && conflict.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Un autre transport utilise déjà cette plaque.',
      });
    }
  }

  if (driver) {
    const driverDoc = await Staff.findById(driver);
    if (!driverDoc || driverDoc.type !== 'driver') {
      return res.status(400).json({
        success: false,
        message: 'Le chauffeur sélectionné est invalide.',
      });
    }
  }

  Object.assign(transport, {
    name:      name      ?? transport.name,
    matricule: matricule ? matricule.trim().toUpperCase() : transport.matricule,
    type:      'bus',
    capacity:  capacity  ?? transport.capacity,
    route:     route     ?? transport.route,
    driver:    driver !== undefined ? (driver || null) : transport.driver,
    notes:     notes     ?? transport.notes,
  });

  await transport.save();

  const populated = await Transport.findById(transport._id)
    .populate('driver', 'firstName lastName phone employeeId');

  res.status(200).json({ success: true, data: populated });
});

/* ── GET /api/transports/payments ── */
const getTransportPayments = asyncHandler(async (req, res) => {
  const transports = await Transport.find({ isActive: true })
    .populate('driver', 'firstName lastName')
    .sort({ createdAt: -1 });

  if (req.query.notify === 'true') {
    for (const transport of transports) {
      await maybeSendPaymentNotification(req.io, transport, req.user.id, false);
      await transport.save();
    }
  }

  const data = transports.map((transport) => ({
    ...transport.toObject(),
    paymentStatus: {
      vignette: getPaymentState(transport.vignette?.dueDate, transport.vignette?.isPaid),
      assurance: getPaymentState(transport.assurance?.dueDate, transport.assurance?.isPaid),
    },
  }));

  res.status(200).json({ success: true, data });
});

/* ── PUT /api/transports/:id/payments ── */
const updateTransportPayments = asyncHandler(async (req, res) => {
  const transport = await Transport.findById(req.params.id);
  if (!transport || !transport.isActive) {
    return res.status(404).json({ success: false, message: 'Transport introuvable.' });
  }

  const {
    vignetteDueDate,
    vignettePaid,
    assuranceDueDate,
    assurancePaid,
  } = req.body;

  if (vignetteDueDate !== undefined) {
    transport.vignette.dueDate = vignetteDueDate || null;
    if (!vignetteDueDate) {
      transport.vignette.isPaid = false;
      transport.vignette.paidAt = null;
    }
  }

  if (vignettePaid !== undefined) {
    const isPaid = Boolean(vignettePaid);
    transport.vignette.isPaid = isPaid;
    transport.vignette.paidAt = isPaid ? new Date() : null;
  }

  if (assuranceDueDate !== undefined) {
    transport.assurance.dueDate = assuranceDueDate || null;
    if (!assuranceDueDate) {
      transport.assurance.isPaid = false;
      transport.assurance.paidAt = null;
    }
  }

  if (assurancePaid !== undefined) {
    const isPaid = Boolean(assurancePaid);
    transport.assurance.isPaid = isPaid;
    transport.assurance.paidAt = isPaid ? new Date() : null;
  }

  await maybeSendPaymentNotification(req.io, transport, req.user.id, false);
  await transport.save();

  const populated = await Transport.findById(transport._id)
    .populate('driver', 'firstName lastName');

  res.status(200).json({ success: true, data: populated });
});

/* ── POST /api/transports/:id/payments/notify ── */
const notifyTransportPayments = asyncHandler(async (req, res) => {
  const transport = await Transport.findById(req.params.id);
  if (!transport || !transport.isActive) {
    return res.status(404).json({ success: false, message: 'Transport introuvable.' });
  }

  await maybeSendPaymentNotification(req.io, transport, req.user.id, true);
  await transport.save();

  res.status(200).json({ success: true, message: 'Notification(s) envoyée(s) pour ce véhicule.' });
});

/* ── DELETE /api/transports/:id ── soft delete ── */
const deleteTransport = asyncHandler(async (req, res) => {
  const transport = await Transport.findById(req.params.id);
  if (!transport || !transport.isActive) {
    return res.status(404).json({ success: false, message: 'Transport introuvable.' });
  }

  transport.isActive = false;
  await transport.save();

  res.status(200).json({ success: true, message: 'Transport supprimé.' });
});

const BusLocation = require('../models/BusLocation');

// @desc Get latest bus location
// @route GET /api/transports/location
const getBusLocation = asyncHandler(async (req, res) => {
  const { transportId } = req.query;
  const filter = {};
  if (transportId) filter.transport = transportId;
  const locations = await BusLocation.find(filter).sort('-timestamp').limit(1);
  res.status(200).json({ success: true, data: locations[0] || null });
});

// @desc Get bus location history
// @route GET /api/transports/history
const getLocationHistory = asyncHandler(async (req, res) => {
  const { transportId } = req.query;
  if (!transportId) return res.status(400).json({ success: false, message: 'Transport ID required.' });
  const history = await BusLocation.find({ transport: transportId }).sort('-timestamp').limit(100);
  res.status(200).json({ success: true, data: history });
});

module.exports = {
  getBusLocation,
  getLocationHistory,
  getTransports,
  getDrivers,
  createTransport,
  updateTransport,
  deleteTransport,
  getTransportPayments,
  updateTransportPayments,
  notifyTransportPayments,
  getTransportStudents,
  createTransportRequest,
  updateTransportStudentStatus,
  assignStudentTransport,
  getTransportLoadBalance,
  getTransportStudentsDashboard,
};
