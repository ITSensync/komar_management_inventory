const crypto = require('crypto');
const { Op, UniqueConstraintError } = require('sequelize');
const {
  sequelize,
  Product,
  PoSession,
  PoSessionItem,
  PoPackPlan,
  RfidTag,
  InventoryMovement,
  LabelPrintJob,
  LabelPrintItem,
  RfidScanSession,
} = require('../models');
const { normalizeRfidTags } = require('../utils/rfidTags');
const { calculateRepackPlan, normalizePoSession, normalizePoSessionItem, normalizePrintFormat } = require('../utils/poSessions');
const { evaluateRfidEligibility } = require('../utils/rfidEligibility');
const { recordRfidLifecycleEvent } = require('./rfidHistoryService');

function validationResult(errors) {
  return { status: 400, body: { success: false, message: 'Validation failed.', errors } };
}

function failure(status, message, errors) {
  return { status, body: { success: false, message, ...(errors ? { errors } : {}) } };
}

function labelCode() {
  return `LBL-${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;
}

async function createSession(input) {
  const normalized = normalizePoSession(input);
  if (normalized.errors.length) return validationResult(normalized.errors);

  try {
    const session = await PoSession.create(normalized.data);
    return { status: 201, body: { success: true, data: session } };
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    return failure(409, 'Session number is already registered.');
  }
}

async function listSessions() {
  return PoSession.findAll({
    include: [{ model: PoSessionItem, as: 'items', attributes: ['id', 'required_rfid_count', 'status'] }],
    order: [['createdAt', 'DESC']],
  });
}

async function getSessionById(id) {
  return PoSession.findByPk(id, {
    include: [{
      model: PoSessionItem,
      as: 'items',
      include: [{
        model: PoPackPlan,
        as: 'packPlans',
        include: [{ model: RfidTag, as: 'rfidTag', attributes: ['id', 'rfid_number', 'status'] }],
      }],
    }, {
      model: LabelPrintJob,
      as: 'labelPrintJobs',
      attributes: ['id', 'po_session_item_id', 'job_type', 'format', 'status', 'label_count', 'printed_at', 'createdAt'],
    }],
    order: [
      [{ model: PoSessionItem, as: 'items' }, 'createdAt', 'ASC'],
      [{ model: PoSessionItem, as: 'items' }, { model: PoPackPlan, as: 'packPlans' }, 'sequence_number', 'ASC'],
      [{ model: LabelPrintJob, as: 'labelPrintJobs' }, 'createdAt', 'DESC'],
    ],
  });
}

async function updateSession(id, input) {
  const session = await PoSession.findByPk(id);
  if (!session) return failure(404, 'PO session not found.');
  if (session.status !== 'active') {
    return failure(409, 'Only an active PO session can be changed.');
  }

  const normalized = normalizePoSession(input, session.toJSON());
  if (normalized.errors.length) return validationResult(normalized.errors);
  try {
    await session.update(normalized.data);
    return { status: 200, body: { success: true, data: session } };
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    return failure(409, 'Session number is already registered.');
  }
}

async function addItem(sessionId, input) {
  const normalized = normalizePoSessionItem(input);
  if (normalized.errors.length) return validationResult(normalized.errors);

  return sequelize.transaction(async (transaction) => {
    const session = await PoSession.findByPk(sessionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!session) return failure(404, 'PO session not found.');
    if (session.status !== 'active') {
      return failure(409, 'Items can only be added to an active PO session.');
    }

    const product = await Product.findByPk(normalized.data.product_id, { transaction });
    if (!product || product.status !== 'active') return failure(400, 'Product must be an active catalog product.');

    const calculation = calculateRepackPlan({
      orderedSupplierPackQuantity: normalized.data.ordered_supplier_pack_quantity,
      supplierPackUnits: product.supplier_pack_units,
      minOutboundUnits: product.min_outbound_units,
      baseUnit: product.base_unit,
    });
    if (calculation.errors.length) return validationResult(calculation.errors);
    const { ordered_quantity: orderedQuantity, required_rfid_count: requiredRfidCount } = calculation.data;
    const item = await PoSessionItem.create({
      po_session_id: session.id,
      product_id: product.id,
      sku_snapshot: product.sku,
      product_name_snapshot: product.name,
      base_unit_snapshot: product.base_unit,
      ordered_supplier_pack_quantity: normalized.data.ordered_supplier_pack_quantity,
      supplier_pack_units_snapshot: product.supplier_pack_units,
      supplier_pack_label_snapshot: product.supplier_pack_label,
      ordered_quantity: orderedQuantity,
      units_per_rfid_pack: product.min_outbound_units,
      min_outbound_units: product.min_outbound_units,
      expires_on: normalized.data.expires_on,
      required_rfid_count: requiredRfidCount,
      notes: normalized.data.notes,
    }, { transaction });

    await PoPackPlan.bulkCreate(Array.from({ length: requiredRfidCount }, (_, index) => ({
      po_session_item_id: item.id,
      sequence_number: index + 1,
      units: product.min_outbound_units,
      label_code: labelCode(),
    })), { transaction });
    return {
      status: 201,
      body: {
        success: true,
        data: item,
        required_rfid_count: requiredRfidCount,
        message: `${requiredRfidCount} RFID pack plans were created.`,
      },
    };
  });
}

async function updateItem(itemId, input) {
  const normalized = normalizePoSessionItem(input);
  if (normalized.errors.length) return validationResult(normalized.errors);

  return sequelize.transaction(async (transaction) => {
    const item = await PoSessionItem.findByPk(itemId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!item) return failure(404, 'PO session item not found.');
    const session = await PoSession.findByPk(item.po_session_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (session.status !== 'active') {
      return failure(409, 'An item can only be changed in an active PO session.');
    }
    const assignedCount = await PoPackPlan.count({ where: { po_session_item_id: item.id, rfid_tag_id: { [Op.not]: null } }, transaction });
    if (assignedCount) return failure(409, 'Remove RFID assignments before changing this item.');

    const product = await Product.findByPk(normalized.data.product_id, { transaction });
    if (!product || product.status !== 'active') return failure(400, 'Product must be an active catalog product.');
    const calculation = calculateRepackPlan({
      orderedSupplierPackQuantity: normalized.data.ordered_supplier_pack_quantity,
      supplierPackUnits: product.supplier_pack_units,
      minOutboundUnits: product.min_outbound_units,
      baseUnit: product.base_unit,
    });
    if (calculation.errors.length) return validationResult(calculation.errors);
    const { ordered_quantity: orderedQuantity, required_rfid_count: requiredRfidCount } = calculation.data;

    await PoPackPlan.destroy({ where: { po_session_item_id: item.id }, transaction });
    await item.update({
      product_id: product.id,
      sku_snapshot: product.sku,
      product_name_snapshot: product.name,
      base_unit_snapshot: product.base_unit,
      ordered_supplier_pack_quantity: normalized.data.ordered_supplier_pack_quantity,
      supplier_pack_units_snapshot: product.supplier_pack_units,
      supplier_pack_label_snapshot: product.supplier_pack_label,
      ordered_quantity: orderedQuantity,
      units_per_rfid_pack: product.min_outbound_units,
      min_outbound_units: product.min_outbound_units,
      expires_on: normalized.data.expires_on,
      required_rfid_count: requiredRfidCount,
      notes: normalized.data.notes,
    }, { transaction });
    await PoPackPlan.bulkCreate(Array.from({ length: requiredRfidCount }, (_, index) => ({
      po_session_item_id: item.id,
      sequence_number: index + 1,
      units: product.min_outbound_units,
      label_code: labelCode(),
    })), { transaction });
    return { status: 200, body: { success: true, data: item, required_rfid_count: requiredRfidCount } };
  });
}

async function deleteItem(itemId) {
  return sequelize.transaction(async (transaction) => {
    const item = await PoSessionItem.findByPk(itemId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!item) return failure(404, 'PO session item not found.');
    const session = await PoSession.findByPk(item.po_session_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (session.status !== 'active') {
      return failure(409, 'An item can only be deleted from an active PO session.');
    }
    const assignedCount = await PoPackPlan.count({ where: { po_session_item_id: item.id, rfid_tag_id: { [Op.not]: null } }, transaction });
    if (assignedCount) return failure(409, 'Remove RFID assignments before deleting this item.');
    await PoPackPlan.destroy({ where: { po_session_item_id: item.id }, transaction });
    await item.destroy({ transaction });
    return { status: 200, body: { success: true, message: 'PO session item deleted successfully.' } };
  });
}

async function scanRfidTags(itemId, rfidTags, externalTransaction = null) {
  const normalized = normalizeRfidTags(rfidTags);
  if (normalized.error) return failure(400, normalized.error);
  const duplicateErrors = normalized.errors.filter((error) => error.code === 'duplicate_in_request');

  const execute = async (transaction) => {
    const item = await PoSessionItem.findByPk(itemId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!item) return failure(404, 'PO session item not found.');
    const session = await PoSession.findByPk(item.po_session_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (session.status !== 'active' || item.status === 'printed') {
      return failure(409, 'RFID cannot be scanned for this PO session item.');
    }

    const plans = await PoPackPlan.findAll({
      where: { po_session_item_id: item.id, status: 'pending_tag' },
      order: [['sequence_number', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const availablePlans = [...plans];
    const results = [];
    const errors = normalized.errors.filter((error) => error.code !== 'duplicate_in_request');
    let ignoredDuplicates = duplicateErrors.length;

    for (const scannedTag of normalized.tags) {
      let tag = await RfidTag.findOne({
        where: { rfid_number: scannedTag.rfid_number },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      let registeredNow = false;
      let existingPlan = tag ? await PoPackPlan.findOne({
        where: { rfid_tag_id: tag.id },
        include: [{
          model: PoSessionItem,
          as: 'item',
          attributes: ['id', 'po_session_id', 'product_name_snapshot'],
          include: [{ model: PoSession, as: 'session', attributes: ['id', 'session_number', 'status'] }],
        }],
        transaction,
        lock: transaction.LOCK.UPDATE,
      }) : null;
      let latestMovement = tag ? await InventoryMovement.findOne({
        where: { rfid_tag_id: tag.id },
        include: [{
          model: PoPackPlan,
          as: 'packPlan',
          attributes: ['id', 'po_session_item_id', 'placement_status'],
          include: [{
            model: PoSessionItem,
            as: 'item',
            attributes: ['id', 'po_session_id', 'product_name_snapshot'],
            include: [{ model: PoSession, as: 'session', attributes: ['id', 'session_number', 'status'] }],
          }],
        }],
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        transaction,
      }) : null;

      // A reader can report the same tag again after the five-second gateway
      // debounce window. If it is already assigned to this exact item, treat
      // the event as a silent no-op instead of showing a failure to the admin.
      if (existingPlan && existingPlan.po_session_item_id === item.id) {
        ignoredDuplicates += 1;
        continue;
      }

      if (!availablePlans.length) {
        errors.push({ ...scannedTag, code: 'no_remaining_pack', message: 'This item already has all required RFID tags.' });
        continue;
      }

      if (!tag) {
        [tag, registeredNow] = await RfidTag.findOrCreate({
          where: { rfid_number: scannedTag.rfid_number },
          defaults: { status: 'available' },
          transaction,
        });
        await tag.reload({ transaction, lock: transaction.LOCK.UPDATE });
        if (registeredNow) {
          await recordRfidLifecycleEvent({
            rfid_tag_id: tag.id,
            event_type: 'registered',
            po_session_id: session.id,
            source: 'admin',
          }, { transaction });
        }
        if (!registeredNow) {
          existingPlan = await PoPackPlan.findOne({
            where: { rfid_tag_id: tag.id },
            include: [{
              model: PoSessionItem,
              as: 'item',
              attributes: ['id', 'po_session_id', 'product_name_snapshot'],
              include: [{ model: PoSession, as: 'session', attributes: ['id', 'session_number', 'status'] }],
            }],
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          latestMovement = await InventoryMovement.findOne({
            where: { rfid_tag_id: tag.id },
            include: [{
              model: PoPackPlan,
              as: 'packPlan',
              attributes: ['id', 'po_session_item_id', 'placement_status'],
              include: [{
                model: PoSessionItem,
                as: 'item',
                attributes: ['id', 'po_session_id', 'product_name_snapshot'],
                include: [{ model: PoSession, as: 'session', attributes: ['id', 'session_number', 'status'] }],
              }],
            }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            transaction,
          });
          if (existingPlan && existingPlan.po_session_item_id === item.id) {
            ignoredDuplicates += 1;
            continue;
          }
        }
      }

      const eligibility = evaluateRfidEligibility({
        tag,
        existingPlan,
        latestMovement,
        targetItemId: item.id,
        targetSessionId: session.id,
      });
      if (!eligibility.eligible) {
        errors.push({ ...scannedTag, ...eligibility });
        continue;
      }

      const plan = availablePlans.shift();

      try {
        await tag.update({ status: 'assigned_to_po' }, { transaction });
      } catch (error) {
        if (!(error instanceof UniqueConstraintError)) throw error;
        availablePlans.unshift(plan);
        errors.push({ ...scannedTag, code: 'RFID_ALREADY_ASSIGNED_TO_PO', message: 'RFID sudah dipakai oleh request lain. Silakan scan ulang dengan UID lain.' });
        continue;
      }

      await plan.update({
        rfid_tag_id: tag.id,
        status: 'tag_assigned',
        assigned_at: new Date(),
      }, { transaction });
      await recordRfidLifecycleEvent({
        rfid_tag_id: tag.id,
        event_type: 'assigned_to_pack',
        po_pack_plan_id: plan.id,
        po_session_id: session.id,
        source: 'admin',
      }, { transaction });
      results.push({
        ...scannedTag,
        id: tag.id,
        pack_plan_id: plan.id,
        pack_number: plan.sequence_number,
        label_code: plan.label_code,
        registered_now: registeredNow,
        code: registeredNow ? 'RFID_REGISTERED_AND_ASSIGNED' : 'RFID_ASSIGNED',
      });
    }

    const pendingCount = await PoPackPlan.count({ where: { po_session_item_id: item.id, status: 'pending_tag' }, transaction });
    if (pendingCount === 0) await item.update({ status: 'ready_to_print' }, { transaction });
    const status = results.length > 0 ? 201 : errors.length > 0 ? 409 : ignoredDuplicates > 0 ? 200 : 400;
    return {
      status,
      body: {
        success: results.length > 0 || ignoredDuplicates > 0,
        total_requested: Array.isArray(rfidTags) ? rfidTags.length : 0,
        total_assigned: results.length,
        total_errors: errors.length,
        ignored_duplicates: ignoredDuplicates,
        remaining_rfid_count: pendingCount,
        results,
        errors,
      },
    };
  };

  return externalTransaction ? execute(externalTransaction) : sequelize.transaction(execute);
}

async function getRfidProgress(itemId) {
  const item = await PoSessionItem.findByPk(itemId);
  if (!item) return null;
  const assigned = await PoPackPlan.count({ where: { po_session_item_id: item.id, rfid_tag_id: { [Op.not]: null } } });
  return {
    po_session_item_id: item.id,
    required_rfid_count: item.required_rfid_count,
    assigned_rfid_count: assigned,
    remaining_rfid_count: item.required_rfid_count - assigned,
    status: item.status,
  };
}

async function releaseRfid(planId) {
  return sequelize.transaction(async (transaction) => {
    const plan = await PoPackPlan.findByPk(planId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!plan) return failure(404, 'PO pack plan not found.');
    if (!plan.rfid_tag_id) return failure(400, 'This pack plan has no RFID assignment.');
    if (plan.status === 'label_printed') return failure(409, 'A printed label cannot be released through this endpoint.');
    const item = await PoSessionItem.findByPk(plan.po_session_item_id, { transaction });
    const session = await PoSession.findByPk(item.po_session_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (session.status !== 'active') return failure(409, 'RFID can only be released from an active PO session.');

    const tag = await RfidTag.findByPk(plan.rfid_tag_id, { transaction, lock: transaction.LOCK.UPDATE });
    await tag.update({ status: 'available' }, { transaction });
    await plan.update({ rfid_tag_id: null, status: 'pending_tag', assigned_at: null }, { transaction });
    await PoSessionItem.update({ status: 'pending_tags' }, { where: { id: plan.po_session_item_id }, transaction });

    const printItems = await LabelPrintItem.findAll({ where: { po_pack_plan_id: plan.id }, attributes: ['label_print_job_id'], transaction });
    if (printItems.length) {
      await LabelPrintJob.update({ status: 'cancelled' }, {
        where: { id: { [Op.in]: printItems.map((printItem) => printItem.label_print_job_id) }, status: 'generated' },
        transaction,
      });
    }
    return { status: 200, body: { success: true, message: 'RFID assignment released successfully.' } };
  });
}

async function createPrintJob(itemId, input) {
  const format = normalizePrintFormat(input && input.format);
  if (format.errors.length) return validationResult(format.errors);
  return sequelize.transaction(async (transaction) => {
    const item = await PoSessionItem.findByPk(itemId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!item) return failure(404, 'PO session item not found.');
    const session = await PoSession.findByPk(item.po_session_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (session.status !== 'active') return failure(409, 'Labels can only be generated for an active PO session.');
    const plans = await PoPackPlan.findAll({
      where: { po_session_item_id: item.id },
      include: [{ model: RfidTag, as: 'rfidTag', attributes: ['id', 'rfid_number'] }],
      order: [['sequence_number', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (plans.length !== item.required_rfid_count || plans.some((plan) => !plan.rfid_tag_id)) {
      return failure(409, 'All required RFID tags must be assigned before labels can be generated.');
    }

    // Creating the initial job is idempotent for an item. The item row is
    // locked above, so concurrent requests are serialized and cannot create
    // duplicate initial jobs. Reprints intentionally use a separate endpoint
    // and continue to create a new job with job_type="reprint".
    const existingInitialJob = await LabelPrintJob.findOne({
      where: {
        po_session_item_id: item.id,
        job_type: 'initial',
        status: { [Op.in]: ['generated', 'printed'] },
      },
      order: [['createdAt', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existingInitialJob) {
      const existingJob = await getPrintJobInTransaction(existingInitialJob.id, transaction);
      return {
        status: 200,
        body: {
          success: true,
          data: existingJob,
          reused: true,
          message: 'The existing initial print job was returned.',
        },
      };
    }

    const job = await createPrintJobForPlans({ session, item, plans, format: format.data, jobType: 'initial', transaction });
    return { status: 201, body: { success: true, data: job } };
  });
}

async function reprintLabel(planId, input) {
  const format = normalizePrintFormat(input && input.format);
  if (format.errors.length) return validationResult(format.errors);
  return sequelize.transaction(async (transaction) => {
    const plan = await PoPackPlan.findByPk(planId, {
      include: [{ model: PoSessionItem, as: 'item' }, { model: RfidTag, as: 'rfidTag', attributes: ['id', 'rfid_number'] }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!plan) return failure(404, 'PO pack plan not found.');
    if (!plan.rfid_tag_id) return failure(409, 'An RFID must be assigned before its label can be printed.');
    const session = await PoSession.findByPk(plan.item.po_session_id, { transaction, lock: transaction.LOCK.UPDATE });
    const job = await createPrintJobForPlans({ session, item: plan.item, plans: [plan], format: format.data, jobType: 'reprint', transaction });
    return { status: 201, body: { success: true, data: job } };
  });
}

async function getPrintJob(jobId) {
  return LabelPrintJob.findByPk(jobId, {
    include: [{
      model: LabelPrintItem,
      as: 'items',
      include: [{
        model: PoPackPlan,
        as: 'packPlan',
        include: [{ model: RfidTag, as: 'rfidTag', attributes: ['id', 'rfid_number'] }],
      }],
    }],
    order: [[{ model: LabelPrintItem, as: 'items' }, 'createdAt', 'ASC']],
  });
}

async function markPrintJobPrinted(jobId) {
  return sequelize.transaction(async (transaction) => {
    const job = await LabelPrintJob.findByPk(jobId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!job) return failure(404, 'Label print job not found.');
    if (job.status === 'cancelled' || job.status === 'failed') return failure(409, 'This label print job cannot be marked as printed.');
    if (job.status === 'printed') return { status: 200, body: { success: true, data: job } };

    const printItems = await LabelPrintItem.findAll({ where: { label_print_job_id: job.id }, transaction, lock: transaction.LOCK.UPDATE });
    const planIds = printItems.map((printItem) => printItem.po_pack_plan_id);
    const plans = await PoPackPlan.findAll({ where: { id: { [Op.in]: planIds } }, transaction, lock: transaction.LOCK.UPDATE });
    await PoPackPlan.update({ status: 'label_printed' }, { where: { id: { [Op.in]: planIds } }, transaction });
    for (const plan of plans) {
      if (plan.rfid_tag_id) {
        await recordRfidLifecycleEvent({
          rfid_tag_id: plan.rfid_tag_id,
          event_type: 'label_printed',
          po_pack_plan_id: plan.id,
          po_session_id: job.po_session_id,
          source: 'admin',
        }, { transaction });
      }
    }
    await job.update({ status: 'printed', printed_at: new Date() }, { transaction });

    const itemIds = [...new Set(plans.map((plan) => plan.po_session_item_id))];
    for (const itemId of itemIds) {
      const unprinted = await PoPackPlan.count({ where: { po_session_item_id: itemId, status: { [Op.ne]: 'label_printed' } }, transaction });
      if (unprinted === 0) await PoSessionItem.update({ status: 'printed' }, { where: { id: itemId }, transaction });
    }
    return { status: 200, body: { success: true, data: job } };
  });
}

async function cancelSession(sessionId) {
  const result = await sequelize.transaction(async (transaction) => {
    const session = await PoSession.findByPk(sessionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!session) return failure(404, 'PO session not found.');
    if (session.status === 'cancelled') return { status: 200, body: { success: true, data: session } };
    if (session.status === 'completed') return failure(409, 'A completed PO session cannot be cancelled.');
    const printed = await PoPackPlan.count({
      include: [{ model: PoSessionItem, as: 'item', where: { po_session_id: session.id }, attributes: [] }],
      where: { status: 'label_printed' },
      transaction,
    });
    if (printed) return failure(409, 'A session with printed labels cannot be cancelled automatically.');

    const sessionItems = await PoSessionItem.findAll({ where: { po_session_id: session.id }, attributes: ['id'], transaction });
    const sessionItemIds = sessionItems.map((item) => item.id);
    const activeScanSessions = await RfidScanSession.findAll({
      where: { po_session_item_id: { [Op.in]: sessionItemIds }, status: { [Op.in]: ['starting', 'active'] } },
      attributes: ['id', 'reader_code'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const plans = await PoPackPlan.findAll({
      include: [{ model: PoSessionItem, as: 'item', where: { po_session_id: session.id }, attributes: [] }],
      where: { rfid_tag_id: { [Op.not]: null } },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const tagIds = plans.map((plan) => plan.rfid_tag_id);
    if (tagIds.length) await RfidTag.update({ status: 'available' }, { where: { id: { [Op.in]: tagIds } }, transaction });
    await PoPackPlan.update({ rfid_tag_id: null, status: 'cancelled', assigned_at: null }, {
      where: { po_session_item_id: { [Op.in]: sessionItemIds } },
      transaction,
    });
    await RfidScanSession.update({ status: 'stopped', stopped_at: new Date() }, {
      where: { po_session_item_id: { [Op.in]: sessionItemIds }, status: { [Op.in]: ['starting', 'active'] } },
      transaction,
    });
    await PoSessionItem.update({ status: 'cancelled' }, { where: { id: { [Op.in]: sessionItemIds } }, transaction });
    await LabelPrintJob.update({ status: 'cancelled' }, { where: { po_session_id: session.id, status: 'generated' }, transaction });
    await session.update({ status: 'cancelled' }, { transaction });
    return {
      status: 200,
      body: { success: true, data: session },
      stopCommands: activeScanSessions.map((scanSession) => ({ readerCode: scanSession.reader_code, scanSessionId: scanSession.id })),
    };
  });
  if (result.stopCommands && result.stopCommands.length) {
    const { sendToReader } = require('./readerSocketService');
    for (const command of result.stopCommands) sendToReader(command.readerCode, { type: 'reader.stop', scan_session_id: command.scanSessionId });
  }
  return { status: result.status, body: result.body };
}

async function completeSession(sessionId) {
  return sequelize.transaction(async (transaction) => {
    const session = await PoSession.findByPk(sessionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!session) return failure(404, 'PO session not found.');
    if (session.status === 'completed') return { status: 200, body: { success: true, data: session } };
    if (session.status === 'cancelled') return failure(409, 'A cancelled PO session cannot be completed.');

    const incompleteItems = await PoSessionItem.count({
      where: { po_session_id: session.id, status: { [Op.ne]: 'printed' } },
      transaction,
    });
    if (incompleteItems) {
      return failure(409, 'All items must have printed labels before the PO session can be completed.');
    }
    const plans = await PoPackPlan.findAll({
      include: [{ model: PoSessionItem, as: 'item', where: { po_session_id: session.id }, attributes: [] }],
      where: { rfid_tag_id: { [Op.not]: null } },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    await session.update({ status: 'completed' }, { transaction });
    for (const plan of plans) {
      await recordRfidLifecycleEvent({
        rfid_tag_id: plan.rfid_tag_id,
        event_type: 'po_completed',
        po_pack_plan_id: plan.id,
        po_session_id: session.id,
        source: 'admin',
      }, { transaction });
    }
    return { status: 200, body: { success: true, data: session } };
  });
}

async function createPrintJobForPlans({ session, item, plans, format, jobType, transaction }) {
  const job = await LabelPrintJob.create({
    po_session_id: session.id,
    po_session_item_id: item.id,
    job_type: jobType,
    format,
    label_count: plans.length,
  }, { transaction });
  const items = [];
  for (const plan of plans) {
    const printVersion = (await LabelPrintItem.count({ where: { po_pack_plan_id: plan.id }, transaction })) + 1;
    items.push({
      label_print_job_id: job.id,
      po_pack_plan_id: plan.id,
      print_version: printVersion,
      label_snapshot: {
        session_number: session.session_number,
        sku: item.sku_snapshot,
        product_name: item.product_name_snapshot,
        base_unit: item.base_unit_snapshot,
        units: plan.units,
        pack_number: plan.sequence_number,
        expiry_date: item.expires_on,
        rfid_uid: plan.rfidTag.rfid_number,
        label_code: plan.label_code,
      },
    });
  }
  await LabelPrintItem.bulkCreate(items, { transaction });
  return getPrintJobInTransaction(job.id, transaction);
}

function getPrintJobInTransaction(jobId, transaction) {
  return LabelPrintJob.findByPk(jobId, {
    include: [{ model: LabelPrintItem, as: 'items' }],
    transaction,
  });
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
  getSessionById,
  listSessions,
  markPrintJobPrinted,
  releaseRfid,
  reprintLabel,
  scanRfidTags,
  updateItem,
  updateSession,
};
