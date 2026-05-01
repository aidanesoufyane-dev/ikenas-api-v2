const Behavior = require('../models/Behavior');
const Student = require('../models/Student');
const { asyncHandler } = require('../utils/helpers');

// @desc    Get behavior summary
// @route   GET /api/behavior/summary
const getBehaviorSummary = asyncHandler(async (req, res) => {
  const { studentId, classeId } = req.query;
  const filter = {};
  if (studentId) filter.student = studentId;
  if (classeId) filter.classe = classeId;

  const behaviors = await Behavior.find(filter);

  const summary = {
    totalIncidents: behaviors.length,
    byType: {}
  };

  behaviors.forEach(b => {
    summary.byType[b.type] = (summary.byType[b.type] || 0) + 1;
  });

  res.status(200).json({ success: true, data: summary });
});

// @desc    Get behavior history
// @route   GET /api/behavior/history
const getBehaviorHistory = asyncHandler(async (req, res) => {
  const { studentId, classeId } = req.query;
  const filter = {};
  if (studentId) filter.student = studentId;
  if (classeId) filter.classe = classeId;

  const history = await Behavior.find(filter).sort('-incidentDate').populate('recordedBy', 'firstName lastName');
  res.status(200).json({ success: true, data: history });
});

// @desc    Create behavior record
// @route   POST /api/behavior
const createBehavior = asyncHandler(async (req, res) => {
  const { student, classe, type, description, incidentDate } = req.body;
  const behavior = await Behavior.create({
    student,
    classe,
    type,
    description,
    incidentDate: incidentDate || Date.now(),
    recordedBy: req.user.id
  });
  res.status(201).json({ success: true, data: behavior });
});

module.exports = { getBehaviorSummary, getBehaviorHistory, createBehavior };
