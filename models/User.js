/**
 * Modèle User - Utilisateur principal du système
 * Gère l'authentification et les rôles (admin, teacher, student, parent)
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getJwtConfig } = require('../config/jwt');

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, 'Le prénom est requis'],
      trim: true,
      maxlength: [50, 'Le prénom ne peut pas dépasser 50 caractères'],
    },
    lastName: {
      type: String,
      required: [true, 'Le nom est requis'],
      trim: true,
      maxlength: [50, 'Le nom ne peut pas dépasser 50 caractères'],
    },
    email: {
      type: String,
      required: [true, "L'email est requis"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email invalide'],
    },
    password: {
      type: String,
      required: [true, 'Le mot de passe est requis'],
      minlength: [6, 'Le mot de passe doit contenir au moins 6 caractères'],
      select: false, // Ne pas retourner le mot de passe par défaut
    },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'teacher', 'student', 'parent', 'cashier', 'supervisor', 'pedagogical_director', 'reception'],
      default: 'student',
    },
    supervisorLevels: {
      type: [String],
      enum: ['primaire', 'college', 'lycee'],
      default: [],
    },
    school: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'School',
      index: true,
      validate: {
        validator(value) {
          if (this.role === 'super_admin') {
            return true;
          }
          return Boolean(value);
        },
        message: 'ecole_id est requis pour ce role.',
      },
    },
    phone: {
      type: String,
      trim: true,
    },
    avatar: {
      type: String,
      default: '',
    },
    avatarIndex: {
      type: Number,
      default: null,
    },
    fcmTokens: [{ type: String }],
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

// Index pour optimiser les recherches
userSchema.index({ role: 1 });
userSchema.index({ school: 1, role: 1 });
userSchema.index({ lastName: 1, firstName: 1 });

// Hash du mot de passe avant sauvegarde
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Méthode pour comparer les mots de passe
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Méthode pour générer un JWT
userSchema.methods.generateToken = function () {
  const { secret, expiresIn } = getJwtConfig();

  return jwt.sign(
    { id: this._id, role: this.role, school: this.school || null },
    secret,
    { expiresIn }
  );
};

// Champ virtuel pour le nom complet
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('User', userSchema);
