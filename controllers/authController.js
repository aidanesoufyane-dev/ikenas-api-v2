/**
 * Controller d'authentification
 * Gère le login, le register, et le profil utilisateur
 */
const User = require('../models/User');
const Student = require('../models/Student');
const School = require('../models/School');
const { asyncHandler } = require('../utils/helpers');
const fs = require('fs');
const path = require('path');

const AVATAR_PRESETS = [
  '/uploads/avatars/presets/boy-01.svg',
  '/uploads/avatars/presets/girl-01.svg',
];

const isPresetAvatar = (avatarPath = '') => AVATAR_PRESETS.includes(String(avatarPath || ''));

const safeDeleteUserAvatarFile = (avatarPath) => {
  const normalized = String(avatarPath || '').trim();
  if (!normalized) return;

  // Only delete user-uploaded avatars, never built-in presets.
  if (!normalized.startsWith('/uploads/avatars/') || normalized.startsWith('/uploads/avatars/presets/')) {
    return;
  }

  const oldPath = path.join(__dirname, '..', normalized);
  if (fs.existsSync(oldPath)) {
    fs.unlinkSync(oldPath);
  }
};

const getParentChildrenPayload = async (parentUserId) => {
  const children = await Student.find({ parentUser: parentUserId })
    .populate('user', 'firstName lastName email avatar')
    .populate('classe', 'name level')
    .sort({ classOrder: 1, createdAt: 1, _id: 1 });

  return children;
};

const getSchoolBrandingPayload = async (schoolId) => {
  if (!schoolId) return null;

  const school = await School.findOne({ _id: schoolId, isActive: true })
    .select('nom logo showLogoInSidebar');

  if (!school) return null;

  return {
    id: school._id,
    nom: school.nom,
    logo: school.logo,
    showLogoInSidebar: Boolean(school.showLogoInSidebar),
  };
};

/**
 * @desc    Connexion utilisateur
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Vérification des champs
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email et mot de passe requis.',
    });
  }

  // Recherche de l'utilisateur avec le mot de passe
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Identifiants invalides.',
    });
  }

  // Vérification du mot de passe
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: 'Identifiants invalides.',
    });
  }

  // Vérifier si le compte est actif
  if (!user.isActive) {
    return res.status(401).json({
      success: false,
      message: 'Compte désactivé. Contactez l\'administrateur.',
    });
  }

  if (user.role !== 'super_admin' && !user.school) {
    return res.status(400).json({
      success: false,
      message: 'Compte invalide: ecole_id absent. Contactez le Super Admin.',
    });
  }

  // Générer le token
  const token = user.generateToken();

  const parentStudents = user.role === 'parent'
    ? await getParentChildrenPayload(user._id)
    : [];

  const schoolBranding = user.role === 'super_admin'
    ? null
    : await getSchoolBrandingPayload(user.school);

  res.status(200).json({
    success: true,
    token,
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      school: user.school || null,
      supervisorLevels: user.supervisorLevels || [],
      fullName: user.fullName,
      avatar: user.avatar,
      parentStudents,
      schoolBranding,
    },
  });
});

/**
 * @desc    Créer un utilisateur (admin uniquement)
 * @route   POST /api/auth/register
 * @access  Private/Admin
 */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, role, phone, school } = req.body;

  // Vérifier si l'email existe déjà
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({
      success: false,
      message: 'Cet email est déjà utilisé.',
    });
  }

  let userSchoolId = school || req.effectiveSchoolId || null;

  if (req.user.role !== 'super_admin') {
    userSchoolId = req.user.school;
  }

  const isNewSuperAdmin = (role || 'student') === 'super_admin';
  if (!isNewSuperAdmin && !userSchoolId) {
    return res.status(400).json({
      success: false,
      message: 'ecole_id est requis pour creer cet utilisateur.',
    });
  }

  if (userSchoolId) {
    const schoolExists = await School.findOne({ _id: userSchoolId, isActive: true });
    if (!schoolExists) {
      return res.status(404).json({
        success: false,
        message: 'Ecole introuvable ou inactive.',
      });
    }
  }

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role: role || 'student',
    phone,
    school: isNewSuperAdmin ? null : userSchoolId,
  });

  res.status(201).json({
    success: true,
    data: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      school: user.school || null,
      avatar: user.avatar,
    },
  });
});

/**
 * @desc    Récupérer le profil connecté
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return res.status(404).json({ success: false, message: 'Utilisateur non trouvé.' });
  }

  const parentStudents = user.role === 'parent'
    ? await getParentChildrenPayload(user._id)
    : [];

  const brandingSchoolId = req.effectiveSchoolId || user.school || null;
  const schoolBranding = await getSchoolBrandingPayload(brandingSchoolId);

  const userData = user.toObject();
  userData.parentStudents = parentStudents;
  userData.effectiveSchoolId = req.effectiveSchoolId || user.school || null;
  userData.schoolBranding = schoolBranding;

  res.status(200).json({
    success: true,
    data: userData,
  });
});

/**
 * @desc    Lister les avatars predefinis
 * @route   GET /api/auth/avatar-presets
 * @access  Private
 */
const getAvatarPresets = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: AVATAR_PRESETS,
  });
});

/**
 * @desc    Mettre a jour l'avatar de l'utilisateur connecte
 * @route   PUT /api/auth/avatar
 * @access  Private
 */
const updateMyAvatar = asyncHandler(async (req, res) => {
  const presetAvatar = String(req.body?.presetAvatar || '').trim();
  const hasPreset = Boolean(presetAvatar);
  const hasFile = Boolean(req.file);

  if (!hasPreset && !hasFile) {
    return res.status(400).json({
      success: false,
      message: 'Aucun avatar fourni. Choisissez un preset ou envoyez un fichier.',
    });
  }

  if (hasPreset && hasFile) {
    return res.status(400).json({
      success: false,
      message: 'Veuillez choisir soit un preset, soit un fichier.',
    });
  }

  if (hasPreset && !isPresetAvatar(presetAvatar)) {
    return res.status(400).json({
      success: false,
      message: 'Avatar preset invalide.',
    });
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Utilisateur non trouve.' });
  }

  safeDeleteUserAvatarFile(user.avatar);

  const avatarPath = hasPreset
    ? presetAvatar
    : `/uploads/avatars/${req.file.filename}`;

  user.avatar = avatarPath;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    data: {
      avatar: avatarPath,
      user,
    },
  });
});

/**
 * @desc    Mettre à jour le mot de passe
 * @route   PUT /api/auth/update-password
 * @access  Private (any authenticated user)
 */
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Mot de passe actuel et nouveau mot de passe requis.',
    });
  }

  const user = await User.findById(req.user.id).select('+password');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return res.status(400).json({
      success: false,
      message: 'Mot de passe actuel incorrect.',
    });
  }

  user.password = newPassword;
  await user.save();

  const token = user.generateToken();

  res.status(200).json({
    success: true,
    token,
    message: 'Mot de passe mis à jour avec succès.',
  });
});

/**
 * @desc    Enregistrer / mettre à jour le token FCM du device
 * @route   POST /api/auth/fcm-token
 * @access  Private
 */
const updateFcmToken = asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;

  if (!fcmToken) {
    return res.status(400).json({ success: false, message: 'fcmToken requis.' });
  }

  const user = await User.findById(req.user.id);
  if (!user.fcmTokens) user.fcmTokens = [];

  if (!user.fcmTokens.includes(fcmToken)) {
    if (user.fcmTokens.length >= 5) user.fcmTokens.shift();
    user.fcmTokens.push(fcmToken);
    await user.save();
  }

  res.status(200).json({ success: true, message: 'Token FCM enregistré.' });
});

/**
 * @desc    Mettre à jour le profil (phone, avatarIndex)
 * @route   PUT /api/auth/profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { phone, avatarIndex } = req.body;

  const updates = {};
  if (phone !== undefined) updates.phone = String(phone).trim();
  if (avatarIndex !== undefined && avatarIndex !== null) {
    updates.avatarIndex = Number(avatarIndex);
  }

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { $set: updates },
    { new: true, runValidators: false }
  );

  res.status(200).json({
    success: true,
    data: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      phone: user.phone,
      avatar: user.avatar,
      avatarIndex: user.avatarIndex,
      fullName: user.fullName,
    },
  });
});

module.exports = {
  login,
  register,
  getMe,
  getAvatarPresets,
  updateMyAvatar,
  updatePassword,
  updateFcmToken,
  updateProfile,
};
