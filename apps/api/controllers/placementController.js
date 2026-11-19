const placementService = require('../services/placementService');

async function previewPlacement(req, res, next) {
  try {
    const result = await placementService.previewPlacement(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function createPlacement(req, res, next) {
  try {
    const result = await placementService.createPlacement(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function listPlacementHistory(req, res, next) {
  try {
    res.json({ success: true, data: await placementService.listPlacementHistory(req.query) });
  } catch (error) { next(error); }
}

module.exports = { createPlacement, listPlacementHistory, previewPlacement };
