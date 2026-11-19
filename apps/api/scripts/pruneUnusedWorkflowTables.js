const { sequelize } = require('../models');

// These tables belong to warehouse receiving, placement, stocktake, outbound,
// and authentication flows that are not part of the current PO/RFID workflow.
// This script is intentionally explicit and one-shot; it must not run on API
// startup or on every normal schema sync.
const unusedTables = [
  'outbound_scans',
  'stocktake_expected_packs',
  'stocktake_observations',
  'stock_adjustments',
  'stock_movements',
  'tag_assignments',
  'tag_lifecycle_events',
  'outbound_lines',
  'outbound_orders',
  'packs',
  'inbound_receipt_lines',
  'inbound_receipts',
  'stocktakes',
  'locations',
  'lots',
  'suppliers',
  'audit_logs',
  'idempotency_keys',
  'web_sessions',
  'refresh_sessions',
  'users',
];

const retainedTables = [
  'label_print_items',
  'label_print_jobs',
  'rfid_scan_events',
  'rfid_scan_sessions',
  'po_pack_plans',
  'po_session_items',
  'po_sessions',
  'rfid_tags',
  'products',
];

async function pruneUnusedWorkflowTables() {
  await sequelize.authenticate();

  // The current models are synchronized first, while removed models are no
  // longer registered and therefore cannot be recreated by Sequelize.
  await sequelize.sync({ alter: false });

  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of unusedTables) {
      await sequelize.query(`DROP TABLE IF EXISTS \`${table}\``);
    }

    // The user explicitly approved clearing existing data while retaining the
    // current workflow schema. Keep this list explicit to avoid touching a
    // future table accidentally.
    for (const table of retainedTables) {
      await sequelize.query(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  console.log('Unused workflow tables removed and current PO/RFID data cleared.');
}

pruneUnusedWorkflowTables()
  .catch((error) => {
    console.error('Workflow cleanup failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
