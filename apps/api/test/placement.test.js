const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlacementRequest } = require('../utils/placement');
const { normalizeInventoryActionRequest } = require('../utils/inventoryActions');
const { canClose, canPlace, canRelocate, canReuse } = require('../utils/rfidLifecycle');
const { normalizeRack } = require('../utils/racks');

test('normalizes a mobile placement batch and RFID numbers', () => {
  const result = normalizePlacementRequest({
    rack_id: ' rack-id ',
    rfid_numbers: [' e280abc ', 'E280DEF'],
    client_request_id: ' mobile-request-1 ',
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data, {
    rack_id: 'rack-id',
    rfid_numbers: ['E280ABC', 'E280DEF'],
    client_request_id: 'mobile-request-1',
  });
});

test('rejects duplicate RFID numbers before a placement transaction', () => {
  const result = normalizePlacementRequest({
    rack_id: 'rack-id',
    rfid_numbers: ['E280ABC', 'e280abc'],
    client_request_id: 'mobile-request-1',
  });

  assert.equal(result.errors[0].code, 'duplicate_in_request');
  assert.equal(result.errors[0].field, 'rfid_numbers');
});

test('returns validation errors instead of throwing for invalid placement types', () => {
  const result = normalizePlacementRequest({ rack_id: 1, rfid_numbers: ['E280ABC'], client_request_id: 2 });

  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].field, 'rack_id');
  assert.equal(result.errors[1].field, 'client_request_id');
});

test('normalizes a rack and prevents unknown fields', () => {
  const result = normalizeRack({ code: ' rak-01 ', name: ' Rak Susu ', unexpected: true });

  assert.equal(result.data.code, 'RAK-01');
  assert.equal(result.data.name, 'Rak Susu');
  assert.equal(result.errors[0].field, 'unexpected');
});

test('normalizes an outbound/trash action without a rack', () => {
  const result = normalizeInventoryActionRequest({
    rfid_numbers: [' e280abc '],
    client_request_id: ' terminal-action-1 ',
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data, {
    rfid_numbers: ['E280ABC'],
    client_request_id: 'terminal-action-1',
  });
});

test('enforces the RFID placement lifecycle states', () => {
  assert.equal(canPlace('unplaced'), true);
  assert.equal(canPlace('placed'), false);
  assert.equal(canRelocate('placed'), true);
  assert.equal(canRelocate('outbound'), false);
  assert.equal(canClose('placed'), true);
  assert.equal(canClose('trash'), false);
  assert.equal(canReuse('outbound'), true);
  assert.equal(canReuse('trash'), true);
  assert.equal(canReuse('placed'), false);
});
