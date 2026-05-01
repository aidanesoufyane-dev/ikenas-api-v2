const mongoose = require('mongoose');

const noteSheetSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Le titre de la note est requis'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['controle_continue', 'autre'],
      default: 'controle_continue',
    },
    exam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      default: null,
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
      default: null,
    },
    semester: {
      type: String,
      enum: ['S1', 'S2'],
      default: 'S1',
    },
    // Pre-configured components for this subject/class (from SubjectComponents)
    components: [
      {
        key: String,
        name: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    visible: {
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
  }
);

noteSheetSchema.index({ classe: 1, subject: 1, semester: 1, createdAt: -1 });
noteSheetSchema.index({ teacher: 1, semester: 1, createdAt: -1 });
noteSheetSchema.index({ exam: 1 }, { unique: true, partialFilterExpression: { exam: { $type: 'objectId' } } });

module.exports = mongoose.model('NoteSheet', noteSheetSchema);
