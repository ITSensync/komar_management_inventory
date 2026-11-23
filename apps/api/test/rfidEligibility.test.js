const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRfidEligibility } = require('../utils/rfidEligibility');

const tag = (status = 'available') => ({ id: 7, rfid_number: 'E280ABC', status });
const plan = (placement_status = 'unplaced', sessionId = 'session-1', itemId = 'item-1') => ({
  id: 'plan-1',
  po_session_item_id: itemId,
  placement_status,
  item: {
    id: itemId,
    po_session_id: sessionId,
    product_name_snapshot: 'Susu 250 ml',
    session: { id: sessionId, session_number: 'PO-2026-0001' },
  },
});

test('allows a registered available RFID with no active assignment', () => {
  const result = evaluateRfidEligibility({ tag: tag(), existingPlan: null, latestMovement: null });

  assert.equal(result.eligible, true);
  assert.equal(result.code, 'RFID_AVAILABLE_FOR_NEW_PO');
});

test('rejects a RFID already placed even when it is scanned for another item', () => {
  const result = evaluateRfidEligibility({
    tag: tag('assigned_to_po'),
    existingPlan: plan('placed'),
    latestMovement: { movement_type: 'placement' },
    targetItemId: 'item-2',
    targetSessionId: 'session-2',
  });

  assert.equal(result.eligible, false);
  assert.equal(result.code, 'RFID_ALREADY_PLACED');
  assert.equal(result.session_number, 'PO-2026-0001');
});

test('rejects reuse inside the same item and session', () => {
  const sameItem = evaluateRfidEligibility({
    tag: tag('assigned_to_po'),
    existingPlan: plan('unplaced'),
    latestMovement: null,
    targetItemId: 'item-1',
    targetSessionId: 'session-1',
  });
  const sameSession = evaluateRfidEligibility({
    tag: tag('assigned_to_po'),
    existingPlan: plan('unplaced'),
    latestMovement: null,
    targetItemId: 'item-2',
    targetSessionId: 'session-1',
  });

  assert.equal(sameItem.code, 'RFID_DUPLICATE_IN_ITEM');
  assert.equal(sameSession.code, 'RFID_DUPLICATE_IN_SESSION');
});

test('rejects reuse from another active PO', () => {
  const result = evaluateRfidEligibility({
    tag: tag('assigned_to_po'),
    existingPlan: plan('unplaced', 'session-1', 'item-1'),
    latestMovement: null,
    targetItemId: 'item-2',
    targetSessionId: 'session-2',
  });

  assert.equal(result.code, 'RFID_ALREADY_ASSIGNED_TO_PO');
});

test('allows reuse after outbound or trash when the old assignment is released', () => {
  for (const movement_type of ['outbound', 'trash']) {
    const result = evaluateRfidEligibility({
      tag: tag(),
      existingPlan: null,
      latestMovement: { movement_type },
    });

    assert.equal(result.eligible, true);
    assert.equal(result.code, 'RFID_AVAILABLE_FOR_NEW_PO');
  }
});

test('rejects a RFID with an active movement but no linked plan', () => {
  const result = evaluateRfidEligibility({
    tag: tag(),
    existingPlan: null,
    latestMovement: { movement_type: 'relocation' },
  });

  assert.equal(result.code, 'RFID_ALREADY_PLACED');
});

test('rejects unregistered and retired RFID tags', () => {
  assert.equal(evaluateRfidEligibility({ tag: null }).code, 'RFID_NOT_REGISTERED');
  assert.equal(evaluateRfidEligibility({ tag: tag('retired') }).code, 'RFID_RETIRED');
});
