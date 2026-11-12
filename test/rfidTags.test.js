const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRfidTags } = require('../utils/rfidTags');

test('normalizes RFID UIDs and reports duplicates in one submit', () => {
  const result = normalizeRfidTags([' e280abc ', 'E280ABC', '', 42]);

  assert.deepEqual(result.tags, [{ index: 0, rfid_number: 'E280ABC' }]);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'duplicate_in_request',
    'invalid_uid',
    'invalid_uid',
  ]);
});
