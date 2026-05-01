const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const Subject = require('../models/Subject');
const Class = require('../models/Class');
const SubjectComponents = require('../models/SubjectComponents');

const analysisData = require('../notes-excel-analysis-report.json');

/**
 * Mapping from Excel matière names (Arabic/French) to database subject codes
 */
const subjectCodeMapping = {
  'الرياضيات': 'MATH',
  'اللغة الفرنسية': 'FRA',
  'اللغة الإنجليزية': 'ANG',
  'الاجتماعيات': 'HG',
  'التربية البدنية': 'EPS',
  'المعلوميات': 'INFO',
  'اللغة العربية': 'AR',
  'التربية الإسلامية': 'EI',
  'التربية الفنية': 'EA',
  'النشاط العلمي': 'AS',
};

/**
 * Seed SubjectComponents from Excel analysis
 * Each template (niveau + matiere + semestre) gets stored with its components
 */
async function seedSubjectComponents() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB');

    // Get unique (niveau, matiere) combinations from analysis
    const classNameMap = {
      '1APG': ['1APG-1', '1APG-2'],
      '2APG': ['2APG-1', '2APG-2'],
      '3APG': ['3APG-1', '3APG-2'],
      '4APG': ['4APG-1', '4APG-2'],
      '5APG': ['5APG-1', '5APG-2'],
      '6APG': ['6APG-1', '6APG-2'],
    };

    // Group templates by (niveau, matiere, semestre) to handle conflicts
    const templates = {};
    analysisData.principal.forEach((entry) => {
      const key = `${entry.niveau}|${entry.matiere}|${entry.semestre}`;
      // Take the max by number of files (most common template)
      if (!templates[key] || entry.nbFichiers > templates[key].nbFichiers) {
        templates[key] = entry;
      }
    });

    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const template of Object.values(templates)) {
      try {
        const { niveau, matiere, semestre, composantes } = template;

        // Map matière name to subject code
        const subjectCode = subjectCodeMapping[matiere];
        if (!subjectCode) {
          console.warn(`⚠ Matière ${matiere} not mapped, skipping`);
          skippedCount++;
          continue;
        }

        // Find subject by code
        const subject = await Subject.findOne({ code: subjectCode, isActive: true });
        if (!subject) {
          console.warn(`⚠ Subject code ${subjectCode} (${matiere}) not found, skipping`);
          skippedCount++;
          continue;
        }

        // Get class names for this niveau
        const classNames = classNameMap[niveau];
        if (!classNames) {
          console.warn(`⚠ Niveau ${niveau} not mapped, skipping`);
          skippedCount++;
          continue;
        }

        // Find classes
        const classes = await Class.find({
          name: { $in: classNames },
          isActive: true,
        });

        if (classes.length === 0) {
          console.warn(`⚠ Classes ${classNames.join(', ')} not found for ${niveau}`);
          skippedCount++;
          continue;
        }

        // Create/update SubjectComponents for each class
        for (const classe of classes) {
          // Map component names to keys
          const components = composantes.map((name, idx) => ({
            key: `comp_${idx}`,
            name,
            weight: 1,
          }));

          const existingRecord = await SubjectComponents.findOne({
            subject: subject._id,
            classe: classe._id,
            semester: semestre,
            isActive: true,
          });

          if (existingRecord) {
            // Update existing
            existingRecord.components = components;
            await existingRecord.save();
            console.log(
              `✓ Updated: ${subject.code}/${classe.name}/${semestre} (${composantes.length} components)`
            );
          } else {
            // Create new
            const doc = new SubjectComponents({
              subject: subject._id,
              classe: classe._id,
              semester: semestre,
              components,
            });
            await doc.save();
            createdCount++;
            console.log(
              `✓ Created: ${subject.code}/${classe.name}/${semestre} (${composantes.length} components)`
            );
          }
        }
      } catch (err) {
        errorCount++;
        console.error(`✗ Error processing template:`, template, err.message);
      }
    }

    console.log(`\n✓ Seeding complete: ${createdCount} created, ${skippedCount} skipped, ${errorCount} errors`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('✗ Fatal error:', err.message);
    process.exit(1);
  }
}

seedSubjectComponents();
