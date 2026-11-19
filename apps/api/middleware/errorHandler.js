function errorHandler(error, req, res, next) {
  console.error(error);
  const status = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500
    ? error.statusCode
    : 500;
  const message = status === 400 && error.type === 'entity.parse.failed'
    ? 'Request body must contain valid JSON.'
    : 'Internal server error.';
  res.status(status).json({ success: false, message });
}

module.exports = errorHandler;
