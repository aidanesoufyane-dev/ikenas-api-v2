const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    capacity: {
      type: Number,
      default: 30,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    linkType: {
      type: String,
      enum: ['none', 'class', 'subject', 'teacher'],
      default: 'none',
    },
    linkId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    linkStrict: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const subjectPlanSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },
    hoursPerWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 30,
      default: 2,
    },
    twoSessionsMode: {
      type: String,
      enum: ['split', 'fused'],
      default: 'split',
    },
  },
  { _id: false }
);

const availabilitySlotSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      required: true,
      enum: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    available: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const teacherAvailabilitySchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },
    slots: {
      type: [availabilitySlotSchema],
      default: [],
    },
  },
  { _id: false }
);

const fixedAssignmentSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      default: null,
    },
    day: {
      type: String,
      enum: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
      default: null,
    },
    sessionNumber: {
      type: Number,
      min: 1,
      max: 12,
      default: null,
    },
  },
  { _id: false }
);

const subjectBlockoutSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      default: null,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    day: {
      type: String,
      enum: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
      default: null,
    },
    sessionNumber: {
      type: Number,
      min: 1,
      max: 12,
      default: null,
    },
  },
  { _id: false }
);

const subjectDailyCapSchema = new mongoose.Schema(
  {
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    maxPerDay: {
      type: Number,
      min: 1,
      max: 12,
      default: 2,
      required: true,
    },
  },
  { _id: false }
);

const scheduleGenerationConfigSchema = new mongoose.Schema(
  {
    selectedClassIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Class',
      },
    ],
    mode: {
      type: String,
      enum: ['rapide', 'equilibre', 'avance'],
      default: 'equilibre',
    },
    daysCount: {
      type: Number,
      min: 1,
      max: 6,
      default: 6,
    },
    sessionsPerDay: {
      type: Number,
      min: 1,
      max: 12,
      default: 8,
    },
    constraints: {
      teacherAvailability: {
        type: Boolean,
        default: true,
      },
      roomAvailability: {
        type: Boolean,
        default: true,
      },
      subjectHours: {
        type: Boolean,
        default: true,
      },
      avoidGaps: {
        type: Boolean,
        default: true,
      },
    },
    advancedConstraints: {
      maxSessionsPerDay: {
        type: Number,
        min: 1,
        max: 12,
        default: 6,
      },
      maxConsecutiveSessions: {
        type: Number,
        min: 1,
        max: 12,
        default: 4,
      },
      maxSessionsPerSubjectPerDay: {
        type: Number,
        min: 1,
        max: 12,
        default: 2,
      },
      subjectDailyCaps: {
        type: [subjectDailyCapSchema],
        default: [],
      },
      minimizeRoomChangesForClass: {
        type: Boolean,
        default: true,
      },
      subjectBlockouts: {
        type: [subjectBlockoutSchema],
        default: [],
      },
    },
    rooms: {
      type: [roomSchema],
      default: [],
    },
    subjectPlans: {
      type: [subjectPlanSchema],
      default: [],
    },
    teacherAvailabilities: {
      type: [teacherAvailabilitySchema],
      default: [],
    },
    fixedAssignments: {
      type: [fixedAssignmentSchema],
      default: [],
    },
    lastGenerationVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastGeneratedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

scheduleGenerationConfigSchema.index({ school: 1 }, { unique: true });

module.exports = mongoose.model('ScheduleGenerationConfig', scheduleGenerationConfigSchema);