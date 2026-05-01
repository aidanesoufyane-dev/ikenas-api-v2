const mongoose = require('mongoose');

const feeTariffSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      required: [true, 'Le niveau est requis'],
      trim: true,
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      default: null,
    },
    feeType: {
      type: String,
      enum: ['inscription', 'scolarite', 'transport'],
      required: [true, 'Le type de frais est requis'],
    },
    billingCycle: {
      type: String,
      enum: ['one_time', 'monthly', 'quarterly'],
      default: 'one_time',
    },
    amount: {
      type: Number,
      required: [true, 'Le montant est requis'],
      min: [0, 'Le montant ne peut pas être négatif'],
    },
    currency: {
      type: String,
      default: 'MAD',
      trim: true,
    },
    effectiveFrom: {
      type: Date,
      default: Date.now,
    },
    effectiveTo: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

feeTariffSchema.index({ level: 1, classe: 1, feeType: 1, billingCycle: 1, isActive: 1 });

module.exports = mongoose.model('FeeTariff', feeTariffSchema);
