const express = require('express');
const router = express.Router();
const rfidController = require('../controllers/rfidController');

router.get('/rfid', rfidController.listTags);
router.post('/rfid', rfidController.registerTags);
router.get('/rfid/:id', rfidController.getTag);
router.delete('/rfid/:id', rfidController.removeTag);

module.exports = router;
