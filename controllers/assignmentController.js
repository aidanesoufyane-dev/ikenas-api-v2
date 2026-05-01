/**
 * Controller Devoirs - CRUD devoirs + soumissions élèves
 */
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Teacher = require('../models/Teacher');
const Student = require('../models/Student');
const { asyncHandler } = require('../utils/helpers');
const { sendNotification } = require('../utils/notify');
const { resolveActingStudent } = require('../utils/studentAccess');

/**
 * @desc    Créer un devoir (prof)
 * @route   POST /api/assignments
 * @access  Private/Teacher
 */
const createAssignment = asyncHandler(async (req, res) => {
  const { title, description, classe, subject, deadline } = req.body;

  const teacher = await Teacher.findOne({ user: req.user.id });
  if (!teacher) {
    return res.status(404).json({ success: false, message: 'Profil enseignant non trouvé.' });
  }

  const attachments = [];
  if (req.files && req.files.length > 0) {
    req.files.forEach((f) => {
      attachments.push({
        filename: f.filename,
        originalName: f.originalname,
        path: `/uploads/assignments/${f.filename}`,
        mimetype: f.mimetype,
        size: f.size,
      });
    });
  }

  const assignment = await Assignment.create({
    title,
    description,
    classe,
    subject: subject || undefined,
    teacher: teacher._id,
    deadline: deadline || null,
    attachments,
  });

  const populated = await Assignment.findById(assignment._id)
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('submissionCount');

  // Notifier les élèves de la classe
  await sendNotification(req.io, {
    type: 'assignment_created',
    title: 'Nouveau devoir',
    message: `${populated.title}${populated.subject?.name ? ' — ' + populated.subject.name : ''}${populated.deadline ? `. Date limite: ${new Date(populated.deadline).toLocaleDateString('fr-FR')}.` : '.'}`,
    recipientClass: classe,
    link: '/student/assignments',
    createdBy: req.user.id,
  });

  res.status(201).json({ success: true, data: populated });
});

/**
 * @desc    Lister les devoirs (prof: ses devoirs, élève: devoirs de sa classe)
 * @route   GET /api/assignments?classe=
 * @access  Private
 */
const getAssignments = asyncHandler(async (req, res) => {
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
  } else if (req.query.classe) {
    filter.classe = req.query.classe;
  }

  const assignments = await Assignment.find(filter)
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('submissionCount')
    .sort('-createdAt');

  res.status(200).json({ success: true, data: assignments });
});

/**
 * @desc    Obtenir un devoir par ID + ses soumissions (pour le prof)
 * @route   GET /api/assignments/:id
 * @access  Private
 */
const getAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id)
    .populate('classe', 'name')
    .populate('subject', 'name code')
    .populate({ path: 'teacher', populate: { path: 'user', select: 'firstName lastName' } })
    .populate('submissionCount');

  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Devoir non trouvé.' });
  }

  // Si prof, admin ou surveillant → inclure les soumissions
  let submissions = [];
  if (req.user.role === 'teacher' || req.user.role === 'admin' || req.user.role === 'supervisor') {
    submissions = await Submission.find({ assignment: assignment._id })
      .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
      .sort('-submittedAt');
  }

  // Si élève → inclure sa propre soumission
  let mySubmission = null;
  if (req.user.role === 'student' || req.user.role === 'parent') {
    const student = await resolveActingStudent(req);
    mySubmission = await Submission.findOne({
      assignment: assignment._id,
      student: student._id,
    });
  }

  res.status(200).json({
    success: true,
    data: assignment,
    submissions,
    mySubmission,
  });
});

/**
 * @desc    Supprimer un devoir
 * @route   DELETE /api/assignments/:id
 * @access  Private/Teacher,Admin
 */
const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) {
    return res.status(404).json({ success: false, message: 'Devoir non trouvé.' });
  }

  // Vérifier que c'est bien le prof qui a créé le devoir
  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (assignment.teacher.toString() !== teacher._id.toString()) {
      return res.status(403).json({ success: false, message: 'Vous ne pouvez supprimer que vos devoirs.' });
    }
  }

  assignment.isActive = false;
  await assignment.save();

  res.status(200).json({ success: true, message: 'Devoir supprimé.' });
});

/**
 * @desc    Soumettre un devoir (élève)
 * @route   POST /api/assignments/:id/submit
 * @access  Private/Student
 */
const submitAssignment = asyncHandler(async (req, res) => {
  const { text } = req.body;

  const assignment = await Assignment.findById(req.params.id);
  if (!assignment || !assignment.isActive) {
    return res.status(404).json({ success: false, message: 'Devoir non trouvé.' });
  }

  const student = await resolveActingStudent(req);

  // Vérifier que l'élève est dans la bonne classe
  if (student.classe.toString() !== assignment.classe.toString()) {
    return res.status(403).json({ success: false, message: 'Ce devoir ne concerne pas votre classe.' });
  }

  // Vérifier si déjà soumis
  const existing = await Submission.findOne({ assignment: assignment._id, student: student._id });
  if (existing) {
    return res.status(400).json({ success: false, message: 'Vous avez déjà soumis ce devoir.' });
  }

  const attachments = [];
  if (req.files && req.files.length > 0) {
    req.files.forEach((f) => {
      attachments.push({
        filename: f.filename,
        originalName: f.originalname,
        path: `/uploads/submissions/${f.filename}`,
        mimetype: f.mimetype,
        size: f.size,
      });
    });
  }

  const isLate = assignment.deadline ? new Date() > new Date(assignment.deadline) : false;

  const submission = await Submission.create({
    assignment: assignment._id,
    student: student._id,
    text,
    attachments,
    isLate,
  });

  const populated = await Submission.findById(submission._id)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } });

  res.status(201).json({ success: true, data: populated });
});

/**
 * @desc    Obtenir les soumissions d'un devoir (prof)
 * @route   GET /api/assignments/:id/submissions
 * @access  Private/Teacher,Admin
 */
const getSubmissions = asyncHandler(async (req, res) => {
  const submissions = await Submission.find({ assignment: req.params.id })
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
    .sort('-submittedAt');

  res.status(200).json({ success: true, data: submissions });
});

const getSubmissionStatus = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id)
    .populate('classe', 'name')
    .populate('subject', 'name code');

  if (!assignment || !assignment.isActive) {
    return res.status(404).json({ success: false, message: 'Devoir non trouvé.' });
  }

  if (req.user.role === 'teacher') {
    const teacher = await Teacher.findOne({ user: req.user.id });
    if (!teacher || String(assignment.teacher) !== String(teacher._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé.' });
    }
  }

  const [students, submissions] = await Promise.all([
    Student.find({ classe: assignment.classe })
      .populate('user', 'firstName lastName')
      .sort({ classOrder: 1, createdAt: 1, _id: 1 }),
    Submission.find({ assignment: assignment._id })
      .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName' } })
      .sort('-submittedAt'),
  ]);

  const submittedByStudent = new Map();
  submissions.forEach((submission) => {
    submittedByStudent.set(String(submission.student?._id), submission);
  });

  const submittedStudents = submissions.map((submission) => ({
    _id: submission._id,
    student: submission.student,
    text: submission.text,
    attachments: submission.attachments,
    submittedAt: submission.submittedAt,
    isLate: submission.isLate,
  }));

  const notSubmittedStudents = students
    .filter((student) => !submittedByStudent.has(String(student._id)))
    .map((student) => ({
      _id: student._id,
      student,
    }));

  res.status(200).json({
    success: true,
    data: {
      assignment,
      submittedStudents,
      notSubmittedStudents,
      summary: {
        totalStudents: students.length,
        submitted: submittedStudents.length,
        notSubmitted: notSubmittedStudents.length,
      },
    },
  });
});

module.exports = {
  createAssignment,
  getAssignments,
  getAssignment,
  deleteAssignment,
  submitAssignment,
  getSubmissions,
  getSubmissionStatus,
};
