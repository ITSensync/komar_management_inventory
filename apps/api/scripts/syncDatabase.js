const { sequelize, RfidTag, InventoryMovement, RfidLifecycleEvent } = require('../models');
const { DataTypes } = require('sequelize');

const alter = process.argv.includes('--alter');

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    if (alter) await migratePoSessionStatuses();
    await sequelize.sync({ alter });
    await migrateRfidScanSessionSchema();
    await migratePlacementSchema();
    await migrateRfidLifecycleHistory();
    if (alter) await migrateLegacyPoRepackFields();
    console.log(`Database schema ${alter ? 'updated' : 'created'} successfully.`);
  } catch (error) {
    console.error('Database schema sync failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

async function migrateRfidLifecycleHistory() {
  // Existing installations already have movement history but no lifecycle
  // events. Seed only tags without events so this remains safe on every run.
  const tags = await RfidTag.findAll();
  for (const tag of tags) {
    const existingEvent = await RfidLifecycleEvent.findOne({ where: { rfid_tag_id: tag.id } });
    if (existingEvent) continue;

    await RfidLifecycleEvent.create({
      rfid_tag_id: tag.id,
      cycle_number: 1,
      event_type: 'registered',
      source: 'legacy_backfill',
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
      metadata: { reason: 'backfilled_from_existing_rfid_tag' },
    });

    const movements = await InventoryMovement.findAll({
      where: { rfid_tag_id: tag.id },
      order: [['createdAt', 'ASC'], ['id', 'ASC']],
    });
    let cycle = 1;
    for (const movement of movements) {
      const eventType = movement.movement_type === 'placement' ? 'placed'
        : movement.movement_type === 'relocation' ? 'relocated' : movement.movement_type;
      await RfidLifecycleEvent.create({
        rfid_tag_id: tag.id,
        cycle_number: cycle,
        event_type: eventType,
        po_pack_plan_id: movement.po_pack_plan_id,
        from_rack_id: movement.from_rack_id,
        to_rack_id: movement.to_rack_id,
        source: 'legacy_backfill',
        createdAt: movement.createdAt,
        updatedAt: movement.updatedAt,
        metadata: { legacy_movement_id: movement.id },
      });
      if (['outbound', 'trash'].includes(movement.movement_type)) {
        await RfidLifecycleEvent.create({
          rfid_tag_id: tag.id,
          cycle_number: cycle,
          event_type: 'available_for_reuse',
          po_pack_plan_id: movement.po_pack_plan_id,
          source: 'legacy_backfill',
          createdAt: movement.createdAt,
          updatedAt: movement.updatedAt,
          metadata: { legacy_movement_id: movement.id },
        });
        cycle += 1;
      }
    }
  }
}

async function migrateRfidScanSessionSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const columns = await queryInterface.describeTable('rfid_scan_sessions');

  if (columns.po_session_item_id) {
    await queryInterface.changeColumn('rfid_scan_sessions', 'po_session_item_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  } else {
    await queryInterface.addColumn('rfid_scan_sessions', 'po_session_item_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  if (!columns.scan_type) {
    await queryInterface.addColumn('rfid_scan_sessions', 'scan_type', {
      type: DataTypes.ENUM('po_assignment', 'terminal_movement'),
      allowNull: false,
      defaultValue: 'po_assignment',
    });
  }
  if (!columns.movement_type) {
    await queryInterface.addColumn('rfid_scan_sessions', 'movement_type', {
      type: DataTypes.ENUM('outbound', 'trash'),
      allowNull: true,
    });
  }

  const indexes = await queryInterface.showIndex('rfid_scan_sessions');
  const hasIndex = (field) => indexes.some((index) => index.fields && index.fields.length === 1 && index.fields[0].attribute === field);
  if (!hasIndex('scan_type')) await queryInterface.addIndex('rfid_scan_sessions', ['scan_type'], { name: 'rfid_scan_sessions_scan_type_idx' });
  if (!hasIndex('movement_type')) await queryInterface.addIndex('rfid_scan_sessions', ['movement_type'], { name: 'rfid_scan_sessions_movement_type_idx' });
}

async function migratePlacementSchema() {
  // `sequelize.sync()` creates the new tables on a fresh database, but the
  // normal non-alter startup must also be able to add these columns to an
  // existing PO database without rewriting unrelated tables.
  const queryInterface = sequelize.getQueryInterface();
  const columns = await queryInterface.describeTable('po_pack_plans');

  if (!columns.placement_status) {
    await queryInterface.addColumn('po_pack_plans', 'placement_status', {
      type: DataTypes.ENUM('unplaced', 'placed', 'outbound', 'trash'),
      allowNull: false,
      defaultValue: 'unplaced',
    });
  }
  if (!columns.current_rack_id) {
    await queryInterface.addColumn('po_pack_plans', 'current_rack_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
  }

  const indexes = await queryInterface.showIndex('po_pack_plans');
  const hasIndex = (field) => indexes.some((index) => index.fields && index.fields.length === 1 && index.fields[0].attribute === field);
  if (!hasIndex('placement_status')) await queryInterface.addIndex('po_pack_plans', ['placement_status'], { name: 'po_pack_plans_placement_status_idx' });
  if (!hasIndex('current_rack_id')) await queryInterface.addIndex('po_pack_plans', ['current_rack_id'], { name: 'po_pack_plans_current_rack_idx' });

  const [constraints] = await sequelize.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'po_pack_plans'
      AND COLUMN_NAME = 'current_rack_id'
      AND REFERENCED_TABLE_NAME = 'racks'
  `);
  if (!constraints.length) {
    await queryInterface.addConstraint('po_pack_plans', {
      fields: ['current_rack_id'],
      type: 'foreign key',
      name: 'po_pack_plans_current_rack_fk',
      references: { table: 'racks', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
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
