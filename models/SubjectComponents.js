const mongoose = require('mongoose');

const subjectComponentsSchema = new mongoose.Schema(
  {
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    semester: {
      type: String,
      enum: ['S1', 'S2'],
      required: true,
    },
    components: [
      {
        key: {
          type: String,
          required: true, // e.g., "lecture", "writing", "comp1"
        },
        name: {
          type: String,
          required: true, // e.g., "القراءة", "التعبير الكتابي"
        },
        weight: {
          type: Number,
          default: 1, // Equal weighting by default
        },
        order: {
          type: Number,
          default: 1,
          min: 1,
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Unique compound index: each subject in each classe for each semester should have one config
subjectComponentsSchema.index(
  { subject: 1, classe: 1, semester: 1, isActive: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model('SubjectComponents', subjectComponentsSchema);
