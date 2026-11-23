const ACTIVE_MOVEMENTS = new Set(['placement', 'relocation']);
const TERMINAL_MOVEMENTS = new Set(['outbound', 'trash']);

function contextFromPlan(plan) {
  const item = plan?.item;
  const session = item?.session;
  return {
    session_number: session?.session_number,
    po_session_item_id: item?.id,
    product_name: item?.product_name_snapshot,
    placement_status: plan?.placement_status,
  };
}

function contextFromMovement(movement) {
  return contextFromPlan(movement?.packPlan);
}

function evaluateRfidEligibility({ tag, existingPlan, latestMovement, targetItemId, targetSessionId }) {
  if (!tag) {
    return {
      eligible: false,
      code: 'RFID_NOT_REGISTERED',
      message: 'RFID belum terdaftar. Daftarkan UID melalui Master RFID terlebih dahulu.',
    };
  }

  if (existingPlan) {
    const context = contextFromPlan(existingPlan);
    if (existingPlan.placement_status === 'placed') {
      return {
        eligible: false,
        code: 'RFID_ALREADY_PLACED',
        message: 'RFID sudah ditempatkan di rak dan belum dapat digunakan sebagai UID baru.',
        ...context,
      };
    }

    if (existingPlan.placement_status === 'outbound' || existingPlan.placement_status === 'trash') {
      return {
        eligible: false,
        code: 'RFID_DATA_INCONSISTENT',
        message: 'Lifecycle RFID sudah selesai tetapi assignment pack plan masih tersimpan. Data perlu direkonsiliasi.',
        ...context,
      };
    }

    if (targetItemId && existingPlan.po_session_item_id === targetItemId) {
      return {
        eligible: false,
        code: 'RFID_DUPLICATE_IN_ITEM',
        message: 'RFID ini sudah terpasang pada item PO yang sedang diproses.',
        ...context,
      };
    }

    if (targetSessionId && existingPlan.item?.po_session_id === targetSessionId) {
      return {
        eligible: false,
        code: 'RFID_DUPLICATE_IN_SESSION',
        message: 'RFID ini sudah digunakan pada item lain dalam PO/session yang sama.',
        ...context,
      };
    }

    return {
      eligible: false,
      code: 'RFID_ALREADY_ASSIGNED_TO_PO',
      message: 'RFID ini masih digunakan pada PO lain dan belum dapat digunakan kembali.',
      ...context,
    };
  }

  if (latestMovement && ACTIVE_MOVEMENTS.has(latestMovement.movement_type)) {
    return {
      eligible: false,
      code: 'RFID_ALREADY_PLACED',
      message: 'Movement terakhir RFID masih aktif di lokasi rak. RFID belum dapat digunakan sebagai UID baru.',
      ...contextFromMovement(latestMovement),
      placement_status: latestMovement.movement_type === 'relocation' ? 'placed' : 'placed',
    };
  }

  if (tag.status !== 'available') {
    const code = tag.status === 'retired' ? 'RFID_RETIRED' : 'RFID_NOT_AVAILABLE';
    return {
      eligible: false,
      code,
      message: code === 'RFID_RETIRED'
        ? 'RFID ini sudah retired dan tidak dapat digunakan kembali.'
        : 'RFID ini belum available sehingga tidak dapat digunakan untuk product baru.',
    };
  }

  if (latestMovement && !TERMINAL_MOVEMENTS.has(latestMovement.movement_type)) {
    return {
      eligible: false,
      code: 'RFID_DATA_INCONSISTENT',
      message: 'Lifecycle RFID tidak konsisten dengan assignment saat ini. Data perlu direkonsiliasi sebelum RFID digunakan kembali.',
    };
  }

  return {
    eligible: true,
    code: 'RFID_AVAILABLE_FOR_NEW_PO',
    message: 'RFID siap digunakan untuk product baru.',
  };
}

module.exports = { evaluateRfidEligibility };
