/**
 * Controller Sections - CRUD des sections
 */
const Section = require('../models/Section');
const { asyncHandler } = require('../utils/helpers');

/**
 * @desc    Créer une section
 * @route   POST /api/sections
 * @access  Private/Admin
 */
const createSection = asyncHandler(async (req, res) => {
  const section = await Section.create(req.body);
  const populated = await Section.findById(section._id).populate('classe', 'name');
  res.status(201).json({ success: true, data: populated });
});

/**
 * @desc    Lister toutes les sections
 * @route   GET /api/sections?classe=
 * @access  Private
 */
const getSections = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.classe) {
    filter.classe = req.query.classe;
  }

  const sections = await Section.find(filter)
    .populate('classe', 'name')
    .sort('name');

  res.status(200).json({ success: true, data: sections });
});

/**
 * @desc    Obtenir une section par ID
 * @route   GET /api/sections/:id
 * @access  Private
 */
const getSection = asyncHandler(async (req, res) => {
  const section = await Section.findById(req.params.id).populate('classe', 'name');

  if (!section) {
    return res.status(404).json({ success: false, message: 'Section non trouvée.' });
  }

  res.status(200).json({ success: true, data: section });
});

/**
 * @desc    Mettre à jour une section
 * @route   PUT /api/sections/:id
 * @access  Private/Admin
 */
const updateSection = asyncHandler(async (req, res) => {
  const section = await Section.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('classe', 'name');

  if (!section) {
    return res.status(404).json({ success: false, message: 'Section non trouvée.' });
  }

  res.status(200).json({ success: true, data: section });
});

/**
 * @desc    Supprimer une section
 * @route   DELETE /api/sections/:id
 * @access  Private/Admin
 */
const deleteSection = asyncHandler(async (req, res) => {
  const section = await Section.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });

  if (!section) {
    return res.status(404).json({ success: false, message: 'Section non trouvée.' });
  }

  res.status(200).json({ success: true, message: 'Section supprimée avec succès.' });
});

module.exports = {
  createSection,
  getSections,
  getSection,
  updateSection,
  deleteSection,
};
