const express = require('express');
const router = express.Router();
const {
  listSchools,
  getSchool,
  createSchool,
  updateSchool,
  deleteSchool,
} = require('../controllers/schoolController');
const { protect, roleCheck } = require('../middleware/auth');
const { uploadSchoolLogo } = require('../middleware/upload');

router.use(protect, roleCheck('super_admin'));

router.route('/')
  .get(listSchools)
  .post(uploadSchoolLogo.single('logo'), createSchool);

router.route('/:id')
  .get(getSchool)
  .put(updateSchool)
  .delete(deleteSchool);

module.exports = router;
