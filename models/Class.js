/**
 * Modèle Class - Classes / sections de l'établissement
 * Chaque enregistrement représente une section de classe, ex: 6AP-1, 6AP-2
 * Le champ baseName regroupe les sections d'une même classe (ex: "6AP")
 */
const mongoose = require('mongoose');

const classSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Le nom de la classe est requis'],
      trim: true,
    },
    baseName: {
      type: String,
      trim: true,
    },
    section: {
      type: String,
      trim: true,
    },
    level: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
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

// Virtuel : nombre d'élèves dans la classe
classSchema.virtual('studentCount', {
  ref: 'Student',
  localField: '_id',
  foreignField: 'classe',
  count: true,
});

// Virtuel : matières liées à cette classe
classSchema.virtual('subjects', {
  ref: 'Subject',
  localField: '_id',
  foreignField: 'classes',
});

classSchema.index({ baseName: 1 });
classSchema.index({ school: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Class', classSchema);
