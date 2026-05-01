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

const getValuesByPath = (obj, dotPath) => {
  const parts = dotPath.split('.');
  const walk = (current, idx) => {
    if (current == null) return [];
    if (idx >= parts.length) return [current];

    const key = parts[idx];
    if (Array.isArray(current)) {
      return current.flatMap((item) => walk(item, idx));
    }

    return walk(current[key], idx + 1);
  };

  return walk(obj, 0).filter((value) => value != null);
};

const normalizeId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value._id) return String(value._id);
  return String(value);
};

const run = async () => {
  await connectDB();
  loadAllModels();

  const School = mongoose.model('School');
  const schools = await School.find({}).lean();
  const schoolNameById = new Map(schools.map((s) => [String(s._id), s.nom]));

  const modelNames = mongoose.modelNames().filter((name) => name !== 'School');
  const missingSchool = [];
  const perSchoolCounts = {};

  for (const modelName of modelNames) {
    const Model = mongoose.model(modelName);
    if (!Model.schema.path('school')) continue;

    const filter = { school: { $exists: false } };
    if (modelName === 'User') {
      filter.role = { $ne: 'super_admin' };
    }

    const missing = await Model.countDocuments(filter);
    if (missing > 0) {
      missingSchool.push({ model: modelName, count: missing });
    }

    const grouped = await Model.aggregate([
      { $match: modelName === 'User' ? { role: { $ne: 'super_admin' } } : {} },
      { $group: { _id: '$school', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    perSchoolCounts[modelName] = grouped.map((g) => ({
      schoolId: normalizeId(g._id),
      schoolName: schoolNameById.get(normalizeId(g._id)) || 'UNKNOWN',
      count: g.count,
    }));
  }

  const relationChecks = [
    { model: 'Event', refs: ['createdBy', 'attendees.user'] },
    { model: 'Message', refs: ['sender', 'targetUser', 'targetClass'] },
    { model: 'Assignment', refs: ['classe', 'subject', 'teacher'] },
    { model: 'Attendance', refs: ['student', 'recordedBy', 'approvedBy', 'classe', 'subject', 'schedule'] },
    { model: 'Exam', refs: ['classe', 'subject', 'teacher'] },
    { model: 'Student', refs: ['user', 'classe', 'parentUser'] },
    { model: 'Teacher', refs: ['user', 'classes', 'subjects'] },
    { model: 'News', refs: ['author', 'comments.author', 'likes'] },
    { model: 'Notification', refs: ['recipient', 'recipientClass'] },
    { model: 'StudentPayment', refs: ['student', 'classe', 'recordedBy'] },
    { model: 'NoteSheet', refs: ['exam', 'classe', 'subject', 'teacher', 'createdBy'] },
    { model: 'Submission', refs: ['assignment', 'student', 'submittedBy'] },
    { model: 'LeaveRequest', refs: ['teacher'] },
    { model: 'Transport', refs: ['driver'] },
  ];

  const crossSchoolMismatches = [];

  for (const check of relationChecks) {
    const Model = mongoose.models[check.model];
    if (!Model || !Model.schema.path('school')) continue;

    const populates = check.refs.map((refPath) => ({ path: refPath, select: 'school' }));
    const docs = await Model.find({}).populate(populates).lean();

    for (const doc of docs) {
      const docSchool = normalizeId(doc.school);
      if (!docSchool) continue;

      for (const refPath of check.refs) {
        const values = getValuesByPath(doc, refPath);
        for (const value of values) {
          if (!value || typeof value !== 'object') continue;
          if (!('school' in value)) continue;

          const refSchool = normalizeId(value.school);
          if (!refSchool) continue;

          if (refSchool !== docSchool) {
            crossSchoolMismatches.push({
              model: check.model,
              docId: String(doc._id),
              docSchool,
              docSchoolName: schoolNameById.get(docSchool) || 'UNKNOWN',
              refPath,
              refSchool,
              refSchoolName: schoolNameById.get(refSchool) || 'UNKNOWN',
            });
          }
        }
      }
    }
  }

  const output = {
    schools: schools.map((s) => ({ id: String(s._id), nom: s.nom, isActive: s.isActive })),
    missingSchool,
    crossSchoolMismatchesCount: crossSchoolMismatches.length,
    crossSchoolMismatchesSample: crossSchoolMismatches.slice(0, 30),
    keyPerSchoolCounts: {
      Event: perSchoolCounts.Event || [],
      Message: perSchoolCounts.Message || [],
      Assignment: perSchoolCounts.Assignment || [],
      Attendance: perSchoolCounts.Attendance || [],
      News: perSchoolCounts.News || [],
      Student: perSchoolCounts.Student || [],
      Teacher: perSchoolCounts.Teacher || [],
      Class: perSchoolCounts.Class || [],
      Subject: perSchoolCounts.Subject || [],
    },
  };

  console.log(JSON.stringify(output, null, 2));

  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error('Audit error:', error.message);
  await mongoose.connection.close();
  process.exit(1);
});
