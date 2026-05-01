const Class = require('../models/Class');

const SUPERVISOR_LEVELS = ['primaire', 'college', 'lycee'];

const normalizeEducationLevel = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalized === 'primaire') return 'primaire';
  if (normalized === 'college') return 'college';
  if (normalized === 'lycee') return 'lycee';
  return '';
};

const normalizeSupervisorLevels = (levels = []) => {
  const values = Array.isArray(levels) ? levels : [levels];
  const normalized = values
    .map((value) => normalizeEducationLevel(value))
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  return normalized;
};

const isScopedSupervisor = (user) => String(user?.role || '') === 'supervisor';

const buildLevelRegex = (level) => {
  if (level === 'primaire') return /^primaire$/i;
  if (level === 'college') return /^coll[eè]ge$/i;
  if (level === 'lycee') return /^lyc[eé]e$/i;
  return null;
};

const buildClassLevelMongoFilter = (levels = []) => {
  const regexes = levels
    .map((level) => buildLevelRegex(level))
    .filter(Boolean);

  if (regexes.length === 0) {
    return { _id: null };
  }

  return {
    $or: regexes.map((regex) => ({ level: regex })),
  };
};

const getSupervisorClassScope = async (req) => {
  if (!isScopedSupervisor(req?.user)) {
    return { restricted: false, levels: [], classIds: [] };
  }

  if (req._supervisorClassScope) {
    return req._supervisorClassScope;
  }

  const levels = normalizeSupervisorLevels(req.user?.supervisorLevels || []);
  if (levels.length === 0) {
    req._supervisorClassScope = { restricted: true, levels: [], classIds: [] };
    return req._supervisorClassScope;
  }

  const classDocs = await Class.find({
    isActive: true,
    ...buildClassLevelMongoFilter(levels),
  }).select('_id');

  req._supervisorClassScope = {
    restricted: true,
    levels,
    classIds: classDocs.map((item) => String(item._id)),
  };

  return req._supervisorClassScope;
};

const ensureClassAccessibleForSupervisor = async (req, classId, message = 'Acces refuse a cette classe.') => {
  if (!isScopedSupervisor(req?.user)) return true;

  const scope = await getSupervisorClassScope(req);
  if (!scope.restricted) return true;

  const inScope = scope.classIds.includes(String(classId));
  if (!inScope) {
    const error = new Error(message);
    error.statusCode = 403;
    throw error;
  }

  return true;
};

module.exports = {
  SUPERVISOR_LEVELS,
  normalizeEducationLevel,
  normalizeSupervisorLevels,
  isScopedSupervisor,
  buildClassLevelMongoFilter,
  getSupervisorClassScope,
  ensureClassAccessibleForSupervisor,
};
