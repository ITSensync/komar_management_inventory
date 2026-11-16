const poSessionService = require('../services/poSessionService');

async function listSessions(req, res, next) {
  try {
    res.json({ success: true, data: await poSessionService.listSessions() });
  } catch (error) { next(error); }
}

async function createSession(req, res, next) {
  try {
    const result = await poSessionService.createSession(req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function getSession(req, res, next) {
  try {
    const session = await poSessionService.getSessionById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'PO session not found.' });
    res.json({ success: true, data: session });
  } catch (error) { next(error); }
}

async function updateSession(req, res, next) {
  try {
    const result = await poSessionService.updateSession(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function cancelSession(req, res, next) {
  try {
    const result = await poSessionService.cancelSession(req.params.id);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function completeSession(req, res, next) {
  try {
    const result = await poSessionService.completeSession(req.params.id);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function addItem(req, res, next) {
  try {
    const result = await poSessionService.addItem(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function updateItem(req, res, next) {
  try {
    const result = await poSessionService.updateItem(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function deleteItem(req, res, next) {
  try {
    const result = await poSessionService.deleteItem(req.params.id);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function scanRfidTags(req, res, next) {
  try {
    const result = await poSessionService.scanRfidTags(req.params.id, req.body.rfid_tags);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function getRfidProgress(req, res, next) {
  try {
    const progress = await poSessionService.getRfidProgress(req.params.id);
    if (!progress) return res.status(404).json({ success: false, message: 'PO session item not found.' });
    res.json({ success: true, data: progress });
  } catch (error) { next(error); }
}

async function releaseRfid(req, res, next) {
  try {
    const result = await poSessionService.releaseRfid(req.params.id);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function createPrintJob(req, res, next) {
  try {
    const result = await poSessionService.createPrintJob(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function reprintLabel(req, res, next) {
  try {
    const result = await poSessionService.reprintLabel(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

async function getPrintJob(req, res, next) {
  try {
    const job = await poSessionService.getPrintJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Label print job not found.' });
    res.json({ success: true, data: job });
  } catch (error) { next(error); }
}

async function markPrintJobPrinted(req, res, next) {
  try {
    const result = await poSessionService.markPrintJobPrinted(req.params.id);
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
}

module.exports = {
  addItem,
  cancelSession,
  completeSession,
  createPrintJob,
  createSession,
  deleteItem,
  getPrintJob,
  getRfidProgress,
  getSession,
  listSessions,
  markPrintJobPrinted,
  releaseRfid,
  reprintLabel,
  scanRfidTags,
  updateItem,
  updateSession,
};
