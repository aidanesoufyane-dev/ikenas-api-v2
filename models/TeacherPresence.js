/**
 * Modèle TeacherPresence - Présence quotidienne des professeurs
 * Le prof signe sa présence chaque jour
 */
const mongoose = require('mongoose');

const teacherPresenceSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    signedAt: {
      type: Date,
      default: Date.now,
    },
    signedOutAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['present', 'absent', 'late'],
      default: 'present',
    },
  },
  {
    timestamps: true,
  }
);

// Un prof ne peut signer sa présence qu'une fois par jour
teacherPresenceSchema.index({ teacher: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('TeacherPresence', teacherPresenceSchema);
