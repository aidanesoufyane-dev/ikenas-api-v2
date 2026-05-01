require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User = require('../models/User');
const Class = require('../models/Class');
const Subject = require('../models/Subject');

const main = async () => {
  await connectDB();

  const admin = await User.findOne({ email: 'admin@ikenas.com' }).select('email school role');
  const schoolId = admin?.school || null;

  const totalClasses = await Class.countDocuments({});
  const totalSubjects = await Subject.countDocuments({});

  const classesNoSchool = await Class.countDocuments({ school: { $exists: false } });
  const subjectsNoSchool = await Subject.countDocuments({ school: { $exists: false } });

  const classesForAdminSchool = schoolId ? await Class.countDocuments({ school: schoolId }) : 0;
  const subjectsForAdminSchool = schoolId ? await Subject.countDocuments({ school: schoolId }) : 0;

  console.log(JSON.stringify({
    admin,
    totals: { classes: totalClasses, subjects: totalSubjects },
    noSchool: { classes: classesNoSchool, subjects: subjectsNoSchool },
    adminSchool: { classes: classesForAdminSchool, subjects: subjectsForAdminSchool },
  }, null, 2));

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close();
  process.exit(1);
});
