const express = require('express');
const router = express.Router();
const { deletePost, updatePost } = require('../controllers/newsController');
const { protect, roleCheck } = require('../middleware/auth');

router.patch('/:id', protect, roleCheck('admin'), updatePost);
router.delete('/:id', protect, roleCheck('admin'), deletePost);

module.exports = router;
