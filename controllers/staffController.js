const Staff = require('../models/Staff');
const User = require('../models/User');
const { asyncHandler } = require('../utils/helpers');
const { normalizeSupervisorLevels } = require('../utils/supervisorScope');

const LOGIN_ROLE_BY_TYPE = {
  cashier: 'cashier',
  supervisor: 'supervisor',
  reception: 'reception',
  pedagogical_director: 'pedagogical_director',
};

const resolveSupervisorLevelsForStaff = ({ type, supervisorLevels }) => {
  if (type !== 'supervisor') {
    return [];
  }

  const normalized = normalizeSupervisorLevels(supervisorLevels || []);
  if (normalized.length === 0) {
    const error = new Error('Veuillez selectionner au moins un niveau pour le surveillant general.');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

const ensureEmailAvailableForStaffLogin = async ({ email, currentStaffId = null, excludedUserId = null }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail });

  if (!existingUser) {
    return normalizedEmail;
  }

  if (excludedUserId && String(existingUser._id) === String(excludedUserId)) {
    return normalizedEmail;
  }

  if (existingUser.isActive) {
    const error = new Error('Cet email est déjà utilisé.');
    error.statusCode = 400;
    throw error;
  }

  const staffFilter = {
    user: existingUser._id,
    isActive: true,
  };

  if (currentStaffId) {
    staffFilter._id = { $ne: currentStaffId };
  }

  const activeStaffLinkedToUser = await Staff.findOne(staffFilter).select('_id');
  if (activeStaffLinkedToUser) {
    const error = new Error('Cet email est déjà utilisé.');
    error.statusCode = 400;
    throw error;
  }

  await User.findByIdAndDelete(existingUser._id);
  return normalizedEmail;
};

const ensureEmployeeIdAvailable = async ({ employeeId, currentStaffId = null }) => {
  const normalizedEmployeeId = String(employeeId || '').trim();
  if (!normalizedEmployeeId) {
    return normalizedEmployeeId;
  }

  const existingStaff = await Staff.findOne({ employeeId: normalizedEmployeeId });
  if (!existingStaff) {
    return normalizedEmployeeId;
  }

  if (currentStaffId && String(existingStaff._id) === String(currentStaffId)) {
    return normalizedEmployeeId;
  }

  if (existingStaff.isActive) {
    const error = new Error('Ce matricule est déjà utilisé.');
    error.statusCode = 400;
    throw error;
  }

  if (existingStaff.user) {
    const linkedUser = await User.findById(existingStaff.user).select('_id isActive');
    if (linkedUser && linkedUser.isActive) {
      const error = new Error('Ce matricule est déjà utilisé.');
      error.statusCode = 400;
      throw error;
    }
    if (linkedUser) {
      await User.findByIdAndDelete(linkedUser._id);
    }
  }

  await Staff.findByIdAndDelete(existingStaff._id);
  return normalizedEmployeeId;
};

const createStaff = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    employeeId,
    phone,
    type,
    hasLogin,
    email,
    password,
    notes,
    supervisorLevels,
  } = req.body;

  const loginRequired = Boolean(hasLogin);
  let user = null;

  const normalizedEmployeeId = await ensureEmployeeIdAvailable({ employeeId });
  const normalizedSupervisorLevels = resolveSupervisorLevelsForStaff({ type, supervisorLevels });

  if (loginRequired) {
    const role = LOGIN_ROLE_BY_TYPE[type];
    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Ce type de staff ne supporte pas de connexion pour le moment.',
      });
    }

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe sont requis pour un staff avec connexion.',
      });
    }

    const normalizedEmail = await ensureEmailAvailableForStaffLogin({ email });

    user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      password,
      phone,
      role,
      supervisorLevels: role === 'supervisor' ? normalizedSupervisorLevels : [],
    });
  }

  const staff = await Staff.create({
    firstName,
    lastName,
    employeeId: normalizedEmployeeId,
    phone,
    type,
    hasLogin: loginRequired,
    user: user?._id || null,
    notes,
    supervisorLevels: normalizedSupervisorLevels,
  });

  const populated = await Staff.findById(staff._id).populate('user', 'email role isActive supervisorLevels');
  res.status(201).json({ success: true, data: populated });
});

const getStaff = asyncHandler(async (req, res) => {
  const query = { isActive: true };
  if (req.query.type) {
    query.type = req.query.type;
  }

  const staff = await Staff.find(query)
    .populate('user', 'email role isActive supervisorLevels')
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, data: staff });
});

const updateStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff || !staff.isActive) {
    return res.status(404).json({ success: false, message: 'Staff introuvable.' });
  }

  const {
    firstName,
    lastName,
    employeeId,
    phone,
    type,
    hasLogin,
    email,
    password,
    notes,
    supervisorLevels,
  } = req.body;

  const normalizedEmployeeId = await ensureEmployeeIdAvailable({
    employeeId: employeeId ?? staff.employeeId,
    currentStaffId: staff._id,
  });

  const nextType = type || staff.type;
  const nextHasLogin = hasLogin !== undefined ? Boolean(hasLogin) : staff.hasLogin;
  const nextSupervisorLevels = resolveSupervisorLevelsForStaff({
    type: nextType,
    supervisorLevels: supervisorLevels ?? staff.supervisorLevels,
  });

  let linkedUser = staff.user ? await User.findById(staff.user) : null;

  if (nextHasLogin) {
    const role = LOGIN_ROLE_BY_TYPE[nextType];
    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Ce type de staff ne supporte pas de connexion pour le moment.',
      });
    }

    const targetEmail = email || linkedUser?.email;
    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email requis pour un staff avec connexion.',
      });
    }

    const normalizedEmail = await ensureEmailAvailableForStaffLogin({
      email: targetEmail,
      currentStaffId: staff._id,
      excludedUserId: linkedUser?._id || null,
    });

    if (!linkedUser) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Mot de passe requis pour créer un accès connexion.',
        });
      }

      linkedUser = await User.create({
        firstName: firstName || staff.firstName,
        lastName: lastName || staff.lastName,
        email: normalizedEmail,
        password,
        phone: phone ?? staff.phone,
        role,
        supervisorLevels: role === 'supervisor' ? nextSupervisorLevels : [],
      });
      staff.user = linkedUser._id;
    } else {
      linkedUser.firstName = firstName || staff.firstName;
      linkedUser.lastName = lastName || staff.lastName;
      linkedUser.phone = phone ?? staff.phone;
      linkedUser.email = normalizedEmail;
      linkedUser.role = role;
      linkedUser.supervisorLevels = role === 'supervisor' ? nextSupervisorLevels : [];
      linkedUser.isActive = true;

      if (password) {
        linkedUser.password = password;
      }

      await linkedUser.save();
    }
  } else if (linkedUser) {
    linkedUser.isActive = false;
    await linkedUser.save();
  }

  staff.firstName = firstName ?? staff.firstName;
  staff.lastName = lastName ?? staff.lastName;
  staff.employeeId = normalizedEmployeeId;
  staff.phone = phone ?? staff.phone;
  staff.type = nextType;
  staff.hasLogin = nextHasLogin;
  staff.notes = notes ?? staff.notes;
  staff.supervisorLevels = nextSupervisorLevels;

  await staff.save();

  const populated = await Staff.findById(staff._id).populate('user', 'email role isActive supervisorLevels');
  res.status(200).json({ success: true, data: populated, message: 'Staff mis à jour avec succès.' });
});

const deleteStaff = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) {
    return res.status(404).json({ success: false, message: 'Staff introuvable.' });
  }

  if (staff.user) {
    await User.findByIdAndDelete(staff.user);
  }

  await Staff.findByIdAndDelete(staff._id);

  res.status(200).json({ success: true, message: 'Staff supprimé définitivement.' });
});

module.exports = {
  createStaff,
  getStaff,
  updateStaff,
  deleteStaff,
};