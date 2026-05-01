/**
 * Controller Matières - CRUD des matières
 */
const mongoose = require('mongoose');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const { asyncHandler } = require('../utils/helpers');

const normalizeSubjectName = (value = '') => value
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase();

const normalizeClassIds = (classIds) => {
  if (!classIds) return [];

  const values = Array.isArray(classIds) ? classIds : [classIds];
  return [...new Set(values.filter(Boolean).map((id) => id.toString()))];
};

const validateClassIds = async (classIds) => {
  if (classIds.length === 0) {
    return [];
  }

  const invalidId = classIds.find((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidId) {
    const error = new Error('Une ou plusieurs classes sélectionnées sont invalides.');
    error.statusCode = 400;
    throw error;
  }

  const classes = await Class.find({ _id: { $in: classIds }, isActive: true }).select('_id');
  if (classes.length !== classIds.length) {
    const error = new Error('Une ou plusieurs classes sélectionnées sont introuvables.');
    error.statusCode = 400;
    throw error;
  }

  return classIds;
};

/**
 * @desc    Créer une matière
 * @route   POST /api/subjects
 * @access  Private/Admin
 */
const createSubject = asyncHandler(async (req, res) => {
  const classes = await validateClassIds(normalizeClassIds(req.body.classes));

  const subjectName = (req.body.name || '').trim();
  const normalizedSubjectName = normalizeSubjectName(subjectName);

  const subjectsWithSameName = await Subject.find({ name: { $exists: true, $ne: null } });
  const existingSubject = subjectsWithSameName.find(
    (subject) => normalizeSubjectName(subject.name) === normalizedSubjectName
  );

  const incomingCode = (req.body.code || '').trim();
  if (incomingCode) {
    const codeConflict = await Subject.findOne({
      code: incomingCode,
      ...(existingSubject ? { _id: { $ne: existingSubject._id } } : {}),
    });

    if (codeConflict) {
      return res.status(409).json({
        success: false,
        message: 'Ce code matière existe déjà.',
      });
    }
  }

  if (existingSubject) {
    if (incomingCode && existingSubject.code && incomingCode !== existingSubject.code) {
      return res.status(409).json({
        success: false,
        message: 'Cette matière existe déjà avec un autre code. Modifiez la matière existante si nécessaire.',
      });
    }

    const mergedClasses = [...new Set([
      ...(existingSubject.classes || []).map((classId) => classId.toString()),
      ...classes,
    ])];

    existingSubject.classes = mergedClasses;
    if (incomingCode && !existingSubject.code) {
      existingSubject.code = incomingCode;
    }
    existingSubject.isActive = true;
    if (req.body.description !== undefined) {
      existingSubject.description = req.body.description;
    }
    if (req.body.coefficient !== undefined) {
      existingSubject.coefficient = req.body.coefficient;
    }

    await existingSubject.save();

    const populatedExisting = await Subject.findById(existingSubject._id)
      .populate('classes', 'name baseName level section');

    return res.status(200).json({
      success: true,
      data: populatedExisting,
      message: 'Matière existante mise à jour avec les classes sélectionnées.',
    });
  }

  const subject = await Subject.create({
    ...req.body,
    name: subjectName,
    code: incomingCode || undefined,
    classes,
  });

  const populated = await Subject.findById(subject._id)
    .populate('classes', 'name baseName level section');
  res.status(201).json({ success: true, data: populated });
});

/**
 * @desc    Lister toutes les matières
 * @route   GET /api/subjects
 * @access  Private
 */
const getSubjects = asyncHandler(async (req, res) => {
  const subjects = await Subject.find({ isActive: true })
    .populate('classes', 'name baseName level section')
    .collation({ locale: 'en', numericOrdering: true })
    .sort('name');
  res.status(200).json({ success: true, data: subjects });
});

/**
 * @desc    Obtenir une matière par ID
 * @route   GET /api/subjects/:id
 * @access  Private
 */
const getSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id)
    .populate('classes', 'name baseName level section');

  if (!subject) {
    return res.status(404).json({ success: false, message: 'Matière non trouvée.' });
  }

  res.status(200).json({ success: true, data: subject });
});

/**
 * @desc    Mettre à jour une matière
 * @route   PUT /api/subjects/:id
 * @access  Private/Admin
 */
const updateSubject = asyncHandler(async (req, res) => {
  const classes = req.body.classes === undefined
    ? undefined
    : await validateClassIds(normalizeClassIds(req.body.classes));

  const updatePayload = classes === undefined
    ? req.body
    : { ...req.body, classes };

  const updatedSubject = await Subject.findByIdAndUpdate(req.params.id, updatePayload, {
    new: true,
    runValidators: true,
  })
    .populate('classes', 'name baseName level section');

  if (!updatedSubject) {
    return res.status(404).json({ success: false, message: 'Matière non trouvée.' });
  }

  res.status(200).json({ success: true, data: updatedSubject });
});

/**
 * @desc    Supprimer une matière
 * @route   DELETE /api/subjects/:id
 * @access  Private/Admin
 */
const deleteSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findById(req.params.id);

  if (!subject) {
    return res.status(404).json({ success: false, message: 'Matière non trouvée.' });
  }

  const archiveSuffix = `__deleted_${Date.now()}`;

  subject.isActive = false;
  subject.name = `${subject.name}${archiveSuffix}`;
  if (subject.code) {
    subject.code = `${subject.code}${archiveSuffix}`;
  }

  await subject.save();

  res.status(200).json({ success: true, message: 'Matière supprimée avec succès.' });
});

module.exports = {
  createSubject,
  getSubjects,
  getSubject,
  updateSubject,
  deleteSubject,
};
