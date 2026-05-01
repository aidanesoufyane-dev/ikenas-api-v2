/**
 * Modèle Section - Sous-divisions d'une classe
 * Ex: 6ème A, 6ème B, 6ème C
 */
const mongoose = require('mongoose');

const sectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Le nom de la section est requis'],
      trim: true,
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: [true, 'La classe est requise'],
    },
    capacity: {
      type: Number,
      default: 40,
    },
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

// Index composé unique : une section par classe
sectionSchema.index({ name: 1, classe: 1 }, { unique: true });

module.exports = mongoose.model('Section', sectionSchema);
