const rfidService = require('../services/rfidService');

async function listTags(req, res, next) {
  try {
    const tags = await rfidService.listTags();
    res.json({ success: true, data: tags });
  } catch (error) {
    next(error);
  }
}

async function registerTags(req, res, next) {
  try {
    const result = await rfidService.registerTags(req.body.rfid_tags);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

async function getTag(req, res, next) {
  try {
    const tag = await rfidService.getTagById(req.params.id);
    if (!tag) {
      return res.status(404).json({ success: false, message: 'RFID tag not found.' });
    }

    res.json({ success: true, data: tag });
  } catch (error) {
    next(error);
  }
}

async function removeTag(req, res, next) {
  try {
    const result = await rfidService.deleteTag(req.params.id);
    if (!result.found) {
      return res.status(404).json({ success: false, message: 'RFID tag not found.' });
    }
    if (!result.deleted) {
      return res.status(409).json({ success: false, message: 'An RFID tag assigned to a PO session cannot be deleted.' });
    }

    res.json({ success: true, message: 'RFID tag deleted successfully.' });
  } catch (error) {
    next(error);
  }
}

module.exports = { getTag, listTags, registerTags, removeTag };
