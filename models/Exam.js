/**
 * Modèle Exam - Planification des examens
 */
const mongoose = require('mongoose');

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Le titre de l'examen est requis"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: [true, 'La classe est requise'],
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: [true, 'La matière est requise'],
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: [true, 'Le professeur est requis'],
    },
    date: {
      type: Date,
      required: [true, "La date de l'examen est requise"],
    },
    startTime: {
      type: String,
      required: [true, "L'heure de début est requise"],
    },
    endTime: {
      type: String,
      required: [true, "L'heure de fin est requise"],
    },
    room: {
      type: String,
      trim: true,
      default: '',
    },
    maxScore: {
      type: Number,
      default: 20,
    },
    semester: {
      type: String,
      enum: ['S1', 'S2'],
      default: 'S1',
    },
    componentsTemplate: [
      {
        name: {
          type: String,
          trim: true,
        },
        maxScore: {
          type: Number,
          default: 20,
        },
        weight: {
          type: Number,
          default: null,
        },
      },
    ],
    type: {
      type: String,
      enum: ['examen', 'contrôle', 'devoir_surveillé', 'rattrapage'],
      default: 'examen',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: nombre de résultats
examSchema.virtual('resultsCount', {
  ref: 'ExamResult',
  localField: '_id',
  foreignField: 'exam',
  count: true,
});

examSchema.index({ classe: 1, date: 1 });
examSchema.index({ teacher: 1, date: 1 });
examSchema.index({ classe: 1, subject: 1, semester: 1, date: -1 });
examSchema.index({ date: 1 });

module.exports = mongoose.model('Exam', examSchema);
