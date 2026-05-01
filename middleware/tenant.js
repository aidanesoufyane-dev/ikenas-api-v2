const mongoose = require('mongoose');
const School = require('../models/School');
const { setTenantContext } = require('../utils/tenantContext');

const getSelectedSchoolIdFromRequest = (req) => {
  const candidate = req.headers['x-school-id'] || req.headers['x-ecole-id'] || req.query.schoolId;
  if (!candidate) return null;

  const normalized = String(candidate).trim();
  if (!normalized) return null;
  return normalized;
};

const attachTenantToRequest = async (req, res, next) => {
  if (!req.user) {
    return next();
  }

  const selectedSchoolId = getSelectedSchoolIdFromRequest(req);
  const userSchoolId = req.user?.school ? String(req.user.school) : null;

  if (selectedSchoolId && !mongoose.Types.ObjectId.isValid(selectedSchoolId)) {
    return res.status(400).json({
      success: false,
      message: 'ecole_id selectionne invalide.',
    });
  }

  if (req.user.role !== 'super_admin') {
    if (!userSchoolId) {
      return res.status(400).json({
        success: false,
        message: 'ecole_id absent sur votre compte.',
      });
    }

    if (selectedSchoolId && selectedSchoolId !== userSchoolId) {
      return res.status(403).json({
        success: false,
        message: 'Acces refuse: vous ne pouvez pas changer d\'ecole.',
      });
    }
  }

  const effectiveSchoolId = req.user.role === 'super_admin'
    ? (selectedSchoolId || null)
    : userSchoolId;

  if (req.user.role === 'super_admin' && selectedSchoolId) {
    const school = await School.findOne({ _id: selectedSchoolId, isActive: true });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'Ecole selectionnee introuvable ou inactive.',
      });
    }
  }

  req.selectedSchoolId = selectedSchoolId;
  req.effectiveSchoolId = effectiveSchoolId;

  setTenantContext({
    userId: String(req.user._id),
    role: req.user.role,
    schoolId: userSchoolId,
    selectedSchoolId,
    effectiveSchoolId,
  });

  return next();
};

module.exports = {
  attachTenantToRequest,
};
