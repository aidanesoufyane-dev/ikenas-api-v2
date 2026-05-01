const mongoose = require('mongoose');

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const breakSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      trim: true,
      default: '',
    },
    startTime: {
      type: String,
      required: true,
      match: [timePattern, 'Format heure invalide (HH:MM)'],
    },
    endTime: {
      type: String,
      required: true,
      match: [timePattern, 'Format heure invalide (HH:MM)'],
    },
  },
  { _id: true }
);

const exceptionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Le nom de la période exceptionnelle est requis'],
      trim: true,
    },
    startDate: {
      type: Date,
      required: [true, 'La date de début est requise'],
    },
    endDate: {
      type: Date,
      required: [true, 'La date de fin est requise'],
    },
    morningStart: {
      type: String,
      required: true,
      match: [timePattern, 'Format heure invalide (HH:MM)'],
    },
    morningEnd: {
      type: String,
      required: true,
      match: [timePattern, 'Format heure invalide (HH:MM)'],
    },
    afternoonStart: {
      type: String,
      required: true,
      match: [timePattern, 'Format heure invalide (HH:MM)'],
    },
    afternoonEnd: {
      type: String,
      required: true,
      match: [timePattern, 'Format heure invalide (HH:MM)'],
    },
    sessionDuration: {
      type: Number,
      required: true,
      min: [15, 'La durée minimale est de 15 minutes'],
      max: [180, 'La durée maximale est de 180 minutes'],
    },
    breaks: [breakSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: true }
);

const scheduleSettingsSchema = new mongoose.Schema(
  {
    defaultConfig: {
      timetableStartDate: {
        type: Date,
        default: null,
      },
      timetableEndDate: {
        type: Date,
        default: null,
      },
      morningStart: {
        type: String,
        default: '08:00',
        match: [timePattern, 'Format heure invalide (HH:MM)'],
      },
      morningEnd: {
        type: String,
        default: '12:00',
        match: [timePattern, 'Format heure invalide (HH:MM)'],
      },
      afternoonStart: {
        type: String,
        default: '14:00',
        match: [timePattern, 'Format heure invalide (HH:MM)'],
      },
      afternoonEnd: {
        type: String,
        default: '18:00',
        match: [timePattern, 'Format heure invalide (HH:MM)'],
      },
      sessionDuration: {
        type: Number,
        default: 60,
        min: [15, 'La durée minimale est de 15 minutes'],
        max: [180, 'La durée maximale est de 180 minutes'],
      },
      smallBreakCount: {
        type: Number,
        default: 1,
        min: [0, 'Le nombre minimum de pauses est 0'],
        max: [1, 'Le nombre maximum de pauses est 1'],
      },
      smallBreakDuration: {
        type: Number,
        default: 10,
        min: [0, 'La durée minimum de pause est 0'],
        max: [60, 'La durée maximum de pause est 60 minutes'],
      },
      breaks: [breakSchema],
    },
    exceptions: [exceptionSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ScheduleSettings', scheduleSettingsSchema);