/**
 * Controller Dashboard - Statistiques pour l'admin
 */
const User = require('../models/User');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Class = require('../models/Class');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const NoteEntry = require('../models/NoteEntry');
const NoteSheet = require('../models/NoteSheet');
const { asyncHandler } = require('../utils/helpers');

/**
 * @desc    Obtenir les statistiques du dashboard admin
 * @route   GET /api/dashboard/stats
 * @access  Private/Admin
 */
const getStats = asyncHandler(async (req, res) => {
  const pendingAttendanceBuckets = await Attendance.aggregate([
    {
      $match: {
        approvalStatus: 'pending',
        classe: { $ne: null },
      },
    },
    {
      $group: {
        _id: {
          classe: '$classe',
          day: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$date',
            },
          },
        },
        studentsCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'classes',
        localField: '_id.classe',
        foreignField: '_id',
        as: 'classInfo',
      },
    },
    {
      $unwind: '$classInfo',
    },
    {
      $project: {
        _id: 0,
        bucketKey: {
          $concat: [
            { $toString: '$classInfo._id' },
            '_',
            '$_id.day',
          ],
        },
        classId: '$classInfo._id',
        className: '$classInfo.name',
        day: '$_id.day',
        studentsCount: 1,
      },
    },
    {
      $sort: { day: -1, className: 1 },
    },
  ]);

  const pendingAttendances = pendingAttendanceBuckets.length;

  // Exécuter toutes les requêtes en parallèle pour la performance
  const [
    totalStudents,
    totalTeachers,
    totalClasses,
    pendingLeaveAbsenceRequests,
    pendingLeaveReturnRequests,
    pendingStudentJustifications,
  ] = await Promise.all([
    Student.countDocuments(),
    Teacher.countDocuments(),
    Class.countDocuments({ isActive: true }),
    LeaveRequest.countDocuments({ requestType: 'absence', status: 'pending' }),
    LeaveRequest.countDocuments({ requestType: 'return', status: 'pending' }),
    Attendance.countDocuments({
      justifiedByStudent: true,
      approvalStatus: 'pending',
      status: { $in: ['absent', 'excused', 'late'] },
    }),
  ]);

  // Statistiques par classe (nombre d'absences par classe)
  const absencesByClass = await Attendance.aggregate([
    {
      $match: {
        status: { $in: ['absent', 'excused'] },
      },
    },
    {
      $group: {
        _id: '$classe',
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'classes',
        localField: '_id',
        foreignField: '_id',
        as: 'classInfo',
      },
    },
    {
      $unwind: '$classInfo',
    },
    {
      $project: {
        className: '$classInfo.name',
        count: 1,
      },
    },
    {
      $sort: { count: -1, className: 1 },
    },
  ]);

  const pendingAttendancesByClass = pendingAttendanceBuckets;

  const approvalQueueCount = pendingAttendances + pendingLeaveAbsenceRequests + pendingLeaveReturnRequests;

  const priorityAlerts = [
    {
      key: 'leave_absence',
      label: 'Demandes d\'absence à valider',
      count: pendingLeaveAbsenceRequests,
      path: '/admin/teachers/leave-requests',
    },
    {
      key: 'leave_return',
      label: 'Demandes de reprise à valider',
      count: pendingLeaveReturnRequests,
      path: '/admin/teachers/leave-requests',
    },
    {
      key: 'student_justification',
      label: 'Justifications d\'absence élève en attente',
      count: pendingStudentJustifications,
      path: '/admin/attendances',
    },
    {
      key: 'attendance_approval',
      label: 'Absences / présences à approuver',
      count: pendingAttendances,
      path: '/admin/attendances',
    },
  ];

  res.status(200).json({
    success: true,
    data: {
      totalStudents,
      totalTeachers,
      totalClasses,
      pendingAttendances,
      approvalQueueCount,
      pendingLeaveAbsenceRequests,
      pendingLeaveReturnRequests,
      pendingStudentJustifications,
      absencesByClass,
      pendingAttendancesByClass,
      priorityAlerts,
    },
  });
});

/**
 * @desc    Grade evolution over time for a student
 * @route   GET /api/dashboard/evolution?studentId=&year=&semester=
 * @access  Private
 */
const getGradeEvolution = asyncHandler(async (req, res) => {
  const { studentId, semester } = req.query;

  if (!studentId) {
    return res.status(400).json({ success: false, message: 'studentId requis.' });
  }

  const sheetFilter = { isActive: true };
  if (semester) sheetFilter.semester = semester;

  const sheets = await NoteSheet.find(sheetFilter)
    .populate('subject', 'name coefficient')
    .lean();

  const sheetIds = sheets.map(s => s._id);
  const sheetMap = {};
  sheets.forEach(s => { sheetMap[String(s._id)] = s; });

  const entries = await NoteEntry.find({
    student: studentId,
    sheet: { $in: sheetIds },
  }).lean();

  const result = entries.map(entry => {
    const sheet = sheetMap[String(entry.sheet)];
    return {
      subject: sheet?.subject?.name || '',
      coefficient: sheet?.subject?.coefficient || 1,
      sheetTitle: sheet?.title || '',
      semester: sheet?.semester || '',
      score: entry.score,
      maxScore: entry.maxScore || 20,
      createdAt: entry.createdAt,
    };
  }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  res.status(200).json(result);
});

module.exports = {
  getStats,
  getGradeEvolution,
};
