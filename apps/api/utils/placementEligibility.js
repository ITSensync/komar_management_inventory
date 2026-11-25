const ADMIN_NOT_READY_MESSAGE = 'RFID belum didaftarkan Admin. Pastikan RFID sudah di-assign ke pack plan, label sudah dicetak, dan session PO sudah diselesaikan.';

function adminReadiness(plan, tag) {
  const assigned = Boolean(plan && tag && plan.rfid_tag_id && plan.rfid_tag_id === tag.id);
  const labelPrinted = Boolean(plan && plan.status === 'label_printed' && plan.item && plan.item.status === 'printed');
  const sessionCompleted = Boolean(plan && plan.item && plan.item.session && plan.item.session.status === 'completed');

  return {
    eligible: assigned && labelPrinted && sessionCompleted,
    assigned,
    label_printed: labelPrinted,
    session_completed: sessionCompleted,
  };
}

function adminNotReadyError(rfidNumber, readiness) {
  return {
    rfid_number: rfidNumber,
    code: 'RFID_ADMIN_NOT_READY',
    error_code: 'RFID_ADMIN_NOT_READY',
    message: ADMIN_NOT_READY_MESSAGE,
    admin_readiness: readiness,
  };
}

module.exports = {
  ADMIN_NOT_READY_MESSAGE,
  adminReadiness,
  adminNotReadyError,
};
