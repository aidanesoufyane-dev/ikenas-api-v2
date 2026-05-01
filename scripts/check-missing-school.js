require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../config/db');

const loadAllModels = () => {
  const modelsDir = path.join(__dirname, '..', 'models');
  const files = fs.readdirSync(modelsDir).filter((file) => file.endsWith('.js'));

  for (const file of files) {
    require(path.join(modelsDir, file));
  }
};

const main = async () => {
  await connectDB();
  loadAllModels();

  const modelNames = mongoose.modelNames();
  const remaining = [];

  for (const modelName of modelNames) {
    if (modelName === 'School') continue;

    const model = mongoose.model(modelName);
    if (!model.schema.path('school')) continue;

    const filter = { school: { $exists: false } };
    if (modelName === 'User') {
      filter.role = { $ne: 'super_admin' };
    }

    const count = await model.countDocuments(filter);
    if (count > 0) {
      remaining.push({ model: modelName, count });
    }
  }

  if (remaining.length === 0) {
    console.log('OK: aucun document sans school.');
  } else {
    console.log('Restants sans school:');
    for (const item of remaining) {
      console.log(`- ${item.model}: ${item.count}`);
    }
  }

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error('Erreur check missing school:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});
