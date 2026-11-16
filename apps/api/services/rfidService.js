const { Op, UniqueConstraintError } = require('sequelize');
const RfidTag = require('../models/RfidTag');
const { PoPackPlan } = require('../models');
const { normalizeRfidTags } = require('../utils/rfidTags');

async function listTags() {
  return RfidTag.findAll();
}

async function registerTags(rfidTags) {
  const normalized = normalizeRfidTags(rfidTags);
  if (normalized.error) {
    return {
      status: 400,
      body: { success: false, message: normalized.error },
    };
  }

  const results = [];
  const errors = [...normalized.errors];
  const existingTags = normalized.tags.length === 0 ? [] : await RfidTag.findAll({
    attributes: ['rfid_number'],
    where: { rfid_number: { [Op.in]: normalized.tags.map((tag) => tag.rfid_number) } },
  });
  const existingNumbers = new Set(existingTags.map((tag) => tag.rfid_number));

  for (const item of normalized.tags) {
    if (existingNumbers.has(item.rfid_number)) {
      errors.push({
        ...item,
        code: 'already_registered',
        message: 'RFID UID is already registered.',
      });
      continue;
    }

    try {
      // Valid tags must still be saved when another tag in the batch is a duplicate.
      const tag = await RfidTag.create({ rfid_number: item.rfid_number, status: 'available' });
      results.push({
        ...item,
        id: tag.id,
        status: tag.status,
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;

      errors.push({
        ...item,
        code: 'already_registered',
        message: 'RFID UID is already registered.',
      });
    }
  }

  const status = results.length > 0 ? 201 : normalized.tags.length > 0 ? 409 : 400;
  return {
    status,
    body: {
      success: results.length > 0,
      total_requested: rfidTags.length,
      total_inserted: results.length,
      total_errors: errors.length,
      results,
      errors,
    },
  };
}

async function getTagById(id) {
  return RfidTag.findByPk(id);
}

async function deleteTag(id) {
  const tag = await getTagById(id);
  if (!tag) return { found: false, deleted: false };

  const assignedPlanCount = await PoPackPlan.count({ where: { rfid_tag_id: tag.id } });
  if (tag.status !== 'available' || assignedPlanCount) {
    return { found: true, deleted: false, inUse: true };
  }

  await tag.destroy();
  return { found: true, deleted: true };
}

module.exports = { deleteTag, getTagById, listTags, registerTags };
