require('dotenv').config();
const connectDB = require('../config/db');
const mongoose = require('mongoose');

const Class = require('../models/Class');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Staff = require('../models/Staff');
const Transport = require('../models/Transport');

const dropIndexIfExists = async (collection, indexName) => {
  try {
    await collection.dropIndex(indexName);
    console.log(`Index supprime: ${collection.collectionName}.${indexName}`);
  } catch (error) {
    if (error.codeName === 'IndexNotFound') {
      console.log(`Index absent (ok): ${collection.collectionName}.${indexName}`);
      return;
    }
    throw error;
  }
};

const printIndexes = async (label, model) => {
  const indexes = await model.collection.indexes();
  console.log(`Indexes ${label}:`);
  indexes.forEach((idx) => console.log(`- ${idx.name}`));
};

const main = async () => {
  await connectDB();

  await printIndexes('Class (avant)', Class);
  await printIndexes('Student (avant)', Student);
  await printIndexes('Teacher (avant)', Teacher);
  await printIndexes('Staff (avant)', Staff);
  await printIndexes('Transport (avant)', Transport);

  // Drop legacy global unique indexes that block multi-tenant duplicates.
  await dropIndexIfExists(Class.collection, 'name_1');
  await dropIndexIfExists(Student.collection, 'matricule_1');
  await dropIndexIfExists(Teacher.collection, 'employeeId_1');
  await dropIndexIfExists(Staff.collection, 'employeeId_1');
  await dropIndexIfExists(Transport.collection, 'matricule_1');

  await Class.syncIndexes();
  await Student.syncIndexes();
  await Teacher.syncIndexes();
  await Staff.syncIndexes();
  await Transport.syncIndexes();

  await printIndexes('Class (apres)', Class);
  await printIndexes('Student (apres)', Student);
  await printIndexes('Teacher (apres)', Teacher);
  await printIndexes('Staff (apres)', Staff);
  await printIndexes('Transport (apres)', Transport);

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error('Erreur migration indexes multi-tenant:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});
