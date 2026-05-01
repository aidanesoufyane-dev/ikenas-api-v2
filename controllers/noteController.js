const NoteSheet = require('../models/NoteSheet');
const NoteEntry = require('../models/NoteEntry');
const ExcelJS = require('exceljs');
const Exam = require('../models/Exam');
const Subject = require('../models/Subject');
const Class = require('../models/Class');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const SubjectComponents = require('../models/SubjectComponents');
const { asyncHandler } = require('../utils/helpers');
const { buildResultPayload, computeResultStats, normalizeComponents } = require('../utils/gradeUtils');
const { sendNotification } = require('../utils/notify');
const { resolveActingStudent } = require('../utils/studentAccess');
const {
  ensureClassAccessibleForSupervisor,
  getSupervisorClassScope,
} = require('../utils/supervisorScope');

const NOTES_EXCEL_ANALYSIS = (() => {
  try {
    return require('../notes-excel-analysis-report.json');
  } catch (error) {
    return null;
  }
})();

const SUBJECTS_WITHOUT_COMPONENTS = new Set(['AS', 'ANG', 'EA', 'EI', 'EPS', 'INFO', 'MATH']);
const REMOVE_BIRTHDATE_COMPONENT_FOR = new Set(['AR', 'HG', 'FRA']);
const BIRTHDATE_COMPONENT_NAME = 'تاريخ الإزدياد';
const ALLOWED_DEVOIR_TITLES = ['devoir1', 'devoir2', 'devoir3', 'devoir4'];

const FRA_COMPONENTS_BY_LEVEL = {
  '1APG': ['Comptine/Chant', 'Graphisme', 'Activités orales'],
  '2APG': ['Comptine/Chant', 'Graphisme', 'Activités orales'],
  '3APG': ['Activités de prod. écrite', 'Lexique', 'Grammaire', 'Conjugaison', 'dictée', 'Activités orales', 'Poésie', 'Lecture', 'Écriture/Copie', 'Exercices écrits', 'Production de l’écrit'],
  '4APG': ['Lexique', 'Grammaire', 'Conjugaison', 'Orthographe/Dictée', 'Activités orales', 'Poésie', 'Lecture', 'Écriture/Copie', 'Production de l’écrit'],
  '5APG': ['Activités de prod. écrite', 'Lexique', 'Grammaire', 'Conjugaison', 'Orthographe/Dictée', 'Activités de Lecture', 'communication et actes de langage', 'Poésie/lecture/diction'],
  '6APG': ['Activités de prod. écrite', 'Lexique', 'Grammaire', 'Conjugaison', 'Orthographe/Dictée', 'Activités de Lecture', 'communication et actes de langage', 'Poésie/lecture/diction'],
};

const SUBJECT_CODE_TO_ANALYSIS_NAMES = {
  MATH: ['الرياضيات'],
  FRA: ['اللغة الفرنسية'],
  ANG: ['اللغة الإنجليزية'],
  HG: ['الاجتماعيات'],
  EPS: ['التربية البدنية'],
  INFO: ['المعلوميات'],
  AR: ['اللغة العربية'],
  EI: ['التربية الإسلامية'],
  EA: ['التربية الفنية'],
  AS: ['النشاط العلمي'],
};

const sanitizeTemplate = (components, maxScore) => normalizeComponents(components, maxScore)
  .map((component) => ({
    key: component.key,
    name: component.name,
    maxScore: component.maxScore,
    weight: component.weight,
  }));

const normalizeSemesterValue = (value) => {
  const raw = String(value || 'S1').trim().toUpperCase();

  if (raw === 'S1' || raw === '1' || raw === 'SEMESTRE1' || raw === 'SEMESTRE 1') {
    return 'S1';
  }

  if (raw === 'S2' || raw === '2' || raw === 'SEMESTRE2' || raw === 'SEMESTRE 2') {
    return 'S2';
  }

  return raw.includes('2') ? 'S2' : 'S1';
};

const normalizeDevoirTitle = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  return ALLOWED_DEVOIR_TITLES.includes(normalized) ? normalized : null;
};

const STUDENT_CLASS_ORDER_SORT = { classOrder: 1, createdAt: 1, _id: 1 };

const toSafeFileSegment = (value) => String(value || '')
  .normalize('NFD')
  .toLowerCase()
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9_-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .replace(/_+/g, '_')
  || 'export';

const buildSemesterDevoirSegment = ({ semester, devoirTitle }) => {
  const semesterPart = normalizeSemesterValue(semester);
  const normalizedDevoir = normalizeDevoirTitle(devoirTitle) || String(devoirTitle || '').toLowerCase();
  const numberMatch = normalizedDevoir.match(/(\d+)/);

  if (numberMatch?.[1]) {
    return `${semesterPart}Dev${numberMatch[1]}`;
  }

  return `${semesterPart}${toSafeFileSegment(devoirTitle)}`;
};

const extractLevelTag = (classInfo) => {
  const candidate = String(classInfo?.baseName || classInfo?.name || '').toUpperCase();
  const match = candidate.match(/\b([1-6]APG)\b/);
  return match ? match[1] : null;
};

const dedupeComponents = (components) => {
  const seen = new Set();
  const output = [];

  components.forEach((component) => {
    const name = String(component?.name || '').trim();
    if (!name) return;

    const key = String(component?.key || name)
      .trim()
      .toLowerCase();

    const dedupeKey = `${key}::${name}`;
    if (seen.has(dedupeKey)) return;

    seen.add(dedupeKey);
    const weightValue = Number(component?.weight);
    const orderValue = Number(component?.order);

    output.push({
      key,
      name,
      weight: Number.isFinite(weightValue) && weightValue > 0 ? weightValue : 1,
      order: Number.isFinite(orderValue) && orderValue > 0 ? orderValue : output.length + 1,
    });
  });

  output.sort((a, b) => a.order - b.order);
  return output.map((component, index) => ({
    ...component,
    order: index + 1,
  }));
};

const toSafeComponentKey = (value = '') => String(value)
  .trim()
  .toLowerCase()
  .replace(/\s+/g, '_')
  .replace(/[^a-z0-9_]+/g, '')
  .replace(/^_+|_+$/g, '');

const normalizeTemplateComponentsInput = (components = []) => {
  if (!Array.isArray(components) || components.length === 0) {
    const error = new Error('Veuillez fournir au moins une composante.');
    error.statusCode = 400;
    throw error;
  }

  const normalized = components
    .map((component, index) => {
      const name = String(component?.name || '').trim();
      if (!name) {
        const error = new Error(`La composante #${index + 1} doit avoir un nom.`);
        error.statusCode = 400;
        throw error;
      }

      const keyCandidate = String(component?.key || '').trim() || name;
      const key = toSafeComponentKey(keyCandidate) || `component_${index + 1}`;
      const weightValue = Number(component?.weight);
      const orderValue = Number(component?.order);

      return {
        key,
        name,
        weight: Number.isFinite(weightValue) && weightValue > 0 ? weightValue : 1,
        order: Number.isFinite(orderValue) && orderValue > 0 ? orderValue : index + 1,
      };
    })
    .sort((a, b) => a.order - b.order);

  const duplicatedKeys = new Set();
  const seenKeys = new Set();
  normalized.forEach((component) => {
    if (seenKeys.has(component.key)) {
      duplicatedKeys.add(component.key);
      return;
    }

    seenKeys.add(component.key);
  });

  if (duplicatedKeys.size > 0) {
    const error = new Error(`Clés de composantes dupliquées: ${Array.from(duplicatedKeys).join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  return normalized.map((component, index) => ({
    ...component,
    order: index + 1,
  }));
};

const applySubjectComponentRules = ({ subjectCode, classInfo, components }) => {
  const code = String(subjectCode || '').toUpperCase();
  const level = extractLevelTag(classInfo);

  if (SUBJECTS_WITHOUT_COMPONENTS.has(code)) {
    return [];
  }

  if (code === 'FRA') {
    const levelComponents = FRA_COMPONENTS_BY_LEVEL[level] || [];
    if (levelComponents.length > 0) {
      return levelComponents.map((name, idx) => ({ key: `fra_${idx + 1}`, name }));
    }
  }

  const filtered = (components || []).filter((component) => {
    const name = String(component?.name || '').trim();
    if (!name) return false;

    if (REMOVE_BIRTHDATE_COMPONENT_FOR.has(code) && name === BIRTHDATE_COMPONENT_NAME) {
      return false;
    }

    if (SUBJECTS_WITHOUT_COMPONENTS.has(code) && (name === 'B' || name === 'M')) {
      return false;
    }

    return true;
  });

  return dedupeComponents(filtered);
};

const buildAnalysisComponentsFallback = ({ subjectCode, classInfo, requestedSemester, alternateSemester }) => {
  const analysisRows = Array.isArray(NOTES_EXCEL_ANALYSIS?.principal)
    ? NOTES_EXCEL_ANALYSIS.principal
    : [];

  if (analysisRows.length === 0) {
    return null;
  }

  const level = extractLevelTag(classInfo);
  if (!level) {
    return null;
  }

  const subjectNames = SUBJECT_CODE_TO_ANALYSIS_NAMES[String(subjectCode || '').toUpperCase()] || [];
  if (subjectNames.length === 0) {
    return null;
  }

  const pickRows = (semester) => analysisRows
    .filter((row) => row?.niveau === level && row?.semestre === semester && subjectNames.includes(row?.matiere))
    .sort((a, b) => Number(b?.nbFichiers || 0) - Number(a?.nbFichiers || 0));

  const requestedRows = pickRows(requestedSemester);
  if (requestedRows.length > 0) {
    const row = requestedRows[0];
    return {
      semesterResolved: requestedSemester,
      fallbackUsed: false,
      components: (Array.isArray(row?.composantes) ? row.composantes : []).map((name, idx) => ({
        key: `excel_${idx + 1}`,
        name,
      })),
    };
  }

  const alternateRows = pickRows(alternateSemester);
  if (alternateRows.length > 0) {
    const row = alternateRows[0];
    return {
      semesterResolved: alternateSemester,
      fallbackUsed: true,
      components: (Array.isArray(row?.composantes) ? row.composantes : []).map((name, idx) => ({
        key: `excel_${idx + 1}`,
        name,
      })),
    };
  }

  return null;
};

const getContextComponents = async ({ classe, subject, semester }) => {
  if (!classe || !subject) {
    return { components: [], fallbackUsed: false, semesterResolved: semester };
  }

  const requestedSemester = normalizeSemesterValue(semester);
  const alternateSemester = requestedSemester === 'S1' ? 'S2' : 'S1';

  const [subjectInfo, classInfo] = await Promise.all([
    Subject.findById(subject).select('code').lean(),
    Class.findById(classe).select('name baseName').lean(),
  ]);

  const records = await SubjectComponents.find({
    classe,
    subject,
    semester: { $in: [requestedSemester, alternateSemester] },
    isActive: true,
  }).sort({ updatedAt: -1, createdAt: -1 });

  const exactRecord = records.find((record) => record.semester === requestedSemester);
  if (exactRecord) {
    const sanitized = applySubjectComponentRules({
      subjectCode: subjectInfo?.code,
      classInfo,
      components: exactRecord.components || [],
    });

    return {
      components: sanitized,
      fallbackUsed: false,
      semesterResolved: requestedSemester,
    };
  }

  const fallbackRecord = records.find((record) => record.semester === alternateSemester);
  if (fallbackRecord) {
    const sanitized = applySubjectComponentRules({
      subjectCode: subjectInfo?.code,
      classInfo,
      components: fallbackRecord.components || [],
    });

    return {
      components: sanitized,
      fallbackUsed: true,
      semesterResolved: alternateSemester,
    };
  }

  const sheetRecords = await NoteSheet.find({
    classe,
    subject,
    semester: { $in: [requestedSemester, alternateSemester] },
    isActive: true,
    'components.0': { $exists: true },
  })
    .select('semester components')
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const exactSheetRecord = sheetRecords.find((record) => record.semester === requestedSemester);
  if (exactSheetRecord) {
    const sanitized = applySubjectComponentRules({
      subjectCode: subjectInfo?.code,
      classInfo,
      components: exactSheetRecord.components || [],
    });

    if (sanitized.length > 0) {
      return {
        components: sanitized,
        fallbackUsed: false,
        semesterResolved: requestedSemester,
      };
    }
  }

  const alternateSheetRecord = sheetRecords.find((record) => record.semester === alternateSemester);
  if (alternateSheetRecord) {
    const sanitized = applySubjectComponentRules({
      subjectCode: subjectInfo?.code,
      classInfo,
      components: alternateSheetRecord.components || [],
    });

    if (sanitized.length > 0) {
      return {
        components: sanitized,
        fallbackUsed: true,
        semesterResolved: alternateSemester,
      };
    }
  }

  const analysisFallback = buildAnalysisComponentsFallback({
    subjectCode: subjectInfo?.code,
    classInfo,
    requestedSemester,
    alternateSemester,
  });

  if (analysisFallback) {
    const sanitized = applySubjectComponentRules({
      subjectCode: subjectInfo?.code,
      classInfo,
      components: analysisFallback.components,
    });

    if (sanitized.length > 0) {
      return {
        components: sanitized,
        fallbackUsed: analysisFallback.fallbackUsed,
        semesterResolved: analysisFallback.semesterResolved,
      };
    }
  }

  const sanitized = applySubjectComponentRules({
    subjectCode: subjectInfo?.code,
    classInfo,
    components: [],
  });

  return { components: sanitized, fallbackUsed: false, semesterResolved: requestedSemester };
};

const ensureSubjectBelongsToClass = async (subjectId, classId) => {
  const subject = await Subject.findOne({
    _id: subjectId,
    isActive: true,
    classes: classId,
  }).select('_id');

  if (!subject) {
    const error = new Error('La matière sélectionnée n\'est pas liée à cette classe.');
    error.statusCode = 400;
    throw error;
  }
};

const getTeacherProfile = async (userId) => {
  const teacher = await Teacher.findOne({ user: userId }).populate('user', 'firstName lastName');
  if (!teacher) {
    const error = new Error('Profil enseignant non trouvé.');
    error.statusCode = 404;
    throw error;
  }
  return teacher;
};

const ensureTeacherCanAccessContext = ({ teacher, classe, subject }) => {
  const classAllowed = teacher.classes.some((classId) => classId.toString() === String(classe));
  const subjectAllowed = teacher.subjects.some((subjectId) => subjectId.toString() === String(subject));

  if (!classAllowed || !subjectAllowed) {
    const error = new Error('Vous ne pouvez saisir que vos matières et vos classes.');
    error.statusCode = 403;
    throw error;
  }
};

const populateSheetQuery = (query) => query
  .populate('classe', 'name')
  .populate('subject', 'name code coefficient')
  .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
  .populate('exam', 'title date startTime endTime maxScore type');

const notifyGradeAdded = async ({ io, teacher, sheetTitle, classeId, subjectId, semester, sheetId, role }) => {
  try {
    const subject = await Subject.findById(subjectId).select('name');
    const classe = await Class.findById(classeId).select('name');
    const teacherName = teacher ? `${teacher.user?.firstName || 'Prof'} ${teacher.user?.lastName || ''}`.trim() : 'Un professeur';

    const title = `Notes ajoutées : ${sheetTitle}`;
    const message = `${teacherName} a ajouté les notes pour ${sheetTitle} de la classe ${classe?.name || 'N/A'} et matière ${subject?.name || 'N/A'}.`;
    const basePath = role === 'supervisor' ? '/supervisor/notes/view' : '/admin/notes/view';
    const params = new URLSearchParams({
      classe: String(classeId || ''),
      subject: String(subjectId || ''),
      semester: String(semester || 'S1'),
      devoirTitle: String(sheetTitle || 'devoir1'),
    });

    if (sheetId) {
      params.set('sheetId', String(sheetId));
    }

    const link = `${basePath}?${params.toString()}`;

    await sendNotification(io, {
      type: 'grade_added',
      title,
      message,
      link,
      recipientRole: role,
      createdBy: teacher ? teacher.user?._id : null,
    });
  } catch (err) {
    console.error('Erreur notification note ajoutée :', err.message);
  }
};

const buildEntriesByStudent = (entries) => {
  const map = new Map();
  entries.forEach((entry) => {
    map.set(String(entry.student?._id || entry.student), entry);
  });
  return map;
};

const buildStudentSummaries = (results) => {
  const bySemester = new Map();

  results.forEach((result) => {
    const subjectId = result.subject?._id ? String(result.subject._id) : String(result.subject);
    if (!subjectId || result.score === null || result.score === undefined) {
      return;
    }

    const score10 = result.maxScore > 0 ? (result.score / result.maxScore) * 10 : null;
    if (score10 === null) {
      return;
    }

    const semester = result.semester || 'S1';
    if (!bySemester.has(semester)) {
      bySemester.set(semester, new Map());
    }

    const bySubject = bySemester.get(semester);
    const current = bySubject.get(subjectId) || {
      subject: result.subject,
      subjectCoefficient: Number(result.subject?.coefficient || 1),
      notes: [],
    };

    current.notes.push(score10);
    bySubject.set(subjectId, current);
  });

  const semesters = {};
  ['S1', 'S2'].forEach((semester) => {
    const bySubject = bySemester.get(semester) || new Map();

    const subjectItems = Array.from(bySubject.values()).map((item) => {
      const average = item.notes.length > 0
        ? Number((item.notes.reduce((sum, note) => sum + note, 0) / item.notes.length).toFixed(2))
        : null;

      return {
        subject: item.subject,
        coefficient: item.subjectCoefficient,
        notesCount: item.notes.length,
        average,
      };
    });

    const weighted = subjectItems
      .filter((item) => item.average !== null)
      .reduce((acc, item) => {
        acc.total += item.average * item.coefficient;
        acc.coeff += item.coefficient;
        return acc;
      }, { total: 0, coeff: 0 });

    semesters[semester] = {
      subjects: subjectItems,
      average: weighted.coeff > 0 ? Number((weighted.total / weighted.coeff).toFixed(2)) : null,
    };
  });

  const yearAverage = semesters.S1.average !== null && semesters.S2.average !== null
    ? Number((((semesters.S1.average + semesters.S2.average) / 2).toFixed(2)) )
    : (semesters.S1.average ?? semesters.S2.average ?? null);

  return {
    semesters,
    annualAverage: yearAverage,
  };
};

const getSheets = asyncHandler(async (req, res) => {
  const filter = { isActive: true };

  const supervisorScope = await getSupervisorClassScope(req);

  if (req.query.classe) {
    if (supervisorScope.restricted && !supervisorScope.classIds.includes(String(req.query.classe))) {
      return res.status(403).json({ success: false, message: 'Acces refuse a cette classe.' });
    }
    filter.classe = req.query.classe;
  } else if (supervisorScope.restricted) {
    filter.classe = { $in: supervisorScope.classIds };
  }
  if (req.query.subject) filter.subject = req.query.subject;
  if (req.query.semester) filter.semester = req.query.semester;
  if (req.query.type) filter.type = req.query.type;

  if (req.user.role === 'teacher') {
    const teacher = await getTeacherProfile(req.user.id);

    if (req.query.classe && req.query.subject) {
      ensureTeacherCanAccessContext({ teacher, classe: req.query.classe, subject: req.query.subject });
    }

    filter.$or = [
      { teacher: teacher._id },
      { teacher: null },
    ];
  }

  const sheets = await populateSheetQuery(NoteSheet.find(filter)).sort({ createdAt: -1 });
  const sheetIds = sheets.map((sheet) => sheet._id);

  const counts = await NoteEntry.aggregate([
    { $match: { sheet: { $in: sheetIds } } },
    { $group: { _id: '$sheet', count: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$isComplete', true] }, 1, 0] } } } },
  ]);

  const countMap = new Map(counts.map((item) => [String(item._id), item]));

  const data = sheets.map((sheet) => {
    const row = countMap.get(String(sheet._id));
    return {
      ...sheet.toObject(),
      entriesCount: row?.count || 0,
      completedCount: row?.completed || 0,
    };
  });

  res.status(200).json({ success: true, data });
});

const getTemplate = asyncHandler(async (req, res) => {
  const {
    classe,
    subject,
    semester = 'S1',
    type = 'controle_continue',
    examId,
    sheetId,
  } = req.query;

  if (!classe || !subject) {
    return res.status(400).json({ success: false, message: 'Classe et matière requises.' });
  }

  await ensureClassAccessibleForSupervisor(req, classe);

  await ensureSubjectBelongsToClass(subject, classe);

  let teacher = null;
  if (req.user.role === 'teacher') {
    teacher = await getTeacherProfile(req.user.id);
    ensureTeacherCanAccessContext({ teacher, classe, subject });
  }

  const students = await Student.find({ classe })
    .populate('user', 'firstName lastName')
    .sort(STUDENT_CLASS_ORDER_SORT);

  const examFilter = { classe, subject, semester, isActive: true };
  if (teacher) {
    examFilter.teacher = teacher._id;
  }

  const exams = await Exam.find(examFilter)
    .populate('classe', 'name')
    .populate('subject', 'name code coefficient')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
    .sort({ date: -1, createdAt: -1 });

  let selectedSheet = null;
  if (sheetId) {
    selectedSheet = await populateSheetQuery(NoteSheet.findOne({ _id: sheetId, isActive: true }));
    if (!selectedSheet) {
      return res.status(404).json({ success: false, message: 'Feuille de notes introuvable.' });
    }

    if (teacher && String(selectedSheet.teacher?._id || selectedSheet.teacher) !== String(teacher._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
  } else if (type === 'controle_continue' && examId) {
    selectedSheet = await populateSheetQuery(NoteSheet.findOne({ exam: examId, isActive: true }));
  }

  let selectedExam = null;
  if (!selectedSheet && type === 'controle_continue' && examId) {
    selectedExam = await Exam.findById(examId)
      .populate('classe', 'name')
      .populate('subject', 'name code coefficient')
      .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } });

    if (!selectedExam || !selectedExam.isActive) {
      return res.status(404).json({ success: false, message: 'Examen introuvable.' });
    }

    if (teacher && String(selectedExam.teacher?._id || selectedExam.teacher) !== String(teacher._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
  }

  const effectiveSheet = selectedSheet || (selectedExam
    ? {
      _id: null,
      type: 'controle_continue',
      title: selectedExam.title,
      exam: selectedExam,
      classe: selectedExam.classe,
      subject: selectedExam.subject,
      teacher: selectedExam.teacher,
      semester: selectedExam.semester || semester,
      coefficient: 1,
      maxScore: 10,
      componentsTemplate: selectedExam.componentsTemplate || [],
    }
    : {
      _id: null,
      type,
      title: '',
      exam: null,
      classe: { _id: classe },
      subject: { _id: subject },
      semester,
      coefficient: 1,
      maxScore: 10,
      componentsTemplate: [],
    });

  // Load pre-configured components from SubjectComponents model
  let preconfiguredComponents = [];
  if (effectiveSheet && effectiveSheet.classe && effectiveSheet.subject) {
    const classId = effectiveSheet.classe._id || effectiveSheet.classe;
    const subjectId = effectiveSheet.subject._id || effectiveSheet.subject;
    
    const subjectComponentsRecord = await SubjectComponents.findOne({
      classe: classId,
      subject: subjectId,
      semester: semester,
      isActive: true,
    }).populate('components');

    if (subjectComponentsRecord && subjectComponentsRecord.components) {
      preconfiguredComponents = subjectComponentsRecord.components.map((comp) => ({
        key: comp.key,
        name: comp.name,
        weight: comp.weight || 1,
      }));
    }
  }

  const existingEntries = selectedSheet
    ? await NoteEntry.find({ sheet: selectedSheet._id })
      .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
      .sort({ updatedAt: -1 })
    : [];

  res.status(200).json({
    success: true,
    data: {
      semester,
      students,
      exams,
      selectedSheet: effectiveSheet,
      preconfiguredComponents,
      existingEntries,
    },
  });
});

const saveSheetResults = asyncHandler(async (req, res) => {
  const { sheet: sheetPayload = {}, results = [] } = req.body;

  if (!sheetPayload.classe || !sheetPayload.subject || !sheetPayload.semester) {
    return res.status(400).json({ success: false, message: 'Classe, matière et semestre requis.' });
  }

  await ensureClassAccessibleForSupervisor(req, sheetPayload.classe);

  if (sheetPayload.type === 'autre') {
    const normalizedTitle = normalizeDevoirTitle(sheetPayload.title);
    if (!normalizedTitle) {
      return res.status(400).json({
        success: false,
        message: 'Les notes libres autorisées sont uniquement: devoir1, devoir2, devoir3, devoir4.',
      });
    }
    sheetPayload.title = normalizedTitle;
  }

  await ensureSubjectBelongsToClass(sheetPayload.subject, sheetPayload.classe);

  let teacher = null;
  if (req.user.role === 'teacher') {
    teacher = await getTeacherProfile(req.user.id);
    ensureTeacherCanAccessContext({
      teacher,
      classe: sheetPayload.classe,
      subject: sheetPayload.subject,
    });
  }

  let linkedExam = null;
  if (sheetPayload.type === 'controle_continue' && sheetPayload.exam) {
    linkedExam = await Exam.findById(sheetPayload.exam)
      .populate('classe', 'name')
      .populate('subject', 'name code coefficient')
      .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } });

    if (!linkedExam || !linkedExam.isActive) {
      return res.status(404).json({ success: false, message: 'Examen introuvable.' });
    }

    if (teacher && String(linkedExam.teacher?._id || linkedExam.teacher) !== String(teacher._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
  }

  let sheet = null;
  if (sheetPayload.id) {
    sheet = await NoteSheet.findById(sheetPayload.id);
    if (!sheet || !sheet.isActive) {
      return res.status(404).json({ success: false, message: 'Feuille de notes introuvable.' });
    }

    if (teacher && String(sheet.teacher || '') !== String(teacher._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
  } else if (sheetPayload.type === 'controle_continue' && sheetPayload.exam) {
    sheet = await NoteSheet.findOne({ exam: sheetPayload.exam, isActive: true });
  }

  const maxScore = 10;
  const componentsTemplate = sanitizeTemplate(
    sheetPayload.componentsTemplate || linkedExam?.componentsTemplate || [],
    maxScore
  );

  if (!sheet) {
    sheet = await NoteSheet.create({
      title: sheetPayload.title || linkedExam?.title,
      type: sheetPayload.type || 'controle_continue',
      exam: sheetPayload.type === 'controle_continue' ? (sheetPayload.exam || linkedExam?._id || null) : null,
      classe: sheetPayload.classe,
      subject: sheetPayload.subject,
      teacher: teacher ? teacher._id : (linkedExam?.teacher?._id || linkedExam?.teacher || null),
      semester: sheetPayload.semester,
      coefficient: Number(sheetPayload.coefficient || 1) || 1,
      maxScore,
      componentsTemplate,
      createdBy: req.user.id,
    });
  } else {
    sheet.title = sheetPayload.title || linkedExam?.title || sheet.title;
    sheet.type = sheetPayload.type || sheet.type;
    sheet.exam = sheet.type === 'controle_continue' ? (sheetPayload.exam || sheet.exam) : null;
    sheet.classe = sheetPayload.classe;
    sheet.subject = sheetPayload.subject;
    sheet.semester = sheetPayload.semester;
    sheet.coefficient = Number(sheetPayload.coefficient || sheet.coefficient || 1) || 1;
    sheet.maxScore = maxScore;
    sheet.componentsTemplate = componentsTemplate;
    if (teacher) {
      sheet.teacher = teacher._id;
    }
    await sheet.save();
  }

  if (!Array.isArray(results)) {
    return res.status(400).json({ success: false, message: 'Données invalides.' });
  }

  const studentsInClass = await Student.find({ classe: sheet.classe }).select('_id');
  const allowedStudentIds = new Set(studentsInClass.map((student) => String(student._id)));

  const filteredResults = results.filter((result) => allowedStudentIds.has(String(result.student)));
  const normalized = filteredResults.map((result) => {
    const payload = buildResultPayload({
      score: result.score,
      maxScore: sheet.maxScore,
      components: result.components,
    });

    return {
      student: result.student,
      remarks: result.remarks || '',
      ...payload,
    };
  });

  const resultByStudent = new Map(normalized.map((item) => [String(item.student), item]));

  const ops = normalized.map((item) => ({
    updateOne: {
      filter: { sheet: sheet._id, student: item.student },
      update: {
        $set: {
          score: resultByStudent.get(String(item.student))?.score ?? null,
          maxScore: sheet.maxScore,
          semester: sheet.semester,
          components: resultByStudent.get(String(item.student))?.components || [],
          hasComponents: resultByStudent.get(String(item.student))?.hasComponents || false,
          isComplete: resultByStudent.get(String(item.student))?.isComplete ?? true,
          completionRate: resultByStudent.get(String(item.student))?.completionRate ?? 100,
          remarks: item.remarks || '',
          gradedBy: req.user.id,
        },
      },
      upsert: true,
    },
  }));

  if (ops.length > 0) {
    await NoteEntry.bulkWrite(ops);
  }

  const savedEntries = await NoteEntry.find({ sheet: sheet._id })
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .sort({ updatedAt: -1 });

  const stats = computeResultStats(savedEntries, sheet.maxScore / 2);

  const populatedSheet = await populateSheetQuery(NoteSheet.findById(sheet._id));

  if (req.user.role === 'teacher') {
    await notifyGradeAdded({
      io: req.io,
      teacher,
      sheetTitle: sheet.title || 'devoir',
      classeId: sheet.classe,
      subjectId: sheet.subject,
      semester: sheet.semester,
      sheetId: sheet._id,
      role: 'admin',
    });
    await notifyGradeAdded({
      io: req.io,
      teacher,
      sheetTitle: sheet.title || 'devoir',
      classeId: sheet.classe,
      subjectId: sheet.subject,
      semester: sheet.semester,
      sheetId: sheet._id,
      role: 'supervisor',
    });
  }

  res.status(200).json({
    success: true,
    data: {
      sheet: populatedSheet,
      entries: savedEntries,
      stats,
    },
    message: `${normalized.length} note(s) enregistrée(s).`,
  });
});

const getMyResults = asyncHandler(async (req, res) => {
  const student = await resolveActingStudent(req);

  const filter = { student: student._id };
  if (req.query.semester) {
    filter.semester = req.query.semester;
  }

  const entries = await NoteEntry.find(filter)
    .populate({
      path: 'sheet',
      populate: [
        { path: 'classe', select: 'name' },
        { path: 'subject', select: 'name code coefficient' },
        { path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } },
        { path: 'exam', select: 'title date startTime endTime type' },
      ],
    })
    .sort({ createdAt: -1 });

  const results = entries
    .filter((entry) => entry.sheet && entry.sheet.isActive !== false && entry.sheet.visible !== false)
    .map((entry) => ({
      _id: entry._id,
      score: entry.score,
      maxScore: entry.maxScore,
      semester: entry.semester,
      components: entry.components || [],
      remarks: entry.remarks,
      type: entry.sheet.type,
      title: entry.sheet.title,
      coefficient: entry.sheet.coefficient || 1,
      subject: entry.sheet.subject,
      classe: entry.sheet.classe,
      teacher: entry.sheet.teacher,
      exam: entry.sheet.exam,
      updatedAt: entry.updatedAt,
    }));

  const summary = buildStudentSummaries(results);

  res.status(200).json({ success: true, data: results, summary });
});

const getClassRanking = asyncHandler(async (req, res) => {
  const { classe, subject } = req.query;
  const selectedComponentKey = String(req.query.componentKey || '').trim();

  let targetClassId = classe;
  let currentStudentId = null;
  let teacher = null;

  if (req.user.role === 'student' || req.user.role === 'parent') {
    const studentProfile = await resolveActingStudent(req, { required: true });

    targetClassId = studentProfile.classe;
    currentStudentId = String(studentProfile._id);
  } else if (req.user.role === 'teacher') {
    teacher = await getTeacherProfile(req.user.id);
    if (!targetClassId) {
      return res.status(400).json({ success: false, message: 'Classe requise.' });
    }

    const classAllowed = teacher.classes.some((classId) => classId.toString() === String(targetClassId));
    if (!classAllowed) {
      return res.status(403).json({ success: false, message: 'Vous ne pouvez consulter que vos classes.' });
    }
  }

  if (!targetClassId) {
    return res.status(400).json({ success: false, message: 'Classe requise.' });
  }

  await ensureClassAccessibleForSupervisor(req, targetClassId);

  const classInfo = await Class.findById(targetClassId).select('name');
  if (!classInfo) {
    return res.status(404).json({ success: false, message: 'Classe introuvable.' });
  }

  let subjectInfo = null;
  if (subject) {
    await ensureSubjectBelongsToClass(subject, targetClassId);
    subjectInfo = await Subject.findById(subject).select('name');

    if (req.user.role === 'teacher') {
      const subjectAllowed = teacher.subjects.some((subjectId) => subjectId.toString() === String(subject));
      if (!subjectAllowed) {
        return res.status(403).json({ success: false, message: 'Vous ne pouvez consulter que vos matières.' });
      }
    }
  }

  if (selectedComponentKey && !subject) {
    return res.status(400).json({
      success: false,
      message: 'La matière est requise pour un classement par composante.',
    });
  }

  const sheetFilter = {
    classe: targetClassId,
    isActive: true,
  };

  // Students can only see visible sheets
  if (req.user.role === 'student' || req.user.role === 'parent') {
    sheetFilter.visible = true;
  }

  if (subject) {
    sheetFilter.subject = subject;
  }

  const sheets = await NoteSheet.find(sheetFilter).select('_id');
  if (sheets.length === 0) {
    return res.status(200).json({
      success: true,
      data: [],
      meta: {
        classe: { _id: classInfo._id, name: classInfo.name },
        subject: subjectInfo ? { _id: subject, name: subjectInfo.name } : null,
      },
    });
  }

  const sheetIds = sheets.map((sheet) => sheet._id);

  const entries = await NoteEntry.find({ sheet: { $in: sheetIds } })
    .populate({
      path: 'sheet',
      select: 'subject isActive',
      populate: { path: 'subject', select: 'name' },
    })
    .populate({
      path: 'student',
      select: '_id gender',
      populate: { path: 'user', select: 'firstName lastName avatar' },
    });

  const byStudent = new Map();
  const availableComponentsMap = new Map();

  entries.forEach((entry) => {
    if (!entry?.sheet?.isActive) return;
    if (!entry.student || !entry.student.user) return;

    const subjectId = String(entry.sheet.subject?._id || 'unknown');

    if (Array.isArray(entry.components)) {
      entry.components.forEach((component) => {
        const key = String(component?.key || '').trim();
        const name = String(component?.name || '').trim();
        if (!key && !name) return;

        const mapKey = key || name;
        if (!availableComponentsMap.has(mapKey)) {
          availableComponentsMap.set(mapKey, {
            key: mapKey,
            name: name || mapKey,
          });
        }
      });
    }

    let score10 = null;
    if (selectedComponentKey) {
      const matchedComponent = Array.isArray(entry.components)
        ? entry.components.find((component) => String(component?.key || '').trim() === selectedComponentKey)
        : null;

      if (matchedComponent && matchedComponent.score !== null && matchedComponent.score !== undefined) {
        const componentScore = Number(matchedComponent.score);
        if (!Number.isNaN(componentScore)) {
          score10 = componentScore;
        }
      }
    } else if (entry.score !== null && entry.score !== undefined && entry.maxScore) {
      score10 = (Number(entry.score) / Number(entry.maxScore)) * 10;
    } else if (Array.isArray(entry.components) && entry.components.length > 0) {
      const componentScores = entry.components
        .map((component) => Number(component.score))
        .filter((value) => !Number.isNaN(value));

      if (componentScores.length > 0) {
        score10 = componentScores.reduce((sum, value) => sum + value, 0) / componentScores.length;
      }
    }

    if (score10 === null || Number.isNaN(score10)) return;

    const studentId = String(entry.student._id);
    if (!byStudent.has(studentId)) {
      byStudent.set(studentId, {
        studentId,
        firstName: entry.student.user.firstName || '',
        lastName: entry.student.user.lastName || '',
        avatar: entry.student.user.avatar || '',
        gender: entry.student.gender || '',
        bySubject: new Map(),
      });
    }

    const studentItem = byStudent.get(studentId);
    const subjectScores = studentItem.bySubject.get(subjectId) || [];
    subjectScores.push(score10);
    studentItem.bySubject.set(subjectId, subjectScores);
  });

  let ranking = Array.from(byStudent.values()).map((studentItem) => {
    let points = 0;

    studentItem.bySubject.forEach((scores) => {
      if (!scores || scores.length === 0) return;
      const subjectAverage = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      points += subjectAverage;
    });

    return {
      studentId: studentItem.studentId,
      firstName: studentItem.firstName,
      lastName: studentItem.lastName,
      avatar: studentItem.avatar || '',
      gender: studentItem.gender || '',
      subjectsCount: studentItem.bySubject.size,
      points: Number(points.toFixed(2)),
      isCurrentStudent: currentStudentId ? currentStudentId === studentItem.studentId : false,
    };
  })
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const byLastName = a.lastName.localeCompare(b.lastName, 'fr');
      if (byLastName !== 0) return byLastName;
      return a.firstName.localeCompare(b.firstName, 'fr');
    });

  // Assign ranking with ties and skip ranks after tied positions (1224 style)
  let previousPoints = null;
  let currentRank = 0;
  let position = 0;

  ranking = ranking.map((item) => {
    position += 1;
    if (previousPoints === null || item.points !== previousPoints) {
      currentRank = position;
      previousPoints = item.points;
    }

    return {
      rank: currentRank,
      ...item,
    };
  });

  res.status(200).json({
    success: true,
    data: ranking,
    meta: {
      classe: { _id: classInfo._id, name: classInfo.name },
      subject: subjectInfo ? { _id: subject, name: subjectInfo.name } : null,
      component: selectedComponentKey
        ? (Array.from(availableComponentsMap.values()).find((component) => component.key === selectedComponentKey) || null)
        : null,
      availableComponents: Array.from(availableComponentsMap.values()),
    },
  });
});

const getComponentsTemplate = asyncHandler(async (req, res) => {
  const { classe, subject, semester: rawSemester = 'S1' } = req.query;
  const semester = normalizeSemesterValue(rawSemester);

  if (!classe || !subject) {
    return res.status(400).json({ success: false, message: 'Classe et matière requises.' });
  }

  await ensureClassAccessibleForSupervisor(req, classe);

  // Convert string IDs to ObjectIds for proper matching
  const mongoose = require('mongoose');
  const classId = mongoose.Types.ObjectId.isValid(classe) ? classe : null;
  const subjectId = mongoose.Types.ObjectId.isValid(subject) ? subject : null;

  if (!classId || !subjectId) {
    return res.status(400).json({ success: false, message: 'IDs invalides.' });
  }

  const template = await getContextComponents({
    classe: classId,
    subject: subjectId,
    semester,
  });

  const components = template.components;

  res.status(200).json({
    success: true,
    data: {
      components,
      hasTemplate: components.length > 0,
      requestedSemester: semester,
      resolvedSemester: template.semesterResolved,
      fallbackUsed: template.fallbackUsed,
    },
  });
});

const upsertComponentsTemplate = asyncHandler(async (req, res) => {
  const {
    classe,
    subject,
    semester: rawSemester = 'S1',
    components = [],
  } = req.body;

  if (!classe || !subject) {
    return res.status(400).json({ success: false, message: 'Classe et matière requises.' });
  }

  await ensureClassAccessibleForSupervisor(req, classe);

  const semester = normalizeSemesterValue(rawSemester);
  await ensureSubjectBelongsToClass(subject, classe);

  const normalizedComponents = normalizeTemplateComponentsInput(components);

  const template = await SubjectComponents.findOneAndUpdate(
    { classe, subject, semester, isActive: true },
    {
      $set: {
        classe,
        subject,
        semester,
        components: normalizedComponents,
        isActive: true,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );

  return res.status(200).json({
    success: true,
    message: 'Composantes enregistrées avec succès.',
    data: {
      _id: template._id,
      classe: template.classe,
      subject: template.subject,
      semester: template.semester,
      components: template.components,
    },
  });
});

const reorderComponentsTemplate = asyncHandler(async (req, res) => {
  const { classe, subject, semester: rawSemester = 'S1', order = [] } = req.body;

  if (!classe || !subject) {
    return res.status(400).json({ success: false, message: 'Classe et matière requises.' });
  }

  await ensureClassAccessibleForSupervisor(req, classe);

  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ success: false, message: 'La liste order est requise.' });
  }

  const semester = normalizeSemesterValue(rawSemester);

  const template = await SubjectComponents.findOne({
    classe,
    subject,
    semester,
    isActive: true,
  });

  if (!template) {
    return res.status(404).json({ success: false, message: 'Template des composantes introuvable.' });
  }

  const byKey = new Map(
    (template.components || []).map((component) => [String(component.key || '').toLowerCase(), component])
  );

  const requestedKeys = order.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);

  if (requestedKeys.length !== byKey.size) {
    return res.status(400).json({
      success: false,
      message: 'La liste order doit contenir toutes les clés de composantes exactement une fois.',
    });
  }

  const uniqueRequestedKeys = new Set(requestedKeys);
  if (uniqueRequestedKeys.size !== requestedKeys.length) {
    return res.status(400).json({
      success: false,
      message: 'La liste order contient des clés dupliquées.',
    });
  }

  const unknownKeys = requestedKeys.filter((key) => !byKey.has(key));
  if (unknownKeys.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Clés inconnues dans order: ${unknownKeys.join(', ')}`,
    });
  }

  template.components = requestedKeys.map((key, index) => {
    const component = byKey.get(key);
    return {
      key: component.key,
      name: component.name,
      weight: component.weight,
      order: index + 1,
    };
  });

  await template.save();

  return res.status(200).json({
    success: true,
    message: 'Ordre des composantes mis à jour.',
    data: {
      _id: template._id,
      classe: template.classe,
      subject: template.subject,
      semester: template.semester,
      components: template.components,
    },
  });
});

  /**
   * Simple template for Google Sheets style table
   */
  const getSimpleTemplate = asyncHandler(async (req, res) => {
    const { classe, subject, semester: rawSemester = 'S1', title } = req.query;
    const semester = normalizeSemesterValue(rawSemester);

    if (!classe || !subject) {
      return res.status(400).json({ success: false, message: 'Classe et matière requises.' });
    }

    await ensureClassAccessibleForSupervisor(req, classe);

    const normalizedTitle = normalizeDevoirTitle(title);
    if (!normalizedTitle) {
      return res.status(400).json({
        success: false,
        message: 'Veuillez choisir uniquement: devoir1, devoir2, devoir3 ou devoir4.',
      });
    }

    await ensureSubjectBelongsToClass(subject, classe);

    let teacher = null;
    if (req.user.role === 'teacher') {
      teacher = await getTeacherProfile(req.user.id);
      ensureTeacherCanAccessContext({ teacher, classe, subject });
    }

    const students = await Student.find({ classe })
      .populate('user', 'firstName lastName')
      .sort(STUDENT_CLASS_ORDER_SORT);

    const mongoose = require('mongoose');
    const classId = mongoose.Types.ObjectId.isValid(classe) ? classe : null;
    const subjectId = mongoose.Types.ObjectId.isValid(subject) ? subject : null;

    const template = await getContextComponents({
      classe: classId,
      subject: subjectId,
      semester,
    });

    const components = template.components;

    const filter = {
      classe,
      subject,
      semester,
      type: 'autre',
      title: normalizedTitle,
      isActive: true,
    };

    if (teacher) {
        filter.$or = [
          { teacher: teacher._id },
          { teacher: null },
        ];
    }

    const existingSheet = await NoteSheet.findOne(filter).sort({ createdAt: -1 });

    if (existingSheet && teacher && existingSheet.teacher && String(existingSheet.teacher) !== String(teacher._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }

    const existingEntries = existingSheet
      ? await NoteEntry.find({ sheet: existingSheet._id }).select('student components score')
      : [];

    res.status(200).json({
      success: true,
      data: {
        students,
        components,
        existingSheetId: existingSheet?._id || null,
        existingEntries,
        sheetVisible: existingSheet?.visible !== false,
        requestedSemester: semester,
        resolvedSemester: template.semesterResolved,
        fallbackUsed: template.fallbackUsed,
      },
    });
  });

  /**
   * Simple save: stores component scores and calculates average
   */
  const saveSimpleResults = asyncHandler(async (req, res) => {
    const { classe, subject, semester: rawSemester = 'S1', title, sheetId, results } = req.body;
    const semester = normalizeSemesterValue(rawSemester);

    if (!classe || !subject || !Array.isArray(results)) {
      return res.status(400).json({ success: false, message: 'Données invalides.' });
    }

    await ensureClassAccessibleForSupervisor(req, classe);

    const normalizedTitle = normalizeDevoirTitle(title);
    if (!normalizedTitle) {
      return res.status(400).json({
        success: false,
        message: 'Veuillez choisir uniquement: devoir1, devoir2, devoir3 ou devoir4.',
      });
    }

    await ensureSubjectBelongsToClass(subject, classe);

    let teacher = null;
    if (req.user.role === 'teacher') {
      teacher = await getTeacherProfile(req.user.id);
      ensureTeacherCanAccessContext({ teacher, classe, subject });
    }

    const mongoose = require('mongoose');
    const classId = mongoose.Types.ObjectId.isValid(classe) ? classe : null;
    const subjectId = mongoose.Types.ObjectId.isValid(subject) ? subject : null;

    const template = await getContextComponents({
      classe: classId,
      subject: subjectId,
      semester,
    });

    const components = template.components;

    const type = 'autre';

    let sheet = null;
    if (sheetId) {
      sheet = await NoteSheet.findOne({ _id: sheetId, isActive: true });
      if (!sheet) {
        return res.status(404).json({ success: false, message: 'Feuille de notes introuvable.' });
      }

      if (String(sheet.classe) !== String(classe) || String(sheet.subject) !== String(subject)) {
        return res.status(400).json({ success: false, message: 'Feuille non liée à la classe/matière sélectionnée.' });
      }

      if (normalizeSemesterValue(sheet.semester) !== semester) {
        return res.status(400).json({ success: false, message: 'Feuille non liée au semestre sélectionné.' });
      }

      const existingTitle = normalizeDevoirTitle(sheet.title);
      if (!existingTitle || existingTitle !== normalizedTitle) {
        return res.status(400).json({
          success: false,
          message: 'Cette feuille ne correspond pas au devoir sélectionné.',
        });
      }

      if (teacher && sheet.teacher && String(sheet.teacher) !== String(teacher._id)) {
        return res.status(403).json({ success: false, message: 'Accès refusé.' });
      }
    } else {
      const filter = {
        classe,
        subject,
        semester,
        type,
        title: normalizedTitle,
        isActive: true,
      };

      if (teacher) {
        filter.$or = [
          { teacher: teacher._id },
          { teacher: null },
        ];
      }

      sheet = await NoteSheet.findOne(filter).sort({ createdAt: -1 }).limit(1);
    }

    if (!sheet) {
      const fallbackComponents = Array.isArray(results)
        ? (results[0]?.components || []).map((component) => ({ key: component.key, name: component.name }))
        : [];

      sheet = await NoteSheet.create({
        title: normalizedTitle,
        type,
        exam: null,
        classe,
        subject,
        semester,
        teacher: teacher ? teacher._id : null,
        components: (components.length > 0 ? components : fallbackComponents).map((c) => ({ key: c.key, name: c.name })),
        createdBy: req.user.id,
      });
    } else {
      sheet.title = normalizedTitle;
      sheet.type = 'autre';
      sheet.exam = null;
      await sheet.save();
    }

    const studentsInClass = await Student.find({ classe }).select('_id');
    const allowedStudentIds = new Set(studentsInClass.map((s) => String(s._id)));
    const filteredResults = results.filter((r) => allowedStudentIds.has(String(r.student)));

    const ops = filteredResults.map((result) => {
      let generalScore = null;
      if (result.components && Array.isArray(result.components)) {
        const validScores = result.components
          .filter((c) => c.score !== null && c.score !== undefined)
          .map((c) => Number(c.score));
        if (validScores.length > 0) {
          generalScore = Number((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(2));
        }
      }

      if (generalScore === null && result.score !== null && result.score !== undefined && result.score !== '') {
        const directScore = Number(result.score);
        if (!Number.isNaN(directScore)) {
          generalScore = Number(directScore.toFixed(2));
        }
      }

      return {
        updateOne: {
          filter: { sheet: sheet._id, student: result.student },
          update: { $set: { components: result.components || [], score: generalScore, semester } },
          upsert: true,
        },
      };
    });

    if (ops.length > 0) {
      await NoteEntry.bulkWrite(ops);
    }

    const savedEntries = await NoteEntry.find({ sheet: sheet._id })
      .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } });

    if (req.user.role === 'teacher') {
      await notifyGradeAdded({
        io: req.io,
        teacher,
        sheetTitle: sheet.title || normalizedTitle,
        classeId: classe,
        subjectId: subject,
        semester,
        sheetId: sheet._id,
        role: 'admin',
      });
      await notifyGradeAdded({
        io: req.io,
        teacher,
        sheetTitle: sheet.title || normalizedTitle,
        classeId: classe,
        subjectId: subject,
        semester,
        sheetId: sheet._id,
        role: 'supervisor',
      });
    }

    res.status(200).json({
      success: true,
      message: `${filteredResults.length} note(s) enregistrée(s).`,
      data: { sheet, entries: savedEntries },
    });
  });

const getResults = asyncHandler(async (req, res) => {
  const { classe, subject, semester = 'S1', sheetId } = req.query;

  if (!classe || !subject) {
    return res.status(400).json({
      success: false,
      message: 'Classe et matière requises.',
    });
  }

  await ensureClassAccessibleForSupervisor(req, classe);

  let teacher = null;

  // Vérifier que l'utilisateur a accès à cette classe/matière (pour les enseignants)
  if (req.user.role === 'teacher') {
    try {
      teacher = await getTeacherProfile(req.user.id);
      ensureTeacherCanAccessContext({ teacher, classe, subject });
    } catch (error) {
      return res.status(error.statusCode || 403).json({
        success: false,
        message: error.message,
      });
    }
  }

  try {
    const baseFilter = {
      classe,
      subject,
      semester,
      isActive: true,
    };

    const teacherScopeFilter = teacher
      ? { $or: [{ teacher: teacher._id }, { teacher: null }] }
      : {};

    const examsCount = await NoteSheet.countDocuments({ ...baseFilter, ...teacherScopeFilter });

    // Trouver la feuille demandée (si sélectionnée), sinon la plus récente
    const sheetFilter = { ...baseFilter, ...teacherScopeFilter };

    if (sheetId) {
      sheetFilter._id = sheetId;
    }

    const sheet = await NoteSheet.findOne(sheetFilter).sort({ createdAt: -1 });

    if (!sheet) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: {
          examsCount,
          notesCount: 0,
          studentsCount: 0,
        },
        message: 'Aucune feuille de notes trouvée.',
      });
    }

    // Récupérer tous les élèves de la classe
    const students = await Student.find({ classe })
      .populate('user', 'firstName lastName')
      .select('_id user inscriptionNumber')
      .sort(STUDENT_CLASS_ORDER_SORT);

    // Récupérer les entrées de notes
    const entries = await NoteEntry.find({ sheet: sheet._id })
      .populate({
        path: 'student',
        select: '_id inscriptionNumber',
        populate: { path: 'user', select: 'firstName lastName' },
      });

    // Créer une map des entrées par étudiant
    const entriesByStudent = new Map();
    entries.forEach((entry) => {
      if (!entry || !entry.student || !entry.student._id) {
        return; // guard: entry mal formée ou étudiant supprimé
      }
      entriesByStudent.set(String(entry.student._id), entry);
    });

    // Construire le résultat pour tous les élèves
    const results = students.map((student) => {
      const entry = entriesByStudent.get(String(student._id));
      return {
        _id: entry?._id || null,
        student: {
          _id: student._id,
          inscriptionNumber: student.inscriptionNumber,
          firstName: student.user?.firstName || '',
          lastName: student.user?.lastName || '',
        },
        components: entry?.components || [],
        score: entry?.score || null,
      };
    });

    const notesCount = results.filter((result) => {
      const hasScore = result.score !== null && result.score !== undefined;
      const hasComponents = Array.isArray(result.components)
        && result.components.some((component) => component.score !== null && component.score !== undefined);
      return hasScore || hasComponents;
    }).length;

    res.status(200).json({
      success: true,
      data: results,
      meta: {
        examsCount,
        notesCount,
        studentsCount: results.length,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des résultats.',
      error: error.message,
    });
  }
});

const exportSheetExcel = asyncHandler(async (req, res) => {
  const { classe, subject, semester = 'S1', sheetId } = req.query;

  if (!classe || !subject || !sheetId) {
    return res.status(400).json({
      success: false,
      message: 'Classe, matière et devoir sont requis pour exporter.',
    });
  }

  const semesterNormalized = normalizeSemesterValue(semester);

  const [classInfo, subjectInfo] = await Promise.all([
    Class.findById(classe).select('name baseName').lean(),
    Subject.findById(subject).select('name code').lean(),
  ]);
  const subjectCode = String(subjectInfo?.code || '').trim().toUpperCase();
  const MASSAR_SUBJECT_CODES = ['AR', 'FRA', 'HG'];
  const isMassar = MASSAR_SUBJECT_CODES.includes(subjectCode);

  if (!classInfo || !subjectInfo) {
    return res.status(404).json({
      success: false,
      message: 'Classe ou matière introuvable.',
    });
  }

  const sheet = await NoteSheet.findOne({
    _id: sheetId,
    classe,
    subject,
    semester: semesterNormalized,
    isActive: true,
  }).lean();

  if (!sheet) {
    return res.status(404).json({
      success: false,
      message: 'Devoir introuvable pour cette classe/matière.',
    });
  }

  const students = await Student.find({ classe })
    .populate('user', 'firstName lastName')
    .select('_id user classOrder createdAt')
    .sort(STUDENT_CLASS_ORDER_SORT);

  const entries = await NoteEntry.find({ sheet: sheet._id })
    .select('student components score')
    .lean();

  const entriesByStudent = new Map(entries.map((entry) => [String(entry.student), entry]));

  let componentOrder = (sheet.components || [])
    .map((component) => ({
      key: String(component?.key || component?.name || '').trim().toLowerCase(),
      name: String(component?.name || '').trim(),
    }))
    .filter((component) => component.name);

  if (componentOrder.length === 0) {
    const fallback = await getContextComponents({ classe, subject, semester: semesterNormalized });
    componentOrder = (fallback.components || [])
      .map((component) => ({
        key: String(component?.key || component?.name || '').trim().toLowerCase(),
        name: String(component?.name || '').trim(),
      }))
      .filter((component) => component.name);
  }

  if (componentOrder.length === 0) {
    const firstWithComponents = entries.find((entry) => Array.isArray(entry.components) && entry.components.length > 0);
    if (firstWithComponents) {
      componentOrder = firstWithComponents.components
        .map((component) => ({
          key: String(component?.key || component?.name || '').trim().toLowerCase(),
          name: String(component?.name || '').trim(),
        }))
        .filter((component) => component.name);
    }
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Notes');
  if (isMassar) {
    worksheet.views = [{ rightToLeft: true }];
  }

  const headers = [
    'N°',
    'Nom',
    'Prénom',
    ...componentOrder.map((component) => component.name),
    'Moyenne',
    'Observation',
  ];

  const metadataText = `Classe: ${classInfo.name || '-'}   |   Matière: ${subjectInfo.name || '-'}   |   Devoir: ${sheet.title || '-'}   |   Semestre: ${semesterNormalized}`;
  const lastColumn = headers.length;

  worksheet.mergeCells(1, 1, 1, lastColumn);
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = metadataText;
  titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

  const headerRow = worksheet.getRow(3);
  headers.forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const borderStyle = {
    top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
    right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  };

  students.forEach((student, index) => {
    const entry = entriesByStudent.get(String(student._id));
    const entryComponents = new Map(
      (entry?.components || []).map((component) => [
        String(component?.key || component?.name || '').trim().toLowerCase(),
        component,
      ])
    );

    const rowValues = [
      index + 1,
      student.user?.lastName || '-',
      student.user?.firstName || '-',
      ...componentOrder.map((component) => {
        const found = entryComponents.get(component.key);
        if (found?.score === null || found?.score === undefined || found?.score === '') return '-';
        const numeric = Number(found.score);
        return Number.isNaN(numeric) ? String(found.score) : numeric;
      }),
      entry?.score === null || entry?.score === undefined ? '-' : Number(entry.score),
      entry?.score === null || entry?.score === undefined ? 'Non noté' : '',
    ];

    const row = worksheet.addRow(rowValues);

    row.eachCell((cell) => {
      cell.border = borderStyle;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    if (index % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FBFF' } };
      });
    }
  });

  headerRow.height = 24;
  worksheet.getRow(1).height = 24;

  worksheet.columns = headers.map((header, idx) => {
    if (idx === 0) return { width: 8 };
    if (idx === 1 || idx === 2) return { width: 20 };
    if (header === 'Moyenne') return { width: 12 };
    if (header === 'Observation') return { width: 18 };
    return { width: 16 };
  });

  for (let rowIndex = 3; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    row.eachCell((cell) => {
      if (!cell.border) {
        cell.border = borderStyle;
      }
    });
  }

  const classSegment = toSafeFileSegment(classInfo.baseName || classInfo.name);
  const subjectSegment = toSafeFileSegment(subjectInfo.code || subjectInfo.name);
  const semesterDevoirSegment = buildSemesterDevoirSegment({
    semester: semesterNormalized,
    devoirTitle: sheet.title,
  });
  const fileName = `${classSegment}_${subjectSegment}_${semesterDevoirSegment}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  await workbook.xlsx.write(res);
  res.end();
});

const toggleSheetVisibility = asyncHandler(async (req, res) => {
  const { sheetId } = req.params;
  const { visible } = req.body;

  if (!sheetId) {
    return res.status(400).json({
      success: false,
      message: 'ID de la feuille de notes requis.',
    });
  }

  const sheet = await NoteSheet.findById(sheetId);
  if (!sheet) {
    return res.status(404).json({
      success: false,
      message: 'Feuille de notes introuvable.',
    });
  }

  sheet.visible = visible !== undefined ? visible : !sheet.visible;
  await sheet.save();

  res.status(200).json({
    success: true,
    data: { visible: sheet.visible },
    message: `Feuille de notes ${sheet.visible ? 'visible' : 'cachée'} pour les élèves.`,
  });
});

  module.exports = {
    getSheets,
    getTemplate,
    saveSheetResults,
    getMyResults,
    getClassRanking,
    getComponentsTemplate,
    upsertComponentsTemplate,
    reorderComponentsTemplate,
    getSimpleTemplate,
    saveSimpleResults,
    getResults,
    exportSheetExcel,
    toggleSheetVisibility,
  };
