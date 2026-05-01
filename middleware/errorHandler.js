/**
 * Middleware de gestion centralisée des erreurs
 * Capture toutes les erreurs et retourne une réponse JSON cohérente
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log complet en développement
  if (process.env.NODE_ENV === 'development') {
    console.error('❌ Error:', err);
  }

  // Erreur Mongoose : ID invalide
  if (err.name === 'CastError') {
    error.message = 'Ressource non trouvée.';
    error.statusCode = 404;
  }

  // Erreur Mongoose : Champ unique dupliqué
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue).join(', ');
    error.message = `Valeur dupliquée pour le champ : ${field}`;
    error.statusCode = 400;
  }

  // Erreur Mongoose : Validation
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    error.message = messages.join('. ');
    error.statusCode = 400;
  }

  // Erreur JWT
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Token invalide.';
    error.statusCode = 401;
  }

  // Erreur JWT expiré
  if (err.name === 'TokenExpiredError') {
    error.message = 'Token expiré. Veuillez vous reconnecter.';
    error.statusCode = 401;
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Erreur interne du serveur.',
  });
};

module.exports = errorHandler;
