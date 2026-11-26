const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStocktakeScanRequest, normalizeStocktakeSessionRequest } = require('../utils/stocktakes');

test('normalizes a stocktake session and keeps notes optional', () => {
  const result = normalizeStocktakeSessionRequest({ notes: ' Opname area gudang A ' });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data, { session_number: '', notes: 'Opname area gudang A' });
});

test('requires a client request id and normalizes stocktake RFID numbers', () => {
  const result = normalizeStocktakeScanRequest({
    client_request_id: ' opname-1 ',
    rfid_numbers: [' e280abc ', 'E280DEF'],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.data, {
    client_request_id: 'opname-1',
    rfid_numbers: ['E280ABC', 'E280DEF'],
  });
});

test('rejects duplicate RFID values in one stocktake request', () => {
  const result = normalizeStocktakeScanRequest({
    client_request_id: 'opname-1',
    rfid_numbers: ['E280ABC', 'e280abc'],
  });

  assert.equal(result.errors[0].code, 'duplicate_in_request');
  assert.equal(result.errors[0].field, 'rfid_numbers');
});
