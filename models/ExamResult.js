/**
 * Modèle ExamResult - Résultats/Notes des examens
 */
const mongoose = require('mongoose');

const examResultSchema = new mongoose.Schema(
  {
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: [true, "L'examen est requis"],
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, "L'élève est requis"],
    },
    score: {
      type: Number,
      min: [0, 'La note ne peut pas être négative'],
      default: null,
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
    components: [
      {
        key: {
          type: String,
          trim: true,
        },
        name: {
          type: String,
          trim: true,
        },
        score: {
          type: Number,
          default: null,
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
    hasComponents: {
      type: Boolean,
      default: false,
    },
    isComplete: {
      type: Boolean,
      default: true,
    },
    completionRate: {
      type: Number,
      default: 100,
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    gradedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Un seul résultat par élève par examen
examResultSchema.index({ exam: 1, student: 1 }, { unique: true });
examResultSchema.index({ student: 1, semester: 1, updatedAt: -1 });

module.exports = mongoose.model('ExamResult', examResultSchema);
