/**
 * Modèle Attendance - Gestion des absences
 * Le prof crée l'absence, l'admin approuve ou refuse
 */
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, "L'élève est requis"],
    },
    date: {
      type: Date,
      required: [true, 'La date est requise'],
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['present', 'without_uniform', 'absent', 'late', 'excused'],
      default: 'absent',
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reason: {
      type: String,
      trim: true,
    },
    justifiedByStudent: {
      type: Boolean,
      default: false,
    },
    justifiedAt: {
      type: Date,
    },
    justificationAttachment: {
      url: { type: String, trim: true },
      originalName: { type: String, trim: true },
      mimeType: { type: String, trim: true },
      size: { type: Number },
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
    },
    schedule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
    },
  },
  {
    timestamps: true,
  }
);

// Index pour requêtes fréquentes
attendanceSchema.index({ student: 1, date: 1 });
attendanceSchema.index({ approvalStatus: 1 });
attendanceSchema.index({ recordedBy: 1 });
attendanceSchema.index({ date: -1 });
attendanceSchema.index({ classe: 1, date: 1, schedule: 1, student: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
