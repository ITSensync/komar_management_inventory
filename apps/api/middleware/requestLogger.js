const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const startedAt = Date.now();
  const id = req.get('X-Request-Id') || logger.requestId();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  res.on('finish', () => {
    if (req.path === '/health' && process.env.LOG_HEALTH_REQUESTS !== 'true') return;
    const metadata = {
      request_id: id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
      ip: req.ip,
    };
    if (res.statusCode >= 500) logger.error('http.request', metadata);
    else if (res.statusCode >= 400) logger.warn('http.request', metadata);
    else logger.info('http.request', metadata);
  });

  next();
}

module.exports = requestLogger;
