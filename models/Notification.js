/**
 * Modèle Notification - Notifications temps réel persistées
 */
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // null = broadcast
    },
    recipientRole: {
      type: String,
      enum: ['admin', 'teacher', 'student', 'parent', 'cashier', 'supervisor', null],
      default: null, // null + no recipient = broadcast
    },
    recipientClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      default: null,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'event_created',
        'event_updated',
        'absence_recorded',
        'absence_pending',     // for admin
        'absence_approved',
        'absence_rejected',
        'assignment_created',
        'exam_scheduled',
        'grade_added',
        'leave_request_submitted',
        'leave_request_approved',
        'leave_request_rejected',
        'leave_return_confirmed',
        'transport_vignette_due',
        'transport_assurance_due',
        'payment_due_reminder',
        'payment_confirmed',
        'general',
      ],
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    link: {
      type: String,
      default: null,
    },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Index for fast queries
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ recipientClass: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
