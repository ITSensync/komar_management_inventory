const express = require('express');
const controller = require('../controllers/stocktakeController');

const router = express.Router();

router.get('/mobile/stocktakes', controller.listSessions);
router.post('/mobile/stocktakes', controller.createSession);
router.get('/mobile/stocktakes/:id', controller.getSession);
router.post('/mobile/stocktakes/:id/scans', controller.scanSession);
router.post('/mobile/stocktakes/:id/submit', controller.submitSession);

module.exports = router;
