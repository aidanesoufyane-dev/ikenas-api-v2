/**
 * Controller Absences - Création par prof, approbation par admin
 */
const Attendance = require('../models/Attendance');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const Schedule = require('../models/Schedule');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const { asyncHandler } = require('../utils/helpers');
const { sendNotification } = require('../utils/notify');
const { resolveActingStudent } = require('../utils/studentAccess');

const PRESENT_LIKE_STATUSES = new Set(['present', 'without_uniform']);

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const isPhysicalEducationSubject = (subject) => {
  const text = normalizeText([subject?.name, subject?.code].filter(Boolean).join(' '));
  return text.includes('education physique')
    || text.includes('physical education')
    || text.includes('eps');
};

const isPresentLike = (status) => PRESENT_LIKE_STATUSES.has(status);

const ensureWithoutUniformAllowed = (subject, status) => {
  if (status === 'without_uniform' && !isPhysicalEducationSubject(subject)) {
    const error = new Error('Le statut "sans tenue" est réservé à la matière éducation physique.');
    error.statusCode = 400;
    throw error;
  }
};

/**
 * @desc    Créer une absence (prof pour ses élèves)
 * @route   POST /api/attendances
 * @access  Private/Teacher,Admin
 */
const createAttendance = asyncHandler(async (req, res) => {
  const { student, date, status, reason, classe, subject } = req.body;
  const subjectDoc = subject ? await Subject.findById(subject).select('name code') : null;

  ensureWithoutUniformAllowed(subjectDoc, status || 'absent');

  // Si c'est un prof, vérifier qu'il enseigne bien à cet élève
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    const studentDoc = await Student.findById(student);

    if (!studentDoc) {
      return res.status(404).json({ success: false, message: 'Élève non trouvé.' });
    }

    const teachesClass = teacher.classes.some(
      (c) => c.toString() === studentDoc.classe.toString()
    );

    if (!teachesClass) {
      return res.status(403).json({
        success: false,
        message: "Vous ne pouvez enregistrer l'absence que pour vos élèves.",
      });
    }
  }

  const attendance = await Attendance.create({
    student,
    date: date || new Date(),
    status: status || 'absent',
    reason,
    recordedBy: req.user.id,
    classe,
    subject,
  });

  const populated = await Attendance.findById(attendance._id)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('recordedBy', 'firstName lastName');

  res.status(201).json({ success: true, data: populated });
});

/**
 * @desc    Lister les absences
 * @route   GET /api/attendances?status=pending&classe=&date=
 * @access  Private/Admin,Teacher
 */
const getAttendances = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const filter = {};

  if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;
  if (req.query.classe) filter.classe = req.query.classe;
  if (req.query.subject) filter.subject = req.query.subject;
  if (req.query.schedule) filter.schedule = req.query.schedule;
  if (req.query.includePresent !== 'true') {
    filter.status = { $ne: 'present' };
  }
  if (req.query.date) {
    const date = new Date(req.query.date);
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    filter.date = { $gte: date, $lt: nextDay };
  }

  // Si c'est un prof, il ne voit que les absences qu'il a enregistrées
  if (req.user.role === 'teacher') {
    filter.recordedBy = req.user.id;
  }

  const [attendances, total] = await Promise.all([
    Attendance.find(filter)
      .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
      .populate('recordedBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .populate('classe', 'name')
      .populate('subject', 'name')
      .populate('schedule', 'startTime endTime day')
      .sort('-date')
      .skip(skip)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: attendances,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  });
});

/**
 * @desc    Approuver ou refuser une absence
 * @route   PUT /api/attendances/:id/approve
 * @access  Private/Admin
 */
const approveAttendance = asyncHandler(async (req, res) => {
  const { approvalStatus } = req.body; // 'approved' ou 'rejected'

  if (!['approved', 'rejected'].includes(approvalStatus)) {
    return res.status(400).json({
      success: false,
      message: "Statut invalide. Utilisez 'approved' ou 'rejected'.",
    });
  }

  const attendance = await Attendance.findByIdAndUpdate(
    req.params.id,
    {
      approvalStatus,
      approvedBy: req.user.id,
    },
    { new: true }
  )
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('recordedBy', 'firstName lastName')
    .populate('approvedBy', 'firstName lastName');

  if (!attendance) {
    return res.status(404).json({ success: false, message: 'Absence non trouvée.' });
  }

  // Notifier le prof qui a enregistré l'absence
  if (attendance.recordedBy?._id) {
    await sendNotification(req.io, {
      type: approvalStatus === 'approved' ? 'absence_approved' : 'absence_rejected',
      title: approvalStatus === 'approved' ? 'Absence approuvée' : 'Absence rejetée',
      message: `L'absence de ${attendance.student?.user?.firstName} ${attendance.student?.user?.lastName} a été ${approvalStatus === 'approved' ? 'approuvée' : 'rejetée'}.`,
      recipient: attendance.recordedBy._id.toString(),
      link: '/teacher/attendances',
      createdBy: req.user.id,
    });
  }

  res.status(200).json({ success: true, data: attendance });
});

/**
 * @desc    Modifier un enregistrement de présence/absence (admin/superviseur)
 * @route   PUT /api/attendances/:id
 * @access  Private/Admin
 */
const updateAttendance = asyncHandler(async (req, res) => {
  const { status, reason } = req.body;
  const allowedStatuses = ['present', 'without_uniform', 'absent', 'late', 'excused'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Statut invalide.' });
  }

  const attendance = await Attendance.findById(req.params.id).populate('subject', 'name code');
  if (!attendance) {
    return res.status(404).json({ success: false, message: 'Absence introuvable.' });
  }

  ensureWithoutUniformAllowed(attendance.subject, status);

  attendance.status = status;
  attendance.reason = reason !== undefined ? String(reason || '').trim() : attendance.reason;

  // Toute modification repasse en attente d'approbation explicite
  attendance.approvalStatus = 'pending';
  attendance.approvedBy = null;

  if (isPresentLike(status)) {
    attendance.justifiedByStudent = false;
    attendance.justifiedAt = null;
  }

  await attendance.save();

  const populated = await Attendance.findById(attendance._id)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('recordedBy', 'firstName lastName')
    .populate('approvedBy', 'firstName lastName')
    .populate('classe', 'name')
    .populate('subject', 'name');

  res.status(200).json({ success: true, data: populated, message: 'Statut de présence mis à jour.' });
});

/**
 * @desc    Récupérer l'emploi du temps d'une classe pour un jour donné
 * @route   GET /api/attendances/class-schedule?classe=&date=
 * @access  Private/Teacher
 */
const getClassScheduleForDate = asyncHandler(async (req, res) => {
  const { classe, date } = req.query;

  if (!classe || !date) {
    return res.status(400).json({ success: false, message: 'Classe et date requises.' });
  }

  // Déterminer le jour de la semaine à partir de la date
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const dayOfWeek = days[new Date(date).getDay()];

  const filter = { classe, day: dayOfWeek, isActive: true };

  // Si c'est un prof, ne montrer que ses propres séances
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (teacher) filter.teacher = teacher._id;
  }

  const schedules = await Schedule.find(filter)
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('classe', 'name')
    .sort({ startTime: 1 });

  res.status(200).json({ success: true, data: schedules });
});

/**
 * @desc    Créer des absences en masse pour une séance
 * @route   POST /api/attendances/bulk
 * @access  Private/Teacher,Admin
 * @body    { date, classe, subject, schedule (schedule._id), absences: [{ student, status }] }
 */
const createBulkAttendance = asyncHandler(async (req, res) => {
  const { date, classe, subject, schedule, absences } = req.body;

  if (!date || !classe || !absences || !Array.isArray(absences)) {
    return res.status(400).json({ success: false, message: 'Données incomplètes.' });
  }

  const scheduleDoc = schedule
    ? await Schedule.findById(schedule).populate('subject', 'name code')
    : null;
  const subjectDoc = subject
    ? await Subject.findById(subject).select('name code')
    : scheduleDoc?.subject || null;
  if (absences.some((item) => item.status === 'without_uniform')) {
    ensureWithoutUniformAllowed(subjectDoc, 'without_uniform');
  }

  // Si c'est un prof, vérifier qu'il enseigne cette classe
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    const teachesClass = teacher.classes.some(
      (c) => c.toString() === classe.toString()
    );
    // Also check via schedule
    const hasSchedule = await Schedule.findOne({ teacher: teacher._id, classe, isActive: true });

    if (!teachesClass && !hasSchedule) {
      return res.status(403).json({
        success: false,
        message: "Vous n'enseignez pas à cette classe.",
      });
    }
  }

  // Supprimer les anciennes absences de ces élèves pour cette date/classe/matière
  const studentIds = absences.map((a) => a.student);
  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const dedupeFilter = {
    student: { $in: studentIds },
    classe,
    date: { $gte: dateStart, $lte: dateEnd },
  };

  if (schedule) {
    dedupeFilter.schedule = schedule;
  } else {
    dedupeFilter.subject = subject || undefined;
  }

  await Attendance.deleteMany(dedupeFilter);

  const docs = absences.map((a) => ({
    student: a.student,
    date: new Date(date),
    status: a.status || 'present',
    reason: a.reason || '',
    recordedBy: req.user.id,
    classe,
    subject: subject || undefined,
    schedule: schedule || undefined,
    // L'élève ne voit les enregistrements qu'après validation admin
    approvalStatus: 'pending',
    justifiedByStudent: false,
    justifiedAt: null,
  }));

  const created = await Attendance.insertMany(docs);

  const populated = await Attendance.find({ _id: { $in: created.map((c) => c._id) } })
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('recordedBy', 'firstName lastName')
    .populate('classe', 'name')
    .populate('subject', 'name')
    .populate('schedule', 'startTime endTime day');

  const nonPresent = populated.filter((item) => !isPresentLike(item.status));

  // Notifications
  // 1. Notifier admin + surveillant qu'une saisie est en attente de validation
  const classDoc = await Class.findById(classe).select('name');
  if (populated.length > 0) {
    const pendingMessage = nonPresent.length > 0
      ? `${nonPresent.length} absence(s) enregistrée(s) pour ${classDoc?.name || 'une classe'} le ${new Date(date).toLocaleDateString('fr-FR')}. Validation requise.`
      : `Saisie de présence enregistrée pour ${classDoc?.name || 'une classe'} le ${new Date(date).toLocaleDateString('fr-FR')}. Validation requise.`;

    await sendNotification(req.io, {
      type: 'attendance_pending_validation',
      title: 'Présences en attente de validation',
      message: pendingMessage,
      recipientRole: 'admin',
      link: '/admin/attendances',
      createdBy: req.user.id,
    });

    await sendNotification(req.io, {
      type: 'attendance_pending_validation',
      title: 'Présences en attente de validation',
      message: pendingMessage,
      recipientRole: 'supervisor',
      link: '/supervisor/attendances',
      createdBy: req.user.id,
    });
  }

  // Les élèves ne sont pas notifiés ici: affichage/notification après approbation admin uniquement.

  res.status(201).json({
    success: true,
    data: populated,
    message: `${docs.length} présence(s) enregistrée(s), dont ${nonPresent.length} absence(s)/retard(s)/excusé(s).`,
  });
});

/**
 * @desc    Rapport journalier : tous les élèves d'une classe + absences du jour
 * @route   GET /api/attendances/daily-report?classe=&date=
 * @access  Private/Admin
 */
const getDailyReport = asyncHandler(async (req, res) => {
  const { classe, date, subject } = req.query;

  if (!classe || !date) {
    return res.status(400).json({ success: false, message: 'Classe et date requises.' });
  }

  const classifyPeriod = (timeValue) => {
    const [rawHours] = String(timeValue || '00:00').split(':');
    const hours = Number(rawHours);
    return Number.isFinite(hours) && hours >= 12 ? 'afternoon' : 'morning';
  };

  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  const students = await Student.find({ classe })
    .populate('user', 'firstName lastName')
    .sort({ classOrder: 1, createdAt: 1 });

  const attendanceFilter = { classe, date: { $gte: dateStart, $lte: dateEnd } };

  // Compatibilité: vue historique par matière (séance)
  if (subject) {
    attendanceFilter.subject = subject;

    const subjectAttendances = await Attendance.find(attendanceFilter)
      .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
      .populate('recordedBy', 'firstName lastName')
      .populate('subject', 'name code')
      .populate('schedule', 'startTime endTime day');

    const attendanceRecordedToday = subjectAttendances.length > 0;

    const report = students.map((s) => {
      const records = subjectAttendances.filter(
        (a) => a.student?._id?.toString() === s._id.toString()
      );

      let isPresent = true;
      let hasNoRecording = false;

      if (attendanceRecordedToday) {
        if (records.length === 0) {
          isPresent = true;
        } else {
          const incidentRecords = records.filter((r) => !isPresentLike(r.status));
          isPresent = incidentRecords.length === 0;
        }
      } else {
        hasNoRecording = true;
        isPresent = false;
      }

      return {
        student: {
          _id: s._id,
          matricule: s.matricule,
          user: s.user,
        },
        records,
        isPresent,
        hasNoRecording,
      };
    });

    return res.status(200).json({
      success: true,
      data: report,
      attendanceRecordedToday,
      summary: {
        total: students.length,
        present: attendanceRecordedToday ? report.filter((r) => r.isPresent && !r.hasNoRecording).length : 0,
        absent: report.filter((r) => r.records.some((a) => a.status === 'absent')).length,
        late: report.filter((r) => r.records.some((a) => a.status === 'late')).length,
        excused: report.filter((r) => r.records.some((a) => a.status === 'excused')).length,
        notRecorded: report.filter((r) => r.hasNoRecording).length,
      },
    });
  }

  const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const dayOfWeek = dayNames[new Date(date).getDay()];
  const schedules = await Schedule.find({ classe, day: dayOfWeek, isActive: true })
    .select('_id subject startTime endTime day')
    .sort({ startTime: 1 });

  const scheduleMap = new Map();
  const subjectPeriodMap = new Map();
  const periodSchedulesCount = { morning: 0, afternoon: 0 };

  schedules.forEach((item) => {
    const period = classifyPeriod(item.startTime);
    const key = String(item._id);
    scheduleMap.set(key, period);
    periodSchedulesCount[period] += 1;

    const subjectId = String(item.subject || '');
    if (!subjectId) return;
    if (!subjectPeriodMap.has(subjectId)) subjectPeriodMap.set(subjectId, new Set());
    subjectPeriodMap.get(subjectId).add(period);
  });

  const attendances = await Attendance.find(attendanceFilter)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('recordedBy', 'firstName lastName')
    .populate('subject', 'name code')
    .populate('schedule', 'startTime endTime day');

  const getRecordPeriod = (record) => {
    const scheduleId = record?.schedule?._id ? String(record.schedule._id) : String(record.schedule || '');
    if (scheduleId && scheduleMap.has(scheduleId)) return scheduleMap.get(scheduleId);

    if (record?.schedule?.startTime) {
      return classifyPeriod(record.schedule.startTime);
    }

    const subjectId = record?.subject?._id ? String(record.subject._id) : String(record.subject || '');
    if (!subjectId) return null;

    const possiblePeriods = subjectPeriodMap.get(subjectId);
    if (!possiblePeriods || possiblePeriods.size !== 1) return null;

    return Array.from(possiblePeriods)[0];
  };

  const attendanceByStudent = new Map();
  const classHasRecordByPeriod = { morning: false, afternoon: false };

  attendances.forEach((record) => {
    const studentId = String(record.student?._id || record.student || '');
    if (!studentId) return;

    const period = getRecordPeriod(record);
    if (!period) return;

    classHasRecordByPeriod[period] = true;

    if (!attendanceByStudent.has(studentId)) {
      attendanceByStudent.set(studentId, { morning: [], afternoon: [] });
    }

    attendanceByStudent.get(studentId)[period].push(record);
  });

  const computePeriodCell = (records, period) => {
    if (!records || records.length === 0) {
      if (periodSchedulesCount[period] === 0) {
        return { status: 'no-session', label: 'Aucune seance', records: [], pendingCount: 0 };
      }

      if (!classHasRecordByPeriod[period]) {
        return { status: 'not-recorded', label: 'Appel non saisi', records: [], pendingCount: 0 };
      }

      return { status: 'present', label: 'Present', records: [], pendingCount: 0 };
    }

    const statuses = [...new Set(records.map((r) => r.status))];
    const pendingCount = records.filter((r) => !r.approvalStatus || r.approvalStatus === 'pending').length;

    if (statuses.length === 1) {
      const uniqueStatus = statuses[0];
      const labels = {
        present: 'Present',
        without_uniform: 'Sans tenue',
        absent: 'Absent',
        late: 'Retard',
        excused: 'Excuse',
      };

      return {
        status: uniqueStatus,
        label: labels[uniqueStatus] || uniqueStatus,
        records,
        pendingCount,
      };
    }

    if (statuses.some((value) => isPresentLike(value)) && statuses.some((value) => !isPresentLike(value))) {
      return { status: 'partial', label: 'Partiel', records, pendingCount };
    }

    return { status: 'mixed', label: 'Mixte', records, pendingCount };
  };

  const report = students.map((s) => {
    const studentId = String(s._id);
    const studentRecords = attendanceByStudent.get(studentId) || { morning: [], afternoon: [] };

    const morning = computePeriodCell(studentRecords.morning, 'morning');
    const afternoon = computePeriodCell(studentRecords.afternoon, 'afternoon');

    return {
      student: {
        _id: s._id,
        matricule: s.matricule,
        user: s.user,
        parentPhone: s.parentPhone || '',
      },
      morning,
      afternoon,
      records: [...studentRecords.morning, ...studentRecords.afternoon],
    };
  });

  const summary = {
    total: students.length,
    morning: {
      present: report.filter((row) => isPresentLike(row.morning.status)).length,
      absent: report.filter((row) => row.morning.status === 'absent').length,
      late: report.filter((row) => row.morning.status === 'late').length,
      excused: report.filter((row) => row.morning.status === 'excused').length,
      partial: report.filter((row) => row.morning.status === 'partial').length,
      notRecorded: report.filter((row) => row.morning.status === 'not-recorded').length,
    },
    afternoon: {
      present: report.filter((row) => isPresentLike(row.afternoon.status)).length,
      absent: report.filter((row) => row.afternoon.status === 'absent').length,
      late: report.filter((row) => row.afternoon.status === 'late').length,
      excused: report.filter((row) => row.afternoon.status === 'excused').length,
      partial: report.filter((row) => row.afternoon.status === 'partial').length,
      notRecorded: report.filter((row) => row.afternoon.status === 'not-recorded').length,
    },
    pendingRecords: attendances.filter((a) => !a.approvalStatus || a.approvalStatus === 'pending').length,
  };

  return res.status(200).json({
    success: true,
    data: report,
    summary,
    meta: {
      schedules: {
        morning: periodSchedulesCount.morning,
        afternoon: periodSchedulesCount.afternoon,
      },
      classHasRecordByPeriod,
    },
  });
});

/**
 * @desc    Approuver/rejeter toutes les absences en attente d'une classe pour un jour
 * @route   PUT /api/attendances/approve-bulk
 * @access  Private/Admin
 * @body    { ids: [id1, id2, ...], approvalStatus: 'approved' | 'rejected' }
 */
const approveBulk = asyncHandler(async (req, res) => {
  const { ids, approvalStatus } = req.body;

  if (!ids || !Array.isArray(ids) || !['approved', 'rejected'].includes(approvalStatus)) {
    return res.status(400).json({ success: false, message: 'Données invalides.' });
  }

  const result = await Attendance.updateMany(
    { _id: { $in: ids } },
    { approvalStatus, approvedBy: req.user.id }
  );

  // Notifier les profs concernés que leurs absences ont été traitées
  const updatedDocs = await Attendance.find({ _id: { $in: ids } })
    .populate('recordedBy', '_id')
    .populate('classe', 'name');

  const recorderIds = [...new Set(updatedDocs.filter((a) => a.recordedBy).map((a) => a.recordedBy._id.toString()))];
  const className = updatedDocs[0]?.classe?.name || '';

  for (const rid of recorderIds) {
    await sendNotification(req.io, {
      type: approvalStatus === 'approved' ? 'absence_approved' : 'absence_rejected',
      title: approvalStatus === 'approved' ? 'Absences approuvées' : 'Absences rejetées',
      message: `${result.modifiedCount} absence(s)${className ? ' de ' + className : ''} ${approvalStatus === 'approved' ? 'approuvée(s)' : 'rejetée(s)'} par l\'admin.`,
      recipient: rid,
      link: '/teacher/attendances',
      createdBy: req.user.id,
    });
  }

  res.status(200).json({
    success: true,
    message: `${result.modifiedCount} absence(s) ${approvalStatus === 'approved' ? 'approuvée(s)' : 'rejetée(s)'}.`,
  });
});

/**
 * @desc    Historique présence/absence de l'élève connecté
 * @route   GET /api/attendances/me
 * @access  Private/Student
 */
const getMyAttendances = asyncHandler(async (req, res) => {
  const student = await resolveActingStudent(req);

  const filter = {
    student: student._id,
    approvalStatus: 'approved',
  };

  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) filter.date.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      filter.date.$lte = to;
    }
  }

  const records = await Attendance.find(filter)
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate('recordedBy', 'firstName lastName')
    .sort('-date');

  const summary = {
    total: records.length,
    present: records.filter((r) => isPresentLike(r.status)).length,
    absent: records.filter((r) => r.status === 'absent').length,
    late: records.filter((r) => r.status === 'late').length,
    excused: records.filter((r) => r.status === 'excused').length,
  };

  res.status(200).json({ success: true, data: records, summary });
});

/**
 * @desc    Justifier une absence/retard (élève)
 * @route   PUT /api/attendances/:id/justify
 * @access  Private/Student
 */
const justifyAttendance = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ success: false, message: 'La justification est requise.' });
  }

  const student = await resolveActingStudent(req);

  const attendance = await Attendance.findOne({ _id: req.params.id, student: student._id });
  if (!attendance) {
    return res.status(404).json({ success: false, message: 'Enregistrement introuvable.' });
  }

  if (!['absent', 'late'].includes(attendance.status)) {
    return res.status(400).json({ success: false, message: 'Seules les absences/retards peuvent être justifiés.' });
  }

  attendance.reason = String(reason || '').trim();
  attendance.justifiedByStudent = true;
  attendance.justifiedAt = new Date();
  attendance.approvalStatus = 'pending';

  if (req.file) {
    attendance.justificationAttachment = {
      url: `/uploads/attendance-justifications/${req.file.filename}`,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    };
  }

  await attendance.save();

  const populated = await Attendance.findById(attendance._id)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate('recordedBy', 'firstName lastName');

  await sendNotification(req.io, {
    type: 'attendance_justification_submitted',
    title: 'Nouvelle justification élève',
    message: `${populated.student?.user?.firstName || ''} ${populated.student?.user?.lastName || ''} a envoyé une justification (${populated.status === 'late' ? 'retard' : 'absence'})${populated.subject?.name ? ` en ${populated.subject.name}` : ''}.`,
    recipientRole: 'admin',
    link: '/admin/attendances',
    createdBy: req.user.id,
  });

  res.status(200).json({
    success: true,
    data: populated,
    message: 'Justification envoyée avec succès.',
  });
});

module.exports = {
  createAttendance,
  createBulkAttendance,
  getAttendances,
  getClassScheduleForDate,
  updateAttendance,
  approveAttendance,
  approveBulk,
  getDailyReport,
  getMyAttendances,
  justifyAttendance,
};
