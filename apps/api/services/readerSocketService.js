const { WebSocketServer, WebSocket } = require('ws');

const gatewayConnections = new Map();
const dashboardConnections = new Set();
let webSocketServer;

function sendJson(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function gatewayTokenIsValid(token) {
  const expected = process.env.RFID_GATEWAY_TOKEN;
  return Boolean(expected && token && token === expected);
}

async function subscribeDashboard(socket, scanSessionId) {
  if (!scanSessionId || typeof scanSessionId !== 'string') return;
  socket.scanSessionIds.add(scanSessionId);
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
  if (!socket) return false;
  return sendJson(socket, message);
}

async function handleGatewayMessage(socket, message) {
  if (message.type === 'reader.ready' || message.type === 'reader.status') {
    if (message.scan_session_id) {
      const { markScanSessionActive } = require('./rfidScanService');
      await markScanSessionActive(message.scan_session_id, message.status);
      broadcastToScanSession(message.scan_session_id, message);
    }
    return;
  }

  if (message.type === 'rfid.detected') {
    if (!message.scan_session_id || !message.event_id || !message.uid) {
      sendJson(socket, { type: 'reader.error', code: 'invalid_event', message: 'RFID event requires scan_session_id, event_id, and uid.' });
      return;
    }
    const { processReaderEvent } = require('./rfidScanService');
    await processReaderEvent(message);
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

    const helloTimeout = setTimeout(() => {
      if (!socket.role) {
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
        void (async () => {
          const { Op } = require('sequelize');
          const { RfidScanSession } = require('../models');
          const sessions = await RfidScanSession.findAll({ where: { reader_code: socket.readerCode, status: { [Op.in]: ['starting', 'active'] } } });
          for (const session of sessions) {
            await session.update({ status: 'failed', stopped_at: new Date() });
            broadcastToScanSession(session.id, { type: 'reader.status', scan_session_id: session.id, status: 'offline', message: 'Orange Pi gateway terputus.' });
          }
        })().catch((error) => console.error('Unable to close RFID scan sessions:', error.message));
      }
    });

    socket.on('message', async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        sendJson(socket, { type: 'error', code: 'invalid_json', message: 'WebSocket message must be valid JSON.' });
        return;
      }

      if (!socket.role) {
        if (message.type !== 'hello') {
          sendJson(socket, { type: 'error', code: 'hello_required', message: 'The first message must be hello.' });
          return;
        }

        if (message.role === 'gateway') {
          if (!gatewayTokenIsValid(message.token) || !message.reader_code) {
            socket.close(1008, 'Invalid gateway credentials');
            return;
          }
          socket.role = 'gateway';
          socket.readerCode = String(message.reader_code);
          const previous = gatewayConnections.get(socket.readerCode);
          if (previous && previous !== socket) previous.close(1000, 'Replaced by a newer gateway connection');
          gatewayConnections.set(socket.readerCode, socket);
          clearTimeout(helloTimeout);
          sendJson(socket, { type: 'hello.accepted', role: 'gateway', reader_code: socket.readerCode });
          return;
        }

        if (message.role === 'dashboard') {
          socket.role = 'dashboard';
          dashboardConnections.add(socket);
          clearTimeout(helloTimeout);
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
