/**
 * Modèle Schedule - Emploi du temps dynamique
 * Relie jour, créneau horaire, classe, prof, matière et salle
 */
const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      required: [true, 'Le jour est requis'],
      enum: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
    },
    startTime: {
      type: String,
      required: [true, "L'heure de début est requise"],
      // Format HH:MM
    },
    endTime: {
      type: String,
      required: [true, "L'heure de fin est requise"],
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: [true, 'La classe est requise'],
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: [true, 'Le professeur est requis'],
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subject',
      required: [true, 'La matière est requise'],
    },
    room: {
      type: String,
      required: [true, 'La salle est requise'],
      trim: true,
    },
    source: {
      type: String,
      enum: ['manual', 'generated'],
      default: 'manual',
    },
    generationVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    generationBatchId: {
      type: String,
      default: '',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index pour retrouver rapidement l'emploi du temps par classe ou prof
scheduleSchema.index({ classe: 1, day: 1 });
scheduleSchema.index({ teacher: 1, day: 1 });
scheduleSchema.index({ day: 1, startTime: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);
