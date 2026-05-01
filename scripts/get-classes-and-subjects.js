/**
 * Script pour récupérer toutes les classes et matières de la base de données
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');
const Subject = require('../models/Subject');

const getClassesAndSubjects = async () => {
  try {
    // Connexion à MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB\n');

    // Récupérer les classes
    const classes = await Class.find({ isActive: true }).sort({ name: 1 });
    console.log('📚 CLASSES:');
    console.log('='.repeat(50));
    if (classes.length === 0) {
      console.log('Aucune classe trouvée');
    } else {
      classes.forEach((cls, index) => {
        console.log(`${index + 1}. ${cls.name}`);
        console.log(`   - Niveau: ${cls.level || 'Non spécifié'}`);
        console.log(`   - Capacité: ${cls.capacity} élèves`);
        if (cls.description) console.log(`   - Description: ${cls.description}`);
        console.log();
      });
    }

    // Récupérer les matières
    const subjects = await Subject.find({ isActive: true })
      .populate('classes', 'name')
      .sort({ name: 1 });
    
    console.log('\n📖 MATIÈRES:');
    console.log('='.repeat(50));
    if (subjects.length === 0) {
      console.log('Aucune matière trouvée');
    } else {
      subjects.forEach((subject, index) => {
        console.log(`${index + 1}. ${subject.name}`);
        if (subject.code) console.log(`   - Code: ${subject.code}`);
        console.log(`   - Coefficient: ${subject.coefficient}`);
        if (subject.description) console.log(`   - Description: ${subject.description}`);
        if (subject.classes && subject.classes.length > 0) {
          console.log(`   - Classes: ${subject.classes.map(c => c.name).join(', ')}`);
        }
        console.log();
      });
    }

    console.log('\n📊 RÉSUMÉ:');
    console.log(`- Total de classes: ${classes.length}`);
    console.log(`- Total de matières: ${subjects.length}`);

    await mongoose.connection.close();
    console.log('\n✅ Déconnecté de MongoDB');
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
};

getClassesAndSubjects();
