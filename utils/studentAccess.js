const Student = require('../models/Student');

const buildParentStudentFilter = (parentUserId, studentId = null) => {
  const filter = {
    parentUser: parentUserId,
  };

  if (studentId) {
    filter._id = studentId;
  }

  return filter;
};

const getParentChildren = async (parentUserId) => {
  return Student.find(buildParentStudentFilter(parentUserId))
    .populate('user', 'firstName lastName email avatar')
    .populate('classe', 'name level')
    .sort({ classOrder: 1, createdAt: 1, _id: 1 });
};

const resolveActingStudent = async (req, options = {}) => {
  const {
    required = true,
    populate = null,
  } = options;

  let query = null;

  if (req.user?.role === 'student') {
    query = Student.findOne({ user: req.user.id });
  } else if (req.user?.role === 'parent') {
    const requestedStudentId = String(
      req.headers['x-student-id'] || req.query.studentId || req.body?.studentId || ''
    ).trim();

    if (requestedStudentId) {
      query = Student.findOne(buildParentStudentFilter(req.user.id, requestedStudentId));
    } else {
      const children = await Student.find(buildParentStudentFilter(req.user.id))
        .select('_id')
        .sort({ classOrder: 1, createdAt: 1, _id: 1 });

      if (children.length === 1) {
        query = Student.findById(children[0]._id);
      } else if (children.length > 1) {
        const error = new Error('Veuillez choisir un élève avant de continuer.');
        error.statusCode = 400;
        throw error;
      } else {
        query = null;
      }
    }
  }

  if (!query) {
    if (required) {
      const error = new Error('Profil élève non trouvé.');
      error.statusCode = 404;
      throw error;
    }
    return null;
  }

  if (populate) {
    if (Array.isArray(populate)) {
      populate.forEach((path) => {
        query = query.populate(path);
      });
    } else {
      query = query.populate(populate);
    }
  }

  const student = await query;

  if (!student && required) {
    const error = new Error('Profil élève non trouvé.');
    error.statusCode = 404;
    throw error;
  }

  return student;
};

module.exports = {
  getParentChildren,
  resolveActingStudent,
};
