/**
 * Modèle LeaveRequest - Demandes de congé / absence des professeurs
 */
const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema(
  {
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Teacher',
      required: true,
    },
    // Type de demande: 'absence' ou 'return'
    requestType: {
      type: String,
      enum: ['absence', 'return'],
      default: 'absence',
    },
    // Type d'absence (vacation, sick, personal, other)
    type: {
      type: String,
      enum: ['vacation', 'sick', 'personal', 'other'],
      required: true,
    },
    // Pour absence: dates de l'absence
    startDate: {
      type: Date,
       required: false,
    },
    endDate: {
      type: Date,
      required: false,
    },
    // Pour return: date de retour proposée
    returnDate: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    attachments: [
      {
        filename:     { type: String, required: true },
        originalName: { type: String, required: true },
        mimetype:     { type: String, required: true },
        size:         { type: Number, required: true },
        url:          { type: String, required: true },
      },
    ],
    // Status géré par l'admin
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    adminComment: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ teacher: 1, createdAt: -1 });
leaveRequestSchema.index({ status: 1, createdAt: -1 });
leaveRequestSchema.index({ requestType: 1, status: 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
