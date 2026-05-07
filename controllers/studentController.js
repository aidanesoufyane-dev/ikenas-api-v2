/**
 * Controller Élèves - CRUD complet avec pagination, recherche, photo upload, import Excel
 */
const Student = require('../models/Student');
const User = require('../models/User');
const Class = require('../models/Class');
const { asyncHandler } = require('../utils/helpers');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getParentChildren } = require('../utils/studentAccess');
const {
  ensureClassAccessibleForSupervisor,
  getSupervisorClassScope,
} = require('../utils/supervisorScope');

const parseParentName = (parentName = '') => {
  const normalized = String(parentName || '').trim();
  if (!normalized) {
    return { firstName: 'Parent', lastName: 'Élève' };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '-' };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.slice(-1).join(' '),
  };
};

const resolveParentUser = async ({
  parentName,
  parentPhone,
  parentEmail,
  parentPassword,
  currentParentUserId = null,
  required = false,
}) => {
  const normalizedEmail = String(parentEmail || '').trim().toLowerCase();
  const normalizedPassword = String(parentPassword || '').trim();

  if (!normalizedEmail) {
    if (normalizedPassword) {
      const error = new Error('Email parent requis si vous définissez un mot de passe parent.');
      error.statusCode = 400;
      throw error;
    }

    if (required) {
      const error = new Error('Email parent requis pour définir le login parent.');
      error.statusCode = 400;
      throw error;
    }
    return currentParentUserId || null;
  }

  const existing = await User.findOne({ email: normalizedEmail }).select('+password');

  if (existing) {
    if (existing.role !== 'parent') {
      const error = new Error('Cet email est déjà utilisé par un compte non parent.');
      error.statusCode = 400;
      throw error;
    }

    if (normalizedPassword) {
      existing.password = normalizedPassword;
    }

    if (String(parentPhone || '').trim()) {
      existing.phone = String(parentPhone || '').trim();
    }

    const names = parseParentName(parentName);
    existing.firstName = names.firstName;
    existing.lastName = names.lastName;
    await existing.save();

    return existing._id;
  }

  if (!normalizedPassword) {
    const error = new Error('Mot de passe parent requis pour créer le login parent.');
    error.statusCode = 400;
    throw error;
  }

  const names = parseParentName(parentName);
  const createdParent = await User.create({
    firstName: names.firstName,
    lastName: names.lastName,
    email: normalizedEmail,
    password: normalizedPassword,
    role: 'parent',
    phone: String(parentPhone || '').trim(),
  });

  return createdParent._id;
};

/**
 * Compare deux codes matricules alphanumériques.
 * Priorité : préfixe lettres, puis partie numérique.
 */
const normalizeMatricule = (code) => {
  const raw = String(code || '').trim();
  const match = raw.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) {
    return { prefix: raw.toUpperCase(), number: null, raw: raw.toUpperCase() };
  }
  return {
    prefix: match[1].toUpperCase(),
    number: Number(match[2]),
    raw: raw.toUpperCase(),
  };
};

const compareMatricule = (a, b) => {
  const aa = normalizeMatricule(a);
  const bb = normalizeMatricule(b);

  if (aa.prefix !== bb.prefix) {
    return aa.prefix.localeCompare(bb.prefix, 'fr', { sensitivity: 'base' });
  }

  if (aa.number !== null && bb.number !== null) {
    if (aa.number < bb.number) return -1;
    if (aa.number > bb.number) return 1;
  }

  return aa.raw.localeCompare(bb.raw, 'fr', { sensitivity: 'base' });
};

/**
 * Calcul de classOrder pour insertion d'un nouvel élève dans une classe.
 * Ne réordonne pas les autres élèves.
 */
const computeInsertionClassOrder = async (classeId, matricule, excludeStudentId = null) => {
  let students = await Student.find({ classe: classeId })
    .select('matricule classOrder')
    .lean();

  // Trier les élèves existants par classOrder (null ou NaN envoyés en fin)
  students = students.sort((a, b) => {
    const aOrder = Number.isFinite(Number(a.classOrder)) ? Number(a.classOrder) : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(Number(b.classOrder)) ? Number(b.classOrder) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });

  // Filtrer l'élève actuel si on recalcul dans la même classe
  const existing = students.filter((s) => !excludeStudentId || String(s._id) !== String(excludeStudentId));

  if (existing.length === 0) {
    return 1;
  }

  const insertIndex = existing.findIndex((s) => compareMatricule(matricule, s.matricule) < 0);

  if (insertIndex === -1) {
    // dernier
    const last = existing[existing.length - 1];
    const lastOrder = Number(last.classOrder) || existing.length;
    return lastOrder + 1;
  }

  if (insertIndex === 0) {
    const next = existing[0];
    const nextOrder = Number(next.classOrder) || 1;
    return nextOrder > 1 ? nextOrder - 1 : nextOrder / 2;
  }

  const prev = existing[insertIndex - 1];
  const next = existing[insertIndex];

  const lower = Number(prev.classOrder) || insertIndex;
  const upper = Number(next.classOrder) || insertIndex + 2;

  // Penser à garder original non trié : on n'affecte que le nouvel élève
  if (upper - lower > 1) {
    return (lower + upper) / 2;
  }

  return lower + 0.5;
};

/**
 * @desc    Créer un élève (admission)
 * @route   POST /api/students
 * @access  Private/Admin
 */
const createStudent = asyncHandler(async (req, res) => {
  const {
    firstName, lastName, email, password, phone,
    matricule, dateOfBirth, gender, address,
    classe, parentName, parentPhone, parentEmail, parentPassword,
  } = req.body;

  await ensureClassAccessibleForSupervisor(req, classe);

  const parentUserId = await resolveParentUser({
    parentName,
    parentPhone,
    parentEmail,
    parentPassword,
    required: false,
  });

  // Créer le compte utilisateur
  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role: 'student',
    phone,
  });

  // Déterminer classOrder pour préserver l’ordre import initial et insertion stable
  const classOrder = await computeInsertionClassOrder(classe, matricule);

  // Créer le profil étudiant
  const student = await Student.create({
    user: user._id,
    matricule,
    dateOfBirth,
    gender,
    address,
    classe,
    classOrder,
    parentName,
    parentPhone,
    parentUser: parentUserId,
  });

  // Populer les données pour la réponse
  const populatedStudent = await Student.findById(student._id)
    .populate('user', 'firstName lastName email phone avatar')
    .populate('classe', 'name')
    .populate('parentUser', 'firstName lastName email phone');

  res.status(201).json({
    success: true,
    data: populatedStudent,
  });
});

/**
 * @desc    Lister les élèves avec pagination, recherche et filtrage
 * @route   GET /api/students?page=1&limit=20&search=&classe=
 * @access  Private/Admin
 */
const getStudents = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { search, classe } = req.query;

  // Construire le filtre
  let filter = {};

  const supervisorScope = await getSupervisorClassScope(req);

  if (classe) {
    if (supervisorScope.restricted && !supervisorScope.classIds.includes(String(classe))) {
      return res.status(403).json({ success: false, message: 'Acces refuse a cette classe.' });
    }
    filter.classe = classe;
  } else if (supervisorScope.restricted) {
    filter.classe = { $in: supervisorScope.classIds };
  }

  // Recherche dynamique : on cherche dans User (nom, prénom, email)
  if (search) {
    const userIds = await User.find({
      role: 'student',
      $or: [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ],
    }).select('_id');

    filter.$or = [
      { user: { $in: userIds.map((u) => u._id) } },
      { matricule: { $regex: search, $options: 'i' } },
    ];
  }

  const studentQuery = Student.find(filter)
    .populate('user', 'firstName lastName email phone isActive avatar')
    .populate('classe', 'name');

  if (classe) {
    studentQuery.sort({ classOrder: 1, createdAt: 1 });
  } else {
    studentQuery.sort('-createdAt');
  }

  const [students, total] = await Promise.all([
    studentQuery.skip(skip).limit(limit),
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

/**
 * @desc    Obtenir un élève par ID
 * @route   GET /api/students/:id
 * @access  Private/Admin
 */
const getStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id)
    .populate('user', 'firstName lastName email phone isActive avatar')
    .populate('classe', 'name level')
    .populate('parentUser', 'firstName lastName email phone');

  if (!student) {
    return res.status(404).json({
      success: false,
      message: 'Élève non trouvé.',
    });
  }

  await ensureClassAccessibleForSupervisor(req, student.classe?._id || student.classe);

  res.status(200).json({
    success: true,
    data: student,
  });
});

/**
 * @desc    Mettre à jour un élève
 * @route   PUT /api/students/:id
 * @access  Private/Admin
 */
const updateStudent = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    password,
    parentEmail,
    parentPassword,
    ...studentData
  } = req.body;

  let student = await Student.findById(req.params.id);
  if (!student) {
    return res.status(404).json({
      success: false,
      message: 'Élève non trouvé.',
    });
  }

  await ensureClassAccessibleForSupervisor(req, student.classe);

  if (parentEmail !== undefined || parentPassword !== undefined || studentData.parentName !== undefined || studentData.parentPhone !== undefined) {
    studentData.parentUser = await resolveParentUser({
      parentName: studentData.parentName !== undefined ? studentData.parentName : student.parentName,
      parentPhone: studentData.parentPhone !== undefined ? studentData.parentPhone : student.parentPhone,
      parentEmail,
      parentPassword,
      currentParentUserId: student.parentUser,
      required: false,
    });
  }

  // Mettre à jour les données utilisateur si fournies
  if (firstName || lastName || email || phone || (password && String(password).trim())) {
    const user = await User.findById(student.user);
    if (user) {
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (email) user.email = email;
      if (phone) user.phone = phone;
      if (password && String(password).trim()) {
        user.password = String(password).trim();
      }
      await user.save();
    }
  }

  // Mettre à jour classOrder si la classe change ou si le matricule change (positionnement stable)
  const isClasseChanged = studentData.classe && String(studentData.classe) !== String(student.classe);
  const isMatriculeChanged = studentData.matricule && String(studentData.matricule).trim() !== String(student.matricule).trim();

  if (isClasseChanged || isMatriculeChanged) {
    const targetClasse = isClasseChanged ? studentData.classe : student.classe;
    await ensureClassAccessibleForSupervisor(req, targetClasse);
    const targetMatricule = isMatriculeChanged ? studentData.matricule : student.matricule;
    studentData.classOrder = await computeInsertionClassOrder(
      targetClasse,
      targetMatricule,
      isClasseChanged ? null : student._id
    );
  }

  // Mettre à jour les données étudiant
  student = await Student.findByIdAndUpdate(req.params.id, studentData, {
    new: true,
    runValidators: true,
  })
    .populate('user', 'firstName lastName email phone avatar')
    .populate('classe', 'name')
    .populate('parentUser', 'firstName lastName email phone');

  res.status(200).json({
    success: true,
    data: student,
  });
});

/**
 * @desc    Supprimer un élève
 * @route   DELETE /api/students/:id
 * @access  Private/Admin
 */
const deleteStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) {
    return res.status(404).json({
      success: false,
      message: 'Élève non trouvé.',
    });
  }

  await ensureClassAccessibleForSupervisor(req, student.classe);


    // Supprimer le compte utilisateur lié (hard delete)
    await User.findByIdAndDelete(student.user);
    await Student.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: 'Élève supprimé avec succès.',
  });
});

/**
 * @desc    Upload / changer la photo de profil d'un élève
 * @route   PUT /api/students/:id/photo
 * @access  Private/Admin
 */
const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Aucun fichier envoyé.' });
  }

  const student = await Student.findById(req.params.id);
  if (!student) {
    return res.status(404).json({ success: false, message: 'Élève non trouvé.' });
  }

  await ensureClassAccessibleForSupervisor(req, student.classe);

  // Delete old avatar file if exists
  const user = await User.findById(student.user);
  if (user.avatar) {
    const oldPath = path.join(__dirname, '..', user.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  // Save relative path
  const avatarPath = `/uploads/avatars/${req.file.filename}`;
  user.avatar = avatarPath;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    data: { avatar: avatarPath },
  });
});

/**
 * @desc    Lister les élèves rattachés au parent connecté
 * @route   GET /api/students/parent/children
 * @access  Private/Parent
 */
const getMyChildren = asyncHandler(async (req, res) => {
  const children = await getParentChildren(req.user.id);

  res.status(200).json({
    success: true,
    data: children,
  });
});

/**
 * @desc    Import en masse d'élèves depuis un CSV Massar
 * @route   POST /api/students/import
 * @access  Private/Admin
 *
 * Le fichier CSV provient de la plateforme Massar du ministère.
 * L'admin sélectionne la classe dans l'interface, puis uploade le CSV.
 *
 * Colonnes Massar : N.O | Code | Nom | Prénom | Genre | Date de naissance | Lieu naissance
 *
 * Génération automatique :
 *  - email  → nom.prenom@ikenas.com  (normalisé sans accents)
 *  - password → nom + YYYYMMDD de naissance  (ex: haissoune20200625)
 *  - matricule → Code Massar
 *  - genre : Garçon → M, Fille → F
 */
const importStudents = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Aucun fichier envoyé.' });
  }

  const { classe } = req.body;
  if (!classe) {
    return res.status(400).json({ success: false, message: 'Veuillez sélectionner une classe.' });
  }

  const classDoc = await Class.findById(classe);
  if (!classDoc) {
    return res.status(404).json({ success: false, message: 'Classe introuvable.' });
  }

  await ensureClassAccessibleForSupervisor(req, classDoc._id);

  // ── Helper : supprime accents ──
  const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalize = (str) => stripAccents(str).replace(/[^a-z0-9]/g, '');

  // ── Parse : d'abord essayer en tant que texte brut (CSV) ──
  let allRows = [];
  const rawText = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, ''); // strip BOM

  if (rawText && rawText.length > 0) {
    const lines = rawText.split(/\r?\n/);
    // Détecter le délimiteur : celui qui donne le plus de colonnes dans la ligne d'en-tête probable
    let delimiter = ',';
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.includes('n.o') || trimmed.includes('code')) {
        const commaCount = (line.match(/,/g) || []).length;
        const semiCount  = (line.match(/;/g) || []).length;
        const tabCount   = (line.match(/\t/g) || []).length;
        if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
        else if (tabCount > commaCount) delimiter = '\t';
        break;
      }
    }
    allRows = lines.map((l) => l.split(delimiter).map((c) => c.trim()));
  }

  // Fallback XLSX si le texte brut ne fonctionne pas
  if (allRows.length === 0) {
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    } catch {}
  }

  if (allRows.length === 0) {
    return res.status(400).json({ success: false, message: 'Impossible de lire le fichier.' });
  }

  // ── Trouver la ligne d'en-tête ──
  let headerIdx = -1;
  for (let i = 0; i < Math.min(allRows.length, 25); i++) {
    const cells = allRows[i].map((c) => stripAccents(String(c).trim()));
    if (cells.some((c) => c === 'n.o' || c === 'no') && cells.some((c) => c.includes('code'))) {
      headerIdx = i;
      break;
    }
  }

  // Fallback : chercher juste "code" et "nom" ensemble
  if (headerIdx === -1) {
    for (let i = 0; i < Math.min(allRows.length, 25); i++) {
      const cells = allRows[i].map((c) => stripAccents(String(c).trim()));
      if (cells.some((c) => c.includes('code')) && cells.some((c) => c === 'nom' || c.startsWith('nom'))) {
        headerIdx = i;
        break;
      }
    }
  }

  if (headerIdx === -1) {
    return res.status(400).json({
      success: false,
      message: 'Format non reconnu. Veuillez utiliser un export CSV depuis Massar (colonnes : N.O, Code, Nom, Prénom, Genre, Date de naissance…).',
    });
  }

  // ── Mapper les index des colonnes (normalisé sans accents) ──
  const headers = allRows[headerIdx].map((h) => stripAccents(String(h).trim()));

  const colIdx = {
    no:     headers.findIndex((h) => h === 'n.o' || h === 'no' || h.includes('n.o') || h.includes('numero')),
    code:   headers.findIndex((h) => h.includes('code')),
    nom:    -1,
    prenom: headers.findIndex((h) => h.includes('prenom') || h.includes('prénom')),
    genre:  headers.findIndex((h) => h.includes('genre') || h.includes('sexe')),
    date:   headers.findIndex((h) => h.includes('date') || h.includes('naissance')),
  };

  // «nom» : doit matcher "nom" mais pas "prenom" ni "naissance"
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if ((h === 'nom' || h === 'nom de famille')
        && i !== colIdx.prenom) {
      colIdx.nom = i;
      break;
    }
  }
  // Fallback plus souple
  if (colIdx.nom === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (i === colIdx.prenom || i === colIdx.date) continue;
      if (headers[i].startsWith('nom') && !headers[i].includes('prenom') && !headers[i].includes('naiss')) {
        colIdx.nom = i;
        break;
      }
    }
  }

  if (colIdx.code === -1 || colIdx.nom === -1 || colIdx.prenom === -1) {
    return res.status(400).json({
      success: false,
      message: `Colonnes obligatoires introuvables. En-tête détecté : [${headers.join(' | ')}]. Vérifiez que le fichier contient Code, Nom, Prénom.`,
    });
  }

  // ── Lignes de données (après l'en-tête, sans lignes vides) ──
  const dataRows = allRows.slice(headerIdx + 1).filter((row) =>
    row.some((cell) => String(cell).trim() !== '')
  );

  if (dataRows.length === 0) {
    return res.status(400).json({ success: false, message: 'Aucune donnée trouvée dans le fichier.' });
  }

  // ── Pré-charger les emails et matricules existants pour éviter N+1 queries ──
  const existingEmails = new Set(
    (await User.find({ role: 'student' }).select('email').lean()).map((u) => u.email)
  );
  const existingMatricules = new Set(
    (await Student.find().select('matricule').lean()).map((s) => s.matricule)
  );

  const classMaxOrderRecord = await Student.findOne({ classe }).sort({ classOrder: -1 }).select('classOrder').lean();
  let fallbackOrderCursor = Number(classMaxOrderRecord?.classOrder || 0);

  const results = { success: 0, errors: [], total: dataRows.length, imported: [] };

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 1;
    try {
      const code   = String(row[colIdx.code]   || '').trim();
      const nom    = String(row[colIdx.nom]    || '').trim();
      const prenom = String(row[colIdx.prenom] || '').trim();
      const genre  = colIdx.genre !== -1 ? String(row[colIdx.genre] || '').trim() : '';
      const dateStr= colIdx.date  !== -1 ? String(row[colIdx.date]  || '').trim() : '';
      const noStr  = colIdx.no    !== -1 ? String(row[colIdx.no]    || '').trim() : '';

      if (!code || !nom || !prenom) {
        results.errors.push({ row: rowNum, nom: `${nom} ${prenom}`.trim(), message: 'Code, nom ou prénom manquant.' });
        continue;
      }

      // ── Vérifier matricule doublon ──
      if (existingMatricules.has(code)) {
        results.errors.push({ row: rowNum, nom: `${nom} ${prenom}`, message: `Code "${code}" déjà existant.` });
        continue;
      }

      // ── Parser la date de naissance ──
      let dateOfBirth = null;
      if (dateStr) {
        if (/^\d{4}[\/\-]\d{2}[\/\-]\d{2}$/.test(dateStr)) {
          // YYYY/MM/DD or YYYY-MM-DD
          dateOfBirth = new Date(dateStr.replace(/\//g, '-'));
        } else if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(dateStr)) {
          // DD/MM/YYYY
          const parts = dateStr.split(/[\/\-]/);
          dateOfBirth = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        } else {
          dateOfBirth = new Date(dateStr);
        }
        if (isNaN(dateOfBirth.getTime())) {
          results.errors.push({ row: rowNum, nom: `${nom} ${prenom}`, message: `Date invalide : "${dateStr}".` });
          continue;
        }
      } else {
        // Date non fournie → on met une date placeholder, l'admin ajustera
        dateOfBirth = new Date('2015-01-01');
      }

      // ── Genre ──
      const genderMap = { 'garçon': 'M', 'garcon': 'M', 'masculin': 'M', 'fille': 'F', 'féminin': 'F', 'feminin': 'F', 'm': 'M', 'f': 'F' };
      const gender = genderMap[genre.toLowerCase()] || 'M';

      // ── Générer l'email : nom.prenom@ikenas.com ──
      const normNom    = normalize(nom);
      const normPrenom = normalize(prenom);
      let email = `${normNom}.${normPrenom}@ikenas.com`;
      let suffix = 1;
      while (existingEmails.has(email)) {
        email = `${normNom}.${normPrenom}${suffix}@ikenas.com`;
        suffix++;
      }

      // ── Générer le mot de passe : nom + YYYYMMDD ──
      const datePwd = dateOfBirth.toISOString().slice(0, 10).replace(/-/g, '');
      const password = `${normNom}${datePwd}`;

      const parsedNo = Number.parseInt(noStr, 10);
      const hasValidNo = Number.isFinite(parsedNo) && parsedNo > 0;
      const classOrder = hasValidNo ? parsedNo : (fallbackOrderCursor + 1);
      fallbackOrderCursor = Math.max(fallbackOrderCursor, classOrder);

      // ── Créer le User ──
      const user = await User.create({
        firstName: prenom,
        lastName: nom,
        email,
        password,
        role: 'student',
      });

      // ── Créer le Student ──
      await Student.create({
        user: user._id,
        matricule: code,
        dateOfBirth,
        gender,
        classe,
        classOrder,
      });

      // Track pour éviter les doublons dans le même batch
      existingEmails.add(email);
      existingMatricules.add(code);

      results.success++;
      results.imported.push({ nom, prenom, email, matricule: code });
    } catch (err) {
      results.errors.push({ row: rowNum, nom: '', message: err.message });
    }
  }

  res.status(200).json({
    success: true,
    message: `Import terminé : ${results.success}/${results.total} élèves importés.`,
    data: results,
  });
});

module.exports = {
  createStudent,
  getStudents,
  getStudent,
  updateStudent,
  deleteStudent,
  uploadPhoto,
  getMyChildren,
  importStudents,
};
