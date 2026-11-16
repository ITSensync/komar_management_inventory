const express = require('express');
const controller = require('../controllers/poSessionController');

const router = express.Router();

router.get('/po-sessions', controller.listSessions);
router.post('/po-sessions', controller.createSession);
router.get('/po-sessions/:id', controller.getSession);
router.patch('/po-sessions/:id', controller.updateSession);
router.post('/po-sessions/:id/cancel', controller.cancelSession);
router.post('/po-sessions/:id/complete', controller.completeSession);
router.post('/po-sessions/:id/items', controller.addItem);

router.patch('/po-session-items/:id', controller.updateItem);
router.delete('/po-session-items/:id', controller.deleteItem);
router.post('/po-session-items/:id/rfid-scans', controller.scanRfidTags);
router.get('/po-session-items/:id/rfid-progress', controller.getRfidProgress);
router.post('/po-session-items/:id/print-jobs', controller.createPrintJob);

router.delete('/po-pack-plans/:id/rfid', controller.releaseRfid);
router.post('/po-pack-plans/:id/reprint', controller.reprintLabel);

router.get('/print-jobs/:id', controller.getPrintJob);
router.post('/print-jobs/:id/mark-printed', controller.markPrintJobPrinted);

module.exports = router;
