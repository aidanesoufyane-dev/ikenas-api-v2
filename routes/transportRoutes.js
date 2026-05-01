const express = require('express');
const router  = express.Router();
const {
  getBusLocation,
  getLocationHistory,
  getTransports,
  getDrivers,
  createTransport,
  updateTransport,
  deleteTransport,
  getTransportPayments,
  updateTransportPayments,
  notifyTransportPayments,
  getTransportStudents,
  createTransportRequest,
  updateTransportStudentStatus,
  assignStudentTransport,
  getTransportLoadBalance,
  getTransportStudentsDashboard,
} = require('../controllers/transportController');
const { protect, roleCheck } = require('../middleware/auth');

router.get('/drivers', protect, roleCheck('admin'), getDrivers);
router.get('/payments', protect, roleCheck('admin'), getTransportPayments);
router.get('/students', protect, roleCheck('admin'), getTransportStudents);
router.get('/students/dashboard', protect, roleCheck('admin'), getTransportStudentsDashboard);
router.get('/load-balance', protect, roleCheck('admin'), getTransportLoadBalance);
router.post('/students/:studentId/request', protect, roleCheck('admin', 'student'), createTransportRequest);
router.put('/students/:studentId/status', protect, roleCheck('admin'), updateTransportStudentStatus);
router.put('/students/:studentId/assignment', protect, roleCheck('admin'), assignStudentTransport);

router.route('/')
  .get(protect, roleCheck('admin'), getTransports)
  .post(protect, roleCheck('admin'), createTransport);

router.route('/:id')
  .put(protect,    roleCheck('admin'), updateTransport)
  .delete(protect, roleCheck('admin'), deleteTransport);

router.put('/:id/payments', protect, roleCheck('admin'), updateTransportPayments);
router.post('/:id/payments/notify', protect, roleCheck('admin'), notifyTransportPayments);

router.get('/location', protect, getBusLocation);
router.get('/bus-location', protect, getBusLocation);
router.get('/history', protect, getLocationHistory);

module.exports = router;
