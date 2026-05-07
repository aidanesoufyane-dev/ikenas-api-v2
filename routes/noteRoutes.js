const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/noteController');
const { protect, roleCheck } = require('../middleware/auth');

router.get('/my-results', protect, roleCheck('student', 'parent', 'teacher'), getMyResults);
router.get('/class-ranking', protect, roleCheck('admin', 'teacher', 'student', 'parent'), getClassRanking);
router.get('/results', protect, roleCheck('admin', 'teacher'), getResults);
router.get('/export/excel', protect, roleCheck('admin'), exportSheetExcel);
router.get('/components-template', protect, roleCheck('admin', 'teacher'), getComponentsTemplate);
router.post('/components-template', protect, roleCheck('admin', 'supervisor', 'pedagogical_director'), upsertComponentsTemplate);
router.put('/components-template/order', protect, roleCheck('admin', 'supervisor', 'pedagogical_director'), reorderComponentsTemplate);
router.get('/template', protect, roleCheck('admin', 'teacher'), getTemplate);
router.get('/sheets', protect, roleCheck('admin', 'teacher'), getSheets);
router.post('/save', protect, roleCheck('admin', 'teacher'), saveSheetResults);

// Simple API (Google Sheets style)
router.get('/simple/template', protect, roleCheck('admin', 'teacher'), getSimpleTemplate);
router.post('/simple/save', protect, roleCheck('admin', 'teacher'), saveSimpleResults);

// Toggle visibility for students
router.put('/:sheetId/visibility', protect, roleCheck('admin'), toggleSheetVisibility);

// Temporary diagnostic route — shows raw DB state for a student
router.get('/debug-student/:studentId', protect, async (req, res) => {
  const mongoose = require('mongoose');
  const Student = require('../models/Student');
  const NoteEntry = require('../models/NoteEntry');
  const NoteSheet = require('../models/NoteSheet');

  const { studentId } = req.params;
  const student = await Student.findById(studentId)
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name level')
    .catch(() => null);

  const oid = mongoose.Types.ObjectId.isValid(studentId)
    ? new mongoose.Types.ObjectId(studentId) : null;

  const entriesById   = oid ? await NoteEntry.find({ student: oid }) : [];
  const entriesByStr  = await NoteEntry.find({ student: studentId });
  const allEntries    = [...new Map([...entriesById, ...entriesByStr].map(e => [String(e._id), e])).values()];

  const sheets = await NoteSheet.find({
    _id: { $in: allEntries.map(e => e.sheet) },
  }).select('title type subject semester visible isActive');

  res.json({
    studentId,
    studentFound: !!student,
    student: student ? {
      _id: student._id,
      name: student.user ? `${student.user.firstName} ${student.user.lastName}` : '?',
      classe: student.classe?.name,
      classeId: String(student.classe?._id || ''),
      parentUser: String(student.parentUser || ''),
    } : null,
    noteEntryCount: allEntries.length,
    noteEntries: allEntries.map(e => ({
      _id: e._id,
      sheet: e.sheet,
      score: e.score,
      semester: e.semester,
    })),
    sheets: sheets.map(s => ({
      _id: s._id,
      title: s.title,
      visible: s.visible,
      isActive: s.isActive,
    })),
  });
});

module.exports = router;
