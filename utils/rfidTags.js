function normalizeRfidTags(rfidTags) {
  if (!Array.isArray(rfidTags)) {
    return { error: 'Expected "rfid_tags" as an array.' };
  }

  if (rfidTags.length === 0) {
    return { error: 'RFID tags array cannot be empty.' };
  }

  const tags = [];
  const errors = [];
  const seen = new Set();

  for (const [index, value] of rfidTags.entries()) {
    if (typeof value !== 'string') {
      errors.push({ index, rfid_number: value, code: 'invalid_uid', message: 'RFID UID must be a string.' });
      continue;
    }

    const rfidNumber = value.trim().toUpperCase();
    if (!rfidNumber || rfidNumber.length > 255) {
      errors.push({ index, rfid_number: value, code: 'invalid_uid', message: 'RFID UID must contain 1 to 255 characters.' });
      continue;
    }

    if (seen.has(rfidNumber)) {
      errors.push({ index, rfid_number: rfidNumber, code: 'duplicate_in_request', message: 'RFID UID appears more than once in this submit.' });
      continue;
    }

    seen.add(rfidNumber);
    tags.push({ index, rfid_number: rfidNumber });
  }

  return { tags, errors };
}

module.exports = { normalizeRfidTags };
