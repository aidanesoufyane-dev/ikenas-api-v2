const mongoose = require('mongoose');
const { getTenantContext } = require('../utils/tenantContext');

const TENANT_EXCLUDED_MODELS = new Set(['School']);

const buildTenantError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const resolveScope = () => {
  const context = getTenantContext() || {};
  const role = context.role || null;
  const schoolId = context.schoolId ? String(context.schoolId) : null;
  const selectedSchoolId = context.selectedSchoolId ? String(context.selectedSchoolId) : null;

  if (!role) {
    return { skip: true, scopedSchoolId: null, role: null };
  }

  if (role === 'super_admin') {
    return {
      skip: !selectedSchoolId,
      scopedSchoolId: selectedSchoolId,
      role,
    };
  }

  return {
    skip: false,
    scopedSchoolId: schoolId,
    role,
  };
};

const tenantPlugin = (schema, options = {}) => {
  const modelName = options.modelName || '';

  if (TENANT_EXCLUDED_MODELS.has(modelName)) {
    return;
  }

  if (!schema.path('school')) {
    schema.add({
      school: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'School',
        index: true,
      },
    });
  }

  // Keep school immutable to avoid cross-tenant moves by update payloads.
  schema.path('school').immutable(true);

  const applyTenantFilter = function applyTenantFilter(next) {
    const { skip, scopedSchoolId, role } = resolveScope();

    if (skip) return next();

    if (!scopedSchoolId) {
      return next(buildTenantError('Contexte ecole_id manquant pour cette requete.'));
    }

    if (role === 'super_admin') {
      this.where({ school: scopedSchoolId });
      return next();
    }

    const currentConditions = this.getQuery();
    if (currentConditions && currentConditions.school && String(currentConditions.school) !== String(scopedSchoolId)) {
      return next(buildTenantError('Acces refuse: tentative d\'acces a une autre ecole.'));
    }

    this.where({ school: scopedSchoolId });
    return next();
  };

  const tenantQueryHooks = [
    'countDocuments',
    'find',
    'findOne',
    'findOneAndDelete',
    'findOneAndReplace',
    'findOneAndUpdate',
    'replaceOne',
    'updateMany',
    'updateOne',
    'deleteMany',
    'deleteOne',
  ];

  tenantQueryHooks.forEach((hookName) => {
    schema.pre(hookName, applyTenantFilter);
  });

  schema.pre('aggregate', function tenantAggregateHook(next) {
    const { skip, scopedSchoolId } = resolveScope();

    if (skip) return next();

    if (!scopedSchoolId) {
      return next(buildTenantError('Contexte ecole_id manquant pour cette agregation.'));
    }

    const pipeline = this.pipeline();
    const matchStage = { $match: { school: new mongoose.Types.ObjectId(scopedSchoolId) } };

    if (pipeline.length > 0 && pipeline[0].$geoNear) {
      pipeline.splice(1, 0, matchStage);
    } else {
      pipeline.unshift(matchStage);
    }

    return next();
  });

  schema.pre('save', function tenantSaveHook(next) {
    const { skip, scopedSchoolId, role } = resolveScope();

    if (skip) return next();

    if (!scopedSchoolId) {
      return next(buildTenantError('ecole_id est requis pour enregistrer cette ressource.'));
    }

    if (!this.school) {
      this.school = scopedSchoolId;
      return next();
    }

    if (String(this.school) !== String(scopedSchoolId) && role !== 'super_admin') {
      return next(buildTenantError('Acces refuse: cette ressource appartient a une autre ecole.'));
    }

    return next();
  });

  schema.pre('insertMany', function tenantInsertManyHook(next, docs) {
    const { skip, scopedSchoolId } = resolveScope();

    if (skip) return next();

    if (!scopedSchoolId) {
      return next(buildTenantError('ecole_id est requis pour inserer des ressources.'));
    }

    for (const doc of docs || []) {
      if (!doc.school) {
        doc.school = scopedSchoolId;
        continue;
      }

      if (String(doc.school) !== String(scopedSchoolId)) {
        return next(buildTenantError('Acces refuse: insertion dans une autre ecole.'));
      }
    }

    return next();
  });
};

module.exports = tenantPlugin;
