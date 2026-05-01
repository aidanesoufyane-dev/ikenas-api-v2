/**
 * Controller Examens - CRUD examens + résultats
 */
const Exam = require('../models/Exam');
const ExamResult = require('../models/ExamResult');
const Subject = require('../models/Subject');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const { asyncHandler } = require('../utils/helpers');
const { sendNotification } = require('../utils/notify');
const { buildResultPayload, computeResultStats, normalizeComponents } = require('../utils/gradeUtils');
const { resolveActingStudent } = require('../utils/studentAccess');

const STUDENT_CLASS_ORDER_SORT = { classOrder: 1, createdAt: 1, _id: 1 };

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

const sanitizeExamComponents = (components, maxScore) => normalizeComponents(components, maxScore)
  .map((component) => ({
    name: component.name,
    maxScore: component.maxScore,
    weight: component.weight,
  }));

const buildResultsResponse = async (examId, sort = { score: -1, updatedAt: -1 }) => ExamResult.find({ exam: examId })
  .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
  .sort(sort);

/**
 * @desc    Créer un examen
 * @route   POST /api/exams
 * @access  Private/Admin,Teacher
 */
const createExam = asyncHandler(async (req, res) => {
  const { title, description, classe, subject, date, startTime, endTime, room, maxScore, type, semester, componentsTemplate } = req.body;

  await ensureSubjectBelongsToClass(subject, classe);

  let teacherId = req.body.teacher;

  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Profil enseignant non trouvé.' });
    }
    // Vérifier que le prof enseigne cette classe
    const teachesClass = teacher.classes.some((c) => c.toString() === classe);
    if (!teachesClass) {
      return res.status(403).json({ success: false, message: "Vous n'enseignez pas à cette classe." });
    }
    teacherId = teacher._id;
  }

  const exam = await Exam.create({
    title,
    description,
    classe,
    subject,
    teacher: teacherId,
    date,
    startTime,
    endTime,
    room,
    maxScore: 10,
    semester: semester || 'S1',
    componentsTemplate: sanitizeExamComponents(componentsTemplate, 10),
    type: type || 'examen',
    createdBy: req.user.id,
  });

  const populated = await Exam.findById(exam._id)
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } });

  // Notification aux élèves de la classe
  await sendNotification(req.io, {
    type: 'exam_scheduled',
    title: 'Examen planifié',
    message: `${populated.title} — ${populated.subject?.name || ''} le ${new Date(populated.date).toLocaleDateString('fr-FR')} de ${populated.startTime} à ${populated.endTime}.`,
    recipientClass: classe,
    link: '/student/exams',
    createdBy: req.user.id,
  });

  res.status(201).json({ success: true, data: populated });
});

/**
 * @desc    Lister les examens
 * @route   GET /api/exams?classe=&upcoming=true
 * @access  Private
 */
const getExams = asyncHandler(async (req, res) => {
  const filter = { isActive: true };

  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Profil enseignant non trouvé.' });
    }
    filter.teacher = teacher._id;
    if (req.query.classe) filter.classe = req.query.classe;
  } else if (req.user.role === 'student' || req.user.role === 'parent') {
    const student = await resolveActingStudent(req);
    filter.classe = student.classe;
  } else {
    // Admin
    if (req.query.classe) filter.classe = req.query.classe;
  }

  if (req.query.upcoming === 'true') {
    filter.date = { $gte: new Date() };
  }

  if (req.query.semester) {
    filter.semester = req.query.semester;
  }

  const exams = await Exam.find(filter)
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('resultsCount')
    .sort({ date: 1, startTime: 1 });

  res.status(200).json({ success: true, data: exams });
});

/**
 * @desc    Obtenir un examen
 * @route   GET /api/exams/:id
 * @access  Private
 */
const getExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id)
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } });

  if (!exam) {
    return res.status(404).json({ success: false, message: 'Examen non trouvé.' });
  }

  res.status(200).json({ success: true, data: exam });
});

/**
 * @desc    Mettre à jour un examen
 * @route   PUT /api/exams/:id
 * @access  Private/Admin,Teacher(own)
 */
const updateExam = asyncHandler(async (req, res) => {
  let exam = await Exam.findById(req.params.id);
  if (!exam) {
    return res.status(404).json({ success: false, message: 'Examen non trouvé.' });
  }

  // Teacher can only edit their own exams
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher || exam.teacher.toString() !== teacher._id.toString()) {
      return res.status(403).json({ success: false, message: "Vous ne pouvez modifier que vos propres examens." });
    }
  }

  const targetClass = req.body.classe || exam.classe.toString();
  const targetSubject = req.body.subject || exam.subject.toString();
  await ensureSubjectBelongsToClass(targetSubject, targetClass);

  if (req.body.componentsTemplate) {
    req.body.componentsTemplate = sanitizeExamComponents(req.body.componentsTemplate, req.body.maxScore || exam.maxScore);
  }

  exam = await Exam.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  })
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } });

  res.status(200).json({ success: true, data: exam });
});

/**
 * @desc    Supprimer un examen
 * @route   DELETE /api/exams/:id
 * @access  Private/Admin,Teacher(own)
 */
const deleteExam = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) {
    return res.status(404).json({ success: false, message: 'Examen non trouvé.' });
  }

  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher || exam.teacher.toString() !== teacher._id.toString()) {
      return res.status(403).json({ success: false, message: "Vous ne pouvez supprimer que vos propres examens." });
    }
  }

  await Exam.findByIdAndUpdate(req.params.id, { isActive: false });
  res.status(200).json({ success: true, message: 'Examen supprimé.' });
});

/* ═══════════════════════════════════════════
   RÉSULTATS / NOTES
   ═══════════════════════════════════════════ */

/**
 * @desc    Enregistrer / mettre à jour les résultats en masse
 * @route   POST /api/exams/:id/results
 * @access  Private/Admin,Teacher(own)
 * @body    { results: [{ student, score, remarks }] }
 */
const saveResults = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id).populate('classe', 'name').populate('subject', 'name code');
  if (!exam) {
    return res.status(404).json({ success: false, message: 'Examen non trouvé.' });
  }

  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher || exam.teacher.toString() !== teacher._id.toString()) {
      return res.status(403).json({ success: false, message: "Vous ne pouvez noter que vos propres examens." });
    }
  }

  const { results } = req.body;
  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ success: false, message: 'Données invalides.' });
  }

    const normalizedResults = results.map((result) => {
      const payload = buildResultPayload({
        score: result.score,
        maxScore: exam.maxScore,
        components: result.components,
      });

      return {
        student: result.student,
        remarks: result.remarks || '',
        ...payload,
      };
    });

  const normalizedResultsByStudent = new Map(
    normalizedResults.map((result) => [String(result.student), result])
  );

  const ops = results.map((r) => ({
    updateOne: {
      filter: { exam: exam._id, student: r.student },
      update: {
        $set: {
          score: normalizedResultsByStudent.get(String(r.student))?.score ?? null,
            maxScore: exam.maxScore,
            semester: exam.semester || 'S1',
          components: normalizedResultsByStudent.get(String(r.student))?.components || [],
          hasComponents: normalizedResultsByStudent.get(String(r.student))?.hasComponents || false,
          isComplete: normalizedResultsByStudent.get(String(r.student))?.isComplete ?? true,
          completionRate: normalizedResultsByStudent.get(String(r.student))?.completionRate ?? 100,
            remarks: r.remarks || '',
          gradedBy: req.user.id,
        },
      },
      upsert: true,
    },
  }));

  await ExamResult.bulkWrite(ops);

  // Notifier chaque élève
  for (const r of normalizedResults) {
    const student = await Student.findById(r.student).populate('user', '_id');
    if (student?.user?._id) {
      const label = r.score === null ? 'en attente de finalisation' : `${r.score}/${exam.maxScore}`;
      await sendNotification(req.io, {
        type: 'grade_added',
        title: 'Résultat disponible',
        message: `Votre note pour « ${exam.title} » (${exam.subject?.name || ''}) : ${label}.`,
        recipient: student.user._id.toString(),
        link: '/student/exams',
        createdBy: req.user.id,
      });
    }
  }

  const saved = await buildResultsResponse(exam._id);
  const stats = computeResultStats(saved, exam.maxScore / 2);

  res.status(200).json({
    success: true,
    data: saved,
    stats,
    message: `${normalizedResults.length} résultat(s) enregistré(s).`,
  });
});

/**
 * @desc    Template de saisie des notes par classe/matière/semestre
 * @route   GET /api/exams/results-template?classe=&subject=&semester=&examId=
 * @access  Private/Admin,Teacher
 */
const getResultsTemplate = asyncHandler(async (req, res) => {
  const { classe, subject, semester = 'S1', examId } = req.query;

  if (!classe || !subject) {
    return res.status(400).json({
      success: false,
      message: 'Classe et matière requises.',
    });
  }

  const studentQuery = { classe, isActive: true };
  const students = await Student.find(studentQuery)
    .populate('user', 'firstName lastName')
    .sort(STUDENT_CLASS_ORDER_SORT);

  const exams = await Exam.find({
    classe,
    subject,
    semester,
    isActive: true,
  })
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
    .sort({ date: -1, createdAt: -1 });

  let selectedExam = examId
    ? exams.find((exam) => exam._id.toString() === examId)
    : exams[0];

  if (examId && !selectedExam) {
    selectedExam = await Exam.findById(examId)
      .populate('classe', 'name')
      .populate('subject', 'name code')
      .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } });
  }

  if (req.user.role === 'teacher' && selectedExam) {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher || selectedExam.teacher?._id?.toString() !== teacher._id.toString()) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
  }

  const existingResults = selectedExam ? await buildResultsResponse(selectedExam._id, { updatedAt: -1 }) : [];

  res.status(200).json({
    success: true,
    data: {
      semester,
      students,
      exams,
      selectedExam,
      existingResults,
      componentsTemplate: selectedExam?.componentsTemplate || [],
    },
  });
});

/**
 * @desc    Obtenir les résultats d'un examen
 * @route   GET /api/exams/:id/results
 * @access  Private
 */
const getResults = asyncHandler(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) {
    return res.status(404).json({ success: false, message: 'Examen non trouvé.' });
  }

  // Student: only own result
  if (req.user.role === 'student' || req.user.role === 'parent') {
    const student = await resolveActingStudent(req);
    const myResult = await ExamResult.findOne({ exam: exam._id, student: student._id })
      .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } });

    return res.status(200).json({ success: true, data: myResult ? [myResult] : [] });
  }

  // Teacher: check ownership
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher || exam.teacher.toString() !== teacher._id.toString()) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
  }

  const results = await buildResultsResponse(exam._id);
  const stats = computeResultStats(results, exam.maxScore / 2);

  res.status(200).json({ success: true, data: results, stats });
});

/**
 * @desc    Obtenir mes résultats (élève)
 * @route   GET /api/exams/my-results
 * @access  Private/Student
 */
const getMyResults = asyncHandler(async (req, res) => {
  const student = await resolveActingStudent(req);

  const resultFilter = { student: student._id };
  if (req.query.semester) {
    resultFilter.semester = req.query.semester;
  }

  const results = await ExamResult.find(resultFilter)
    .populate({
      path: 'exam',
      populate: [
        { path: 'classe', select: 'name' },
        { path: 'subject', select: 'name code' },
        { path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } },
      ],
    })
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, data: results });
});

module.exports = {
  createExam,
  getExams,
  getExam,
  updateExam,
  deleteExam,
  getResultsTemplate,
  saveResults,
  getResults,
  getMyResults,
};
