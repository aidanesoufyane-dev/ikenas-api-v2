/**
 * Routes Professeurs
 */
const express = require('express');
const router = express.Router();
const {
  createTeacher, getTeachers, getTeacher, updateTeacher, deleteTeacher, importTeachers,
  signPresence, getPresence, getMyClasses, getMySubjects, signPresenceByStaff, signOutByStaff, getTeachersBasic,
} = require('../controllers/teacherController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadExcel } = require('../middleware/upload');

// Import CSV enseignants
router.post('/import', protect, roleCheck('admin'), uploadExcel.single('file'), importTeachers);

// Classes et matières assignées au prof connecté
router.get('/my-classes', protect, roleCheck('teacher'), getMyClasses);
router.get('/my-subjects', protect, roleCheck('teacher'), getMySubjects);

// Présence
router.post('/sign-presence', protect, roleCheck('teacher'), signPresence);
router.post('/sign-presence-by-staff', protect, roleCheck('admin', 'reception'), signPresenceByStaff);
router.post('/sign-out-by-staff', protect, roleCheck('admin', 'reception'), signOutByStaff);
router.get('/my-presence', protect, roleCheck('teacher'), getPresence);
router.get('/presence', protect, roleCheck('admin', 'reception', 'supervisor'), getPresence);
router.get('/basic-list', protect, roleCheck('admin', 'reception', 'supervisor'), getTeachersBasic);

// CRUD
router
  .route('/')
  .get(protect, roleCheck('admin'), getTeachers)
  .post(protect, roleCheck('admin'), createTeacher);

router
  .route('/:id')
  .get(protect, roleCheck('admin', 'teacher'), getTeacher)
  .put(protect, roleCheck('admin'), updateTeacher)
  .delete(protect, roleCheck('admin'), deleteTeacher);

module.exports = router;
