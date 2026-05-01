require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const School = require('../models/School');

const loadAllModels = () => {
  const modelsDir = path.join(__dirname, '..', 'models');
  const files = fs.readdirSync(modelsDir).filter((file) => file.endsWith('.js'));

  for (const file of files) {
    const fullPath = path.join(modelsDir, file);
    require(fullPath);
  }
};

const main = async () => {
  await connectDB();
  loadAllModels();

  const defaultSchoolName = process.env.DEFAULT_SCHOOL_NAME || 'Ecole Principale';
  const defaultSchoolEmail = process.env.DEFAULT_SCHOOL_EMAIL || 'ecole.principale@example.com';

  let school = await School.findOne({ email: defaultSchoolEmail });
  if (!school) {
    school = await School.create({
      nom: defaultSchoolName,
      email: defaultSchoolEmail,
      adresse: process.env.DEFAULT_SCHOOL_ADDRESS || '',
      telephone: process.env.DEFAULT_SCHOOL_PHONE || '',
    });
    console.log(`Ecole par defaut creee: ${school.nom}`);
  } else {
    console.log(`Ecole par defaut trouvee: ${school.nom}`);
  }

  const modelNames = mongoose.modelNames();

  for (const modelName of modelNames) {
    if (modelName === 'School') continue;

    const model = mongoose.model(modelName);
    const schemaPaths = Object.keys(model.schema.paths || {});
    if (!schemaPaths.includes('school')) continue;

    const filter = { school: { $exists: false } };

    if (modelName === 'User') {
      filter.role = { $ne: 'super_admin' };
    }

    const result = await model.updateMany(filter, { $set: { school: school._id } });
    if (result.modifiedCount > 0) {
      console.log(`${modelName}: ${result.modifiedCount} documents migres.`);
    }
  }

  console.log('Migration multi-ecole terminee.');
  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error('Erreur migration multi-ecole:', error);
  await mongoose.connection.close();
  process.exit(1);
});
