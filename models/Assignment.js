/**
 * Modèle Assignment - Devoirs et exercices partagés par les profs
 * Chaque devoir est lié à une classe et une matière
 */
const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Le titre est requis'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: [true, 'La classe est requise'],
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: [true, 'Le professeur est requis'],
    },
    deadline: {
      type: Date,
      default: null,
    },
    attachments: [
      {
        filename: String,
        originalName: String,
        path: String,
        mimetype: String,
        size: Number,
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

// Virtuel : nombre de soumissions
assignmentSchema.virtual('submissionCount', {
  ref: 'Submission',
  localField: '_id',
  foreignField: 'assignment',
  count: true,
});

assignmentSchema.index({ classe: 1, teacher: 1 });
assignmentSchema.index({ deadline: 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);
