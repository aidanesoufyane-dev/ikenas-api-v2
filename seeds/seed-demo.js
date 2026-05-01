/**
 * seed-demo.js — Full demo dataset
 * 1 admin, 1 cashier, 5 teachers, 30 students
 * Includes grades, assignments, payments, notifications
 *
 * Usage:  node seeds/seed-demo.js
 * WARNING: drops the entire database first
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User          = require('../models/User');
const Class         = require('../models/Class');
const Subject       = require('../models/Subject');
const Teacher       = require('../models/Teacher');
const Student       = require('../models/Student');
const NoteSheet     = require('../models/NoteSheet');
const NoteEntry     = require('../models/NoteEntry');
const Assignment    = require('../models/Assignment');
const StudentPayment = require('../models/StudentPayment');
const Notification  = require('../models/Notification');

// ─── helpers ──────────────────────────────────────────────────────────────────
let invoiceSeq = 1;
let receiptSeq = 1;
const nextInvoice = () => `INV-2025-${String(invoiceSeq++).padStart(4, '0')}`;
const nextReceipt = () => `REC-2025-${String(receiptSeq++).padStart(4, '0')}`;

// Deterministic score: varies per student+subject so every student has different grades
const score = (studentIdx, subjectOffset, sheet) =>
  Math.min(20, Math.max(7, 9 + ((studentIdx * 3 + subjectOffset * 7 + sheet * 5) % 12)));

// ─── raw data ─────────────────────────────────────────────────────────────────
const SUBJECTS_DATA = [
  { name: 'Mathématiques',       code: 'MATH', coefficient: 2 },
  { name: 'Français',            code: 'FRA',  coefficient: 2 },
  { name: 'Arabe',               code: 'AR',   coefficient: 2 },
  { name: 'Anglais',             code: 'ANG',  coefficient: 1 },
  { name: 'Histoire-Géographie', code: 'HG',   coefficient: 1 },
  { name: 'Activité scientifique', code: 'AS', coefficient: 1 },
  { name: 'Informatique',        code: 'INFO', coefficient: 1 },
  { name: 'Éducation Physique',  code: 'EPS',  coefficient: 1 },
  { name: 'Éducation islamique', code: 'EI',   coefficient: 1 },
  { name: 'Éducation artistique', code: 'EA',  coefficient: 1 },
];

const TEACHERS_RAW = [
  {
    firstName: 'Karim',  lastName: 'Benali',     email: 'k.benali@ikenas.com',
    phone: '+213550100001', employeeId: 'TCH-001',
    specialization: 'Mathématiques & Sciences',
    subjects: ['MATH', 'AS'],
    classNames: ['5APG-1', '5APG-2', '6APG-1', '6APG-2'],
  },
  {
    firstName: 'Fatima', lastName: 'Ouali',       email: 'f.ouali@ikenas.com',
    phone: '+213550100002', employeeId: 'TCH-002',
    specialization: 'Langues',
    subjects: ['FRA', 'AR'],
    classNames: ['4APG-1', '4APG-2', '5APG-1', '5APG-2'],
  },
  {
    firstName: 'Mohamed', lastName: 'Cherif',     email: 'm.cherif@ikenas.com',
    phone: '+213550100003', employeeId: 'TCH-003',
    specialization: 'Histoire & Anglais',
    subjects: ['ANG', 'HG'],
    classNames: ['5APG-2', '6APG-1', '6APG-2'],
  },
  {
    firstName: 'Nadia',  lastName: 'Boumediene',  email: 'n.boumediene@ikenas.com',
    phone: '+213550100004', employeeId: 'TCH-004',
    specialization: 'Informatique & Sciences',
    subjects: ['INFO', 'EI'],
    classNames: ['3APG-1', '3APG-2', '4APG-1', '4APG-2'],
  },
  {
    firstName: 'Youssef', lastName: 'Hamidi',     email: 'y.hamidi@ikenas.com',
    phone: '+213550100005', employeeId: 'TCH-005',
    specialization: 'Éducation Physique & Arts',
    subjects: ['EPS', 'EA'],
    classNames: ['4APG-1', '4APG-2', '5APG-1', '5APG-2', '6APG-1', '6APG-2'],
  },
];

const STUDENTS_RAW = [
  // ── 6APG-1 ──
  { firstName: 'Amina',        lastName: 'Boudiaf',     gender: 'F', dob: '2012-03-15', class: '6APG-1', matric: 'STU-001', parent: 'Hocine Boudiaf',     parentPhone: '+213550200001' },
  { firstName: 'Khaled',       lastName: 'Meziane',     gender: 'M', dob: '2012-07-22', class: '6APG-1', matric: 'STU-002', parent: 'Mourad Meziane',     parentPhone: '+213550200002' },
  { firstName: 'Sara',         lastName: 'Laib',        gender: 'F', dob: '2011-11-05', class: '6APG-1', matric: 'STU-003', parent: 'Djamel Laib',        parentPhone: '+213550200003' },
  { firstName: 'Yacine',       lastName: 'Boudali',     gender: 'M', dob: '2012-01-30', class: '6APG-1', matric: 'STU-004', parent: 'Rachid Boudali',     parentPhone: '+213550200004' },
  { firstName: 'Nour',         lastName: 'Ramdane',     gender: 'F', dob: '2012-06-12', class: '6APG-1', matric: 'STU-005', parent: 'Kamel Ramdane',      parentPhone: '+213550200005' },
  // ── 6APG-2 ──
  { firstName: 'Adam',         lastName: 'Belkacem',    gender: 'M', dob: '2012-04-08', class: '6APG-2', matric: 'STU-006', parent: 'Ali Belkacem',       parentPhone: '+213550200006' },
  { firstName: 'Lyna',         lastName: 'Kebbab',      gender: 'F', dob: '2011-12-19', class: '6APG-2', matric: 'STU-007', parent: 'Omar Kebbab',        parentPhone: '+213550200007' },
  { firstName: 'Rayan',        lastName: 'Mammeri',     gender: 'M', dob: '2012-08-02', class: '6APG-2', matric: 'STU-008', parent: 'Samir Mammeri',      parentPhone: '+213550200008' },
  { firstName: 'Ines',         lastName: 'Hamdi',       gender: 'F', dob: '2012-02-14', class: '6APG-2', matric: 'STU-009', parent: 'Nacer Hamdi',        parentPhone: '+213550200009' },
  { firstName: 'Bilal',        lastName: 'Touati',      gender: 'M', dob: '2011-10-27', class: '6APG-2', matric: 'STU-010', parent: 'Farid Touati',       parentPhone: '+213550200010' },
  // ── 5APG-1 ──
  { firstName: 'Aya',          lastName: 'Saidi',       gender: 'F', dob: '2013-05-17', class: '5APG-1', matric: 'STU-011', parent: 'Abdelkader Saidi',   parentPhone: '+213550200011' },
  { firstName: 'Hakim',        lastName: 'Bensalem',    gender: 'M', dob: '2013-09-03', class: '5APG-1', matric: 'STU-012', parent: 'Mounir Bensalem',    parentPhone: '+213550200012' },
  { firstName: 'Meriem',       lastName: 'Kadi',        gender: 'F', dob: '2013-01-21', class: '5APG-1', matric: 'STU-013', parent: 'Tarek Kadi',         parentPhone: '+213550200013' },
  { firstName: 'Ismail',       lastName: 'Djamel',      gender: 'M', dob: '2013-07-09', class: '5APG-1', matric: 'STU-014', parent: 'Ahmed Djamel',       parentPhone: '+213550200014' },
  { firstName: 'Chaima',       lastName: 'Ferhat',      gender: 'F', dob: '2013-03-28', class: '5APG-1', matric: 'STU-015', parent: 'Sofiane Ferhat',     parentPhone: '+213550200015' },
  // ── 5APG-2 ──
  { firstName: 'Zakaria',      lastName: 'Brahimi',     gender: 'M', dob: '2013-11-14', class: '5APG-2', matric: 'STU-016', parent: 'Yacine Brahimi',     parentPhone: '+213550200016' },
  { firstName: 'Malak',        lastName: 'Tizi',        gender: 'F', dob: '2013-04-06', class: '5APG-2', matric: 'STU-017', parent: 'Redouane Tizi',      parentPhone: '+213550200017' },
  { firstName: 'Nassim',       lastName: 'Haddad',      gender: 'M', dob: '2013-08-23', class: '5APG-2', matric: 'STU-018', parent: 'Amar Haddad',        parentPhone: '+213550200018' },
  { firstName: 'Sabrina',      lastName: 'Latreche',    gender: 'F', dob: '2013-02-11', class: '5APG-2', matric: 'STU-019', parent: 'Lamine Latreche',    parentPhone: '+213550200019' },
  { firstName: 'Sofiane',      lastName: 'Benaicha',    gender: 'M', dob: '2013-06-30', class: '5APG-2', matric: 'STU-020', parent: 'Hocine Benaicha',    parentPhone: '+213550200020' },
  // ── 4APG-1 ──
  { firstName: 'Hana',         lastName: 'Zitouni',     gender: 'F', dob: '2014-03-07', class: '4APG-1', matric: 'STU-021', parent: 'Mustapha Zitouni',   parentPhone: '+213550200021' },
  { firstName: 'Amine',        lastName: 'Khettab',     gender: 'M', dob: '2014-10-19', class: '4APG-1', matric: 'STU-022', parent: 'Zoubir Khettab',     parentPhone: '+213550200022' },
  { firstName: 'Yasmine',      lastName: 'Bekkouche',   gender: 'F', dob: '2014-06-25', class: '4APG-1', matric: 'STU-023', parent: 'Faycal Bekkouche',   parentPhone: '+213550200023' },
  { firstName: 'Ayoub',        lastName: 'Guerrah',     gender: 'M', dob: '2014-01-13', class: '4APG-1', matric: 'STU-024', parent: 'Khaled Guerrah',     parentPhone: '+213550200024' },
  { firstName: 'Douaa',        lastName: 'Boudjenah',   gender: 'F', dob: '2014-08-04', class: '4APG-1', matric: 'STU-025', parent: 'Nabil Boudjenah',    parentPhone: '+213550200025' },
  // ── 4APG-2 ──
  { firstName: 'Kamil',        lastName: 'Mekki',       gender: 'M', dob: '2014-05-22', class: '4APG-2', matric: 'STU-026', parent: 'Rachid Mekki',       parentPhone: '+213550200026' },
  { firstName: 'Noura',        lastName: 'Bouhadja',    gender: 'F', dob: '2014-09-16', class: '4APG-2', matric: 'STU-027', parent: 'Djamal Bouhadja',    parentPhone: '+213550200027' },
  { firstName: 'Walid',        lastName: 'Senouci',     gender: 'M', dob: '2014-02-28', class: '4APG-2', matric: 'STU-028', parent: 'Abdelaziz Senouci',  parentPhone: '+213550200028' },
  { firstName: 'Imene',        lastName: 'Chegrani',    gender: 'F', dob: '2014-11-09', class: '4APG-2', matric: 'STU-029', parent: 'Bachir Chegrani',    parentPhone: '+213550200029' },
  { firstName: 'Faris',        lastName: 'Benmessaoud', gender: 'M', dob: '2014-07-18', class: '4APG-2', matric: 'STU-030', parent: 'Aziz Benmessaoud',   parentPhone: '+213550200030' },
];

// ─── main ─────────────────────────────────────────────────────────────────────
const seed = async () => {
  await connectDB();
  console.log('🗑️  Dropping database...');
  await mongoose.connection.db.dropDatabase();

  // 1 ─ Admin + Cashier
  const adminUser = await User.create({
    firstName: 'Admin', lastName: 'Ikenas',
    email: 'admin@ikenas.com', password: 'Admin1234',
    role: 'admin', phone: '+213550000000',
  });
  const cashierUser = await User.create({
    firstName: 'Rachid', lastName: 'Benali',
    email: 'cashier@ikenas.com', password: 'Cashier1234',
    role: 'cashier', phone: '+213550000001',
  });
  console.log('✅ Admin + Cashier created');

  // 2 ─ Classes (12 classes: 1APG-1 … 6APG-2)
  const classesData = [];
  for (let i = 1; i <= 6; i++) {
    classesData.push(
      { name: `${i}APG-1`, baseName: `${i}APG`, section: '1', level: 'Primaire', capacity: 40 },
      { name: `${i}APG-2`, baseName: `${i}APG`, section: '2', level: 'Primaire', capacity: 40 },
    );
  }
  const classes = await Class.insertMany(classesData);
  const classMap = {};
  classes.forEach(c => { classMap[c.name] = c; });
  console.log(`✅ ${classes.length} classes created`);

  // 3 ─ Subjects
  const allClassIds = classes.map(c => c._id);
  const subjects = await Subject.insertMany(
    SUBJECTS_DATA.map(s => ({ ...s, classes: allClassIds }))
  );
  const subjMap = {};
  subjects.forEach(s => { subjMap[s.code] = s; });
  console.log(`✅ ${subjects.length} subjects created`);

  // 4 ─ Teachers
  const teacherUsers = [];
  for (const td of TEACHERS_RAW) {
    const user = await User.create({
      firstName: td.firstName, lastName: td.lastName,
      email: td.email, password: 'Teacher1234',
      role: 'teacher', phone: td.phone,
    });
    const teacher = await Teacher.create({
      user: user._id,
      employeeId: td.employeeId,
      specialization: td.specialization,
      phone: td.phone,
      hireDate: new Date('2023-09-01'),
      subjects: td.subjects.map(code => subjMap[code]._id),
      classes: td.classNames.filter(n => classMap[n]).map(n => classMap[n]._id),
    });
    teacherUsers.push({ user, teacher, ...td });
  }
  console.log(`✅ ${teacherUsers.length} teachers created`);

  // 5 ─ Students
  const studentDocs = [];
  for (const sd of STUDENTS_RAW) {
    const email = `${sd.matric.toLowerCase().replace('-', '')}@ikenas.com`; // stu001@ikenas.com
    const user = await User.create({
      firstName: sd.firstName, lastName: sd.lastName,
      email, password: 'Student1234',
      role: 'student', phone: sd.parentPhone,
    });
    const student = await Student.create({
      user: user._id,
      matricule: sd.matric,
      dateOfBirth: new Date(sd.dob),
      gender: sd.gender,
      classe: classMap[sd.class]._id,
      parentName: sd.parent,
      parentPhone: sd.parentPhone,
      address: 'Alger, Algerie',
      enrollmentDate: new Date('2024-09-01'),
    });
    studentDocs.push({ user, student, email, ...sd });
  }
  console.log(`✅ ${studentDocs.length} students created`);

  // 6 ─ Note sheets + entries
  // Grade subjects × 6 active classes × 2 sheets (CC1 + CC2) per semester
  const GRADE_CLASSES   = ['6APG-1', '6APG-2', '5APG-1', '5APG-2', '4APG-1', '4APG-2'];
  const GRADE_SUBJECTS  = ['MATH', 'FRA', 'AR', 'ANG', 'AS'];

  let sheetCount = 0;
  let entryCount = 0;

  for (const className of GRADE_CLASSES) {
    const classe = classMap[className];
    const studentsInClass = studentDocs.filter(s => s.class === className);

    for (let si = 0; si < GRADE_SUBJECTS.length; si++) {
      const subjCode = GRADE_SUBJECTS[si];
      const subject  = subjMap[subjCode];
      const teacher  = teacherUsers.find(
        t => t.subjects.includes(subjCode) && t.classNames.includes(className)
      );
      const teacherRef = teacher ? teacher.teacher._id : null;

      for (let sheetNum = 1; sheetNum <= 2; sheetNum++) {
        const semester = 'S1';
        const sheet = await NoteSheet.create({
          title: `CC${sheetNum} - ${subject.name} - ${className} - ${semester}`,
          type: 'controle_continue',
          classe: classe._id,
          subject: subject._id,
          teacher: teacherRef,
          semester,
          components: [
            { key: 'participation', name: 'Participation' },
            { key: 'devoir',        name: 'Devoir' },
          ],
          isActive: true,
          visible: true,
          createdBy: adminUser._id,
        });
        sheetCount++;

        for (let idx = 0; idx < studentsInClass.length; idx++) {
          const sd = studentsInClass[idx];
          const studentIdx = parseInt(sd.matric.replace('STU-', ''), 10) - 1;
          const s = score(studentIdx, si, sheetNum);
          const half = Math.round(s / 2);
          await NoteEntry.create({
            sheet: sheet._id,
            student: sd.student._id,
            components: [
              { key: 'participation', name: 'Participation', score: half },
              { key: 'devoir',        name: 'Devoir',        score: s - half },
            ],
            score: s,
            maxScore: 20,
            semester,
          });
          entryCount++;
        }
      }
    }
  }
  console.log(`✅ ${sheetCount} note sheets + ${entryCount} grade entries created`);

  // 7 ─ Assignments
  const ASSIGNMENTS = [
    { title: 'Exercices fractions – Chapitre 3',  desc: 'Résoudre les exercices 1 à 15 p.48.',      subjCode: 'MATH', className: '6APG-1', tIdx: 0, days: 7  },
    { title: 'Rédaction : Ma journée préférée',   desc: 'Rédaction de 15 lignes minimum.',           subjCode: 'FRA',  className: '5APG-1', tIdx: 1, days: 5  },
    { title: 'Vocabulaire anglais – Unit 4',      desc: 'Apprendre les 20 nouveaux mots, ex. A–C.', subjCode: 'ANG',  className: '6APG-2', tIdx: 2, days: 3  },
    { title: 'Problèmes de géométrie',            desc: 'Résoudre les 10 problèmes distribués.',    subjCode: 'MATH', className: '5APG-1', tIdx: 0, days: 10 },
    { title: 'Lecture : Les saisons',             desc: "Lire 'Les quatre saisons', répondre Q1–Q8.", subjCode: 'FRA', className: '4APG-1', tIdx: 1, days: 4  },
    { title: 'Exercice Word – Mise en forme',     desc: 'Créer un doc Word (titre, tableau, image).', subjCode: 'INFO', className: '4APG-2', tIdx: 3, days: 6 },
  ];

  for (const a of ASSIGNMENTS) {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + a.days);
    await Assignment.create({
      title: a.title, description: a.desc,
      classe: classMap[a.className]._id,
      subject: subjMap[a.subjCode]._id,
      teacher: teacherUsers[a.tIdx].teacher._id,
      deadline, isActive: true,
    });
  }
  console.log(`✅ ${ASSIGNMENTS.length} assignments created`);

  // 8 ─ Payments (inscription + 3 monthly scolarite per student)
  const INSCRIPTION_AMOUNT = 15000;
  const SCOLARITE_MONTHLY  = 3500;

  // Deterministic paid/unpaid pattern based on student index
  // indices 0,3,6,9,… unpaid inscription; 1,7,13,… unpaid some months
  const isPaid = (studentIdx, seed) => (studentIdx + seed) % 5 !== 0;

  for (let i = 0; i < studentDocs.length; i++) {
    const sd  = studentDocs[i];
    const cls = classMap[sd.class];

    // ── inscription ──
    const inscPaid = isPaid(i, 0);
    const inscDoc = {
      student: sd.student._id, classe: cls._id, level: 'Primaire',
      feeType: 'inscription', billingCycle: 'one_time',
      label: "Frais d'inscription 2024-2025",
      periodYear: 2024, dueDate: new Date('2024-09-15'),
      baseAmount: INSCRIPTION_AMOUNT,
      discount: { type: 'none', value: 0, reason: '' },
      finalAmount: INSCRIPTION_AMOUNT,
      paidAmount: inscPaid ? INSCRIPTION_AMOUNT : 0,
      status: inscPaid ? 'paid' : 'pending',
      invoiceNumber: nextInvoice(),
      createdBy: adminUser._id,
    };
    if (inscPaid) {
      inscDoc.payments = [{
        amount: INSCRIPTION_AMOUNT, method: i % 3 === 0 ? 'bank_transfer' : 'cash',
        paidAt: new Date('2024-09-10'), note: "Inscription 2024-2025",
        receiptNumber: nextReceipt(), recordedBy: cashierUser._id,
      }];
    }
    await StudentPayment.create(inscDoc);

    // ── monthly scolarite ──
    const MONTHS = [
      { m: 10, label: 'Scolarité Octobre 2024',  due: '2024-10-05', seed: 1 },
      { m: 11, label: 'Scolarité Novembre 2024', due: '2024-11-05', seed: 2 },
      { m: 12, label: 'Scolarité Décembre 2024', due: '2024-12-05', seed: 3 },
    ];
    for (const mo of MONTHS) {
      const paid = isPaid(i, mo.seed);
      const moDoc = {
        student: sd.student._id, classe: cls._id, level: 'Primaire',
        feeType: 'scolarite', billingCycle: 'monthly',
        label: mo.label, periodMonth: mo.m, periodYear: 2024,
        dueDate: new Date(mo.due),
        baseAmount: SCOLARITE_MONTHLY,
        discount: { type: 'none', value: 0, reason: '' },
        finalAmount: SCOLARITE_MONTHLY,
        paidAmount: paid ? SCOLARITE_MONTHLY : 0,
        status: paid ? 'paid' : 'late',
        invoiceNumber: nextInvoice(),
        createdBy: adminUser._id,
      };
      if (paid) {
        moDoc.payments = [{
          amount: SCOLARITE_MONTHLY, method: 'cash',
          paidAt: new Date(mo.due), note: mo.label,
          receiptNumber: nextReceipt(), recordedBy: cashierUser._id,
        }];
      }
      await StudentPayment.create(moDoc);
    }
  }
  console.log(`✅ ${studentDocs.length * 4} payment records created`);

  // 9 ─ Notifications
  await Notification.insertMany([
    {
      recipient: null, recipientRole: null, recipientClass: null,
      type: 'general', title: 'Rentrée scolaire 2024-2025',
      message: 'Bienvenue ! Les cours reprennent le 5 septembre 2024. Bonne année scolaire à tous.',
      createdBy: adminUser._id,
    },
    {
      recipientRole: 'teacher',
      type: 'general', title: 'Réunion pédagogique',
      message: 'Réunion pédagogique le vendredi 20 octobre à 14h00 en salle des professeurs.',
      createdBy: adminUser._id,
    },
    {
      recipientRole: 'student',
      type: 'general', title: 'Calendrier des examens S1',
      message: 'Le calendrier des examens du premier semestre est disponible. Consultez-le dans votre espace.',
      createdBy: adminUser._id,
    },
    {
      recipientClass: classMap['6APG-1']._id,
      type: 'exam_scheduled', title: 'Examen Mathématiques – 6APG-1',
      message: 'Examen de mathématiques le 25 novembre 2024. Révisions : chapitres 1 à 4.',
      createdBy: teacherUsers[0].user._id,
    },
    {
      recipientClass: classMap['5APG-1']._id,
      type: 'assignment_created', title: 'Nouveau devoir de Français',
      message: "Un devoir de rédaction a été publié. Date limite : dans 5 jours.",
      createdBy: teacherUsers[1].user._id,
    },
    {
      recipientClass: classMap['6APG-2']._id,
      type: 'grade_added', title: 'Notes CC1 disponibles – Anglais',
      message: 'Les notes du contrôle continu 1 d\'Anglais ont été publiées.',
      createdBy: teacherUsers[2].user._id,
    },
    {
      recipientRole: 'student',
      type: 'payment_due_reminder', title: 'Rappel : scolarité décembre',
      message: 'La scolarité du mois de décembre est due avant le 5 décembre. Merci de vous acquitter.',
      createdBy: adminUser._id,
    },
  ]);
  console.log('✅ Notifications created');

  // ─── done ──────────────────────────────────────────────────────────────────
  console.log('\n🎉  Demo seed completed successfully!\n');
  console.log('── Login credentials ─────────────────────────────────────');
  console.log('  Admin    : admin@ikenas.com         / Admin1234');
  console.log('  Cashier  : cashier@ikenas.com       / Cashier1234');
  console.log('  Teachers : k.benali@ikenas.com …    / Teacher1234');
  console.log('  Students : stu001@ikenas.com …      / Student1234');
  console.log('  (See USERS_CREDENTIALS.txt for the full list)');
  console.log('──────────────────────────────────────────────────────────\n');
  process.exit(0);
};

seed().catch(err => {
  console.error('❌ Seed error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
