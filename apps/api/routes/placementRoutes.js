const express = require('express');
const controller = require('../controllers/placementController');

const router = express.Router();

router.post('/mobile/placements/preview', controller.previewPlacement);
router.post('/mobile/placements', controller.createPlacement);
router.get('/mobile/placements/history', controller.listPlacementHistory);

module.exports = router;
