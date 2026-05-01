/**
 * Multer middleware – handles file uploads (avatars, Excel imports, assignments, submissions)
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure directories exist
const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };
ensureDir(path.join(__dirname, '..', 'uploads', 'avatars'));
ensureDir(path.join(__dirname, '..', 'uploads', 'avatars', 'presets'));
ensureDir(path.join(__dirname, '..', 'uploads', 'assignments'));
ensureDir(path.join(__dirname, '..', 'uploads', 'submissions'));
ensureDir(path.join(__dirname, '..', 'uploads', 'news'));
ensureDir(path.join(__dirname, '..', 'uploads', 'messages'));
ensureDir(path.join(__dirname, '..', 'uploads', 'leaves'));
ensureDir(path.join(__dirname, '..', 'uploads', 'attendance-justifications'));
ensureDir(path.join(__dirname, '..', 'uploads', 'schools'));

// ── Avatar storage ──
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'avatars'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) return cb(null, true);
  cb(new Error('Seules les images (jpeg, jpg, png, gif, webp) sont autorisées.'));
};

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: imageFilter,
});

// ── News image storage ──
const newsImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'news'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `news-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const uploadNewsImage = multer({
  storage: newsImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

// ── School logo storage ──
const schoolLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'schools'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `school-logo-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const uploadSchoolLogo = multer({
  storage: schoolLogoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFilter,
});

// ── Excel import (memory storage) ──
const excelStorage = multer.memoryStorage();

const excelFilter = (req, file, cb) => {
  const allowed = /xlsx|xls|csv/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowed.test(ext)) return cb(null, true);
  cb(new Error('Seuls les fichiers Excel (.xlsx, .xls) ou CSV sont autorisés.'));
};

const uploadExcel = multer({
  storage: excelStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: excelFilter,
});

// ── Assignment files (prof uploads) ──
const assignmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'assignments'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `assign-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const docFilter = (req, file, cb) => {
  const allowed = /pdf|doc|docx|xls|xlsx|ppt|pptx|txt|png|jpg|jpeg|gif|webp|zip|rar/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowed.test(ext)) return cb(null, true);
  cb(new Error('Type de fichier non autorisé.'));
};

const uploadAssignment = multer({
  storage: assignmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: docFilter,
});

// ── Submission files (student uploads) ──
const submissionStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'submissions'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `submit-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const uploadSubmission = multer({
  storage: submissionStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: docFilter,
});

// ── Attendance justification attachment (student uploads) ──
const attendanceJustificationStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'attendance-justifications'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `attendance-justif-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const uploadAttendanceJustification = multer({
  storage: attendanceJustificationStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: docFilter,
});

// ── Message attachments (images/docs/video/audio) ──
const messageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'messages'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `message-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const messageAttachmentFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'video/mp4',
    'video/webm',
    'video/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    return cb(null, true);
  }

  cb(new Error('Type de fichier non autorisé pour les pièces jointes de message.'));
};

const uploadMessageAttachments = multer({
  storage: messageStorage,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
  fileFilter: messageAttachmentFilter,
});

module.exports = {
  uploadAvatar,
  uploadExcel,
  uploadAssignment,
  uploadSubmission,
  uploadAttendanceJustification,
  uploadNewsImage,
  uploadSchoolLogo,
  uploadMessageAttachments,
  uploadLeaveAttachments: multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) =>
        cb(null, path.join(__dirname, '..', 'uploads', 'leaves')),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `leave-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => {
      const allowed = [
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];
      if (allowed.includes(file.mimetype)) return cb(null, true);
      cb(new Error('Seules les images et documents PDF/Word sont autorisés.'));
    },
  }),
};
