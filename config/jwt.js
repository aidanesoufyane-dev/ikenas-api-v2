const FALLBACK_JWT_SECRET = 'ikenas-dev-jwt-secret-change-me';
const FALLBACK_JWT_EXPIRE = '7d';

const getJwtConfig = () => {
  const secret = process.env.JWT_SECRET || FALLBACK_JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRE || FALLBACK_JWT_EXPIRE;

  return {
    secret,
    expiresIn,
    isFallback: !process.env.JWT_SECRET,
  };
};

module.exports = {
  getJwtConfig,
};