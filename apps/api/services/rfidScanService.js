const { Op, UniqueConstraintError } = require('sequelize');
const { RfidScanEvent, RfidScanSession, PoSessionItem, PoSession } = require('../models');
const { normalizeRfidTags } = require('../utils/rfidTags');

const recentUidReads = new Map();

function failure(status, message, errors) {
  return { status, body: { success: false, message, ...(errors ? { errors } : {}) } };
}

function defaultReaderCode() {
  return process.env.RFID_READER_CODE || 'orangepi-reader-01';
}

async function createScanSession(itemId, input = {}) {
  const readerCode = String(input.reader_code || defaultReaderCode()).trim();
  if (!readerCode) return failure(400, 'reader_code is required.');

  const { isReaderConnected, sendToReader } = require('./readerSocketService');
  if (!isReaderConnected(readerCode)) {
    return failure(503, `RFID reader ${readerCode} is not connected to the backend.`);
  }

  const session = await PoSessionItem.findByPk(itemId, { include: [{ model: PoSession, as: 'session' }] });
  if (!session || !session.session) return failure(404, 'PO session item not found.');
  if (session.session.status !== 'active' || session.status !== 'pending_tags') {
    return failure(409, 'RFID scanning is only available for an active item with pending tags.');
  }

  const existing = await RfidScanSession.findOne({
    where: { po_session_item_id: itemId, status: { [Op.in]: ['starting', 'active'] } },
  });
  if (existing) return failure(409, 'This item already has an active RFID scan session.');

  const expiresAt = new Date(Date.now() + (Number(input.ttl_seconds) || 600) * 1000);
  const scanSession = await RfidScanSession.create({
    po_session_item_id: itemId,
    reader_code: readerCode,
    status: 'starting',
    expires_at: expiresAt,
  });

  const sent = sendToReader(readerCode, {
    type: 'reader.start',
    scan_session_id: scanSession.id,
    item_id: itemId,
    expires_at: expiresAt.toISOString(),
  });
  if (!sent) {
    await scanSession.update({ status: 'failed', stopped_at: new Date() });
    return failure(503, `RFID reader ${readerCode} disconnected before scanning started.`);
  }

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

async function stopScanSession(scanSessionId) {
  const scanSession = await RfidScanSession.findByPk(scanSessionId);
  if (!scanSession) return failure(404, 'RFID scan session not found.');
  if (!['starting', 'active'].includes(scanSession.status)) {
    return { status: 200, body: { success: true, data: scanSession } };
  }

  await scanSession.update({ status: 'stopped', stopped_at: new Date() });
  const { sendToReader } = require('./readerSocketService');
  sendToReader(scanSession.reader_code, { type: 'reader.stop', scan_session_id: scanSession.id });
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
    await scanSession.update({ status: 'expired', stopped_at: new Date() });
    return scanSession;
  }
  if (readerStatus === 'error' || readerStatus === 'offline') return scanSession;
  await scanSession.update({ status: 'active', started_at: scanSession.started_at || new Date() });
  return scanSession;
}

async function processReaderEvent(message) {
  const scanSession = await RfidScanSession.findByPk(message.scan_session_id);
  const { broadcastToScanSession, sendToReader } = require('./readerSocketService');
  if (!scanSession) return;

  if (!['starting', 'active'].includes(scanSession.status)) {
    broadcastToScanSession(scanSession.id, { type: 'scan.error', scan_session_id: scanSession.id, code: 'scan_not_active', message: 'RFID scan session is no longer active.' });
    return;
  }
  if (new Date(scanSession.expires_at).getTime() <= Date.now()) {
    await scanSession.update({ status: 'expired', stopped_at: new Date() });
    sendToReader(scanSession.reader_code, { type: 'reader.stop', scan_session_id: scanSession.id });
    broadcastToScanSession(scanSession.id, { type: 'scan.error', scan_session_id: scanSession.id, code: 'scan_expired', message: 'RFID scan session expired.' });
    return;
  }

  const normalized = normalizeRfidTags([message.uid]);
  if (normalized.error || !normalized.tags.length) {
    broadcastToScanSession(scanSession.id, { type: 'scan.error', scan_session_id: scanSession.id, code: 'invalid_uid', message: normalized.error || 'RFID UID is invalid.' });
    return;
  }

  const existingEvent = await RfidScanEvent.findOne({ where: { event_id: String(message.event_id) } });
  if (existingEvent) {
    broadcastToScanSession(scanSession.id, { type: 'scan.result', scan_session_id: scanSession.id, event_id: existingEvent.event_id, duplicate_event: true, result: existingEvent.result });
    return;
  }

  const uid = normalized.tags[0].rfid_number;
  const recentKey = `${scanSession.id}:${uid}`;
  const previousReadAt = recentUidReads.get(recentKey);
  if (previousReadAt && Date.now() - previousReadAt < 5000) {
    broadcastToScanSession(scanSession.id, { type: 'scan.duplicate', scan_session_id: scanSession.id, uid, message: 'UID yang sama baru saja terbaca dan diabaikan.' });
    return;
  }
  recentUidReads.set(recentKey, Date.now());
  setTimeout(() => recentUidReads.delete(recentKey), 5000).unref?.();

  const { scanRfidTags } = require('./poSessionService');
  const result = await scanRfidTags(scanSession.po_session_item_id, [uid]);
  const body = result.body;
  const assigned = body.total_assigned > 0;
  const firstError = body.errors && body.errors[0];
  const eventData = {
    rfid_scan_session_id: scanSession.id,
    event_id: String(message.event_id),
    rfid_number: uid,
    observed_at: message.observed_at ? new Date(message.observed_at) : new Date(),
    status: assigned ? 'accepted' : firstError && firstError.code === 'duplicate_in_request' ? 'duplicate' : 'rejected',
    error_code: firstError ? firstError.code : null,
    result: body,
  };
  try {
    await RfidScanEvent.create(eventData);
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
  }

  await scanSession.update({
    last_event_at: new Date(),
    status: body.remaining_rfid_count === 0 ? 'completed' : 'active',
    ...(body.remaining_rfid_count === 0 ? { stopped_at: new Date() } : {}),
  });
  broadcastToScanSession(scanSession.id, {
    type: 'scan.result',
    scan_session_id: scanSession.id,
    event_id: String(message.event_id),
    result: body,
  });
  if (body.remaining_rfid_count === 0) {
    sendToReader(scanSession.reader_code, { type: 'reader.stop', scan_session_id: scanSession.id });
  }
}

module.exports = {
  createScanSession,
  getScanSession,
  markScanSessionActive,
  processReaderEvent,
  stopScanSession,
};
