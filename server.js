/**
 * Serveur principal - Ikenas Gestion App
 * Point d'entrée de l'application backend
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const initSocket = require('./socket/socketHandler');
const { getJwtConfig } = require('./config/jwt');
const { requestContext } = require('./utils/tenantContext');
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./openapi.yaml");

// Connexion à MongoDB
connectDB();

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);

// Déterminer les origines autorisées pour CORS.
const getConfiguredOrigins = () => {
  const raw = process.env.CLIENT_URLS || process.env.CLIENT_URL || '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const isOriginAllowed = (origin) => {
  if (!origin) {
    return true;
  }

  const configuredOrigins = getConfiguredOrigins();
  if (configuredOrigins.length > 0) {
    return configuredOrigins.includes(origin);
  }

  // Fallback local dev/réseau si aucune origine de prod n'est configurée.
  const localPatterns = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    /^http:\/\/(192\.168|10\.0|172\.1[6-9]|172\.2[0-9]|172\.3[0-1])\.\d{1,3}\.\d{1,3}:5173$/,
  ];

  return localPatterns.some((pattern) => {
    if (typeof pattern === 'string') {
      return pattern === origin;
    }
    return pattern.test(origin);
  });
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origine non autorisée par CORS: ${origin}`));
  },
  credentials: true,
};

// Socket.io
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Initialiser Socket.io
initSocket(io);

// ========== MIDDLEWARES GLOBAUX ==========

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: false,
}));

// Compression
app.use(compression());

// CORS
app.use(
  cors(corsOptions)
);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContext);

// Logger HTTP (développement)
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Rate limiting — auth endpoints only (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

const jwtConfig = getJwtConfig();
if (jwtConfig.isFallback) {
  console.warn('JWT_SECRET absent, utilisation du secret de développement intégré.');
}

// Serve uploaded files (avatars etc.)
const path = require('path');
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_URL || 'http://localhost:5173');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

// Attacher l'instance io à chaque requête (pour les controllers)
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ========== ROUTES API ==========
app.use('/api/behavior', require('./routes/behaviorRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/schools', require('./routes/schoolRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/students', require('./routes/studentRoutes'));
app.use('/api/teachers', require('./routes/teacherRoutes'));
app.use('/api/staff', require('./routes/staffRoutes'));
app.use('/api/classes', require('./routes/classRoutes'));
app.use('/api/sections', require('./routes/sectionRoutes'));
app.use('/api/subjects', require('./routes/subjectRoutes'));
app.use('/api/schedules', require('./routes/scheduleRoutes'));
app.use('/api/attendances', require('./routes/attendanceRoutes'));
app.use('/api/events', require('./routes/eventRoutes'));
app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/assignments', require('./routes/assignmentRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/exams', require('./routes/examRoutes'));
app.use('/api/news', require('./routes/newsRoutes'));
app.use('/api/leave-requests', require('./routes/leaveRequestRoutes'));
app.use('/api/transports',    require('./routes/transportRoutes'));
app.use('/api/transport',     require('./routes/transportRoutes'));
app.use('/api/notes', require('./routes/noteRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/calendar', require('./routes/calendarRoutes'));
app.use('/api/profile',  require('./routes/profileRoutes'));
app.use('/api/posts',    require('./routes/postsRoutes'));
app.use('/api/security', require('./routes/securityRoutes'));
// ========== Swagger API DOCS ==========
// FORCE override
const finalSwaggerDoc = {
  ...swaggerDocument,
  servers: [
    {
      url: process.env.API_URL || "http://localhost:5000",
    },
  ],
};

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(finalSwaggerDoc, {
    swaggerOptions: {
      url: null,
    },
  }));
app.get("/debug-swagger", (req, res) => {
  res.json(finalSwaggerDoc);
});
// Route de santé
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Ikenas Gestion API is running',
    timestamp: new Date().toISOString(),
  });
});

// 404 - Route non trouvée
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} non trouvée.`,
  });
});

// Gestion centralisée des erreurs
app.use(errorHandler);

// ========== DÉMARRAGE DU SERVEUR ==========
const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const networkIP = Object.values(os.networkInterfaces())
    .flat()
    .find(ip => ip.family === 'IPv4' && !ip.internal)?.address || 'localhost';
  
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🏫 Ikenas Gestion API                 ║
  ║   Port: ${PORT}                            ║
  ║   Env:  ${process.env.NODE_ENV || 'development'}                   ║
  ║   Local: http://localhost:${PORT}          ║
  ║   Network: http://${networkIP}:${PORT}       ║
  ╚══════════════════════════════════════════╝
  `);
});

// Gestion des erreurs non capturées
process.on('unhandledRejection', (err) => {
  console.error('❌ Erreur non gérée:', err.message);
  server.close(() => process.exit(1));
});
