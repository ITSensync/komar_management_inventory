const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProduct } = require('../utils/products');

test('normalizes a product and enforces pack-sized outbound quantities', () => {
  const valid = normalizeProduct({
    sku: ' susu-250 ',
    name: ' Susu 250 ml ',
    units_per_pack: 5,
    min_outbound_units: 10,
  });
  const invalid = normalizeProduct({
    sku: 'SUSU-250',
    name: 'Susu 250 ml',
    units_per_pack: 5,
    min_outbound_units: 3,
  });

  assert.deepEqual(valid.errors, []);
  assert.equal(valid.data.sku, 'SUSU-250');
  assert.equal(valid.data.base_unit, 'pcs');
  assert.equal(invalid.errors[0].field, 'min_outbound_units');
});
