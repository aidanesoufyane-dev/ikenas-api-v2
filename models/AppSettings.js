const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema(
  {
    // Visibility & Access Controls
    studentNotesVisible: {
      type: Boolean,
      default: true,
    },
    studentAssignmentsVisible: {
      type: Boolean,
      default: true,
    },
    studentPaymentsVisible: {
      type: Boolean,
      default: true,
    },
    studentScheduleVisible: {
      type: Boolean,
      default: true,
    },

    // Feature Toggles
    assignmentDeadlineRequired: {
      type: Boolean,
      default: false,
    },
    transportModule: {
      type: Boolean,
      default: true,
    },
    messagingEnabled: {
      type: Boolean,
      default: true,
    },
    attendanceTracking: {
      type: Boolean,
      default: true,
    },
    examsEnabled: {
      type: Boolean,
      default: true,
    },

    // Notifications & Reminders
    paymentRemindersEnabled: {
      type: Boolean,
      default: true,
    },
    latePaymentNotifications: {
      type: Boolean,
      default: true,
    },
    attendanceNotifications: {
      type: Boolean,
      default: false,
    },

    // System Settings
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    debugMode: {
      type: Boolean,
      default: false,
    },

    // Last updated info
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Ensure only one document exists
appSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model('AppSettings', appSettingsSchema);
