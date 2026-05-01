const Class = require('../models/Class');
const FeeTariff = require('../models/FeeTariff');
const Student = require('../models/Student');
const StudentPayment = require('../models/StudentPayment');
const User = require('../models/User');
const School = require('../models/School');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { asyncHandler, getTodayEnd, getTodayStart } = require('../utils/helpers');
const { sendNotification } = require('../utils/notify');
const { resolveActingStudent } = require('../utils/studentAccess');

const FEE_TYPE_LABEL = {
  inscription: 'Inscription',
  scolarite: 'Scolarité',
  transport: 'Transport',
};

const BILLING_LABEL = {
  one_time: 'Unique',
  monthly: 'Mensuel',
  quarterly: 'Trimestriel',
};

const sanitizeAmount = (value) => {
  const parsed = Number(value || 0);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(parsed, 0);
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildTariffLevelCandidates = (student) => {
  const className = String(student?.classe?.name || '').trim();
  const classBaseName = String(student?.classe?.baseName || '').trim() || String(className.split('-')[0] || '').trim();
  const academicLevel = String(student?.classe?.level || student?.level || '').trim();

  const ordered = [classBaseName, className, academicLevel].filter(Boolean);
  const seen = new Set();

  return ordered.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const computeFinalAmount = (baseAmount, discount = { type: 'none', value: 0 }) => {
  const amount = sanitizeAmount(baseAmount);
  const discountValue = sanitizeAmount(discount.value);

  if (discount.type === 'fixed') {
    return Math.max(amount - discountValue, 0);
  }

  if (discount.type === 'percent') {
    const pct = Math.min(discountValue, 100);
    return Math.max(amount - (amount * pct) / 100, 0);
  }

  return amount;
};

const computeStatus = (dueDate, finalAmount, paidAmount) => {
  if (paidAmount >= finalAmount) return 'paid';
  const due = new Date(dueDate);
  const today = new Date();
  due.setHours(23, 59, 59, 999);
  return due < today ? 'late' : 'pending';
};

const monthName = (month) =>
  new Date(2024, Math.max(Number(month || 1) - 1, 0), 1).toLocaleString('fr-FR', { month: 'long' });

const buildPeriodLabel = ({ billingCycle, periodMonth, periodQuarter, periodYear }) => {
  if (billingCycle === 'monthly' && periodMonth) return `${monthName(periodMonth)} ${periodYear}`;
  if (billingCycle === 'quarterly' && periodQuarter) return `T${periodQuarter} ${periodYear}`;
  return `${periodYear}`;
};

const buildInvoiceNumber = ({ studentId, feeType, periodYear, periodMonth, periodQuarter }) => {
  const stamp = Date.now().toString().slice(-7);
  const normalizedType = (feeType || 'fee').slice(0, 3).toUpperCase();
  const period = [periodYear, periodMonth || periodQuarter || '00'].join('');
  return `INV-${normalizedType}-${String(studentId).slice(-5).toUpperCase()}-${period}-${stamp}`;
};

const buildReceiptNumber = () => `RCT-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 1000)}`;

const refreshOverdueStatuses = async () => {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  await StudentPayment.updateMany(
    {
      status: 'pending',
      dueDate: { $lt: today },
      $expr: { $lt: ['$paidAmount', '$finalAmount'] },
    },
    { $set: { status: 'late' } }
  );
};

const findMatchingTariff = async (student, feeType, billingCycle) => {
  const byClass = await FeeTariff.findOne({
    isActive: true,
    classe: student.classe?._id || student.classe,
    feeType,
    billingCycle,
  }).sort({ createdAt: -1 });

  if (byClass) return byClass;

  const candidates = buildTariffLevelCandidates(student);
  for (const candidate of candidates) {
    const byCandidate = await FeeTariff.findOne({
      isActive: true,
      level: new RegExp(`^${escapeRegex(candidate)}$`, 'i'),
      classe: null,
      feeType,
      billingCycle,
    }).sort({ createdAt: -1 });

    if (byCandidate) return byCandidate;
  }

  return null;
};

const studentHasTransport = (student) => {
  const status = String(student?.transport?.status || '').toLowerCase();
  return status === 'with_transport';
};

const getStudentTariffSuggestion = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const feeType = String(req.query.feeType || '').trim();
  const billingCycle = String(req.query.billingCycle || '').trim();

  if (!['inscription', 'scolarite', 'transport'].includes(feeType)) {
    return res.status(400).json({ success: false, message: 'Type de frais invalide.' });
  }

  if (!['one_time', 'monthly', 'quarterly'].includes(billingCycle)) {
    return res.status(400).json({ success: false, message: 'Cycle de facturation invalide.' });
  }

  const student = await Student.findById(studentId)
    .populate('classe', 'name baseName level')
    .populate('user', 'firstName lastName');

  if (!student) {
    return res.status(404).json({ success: false, message: 'Élève introuvable.' });
  }

  if (feeType === 'transport' && !studentHasTransport(student)) {
    return res.status(400).json({
      success: false,
      message: 'Cet élève est sans transport. Aucun montant transport à encaisser.',
    });
  }

  const tariff = await findMatchingTariff(student, feeType, billingCycle);

  if (!tariff) {
    return res.status(404).json({
      success: false,
      message: 'Aucun tarif actif trouvé pour ce type/cycle et cette classe.',
    });
  }

  res.status(200).json({
    success: true,
    data: {
      studentId: student._id,
      feeType,
      billingCycle,
      amount: sanitizeAmount(tariff.amount),
      tariff: {
        _id: tariff._id,
        level: tariff.level,
        classe: tariff.classe,
      },
      hasTransport: studentHasTransport(student),
    },
  });
});

const createTariff = asyncHandler(async (req, res) => {
  const tariff = await FeeTariff.create({
    ...req.body,
    createdBy: req.user._id,
  });

  const populated = await FeeTariff.findById(tariff._id).populate('classe', 'name level');
  res.status(201).json({ success: true, data: populated });
});

const getTariffs = asyncHandler(async (req, res) => {
  const filter = {};

  if (req.query.level) filter.level = req.query.level;
  if (req.query.feeType) filter.feeType = req.query.feeType;
  if (req.query.billingCycle) filter.billingCycle = req.query.billingCycle;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

  const data = await FeeTariff.find(filter)
    .populate('classe', 'name level')
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, data });
});

const updateTariff = asyncHandler(async (req, res) => {
  const tariff = await FeeTariff.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('classe', 'name level');

  if (!tariff) {
    return res.status(404).json({ success: false, message: 'Tarif introuvable.' });
  }

  res.status(200).json({ success: true, data: tariff });
});

const deleteTariff = asyncHandler(async (req, res) => {
  const tariff = await FeeTariff.findByIdAndDelete(req.params.id);

  if (!tariff) {
    return res.status(404).json({ success: false, message: 'Tarif introuvable.' });
  }

  res.status(200).json({ success: true, message: 'Tarif supprimé avec succès.' });
});

const generateStudentDue = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const {
    feeType,
    billingCycle,
    dueDate,
    periodMonth,
    periodQuarter,
    periodYear,
    discount,
    label,
  } = req.body;

  const student = await Student.findById(studentId)
    .populate('classe', 'name baseName level')
    .populate('user', 'firstName lastName');

  if (!student) {
    return res.status(404).json({ success: false, message: 'Élève introuvable.' });
  }

  if (feeType === 'transport' && !studentHasTransport(student)) {
    return res.status(400).json({
      success: false,
      message: 'Cet élève est sans transport. Facture transport non autorisée.',
    });
  }

  const selectedYear = Number(periodYear || new Date().getFullYear());

  if (feeType === 'inscription' && billingCycle === 'one_time') {
    const existingInscription = await StudentPayment.findOne({
      student: student._id,
      feeType: 'inscription',
      billingCycle: 'one_time',
      periodYear: selectedYear,
    }).select('_id invoiceNumber status');

    if (existingInscription) {
      return res.status(409).json({
        success: false,
        message: 'Une facture d’inscription existe déjà pour cet élève sur cette année.',
      });
    }
  }

  const tariff = await findMatchingTariff(student, feeType, billingCycle);
  const manualAmount = sanitizeAmount(req.body.amount);

  if (!tariff && manualAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Aucun tarif actif trouvé pour ce niveau/classe/type de frais. Saisissez un montant manuel.',
    });
  }

  const discountSafe = {
    type: discount?.type || 'none',
    value: sanitizeAmount(discount?.value),
    reason: discount?.reason || '',
    approvedBy: discount?.type && discount.type !== 'none' ? req.user._id : null,
  };

  const baseAmount = manualAmount > 0 ? manualAmount : sanitizeAmount(tariff.amount);
  const finalAmount = computeFinalAmount(baseAmount, discountSafe);
  const invoiceNumber = buildInvoiceNumber({
    studentId,
    feeType,
    periodYear: selectedYear,
    periodMonth,
    periodQuarter,
  });

  const payload = {
    student: student._id,
    classe: student.classe?._id,
    level: student.classe?.level || '',
    feeType,
    billingCycle,
    label: label || `${FEE_TYPE_LABEL[feeType] || feeType} • ${BILLING_LABEL[billingCycle] || billingCycle}`,
    periodMonth: billingCycle === 'monthly' ? Number(periodMonth || null) : null,
    periodQuarter: billingCycle === 'quarterly' ? Number(periodQuarter || null) : null,
    periodYear: selectedYear,
    dueDate: dueDate || new Date(selectedYear, (Number(periodMonth || 1) - 1), 28),
    baseAmount,
    discount: discountSafe,
    finalAmount,
    paidAmount: 0,
    invoiceNumber,
    status: 'pending',
    createdBy: req.user._id,
    updatedBy: req.user._id,
  };

  const created = await StudentPayment.create(payload);

  const populated = await StudentPayment.findById(created._id)
    .populate({ path: 'student', populate: [{ path: 'user', select: 'firstName lastName email' }, { path: 'classe', select: 'name level' }] })
    .populate('createdBy', 'firstName lastName role');

  res.status(201).json({ success: true, data: populated });
});

const getStudentDebts = asyncHandler(async (req, res) => {
  await refreshOverdueStatuses();

  const { studentId } = req.params;
  const student = await Student.findById(studentId)
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name level');

  if (!student) {
    return res.status(404).json({ success: false, message: 'Élève introuvable.' });
  }

  const debts = await StudentPayment.find({
    student: student._id,
    status: { $in: ['pending', 'late'] },
  }).sort({ dueDate: 1, createdAt: -1 });

  const monthlyInvoices = await StudentPayment.find({
    student: student._id,
    feeType: 'scolarite',
    billingCycle: 'monthly',
    periodMonth: { $ne: null },
  }).sort({ periodYear: -1, createdAt: -1 });

  const totals = debts.reduce(
    (acc, item) => {
      acc.finalAmount += item.finalAmount;
      acc.paidAmount += item.paidAmount;
      acc.remaining += Math.max(item.finalAmount - item.paidAmount, 0);
      return acc;
    },
    { finalAmount: 0, paidAmount: 0, remaining: 0 }
  );

  res.status(200).json({
    success: true,
    data: {
      student,
      debts,
      monthlyInvoices,
      totals,
    },
  });
});

const collectPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { amount, method, note, reference, paymentDate } = req.body;

  const payment = await StudentPayment.findById(paymentId)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName email' } });

  if (!payment) {
    return res.status(404).json({ success: false, message: 'Facture introuvable.' });
  }

  const entryAmount = sanitizeAmount(amount);
  const remaining = Math.max(payment.finalAmount - payment.paidAmount, 0);

  if (entryAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Montant de paiement invalide.' });
  }

  if (entryAmount > remaining) {
    return res.status(400).json({
      success: false,
      message: `Le montant dépasse le reste à payer (${remaining}).`,
    });
  }

  const receiptNumber = buildReceiptNumber();
  const parsedPaymentDate = paymentDate ? new Date(paymentDate) : new Date();
  const paidAt = Number.isNaN(parsedPaymentDate.getTime()) ? new Date() : parsedPaymentDate;

  payment.payments.push({
    amount: entryAmount,
    method,
    note: note || '',
    reference: reference || '',
    receiptNumber,
    recordedBy: req.user._id,
    paidAt,
  });

  payment.paidAmount = sanitizeAmount(payment.paidAmount + entryAmount);
  payment.status = computeStatus(payment.dueDate, payment.finalAmount, payment.paidAmount);
  payment.updatedBy = req.user._id;

  await payment.save();

  await sendNotification(req.io, {
    type: 'payment_confirmed',
    title: 'Paiement confirmé',
    message: `${entryAmount} MAD encaissé pour ${FEE_TYPE_LABEL[payment.feeType] || payment.feeType}.`,
    link: '/student/payments',
    recipient: payment.student.user?._id,
    createdBy: req.user._id,
  });

  const updated = await StudentPayment.findById(payment._id)
    .populate({ path: 'student', populate: [{ path: 'user', select: 'firstName lastName email' }, { path: 'classe', select: 'name level' }] })
    .populate('payments.recordedBy', 'firstName lastName role');

  res.status(200).json({
    success: true,
    data: updated,
    receiptNumber,
  });
});

const searchStudentsForCashier = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const classId = (req.query.classId || '').trim();
  const filter = {};

  if (classId) {
    filter.classe = classId;
  }

  if (q) {
    const users = await User.find({
      role: 'student',
      $or: [
        { firstName: { $regex: q, $options: 'i' } },
        { lastName: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
    }).select('_id');

    filter.$or = [
      { user: { $in: users.map((u) => u._id) } },
      { matricule: { $regex: q, $options: 'i' } },
    ];
  }

  const students = await Student.find(filter)
    .limit(20)
    .sort({ createdAt: -1 })
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name level');

  const result = await Promise.all(
    students.map(async (student) => {
      const debt = await StudentPayment.aggregate([
        {
          $match: {
            student: student._id,
            status: { $in: ['pending', 'late'] },
          },
        },
        {
          $project: {
            remaining: { $max: [{ $subtract: ['$finalAmount', '$paidAmount'] }, 0] },
          },
        },
        {
          $group: {
            _id: null,
            totalRemaining: { $sum: '$remaining' },
          },
        },
      ]);

      return {
        ...student.toObject(),
        totalRemaining: debt[0]?.totalRemaining || 0,
      };
    })
  );

  res.status(200).json({ success: true, data: result });
});

const getCashierDashboard = asyncHandler(async (req, res) => {
  await refreshOverdueStatuses();

  const todayStart = getTodayStart();
  const todayEnd = getTodayEnd();

  const todaysPayments = await StudentPayment.aggregate([
    { $unwind: '$payments' },
    {
      $match: {
        'payments.paidAt': { $gte: todayStart, $lte: todayEnd },
      },
    },
    {
      $group: {
        _id: '$feeType',
        total: { $sum: '$payments.amount' },
      },
    },
  ]);

  const totalToday = todaysPayments.reduce((sum, item) => sum + item.total, 0);

  const recentPayments = await StudentPayment.find({ 'payments.0': { $exists: true } })
    .sort({ updatedAt: -1 })
    .limit(8)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName matricule' } })
    .populate('payments.recordedBy', 'firstName lastName role');

  const formattedRecent = recentPayments.flatMap((invoice) =>
    invoice.payments.map((entry) => ({
      paymentId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      student: invoice.student,
      amount: entry.amount,
      method: entry.method,
      receiptNumber: entry.receiptNumber,
      paidAt: entry.paidAt,
      feeType: invoice.feeType,
      recordedBy: entry.recordedBy,
    }))
  )
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
    .slice(0, 10);

  res.status(200).json({
    success: true,
    data: {
      totalCollectedToday: totalToday,
      paymentsByType: todaysPayments,
      recentPayments: formattedRecent,
    },
  });
});

const getAdminFinancialAnalytics = asyncHandler(async (req, res) => {
  await refreshOverdueStatuses();

  const month = Number(req.query.month || new Date().getMonth() + 1);
  const year = Number(req.query.year || new Date().getFullYear());

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  const [totalExpectedRaw, totalCollectedRaw, lateStudentsRaw, byTypeRaw, collectedByClassRaw] = await Promise.all([
    StudentPayment.aggregate([
      {
        $match: {
          dueDate: { $gte: monthStart, $lte: monthEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalExpected: { $sum: '$finalAmount' },
        },
      },
    ]),
    StudentPayment.aggregate([
      { $unwind: '$payments' },
      {
        $match: {
          'payments.paidAt': { $gte: monthStart, $lte: monthEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalCollected: { $sum: '$payments.amount' },
        },
      },
    ]),
    StudentPayment.aggregate([
      {
        $match: {
          status: 'late',
        },
      },
      {
        $group: {
          _id: '$student',
          overdueAmount: { $sum: { $subtract: ['$finalAmount', '$paidAmount'] } },
        },
      },
      {
        $lookup: {
          from: 'students',
          localField: '_id',
          foreignField: '_id',
          as: 'student',
        },
      },
      { $unwind: '$student' },
      {
        $lookup: {
          from: 'users',
          localField: 'student.user',
          foreignField: '_id',
          as: 'studentUser',
        },
      },
      { $unwind: '$studentUser' },
      {
        $project: {
          overdueAmount: 1,
          studentId: '$student._id',
          matricule: '$student.matricule',
          firstName: '$studentUser.firstName',
          lastName: '$studentUser.lastName',
        },
      },
      { $sort: { overdueAmount: -1 } },
      { $limit: 20 },
    ]),
    StudentPayment.aggregate([
      {
        $match: {
          dueDate: { $gte: monthStart, $lte: monthEnd },
        },
      },
      {
        $group: {
          _id: '$feeType',
          expected: { $sum: '$finalAmount' },
          paid: { $sum: '$paidAmount' },
        },
      },
      {
        $project: {
          feeType: '$_id',
          expected: 1,
          paid: 1,
          _id: 0,
        },
      },
    ]),
    StudentPayment.aggregate([
      { $unwind: '$payments' },
      {
        $match: {
          'payments.paidAt': { $gte: monthStart, $lte: monthEnd },
        },
      },
      {
        $group: {
          _id: '$classe',
          collected: { $sum: '$payments.amount' },
        },
      },
      {
        $lookup: {
          from: 'classes',
          localField: '_id',
          foreignField: '_id',
          as: 'classe',
        },
      },
      {
        $unwind: {
          path: '$classe',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          classId: '$_id',
          className: { $ifNull: ['$classe.name', 'Classe inconnue'] },
          collected: 1,
        },
      },
      { $sort: { collected: -1 } },
    ]),
  ]);

  const totalExpected = totalExpectedRaw[0]?.totalExpected || 0;
  const totalCollected = totalCollectedRaw[0]?.totalCollected || 0;

  res.status(200).json({
    success: true,
    data: {
      month,
      year,
      totalExpected,
      totalCollected,
      schoolCollectedTotal: totalCollected,
      collectionRate: totalExpected > 0 ? Number(((totalCollected / totalExpected) * 100).toFixed(2)) : 0,
      estimatedNet: totalCollected,
      paymentsByType: byTypeRaw,
      lateStudents: lateStudentsRaw,
      collectedByClass: collectedByClassRaw,
    },
  });
});

const getAdminClassMonthlyStatus = asyncHandler(async (req, res) => {
  const classId = String(req.query.classId || '').trim();
  const month = Number(req.query.month || new Date().getMonth() + 1);
  const year = Number(req.query.year || new Date().getFullYear());
  const transportOnly = String(req.query.transportOnly || 'false').toLowerCase() === 'true';
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  if (!classId) {
    return res.status(400).json({ success: false, message: 'Classe requise.' });
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ success: false, message: 'Mois invalide.' });
  }

  const classInfo = await Class.findById(classId).select('name');
  if (!classInfo) {
    return res.status(404).json({ success: false, message: 'Classe introuvable.' });
  }

  const students = await Student.find({ classe: classId })
    .populate('user', 'firstName lastName')
    .sort({ classOrder: 1, createdAt: 1, _id: 1 });

  const studentIds = students.map((student) => student._id);

  const invoices = await StudentPayment.find({
    student: { $in: studentIds },
    periodMonth: month,
    periodYear: year,
    feeType: { $in: ['scolarite', 'transport'] },
  }).select('student feeType finalAmount paidAmount status periodMonth periodYear');

  const byStudent = new Map();
  invoices.forEach((invoice) => {
    const key = String(invoice.student);
    const current = byStudent.get(key) || { scolarite: null, transport: null };
    if (invoice.feeType === 'scolarite') {
      current.scolarite = invoice;
    }
    if (invoice.feeType === 'transport') {
      current.transport = invoice;
    }
    byStudent.set(key, current);
  });

  const rows = students
    .map((student) => {
      const studentKey = String(student._id);
      const invoiceInfo = byStudent.get(studentKey) || { scolarite: null, transport: null };

      const scolariteRemaining = invoiceInfo.scolarite
        ? Math.max((invoiceInfo.scolarite.finalAmount || 0) - (invoiceInfo.scolarite.paidAmount || 0), 0)
        : 0;

      const transportRemaining = invoiceInfo.transport
        ? Math.max((invoiceInfo.transport.finalAmount || 0) - (invoiceInfo.transport.paidAmount || 0), 0)
        : 0;

      const scolariteStatus = invoiceInfo.scolarite && scolariteRemaining <= 0 ? 'paid' : 'unpaid';
      const transportStatus = !invoiceInfo.transport
        ? 'none'
        : transportRemaining <= 0
          ? 'paid'
          : 'unpaid';

      return {
        studentId: student._id,
        firstName: student.user?.firstName || '',
        lastName: student.user?.lastName || '',
        matricule: student.matricule || '',
        scolariteStatus,
        scolariteRemaining,
        hasTransport: Boolean(invoiceInfo.transport),
        transportStatus,
        transportRemaining,
      };
    })
    .filter((row) => !transportOnly || row.hasTransport);

  const paidCount = rows.filter((row) => row.scolariteStatus === 'paid').length;
  const unpaidCount = rows.length - paidCount;

  const scopedFeeTypes = transportOnly ? ['transport'] : ['scolarite', 'transport'];

  const [classExpectedRaw, classCollectedRaw, schoolCollectedRaw] = await Promise.all([
    StudentPayment.aggregate([
      {
        $match: {
          classe: classInfo._id,
          periodMonth: month,
          periodYear: year,
          feeType: { $in: scopedFeeTypes },
        },
      },
      {
        $group: {
          _id: null,
          totalExpected: { $sum: '$finalAmount' },
        },
      },
    ]),
    StudentPayment.aggregate([
      {
        $match: {
          classe: classInfo._id,
          feeType: { $in: scopedFeeTypes },
        },
      },
      { $unwind: '$payments' },
      {
        $match: {
          'payments.paidAt': { $gte: monthStart, $lte: monthEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalCollected: { $sum: '$payments.amount' },
        },
      },
    ]),
    StudentPayment.aggregate([
      { $unwind: '$payments' },
      {
        $match: {
          'payments.paidAt': { $gte: monthStart, $lte: monthEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalCollected: { $sum: '$payments.amount' },
        },
      },
    ]),
  ]);

  const classExpected = classExpectedRaw[0]?.totalExpected || 0;
  const classCollected = classCollectedRaw[0]?.totalCollected || 0;
  const schoolCollectedTotal = schoolCollectedRaw[0]?.totalCollected || 0;
  const classCollectionRate = classExpected > 0
    ? Number(((classCollected / classExpected) * 100).toFixed(2))
    : 0;

  res.status(200).json({
    success: true,
    data: {
      classe: { _id: classInfo._id, name: classInfo.name },
      month,
      year,
      transportOnly,
      summary: {
        total: rows.length,
        paid: paidCount,
        unpaid: unpaidCount,
      },
      kpis: {
        expected: classExpected,
        collected: classCollected,
        collectionRate: classCollectionRate,
        schoolCollectedTotal,
      },
      rows,
    },
  });
});

const sendAdminClassMonthlyLateNotifications = asyncHandler(async (req, res) => {
  const classId = String(req.body.classId || '').trim();
  const month = Number(req.body.month || new Date().getMonth() + 1);
  const year = Number(req.body.year || new Date().getFullYear());
  const transportOnly = Boolean(req.body.transportOnly);

  if (!classId) {
    return res.status(400).json({ success: false, message: 'Classe requise.' });
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ success: false, message: 'Mois invalide.' });
  }

  const classInfo = await Class.findById(classId).select('name');
  if (!classInfo) {
    return res.status(404).json({ success: false, message: 'Classe introuvable.' });
  }

  const feeType = transportOnly ? 'transport' : 'scolarite';

  const students = await Student.find({ classe: classId })
    .populate('user', '_id firstName lastName')
    .sort({ classOrder: 1, createdAt: 1, _id: 1 });

  const studentIds = students.map((student) => student._id);

  const invoices = await StudentPayment.find({
    student: { $in: studentIds },
    periodMonth: month,
    periodYear: year,
    feeType,
    status: { $in: ['pending', 'late'] },
  }).select('student finalAmount paidAmount');

  const remainingByStudent = new Map();
  invoices.forEach((invoice) => {
    const key = String(invoice.student);
    const remaining = Math.max((invoice.finalAmount || 0) - (invoice.paidAmount || 0), 0);
    const current = remainingByStudent.get(key) || 0;
    remainingByStudent.set(key, current + remaining);
  });

  let sent = 0;
  for (const student of students) {
    const studentKey = String(student._id);
    const remaining = remainingByStudent.get(studentKey) || 0;
    if (remaining <= 0 || !student.user?._id) continue;

    await sendNotification(req.io, {
      type: 'payment_late_reminder',
      title: 'Retard de paiement',
      message: `Rappel: ${FEE_TYPE_LABEL[feeType] || feeType} de ${monthName(month)} ${year} non réglé. Reste ${remaining} MAD.`,
      link: '/student/payments',
      recipient: student.user._id,
      createdBy: req.user._id,
    });

    sent += 1;
  }

  res.status(200).json({
    success: true,
    data: {
      classe: { _id: classInfo._id, name: classInfo.name },
      month,
      year,
      transportOnly,
      targeted: remainingByStudent.size,
      sent,
    },
  });
});

const getFinancialForecast = asyncHandler(async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());

  const monthly = await StudentPayment.aggregate([
    {
      $match: {
        periodYear: year,
      },
    },
    {
      $group: {
        _id: '$periodMonth',
        expected: { $sum: '$finalAmount' },
        paid: { $sum: '$paidAmount' },
      },
    },
    {
      $project: {
        month: '$_id',
        expected: 1,
        paid: 1,
        _id: 0,
      },
    },
    { $sort: { month: 1 } },
  ]);

  const monthlyMap = new Map(monthly.map((item) => [item.month, item]));

  const projection = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const item = monthlyMap.get(month) || { expected: 0, paid: 0 };
    const estimatedCollected = item.paid > 0 ? item.paid : Number((item.expected * 0.82).toFixed(2));
    return {
      month,
      monthLabel: monthName(month),
      expected: item.expected,
      collected: item.paid,
      projectedCollected: estimatedCollected,
    };
  });

  const annualExpected = projection.reduce((sum, i) => sum + i.expected, 0);
  const annualCollected = projection.reduce((sum, i) => sum + i.collected, 0);
  const annualProjected = projection.reduce((sum, i) => sum + i.projectedCollected, 0);

  res.status(200).json({
    success: true,
    data: {
      year,
      monthly: projection,
      annualExpected,
      annualCollected,
      annualProjected,
    },
  });
});

const getStudentPaymentSpace = asyncHandler(async (req, res) => {
  await refreshOverdueStatuses();
  const actingStudent = await resolveActingStudent(req, {
    populate: ['user', 'classe'],
  });
  const student = await Student.findById(actingStudent._id)
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name baseName level');

  if (!student) {
    return res.status(404).json({ success: false, message: 'Profil élève introuvable.' });
  }

  const invoices = await StudentPayment.find({ student: student._id })
    .sort({ dueDate: 1, createdAt: -1 })
    .populate('payments.recordedBy', 'firstName lastName role');

  const schedule = invoices
    .filter((invoice) => invoice.status !== 'paid')
    .map((invoice) => ({
      _id: invoice._id,
      dueDate: invoice.dueDate,
      feeType: invoice.feeType,
      label: invoice.label,
      amountToPay: Math.max(invoice.finalAmount - invoice.paidAmount, 0),
      status: invoice.status,
      periodLabel: buildPeriodLabel(invoice),
      invoiceNumber: invoice.invoiceNumber,
    }));

  const history = invoices
    .filter((invoice) => invoice.payments.length > 0)
    .flatMap((invoice) =>
      invoice.payments.map((p) => ({
        paymentId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        receiptNumber: p.receiptNumber,
        amount: p.amount,
        method: p.method,
        paidAt: p.paidAt,
        feeType: invoice.feeType,
        label: invoice.label,
      }))
    )
    .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));

  res.status(200).json({
    success: true,
    data: {
      student,
      schedule,
      invoices,
      history,
    },
  });
});

const getStudentInvoiceDetail = asyncHandler(async (req, res) => {
  const actingStudent = await resolveActingStudent(req, {
    populate: ['user', 'classe'],
  });
  const student = await Student.findById(actingStudent._id)
    .populate('user', 'firstName lastName email')
    .populate('classe', 'name baseName level');
  if (!student) {
    return res.status(404).json({ success: false, message: 'Profil élève introuvable.' });
  }

  const invoice = await StudentPayment.findOne({
    _id: req.params.paymentId,
    student: student._id,
  }).populate('payments.recordedBy', 'firstName lastName role');

  if (!invoice) {
    return res.status(404).json({ success: false, message: 'Facture introuvable.' });
  }

  res.status(200).json({ success: true, data: invoice });
});

const downloadReceipt = asyncHandler(async (req, res) => {
  const userRole = req.user.role;

  let invoice = await StudentPayment.findById(req.params.paymentId)
    .populate({ path: 'student', populate: { path: 'user', select: 'firstName lastName email' } })
    .populate('school', 'nom logo');

  if (!invoice) {
    return res.status(404).json({ success: false, message: 'Facture introuvable.' });
  }

  if (userRole === 'student' || userRole === 'parent') {
    const actingStudent = await resolveActingStudent(req, {
      populate: ['user', 'classe'],
    });
    const student = await Student.findById(actingStudent._id)
      .populate('user', 'firstName lastName email')
      .populate('classe', 'name baseName level');
    if (!student || String(invoice.student._id) !== String(student._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé à ce reçu.' });
    }
  }

  if (invoice.payments.length === 0) {
    return res.status(400).json({ success: false, message: 'Aucun paiement enregistré pour ce reçu.' });
  }

  const indexParam = req.query.paymentIndex !== undefined ? Number(req.query.paymentIndex) : invoice.payments.length - 1;
  const paymentItem = invoice.payments[indexParam];

  if (!paymentItem) {
    return res.status(404).json({ success: false, message: 'Ligne de paiement introuvable.' });
  }

  const schoolFromInvoice = invoice.school && typeof invoice.school === 'object'
    ? invoice.school
    : null;
  const school = schoolFromInvoice || (invoice.school
    ? await School.findById(invoice.school).select('nom logo')
    : null);

  const schoolName = school?.nom || 'Ikenas Gestion';
  const schoolLogoPath = school?.logo
    ? path.join(__dirname, '..', school.logo.replace(/^\//, ''))
    : null;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${paymentItem.receiptNumber}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  if (schoolLogoPath && fs.existsSync(schoolLogoPath)) {
    try {
      doc.image(schoolLogoPath, 50, 45, { fit: [70, 70] });
      doc.y = 55;
      doc.x = 135;
    } catch (error) {
      doc.y = 55;
      doc.x = 50;
    }
  }

  doc.fontSize(18).text('RECU DE PAIEMENT', schoolLogoPath ? 135 : 50, 55, { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#374151').text(schoolName, schoolLogoPath ? 135 : 50);
  doc.fillColor('black');
  doc.moveDown(1.5);

  const rows = [
    ['Recu N°', paymentItem.receiptNumber],
    ['Facture N°', invoice.invoiceNumber],
    ['Eleve', `${invoice.student.user.firstName} ${invoice.student.user.lastName}`],
    ['Type de frais', FEE_TYPE_LABEL[invoice.feeType] || invoice.feeType],
    ['Montant paye', `${paymentItem.amount} MAD`],
    ['Mode de paiement', paymentItem.method === 'cash' ? 'Cash' : 'Virement bancaire'],
    ['Date', new Date(paymentItem.paidAt).toLocaleString('fr-FR')],
    ['Reference', paymentItem.reference || '-'],
  ];

  rows.forEach(([label, value]) => {
    doc.font('Helvetica-Bold').fontSize(11).text(`${label}: `, { continued: true });
    doc.font('Helvetica').fontSize(11).text(String(value));
    doc.moveDown(0.35);
  });

  doc.moveDown(1.5);
  doc.fontSize(10).fillColor('#6b7280').text('Document genere automatiquement.', { align: 'left' });
  doc.end();
});

const downloadInvoice = asyncHandler(async (req, res) => {
  const userRole = req.user.role;

  const invoice = await StudentPayment.findById(req.params.paymentId)
    .populate({ path: 'student', populate: [{ path: 'user', select: 'firstName lastName email' }, { path: 'classe', select: 'name level' }] })
    .populate('payments.recordedBy', 'firstName lastName role');

  if (!invoice) {
    return res.status(404).json({ success: false, message: 'Facture introuvable.' });
  }

  if (userRole === 'student' || userRole === 'parent') {
    const actingStudent = await resolveActingStudent(req, {
      populate: ['user', 'classe'],
    });
    const student = await Student.findById(actingStudent._id)
      .populate('user', 'firstName lastName email')
      .populate('classe', 'name baseName level');
    if (!student || String(invoice.student?._id) !== String(student._id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé à cette facture.' });
    }
  }

  const remaining = Math.max((invoice.finalAmount || 0) - (invoice.paidAmount || 0), 0);
  const latestPayment = Array.isArray(invoice.payments) && invoice.payments.length > 0
    ? [...invoice.payments]
      .filter((entry) => entry?.paidAt)
      .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0]
    : null;

  const studentFullName = `${invoice.student?.user?.firstName || ''} ${invoice.student?.user?.lastName || ''}`.trim() || '-';
  const dueDateLabel = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('fr-FR') : '-';
  const latestPaymentLabel = latestPayment
    ? `${Number(latestPayment.amount || 0).toFixed(2)} MAD le ${new Date(latestPayment.paidAt).toLocaleString('fr-FR')}`
    : '-';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).text('FACTURE', { align: 'center' });
  doc.moveDown(1.5);

  const lines = [
    ['Facture N°', invoice.invoiceNumber],
    ['Élève', studentFullName],
    ['Classe', invoice.student?.classe?.name || '-'],
    ['Type de frais', FEE_TYPE_LABEL[invoice.feeType] || invoice.feeType],
    ['Période', buildPeriodLabel(invoice)],
    ['Date d\'échéance', dueDateLabel],
    ['Montant facture', `${Number(invoice.finalAmount || 0).toFixed(2)} MAD`],
    ['Montant payé', `${Number(invoice.paidAmount || 0).toFixed(2)} MAD`],
    ['Reste à payer', `${Number(remaining || 0).toFixed(2)} MAD`],
    ['Statut', invoice.status],
    ['Dernier paiement', latestPaymentLabel],
  ];

  lines.forEach(([label, value]) => {
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(`${label}: `, { continued: true })
      .font('Helvetica')
      .text(String(value));
    doc.moveDown(0.3);
  });

  doc.moveDown(1.2);
  doc.fontSize(10).fillColor('gray').text('Ikenas Gestion', { align: 'right' });

  doc.end();
});

const dispatchDueReminders = asyncHandler(async (req, res) => {
  const daysBefore = Number(req.query.daysBefore || 3);
  const today = new Date();

  const from = new Date(today);
  from.setHours(0, 0, 0, 0);

  const to = new Date(today);
  to.setDate(to.getDate() + daysBefore);
  to.setHours(23, 59, 59, 999);

  const dueSoon = await StudentPayment.find({
    status: { $in: ['pending', 'late'] },
    dueDate: { $gte: from, $lte: to },
  }).populate({ path: 'student', populate: { path: 'user', select: '_id firstName lastName' } });

  let sent = 0;

  for (const invoice of dueSoon) {
    if (!invoice.student?.user?._id) continue;
    const remaining = Math.max(invoice.finalAmount - invoice.paidAmount, 0);
    if (remaining <= 0) continue;

    await sendNotification(req.io, {
      type: 'payment_due_reminder',
      title: 'Rappel de paiement',
      message: `Échéance proche: ${FEE_TYPE_LABEL[invoice.feeType] || invoice.feeType}, reste ${remaining} MAD avant le ${new Date(invoice.dueDate).toLocaleDateString('fr-FR')}.`,
      link: '/student/payments',
      recipient: invoice.student.user._id,
      createdBy: req.user._id,
    });

    sent += 1;
  }

  res.status(200).json({ success: true, data: { sent, scanned: dueSoon.length } });
});

module.exports = {
  createTariff,
  getTariffs,
  updateTariff,
  deleteTariff,
  getStudentTariffSuggestion,
  generateStudentDue,
  getStudentDebts,
  collectPayment,
  searchStudentsForCashier,
  getCashierDashboard,
  getAdminFinancialAnalytics,
  getAdminClassMonthlyStatus,
  sendAdminClassMonthlyLateNotifications,
  getFinancialForecast,
  getStudentPaymentSpace,
  getStudentInvoiceDetail,
  downloadReceipt,
  downloadInvoice,
  dispatchDueReminders,
};
