const stocktakeService = require('../services/stocktakeService');

async function listSessions(req, res, next) {
  try { res.json({ success: true, data: await stocktakeService.listSessions() }); } catch (error) { next(error); }
}

async function createSession(req, res, next) {
  try {
    const result = await stocktakeService.createSession(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function getSession(req, res, next) {
  try {
    const report = await stocktakeService.getSession(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'Stocktake session not found.' });
    return res.json({ success: true, data: report });
  } catch (error) { return next(error); }
}

async function scanSession(req, res, next) {
  try {
    const result = await stocktakeService.scanSession(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function submitSession(req, res, next) {
  try {
    const result = await stocktakeService.submitSession(req.params.id);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

module.exports = { createSession, getSession, listSessions, scanSession, submitSession };
