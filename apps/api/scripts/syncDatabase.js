const { sequelize } = require('../models');

const alter = process.argv.includes('--alter');

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    if (alter) await migratePoSessionStatuses();
    await sequelize.sync({ alter });
    if (alter) await migrateLegacyPoRepackFields();
    console.log(`Database schema ${alter ? 'updated' : 'created'} successfully.`);
  } catch (error) {
    console.error('Database schema sync failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

async function migratePoSessionStatuses() {
  try {
    // Keep existing preparation sessions usable while the model is changed from
    // automatic print states to an explicitly closed session.
    await sequelize.query(`
      ALTER TABLE po_sessions
      MODIFY COLUMN status ENUM('active', 'completed', 'cancelled', 'draft', 'tagging', 'ready_to_print', 'printed')
      NOT NULL DEFAULT 'active'
    `);
    await sequelize.query(`
      UPDATE po_sessions
      SET status = 'active'
      WHERE status IN ('draft', 'tagging', 'ready_to_print', 'printed')
    `);
  } catch (error) {
    if (error.original && error.original.code === 'ER_NO_SUCH_TABLE') return;
    throw error;
  }
}

async function migrateLegacyPoRepackFields() {
  // Historical session items were created from a base-unit input. Preserve their
  // existing totals and pack plans by treating the old quantity as loose units.
  // Product supplier_pack_units is deliberately not inferred from units_per_pack:
  // that legacy field may have represented a warehouse repack size instead.
  await sequelize.query(`
    UPDATE po_session_items
    SET
      ordered_supplier_pack_quantity = COALESCE(ordered_supplier_pack_quantity, ordered_quantity),
      supplier_pack_units_snapshot = COALESCE(supplier_pack_units_snapshot, 1)
    WHERE ordered_supplier_pack_quantity IS NULL OR supplier_pack_units_snapshot IS NULL
  `);

  const [rows] = await sequelize.query(`
    SELECT COUNT(*) AS missing_supplier_pack_units
    FROM products
    WHERE supplier_pack_units IS NULL
  `);
  const missingCount = Number(rows[0].missing_supplier_pack_units);
  if (missingCount > 0) {
    console.warn(`! ${missingCount} legacy product(s) need supplier_pack_units before they can be used in a new PO session.`);
  }
}

syncDatabase();
