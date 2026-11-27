const { Op, UniqueConstraintError } = require('sequelize');
const {
  sequelize,
  RfidScanEvent,
  RfidScanSession,
  PoSessionItem,
  PoSession,
} = require('../models');
const { normalizeRfidTags } = require('../utils/rfidTags');
const logger = require('../utils/logger');

const recentUidReads = new Map();
const expiryTimers = new Map();

function failure(status, message, errors) {
  return { status, body: { success: false, message, ...(errors ? { errors } : {}) } };
}

function defaultReaderCode() {
  return process.env.RFID_READER_CODE || 'orangepi-reader-01';
}

function clearExpiryTimer(scanSessionId) {
  const timer = expiryTimers.get(scanSessionId);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(scanSessionId);
}

function scheduleExpiry(scanSession) {
  clearExpiryTimer(scanSession.id);
  const delay = Math.max(new Date(scanSession.expires_at).getTime() - Date.now(), 0);
  const timer = setTimeout(() => { void expireScanSession(scanSession.id); }, delay);
  timer.unref?.();
  expiryTimers.set(scanSession.id, timer);
}

function startCommand(scanSession) {
  return {
    type: 'reader.start',
    scan_session_id: scanSession.id,
    ...(scanSession.po_session_item_id ? { item_id: scanSession.po_session_item_id } : {}),
    scan_type: scanSession.scan_type,
    ...(scanSession.movement_type ? { movement_type: scanSession.movement_type } : {}),
    expires_at: new Date(scanSession.expires_at).toISOString(),
  };
}

function buildAck(message, readerCode, status, extra = {}) {
  return {
    type: 'rfid.ack',
    event_id: String(message.event_id),
    scan_session_id: String(message.scan_session_id),
    reader_code: readerCode,
    uid: extra.uid || (typeof message.uid === 'string' ? message.uid.trim().toUpperCase() : null),
    status,
    processed_at: new Date().toISOString(),
    ...extra,
  };
}

function ackFromStoredEvent(event, message, readerCode) {
  if (event.result && event.result.ack) {
    return {
      ...event.result.ack,
      status: 'duplicate',
      code: 'event_id_replayed',
      message: 'Event ID sudah pernah diproses; assignment tidak diulang.',
      processed_at: new Date().toISOString(),
    };
  }
  return buildAck(message, readerCode, 'duplicate', {
    code: 'event_id_replayed',
    message: 'Event ID sudah pernah diproses; assignment tidak diulang.',
    uid: event.rfid_number,
  });
}

async function expireScanSession(scanSessionId) {
  const scanSession = await RfidScanSession.findByPk(scanSessionId);
  if (!scanSession || !['starting', 'active'].includes(scanSession.status)) {
    clearExpiryTimer(scanSessionId);
    return;
  }
  if (new Date(scanSession.expires_at).getTime() > Date.now()) {
    scheduleExpiry(scanSession);
    return;
  }

  await scanSession.update({ status: 'expired', stopped_at: new Date() });
  clearExpiryTimer(scanSessionId);
  logger.warn('scan.expired', { scan_session_id: scanSession.id, reader_code: scanSession.reader_code });
  const { broadcastToScanSession, sendToReader } = require('./readerSocketService');
  sendToReader(scanSession.reader_code, { type: 'reader.stop', scan_session_id: scanSession.id });
  broadcastToScanSession(scanSession.id, {
    type: 'scan.error',
    scan_session_id: scanSession.id,
    code: 'scan_expired',
    message: 'RFID scan session expired.',
  });
}

async function createScanSession(itemId, input = {}) {
  const readerCode = String(input.reader_code || defaultReaderCode()).trim();
  if (!readerCode) return failure(400, 'reader_code is required.');

  const { isReaderConnected, sendToReader } = require('./readerSocketService');
  if (!isReaderConnected(readerCode)) {
    logger.warn('scan.start_rejected', { item_id: itemId, reader_code: readerCode, reason: 'gateway_not_connected' });
    return failure(503, `RFID reader ${readerCode} is not connected to the backend.`);
  }

  const item = await PoSessionItem.findByPk(itemId, { include: [{ model: PoSession, as: 'session' }] });
  if (!item || !item.session) return failure(404, 'PO session item not found.');
  if (item.session.status !== 'active' || item.status !== 'pending_tags') {
    logger.warn('scan.start_rejected', { item_id: itemId, reader_code: readerCode, reason: 'item_not_ready', item_status: item.status });
    return failure(409, 'RFID scanning is only available for an active item with pending tags.');
  }

  const existing = await RfidScanSession.findOne({
    where: { po_session_item_id: itemId, status: { [Op.in]: ['starting', 'active'] } },
    order: [['createdAt', 'DESC']],
  });
  if (existing && new Date(existing.expires_at).getTime() <= Date.now()) {
    await expireScanSession(existing.id);
  }

  if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
    if (existing.reader_code === readerCode) {
      scheduleExpiry(existing);
      const resumed = sendToReader(readerCode, startCommand(existing));
      if (!resumed) return failure(503, `RFID reader ${readerCode} disconnected while resuming the active scan session.`);
      logger.info('scan.reused', { item_id: itemId, reader_code: readerCode, scan_session_id: existing.id });
      return {
        status: 200,
        body: {
          success: true,
          reused: true,
          data: {
            id: existing.id,
            po_session_item_id: itemId,
            reader_code: existing.reader_code,
            status: existing.status,
            expires_at: existing.expires_at,
          },
        },
      };
    }

    const existingReaderConnected = isReaderConnected(existing.reader_code);
    if (!existingReaderConnected) {
      await stopScanSession(existing.id);
      logger.warn('scan.stale_session_reclaimed', {
        item_id: itemId,
        previous_reader_code: existing.reader_code,
        scan_session_id: existing.id,
      });
    } else {
      logger.warn('scan.start_rejected', {
        item_id: itemId,
        reader_code: readerCode,
        reason: 'scan_already_active',
        scan_session_id: existing.id,
      });
      return failure(409, 'This item already has an active RFID scan session.', [{
        code: 'scan_already_active',
        scan_session_id: existing.id,
        reader_code: existing.reader_code,
        message: 'Tutup scanner pada perangkat lain sebelum memulai scan baru.',
      }]);
    }
  }

  const readerBusy = await RfidScanSession.findOne({
    where: { reader_code: readerCode, po_session_item_id: { [Op.ne]: itemId }, status: { [Op.in]: ['starting', 'active'] } },
  });
  if (readerBusy) {
    logger.warn('scan.start_rejected', { item_id: itemId, reader_code: readerCode, reason: 'reader_busy', scan_session_id: readerBusy.id });
    return failure(409, 'This RFID reader is already assigned to another active scan session.');
  }

  const requestedTtl = Number(input.ttl_seconds) || 600;
  const ttlSeconds = Math.min(Math.max(requestedTtl, 30), 3600);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const scanSession = await RfidScanSession.create({
    po_session_item_id: itemId,
    reader_code: readerCode,
    status: 'starting',
    expires_at: expiresAt,
  });
  scheduleExpiry(scanSession);

  const sent = sendToReader(readerCode, startCommand(scanSession));
  if (!sent) {
    clearExpiryTimer(scanSession.id);
    await scanSession.update({ status: 'failed', stopped_at: new Date() });
    logger.error('scan.start_failed', { item_id: itemId, reader_code: readerCode, scan_session_id: scanSession.id, reason: 'command_not_sent' });
    return failure(503, `RFID reader ${readerCode} disconnected before scanning started.`);
  }

  logger.info('scan.started', { item_id: itemId, reader_code: readerCode, scan_session_id: scanSession.id, expires_at: expiresAt.toISOString() });
  return {
    status: 201,
    body: {
      success: true,
      data: {
        id: scanSession.id,
        po_session_item_id: itemId,
        reader_code: readerCode,
        status: scanSession.status,
        expires_at: expiresAt,
      },
    },
  };
}

async function createTerminalScanSession(input = {}) {
  const movementType = String(input.movement_type || '').trim().toLowerCase();
  if (!['outbound', 'trash'].includes(movementType)) {
    return failure(400, 'movement_type must be outbound or trash.', [{
      field: 'movement_type',
      code: 'UNSUPPORTED_INVENTORY_ACTION',
      message: 'Choose outbound or trash for a terminal reader session.',
    }]);
  }

  const readerCode = String(input.reader_code || defaultReaderCode()).trim();
  if (!readerCode) return failure(400, 'reader_code is required.');

  const { isReaderConnected, sendToReader } = require('./readerSocketService');
  if (!isReaderConnected(readerCode)) {
    logger.warn('terminal_scan.start_rejected', { reader_code: readerCode, movement_type: movementType, reason: 'gateway_not_connected' });
    return failure(503, `RFID reader ${readerCode} is not connected to the backend.`);
  }

  let activeSession = await RfidScanSession.findOne({
    where: { reader_code: readerCode, status: { [Op.in]: ['starting', 'active'] } },
    order: [['createdAt', 'DESC']],
  });
  if (activeSession && new Date(activeSession.expires_at).getTime() <= Date.now()) {
    await expireScanSession(activeSession.id);
    activeSession = null;
  }
  if (activeSession) {
    return failure(409, 'This RFID reader is already assigned to another active scan session.', [{
      code: 'scan_already_active',
      scan_session_id: activeSession.id,
      reader_code: readerCode,
      message: 'Tutup scanner pada perangkat lain sebelum memulai scan baru.',
    }]);
  }

  const requestedTtl = Number(input.ttl_seconds) || 600;
  const ttlSeconds = Math.min(Math.max(requestedTtl, 30), 3600);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const scanSession = await RfidScanSession.create({
    po_session_item_id: null,
    reader_code: readerCode,
    scan_type: 'terminal_movement',
    movement_type: movementType,
    status: 'starting',
    expires_at: expiresAt,
  });
  scheduleExpiry(scanSession);

  const sent = sendToReader(readerCode, startCommand(scanSession));
  if (!sent) {
    clearExpiryTimer(scanSession.id);
    await scanSession.update({ status: 'failed', stopped_at: new Date() });
    return failure(503, `RFID reader ${readerCode} disconnected before scanning started.`);
  }

  logger.info('terminal_scan.started', {
    scan_session_id: scanSession.id,
    reader_code: readerCode,
    movement_type: movementType,
    expires_at: expiresAt.toISOString(),
  });
  return {
    status: 201,
    body: {
      success: true,
      data: {
        id: scanSession.id,
        reader_code: readerCode,
        scan_type: scanSession.scan_type,
        movement_type: movementType,
        status: scanSession.status,
        expires_at: expiresAt,
      },
    },
  };
}

async function stopScanSession(scanSessionId) {
  const scanSession = await RfidScanSession.findByPk(scanSessionId);
  if (!scanSession) return failure(404, 'RFID scan session not found.');
  if (!['starting', 'active'].includes(scanSession.status)) {
    return { status: 200, body: { success: true, data: scanSession } };
  }

  clearExpiryTimer(scanSession.id);
  await scanSession.update({ status: 'stopped', stopped_at: new Date() });
  const { broadcastToScanSession, sendToReader } = require('./readerSocketService');
  sendToReader(scanSession.reader_code, { type: 'reader.stop', scan_session_id: scanSession.id });
  broadcastToScanSession(scanSession.id, { type: 'scan.session', scan_session_id: scanSession.id, status: 'stopped' });
  logger.info('scan.stopped', { scan_session_id: scanSession.id, reader_code: scanSession.reader_code });
  return { status: 200, body: { success: true, data: scanSession } };
}

async function getScanSession(scanSessionId) {
  return RfidScanSession.findByPk(scanSessionId, {
    include: [{ model: PoSessionItem, as: 'item', attributes: ['id', 'status', 'required_rfid_count'] }],
  });
}

async function markScanSessionActive(scanSessionId, readerStatus = 'ready') {
  const scanSession = await RfidScanSession.findByPk(scanSessionId);
  if (!scanSession || !['starting', 'active'].includes(scanSession.status)) return scanSession;
  if (new Date(scanSession.expires_at).getTime() <= Date.now()) {
    await expireScanSession(scanSession.id);
    return scanSession;
  }
  if (readerStatus === 'error' || readerStatus === 'offline') return scanSession;
  await scanSession.update({ status: 'active', started_at: scanSession.started_at || new Date() });
  scheduleExpiry(scanSession);
  logger.info('scan.reader_ready', { scan_session_id: scanSession.id, reader_code: scanSession.reader_code });
  return scanSession;
}

async function resumeReaderSessions(readerCode) {
  const { sendToReader } = require('./readerSocketService');
  const sessions = await RfidScanSession.findAll({
    where: { reader_code: readerCode, status: { [Op.in]: ['starting', 'active'] } },
    order: [['createdAt', 'ASC']],
  });
  for (const scanSession of sessions) {
    if (new Date(scanSession.expires_at).getTime() <= Date.now()) {
      await expireScanSession(scanSession.id);
      continue;
    }
    scheduleExpiry(scanSession);
    sendToReader(readerCode, startCommand(scanSession));
    logger.info('scan.resume_requested', { scan_session_id: scanSession.id, reader_code: readerCode });
  }
}

async function processReaderEvent(message, readerCode) {
  const { broadcastToScanSession, sendToReader } = require('./readerSocketService');
  const scanSession = await RfidScanSession.findByPk(message.scan_session_id);
  if (!scanSession) return buildAck(message, readerCode, 'rejected', { code: 'scan_session_not_found', message: 'RFID scan session not found.' });

  const normalized = normalizeRfidTags([message.uid]);
  if (normalized.error || !normalized.tags.length) {
    const ack = buildAck(message, readerCode, 'rejected', { code: 'invalid_uid', message: normalized.error || 'RFID UID is invalid.' });
    logger.warn('rfid.rejected', { scan_session_id: scanSession.id, event_id: message.event_id, uid: message.uid, reason: 'invalid_uid' });
    broadcastToScanSession(scanSession.id, { type: 'scan.error', scan_session_id: scanSession.id, code: ack.code, message: ack.message });
    return ack;
  }

  const uid = normalized.tags[0].rfid_number;
  const recentKey = `${scanSession.id}:${uid}`;
  const previousReadAt = recentUidReads.get(recentKey);
  if (previousReadAt && Date.now() - previousReadAt < 5000) {
    const ack = buildAck(message, readerCode, 'duplicate', { uid, code: 'duplicate_read', message: 'UID yang sama baru saja terbaca dan diabaikan.' });
    logger.debug('rfid.duplicate_read', { scan_session_id: scanSession.id, uid });
    broadcastToScanSession(scanSession.id, { type: 'scan.duplicate', scan_session_id: scanSession.id, uid, message: ack.message });
    return ack;
  }

  const outcome = await sequelize.transaction(async (transaction) => {
    const lockedSession = await RfidScanSession.findByPk(scanSession.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!lockedSession || !['starting', 'active'].includes(lockedSession.status)) {
      return { ack: buildAck(message, readerCode, 'rejected', { uid, code: 'scan_not_active', message: 'RFID scan session is no longer active.' }), scanSession: lockedSession };
    }
    if (new Date(lockedSession.expires_at).getTime() <= Date.now()) {
      await lockedSession.update({ status: 'expired', stopped_at: new Date() }, { transaction });
      return { ack: buildAck(message, readerCode, 'rejected', { uid, code: 'scan_expired', message: 'RFID scan session expired.' }), scanSession: lockedSession, expired: true };
    }

    const existingEvent = await RfidScanEvent.findOne({ where: { event_id: String(message.event_id) }, transaction, lock: transaction.LOCK.UPDATE });
    if (existingEvent) {
      return { ack: ackFromStoredEvent(existingEvent, message, readerCode), existingEvent, scanSession: lockedSession };
    }

    if (lockedSession.scan_type === 'terminal_movement') {
      const inspection = await require('./placementService').inspectTerminalMovement(
        [uid],
        lockedSession.movement_type,
        { transaction },
      );
      const item = inspection.items[0];
      const accepted = Boolean(item && item.eligible);
      const firstError = inspection.errors[0];
      const errorCode = firstError ? firstError.error_code : undefined;
      const errorMessage = firstError ? firstError.message : undefined;
      const body = {
        success: accepted,
        movement_type: lockedSession.movement_type,
        total_requested: 1,
        total_assigned: accepted ? 1 : 0,
        total_errors: accepted ? 0 : 1,
        remaining_rfid_count: null,
        results: accepted ? [item] : [],
        errors: accepted ? [] : [{
          rfid_number: uid,
          code: errorCode || 'scan_rejected',
          message: errorMessage || 'RFID is not eligible for this inventory action.',
        }],
      };
      const ack = buildAck(message, readerCode, accepted ? 'stored' : 'rejected', {
        uid,
        ...(errorCode ? { code: errorCode, message: errorMessage } : {}),
        ...(accepted ? {
          movement_type: lockedSession.movement_type,
          pack_plan_id: item.pack_plan_id,
          pack_number: item.pack_number,
          label_code: item.label_code,
          product_id: item.product_id,
          sku: item.sku,
          product_name: item.product_name,
          units: item.units,
          base_unit: item.base_unit,
        } : {}),
      });

      await RfidScanEvent.create({
        rfid_scan_session_id: lockedSession.id,
        event_id: String(message.event_id),
        rfid_number: uid,
        observed_at: message.observed_at ? new Date(message.observed_at) : new Date(),
        status: accepted ? 'accepted' : 'rejected',
        error_code: errorCode || null,
        result: { ack, scan_result: body },
      }, { transaction });
      await lockedSession.update({ last_event_at: new Date(), status: 'active' }, { transaction });
      return { ack, body, scanSession: lockedSession, completed: false, terminal: true };
    }

    const result = await require('./poSessionService').scanRfidTags(lockedSession.po_session_item_id, [uid], transaction);
    const body = result.body;
    const assigned = body.total_assigned > 0;
    const ignoredDuplicate = body.ignored_duplicates > 0;
    const firstError = body.errors && body.errors[0];
    const status = assigned ? 'stored' : ignoredDuplicate ? 'duplicate' : 'rejected';
    const errorCode = firstError ? firstError.code : ignoredDuplicate ? 'duplicate_read' : result.status >= 400 ? 'scan_rejected' : undefined;
    const errorMessage = firstError ? firstError.message : result.status >= 400 ? body.message : undefined;
    const ack = buildAck(message, readerCode, status, {
      uid,
      ...(errorCode ? { code: errorCode, message: errorMessage } : {}),
      ...(assigned && body.results[0] ? {
        pack_plan_id: body.results[0].pack_plan_id,
        pack_number: body.results[0].pack_number,
        label_code: body.results[0].label_code,
      } : {}),
      remaining_rfid_count: body.remaining_rfid_count,
    });

    // Re-check after the item lock. A concurrent retry with the same event_id
    // waits for the first transaction and then receives the original ack.
    const committedEvent = await RfidScanEvent.findOne({ where: { event_id: String(message.event_id) }, transaction, lock: transaction.LOCK.UPDATE });
    if (committedEvent) return { ack: ackFromStoredEvent(committedEvent, message, readerCode), existingEvent: committedEvent, scanSession: lockedSession };

    await RfidScanEvent.create({
      rfid_scan_session_id: lockedSession.id,
      event_id: String(message.event_id),
      rfid_number: uid,
      observed_at: message.observed_at ? new Date(message.observed_at) : new Date(),
      status: status === 'stored' ? 'accepted' : status,
      error_code: errorCode || null,
      result: { ack, scan_result: body },
    }, { transaction });

    const completed = body.remaining_rfid_count === 0;
    await lockedSession.update({
      last_event_at: new Date(),
      status: completed ? 'completed' : 'active',
      ...(completed ? { stopped_at: new Date() } : {}),
    }, { transaction });
    return { ack, body, scanSession: lockedSession, completed };
  });

  if (outcome.existingEvent) {
    broadcastToScanSession(scanSession.id, { type: 'scan.result', scan_session_id: scanSession.id, event_id: outcome.ack.event_id, duplicate_event: true, result: outcome.existingEvent.result.scan_result || outcome.existingEvent.result });
    return outcome.ack;
  }
  if (outcome.expired) {
    clearExpiryTimer(scanSession.id);
    sendToReader(scanSession.reader_code, { type: 'reader.stop', scan_session_id: scanSession.id });
    broadcastToScanSession(scanSession.id, { type: 'scan.error', scan_session_id: scanSession.id, code: outcome.ack.code, message: outcome.ack.message });
    return outcome.ack;
  }

  if (!outcome.body) {
    broadcastToScanSession(scanSession.id, { type: 'scan.error', scan_session_id: scanSession.id, code: outcome.ack.code, message: outcome.ack.message });
    return outcome.ack;
  }

  recentUidReads.set(recentKey, Date.now());
  const recentTimer = setTimeout(() => recentUidReads.delete(recentKey), 5000);
  recentTimer.unref?.();
  if (outcome.completed) {
    clearExpiryTimer(scanSession.id);
    logger.info('scan.completed', { scan_session_id: scanSession.id, item_id: scanSession.po_session_item_id });
    sendToReader(scanSession.reader_code, { type: 'reader.stop', scan_session_id: scanSession.id });
  }
  if (outcome.ack.status === 'stored') {
    logger.info(outcome.terminal ? 'rfid.terminal_scanned' : 'rfid.assigned', {
      scan_session_id: scanSession.id,
      event_id: message.event_id,
      uid,
      ...(outcome.terminal ? { movement_type: outcome.body.movement_type } : { remaining_rfid_count: outcome.body.remaining_rfid_count }),
    });
  } else {
    logger.warn('rfid.rejected', { scan_session_id: scanSession.id, event_id: message.event_id, uid, error_code: outcome.ack.code, message: outcome.ack.message });
  }
  broadcastToScanSession(scanSession.id, { type: 'scan.result', scan_session_id: scanSession.id, event_id: outcome.ack.event_id, result: outcome.body });
  return outcome.ack;
}

module.exports = {
  createScanSession,
  createTerminalScanSession,
  expireScanSession,
  getScanSession,
  markScanSessionActive,
  processReaderEvent,
  resumeReaderSessions,
  stopScanSession,
};
