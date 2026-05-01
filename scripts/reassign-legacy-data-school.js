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
    require(path.join(modelsDir, file));
  }
};

const findSchoolByName = async (schoolName) => {
  return School.findOne({
    nom: { $regex: `^${String(schoolName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    isActive: true,
  });
};

const main = async () => {
  await connectDB();
  loadAllModels();

  const targetSchoolName = process.env.TARGET_SCHOOL_NAME || 'Groupe Riad Al Irfane';
  const sourceSchoolName = process.env.SOURCE_SCHOOL_NAME || 'Ecole Principale';

  const targetSchool = await findSchoolByName(targetSchoolName);
  if (!targetSchool) {
    throw new Error(`Ecole cible introuvable: ${targetSchoolName}`);
  }

  const sourceSchool = await findSchoolByName(sourceSchoolName);

  console.log(`Ecole cible: ${targetSchool.nom} (${targetSchool._id})`);
  if (sourceSchool) {
    console.log(`Ecole source: ${sourceSchool.nom} (${sourceSchool._id})`);
  } else {
    console.log(`Ecole source non trouvee (${sourceSchoolName}), reaffectation des ecole_id absents uniquement.`);
  }

  const modelNames = mongoose.modelNames();
  const summary = [];

  for (const modelName of modelNames) {
    if (modelName === 'School') continue;

    const model = mongoose.model(modelName);
    if (!model.schema.path('school')) continue;

    const updates = [];

    const missingFilter = { school: { $exists: false } };
    if (modelName === 'User') {
      missingFilter.role = { $ne: 'super_admin' };
    }

    const missingResult = await model.updateMany(missingFilter, {
      $set: { school: targetSchool._id },
    });

    updates.push({ type: 'missing', count: missingResult.modifiedCount || 0 });

    if (sourceSchool) {
      const sourceFilter = { school: sourceSchool._id };
      if (modelName === 'User') {
        sourceFilter.role = { $ne: 'super_admin' };
      }

      const sourceResult = await model.updateMany(sourceFilter, {
        $set: { school: targetSchool._id },
      });

      updates.push({ type: 'source', count: sourceResult.modifiedCount || 0 });
    }

    const totalMoved = updates.reduce((acc, item) => acc + item.count, 0);
    if (totalMoved > 0) {
      summary.push({ modelName, totalMoved, updates });
    }
  }

  if (summary.length === 0) {
    console.log('Aucun document a reaffecter.');
  } else {
    console.log('\nReaffectation terminee:');
    for (const item of summary) {
      console.log(`- ${item.modelName}: ${item.totalMoved} document(s)`);
    }
  }

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error('Erreur reaffectation legacy school:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});
