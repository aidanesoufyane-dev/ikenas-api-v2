/**
 * Controller Classes - CRUD des classes avec génération automatique de sections
 * Ex: Créer "6AP" avec 2 sections → "6AP-1" et "6AP-2"
 */
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const { asyncHandler } = require('../utils/helpers');
const {
  buildClassLevelMongoFilter,
  ensureClassAccessibleForSupervisor,
  getSupervisorClassScope,
  normalizeEducationLevel,
} = require('../utils/supervisorScope');

/**
 * @desc    Créer une classe avec N sections
 * @route   POST /api/classes
 * @access  Private/Admin
 * @body    { baseName, numberOfSections, level, capacity, description }
 */
const createClass = asyncHandler(async (req, res) => {
  const { baseName, numberOfSections = 1, level, capacity, description } = req.body;

  if (!baseName) {
    return res.status(400).json({ success: false, message: 'Le nom de base est requis.' });
  }

  const count = Math.max(parseInt(numberOfSections, 10) || 1, 1);

  const scope = await getSupervisorClassScope(req);
  if (scope.restricted) {
    const levelAllowed = scope.levels.includes(normalizeEducationLevel(level));

    if (!levelAllowed) {
      return res.status(403).json({ success: false, message: 'Ce niveau ne fait pas partie de votre perimetre.' });
    }
  }

  const created = [];

  for (let i = 0; i < count; i++) {
    const sectionNumber = i + 1;
    const name = count === 1 ? baseName : `${baseName}-${sectionNumber}`;

    // Vérifier si le nom existe déjà (uniquement parmi les classes actives)
    const exists = await Class.findOne({ name, isActive: true });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: `La classe "${name}" existe déjà.`,
      });
    }

    // Supprimer les anciennes classes inactives avec le même nom
    await Class.deleteMany({ name, isActive: false });

    const classe = await Class.create({
      name,
      baseName,
      section: count === 1 ? null : String(sectionNumber),
      level,
      capacity: capacity || 40,
      description,
    });
    created.push(classe);
  }

  res.status(201).json({ success: true, data: created });
});

/**
 * @desc    Lister toutes les classes (sections)
 * @route   GET /api/classes
 * @access  Private
 */
const getClasses = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const scope = await getSupervisorClassScope(req);
  if (scope.restricted) {
    Object.assign(filter, buildClassLevelMongoFilter(scope.levels));
  }

  const classes = await Class.find(filter)
    .populate('studentCount')
    .populate('subjects', 'name code coefficient')
    .collation({ locale: 'en', numericOrdering: true })
    .sort('baseName section name');

  res.status(200).json({ success: true, data: classes });
});

/**
 * @desc    Obtenir une classe par ID
 * @route   GET /api/classes/:id
 * @access  Private
 */
const getClass = asyncHandler(async (req, res) => {
  const classe = await Class.findById(req.params.id)
    .populate('studentCount')
    .populate('subjects', 'name code coefficient');

  if (!classe) {
    return res.status(404).json({ success: false, message: 'Classe non trouvée.' });
  }

  await ensureClassAccessibleForSupervisor(req, classe._id);

  res.status(200).json({ success: true, data: classe });
});

/**
 * @desc    Mettre à jour une classe (section individuelle)
 * @route   PUT /api/classes/:id
 * @access  Private/Admin
 */
const updateClass = asyncHandler(async (req, res) => {
  await ensureClassAccessibleForSupervisor(req, req.params.id);

  const classe = await Class.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!classe) {
    return res.status(404).json({ success: false, message: 'Classe non trouvée.' });
  }

  res.status(200).json({ success: true, data: classe });
});

/**
 * @desc    Supprimer une classe (section individuelle)
 * @route   DELETE /api/classes/:id
 * @access  Private/Admin
 */
const deleteClass = asyncHandler(async (req, res) => {
  await ensureClassAccessibleForSupervisor(req, req.params.id);

  const classe = await Class.findByIdAndDelete(req.params.id);

  if (!classe) {
    return res.status(404).json({ success: false, message: 'Classe non trouvée.' });
  }

  await Subject.updateMany(
    { classes: classe._id },
    { $pull: { classes: classe._id } }
  );

  res.status(200).json({ success: true, message: 'Classe supprimée avec succès.' });
});

/**
 * @desc    Supprimer toutes les sections d'un groupe de classes
 * @route   DELETE /api/classes/group/:baseName
 * @access  Private/Admin
 */
const deleteClassGroup = asyncHandler(async (req, res) => {
  const { baseName } = req.params;

  const classes = await Class.find({ baseName }).select('_id');
  for (const classDoc of classes) {
    await ensureClassAccessibleForSupervisor(req, classDoc._id);
  }
  const classIds = classes.map((item) => item._id);

  const result = await Class.deleteMany({ baseName });

  if (result.deletedCount === 0) {
    return res.status(404).json({ success: false, message: 'Aucune classe trouvée.' });
  }

  if (classIds.length > 0) {
    await Subject.updateMany(
      { classes: { $in: classIds } },
      { $pull: { classes: { $in: classIds } } }
    );
  }

  res.status(200).json({
    success: true,
    message: `${result.deletedCount} section(s) supprimée(s).`,
  });
});

/**
 * @desc    Ajouter des sections supplémentaires à un groupe existant
 * @route   POST /api/classes/add-sections
 * @access  Private/Admin
 * @body    { baseName, count }
 */
const addSections = asyncHandler(async (req, res) => {
  const { baseName, count = 1 } = req.body;

  if (!baseName) {
    return res.status(400).json({ success: false, message: 'Le nom de base est requis.' });
  }

  // Trouver les sections existantes pour ce groupe
  const existing = await Class.find({ baseName, isActive: true });
  if (existing.length === 0) {
    return res.status(404).json({ success: false, message: 'Groupe de classes introuvable.' });
  }

  await ensureClassAccessibleForSupervisor(req, existing[0]._id);

  // Trouver le prochain numéro
  const usedNumbers = existing
    .map((c) => parseInt(c.section, 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const nextSectionNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
  const sectionsToAdd = Math.max(parseInt(count, 10) || 1, 1);

  const { level, capacity, description } = existing[0];
  const created = [];

  for (let i = 0; i < sectionsToAdd; i++) {
    const sectionNumber = nextSectionNumber + i;
    const name = `${baseName}-${sectionNumber}`;

    const exists = await Class.findOne({ name, isActive: true });
    if (exists) continue;

    // Supprimer les anciennes classes inactives avec le même nom
    await Class.deleteMany({ name, isActive: false });

    const classe = await Class.create({
      name,
      baseName,
      section: String(sectionNumber),
      level,
      capacity,
      description,
    });
    created.push(classe);
  }

  res.status(201).json({ success: true, data: created });
});

module.exports = {
  createClass,
  getClasses,
  getClass,
  updateClass,
  deleteClass,
  deleteClassGroup,
  addSections,
};
