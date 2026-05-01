/**
 * Utilitaires backend
 * Fonctions helpers réutilisables
 */

/**
 * Wrapper async pour éviter les try/catch dans chaque controller
 * @param {Function} fn - Fonction async du controller
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Construire une réponse paginée standardisée
 * @param {Object} query - Query Mongoose
 * @param {number} page - Numéro de page
 * @param {number} limit - Nombre d'éléments par page
 */
const paginate = async (model, query = {}, page = 1, limit = 20, populate = '', sort = '-createdAt') => {
  const skip = (page - 1) * limit;
  const total = await model.countDocuments(query);
  const data = await model
    .find(query)
    .populate(populate)
    .sort(sort)
    .skip(skip)
    .limit(limit);

  return {
    data,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Obtenir la date du jour à minuit (pour les comparaisons de dates)
 */
const getTodayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const getTodayEnd = () => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return today;
};

module.exports = {
  asyncHandler,
  paginate,
  getTodayStart,
  getTodayEnd,
};
