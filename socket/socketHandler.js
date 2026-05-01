/**
 * Gestionnaire Socket.io - Communication temps réel
 * Gère les connexions, les salles (rooms) et les notifications
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const { getJwtConfig } = require('../config/jwt');

const onlineUsers = new Map();

const serializeOnlineUsers = () => Array.from(onlineUsers.entries()).map(([id, item]) => ({
  userId: id,
  fullName: item.fullName,
  role: item.role,
  connectedAt: item.connectedAt,
}));

/**
 * Initialise les événements Socket.io
 * @param {Object} io - Instance Socket.io
 */
const initSocket = (io) => {
  // Middleware d'authentification Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentification requise'));
      }

      const { secret } = getJwtConfig();
      const decoded = jwt.verify(token, secret);
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        return next(new Error('Utilisateur non trouvé'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', async (socket) => {
    console.log(`🔌 Utilisateur connecté: ${socket.user.fullName} (${socket.user.role})`);

    const userId = String(socket.user._id);
    const existing = onlineUsers.get(userId);
    onlineUsers.set(userId, {
      fullName: socket.user.fullName,
      role: socket.user.role,
      connectedAt: existing?.connectedAt || new Date(),
      socketCount: (existing?.socketCount || 0) + 1,
    });

    io.emit('presence-users', serializeOnlineUsers());
    io.emit('presence-updated', {
      userId,
      fullName: socket.user.fullName,
      role: socket.user.role,
      status: 'online',
    });

    // Rejoindre la room personnelle (pour messages individuels)
    socket.join(`user-${socket.user._id}`);

    // Rejoindre la room du rôle
    socket.join(`role-${socket.user.role}`);

    // Rejoindre les rooms de classes appropriées
    if (socket.user.role === 'student') {
      const student = await Student.findOne({ user: socket.user._id });
      if (student) {
        socket.join(`class-${student.classe}`);
      }
    } else if (socket.user.role === 'teacher') {
      const teacher = await Teacher.findOne({ user: socket.user._id });
      if (teacher) {
        teacher.classes.forEach((classeId) => {
          socket.join(`class-${classeId}`);
        });
      }
    }

    // Écouter l'envoi de messages en temps réel
    socket.on('send-message', (data) => {
      const { recipientType, targetClass, targetUser, content } = data;

      const messageData = {
        sender: {
          _id: socket.user._id,
          firstName: socket.user.firstName,
          lastName: socket.user.lastName,
          role: socket.user.role,
        },
        content,
        recipientType,
        createdAt: new Date(),
      };

      if (recipientType === 'broadcast') {
        socket.broadcast.emit('new-message', messageData);
      } else if (recipientType === 'class' && targetClass) {
        socket.to(`class-${targetClass}`).emit('new-message', messageData);
      } else if (recipientType === 'individual' && targetUser) {
        socket.to(`user-${targetUser}`).emit('new-message', messageData);
      }
    });

    // Notification temps réel
    socket.on('notification', (data) => {
      if (data.targetRole) {
        socket.to(`role-${data.targetRole}`).emit('notification', data);
      } else {
        socket.broadcast.emit('notification', data);
      }
    });

    // Indicateur de frappe
    socket.on('typing', (data) => {
      const payload = {
        userId: String(socket.user._id),
        fullName: socket.user.fullName,
        role: socket.user.role,
        isTyping: Boolean(data?.isTyping),
        conversationKey: data?.conversationKey || null,
      };

      if (data?.targetClass) {
        socket.to(`class-${data.targetClass}`).emit('typing', payload);
      }

      if (data?.targetUser) {
        socket.to(`user-${data.targetUser}`).emit('typing', payload);
      }

      if (!data?.targetClass && !data?.targetUser) {
        socket.broadcast.emit('typing', payload);
      }
    });

    // Déconnexion
    socket.on('disconnect', () => {
      console.log(`🔌 Utilisateur déconnecté: ${socket.user.fullName}`);

      const disconnectedUserId = String(socket.user._id);
      const current = onlineUsers.get(disconnectedUserId);
      if (!current) return;

      if ((current.socketCount || 1) > 1) {
        onlineUsers.set(disconnectedUserId, {
          ...current,
          socketCount: current.socketCount - 1,
        });
      } else {
        onlineUsers.delete(disconnectedUserId);
        io.emit('presence-updated', {
          userId: disconnectedUserId,
          fullName: socket.user.fullName,
          role: socket.user.role,
          status: 'offline',
        });
      }

      io.emit('presence-users', serializeOnlineUsers());
    });
  });
};

module.exports = initSocket;
