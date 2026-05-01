/**
 * Script de seed - Crée les données initiales
 * Admin par défaut + données de démonstration
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');

const User = require('../models/User');
const Class = require('../models/Class');
const Section = require('../models/Section');
const Subject = require('../models/Subject');
const School = require('../models/School');

const subjectsData = [
  { name: 'Activité scientifique', code: 'AS', coefficient: 1, allClasses: true },
  { name: 'Anglais', code: 'ANG', coefficient: 1, allClasses: true },
  { name: 'Arabe', code: 'AR', coefficient: 1, allClasses: true },
  { name: 'Éducation artistique', code: 'EA', coefficient: 1, allClasses: true },
  { name: 'Éducation islamique', code: 'EI', coefficient: 1, allClasses: true },
  { name: 'Éducation Physique', code: 'EPS', coefficient: 1, allClasses: true },
  { name: 'Français', code: 'FRA', coefficient: 1, allClasses: true },
  { name: 'Histoire-Géographie', code: 'HG', coefficient: 1, specificClasses: ['4APG-1', '4APG-2', '5APG-1', '5APG-2', '6APG-1', '6APG-2'] },
  { name: 'Informatique', code: 'INFO', coefficient: 1, allClasses: true },
  { name: 'Mathématiques', code: 'MATH', coefficient: 1, allClasses: true },
];

const seed = async () => {
  await connectDB();

  const adminOnlyMode = process.argv.includes('--admin-only');
  const subjectsFrOnlyMode = process.argv.includes('--subjects-fr');
  const coreDataMode = process.argv.includes('--core-data');

  if (subjectsFrOnlyMode) {
    console.log('📚 Ajout/mise à jour des matières en français...');

    const adminUser = await User.findOne({ email: 'admin@ikenas.com' });
    if (!adminUser?.school) {
      throw new Error('Admin principal sans ecole. Lancez d\'abord un reset:core.');
    }

    const operations = subjectsData.map((subject) => ({
      updateOne: {
        filter: { code: subject.code, school: adminUser.school },
        update: {
          $set: {
            ...subject,
            isActive: true,
            school: adminUser.school,
          },
        },
        upsert: true,
      },
    }));

    await Subject.bulkWrite(operations);

    console.log(`✅ ${subjectsData.length} matières en français ajoutées/mises à jour`);
    process.exit(0);
  }

  console.log(
    adminOnlyMode
      ? '🧹 Réinitialisation de la base (admin seul)...'
      : coreDataMode
        ? '🧹 Réinitialisation de la base (admin + classes + matières)...'
        : '🌱 Début du seeding...'
  );

  // Nettoyer toutes les collections existantes
  await mongoose.connection.db.dropDatabase();

  // 1. Créer le Super Admin par défaut
  await User.create({
    firstName: 'Super',
    lastName: 'Admin',
    email: 'superadmin@ikenas.com',
    password: 'superadmin123',
    role: 'super_admin',
    phone: '+243000000001',
  });
  console.log('✅ Super Admin créé: superadmin@ikenas.com / superadmin123');

  // 2. Créer une école principale + l'admin par défaut
  const mainSchool = await School.create({
    nom: 'Ecole Principale',
    email: 'ecole.principale@ikenas.com',
    adresse: 'Adresse principale',
    telephone: '+243000000010',
  });

  const admin = await User.create({
    firstName: 'Admin',
    lastName: 'Ikenas',
    email: 'admin@ikenas.com',
    password: 'admin123',
    role: 'admin',
    phone: '+243000000000',
    school: mainSchool._id,
  });
  console.log('✅ Admin créé: admin@ikenas.com / admin123');

  if (adminOnlyMode) {
    console.log('\n✅ Base réinitialisée avec succès.');
    console.log('📧 Connexion super admin: superadmin@ikenas.com');
    console.log('🔑 Mot de passe super admin: superadmin123');
    console.log('📧 Connexion admin: admin@ikenas.com');
    console.log('🔑 Mot de passe: admin123\n');
    process.exit(0);
  }

  // 3. Créer les classes
  const classesData = [];
  for (let i = 1; i <= 6; i++) {
    classesData.push(
      { name: `${i}APG-1`, baseName: `${i}APG`, section: '1', level: 'Primaire', capacity: 40, school: mainSchool._id },
      { name: `${i}APG-2`, baseName: `${i}APG`, section: '2', level: 'Primaire', capacity: 40, school: mainSchool._id }
    );
  }
  const classes = await Class.insertMany(classesData);
  console.log(`✅ ${classes.length} classes créées`);

  const subjectsWithClasses = subjectsData.map((subject) => {
    const subjectObj = {
      name: subject.name,
      code: subject.code,
      coefficient: subject.coefficient,
      classes: [],
      school: mainSchool._id,
    };

    if (subject.allClasses) {
      subjectObj.classes = classes.map((c) => c._id);
    } else if (subject.specificClasses) {
      subjectObj.classes = classes
        .filter((c) => subject.specificClasses.includes(c.name))
        .map((c) => c._id);
    }

    return subjectObj;
  });

  if (coreDataMode) {
    const subjects = await Subject.insertMany(subjectsWithClasses);
    console.log(`✅ ${subjects.length} matières créées`);

    console.log('\n✅ Base réinitialisée avec succès (admin + classes + matières).');
    console.log('📧 Connexion super admin: superadmin@ikenas.com');
    console.log('🔑 Mot de passe super admin: superadmin123');
    console.log('📧 Connexion admin: admin@ikenas.com');
    console.log('🔑 Mot de passe: admin123\n');
    process.exit(0);
  }

  // 3. Créer les matières avec les liens aux classes
  // Créer des objets de mappage pour l'historique
  const subjects = await Subject.insertMany(subjectsWithClasses);
  console.log(`✅ ${subjects.length} matières créées avec leurs liens aux classes`);

  console.log('\n🎉 Seeding terminé avec succès !');
  console.log('📧 Connexion super admin: superadmin@ikenas.com');
  console.log('🔑 Mot de passe super admin: superadmin123');
  console.log('📧 Connexion admin: admin@ikenas.com');
  console.log('🔑 Mot de passe: admin123\n');

  process.exit(0);
};

seed().catch((err) => {
  console.error('❌ Erreur de seeding:', err);
  process.exit(1);
});
