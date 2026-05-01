const Notification = require('../models/Notification');
const User = require('../models/User');

// firebase-admin is optional — gracefully degrade if not installed or not configured
let firebaseAdmin = null;
try {
  firebaseAdmin = require('firebase-admin');
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }
    console.log('✅ Firebase Admin initialized — push notifications enabled');
  } else {
    firebaseAdmin = null;
  }
} catch (_) {
  firebaseAdmin = null;
}

const sendFCM = async (tokens, title, body) => {
  if (!firebaseAdmin || !tokens || tokens.length === 0) return;
  const valid = [...new Set(tokens.filter(Boolean))];
  if (valid.length === 0) return;
  try {
    await firebaseAdmin.messaging().sendEachForMulticast({
      tokens: valid,
      notification: { title, body },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
};

/**
 * Creates a notification in DB, emits via socket.io, and sends FCM push.
 * @param {Object} io   - Socket.io server instance (req.io)
 * @param {Object} opts
 *   type, title, message, link?,
 *   recipient? (userId), recipientRole?, recipientClass?, createdBy?
 */
const sendNotification = async (io, opts) => {
  try {
    const notif = await Notification.create({
      type: opts.type,
      title: opts.title,
      message: opts.message,
      link: opts.link || null,
      recipient: opts.recipient || null,
      recipientRole: opts.recipientRole || null,
      recipientClass: opts.recipientClass || null,
      createdBy: opts.createdBy || null,
    });

    const payload = {
      _id: notif._id,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      link: notif.link,
      createdAt: notif.createdAt,
    };

    // ── Socket.io real-time ──────────────────────────────────────────────────
    if (io) {
      if (opts.recipient) {
        io.to(`user-${opts.recipient}`).emit('notification', payload);
      } else if (opts.recipientClass) {
        io.to(`class-${opts.recipientClass}`).emit('notification', payload);
      } else if (opts.recipientRole) {
        io.to(`role-${opts.recipientRole}`).emit('notification', payload);
      } else {
        io.emit('notification', payload);
      }
    }

    // ── FCM push to device ───────────────────────────────────────────────────
    if (firebaseAdmin) {
      let tokens = [];

      if (opts.recipient) {
        const user = await User.findById(opts.recipient).select('fcmTokens');
        tokens = user?.fcmTokens || [];
      } else if (opts.recipientRole) {
        const users = await User.find({ role: opts.recipientRole, isActive: true }).select('fcmTokens');
        tokens = users.flatMap(u => u.fcmTokens || []);
      } else if (opts.recipientClass) {
        const Student = require('../models/Student');
        const students = await Student.find({ classe: opts.recipientClass })
          .populate('user', 'fcmTokens')
          .populate({ path: 'parent', populate: { path: 'user', select: 'fcmTokens' } });
        const studentTokens = students.flatMap(s => s.user?.fcmTokens || []);
        const parentTokens = students.flatMap(s => s.parent?.user?.fcmTokens || []);
        tokens = [...studentTokens, ...parentTokens];
      } else {
        const users = await User.find({ isActive: true }).select('fcmTokens');
        tokens = users.flatMap(u => u.fcmTokens || []);
      }

      await sendFCM(tokens, opts.title, opts.message);
    }

    return notif;
  } catch (err) {
    console.error('Erreur envoi notification:', err.message);
  }
};

module.exports = { sendNotification };
