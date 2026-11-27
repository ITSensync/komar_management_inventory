const { Op } = require('sequelize');
const {
  sequelize,
  InventoryMovement,
  PoPackPlan,
  PoSessionItem,
  PoSession,
  Product,
  Rack,
  RfidTag,
} = require('../models');
const { normalizeRfidTags } = require('../utils/rfidTags');
const { normalizePlacementRequest, normalizeRelocationPreviewRequest } = require('../utils/placement');
const { normalizeInventoryActionRequest, normalizeInventoryPreviewRequest } = require('../utils/inventoryActions');
const { canRelocate, canReuse } = require('../utils/rfidLifecycle');
const { ADMIN_NOT_READY_MESSAGE, adminReadiness, adminNotReadyError } = require('../utils/placementEligibility');
const { recordRfidLifecycleEvent } = require('./rfidHistoryService');

function failure(status, message, errors) {
  return { status, body: { success: false, message, ...(errors ? { errors } : {}) } };
}

function planInclude() {
  return [{
    model: PoSessionItem,
    as: 'item',
    attributes: ['id', 'po_session_id', 'product_id', 'sku_snapshot', 'product_name_snapshot', 'base_unit_snapshot', 'expires_on', 'status'],
    include: [
      { model: Product, as: 'product', attributes: ['id', 'sku', 'name'] },
      { model: PoSession, as: 'session', attributes: ['id', 'session_number', 'status'] },
    ],
  }, {
    model: Rack,
    as: 'currentRack',
    attributes: ['id', 'code', 'name'],
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
    units: plan.units,
    base_unit: item.base_unit_snapshot,
    expires_on: item.expires_on,
    placement_status: plan.placement_status,
    current_rack: rack ? { id: rack.id, code: rack.code, name: rack.name } : null,
  };
}

function terminalMovementError(rfidNumber, code, message, plan = null, tag = null) {
  return {
    ...(plan && tag ? itemSummary(plan, tag, plan.currentRack) : {}),
    rfid_number: rfidNumber,
    eligible: false,
    error_code: code,
    message,
  };
}

async function inspectTerminalMovement(rfidNumbers, movementType, options = {}) {
  if (!['outbound', 'trash'].includes(movementType)) {
    return { items: [], records: [], eligible: false, errors: [{ code: 'UNSUPPORTED_INVENTORY_ACTION', message: 'Unsupported inventory action.' }] };
  }

  const queryOptions = options.transaction
    ? { transaction: options.transaction, lock: options.transaction.LOCK.UPDATE }
    : {};
  const tagNumbers = [...new Set(rfidNumbers)];
  const tags = await RfidTag.findAll({ where: { rfid_number: { [Op.in]: tagNumbers } }, ...queryOptions });
  const tagsByNumber = new Map(tags.map((tag) => [tag.rfid_number, tag]));
  const plans = tags.length ? await PoPackPlan.findAll({
    where: { rfid_tag_id: { [Op.in]: tags.map((tag) => tag.id) } },
    include: planInclude(),
    ...queryOptions,
  }) : [];
  const plansByTagId = new Map(plans.map((plan) => [plan.rfid_tag_id, plan]));
  const records = [];
  const items = tagNumbers.map((rfidNumber) => {
    const tag = tagsByNumber.get(rfidNumber);
    if (!tag) return terminalMovementError(rfidNumber, 'RFID_NOT_REGISTERED', 'RFID tag is not registered.');

    const plan = plansByTagId.get(tag.id);
    if (!plan) return terminalMovementError(rfidNumber, 'PACK_PLAN_NOT_FOUND', 'RFID tag is not assigned to a pack plan.');
    if (plan.status === 'cancelled') return terminalMovementError(rfidNumber, 'PACK_PLAN_CANCELLED', 'This pack plan is cancelled.', plan, tag);
    if (plan.placement_status === 'outbound' || plan.placement_status === 'trash') {
      return terminalMovementError(rfidNumber, 'RFID_ACTION_ALREADY_COMPLETED', 'RFID lifecycle is already outbound or trash.', plan, tag);
    }
    if (plan.placement_status !== 'placed') {
      return terminalMovementError(rfidNumber, 'RFID_NOT_PLACED', 'Only a placed RFID can be marked outbound or trash.', plan, tag);
    }
    if (!plan.current_rack_id || !plan.currentRack) {
      return terminalMovementError(rfidNumber, 'RFID_LOCATION_NOT_FOUND', 'The placed RFID has no current rack.', plan, tag);
    }

    const item = { ...itemSummary(plan, tag, plan.currentRack), eligible: true };
    records.push({ tag, plan, fromRackId: plan.current_rack_id, item });
    return item;
  });

  return {
    items,
    records,
    eligible: items.length > 0 && items.every((item) => item.eligible),
    errors: items.filter((item) => !item.eligible),
  };
}

async function findCurrentPlanForTag(tag, options = {}) {
  const queryOptions = options.transaction ? { transaction: options.transaction, lock: options.transaction.LOCK.UPDATE } : {};
  const directPlan = await PoPackPlan.findOne({
    where: { rfid_tag_id: tag.id },
    include: planInclude(),
    ...queryOptions,
  });
  if (directPlan) return { plan: directPlan, repaired: false };

  // Older data can retain an active placement movement while the current
  // pack plan lost its RFID foreign key. The latest active movement is the
  // authoritative fallback for relocation and is repaired on final submit.
  const latestMovement = await InventoryMovement.findOne({
    where: { rfid_tag_id: tag.id },
    include: [{ model: PoPackPlan, as: 'packPlan', include: planInclude() }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    ...queryOptions,
  });
  if (!latestMovement || !['placement', 'relocation'].includes(latestMovement.movement_type) || !latestMovement.packPlan) {
    return { plan: null, repaired: false };
  }
  return { plan: latestMovement.packPlan, repaired: true };
}

function relocationPreviewItem(rfidNumber, tag, plan, targetRack) {
  if (!tag) return { rfid_number: rfidNumber, eligible: false, error_code: 'RFID_NOT_REGISTERED', message: ADMIN_NOT_READY_MESSAGE };
  if (!plan) return { rfid_number: rfidNumber, eligible: false, error_code: 'PACK_PLAN_NOT_FOUND', message: ADMIN_NOT_READY_MESSAGE };
  if (plan.status === 'cancelled') return { rfid_number: rfidNumber, eligible: false, error_code: 'PACK_PLAN_CANCELLED', message: 'This pack plan is cancelled.' };
  if (plan.placement_status === 'outbound' || plan.placement_status === 'trash') {
    return { ...itemSummary(plan, tag, null), eligible: false, error_code: 'RFID_ACTION_ALREADY_COMPLETED', message: 'RFID lifecycle is already outbound or trash.' };
  }
  if (plan.placement_status !== 'placed') {
    return { ...itemSummary(plan, tag, plan.currentRack), eligible: false, error_code: 'RFID_NOT_PLACED', message: 'Only a placed RFID can be relocated.' };
  }
  if (!plan.current_rack_id || !plan.currentRack) {
    return { ...itemSummary(plan, tag, null), eligible: false, error_code: 'RFID_LOCATION_NOT_FOUND', message: 'The placed RFID has no current rack.' };
  }
  if (plan.current_rack_id === targetRack.id) {
    return { ...itemSummary(plan, tag, plan.currentRack), eligible: false, error_code: 'SAME_RACK', message: 'The RFID is already placed in this rack.' };
  }
  const readiness = adminReadiness(plan, tag);
  if (!readiness.eligible) {
    return { ...itemSummary(plan, tag, plan.currentRack), eligible: false, ...adminNotReadyError(rfidNumber, readiness) };
  }
  return {
    ...itemSummary(plan, tag, plan.currentRack),
    target_rack: { id: targetRack.id, code: targetRack.code, name: targetRack.name },
    eligible: true,
  };
}

async function getExistingRequest(clientRequestId, movementType = 'placement') {
  return InventoryMovement.findAll({
    where: { client_request_id: clientRequestId, movement_type: movementType },
    include: [
      { model: Rack, as: 'toRack', attributes: ['id', 'code', 'name'] },
      { model: Rack, as: 'fromRack', attributes: ['id', 'code', 'name'] },
      { model: RfidTag, as: 'rfidTag', attributes: ['id', 'rfid_number'] },
      { model: PoPackPlan, as: 'packPlan', include: planInclude() },
    ],
    order: [['createdAt', 'ASC']],
  });
}

async function getConflictingRequest(clientRequestId, movementType) {
  return InventoryMovement.findOne({
    where: {
      client_request_id: clientRequestId,
      movement_type: { [Op.ne]: movementType },
    },
    attributes: ['id', 'movement_type'],
  });
}

function idempotencyConflict() {
  return failure(409, 'client_request_id was already used for a different inventory action.', [{
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Use a new client_request_id for a different batch or action.',
  }]);
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

function existingMovementResponse(movements, request, movementType) {
  const requested = [...request.rfid_numbers].sort();
  const existing = movements.map((movement) => movement.rfidTag.rfid_number).sort();
  const sameRack = movements.every((movement) => (movement.to_rack_id || null) === (request.rack_id || null));
  if (!sameRack || requested.join('|') !== existing.join('|')) {
    return failure(409, 'client_request_id was already used for a different inventory action.', [{
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Use a new client_request_id for a different batch or action.',
    }]);
  }

  const first = movements[0];
  return {
    status: 200,
    body: {
      success: true,
      reused: true,
      data: {
        client_request_id: request.client_request_id,
        movement_type: movementType,
        from_rack: first.fromRack || null,
        rack: first.toRack || null,
        total_processed: movements.length,
        processed_at: first.createdAt,
        items: movements.map((movement) => itemSummary(movement.packPlan, movement.rfidTag, movement.toRack)),
      },
      message: `The ${movementType} request was already completed.`,
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
    if (!tag) return { rfid_number: rfidNumber, eligible: false, error_code: 'RFID_NOT_REGISTERED', message: ADMIN_NOT_READY_MESSAGE };
    const plan = plansByTagId.get(tag.id);
    if (!plan) return { rfid_number: rfidNumber, eligible: false, error_code: 'PACK_PLAN_NOT_FOUND', message: ADMIN_NOT_READY_MESSAGE };
    const eligible = plan.placement_status === 'unplaced' && plan.status !== 'cancelled';
    const readiness = adminReadiness(plan, tag);
    if (eligible && !readiness.eligible) {
      return { ...itemSummary(plan, tag, null), eligible: false, ...adminNotReadyError(rfidNumber, readiness) };
    }
    const errorCode = canReuse(plan.placement_status)
      ? 'RFID_ACTION_ALREADY_COMPLETED'
      : plan.status === 'cancelled'
        ? 'PACK_PLAN_CANCELLED'
        : 'RFID_ALREADY_PLACED';
    return {
      ...itemSummary(plan, tag, null),
      eligible,
      ...(eligible ? {} : { error_code: errorCode, message: 'This RFID is not eligible for placement.' }),
    };
  });
  return { status: 200, body: { success: true, data: { eligible: items.every((item) => item.eligible), items } } };
}

async function previewRelocation(input) {
  const normalized = normalizeRelocationPreviewRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);

  const targetRack = await Rack.findByPk(normalized.data.rack_id);
  if (!targetRack) return failure(404, 'Rack not found.', [{ field: 'rack_id', code: 'RACK_NOT_FOUND', message: 'Rack does not exist.' }]);
  if (targetRack.status !== 'active') return failure(409, 'Rack is inactive.', [{ field: 'rack_id', code: 'RACK_INACTIVE', message: 'Choose an active destination rack.' }]);

  const tags = await RfidTag.findAll({ where: { rfid_number: { [Op.in]: normalized.data.rfid_numbers } } });
  const tagsByNumber = new Map(tags.map((tag) => [tag.rfid_number, tag]));
  const items = await Promise.all(normalized.data.rfid_numbers.map(async (rfidNumber) => {
    const tag = tagsByNumber.get(rfidNumber);
    const resolved = tag ? await findCurrentPlanForTag(tag) : { plan: null };
    return relocationPreviewItem(rfidNumber, tag, resolved.plan, targetRack);
  }));

  return {
    status: 200,
    body: {
      success: true,
      data: {
        eligible: items.every((item) => item.eligible),
        target_rack: { id: targetRack.id, code: targetRack.code, name: targetRack.name },
        items,
      },
    },
  };
}

async function createPlacement(input) {
  const normalized = normalizePlacementRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);
  const request = normalized.data;
  if (await getConflictingRequest(request.client_request_id, 'placement')) return idempotencyConflict();
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
        errors.push({ rfid_number: rfidNumber, code: 'RFID_NOT_REGISTERED', message: ADMIN_NOT_READY_MESSAGE });
        continue;
      }
      const resolved = await findCurrentPlanForTag(tag, { transaction });
      const plan = resolved.plan;
      if (!plan) {
        errors.push({ rfid_number: rfidNumber, code: 'PACK_PLAN_NOT_FOUND', message: ADMIN_NOT_READY_MESSAGE });
        continue;
      }
      if (plan.status === 'cancelled') {
        errors.push({ rfid_number: rfidNumber, code: 'PACK_PLAN_CANCELLED', message: 'This pack plan is cancelled.' });
        continue;
      }
      if (canReuse(plan.placement_status)) {
        errors.push({ rfid_number: rfidNumber, code: 'RFID_ACTION_ALREADY_COMPLETED', message: 'This RFID lifecycle is already outbound or trash and cannot be placed again.' });
        continue;
      }
      if (plan.placement_status !== 'unplaced' || plan.current_rack_id) {
        errors.push({ rfid_number: rfidNumber, code: 'RFID_ALREADY_PLACED', message: 'This RFID has already been placed.' });
        continue;
      }
      const readiness = adminReadiness(plan, tag);
      if (!readiness.eligible) {
        errors.push(adminNotReadyError(rfidNumber, readiness));
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
    for (const { tag, plan } of records) {
      await recordRfidLifecycleEvent({
        rfid_tag_id: tag.id,
        event_type: 'placed',
        po_pack_plan_id: plan.id,
        po_session_id: plan.item.po_session_id,
        to_rack_id: rack.id,
        source: 'mobile',
      }, { transaction });
    }

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

async function createRelocation(input) {
  const normalized = normalizePlacementRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);
  const request = normalized.data;
  if (await getConflictingRequest(request.client_request_id, 'relocation')) return idempotencyConflict();
  const existing = await getExistingRequest(request.client_request_id, 'relocation');
  if (existing.length) return existingMovementResponse(existing, request, 'relocation');

  return sequelize.transaction(async (transaction) => {
    const rack = await Rack.findByPk(request.rack_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!rack) return failure(404, 'Rack not found.', [{ field: 'rack_id', code: 'RACK_NOT_FOUND', message: 'Rack does not exist.' }]);
    if (rack.status !== 'active') return failure(409, 'Rack is inactive.', [{ field: 'rack_id', code: 'RACK_INACTIVE', message: 'Choose an active rack.' }]);

    const records = [];
    const errors = [];
    for (const rfidNumber of [...request.rfid_numbers].sort()) {
      const tag = await RfidTag.findOne({ where: { rfid_number: rfidNumber }, transaction, lock: transaction.LOCK.UPDATE });
      if (!tag) {
        errors.push({ rfid_number: rfidNumber, code: 'RFID_NOT_REGISTERED', message: ADMIN_NOT_READY_MESSAGE });
        continue;
      }
      const resolved = await findCurrentPlanForTag(tag, { transaction });
      const plan = resolved.plan;
      if (!plan) {
        errors.push({ rfid_number: rfidNumber, code: 'PACK_PLAN_NOT_FOUND', message: ADMIN_NOT_READY_MESSAGE });
        continue;
      }
      if (plan.status === 'cancelled') {
        errors.push({ rfid_number: rfidNumber, code: 'PACK_PLAN_CANCELLED', message: 'This pack plan is cancelled.' });
        continue;
      }
      if (!canRelocate(plan.placement_status)) {
        errors.push({ rfid_number: rfidNumber, code: 'RFID_NOT_PLACED', message: 'Only a placed RFID can be relocated.' });
        continue;
      }
      if (!plan.current_rack_id) {
        errors.push({ rfid_number: rfidNumber, code: 'RFID_LOCATION_NOT_FOUND', message: 'The placed RFID has no current rack.' });
        continue;
      }
      if (plan.current_rack_id === rack.id) {
        errors.push({ rfid_number: rfidNumber, code: 'SAME_RACK', message: 'The RFID is already placed in this rack.' });
        continue;
      }
      const readiness = adminReadiness(plan, tag);
      if (!readiness.eligible) {
        errors.push(adminNotReadyError(rfidNumber, readiness));
        continue;
      }
      records.push({ tag, plan, fromRackId: plan.current_rack_id, reattach: resolved.repaired });
    }

    if (errors.length) return failure(409, 'Relocation validation failed.', errors);

    const movedAt = new Date();
    for (const { tag, plan, reattach } of records) {
      if (reattach) {
        await plan.update({ rfid_tag_id: tag.id }, { transaction });
        if (tag.status === 'available') await tag.update({ status: 'assigned_to_po' }, { transaction });
      }
    }
    await PoPackPlan.update({ current_rack_id: rack.id }, {
      where: { id: { [Op.in]: records.map(({ plan }) => plan.id) } },
      transaction,
    });
    records.forEach(({ plan }) => { plan.current_rack_id = rack.id; });
    await InventoryMovement.bulkCreate(records.map(({ tag, plan, fromRackId }) => ({
      po_pack_plan_id: plan.id,
      rfid_tag_id: tag.id,
      movement_type: 'relocation',
      from_rack_id: fromRackId,
      to_rack_id: rack.id,
      source: 'mobile',
      client_request_id: request.client_request_id,
      createdAt: movedAt,
      updatedAt: movedAt,
    })), { transaction });
    for (const { tag, plan, fromRackId } of records) {
      await recordRfidLifecycleEvent({
        rfid_tag_id: tag.id,
        event_type: 'relocated',
        po_pack_plan_id: plan.id,
        po_session_id: plan.item.po_session_id,
        from_rack_id: fromRackId,
        to_rack_id: rack.id,
        source: 'mobile',
      }, { transaction });
    }

    return {
      status: 201,
      body: {
        success: true,
        data: {
          client_request_id: request.client_request_id,
          movement_type: 'relocation',
          rack: { id: rack.id, code: rack.code, name: rack.name },
          total_processed: records.length,
          processed_at: movedAt,
          items: records.map(({ tag, plan }) => itemSummary(plan, tag, rack)),
        },
        message: `${records.length} item(s) relocated successfully.`,
      },
    };
  });
}

async function previewTerminalMovement(input, movementType) {
  if (!['outbound', 'trash'].includes(movementType)) return failure(400, 'Unsupported inventory action.');
  const normalized = normalizeInventoryPreviewRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);

  const inspection = await inspectTerminalMovement(normalized.data.rfid_numbers, movementType);
  return {
    status: 200,
    body: {
      success: true,
      data: {
        movement_type: movementType,
        eligible: inspection.eligible,
        total_requested: inspection.items.length,
        total_eligible: inspection.records.length,
        items: inspection.items,
      },
    },
  };
}

async function createTerminalMovement(input, movementType) {
  if (!['outbound', 'trash'].includes(movementType)) {
    return failure(400, 'Unsupported inventory action.');
  }
  const normalized = normalizeInventoryActionRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);
  const request = normalized.data;
  if (await getConflictingRequest(request.client_request_id, movementType)) return idempotencyConflict();
  const existing = await getExistingRequest(request.client_request_id, movementType);
  if (existing.length) return existingMovementResponse(existing, request, movementType);

  return sequelize.transaction(async (transaction) => {
    const inspection = await inspectTerminalMovement([...request.rfid_numbers].sort(), movementType, { transaction });
    const records = inspection.records;
    const errors = inspection.errors;

    if (errors.length) return failure(409, `${movementType} validation failed.`, errors);

    const processedAt = new Date();
    for (const { tag, plan } of records) {
      // The old pack keeps its movement history, while the tag becomes
      // available for a new pack only after outbound/trash is committed.
      await plan.update({ placement_status: movementType, current_rack_id: null, rfid_tag_id: null }, { transaction });
      await tag.update({ status: 'available' }, { transaction });
    }
    await InventoryMovement.bulkCreate(records.map(({ tag, plan, fromRackId }) => ({
      po_pack_plan_id: plan.id,
      rfid_tag_id: tag.id,
      movement_type: movementType,
      from_rack_id: fromRackId,
      to_rack_id: null,
      source: 'mobile',
      client_request_id: request.client_request_id,
      createdAt: processedAt,
      updatedAt: processedAt,
    })), { transaction });
    for (const { tag, plan, fromRackId } of records) {
      await recordRfidLifecycleEvent({
        rfid_tag_id: tag.id,
        event_type: movementType,
        po_pack_plan_id: plan.id,
        po_session_id: plan.item.po_session_id,
        from_rack_id: fromRackId,
        source: 'mobile',
      }, { transaction });
      await recordRfidLifecycleEvent({
        rfid_tag_id: tag.id,
        event_type: 'available_for_reuse',
        po_pack_plan_id: plan.id,
        po_session_id: plan.item.po_session_id,
        source: 'mobile',
      }, { transaction });
    }

    return {
      status: 201,
      body: {
        success: true,
        data: {
          client_request_id: request.client_request_id,
          movement_type: movementType,
          total_processed: records.length,
          processed_at: processedAt,
          items: records.map(({ tag, plan }) => itemSummary(plan, tag, null)),
        },
        message: `${records.length} item(s) marked ${movementType} successfully. RFID is now reusable.`,
      },
    };
  });
}

async function listPlacementHistory(input = {}) {
  const limit = Math.min(Math.max(Number.parseInt(input.limit, 10) || 20, 1), 100);
  const offset = Math.max(Number.parseInt(input.offset, 10) || 0, 0);
  const { count, rows } = await InventoryMovement.findAndCountAll({
    where: { movement_type: { [Op.in]: ['placement', 'relocation', 'outbound', 'trash'] } },
    include: [
      { model: Rack, as: 'toRack', attributes: ['id', 'code', 'name'] },
      { model: Rack, as: 'fromRack', attributes: ['id', 'code', 'name'] },
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
      from_rack: movement.fromRack,
      rack: movement.toRack,
      item: itemSummary(movement.packPlan, movement.rfidTag, movement.toRack),
    })),
  };
}

module.exports = {
  createPlacement,
  createRelocation,
  createTerminalMovement,
  inspectTerminalMovement,
  listPlacementHistory,
  previewTerminalMovement,
  previewPlacement,
  previewRelocation,
};
