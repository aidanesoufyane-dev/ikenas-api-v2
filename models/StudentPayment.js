const mongoose = require('mongoose');

const paymentItemSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    method: {
      type: String,
      enum: ['cash', 'bank_transfer'],
      required: true,
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    reference: {
      type: String,
      trim: true,
      default: '',
    },
    receiptNumber: {
      type: String,
      trim: true,
      required: true,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { _id: true }
);

const studentPaymentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    classe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
    },
    level: {
      type: String,
      trim: true,
      required: true,
    },
    feeType: {
      type: String,
      enum: ['inscription', 'scolarite', 'transport'],
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['one_time', 'monthly', 'quarterly'],
      default: 'one_time',
    },
    label: {
      type: String,
      trim: true,
      default: '',
    },
    periodMonth: {
      type: Number,
      min: 1,
      max: 12,
      default: null,
    },
    periodQuarter: {
      type: Number,
      min: 1,
      max: 4,
      default: null,
    },
    periodYear: {
      type: Number,
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    baseAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
      type: {
        type: String,
        enum: ['none', 'fixed', 'percent'],
        default: 'none',
      },
      value: {
        type: Number,
        default: 0,
        min: 0,
      },
      reason: {
        type: String,
        trim: true,
        default: '',
      },
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },
    finalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'late'],
      default: 'pending',
    },
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    payments: [paymentItemSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

studentPaymentSchema.index({ student: 1, status: 1, dueDate: 1 });
studentPaymentSchema.index({ feeType: 1, dueDate: 1 });
studentPaymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('StudentPayment', studentPaymentSchema);
