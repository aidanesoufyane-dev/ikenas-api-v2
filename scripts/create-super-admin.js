require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');

const main = async () => {
  await connectDB();

  const email = String(process.env.SUPER_ADMIN_EMAIL || 'superadmin@ikenas.com').trim().toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || 'superadmin123');

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'super_admin') {
      existing.role = 'super_admin';
      existing.school = undefined;
      await existing.save();
      console.log(`Utilisateur promu en super_admin: ${email}`);
    } else {
      console.log(`Super Admin deja existant: ${email}`);
    }

    await mongoose.connection.close();
    return;
  }

  await User.create({
    firstName: 'Super',
    lastName: 'Admin',
    email,
    password,
    role: 'super_admin',
    phone: '+243000000001',
  });

  console.log(`Super Admin cree: ${email}`);
  console.log(`Mot de passe: ${password}`);

  await mongoose.connection.close();
};

main().catch(async (error) => {
  console.error('Erreur creation super admin:', error);
  await mongoose.connection.close();
  process.exit(1);
});
