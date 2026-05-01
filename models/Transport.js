/**
 * Modèle Transport - Véhicules scolaires + chauffeur assigné
 */
const mongoose = require('mongoose');

const transportSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Le nom / numéro du transport est requis'],
      trim: true,
    },
    matricule: {
      type: String,
      required: [true, 'La plaque d\'immatriculation est requise'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['bus'],
      default: 'bus',
    },
    capacity: {
      type: Number,
      min: [1, 'La capacité doit être au moins 1'],
      default: 30,
    },
    route: {
      type: String,
      trim: true,
      default: '',
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    vignette: {
      dueDate: {
        type: Date,
        default: null,
      },
      isPaid: {
        type: Boolean,
        default: false,
      },
      paidAt: {
        type: Date,
        default: null,
      },
      lastNotifiedAt: {
        type: Date,
        default: null,
      },
    },
    assurance: {
      dueDate: {
        type: Date,
        default: null,
      },
      isPaid: {
        type: Boolean,
        default: false,
      },
      paidAt: {
        type: Date,
        default: null,
      },
      lastNotifiedAt: {
        type: Date,
        default: null,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

transportSchema.index({ isActive: 1 });
transportSchema.index({ driver: 1 });
transportSchema.index({ school: 1, matricule: 1 }, { unique: true });

module.exports = mongoose.model('Transport', transportSchema);
