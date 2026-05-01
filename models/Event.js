/**
 * Modèle Event - Événements de l'établissement
 * CRUD admin/supervisor + réponses de présence prof/élève
 */
const mongoose = require('mongoose');

const attendeeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['going', 'not_going'],
      required: true,
    },
    respondedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Le titre de l'événement est requis"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    date: {
      type: Date,
      required: [true, 'La date est requise'],
    },
    endDate: {
      type: Date,
    },
    location: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ['academic', 'sport', 'cultural', 'meeting', 'holiday', 'other'],
      default: 'academic',
    },
    targetAudience: {
      type: String,
      enum: ['all', 'teachers', 'students'],
      default: 'all',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    attendees: {
      type: [attendeeSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

eventSchema.index({ date: -1 });
eventSchema.index({ type: 1 });
eventSchema.index({ 'attendees.user': 1 });

module.exports = mongoose.model('Event', eventSchema);
