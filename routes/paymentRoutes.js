const express = require('express');
const {
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
} = require('../controllers/paymentController');
const { protect, roleCheck } = require('../middleware/auth');

const router = express.Router();

router.get('/admin/tariffs', protect, roleCheck('admin', 'cashier'), getTariffs);
router.post('/admin/tariffs', protect, roleCheck('admin', 'cashier'), createTariff);
router.put('/admin/tariffs/:id', protect, roleCheck('admin', 'cashier'), updateTariff);
router.delete('/admin/tariffs/:id', protect, roleCheck('admin', 'cashier'), deleteTariff);

router.get('/admin/students/:studentId/tariff-suggestion', protect, roleCheck('admin', 'cashier'), getStudentTariffSuggestion);
router.post('/admin/students/:studentId/dues', protect, roleCheck('admin', 'cashier'), generateStudentDue);
router.get('/admin/students/:studentId/debts', protect, roleCheck('admin', 'cashier'), getStudentDebts);

router.get('/admin/analytics/overview', protect, roleCheck('admin', 'cashier'), getAdminFinancialAnalytics);
router.get('/admin/analytics/class-month-status', protect, roleCheck('admin', 'cashier'), getAdminClassMonthlyStatus);
router.post('/admin/analytics/class-month-status/notify-late', protect, roleCheck('admin', 'cashier'), sendAdminClassMonthlyLateNotifications);
router.get('/admin/analytics/forecast', protect, roleCheck('admin', 'cashier'), getFinancialForecast);
router.post('/admin/notifications/due-reminders', protect, roleCheck('admin', 'cashier'), dispatchDueReminders);
router.get('/admin/invoices/:paymentId/download', protect, roleCheck('admin', 'cashier'), downloadInvoice);

router.get('/cashier/students/search', protect, roleCheck('cashier', 'admin'), searchStudentsForCashier);
router.get('/cashier/dashboard', protect, roleCheck('cashier', 'admin'), getCashierDashboard);
router.post('/cashier/payments/:paymentId/collect', protect, roleCheck('cashier', 'admin'), collectPayment);
router.get('/cashier/receipts/:paymentId/download', protect, roleCheck('cashier', 'admin'), downloadReceipt);

router.get('/student/me/space', protect, roleCheck('student', 'parent'), getStudentPaymentSpace);
router.get('/student/me/invoices/:paymentId', protect, roleCheck('student', 'parent'), getStudentInvoiceDetail);
router.get('/student/me/invoices/:paymentId/download', protect, roleCheck('student', 'parent'), downloadInvoice);
router.get('/student/me/receipts/:paymentId/download', protect, roleCheck('student', 'parent'), downloadReceipt);

module.exports = router;
