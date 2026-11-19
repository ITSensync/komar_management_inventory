const { Op } = require('sequelize');
const {
  sequelize,
  InventoryMovement,
  PoPackPlan,
  PoSessionItem,
  Product,
  Rack,
  RfidTag,
} = require('../models');
const { normalizeRfidTags } = require('../utils/rfidTags');
const { normalizePlacementRequest } = require('../utils/placement');

function failure(status, message, errors) {
  return { status, body: { success: false, message, ...(errors ? { errors } : {}) } };
}

function planInclude() {
  return [{
    model: PoSessionItem,
    as: 'item',
    attributes: ['id', 'po_session_id', 'product_id', 'sku_snapshot', 'product_name_snapshot', 'base_unit_snapshot', 'expires_on'],
    include: [{ model: Product, as: 'product', attributes: ['id', 'sku', 'name'] }],
  }];
}

function itemSummary(plan, tag, rack) {
  const item = plan.item;
  return {
    rfid_number: tag.rfid_number,
    rfid_tag_id: tag.id,
    pack_plan_id: plan.id,
    pack_number: plan.sequence_number,
    label_code: plan.label_code,
    product_id: item.product_id,
    sku: item.sku_snapshot,
    product_name: item.product_name_snapshot,
    expires_on: item.expires_on,
    placement_status: plan.placement_status,
    current_rack: rack ? { id: rack.id, code: rack.code, name: rack.name } : null,
  };
}

async function getExistingRequest(clientRequestId) {
  return InventoryMovement.findAll({
    where: { client_request_id: clientRequestId, movement_type: 'placement' },
    include: [
      { model: Rack, as: 'toRack', attributes: ['id', 'code', 'name'] },
      { model: RfidTag, as: 'rfidTag', attributes: ['id', 'rfid_number'] },
      { model: PoPackPlan, as: 'packPlan', include: planInclude() },
    ],
    order: [['createdAt', 'ASC']],
  });
}

function existingRequestResponse(movements, request) {
  const requested = [...request.rfid_numbers].sort();
  const existing = movements.map((movement) => movement.rfidTag.rfid_number).sort();
  const sameRack = movements.every((movement) => movement.to_rack_id === request.rack_id);
  if (!sameRack || requested.join('|') !== existing.join('|')) {
    return failure(409, 'client_request_id was already used for a different placement request.', [{
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Use a new client_request_id for a different batch.',
    }]);
  }
  const rack = movements[0].toRack;
  return {
    status: 200,
    body: {
      success: true,
      reused: true,
      data: {
        client_request_id: request.client_request_id,
        rack,
        total_placed: movements.length,
        placed_at: movements[0].createdAt,
        items: movements.map((movement) => itemSummary(movement.packPlan, movement.rfidTag, rack)),
      },
      message: 'The placement request was already completed.',
    },
  };
}

async function previewPlacement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure(400, 'Validation failed.', [{ field: 'body', message: 'Placement data must be an object.' }]);
  }
  const normalized = normalizeRfidTags(input.rfid_numbers);
  if (normalized.error) return failure(400, 'Validation failed.', [{ field: 'rfid_numbers', message: normalized.error }]);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors.map((error) => ({ field: 'rfid_numbers', ...error })));

  const tagNumbers = normalized.tags.map((tag) => tag.rfid_number);
  const tags = await RfidTag.findAll({ where: { rfid_number: { [Op.in]: tagNumbers } } });
  const tagsByNumber = new Map(tags.map((tag) => [tag.rfid_number, tag]));
  const plans = tags.length ? await PoPackPlan.findAll({
    where: { rfid_tag_id: { [Op.in]: tags.map((tag) => tag.id) } },
    include: planInclude(),
  }) : [];
  const plansByTagId = new Map(plans.map((plan) => [plan.rfid_tag_id, plan]));
  const items = tagNumbers.map((rfidNumber) => {
    const tag = tagsByNumber.get(rfidNumber);
    if (!tag) return { rfid_number: rfidNumber, eligible: false, error_code: 'RFID_NOT_REGISTERED', message: 'RFID tag is not registered.' };
    const plan = plansByTagId.get(tag.id);
    if (!plan) return { rfid_number: rfidNumber, eligible: false, error_code: 'PACK_PLAN_NOT_FOUND', message: 'RFID tag is not assigned to a pack plan.' };
    const eligible = plan.placement_status === 'unplaced' && plan.status !== 'cancelled';
    return {
      ...itemSummary(plan, tag, null),
      eligible,
      ...(eligible ? {} : { error_code: 'RFID_ALREADY_PLACED', message: 'This RFID is not eligible for placement.' }),
    };
  });
  return { status: 200, body: { success: true, data: { eligible: items.every((item) => item.eligible), items } } };
}

async function createPlacement(input) {
  const normalized = normalizePlacementRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);
  const request = normalized.data;
  const existing = await getExistingRequest(request.client_request_id);
  if (existing.length) return existingRequestResponse(existing, request);

  return sequelize.transaction(async (transaction) => {
    const rack = await Rack.findByPk(request.rack_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!rack) return failure(404, 'Rack not found.', [{ field: 'rack_id', code: 'RACK_NOT_FOUND', message: 'Rack does not exist.' }]);
    if (rack.status !== 'active') return failure(409, 'Rack is inactive.', [{ field: 'rack_id', code: 'RACK_INACTIVE', message: 'Choose an active rack.' }]);

    const records = [];
    const errors = [];
    // Always acquire RFID row locks in a stable order so two batches with
    // overlapping RFID lists do not deadlock when they arrive concurrently.
    for (const rfidNumber of [...request.rfid_numbers].sort()) {
      const tag = await RfidTag.findOne({ where: { rfid_number: rfidNumber }, transaction, lock: transaction.LOCK.UPDATE });
      if (!tag) {
        errors.push({ rfid_number: rfidNumber, code: 'RFID_NOT_REGISTERED', message: 'RFID tag is not registered.' });
        continue;
      }
      const plan = await PoPackPlan.findOne({
        where: { rfid_tag_id: tag.id },
        include: planInclude(),
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!plan) {
        errors.push({ rfid_number: rfidNumber, code: 'PACK_PLAN_NOT_FOUND', message: 'RFID tag is not assigned to a pack plan.' });
        continue;
      }
      if (plan.status === 'cancelled') {
        errors.push({ rfid_number: rfidNumber, code: 'PACK_PLAN_CANCELLED', message: 'This pack plan is cancelled.' });
        continue;
      }
      if (plan.placement_status !== 'unplaced' || plan.current_rack_id) {
        errors.push({ rfid_number: rfidNumber, code: 'RFID_ALREADY_PLACED', message: 'This RFID has already been placed.' });
        continue;
      }
      records.push({ tag, plan });
    }

    if (errors.length) return failure(409, 'Placement validation failed.', errors);

    const createdAt = new Date();
    await PoPackPlan.update({ placement_status: 'placed', current_rack_id: rack.id }, {
      where: { id: { [Op.in]: records.map(({ plan }) => plan.id) } },
      transaction,
    });
    records.forEach(({ plan }) => {
      plan.placement_status = 'placed';
      plan.current_rack_id = rack.id;
    });
    await InventoryMovement.bulkCreate(records.map(({ tag, plan }) => ({
      po_pack_plan_id: plan.id,
      rfid_tag_id: tag.id,
      movement_type: 'placement',
      from_rack_id: null,
      to_rack_id: rack.id,
      source: 'mobile',
      client_request_id: request.client_request_id,
      createdAt,
      updatedAt: createdAt,
    })), { transaction });

    return {
      status: 201,
      body: {
        success: true,
        data: {
          client_request_id: request.client_request_id,
          rack: { id: rack.id, code: rack.code, name: rack.name },
          total_placed: records.length,
          placed_at: createdAt,
          items: records.map(({ tag, plan }) => itemSummary(plan, tag, rack)),
        },
        message: `${records.length} item(s) placed successfully.`,
      },
    };
  });
}

async function listPlacementHistory(input = {}) {
  const limit = Math.min(Math.max(Number.parseInt(input.limit, 10) || 20, 1), 100);
  const offset = Math.max(Number.parseInt(input.offset, 10) || 0, 0);
  const { count, rows } = await InventoryMovement.findAndCountAll({
    where: { movement_type: 'placement' },
    include: [
      { model: Rack, as: 'toRack', attributes: ['id', 'code', 'name'] },
      { model: RfidTag, as: 'rfidTag', attributes: ['id', 'rfid_number'] },
      { model: PoPackPlan, as: 'packPlan', include: planInclude() },
    ],
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });
  return {
    total: count,
    limit,
    offset,
    items: rows.map((movement) => ({
      id: movement.id,
      created_at: movement.createdAt,
      movement_type: movement.movement_type,
      client_request_id: movement.client_request_id,
      rack: movement.toRack,
      item: itemSummary(movement.packPlan, movement.rfidTag, movement.toRack),
    })),
  };
}

module.exports = { createPlacement, listPlacementHistory, previewPlacement };
