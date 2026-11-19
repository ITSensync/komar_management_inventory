const rackService = require('../services/rackService');

async function listRacks(req, res, next) {
  try {
    res.json({ success: true, data: await rackService.listRacks(req.query.status) });
  } catch (error) { next(error); }
}

async function getRack(req, res, next) {
  try {
    const rack = await rackService.getRack(req.params.id);
    if (!rack) return res.status(404).json({ success: false, message: 'Rack not found.' });
    res.json({ success: true, data: rack });
  } catch (error) { next(error); }
}

async function createRack(req, res, next) {
  try {
    const result = await rackService.createRack(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function updateRack(req, res, next) {
  try {
    const result = await rackService.updateRack(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

module.exports = { createRack, getRack, listRacks, updateRack };
