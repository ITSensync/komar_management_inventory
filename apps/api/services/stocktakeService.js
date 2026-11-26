const crypto = require('crypto');
const { Op, UniqueConstraintError } = require('sequelize');
const {
  sequelize,
  StocktakeSession,
  StocktakeSessionItem,
  StocktakeScanEvent,
  PoPackPlan,
  PoSessionItem,
  PoSession,
  Product,
  RfidTag,
  Rack,
  InventoryMovement,
} = require('../models');
const { adminReadiness, adminNotReadyError, ADMIN_NOT_READY_MESSAGE } = require('../utils/placementEligibility');
const { normalizeStocktakeScanRequest, normalizeStocktakeSessionRequest } = require('../utils/stocktakes');
const { recordRfidLifecycleEvent } = require('./rfidHistoryService');

function failure(status, message, errors) {
  return { status, body: { success: false, message, ...(errors ? { errors } : {}) } };
}

function planInclude() {
  return [{
    model: PoSessionItem,
    as: 'item',
    attributes: ['id', 'po_session_id', 'product_id', 'sku_snapshot', 'product_name_snapshot', 'base_unit_snapshot', 'expires_on', 'status'],
    include: [{ model: PoSession, as: 'session', attributes: ['id', 'session_number', 'status'] }],
  }, {
    model: RfidTag,
    as: 'rfidTag',
    attributes: ['id', 'rfid_number', 'status'],
  }, {
    model: Rack,
    as: 'currentRack',
    attributes: ['id', 'code', 'name', 'status'],
  }];
}

function sessionNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `OPN-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function snapshotFromPlan(plan) {
  return {
    stocktake_session_id: undefined,
    rfid_tag_id: plan.rfidTag.id,
    po_pack_plan_id: plan.id,
    rfid_number_snapshot: plan.rfidTag.rfid_number,
    pack_number_snapshot: plan.sequence_number,
    label_code_snapshot: plan.label_code,
    sku_snapshot: plan.item.sku_snapshot,
    product_name_snapshot: plan.item.product_name_snapshot,
    base_unit_snapshot: plan.item.base_unit_snapshot,
    units_snapshot: plan.units,
    expected_rack_id: plan.currentRack.id,
    expected_rack_code_snapshot: plan.currentRack.code,
    expected_rack_name_snapshot: plan.currentRack.name,
  };
}

function reportItem(item) {
  return {
    id: item.id,
    rfid_number: item.rfid_number_snapshot,
    rfid_tag_id: item.rfid_tag_id,
    pack_plan_id: item.po_pack_plan_id,
    pack_number: item.pack_number_snapshot,
    label_code: item.label_code_snapshot,
    sku: item.sku_snapshot,
    product_name: item.product_name_snapshot,
    base_unit: item.base_unit_snapshot,
    units: item.units_snapshot,
    expected_rack: {
      id: item.expected_rack_id,
      code: item.expected_rack_code_snapshot,
      name: item.expected_rack_name_snapshot,
    },
    observed_rack: item.observedRack ? {
      id: item.observedRack.id,
      code: item.observedRack.code,
      name: item.observedRack.name,
    } : null,
    observed_at: item.observed_at,
    scan_count: item.scan_count,
    result: item.result,
  };
}

function aggregateReport(session, items, rejectedEvents = []) {
  const groups = new Map();
  for (const item of items) {
    const key = item.expected_rack_id;
    if (!groups.has(key)) {
      groups.set(key, {
        rack: { id: item.expected_rack_id, code: item.expected_rack_code_snapshot, name: item.expected_rack_name_snapshot },
        expected_count: 0,
        scanned_count: 0,
        missing_count: 0,
        changed_count: 0,
        items: [],
      });
    }
    const group = groups.get(key);
    group.expected_count += 1;
    if (item.result === 'matched') group.scanned_count += 1;
    if (item.result === 'missing') group.missing_count += 1;
    if (item.result === 'lifecycle_changed') group.changed_count += 1;
    group.items.push(reportItem(item));
  }
  const summary = {
    expected_count: items.length,
    scanned_count: items.filter((item) => item.result === 'matched').length,
    missing_count: items.filter((item) => item.result === 'missing').length,
    changed_count: items.filter((item) => item.result === 'lifecycle_changed').length,
    rejected_count: rejectedEvents.length,
    total_units_expected: items.reduce((sum, item) => sum + item.units_snapshot, 0),
    total_units_scanned: items.filter((item) => item.result === 'matched').reduce((sum, item) => sum + item.units_snapshot, 0),
  };
  return {
    session: {
      id: session.id,
      session_number: session.session_number,
      session_date: session.session_date,
      status: session.status,
      notes: session.notes,
      created_at: session.createdAt,
      started_at: session.started_at,
      submitted_at: session.submitted_at,
    },
    summary,
    racks: [...groups.values()].sort((a, b) => a.rack.code.localeCompare(b.rack.code)),
    rejected_scans: rejectedEvents.map((event) => ({
      id: event.id,
      rfid_number: event.rfid_number,
      status: event.status,
      error_code: event.error_code,
      result: event.result,
      observed_at: event.observed_at,
    })),
  };
}

async function getSessionReport(id) {
  const session = await StocktakeSession.findByPk(id);
  if (!session) return null;
  const items = await StocktakeSessionItem.findAll({
    where: { stocktake_session_id: id },
    include: [{ model: Rack, as: 'observedRack', attributes: ['id', 'code', 'name'] }],
    order: [['expected_rack_code_snapshot', 'ASC'], ['product_name_snapshot', 'ASC'], ['pack_number_snapshot', 'ASC']],
  });
  const rejectedEvents = await StocktakeScanEvent.findAll({
    where: { stocktake_session_id: id, status: 'rejected' },
    order: [['observed_at', 'DESC']],
  });
  return aggregateReport(session, items, rejectedEvents);
}

async function createSession(input = {}) {
  const normalized = normalizeStocktakeSessionRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);
  const data = normalized.data;
  const now = new Date();
  const number = data.session_number || sessionNumber();
  return sequelize.transaction(async (transaction) => {
    let session;
    try {
      session = await StocktakeSession.create({
        session_number: number,
        session_date: now.toISOString().slice(0, 10),
        status: 'draft',
        notes: data.notes,
        started_at: now,
      }, { transaction });
    } catch (error) {
      if (error instanceof UniqueConstraintError) return failure(409, 'Stocktake session number is already registered.');
      throw error;
    }

    const plans = await PoPackPlan.findAll({
      where: {
        placement_status: 'placed',
        current_rack_id: { [Op.not]: null },
        rfid_tag_id: { [Op.not]: null },
      },
      include: planInclude(),
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.SHARE,
    });
    const eligiblePlans = plans.filter((plan) => adminReadiness(plan, plan.rfidTag).eligible && plan.currentRack);
    if (eligiblePlans.length) {
      await StocktakeSessionItem.bulkCreate(eligiblePlans.map((plan) => ({
        ...snapshotFromPlan(plan),
        stocktake_session_id: session.id,
      })), { transaction });
    }
    return { status: 201, body: { success: true, data: await getSessionReportInTransaction(session.id, transaction) } };
  });
}

async function getSessionReportInTransaction(id, transaction) {
  const session = await StocktakeSession.findByPk(id, { transaction });
  const items = await StocktakeSessionItem.findAll({
    where: { stocktake_session_id: id },
    include: [{ model: Rack, as: 'observedRack', attributes: ['id', 'code', 'name'] }],
    transaction,
  });
  const rejectedEvents = await StocktakeScanEvent.findAll({ where: { stocktake_session_id: id, status: 'rejected' }, transaction });
  return aggregateReport(session, items, rejectedEvents);
}

async function getSession(id) {
  const report = await getSessionReport(id);
  return report;
}

async function listSessions() {
  const sessions = await StocktakeSession.findAll({ order: [['createdAt', 'DESC']] });
  return Promise.all(sessions.map(async (session) => {
    const report = await getSessionReport(session.id);
    return { ...report.session, summary: report.summary };
  }));
}

function eligibilityError(rfidNumber, code, message, extra = {}) {
  return { rfid_number: rfidNumber, code, error_code: code, message, ...extra };
}

async function scanSession(sessionId, input) {
  const normalized = normalizeStocktakeScanRequest(input);
  if (normalized.errors.length) return failure(400, 'Validation failed.', normalized.errors);
  const request = normalized.data;
  return sequelize.transaction(async (transaction) => {
    const session = await StocktakeSession.findByPk(sessionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!session) return failure(404, 'Stocktake session not found.');
    if (session.status !== 'draft') return failure(409, 'Only a draft stocktake session can receive scans.');

    const eventIds = request.rfid_numbers.map((_, index) => `${request.client_request_id}:${index}`);
    const existingEvents = await StocktakeScanEvent.findAll({ where: { event_id: { [Op.in]: eventIds } }, transaction });
    if (existingEvents.length) {
      const existingReport = await getSessionReportInTransaction(session.id, transaction);
      return {
        status: 200,
        body: {
          success: true,
          reused: true,
          report: existingReport,
          data: existingReport,
          message: 'The stocktake scan request was already processed.',
        },
      };
    }

    const results = [];
    for (const [index, rfidNumber] of request.rfid_numbers.entries()) {
      const eventId = `${request.client_request_id}:${index}`;
      const observedAt = new Date();
      const tag = await RfidTag.findOne({ where: { rfid_number: rfidNumber }, transaction, lock: transaction.LOCK.UPDATE });
      let sessionItem = null;
      let error = null;
      let plan = null;
      if (!tag) {
        error = eligibilityError(rfidNumber, 'RFID_NOT_REGISTERED', 'RFID belum terdaftar pada Admin. Daftarkan UID terlebih dahulu.');
      } else {
        plan = await PoPackPlan.findOne({ where: { rfid_tag_id: tag.id }, include: planInclude(), transaction, lock: transaction.LOCK.UPDATE });
        if (!plan) {
          const latestMovement = await InventoryMovement.findOne({
            where: { rfid_tag_id: tag.id },
            include: [{ model: PoPackPlan, as: 'packPlan', include: planInclude() }],
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            transaction,
          });
          if (latestMovement && ['outbound', 'trash'].includes(latestMovement.movement_type)) {
            error = eligibilityError(rfidNumber, 'RFID_ACTION_ALREADY_COMPLETED', 'RFID sudah outbound/trash dan sudah tersedia untuk lifecycle berikutnya, bukan stok aktif.');
          } else {
            error = eligibilityError(rfidNumber, 'PACK_PLAN_NOT_FOUND', ADMIN_NOT_READY_MESSAGE);
          }
        } else {
          const readiness = adminReadiness(plan, tag);
          if (!readiness.eligible) {
            error = { ...adminNotReadyError(rfidNumber, readiness), code: 'RFID_ADMIN_NOT_READY' };
          } else if (plan.placement_status === 'outbound' || plan.placement_status === 'trash') {
            error = eligibilityError(rfidNumber, 'RFID_ACTION_ALREADY_COMPLETED', 'RFID sudah outbound/trash dan tidak lagi menjadi stok aktif.');
          } else if (plan.placement_status !== 'placed') {
            error = eligibilityError(rfidNumber, 'RFID_NOT_PLACED', 'RFID belum melalui placement sehingga belum dapat diopname.', { placement_status: plan.placement_status });
          } else if (!plan.currentRack) {
            error = eligibilityError(rfidNumber, 'RFID_LOCATION_NOT_FOUND', 'RFID berstatus placed tetapi lokasi rak tidak ditemukan.');
          } else {
            sessionItem = await StocktakeSessionItem.findOne({ where: { stocktake_session_id: session.id, rfid_tag_id: tag.id }, transaction, lock: transaction.LOCK.UPDATE });
            if (!sessionItem) {
              error = eligibilityError(rfidNumber, 'RFID_NOT_IN_SNAPSHOT', 'RFID belum menjadi stok placed saat sesi opname dibuat. Buat sesi opname baru untuk memasukkannya.');
            }
          }
        }
      }

      if (error) {
        await StocktakeScanEvent.create({
          stocktake_session_id: session.id,
          event_id: eventId,
          rfid_tag_id: tag?.id || null,
          rfid_number: rfidNumber,
          observed_at: observedAt,
          status: 'rejected',
          error_code: error.code,
          result: error,
        }, { transaction });
        results.push({ ...error, accepted: false });
        continue;
      }

      if (sessionItem.observed_at) {
        await StocktakeScanEvent.create({
          stocktake_session_id: session.id,
          stocktake_session_item_id: sessionItem.id,
          rfid_tag_id: tag.id,
          event_id: eventId,
          rfid_number: rfidNumber,
          observed_at: observedAt,
          status: 'duplicate',
          result: { code: 'DUPLICATE_IN_SESSION', message: 'RFID sudah pernah terbaca pada sesi ini.' },
        }, { transaction });
        results.push({ rfid_number: rfidNumber, accepted: true, duplicate: true, code: 'DUPLICATE_IN_SESSION' });
        continue;
      }

      const result = sessionItem.expected_rack_id === plan.currentRack.id ? 'matched' : 'lifecycle_changed';
      await sessionItem.update({ observed_rack_id: plan.currentRack.id, observed_at: observedAt, scan_count: 1, result }, { transaction });
      await StocktakeScanEvent.create({
        stocktake_session_id: session.id,
        stocktake_session_item_id: sessionItem.id,
        rfid_tag_id: tag.id,
        event_id: eventId,
        rfid_number: rfidNumber,
        observed_at: observedAt,
        status: 'accepted',
        result: { result, rack_id: plan.currentRack.id },
      }, { transaction });
      await recordRfidLifecycleEvent({
        rfid_tag_id: tag.id,
        event_type: 'stocktake_seen',
        po_pack_plan_id: plan.id,
        po_session_id: plan.item.po_session_id,
        stocktake_session_id: session.id,
        to_rack_id: plan.currentRack.id,
        source: 'stocktake',
        metadata: { result },
      }, { transaction });
      results.push({ rfid_number: rfidNumber, accepted: true, result, rack: plan.currentRack });
    }
    const report = await getSessionReportInTransaction(session.id, transaction);
    return {
      status: results.some((item) => item.accepted) ? 200 : 409,
      body: {
        success: results.some((item) => item.accepted),
        report,
        data: report,
        results,
        message: 'Stocktake scan processed.',
      },
    };
  });
}

async function submitSession(sessionId) {
  return sequelize.transaction(async (transaction) => {
    const session = await StocktakeSession.findByPk(sessionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!session) return failure(404, 'Stocktake session not found.');
    if (session.status === 'submitted') {
      const report = await getSessionReportInTransaction(session.id, transaction);
      return { status: 200, body: { success: true, reused: true, data: report, message: 'The stocktake report was already submitted.' } };
    }
    if (session.status !== 'draft') return failure(409, 'Only a draft stocktake session can be submitted.');

    const items = await StocktakeSessionItem.findAll({ where: { stocktake_session_id: session.id }, transaction, lock: transaction.LOCK.UPDATE });
    for (const item of items) {
      if (item.observed_at) continue;
      const currentPlan = await PoPackPlan.findByPk(item.po_pack_plan_id, { include: planInclude(), transaction, lock: transaction.LOCK.UPDATE });
      const stillEligible = currentPlan && currentPlan.rfidTag && currentPlan.currentRack && currentPlan.placement_status === 'placed' && adminReadiness(currentPlan, currentPlan.rfidTag).eligible;
      await item.update({ result: stillEligible ? 'missing' : 'lifecycle_changed' }, { transaction });
    }
    const submittedAt = new Date();
    await session.update({ status: 'submitted', submitted_at: submittedAt }, { transaction });
    for (const item of items.filter((row) => row.observed_at)) {
      await recordRfidLifecycleEvent({
        rfid_tag_id: item.rfid_tag_id,
        event_type: 'stocktake_submitted',
        po_pack_plan_id: item.po_pack_plan_id,
        stocktake_session_id: session.id,
        source: 'stocktake',
        metadata: { result: item.result },
      }, { transaction });
    }
    const report = await getSessionReportInTransaction(session.id, transaction);
    return { status: 200, body: { success: true, data: report, message: 'Stocktake report submitted successfully.' } };
  });
}

module.exports = { createSession, getSession, listSessions, scanSession, submitSession };
