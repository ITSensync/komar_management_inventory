const { normalizeRfidTags } = require('./rfidTags');

function normalizeInventoryPreviewRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Inventory preview data must be an object.' }] };
  }

  const normalizedTags = normalizeRfidTags(input.rfid_numbers);
  const errors = normalizedTags.error
    ? [{ field: 'rfid_numbers', message: normalizedTags.error }]
    : normalizedTags.errors.map((error) => ({ field: 'rfid_numbers', ...error }));

  return {
    data: normalizedTags.error ? null : { rfid_numbers: normalizedTags.tags.map((tag) => tag.rfid_number) },
    errors,
  };
}

function normalizeInventoryActionRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Inventory action data must be an object.' }] };
  }

  const errors = [];
  if (
    typeof input.client_request_id !== 'string'
    || !input.client_request_id.trim()
    || input.client_request_id.trim().length > 100
  ) {
    errors.push({
      field: 'client_request_id',
      message: 'A client_request_id with 1 to 100 characters is required.',
    });
  }

  const normalizedTags = normalizeRfidTags(input.rfid_numbers);
  if (normalizedTags.error) errors.push({ field: 'rfid_numbers', message: normalizedTags.error });
  else errors.push(...normalizedTags.errors.map((error) => ({ field: 'rfid_numbers', ...error })));

  return {
    data: normalizedTags.error ? null : {
      rfid_numbers: normalizedTags.tags.map((tag) => tag.rfid_number),
      client_request_id: typeof input.client_request_id === 'string'
        ? input.client_request_id.trim()
        : input.client_request_id,
    },
    errors,
  };
}

module.exports = { normalizeInventoryActionRequest, normalizeInventoryPreviewRequest };
