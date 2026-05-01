/**
 * seed-notifications.js
 * Creates one test notification per type so every tab in the
 * notification center has visible data.
 *
 * Usage:  node scripts/seed-notifications.js
 */
require('dotenv').config();
const connectDB   = require('../config/db');
const Notification = require('../models/Notification');
const Class        = require('../models/Class');
const User         = require('../models/User');

async function run() {
  await connectDB();

  // Pick a class and admin user for seeding
  const firstClass = await Class.findOne();
  const admin      = await User.findOne({ role: 'admin' });
  const classeId   = firstClass?._id || null;
  const adminId    = admin?._id || null;

  const now = new Date();
  const seeds = [
    {
      type: 'exam_scheduled',
      title: 'Examen planifié',
      message: 'Contrôle de Mathématiques le ' + new Date(now.getTime() + 86400000 * 3).toLocaleDateString('fr-FR') + ' de 08:00 à 09:30.',
      link: '/student/exams',
      recipientClass: classeId,
    },
    {
      type: 'grade_added',
      title: 'Notes publiées',
      message: 'Votre enseignant a publié des notes pour Français — CC1 S1.',
      link: '/student/notes',
      recipientClass: classeId,
    },
    {
      type: 'assignment_created',
      title: 'Nouveau devoir',
      message: 'Devoir de Sciences — date limite le ' + new Date(now.getTime() + 86400000 * 7).toLocaleDateString('fr-FR') + '.',
      link: '/student/assignments',
      recipientClass: classeId,
    },
    {
      type: 'event_created',
      title: 'Événement scolaire',
      message: 'Journée portes ouvertes le ' + new Date(now.getTime() + 86400000 * 10).toLocaleDateString('fr-FR') + '.',
      link: '/events',
      recipientRole: 'student',
    },
    {
      type: 'payment_due_reminder',
      title: 'Rappel de paiement',
      message: 'Votre prochain versement de scolarité est dû dans 7 jours.',
      link: '/payments',
      recipientRole: 'student',
    },
    {
      type: 'absence_approved',
      title: 'Absence justifiée',
      message: 'Votre absence du ' + now.toLocaleDateString('fr-FR') + ' a été approuvée.',
      link: '/student/absences',
      recipientRole: 'student',
    },
    {
      type: 'general',
      title: 'Message de l\'administration',
      message: 'L\'école sera fermée le prochain vendredi pour une journée pédagogique.',
      link: null,
      recipientRole: null,
      recipient: null,
      recipientClass: null,
    },
  ];

  let created = 0;
  for (const seed of seeds) {
    await Notification.create({
      type: seed.type,
      title: seed.title,
      message: seed.message,
      link: seed.link ?? null,
      recipient: seed.recipient ?? null,
      recipientRole: seed.recipientRole ?? null,
      recipientClass: seed.recipientClass ?? null,
      createdBy: adminId,
    });
    created++;
    console.log(`✅ [${seed.type}] ${seed.title}`);
  }

  console.log(`\nDone — created ${created} test notifications.`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
