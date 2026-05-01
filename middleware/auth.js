/**
 * Middleware d'authentification et d'autorisation
 * - protect : vérifie le JWT et attache l'utilisateur à la requête
 * - roleCheck : vérifie que l'utilisateur a le bon rôle
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtConfig } = require('../config/jwt');
const { attachTenantToRequest } = require('./tenant');

const isSupervisorEquivalent = (role) => role === 'supervisor' || role === 'pedagogical_director';

/**
 * Middleware de protection des routes
 * Vérifie la présence et la validité du token JWT
 */
const protect = async (req, res, next) => {
  let token;

  // Récupérer le token depuis le header Authorization
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Accès non autorisé. Token manquant.',
    });
  }

  try {
    const { secret } = getJwtConfig();

    // Vérifier et décoder le token
    const decoded = jwt.verify(token, secret);

    // Attacher l'utilisateur à la requête
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non trouvé.',
      });
    }

    if (!req.user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Compte désactivé. Contactez l\'administrateur.',
      });
    }

    await attachTenantToRequest(req, res, next);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token invalide ou expiré.',
    });
  }
};

/**
 * Middleware de vérification des rôles
 * @param  {...string} roles - Rôles autorisés (admin, teacher, student)
 */
const roleCheck = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non authentifié.',
      });
    }

    if (req.user.role === 'super_admin') {
      return next();
    }

    const requestedPath = String(req.originalUrl || req.baseUrl || '').toLowerCase();
    const isPaymentsRoute = requestedPath.includes('/payments');

    const effectiveRoles = [...roles];

    if (roles.includes('admin') && !isPaymentsRoute && !effectiveRoles.includes('supervisor')) {
      effectiveRoles.push('supervisor');
    }

    if (effectiveRoles.some(isSupervisorEquivalent) && !effectiveRoles.includes('pedagogical_director')) {
      effectiveRoles.push('pedagogical_director');
    }

    if (effectiveRoles.includes('pedagogical_director') && !effectiveRoles.includes('supervisor')) {
      effectiveRoles.push('supervisor');
    }

    if (!effectiveRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Accès refusé. Rôle "${req.user.role}" non autorisé pour cette action.`,
      });
    }

    next();
  };
};

module.exports = { protect, roleCheck };
