const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema(
  {
    nom: {
      type: String,
      required: [true, 'Le nom de l\'ecole est requis'],
      trim: true,
      maxlength: [120, 'Le nom ne peut pas depasser 120 caracteres'],
    },
    adresse: {
      type: String,
      trim: true,
      default: '',
      maxlength: [240, 'L\'adresse ne peut pas depasser 240 caracteres'],
    },
    telephone: {
      type: String,
      trim: true,
      default: '',
      maxlength: [30, 'Le numero de telephone ne peut pas depasser 30 caracteres'],
    },
    email: {
      type: String,
      required: [true, 'L\'email de l\'ecole est requis'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email invalide'],
    },
    logo: {
      type: String,
      trim: true,
      default: '',
    },
    showLogoInSidebar: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

schoolSchema.index({ email: 1 }, { unique: true });
schoolSchema.index({ nom: 1 });

module.exports = mongoose.model('School', schoolSchema);
