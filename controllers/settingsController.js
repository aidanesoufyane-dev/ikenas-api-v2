const AppSettings = require('../models/AppSettings');
const { asyncHandler } = require('../utils/helpers');

const getSettings = asyncHandler(async (req, res) => {
  const settings = await AppSettings.getSettings();

  res.status(200).json({
    success: true,
    data: settings,
  });
});

const updateSettings = asyncHandler(async (req, res) => {
  const allowedFields = [
    'studentNotesVisible',
    'studentAssignmentsVisible',
    'studentPaymentsVisible',
    'studentScheduleVisible',
    'assignmentDeadlineRequired',
    'transportModule',
    'messagingEnabled',
    'attendanceTracking',
    'examsEnabled',
    'paymentRemindersEnabled',
    'latePaymentNotifications',
    'attendanceNotifications',
    'maintenanceMode',
    'debugMode',
  ];

  const updateData = {};
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  updateData.updatedBy = req.user._id;

  const settings = await AppSettings.findOneAndUpdate({}, updateData, {
    new: true,
    upsert: true,
  });

  res.status(200).json({
    success: true,
    data: settings,
    message: 'Paramètres mis à jour avec succès.',
  });
});

const toggleSetting = asyncHandler(async (req, res) => {
  const { setting } = req.params;

  const allowedFields = [
    'studentNotesVisible',
    'studentAssignmentsVisible',
    'studentPaymentsVisible',
    'studentScheduleVisible',
    'assignmentDeadlineRequired',
    'transportModule',
    'messagingEnabled',
    'attendanceTracking',
    'examsEnabled',
    'paymentRemindersEnabled',
    'latePaymentNotifications',
    'attendanceNotifications',
    'maintenanceMode',
    'debugMode',
  ];

  if (!allowedFields.includes(setting)) {
    return res.status(400).json({
      success: false,
      message: 'Paramètre invalide.',
    });
  }

  const currentSettings = await AppSettings.getSettings();
  const newValue = !currentSettings[setting];

  const updateData = { [setting]: newValue, updatedBy: req.user._id };

  const updatedSettings = await AppSettings.findOneAndUpdate({}, updateData, {
    new: true,
  });

  res.status(200).json({
    success: true,
    data: { [setting]: newValue },
    message: `${setting} ${newValue ? 'activé' : 'désactivé'}.`,
  });
});

module.exports = {
  getSettings,
  updateSettings,
  toggleSetting,
};
