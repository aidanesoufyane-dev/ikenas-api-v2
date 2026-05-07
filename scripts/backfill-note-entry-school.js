require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const NoteEntry = require('../models/NoteEntry');
require('../models/NoteSheet');
require('../models/Student');

const batchSize = Number(process.env.BATCH_SIZE || 500);
const dryRun = String(process.env.DRY_RUN || '') === '1';

const resolveSchoolId = (entry) => {
  const sheetSchool = entry.sheet && entry.sheet.school ? String(entry.sheet.school) : null;
  if (sheetSchool) return sheetSchool;

  const studentSchool = entry.student && entry.student.school ? String(entry.student.school) : null;
  if (studentSchool) return studentSchool;

  return null;
};

const main = async () => {
  await connectDB();

  let processed = 0;
  let updated = 0;
  let unresolved = 0;
  let lastId = null;

  while (true) {
    const filter = { school: { $exists: false } };
    if (lastId) {
      filter._id = { $gt: lastId };
    }

    const entries = await NoteEntry.find(filter)
      .sort({ _id: 1 })
      .limit(batchSize)
      .populate({ path: 'sheet', select: 'school' })
      .populate({ path: 'student', select: 'school' })
      .lean();

    if (entries.length === 0) break;

    lastId = entries[entries.length - 1]._id;

    const ops = [];
    for (const entry of entries) {
      const schoolId = resolveSchoolId(entry);
      if (!schoolId) {
        unresolved += 1;
        continue;
      }

      ops.push({
        updateOne: {
          filter: { _id: entry._id, school: { $exists: false } },
          update: { $set: { school: schoolId } },
        },
      });
    }

    if (!dryRun && ops.length > 0) {
      await NoteEntry.bulkWrite(ops);
    }

    processed += entries.length;
    updated += ops.length;

    console.log(
      `Batch processed: ${entries.length} | total: ${processed} | updated: ${updated} | unresolved: ${unresolved}`
    );
  }

  console.log('Backfill complete.');
  console.log(`Dry run: ${dryRun ? 'yes' : 'no'}`);
  console.log(`Total processed: ${processed}`);
  console.log(`Total updated: ${updated}`);
  console.log(`Total unresolved: ${unresolved}`);

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error('Erreur backfill note entries:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});
