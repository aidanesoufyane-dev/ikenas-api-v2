/**
 * Controller Professeurs - CRUD, assignation matières/classes, présence
 */
const Teacher = require('../models/Teacher');
const TeacherPresence = require('../models/TeacherPresence');
const User = require('../models/User');
const Student = require('../models/Student');
const Schedule = require('../models/Schedule');
const XLSX = require('xlsx');
const { asyncHandler, getTodayStart, getTodayEnd } = require('../utils/helpers');

const FRENCH_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const toMinutes = (value = '00:00') => {
  const [hours, minutes] = String(value).split(':').map((item) => parseInt(item, 10));
  return ((Number.isFinite(hours) ? hours : 0) * 60) + (Number.isFinite(minutes) ? minutes : 0);
};

const isSameDay = (leftDate, rightDate) => {
  if (!leftDate || !rightDate) return false;
  return leftDate.toDateString() === rightDate.toDateString();
};

const parseDateOnlyToLocalStart = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      return new Date(year, month - 1, day, 0, 0, 0, 0);
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0);
};

const getTeacherTodayScheduleMeta = async (teacherId, referenceDate = new Date()) => {
  const dayName = FRENCH_DAYS[referenceDate.getDay()];
  const slots = await Schedule.find({
    teacher: teacherId,
    day: dayName,
    isActive: true,
  }).sort({ startTime: 1 });

  if (slots.length === 0) {
    return {
      dayName,
      hasClassToday: false,
      firstStartTime: null,
      isLateAt: false,
    };
  }

  const firstStartTime = slots[0].startTime;
  const nowMinutes = (referenceDate.getHours() * 60) + referenceDate.getMinutes();
  const firstStartMinutes = toMinutes(firstStartTime);

  return {
    dayName,
    hasClassToday: true,
    firstStartTime,
    isLateAt: nowMinutes > firstStartMinutes,
  };
};

/**
 * @desc    Créer un professeur
 * @route   POST /api/teachers
 * @access  Private/Admin
 */
const createTeacher = asyncHandler(async (req, res) => {
  const {
    firstName, lastName, email, password, phone,
    employeeId, subjects, classes, specialization,
  } = req.body;

  // Créer le compte utilisateur
  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role: 'teacher',
    phone,
  });

  // Créer le profil enseignant
  const teacher = await Teacher.create({
    user: user._id,
    employeeId,
    subjects: subjects || [],
    classes: classes || [],
    phone,
    specialization,
  });

  const populatedTeacher = await Teacher.findById(teacher._id)
    .populate('user', 'firstName lastName email phone')
    .populate('subjects', 'name code')
    .populate('classes', 'name');

  res.status(201).json({
    success: true,
    data: populatedTeacher,
  });
});

/**
 * @desc    Lister tous les professeurs
 * @route   GET /api/teachers
 * @access  Private/Admin
 */
const getTeachers = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const [teachers, total] = await Promise.all([
    Teacher.find()
      .populate('user', 'firstName lastName email phone isActive')
      .populate('subjects', 'name code')
      .populate('classes', 'name')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit),
    Teacher.countDocuments(),
  ]);

  const activeTeachers = teachers.filter((teacher) => teacher.user && teacher.user.isActive);

  res.status(200).json({
    success: true,
    data: activeTeachers,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * @desc    Obtenir un professeur par ID
 * @route   GET /api/teachers/:id
 * @access  Private/Admin
 */
const getTeacher = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.params.id)
    .populate('user', 'firstName lastName email phone isActive')
    .populate('subjects', 'name code')
    .populate('classes', 'name');

  if (!teacher) {
    return res.status(404).json({
      success: false,
      message: 'Professeur non trouvé.',
    });
  }

  res.status(200).json({
    success: true,
    data: teacher,
  });
});

/**
 * @desc    Mettre à jour un professeur
 * @route   PUT /api/teachers/:id
 * @access  Private/Admin
 */
const updateTeacher = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, ...teacherData } = req.body;

  let teacher = await Teacher.findById(req.params.id);
  if (!teacher) {
    return res.status(404).json({
      success: false,
      message: 'Professeur non trouvé.',
    });
  }

  // Mettre à jour les données utilisateur (incluant mot de passe)
  if (firstName || lastName || email || phone || password) {
    const linkedUser = await User.findById(teacher.user);

    if (!linkedUser) {
      return res.status(404).json({
        success: false,
        message: 'Compte utilisateur du professeur non trouvé.',
      });
    }

    if (firstName) linkedUser.firstName = firstName;
    if (lastName) linkedUser.lastName = lastName;
    if (email) linkedUser.email = email;
    if (phone) linkedUser.phone = phone;
    if (password) linkedUser.password = password;

    await linkedUser.save();
  }

  teacher = await Teacher.findByIdAndUpdate(req.params.id, teacherData, {
    new: true,
    runValidators: true,
  })
    .populate('user', 'firstName lastName email phone')
    .populate('subjects', 'name code')
    .populate('classes', 'name');

  res.status(200).json({
    success: true,
    data: teacher,
  });
});

/**
 * @desc    Supprimer un professeur
 * @route   DELETE /api/teachers/:id
 * @access  Private/Admin
 */
const deleteTeacher = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findById(req.params.id);
  if (!teacher) {
    return res.status(404).json({
      success: false,
      message: 'Professeur non trouvé.',
    });
  }

  // Supprime le compte utilisateur associé et la fiche professeur
  await User.findByIdAndDelete(teacher.user);
  await Teacher.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: 'Professeur supprimé avec succès.',
  });
});

/**
 * @desc    Signer la présence quotidienne (prof)
 * @route   POST /api/teachers/sign-presence
 * @access  Private/Teacher
 */
const signPresence = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findOne({ user: req.user.id });
  if (!teacher) {
    return res.status(404).json({
      success: false,
      message: 'Profil enseignant non trouvé.',
    });
  }

  const todayStart = getTodayStart();

  // Vérifier si déjà signé aujourd'hui
  const existing = await TeacherPresence.findOne({
    teacher: teacher._id,
    date: {
      $gte: todayStart,
      $lte: getTodayEnd(),
    },
  });

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'Présence déjà signée pour aujourd\'hui.',
    });
  }

  const presence = await TeacherPresence.create({
    teacher: teacher._id,
    date: todayStart,
    status: 'present',
  });

  res.status(201).json({
    success: true,
    data: presence,
    message: 'Présence signée avec succès.',
  });
});

/**
 * @desc    Voir la présence des profs (admin)
 * @route   GET /api/teachers/presence?date=
 * @access  Private/Admin
 */
const getPresence = asyncHandler(async (req, res) => {
  const date = parseDateOnlyToLocalStart(req.query.date) || getTodayStart();
  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);

  const presences = await TeacherPresence.find({
    date: { $gte: date, $lte: endDate },
  }).populate({
    path: 'teacher',
    populate: { path: 'user', select: 'firstName lastName email' },
  });

  res.status(200).json({
    success: true,
    data: presences,
  });
});

/**
 * @desc    Signer la présence d'un professeur depuis l'accueil/admin
 * @route   POST /api/teachers/sign-presence-by-staff
 * @access  Private/Admin,Reception
 */
const signPresenceByStaff = asyncHandler(async (req, res) => {
  const { teacherId, date } = req.body;

  if (!teacherId) {
    return res.status(400).json({
      success: false,
      message: 'Le professeur est requis.',
    });
  }

  const teacher = await Teacher.findById(teacherId);
  if (!teacher) {
    return res.status(404).json({
      success: false,
      message: 'Professeur non trouvé.',
    });
  }

  const targetDate = parseDateOnlyToLocalStart(date) || getTodayStart();
  const today = getTodayStart();

  if (!isSameDay(targetDate, today)) {
    return res.status(400).json({
      success: false,
      message: 'La signature est autorisée uniquement pour aujourd\'hui.',
    });
  }

  const signedAt = new Date();
  const scheduleMeta = await getTeacherTodayScheduleMeta(teacher._id, signedAt);
  const computedStatus = scheduleMeta.isLateAt ? 'late' : 'present';

  const existing = await TeacherPresence.findOne({
    teacher: teacher._id,
    date: {
      $gte: targetDate,
      $lte: new Date(targetDate.getTime() + (24 * 60 * 60 * 1000) - 1),
    },
  });

  if (existing) {
    existing.status = computedStatus;
    existing.signedAt = signedAt;
    await existing.save();

    return res.status(200).json({
      success: true,
      data: existing,
      message: 'Présence mise à jour.',
      scheduleMeta,
    });
  }

  const presence = await TeacherPresence.create({
    teacher: teacher._id,
    date: targetDate,
    status: computedStatus,
    signedAt,
  });

  res.status(201).json({
    success: true,
    data: presence,
    message: 'Présence enregistrée.',
    scheduleMeta,
  });
});

/**
 * @desc    Signer la sortie d'un professeur depuis l'accueil/admin
 * @route   POST /api/teachers/sign-out-by-staff
 * @access  Private/Admin,Reception
 */
const signOutByStaff = asyncHandler(async (req, res) => {
  const { teacherId, date } = req.body;

  if (!teacherId) {
    return res.status(400).json({
      success: false,
      message: 'Le professeur est requis.',
    });
  }

  const teacher = await Teacher.findById(teacherId);
  if (!teacher) {
    return res.status(404).json({
      success: false,
      message: 'Professeur non trouvé.',
    });
  }

  const targetDate = parseDateOnlyToLocalStart(date) || getTodayStart();
  const today = getTodayStart();

  if (!isSameDay(targetDate, today)) {
    return res.status(400).json({
      success: false,
      message: 'La sortie est autorisée uniquement pour aujourd\'hui.',
    });
  }

  const presence = await TeacherPresence.findOne({
    teacher: teacher._id,
    date: {
      $gte: targetDate,
      $lte: new Date(targetDate.getTime() + (24 * 60 * 60 * 1000) - 1),
    },
  });

  if (!presence) {
    return res.status(400).json({
      success: false,
      message: 'Le professeur doit signer sa présence avant la sortie.',
    });
  }

  const signedOutAt = new Date();
  presence.signedOutAt = signedOutAt;
  await presence.save();

  res.status(200).json({
    success: true,
    data: presence,
    message: 'Sortie enregistrée.',
  });
});

/**
 * @desc    Import en masse de professeurs depuis un CSV/Excel
 * @route   POST /api/teachers/import
 * @access  Private/Admin
 */
const importTeachers = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Aucun fichier envoyé.' });
  }

  const strip = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const normalizeField = (value) => {
    const v = strip(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (['employeeid', 'employee id', 'matricule', 'id', 'identifiant', 'employee'].includes(v) || v.includes('employ')) return 'employeeId';
    if (v === 'prenom' || v === 'prénom') return 'firstName';
    if (v === 'nom' || v === 'lastname' || v === 'last name') return 'lastName';
    if (v.includes('email')) return 'email';
    if (v.includes('password') || v.includes('mot de passe')) return 'password';
    if (v.includes('phone') || v.includes('telephone') || v.includes('téléphone')) return 'phone';
    if (v.includes('special') || v.includes('specialite') || v.includes('spécialité')) return 'specialization';
    return null;
  };

  let allRows = [];
  const rawText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');

  if (rawText.length > 0) {
    const lines = rawText.split(/\r?\n/).filter((line) => line.trim() !== '');
    let delimiter = ',';
    if (lines.length > 0) {
      const headerLine = lines[0];
      const commaCount = (headerLine.match(/,/g) || []).length;
      const semiCount = (headerLine.match(/;/g) || []).length;
      const tabCount = (headerLine.match(/\t/g) || []).length;
      if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
      else if (tabCount > commaCount) delimiter = '\t';
    }
    allRows = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  }

  if (allRows.length === 0) {
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    } catch (err) {
      // ignore
    }
  }

  if (allRows.length === 0) {
    return res.status(400).json({ success: false, message: 'Impossible de lire le fichier.' });
  }

  let headerIdx = -1;
  let colIdx = {};

  for (let i = 0; i < Math.min(allRows.length, 25); i++) {
    const normalizedHeaders = allRows[i].map((h) => normalizeField(h));
    const required = ['employeeId', 'firstName', 'lastName', 'email', 'password'];
    const found = required.every((key) => normalizedHeaders.includes(key));
    if (found) {
      headerIdx = i;
      normalizedHeaders.forEach((field, idx) => {
        if (field) colIdx[field] = idx;
      });
      break;
    }
  }

  if (headerIdx === -1) {
    return res.status(400).json({
      success: false,
      message: 'En-tête non reconnue. Colonnes requises: employeeId, prenom, nom, email, password.',
    });
  }

  const dataRows = allRows.slice(headerIdx + 1).filter((row) => row.some((cell) => String(cell).trim() !== ''));

  if (dataRows.length === 0) {
    return res.status(400).json({ success: false, message: 'Aucune donnée à importer.' });
  }

  const existingEmails = new Set((await User.find({ role: 'teacher' }).select('email').lean()).map((u) => u.email));
  const existingEmployeeIds = new Set((await Teacher.find().select('employeeId').lean()).map((t) => t.employeeId));

  const results = { total: dataRows.length, success: 0, errors: [], imported: [] };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 1;

    const employeeId = String(row[colIdx.employeeId] || '').trim();
    const firstName = String(row[colIdx.firstName] || '').trim();
    const lastName = String(row[colIdx.lastName] || '').trim();
    const email = String(row[colIdx.email] || '').trim().toLowerCase();
    const password = String(row[colIdx.password] || '').trim();
    const phone = colIdx.phone !== undefined ? String(row[colIdx.phone] || '').trim() : '';
    const specialization = colIdx.specialization !== undefined ? String(row[colIdx.specialization] || '').trim() : '';

    if (!employeeId || !firstName || !lastName || !email || !password) {
      results.errors.push({ row: rowNum, employeeId, email, message: 'Champs obligatoires manquants.' });
      continue;
    }

    if (existingEmployeeIds.has(employeeId)) {
      results.errors.push({ row: rowNum, employeeId, email, message: `ID employé déjà existant: ${employeeId}` });
      continue;
    }

    if (existingEmails.has(email)) {
      results.errors.push({ row: rowNum, employeeId, email, message: `Email déjà existant: ${email}` });
      continue;
    }

    try {
      const user = await User.create({ firstName, lastName, email, password, phone, role: 'teacher' });
      await Teacher.create({ user: user._id, employeeId, phone, specialization });

      existingEmployeeIds.add(employeeId);
      existingEmails.add(email);

      results.success += 1;
      results.imported.push({ employeeId, firstName, lastName, email });
    } catch (err) {
      results.errors.push({ row: rowNum, employeeId, email, message: err.message || 'Erreur lors de l’import.' });
    }
  }

  res.status(200).json({ success: true, message: `Import terminé: ${results.success}/${results.total} profs importés.`, data: results });
});

/**
 * @desc    Liste simple des professeurs pour pointage accueil
 * @route   GET /api/teachers/basic-list
 * @access  Private/Admin,Reception
 */
const getTeachersBasic = asyncHandler(async (req, res) => {
  const now = new Date();
  const teachers = await Teacher.find()
    .populate('user', 'firstName lastName email phone isActive')
    .sort({ createdAt: -1 });

  const activeTeachers = teachers.filter((teacher) => teacher.user?.isActive);
  const rows = [];

  for (const teacher of activeTeachers) {
    const scheduleMeta = await getTeacherTodayScheduleMeta(teacher._id, now);
    rows.push({
      _id: teacher._id,
      employeeId: teacher.employeeId,
      firstName: teacher.user.firstName,
      lastName: teacher.user.lastName,
      email: teacher.user.email,
      phone: teacher.user.phone,
      scheduleMeta,
    });
  }

  res.status(200).json({ success: true, data: rows });
});

/**
 * @desc    Récupérer les classes assignées au professeur connecté
 * @route   GET /api/teachers/my-classes
 * @access  Private/Teacher
 */
const getMyClasses = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findOne({ user: req.user.id }).populate('classes', 'name level');

  if (!teacher) {
    res.status(404);
    throw new Error('Profil enseignant introuvable.');
  }

  const classes = await Promise.all(
    (teacher.classes || []).map(async (cls) => {
      const count = await Student.countDocuments({ classe: cls._id });
      return { _id: cls._id, id: cls._id, name: cls.name, level: cls.level, studentCount: count };
    })
  );

  res.status(200).json({
    success: true,
    data: classes,
  });
});

/**
 * @desc    Récupérer les matières assignées au professeur connecté
 * @route   GET /api/teachers/my-subjects
 * @access  Private/Teacher
 */
const getMySubjects = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findOne({ user: req.user.id }).populate('subjects', 'name code');

  if (!teacher) {
    res.status(404);
    throw new Error('Profil enseignant introuvable.');
  }

  res.status(200).json({
    success: true,
    data: teacher.subjects || [],
  });
});

module.exports = {
  createTeacher,
  getTeachers,
  getTeacher,
  updateTeacher,
  deleteTeacher,
  importTeachers,
  signPresence,
  getPresence,
  signPresenceByStaff,
  signOutByStaff,
  getTeachersBasic,
  getMyClasses,
  getMySubjects,
};
