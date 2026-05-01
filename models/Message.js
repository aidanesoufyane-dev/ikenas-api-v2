/**
 * Modèle Message - Messagerie temps réel
 * Supporte les messages : admin→tous, admin→classe, prof→ses élèves
 */
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      trim: true,
      default: '',
    },
    // Type de destinataire : broadcast, classe, ou individuel
    recipientType: {
      type: String,
      enum: ['broadcast', 'class', 'individual'],
      required: true,
    },
    // Si recipientType === 'class', on cible une classe
    targetClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
    },
    // Si recipientType === 'individual', on cible un utilisateur
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    // Utilisateurs ayant lu le message
    readBy: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        readAt: { type: Date, default: Date.now },
      },
    ],
    // Pièces jointes (images/docs/vidéo/audio)
    attachments: [
      {
        filename: { type: String, required: true },
        originalName: { type: String, required: true },
        mimetype: { type: String, required: true },
        size: { type: Number, required: true },
        url: { type: String, required: true },
      },
    ],
    allowReply: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index pour récupérer rapidement les messages
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ recipientType: 1, targetClass: 1 });
messageSchema.index({ targetUser: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
