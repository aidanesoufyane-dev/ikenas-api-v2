const mongoose = require('mongoose');

const newsCommentSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: [true, 'Le commentaire est requis'],
      trim: true,
      maxlength: [1000, 'Le commentaire ne peut pas dépasser 1000 caractères'],
    },
  },
  {
    timestamps: true,
    _id: true,
  }
);

const newsSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: [true, 'Le contenu est requis'],
      trim: true,
      maxlength: [5000, 'Le contenu ne peut pas dépasser 5000 caractères'],
    },
    image: {
      type: String,
      default: '',
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    comments: [newsCommentSchema],
    responses: {
      type: Map,
      of: String,
      default: {},
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

newsSchema.virtual('likesCount').get(function likesCount() {
  return Array.isArray(this.likes) ? this.likes.length : 0;
});

newsSchema.virtual('commentsCount').get(function commentsCount() {
  return Array.isArray(this.comments) ? this.comments.length : 0;
});

newsSchema.index({ createdAt: -1 });
newsSchema.index({ author: 1, createdAt: -1 });

module.exports = mongoose.model('News', newsSchema);