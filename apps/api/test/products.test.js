const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProduct } = require('../utils/products');

test('normalizes independent supplier and warehouse repack quantities', () => {
  const valid = normalizeProduct({
    sku: ' susu-250 ',
    name: ' Susu 250 ml ',
    supplier_pack_units: 12,
    supplier_pack_label: ' pack ',
    min_outbound_units: 5,
  });
  const invalid = normalizeProduct({
    sku: 'SUSU-250',
    name: 'Susu 250 ml',
    supplier_pack_units: 0,
    min_outbound_units: 5,
  });

  assert.deepEqual(valid.errors, []);
  assert.equal(valid.data.sku, 'SUSU-250');
  assert.equal(valid.data.base_unit, 'pcs');
  assert.equal(valid.data.supplier_pack_units, 12);
  assert.equal(valid.data.supplier_pack_label, 'pack');
  assert.equal(invalid.errors[0].field, 'supplier_pack_units');
});

test('requires a positive minimum outbound configuration in the product catalog', () => {
  const result = normalizeProduct({
    sku: 'SUSU-250',
    name: 'Susu 250 ml',
    supplier_pack_units: 12,
    min_outbound_units: 0,
  });

  assert.equal(result.errors[0].field, 'min_outbound_units');
});
