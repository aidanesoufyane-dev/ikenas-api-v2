/**
 * Modèle Teacher - Informations spécifiques aux professeurs
 * Lié au modèle User, peut être assigné à plusieurs matières et classes
 */
const mongoose = require('mongoose');

const teacherSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    employeeId: {
      type: String,
      required: [true, "L'identifiant employé est requis"],
      trim: true,
    },
    subjects: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subject',
      },
    ],
    classes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
      },
    ],
    phone: {
      type: String,
      trim: true,
    },
    specialization: {
      type: String,
      trim: true,
    },
    hireDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index pour optimiser les recherches
teacherSchema.index({ subjects: 1 });
teacherSchema.index({ classes: 1 });
teacherSchema.index({ school: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model('Teacher', teacherSchema);
