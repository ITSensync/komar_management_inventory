const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const uuid = {
  type: DataTypes.UUID,
  defaultValue: DataTypes.UUIDV4,
  primaryKey: true,
};

const options = (tableName, indexes = []) => ({
  tableName,
  underscored: true,
  indexes,
});

const Product = sequelize.define('Product', {
  id: uuid,
  sku: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  base_unit: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pcs' },
  // Kept only for legacy database compatibility. New API clients must use
  // supplier_pack_units; this field can be removed after legacy clients/data
  // have been audited and migrated.
  units_per_pack: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
  supplier_pack_units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
  supplier_pack_label: DataTypes.STRING(50),
  min_outbound_units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  expiry_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
}, options('products'));

const PoSession = sequelize.define('PoSession', {
  id: uuid,
  session_number: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  reference_number: DataTypes.STRING(100),
  notes: DataTypes.TEXT,
  // Session closure is explicit. Printing is tracked per item, pack plan, and print job.
  status: { type: DataTypes.ENUM('active', 'completed', 'cancelled'), allowNull: false, defaultValue: 'active' },
}, options('po_sessions', [{ fields: ['status', 'created_at'] }]));

const PoSessionItem = sequelize.define('PoSessionItem', {
  id: uuid,
  po_session_id: { type: DataTypes.UUID, allowNull: false },
  product_id: { type: DataTypes.UUID, allowNull: false },
  sku_snapshot: { type: DataTypes.STRING(100), allowNull: false },
  product_name_snapshot: { type: DataTypes.STRING(255), allowNull: false },
  base_unit_snapshot: { type: DataTypes.STRING(20), allowNull: false },
  // Nullable only to preserve historical PO rows while data is migrated. New
  // items always receive these snapshots from their selected product.
  ordered_supplier_pack_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
  supplier_pack_units_snapshot: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, validate: { min: 1 } },
  supplier_pack_label_snapshot: DataTypes.STRING(50),
  ordered_quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  // Legacy compatibility field. New pack plans use min_outbound_units directly.
  units_per_rfid_pack: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  min_outbound_units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  expires_on: DataTypes.DATEONLY,
  required_rfid_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  notes: DataTypes.TEXT,
  status: { type: DataTypes.ENUM('pending_tags', 'ready_to_print', 'printed', 'cancelled'), allowNull: false, defaultValue: 'pending_tags' },
}, options('po_session_items', [{ fields: ['po_session_id', 'status'] }, { fields: ['product_id'] }]));

const PoPackPlan = sequelize.define('PoPackPlan', {
  id: uuid,
  po_session_item_id: { type: DataTypes.UUID, allowNull: false },
  sequence_number: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  rfid_tag_id: { type: DataTypes.INTEGER, unique: true },
  label_code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  status: { type: DataTypes.ENUM('pending_tag', 'tag_assigned', 'label_printed', 'cancelled'), allowNull: false, defaultValue: 'pending_tag' },
  assigned_at: DataTypes.DATE,
}, options('po_pack_plans', [
  { unique: true, fields: ['po_session_item_id', 'sequence_number'] },
  { fields: ['po_session_item_id', 'status'] },
]));

const LabelPrintJob = sequelize.define('LabelPrintJob', {
  id: uuid,
  po_session_id: { type: DataTypes.UUID, allowNull: false },
  po_session_item_id: DataTypes.UUID,
  job_type: { type: DataTypes.ENUM('initial', 'reprint'), allowNull: false, defaultValue: 'initial' },
  format: { type: DataTypes.ENUM('pdf', 'zpl'), allowNull: false, defaultValue: 'pdf' },
  status: { type: DataTypes.ENUM('generated', 'printed', 'failed', 'cancelled'), allowNull: false, defaultValue: 'generated' },
  label_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  printed_at: DataTypes.DATE,
}, options('label_print_jobs', [{ fields: ['po_session_id', 'status'] }]));

const LabelPrintItem = sequelize.define('LabelPrintItem', {
  id: uuid,
  label_print_job_id: { type: DataTypes.UUID, allowNull: false },
  po_pack_plan_id: { type: DataTypes.UUID, allowNull: false },
  print_version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  label_snapshot: { type: DataTypes.JSON, allowNull: false },
}, options('label_print_items', [{ unique: true, fields: ['label_print_job_id', 'po_pack_plan_id'] }, { fields: ['po_pack_plan_id'] }]));

// RFID tags retain the existing integer primary key for hardware/API compatibility.
const RfidTag = sequelize.define('RfidTag', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  rfid_number: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  status: { type: DataTypes.ENUM('available', 'assigned_to_po', 'attached', 'detach_pending', 'detached', 'inspection', 'retired'), allowNull: false, defaultValue: 'available' },
}, {
  tableName: 'rfid_tags',
  timestamps: true,
});

const RfidScanSession = sequelize.define('RfidScanSession', {
  id: uuid,
  po_session_item_id: { type: DataTypes.UUID, allowNull: false },
  reader_code: { type: DataTypes.STRING(100), allowNull: false },
  status: {
    type: DataTypes.ENUM('starting', 'active', 'stopped', 'completed', 'failed', 'expired'),
    allowNull: false,
    defaultValue: 'starting',
  },
  started_at: DataTypes.DATE,
  stopped_at: DataTypes.DATE,
  expires_at: { type: DataTypes.DATE, allowNull: false },
  last_event_at: DataTypes.DATE,
}, options('rfid_scan_sessions', [
  { fields: ['po_session_item_id', 'status'] },
  { fields: ['reader_code', 'status'] },
]));

const RfidScanEvent = sequelize.define('RfidScanEvent', {
  id: uuid,
  rfid_scan_session_id: { type: DataTypes.UUID, allowNull: false },
  event_id: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  rfid_number: { type: DataTypes.STRING(255), allowNull: false },
  observed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  status: { type: DataTypes.ENUM('accepted', 'duplicate', 'rejected'), allowNull: false },
  error_code: DataTypes.STRING(100),
  result: DataTypes.JSON,
}, options('rfid_scan_events', [
  { fields: ['rfid_scan_session_id', 'observed_at'] },
  { fields: ['rfid_scan_session_id', 'rfid_number'] },
]));

PoSession.hasMany(PoSessionItem, { foreignKey: 'po_session_id', as: 'items' });
PoSessionItem.belongsTo(PoSession, { foreignKey: 'po_session_id', as: 'session' });
Product.hasMany(PoSessionItem, { foreignKey: 'product_id', as: 'poSessionItems' });
PoSessionItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
PoSessionItem.hasMany(PoPackPlan, { foreignKey: 'po_session_item_id', as: 'packPlans' });
PoPackPlan.belongsTo(PoSessionItem, { foreignKey: 'po_session_item_id', as: 'item' });
RfidTag.hasOne(PoPackPlan, { foreignKey: 'rfid_tag_id', as: 'poPackPlan' });
PoPackPlan.belongsTo(RfidTag, { foreignKey: 'rfid_tag_id', as: 'rfidTag' });
PoSessionItem.hasMany(RfidScanSession, { foreignKey: 'po_session_item_id', as: 'rfidScanSessions' });
RfidScanSession.belongsTo(PoSessionItem, { foreignKey: 'po_session_item_id', as: 'item' });
RfidScanSession.hasMany(RfidScanEvent, { foreignKey: 'rfid_scan_session_id', as: 'events' });
RfidScanEvent.belongsTo(RfidScanSession, { foreignKey: 'rfid_scan_session_id', as: 'scanSession' });
PoSession.hasMany(LabelPrintJob, { foreignKey: 'po_session_id', as: 'labelPrintJobs' });
LabelPrintJob.belongsTo(PoSession, { foreignKey: 'po_session_id', as: 'session' });
PoSessionItem.hasMany(LabelPrintJob, { foreignKey: 'po_session_item_id', as: 'labelPrintJobs' });
LabelPrintJob.belongsTo(PoSessionItem, { foreignKey: 'po_session_item_id', as: 'item' });
LabelPrintJob.hasMany(LabelPrintItem, { foreignKey: 'label_print_job_id', as: 'items' });
LabelPrintItem.belongsTo(LabelPrintJob, { foreignKey: 'label_print_job_id', as: 'job' });
PoPackPlan.hasMany(LabelPrintItem, { foreignKey: 'po_pack_plan_id', as: 'labelPrintItems' });
LabelPrintItem.belongsTo(PoPackPlan, { foreignKey: 'po_pack_plan_id', as: 'packPlan' });

module.exports = {
  sequelize,
  Product,
  PoSession,
  PoSessionItem,
  PoPackPlan,
  LabelPrintJob,
  LabelPrintItem,
  RfidTag,
  RfidScanSession,
  RfidScanEvent,
};
