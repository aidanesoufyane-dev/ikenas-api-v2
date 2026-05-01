const mongoose = require('mongoose');

const behaviorSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
  },
  classe: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
  },
  type: {
    type: String,
    enum: ['positive', 'negative', 'neutral'],
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  incidentDate: {
    type: Date,
    default: Date.now,
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }
}, { timestamps: true });

module.exports = mongoose.model('Behavior', behaviorSchema);
