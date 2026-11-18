const { WebSocketServer, WebSocket } = require('ws');
const logger = require('../utils/logger');

const gatewayConnections = new Map();
const dashboardConnections = new Set();
const readerStatuses = new Set(['connecting', 'ready', 'reading', 'stopped', 'error', 'offline']);
let webSocketServer;
let heartbeatTimer;

function sendJson(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function gatewayTokenIsValid(token) {
  const expected = process.env.RFID_GATEWAY_TOKEN;
  return Boolean(expected && token && token === expected);
}

function readerCodeIsAllowed(readerCode) {
  const configured = String(process.env.RFID_READER_CODES || process.env.RFID_READER_CODE || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length === 0 || configured.includes(readerCode);
}

async function subscribeDashboard(socket, scanSessionId) {
  if (!scanSessionId || typeof scanSessionId !== 'string') return;
  socket.scanSessionIds.add(scanSessionId);
  logger.info('dashboard.scan_subscribed', { scan_session_id: scanSessionId });
  sendJson(socket, { type: 'subscription.started', scan_session_id: scanSessionId });
  try {
    const { getScanSession } = require('./rfidScanService');
    const session = await getScanSession(scanSessionId);
    if (session) sendJson(socket, {
      type: 'scan.session',
      scan_session_id: scanSessionId,
      status: session.status,
      expires_at: session.expires_at,
    });
  } catch (error) {
    console.error('Unable to send RFID scan session snapshot:', error.message);
  }
}

function broadcastToScanSession(scanSessionId, message) {
  for (const socket of dashboardConnections) {
    if (socket.scanSessionIds.has(scanSessionId)) sendJson(socket, message);
  }
}

function sendToReader(readerCode, message) {
  const socket = gatewayConnections.get(readerCode);
  if (!socket) {
    logger.warn('gateway.command_not_sent', { reader_code: readerCode, command: message.type, reason: 'gateway_not_connected' });
    return false;
  }
  logger.info('gateway.command_sent', { reader_code: readerCode, command: message.type, scan_session_id: message.scan_session_id });
  return sendJson(socket, message);
}

async function handleGatewayMessage(socket, message) {
  if (message.type === 'reader.ready' || message.type === 'reader.status') {
    const status = message.type === 'reader.ready' ? 'ready' : message.status;
    if (message.type === 'reader.status' && !readerStatuses.has(status)) {
      sendJson(socket, { type: 'reader.error', code: 'invalid_reader_status', message: `Unsupported reader status: ${status}.` });
      logger.warn('gateway.status_rejected', { reader_code: socket.readerCode, status });
      return;
    }
    if (message.reader_code && message.reader_code !== socket.readerCode) {
      sendJson(socket, { type: 'reader.error', code: 'reader_code_mismatch', message: 'reader_code does not match the authenticated gateway.' });
      return;
    }
    logger.info(`gateway.${message.type}`, { reader_code: socket.readerCode, scan_session_id: message.scan_session_id, status });
    if (message.scan_session_id) {
      const { markScanSessionActive } = require('./rfidScanService');
      await markScanSessionActive(message.scan_session_id, status);
      broadcastToScanSession(message.scan_session_id, { ...message, reader_code: socket.readerCode, status });
    }
    return;
  }

  if (message.type === 'rfid.detected') {
    logger.info('rfid.event_received', { reader_code: socket.readerCode, scan_session_id: message.scan_session_id, event_id: message.event_id, uid: message.uid });
    if (!message.scan_session_id || !message.event_id || !message.uid) {
      if (message.event_id && message.scan_session_id) {
        sendJson(socket, {
          type: 'rfid.ack',
          event_id: String(message.event_id),
          scan_session_id: String(message.scan_session_id),
          reader_code: socket.readerCode,
          status: 'rejected',
          code: 'invalid_event',
          message: 'RFID event requires scan_session_id, event_id, and uid.',
          processed_at: new Date().toISOString(),
        });
      } else {
        sendJson(socket, { type: 'reader.error', code: 'invalid_event', message: 'RFID event requires scan_session_id, event_id, and uid.' });
      }
      return;
    }
    if (message.observed_at && Number.isNaN(Date.parse(message.observed_at))) {
      sendJson(socket, {
        type: 'rfid.ack',
        event_id: String(message.event_id),
        scan_session_id: String(message.scan_session_id),
        reader_code: socket.readerCode,
        status: 'rejected',
        code: 'invalid_observed_at',
        message: 'observed_at must be a valid ISO-8601 timestamp.',
        processed_at: new Date().toISOString(),
      });
      return;
    }
    const { processReaderEvent } = require('./rfidScanService');
    const ack = await processReaderEvent(message, socket.readerCode);
    if (ack) sendJson(socket, ack);
  }
}

function init(server) {
  if (webSocketServer) return webSocketServer;
  webSocketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname !== '/ws') return;

    webSocketServer.handleUpgrade(request, socket, head, (ws) => {
      webSocketServer.emit('connection', ws, request);
    });
  });

  webSocketServer.on('connection', (socket) => {
    socket.role = null;
    socket.readerCode = null;
    socket.scanSessionIds = new Set();
    socket.isAlive = true;
    logger.debug('websocket.connected');
    socket.on('pong', () => { socket.isAlive = true; });

    const helloTimeout = setTimeout(() => {
      if (!socket.role) {
        logger.warn('websocket.hello_timeout');
        sendJson(socket, { type: 'error', code: 'hello_timeout', message: 'Send hello before using the WebSocket.' });
        socket.close(1008, 'Hello timeout');
      }
    }, 10000);

    socket.on('error', (error) => console.error('RFID WebSocket error:', error.message));
    socket.on('close', () => {
      clearTimeout(helloTimeout);
      dashboardConnections.delete(socket);
      if (socket.readerCode && gatewayConnections.get(socket.readerCode) === socket) {
        gatewayConnections.delete(socket.readerCode);
        logger.warn('gateway.disconnected', { reader_code: socket.readerCode });
        void (async () => {
          const { Op } = require('sequelize');
          const { RfidScanSession } = require('../models');
          const sessions = await RfidScanSession.findAll({ where: { reader_code: socket.readerCode, status: { [Op.in]: ['starting', 'active'] } } });
          for (const session of sessions) {
            broadcastToScanSession(session.id, { type: 'reader.status', scan_session_id: session.id, status: 'offline', message: 'Orange Pi gateway terputus.' });
          }
        })().catch((error) => console.error('Unable to close RFID scan sessions:', error.message));
      }
      if (socket.role === 'dashboard') logger.debug('dashboard.disconnected');
    });

    socket.on('message', async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        logger.warn('websocket.invalid_json');
        sendJson(socket, { type: 'error', code: 'invalid_json', message: 'WebSocket message must be valid JSON.' });
        return;
      }

      if (!socket.role) {
        if (message.type !== 'hello') {
          sendJson(socket, { type: 'error', code: 'hello_required', message: 'The first message must be hello.' });
          return;
        }

        if (message.role === 'gateway') {
          const rejection = !gatewayTokenIsValid(message.token)
            ? { code: 'INVALID_TOKEN', message: 'Gateway token tidak valid.' }
            : !message.reader_code
              ? { code: 'READER_CODE_REQUIRED', message: 'reader_code wajib diisi.' }
              : !readerCodeIsAllowed(String(message.reader_code))
                ? { code: 'UNKNOWN_READER', message: 'reader_code tidak terdaftar di backend.' }
                : null;
          if (rejection) {
            logger.warn('gateway.connection_rejected', { reader_code: message.reader_code, reason: rejection.code });
            sendJson(socket, { type: 'hello.rejected', code: rejection.code, message: rejection.message });
            socket.close(1008, 'Invalid gateway credentials');
            return;
          }
          socket.role = 'gateway';
          socket.readerCode = String(message.reader_code);
          const previous = gatewayConnections.get(socket.readerCode);
          if (previous && previous !== socket) previous.close(1000, 'Replaced by a newer gateway connection');
          gatewayConnections.set(socket.readerCode, socket);
          clearTimeout(helloTimeout);
          logger.info('gateway.connected', { reader_code: socket.readerCode });
          sendJson(socket, { type: 'hello.accepted', role: 'gateway', reader_code: socket.readerCode });
          void require('./rfidScanService').resumeReaderSessions(socket.readerCode)
            .catch((error) => logger.error('scan.resume_failed', { reader_code: socket.readerCode, message: error.message }));
          return;
        }

        if (message.role === 'dashboard') {
          socket.role = 'dashboard';
          dashboardConnections.add(socket);
          clearTimeout(helloTimeout);
          logger.info('dashboard.connected');
          sendJson(socket, { type: 'hello.accepted', role: 'dashboard' });
          if (message.scan_session_id) void subscribeDashboard(socket, message.scan_session_id);
          return;
        }

        sendJson(socket, { type: 'error', code: 'invalid_role', message: 'Role must be gateway or dashboard.' });
        return;
      }

      if (socket.role === 'dashboard') {
        if (message.type === 'subscribe') void subscribeDashboard(socket, message.scan_session_id);
        if (message.type === 'unsubscribe') socket.scanSessionIds.delete(message.scan_session_id);
        return;
      }

      if (socket.role === 'gateway') {
        try {
          await handleGatewayMessage(socket, message);
        } catch (error) {
          console.error('RFID gateway event error:', error);
          if (message.scan_session_id) {
            broadcastToScanSession(message.scan_session_id, { type: 'scan.error', scan_session_id: message.scan_session_id, code: 'processing_error', message: 'Backend gagal memproses event RFID.' });
          }
        }
      }
    });
  });

  heartbeatTimer = setInterval(() => {
    for (const socket of webSocketServer.clients) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30000);
  heartbeatTimer.unref?.();
  webSocketServer.on('close', () => clearInterval(heartbeatTimer));

  return webSocketServer;
}

function isReaderConnected(readerCode) {
  return gatewayConnections.has(readerCode);
}

module.exports = {
  broadcastToScanSession,
  init,
  isReaderConnected,
  sendJson,
  sendToReader,
};
