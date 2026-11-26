const { RfidLifecycleEvent } = require('../models');

async function nextCycleNumber(rfidTagId, transaction) {
  const latest = await RfidLifecycleEvent.findOne({
    where: { rfid_tag_id: rfidTagId },
    order: [['cycle_number', 'DESC'], ['createdAt', 'DESC']],
    transaction,
  });
  return latest ? latest.cycle_number : 1;
}

async function cycleNumberForEvent(rfidTagId, eventType, transaction) {
  const latest = await RfidLifecycleEvent.findOne({
    where: { rfid_tag_id: rfidTagId },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    transaction,
  });
  if (eventType === 'assigned_to_pack' && latest && latest.event_type === 'available_for_reuse') {
    return latest.cycle_number + 1;
  }
  return latest ? latest.cycle_number : 1;
}

async function recordRfidLifecycleEvent(input, options = {}) {
  const transaction = options.transaction;
  let cycleNumber = input.cycle_number;
  if (!cycleNumber) cycleNumber = await cycleNumberForEvent(input.rfid_tag_id, input.event_type, transaction);
  return RfidLifecycleEvent.create({ ...input, cycle_number: cycleNumber }, { transaction });
}

async function recordRfidLifecycleEvents(events, options = {}) {
  if (!events.length) return [];
  return Promise.all(events.map((event) => recordRfidLifecycleEvent(event, options)));
}

module.exports = { nextCycleNumber, recordRfidLifecycleEvent, recordRfidLifecycleEvents };
