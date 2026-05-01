const fs = require('fs');
const path = require('path');
const News = require('../models/News');
const { asyncHandler } = require('../utils/helpers');

const populateNewsQuery = () => News.find({ isActive: true })
  .populate('author', 'firstName lastName role avatar')
  .populate('likes', 'firstName lastName')
  .populate('comments.author', 'firstName lastName role avatar')
  .sort({ createdAt: -1 });

const removeUploadedFile = (filePath) => {
  if (!filePath) {
    return;
  }

  const absolutePath = path.join(__dirname, '..', filePath.replace(/^[\\/]+/, ''));
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
};

const getPosts = asyncHandler(async (req, res) => {
  const posts = await populateNewsQuery();

  res.status(200).json({
    success: true,
    data: posts,
  });
});

const createPost = asyncHandler(async (req, res) => {
  const content = String(req.body.content || '').trim();

  if (!content) {
    return res.status(400).json({
      success: false,
      message: 'Le contenu du post est requis.',
    });
  }

  const post = await News.create({
    author: req.user.id,
    content,
    image: req.file ? `/uploads/news/${req.file.filename}` : '',
  });

  const created = await News.findById(post._id)
    .populate('author', 'firstName lastName role avatar')
    .populate('likes', 'firstName lastName')
    .populate('comments.author', 'firstName lastName role avatar');

  res.status(201).json({
    success: true,
    data: created,
  });
});

const toggleLike = asyncHandler(async (req, res) => {
  const post = await News.findOne({ _id: req.params.id, isActive: true });
  if (!post) {
    return res.status(404).json({ success: false, message: 'Actualité introuvable.' });
  }

  const alreadyLiked = post.likes.some((userId) => userId.toString() === req.user.id);
  post.likes = alreadyLiked
    ? post.likes.filter((userId) => userId.toString() !== req.user.id)
    : [...post.likes, req.user.id];

  await post.save();

  const updated = await News.findById(post._id)
    .populate('author', 'firstName lastName role avatar')
    .populate('likes', 'firstName lastName')
    .populate('comments.author', 'firstName lastName role avatar');

  res.status(200).json({
    success: true,
    data: updated,
  });
});

const addComment = asyncHandler(async (req, res) => {
  const post = await News.findOne({ _id: req.params.id, isActive: true });
  if (!post) {
    return res.status(404).json({ success: false, message: 'Actualité introuvable.' });
  }

  const content = String(req.body.content || '').trim();
  if (!content) {
    return res.status(400).json({ success: false, message: 'Le commentaire est requis.' });
  }

  post.comments.push({
    author: req.user.id,
    content,
  });

  await post.save();

  const updated = await News.findById(post._id)
    .populate('author', 'firstName lastName role avatar')
    .populate('likes', 'firstName lastName')
    .populate('comments.author', 'firstName lastName role avatar');

  res.status(201).json({
    success: true,
    data: updated,
  });
});

const deletePost = asyncHandler(async (req, res) => {
  const post = await News.findById(req.params.id);
  if (!post) {
    return res.status(404).json({ success: false, message: 'Actualité introuvable.' });
  }

  removeUploadedFile(post.image);
  await News.findByIdAndDelete(req.params.id);

  res.status(200).json({
    success: true,
    message: 'Actualité supprimée.',
  });
});

const updatePost = asyncHandler(async (req, res) => {
  const post = await News.findOne({ _id: req.params.id, isActive: true });
  if (!post) {
    return res.status(404).json({ success: false, message: 'Actualité introuvable.' });
  }

  const { content } = req.body;
  if (content !== undefined) post.content = String(content).trim();

  await post.save();

  const updated = await News.findById(post._id)
    .populate('author', 'firstName lastName role avatar')
    .populate('likes', 'firstName lastName')
    .populate('comments.author', 'firstName lastName role avatar');

  res.status(200).json({ success: true, data: updated });
});

// RSVP on a news post (yes/no/maybe) — stored in a simple responses map
const respondToPost = asyncHandler(async (req, res) => {
  const post = await News.findOne({ _id: req.params.id, isActive: true });
  if (!post) {
    return res.status(404).json({ success: false, message: 'Actualité introuvable.' });
  }

  const { response } = req.body; // 'yes' | 'no' | 'maybe'
  if (!['yes', 'no', 'maybe'].includes(response)) {
    return res.status(400).json({ success: false, message: 'Réponse invalide.' });
  }

  if (!post.responses) post.responses = new Map();
  post.responses.set(req.user.id, response);
  post.markModified('responses');
  await post.save();

  res.status(200).json({ success: true, data: { response } });
});

const deleteComment = asyncHandler(async (req, res) => {
  const post = await News.findOne({ _id: req.params.id, isActive: true });
  if (!post) {
    return res.status(404).json({ success: false, message: 'Actualité introuvable.' });
  }

  const comment = post.comments.id(req.params.commentId);
  if (!comment) {
    return res.status(404).json({ success: false, message: 'Commentaire introuvable.' });
  }

  comment.deleteOne();
  await post.save();

  const updated = await News.findById(post._id)
    .populate('author', 'firstName lastName role avatar')
    .populate('likes', 'firstName lastName')
    .populate('comments.author', 'firstName lastName role avatar');

  res.status(200).json({
    success: true,
    data: updated,
  });
});

module.exports = {
  getPosts,
  createPost,
  toggleLike,
  addComment,
  updatePost,
  respondToPost,
  deletePost,
  deleteComment,
};