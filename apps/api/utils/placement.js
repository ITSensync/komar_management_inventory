const { normalizeRfidTags } = require('./rfidTags');

function normalizePlacementRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Placement data must be an object.' }] };
  }

  const errors = [];
  if (typeof input.rack_id !== 'string' || !input.rack_id.trim()) {
    errors.push({ field: 'rack_id', message: 'A rack is required.' });
  }
  if (typeof input.client_request_id !== 'string' || !input.client_request_id.trim() || input.client_request_id.trim().length > 100) {
    errors.push({ field: 'client_request_id', message: 'A client_request_id with 1 to 100 characters is required.' });
  }

  const normalizedTags = normalizeRfidTags(input.rfid_numbers);
  if (normalizedTags.error) errors.push({ field: 'rfid_numbers', message: normalizedTags.error });
  else errors.push(...normalizedTags.errors.map((error) => ({ field: 'rfid_numbers', ...error })));

  return {
    data: normalizedTags.error ? null : {
      rack_id: typeof input.rack_id === 'string' ? input.rack_id.trim() : input.rack_id,
      rfid_numbers: normalizedTags.tags.map((tag) => tag.rfid_number),
      client_request_id: typeof input.client_request_id === 'string' ? input.client_request_id.trim() : input.client_request_id,
    },
    errors,
  };
}

function normalizeRelocationPreviewRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Relocation preview data must be an object.' }] };
  }

  const errors = [];
  if (typeof input.rack_id !== 'string' || !input.rack_id.trim()) {
    errors.push({ field: 'rack_id', message: 'A destination rack is required.' });
  }
  const normalizedTags = normalizeRfidTags(input.rfid_numbers);
  if (normalizedTags.error) errors.push({ field: 'rfid_numbers', message: normalizedTags.error });
  else errors.push(...normalizedTags.errors.map((error) => ({ field: 'rfid_numbers', ...error })));

  return {
    data: normalizedTags.error ? null : {
      rack_id: typeof input.rack_id === 'string' ? input.rack_id.trim() : input.rack_id,
      rfid_numbers: normalizedTags.tags.map((tag) => tag.rfid_number),
    },
    errors,
  };
}

module.exports = { normalizePlacementRequest, normalizeRelocationPreviewRequest };
