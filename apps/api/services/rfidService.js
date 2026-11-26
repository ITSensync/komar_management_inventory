const { Op, UniqueConstraintError } = require('sequelize');
const RfidTag = require('../models/RfidTag');
const { PoPackPlan, RfidLifecycleEvent, Rack } = require('../models');
const { normalizeRfidTags } = require('../utils/rfidTags');
const { recordRfidLifecycleEvent } = require('./rfidHistoryService');

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
        code: 'RFID_ALREADY_REGISTERED',
        message: 'RFID UID is already registered. Use the assignment/reuse flow instead of registering it again.',
      });
      continue;
    }

    try {
      // Valid tags must still be saved when another tag in the batch is a duplicate.
      const tag = await RfidTag.create({ rfid_number: item.rfid_number, status: 'available' });
      await recordRfidLifecycleEvent({
        rfid_tag_id: tag.id,
        event_type: 'registered',
        source: 'admin',
      });
      results.push({
        ...item,
        id: tag.id,
        status: tag.status,
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;

      errors.push({
        ...item,
        code: 'RFID_ALREADY_REGISTERED',
        message: 'RFID UID is already registered. Use the assignment/reuse flow instead of registering it again.',
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

async function listTagHistory(id) {
  const tag = await RfidTag.findByPk(id, { attributes: ['id', 'rfid_number', 'status'] });
  if (!tag) return null;
  const events = await RfidLifecycleEvent.findAll({
    where: { rfid_tag_id: tag.id },
    include: [
      { model: Rack, as: 'fromRack', attributes: ['id', 'code', 'name'] },
      { model: Rack, as: 'toRack', attributes: ['id', 'code', 'name'] },
    ],
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  return {
    tag,
    events: events.map((event) => ({
      id: event.id,
      cycle_number: event.cycle_number,
      event_type: event.event_type,
      po_pack_plan_id: event.po_pack_plan_id,
      po_session_id: event.po_session_id,
      stocktake_session_id: event.stocktake_session_id,
      from_rack: event.fromRack,
      to_rack: event.toRack,
      source: event.source,
      metadata: event.metadata,
      created_at: event.createdAt,
    })),
  };
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

module.exports = { deleteTag, getTagById, listTagHistory, listTags, registerTags };
