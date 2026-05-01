/**
 * Modèle Subject - Matières enseignées
 * Ex: Mathématiques, Français, Physique-Chimie
 */
const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Le nom de la matière est requis'],
      trim: true,
    },
    code: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    coefficient: {
      type: Number,
      default: 1,
    },
    classes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

subjectSchema.index({ classes: 1 });
subjectSchema.index({ school: 1, name: 1 }, { unique: true });
subjectSchema.index(
  { school: 1, code: 1 },
  {
    unique: true,
    sparse: true,
  }
);

module.exports = mongoose.model('Subject', subjectSchema);
