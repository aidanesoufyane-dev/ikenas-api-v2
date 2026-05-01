const mongoose = require('mongoose');

const noteEntrySchema = new mongoose.Schema(
  {
    sheet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NoteSheet',
      required: [true, 'La feuille de notes est requise'],
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, "L'élève est requis"],
    },
    // Array of component scores (each with name and score)
    components: [
      {
        key: String, // unique identifier for component
        name: String, // e.g., "Écoute", "Lecture"
        score: Number, // score for this component (0-20, optional)
      },
    ],
    // General score: average of all component scores, or fallback to single score
    score: {
      type: Number,
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
  },
  {
    timestamps: true,
  }
);

noteEntrySchema.index({ sheet: 1, student: 1 }, { unique: true });
noteEntrySchema.index({ student: 1, semester: 1, updatedAt: -1 });

module.exports = mongoose.model('NoteEntry', noteEntrySchema);
