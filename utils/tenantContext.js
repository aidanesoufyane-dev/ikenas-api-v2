const { AsyncLocalStorage } = require('async_hooks');

const tenantContextStorage = new AsyncLocalStorage();

const requestContext = (req, res, next) => {
  tenantContextStorage.run({}, () => next());
};

const setTenantContext = (patch = {}) => {
  const store = tenantContextStorage.getStore();
  if (!store) return;

  Object.assign(store, patch);
};

const getTenantContext = () => {
  return tenantContextStorage.getStore() || null;
};

module.exports = {
  requestContext,
  setTenantContext,
  getTenantContext,
};
