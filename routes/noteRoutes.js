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

router.get('/my-results', protect, roleCheck('student', 'parent'), getMyResults);
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

module.exports = router;
