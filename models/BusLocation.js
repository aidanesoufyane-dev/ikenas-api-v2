const mongoose = require('mongoose');

const busLocationSchema = new mongoose.Schema({
  transport: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transport',
    required: true,
  },
  latitude: {
    type: Number,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
  speed: {
    type: Number,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model('BusLocation', busLocationSchema);
