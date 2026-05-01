const mongoose = require('mongoose');
const School = require('../models/School');
const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');

const parseBooleanInput = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on';
  }
  if (typeof value === 'number') return value === 1;
  return false;
};

const listSchools = asyncHandler(async (req, res) => {
  const includeInactive = String(req.query.includeInactive || 'false') === 'true';
  const query = includeInactive ? {} : { isActive: true };

  const schools = await School.find(query).sort({ nom: 1, createdAt: -1 });

  res.status(200).json({ success: true, data: schools });
});

const getSchool = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'ID ecole invalide.' });
  }

  const school = await School.findById(req.params.id);
  if (!school) {
    return res.status(404).json({ success: false, message: 'Ecole non trouvee.' });
  }

  res.status(200).json({ success: true, data: school });
});

const createSchool = asyncHandler(async (req, res) => {
  const {
    nom,
    adresse,
    telephone,
    email,
    showLogoInSidebar,
    adminEmail,
    adminPassword,
  } = req.body;

  if (!adminEmail || !adminPassword) {
    return res.status(400).json({
      success: false,
      message: 'Le login admin de l\'ecole est obligatoire (email, mot de passe).',
    });
  }

  const existingAdmin = await User.findOne({ email: String(adminEmail).trim().toLowerCase() });
  if (existingAdmin) {
    return res.status(400).json({
      success: false,
      message: 'Cet email admin est deja utilise.',
    });
  }

  let school;

  try {
    const logoPath = req.file ? `/uploads/schools/${req.file.filename}` : '';

    school = await School.create({
      nom,
      adresse,
      telephone,
      email,
      logo: logoPath,
      showLogoInSidebar: parseBooleanInput(showLogoInSidebar),
    });

    const schoolAdmin = await User.create({
      firstName: 'Admin',
      lastName: String(nom || 'Ecole').trim(),
      email: String(adminEmail).trim().toLowerCase(),
      password: String(adminPassword),
      role: 'admin',
      school: school._id,
    });

    return res.status(201).json({
      success: true,
      data: {
        school,
        schoolAdmin: {
          id: schoolAdmin._id,
          firstName: schoolAdmin.firstName,
          lastName: schoolAdmin.lastName,
          email: schoolAdmin.email,
          role: schoolAdmin.role,
          school: schoolAdmin.school,
        },
      },
    });
  } catch (error) {
    if (school?._id) {
      await School.findByIdAndDelete(school._id);
    }

    throw error;
  }
});

const updateSchool = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'ID ecole invalide.' });
  }

  const school = await School.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!school) {
    return res.status(404).json({ success: false, message: 'Ecole non trouvee.' });
  }

  res.status(200).json({ success: true, data: school });
});

const deleteSchool = asyncHandler(async (req, res) => {
  const confirmText = String(req.body?.confirmText || '').trim().toLowerCase();
  if (confirmText !== 'delete') {
    return res.status(400).json({
      success: false,
      message: 'Confirmation invalide. Tapez "delete" pour confirmer la suppression.',
    });
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'ID ecole invalide.' });
  }

  const school = await School.findById(req.params.id);
  if (!school) {
    return res.status(404).json({ success: false, message: 'Ecole non trouvee.' });
  }

  school.isActive = false;
  school.deletedAt = new Date();
  await school.save();

  res.status(200).json({
    success: true,
    message: 'Ecole desactivee (soft delete) avec succes.',
  });
});

module.exports = {
  listSchools,
  getSchool,
  createSchool,
  updateSchool,
  deleteSchool,
};
