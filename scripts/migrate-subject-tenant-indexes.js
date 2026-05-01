require('dotenv').config();
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const Subject = require('../models/Subject');

const dropIndexIfExists = async (indexName) => {
  try {
    await Subject.collection.dropIndex(indexName);
    console.log(`Index supprime: ${indexName}`);
  } catch (error) {
    if (error.codeName === 'IndexNotFound') {
      console.log(`Index absent (ok): ${indexName}`);
      return;
    }
    throw error;
  }
};

const main = async () => {
  await connectDB();

  const existingIndexes = await Subject.collection.indexes();
  console.log('Indexes actuels Subject:');
  existingIndexes.forEach((idx) => console.log(`- ${idx.name}`));

  // Legacy global unique indexes that break multi-tenant subject creation.
  await dropIndexIfExists('name_1');
  await dropIndexIfExists('code_1');

  // Empty string codes should be treated as missing to work with sparse unique index.
  const cleaned = await Subject.updateMany(
    { code: '' },
    { $unset: { code: 1 } }
  );
  if (cleaned.modifiedCount > 0) {
    console.log(`Codes vides nettoyes: ${cleaned.modifiedCount}`);
  }

  // Ensure model-defined indexes are applied.
  await Subject.syncIndexes();

  const finalIndexes = await Subject.collection.indexes();
  console.log('Indexes finaux Subject:');
  finalIndexes.forEach((idx) => console.log(`- ${idx.name}`));

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error('Erreur migration index Subject:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});
