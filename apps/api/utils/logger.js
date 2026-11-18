const crypto = require('crypto');

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = String(process.env.RFID_LOG_LEVEL || 'info').toLowerCase();
const minimumLevel = levels[configuredLevel] || levels.info;

function serializeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  try {
    return ` ${JSON.stringify(metadata, (_key, value) => value instanceof Error ? value.message : value)}`;
  } catch {
    return ' {"metadata":"unserializable"}';
  }
}

function write(level, event, metadata) {
  if (levels[level] < minimumLevel) return;
  const timestamp = new Date().toISOString();
  const prefix = `[KOMAR][${level.toUpperCase()}]`;
  const line = `${timestamp} ${prefix} ${event}${serializeMetadata(metadata)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function requestId() {
  return crypto.randomUUID();
}

module.exports = {
  debug: (event, metadata) => write('debug', event, metadata),
  error: (event, metadata) => write('error', event, metadata),
  info: (event, metadata) => write('info', event, metadata),
  requestId,
  warn: (event, metadata) => write('warn', event, metadata),
};
