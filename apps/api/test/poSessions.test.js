const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRepackPlan, normalizePoSession, normalizePoSessionItem } = require('../utils/poSessions');

test('normalizes a PO session number and optional session fields', () => {
  const result = normalizePoSession({
    session_number: ' po-2026-001 ',
    reference_number: ' supplier-ref-1 ',
    notes: ' Persiapan susu ',
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.data.session_number, 'PO-2026-001');
  assert.equal(result.data.reference_number, 'supplier-ref-1');
});

test('calculates RFID packs from supplier-pack input and rejects repack remainders', () => {
  const input = normalizePoSessionItem({
    product_id: 'a5e2a649-0a2f-4ce2-ae59-b4c7b8e4fa01',
    ordered_supplier_pack_quantity: 50,
    expires_on: '2026-12-31',
  });
  const valid = calculateRepackPlan({
    orderedSupplierPackQuantity: input.data.ordered_supplier_pack_quantity,
    supplierPackUnits: 12,
    minOutboundUnits: 5,
  });
  const invalid = calculateRepackPlan({
    orderedSupplierPackQuantity: 1,
    supplierPackUnits: 12,
    minOutboundUnits: 5,
  });

  assert.deepEqual(input.errors, []);
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.data.ordered_quantity, 600);
  assert.equal(valid.data.required_rfid_count, 120);
  assert.equal(invalid.errors[0].field, 'min_outbound_units');
  assert.match(invalid.errors[0].message, /Total 12 pcs from 1 supplier pack/);
});

test('rejects the retired base-unit input field for new session items', () => {
  const result = normalizePoSessionItem({
    product_id: 'a5e2a649-0a2f-4ce2-ae59-b4c7b8e4fa01',
    ordered_quantity: 50,
  });

  assert.equal(result.errors[0].field, 'ordered_quantity');
});

test('rejects min_outbound_units on PO item because it comes from the product catalog', () => {
  const result = normalizePoSessionItem({
    product_id: 'a5e2a649-0a2f-4ce2-ae59-b4c7b8e4fa01',
    ordered_supplier_pack_quantity: 50,
    min_outbound_units: 5,
  });

  assert.equal(result.errors[0].field, 'min_outbound_units');
  assert.match(result.errors[0].message, /not allowed/i);
});

test('rejects duplicate RFID values in one assignment request before persistence', () => {
  const { normalizeRfidTags } = require('../utils/rfidTags');
  const result = normalizeRfidTags(['E280ABC', 'e280abc']);

  assert.equal(result.errors[0].code, 'duplicate_in_request');
  assert.equal(result.tags.length, 1);
});
