const placementService = require('../services/placementService');
const rfidScanService = require('../services/rfidScanService');

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

async function previewRelocation(req, res, next) {
  try {
    const result = await placementService.previewRelocation(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function createRelocation(req, res, next) {
  try {
    const result = await placementService.createRelocation(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function createOutbound(req, res, next) {
  try {
    const result = await placementService.createTerminalMovement(req.body, 'outbound');
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function previewOutbound(req, res, next) {
  try {
    const result = await placementService.previewTerminalMovement(req.body, 'outbound');
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function createTrash(req, res, next) {
  try {
    const result = await placementService.createTerminalMovement(req.body, 'trash');
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function previewTrash(req, res, next) {
  try {
    const result = await placementService.previewTerminalMovement(req.body, 'trash');
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function startTerminalScan(req, res, next) {
  try {
    const result = await rfidScanService.createTerminalScanSession(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function listPlacementHistory(req, res, next) {
  try {
    res.json({ success: true, data: await placementService.listPlacementHistory(req.query) });
  } catch (error) { next(error); }
}

module.exports = {
  createOutbound,
  createPlacement,
  createRelocation,
  createTrash,
  listPlacementHistory,
  previewPlacement,
  previewOutbound,
  previewRelocation,
  previewTrash,
  startTerminalScan,
};
