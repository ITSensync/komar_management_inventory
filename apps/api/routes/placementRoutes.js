const express = require('express');
const controller = require('../controllers/placementController');

const router = express.Router();

router.post('/mobile/placements/preview', controller.previewPlacement);
router.post('/mobile/placements', controller.createPlacement);
router.post('/mobile/placements/relocation', controller.createRelocation);
router.post('/mobile/placements/outbound', controller.createOutbound);
router.post('/mobile/placements/trash', controller.createTrash);
router.get('/mobile/placements/history', controller.listPlacementHistory);

module.exports = router;
