/**
 * Configuration de la connexion MongoDB
 * Utilise Mongoose pour la connexion et la gestion de la base de données
 */
const mongoose = require('mongoose');
const tenantPlugin = require('../plugins/tenantPlugin');

let tenantModelPatchApplied = false;

const patchMongooseModelFactory = () => {
  if (tenantModelPatchApplied) return;

  const originalModelFactory = mongoose.model.bind(mongoose);

  mongoose.model = function patchedModel(name, schema, collection, options) {
    if (schema && schema.__tenantPatched !== true) {
      schema.plugin(tenantPlugin, { modelName: name });
      schema.__tenantPatched = true;
    }

    return originalModelFactory(name, schema, collection, options);
  };

  tenantModelPatchApplied = true;
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB connecté: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Erreur de connexion MongoDB: ${error.message}`);
    process.exit(1);
  }
};

// Apply model patch immediately when this module is loaded.
patchMongooseModelFactory();

module.exports = connectDB;
