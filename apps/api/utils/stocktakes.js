const { normalizeRfidTags } = require('./rfidTags');

function normalizeStocktakeSessionRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Stocktake session data must be an object.' }] };
  }
  const errors = [];
  const sessionNumber = input.session_number == null ? '' : input.session_number;
  if (typeof sessionNumber !== 'string' || sessionNumber.trim().length > 100) {
    errors.push({ field: 'session_number', message: 'Session number must contain up to 100 characters.' });
  }
  if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 5000)) {
    errors.push({ field: 'notes', message: 'Notes must contain up to 5000 characters.' });
  }
  return {
    data: {
      session_number: typeof sessionNumber === 'string' ? sessionNumber.trim() : sessionNumber,
      notes: typeof input.notes === 'string' ? input.notes.trim() || null : null,
    },
    errors,
  };
}

function normalizeStocktakeScanRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Stocktake scan data must be an object.' }] };
  }
  const errors = [];
  if (typeof input.client_request_id !== 'string' || !input.client_request_id.trim() || input.client_request_id.trim().length > 100) {
    errors.push({ field: 'client_request_id', message: 'A client_request_id with 1 to 100 characters is required.' });
  }
  const normalized = normalizeRfidTags(input.rfid_numbers);
  if (normalized.error) errors.push({ field: 'rfid_numbers', message: normalized.error });
  else errors.push(...normalized.errors.map((error) => ({ field: 'rfid_numbers', ...error })));
  return {
    data: normalized.error ? null : {
      rfid_numbers: normalized.tags.map((tag) => tag.rfid_number),
      client_request_id: typeof input.client_request_id === 'string' ? input.client_request_id.trim() : input.client_request_id,
    },
    errors,
  };
}

module.exports = { normalizeStocktakeScanRequest, normalizeStocktakeSessionRequest };
