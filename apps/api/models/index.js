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

const User = sequelize.define('User', {
  id: uuid,
  email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'supervisor', 'warehouse_staff'), allowNull: false },
  status: { type: DataTypes.ENUM('active', 'suspended'), allowNull: false, defaultValue: 'active' },
  last_login_at: DataTypes.DATE,
}, options('users'));

const RefreshSession = sequelize.define('RefreshSession', {
  id: uuid,
  user_id: { type: DataTypes.UUID, allowNull: false },
  token_jti_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  client_type: { type: DataTypes.ENUM('web', 'mobile'), allowNull: false },
  rotated_from_id: DataTypes.UUID,
  expires_at: { type: DataTypes.DATE, allowNull: false },
  revoked_at: DataTypes.DATE,
}, options('refresh_sessions', [{ fields: ['user_id', 'expires_at'] }]));

const WebSession = sequelize.define('WebSession', {
  id: uuid,
  refresh_session_id: { type: DataTypes.UUID, allowNull: false },
  cookie_id_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  encrypted_tokens: { type: DataTypes.TEXT, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  revoked_at: DataTypes.DATE,
}, options('web_sessions', [{ fields: ['refresh_session_id'] }]));

const Supplier = sequelize.define('Supplier', {
  id: uuid,
  name: { type: DataTypes.STRING(255), allowNull: false },
  contact_name: DataTypes.STRING(255),
  phone: DataTypes.STRING(50),
  status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
}, options('suppliers'));

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

const Lot = sequelize.define('Lot', {
  id: uuid,
  product_id: { type: DataTypes.UUID, allowNull: false },
  supplier_id: { type: DataTypes.UUID, allowNull: false },
  lot_code: { type: DataTypes.STRING(100), allowNull: false },
  expires_on: DataTypes.DATEONLY,
  status: { type: DataTypes.ENUM('active', 'quarantined', 'depleted'), allowNull: false, defaultValue: 'active' },
}, options('lots', [{ unique: true, fields: ['product_id', 'lot_code'] }]));

const Location = sequelize.define('Location', {
  id: uuid,
  parent_id: DataTypes.UUID,
  code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  location_type: { type: DataTypes.ENUM('zone', 'rack', 'slot', 'quarantine'), allowNull: false },
  capacity_units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
}, options('locations', [{ fields: ['parent_id'] }]));

const InboundReceipt = sequelize.define('InboundReceipt', {
  id: uuid,
  supplier_id: { type: DataTypes.UUID, allowNull: false },
  delivery_note_number: DataTypes.STRING(100),
  status: { type: DataTypes.ENUM('draft', 'receiving', 'received', 'cancelled'), allowNull: false, defaultValue: 'draft' },
  received_by: DataTypes.UUID,
  received_at: DataTypes.DATE,
}, options('inbound_receipts', [{ unique: true, fields: ['supplier_id', 'delivery_note_number'] }]));

const InboundReceiptLine = sequelize.define('InboundReceiptLine', {
  id: uuid,
  inbound_receipt_id: { type: DataTypes.UUID, allowNull: false },
  product_id: { type: DataTypes.UUID, allowNull: false },
  lot_id: { type: DataTypes.UUID, allowNull: false },
  received_units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  notes: DataTypes.TEXT,
}, options('inbound_receipt_lines', [{ fields: ['inbound_receipt_id'] }, { fields: ['product_id', 'lot_id'] }]));

const Pack = sequelize.define('Pack', {
  id: uuid,
  inbound_receipt_line_id: { type: DataTypes.UUID, allowNull: false },
  lot_id: { type: DataTypes.UUID, allowNull: false },
  location_id: DataTypes.UUID,
  units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
  status: { type: DataTypes.ENUM('received', 'stored', 'reserved', 'outbound', 'quarantined'), allowNull: false, defaultValue: 'received' },
  version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
}, options('packs', [{ fields: ['location_id', 'status'] }, { fields: ['lot_id'] }]));

// shortcut: RFID tags retain the existing integer primary key; migrate to UUID only when its API contract changes.
const RfidTag = sequelize.define('RfidTag', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  rfid_number: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  status: { type: DataTypes.ENUM('available', 'assigned_to_po', 'attached', 'detach_pending', 'detached', 'inspection', 'retired'), allowNull: false, defaultValue: 'available' },
}, {
  tableName: 'rfid_tags',
  timestamps: true,
});

const TagAssignment = sequelize.define('TagAssignment', {
  id: uuid,
  tag_id: { type: DataTypes.INTEGER, allowNull: false },
  pack_id: { type: DataTypes.UUID, allowNull: false },
  assigned_by: DataTypes.UUID,
  assigned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  unassigned_at: DataTypes.DATE,
}, options('tag_assignments', [{ fields: ['tag_id', 'unassigned_at'] }, { fields: ['pack_id', 'unassigned_at'] }]));

const StockMovement = sequelize.define('StockMovement', {
  id: uuid,
  pack_id: { type: DataTypes.UUID, allowNull: false },
  movement_type: { type: DataTypes.ENUM('receipt', 'placement', 'relocation', 'outbound', 'adjustment'), allowNull: false },
  delta_units: { type: DataTypes.INTEGER, allowNull: false },
  from_location_id: DataTypes.UUID,
  to_location_id: DataTypes.UUID,
  actor_id: { type: DataTypes.UUID, allowNull: false },
  reference_type: DataTypes.STRING(50),
  reference_id: DataTypes.UUID,
  occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, options('stock_movements', [{ fields: ['pack_id', 'occurred_at'] }]));

const Stocktake = sequelize.define('Stocktake', {
  id: uuid,
  location_id: { type: DataTypes.UUID, allowNull: false },
  started_by: { type: DataTypes.UUID, allowNull: false },
  status: { type: DataTypes.ENUM('scheduled', 'in_progress', 'submitted', 'in_review', 'approved', 'rejected'), allowNull: false, defaultValue: 'scheduled' },
  snapshot_at: DataTypes.DATE,
  submitted_at: DataTypes.DATE,
}, options('stocktakes', [{ fields: ['location_id', 'status'] }]));

const StocktakeExpectedPack = sequelize.define('StocktakeExpectedPack', {
  stocktake_id: { type: DataTypes.UUID, primaryKey: true },
  pack_id: { type: DataTypes.UUID, primaryKey: true },
  location_id: { type: DataTypes.UUID, allowNull: false },
  units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
}, options('stocktake_expected_packs'));

const StocktakeObservation = sequelize.define('StocktakeObservation', {
  id: uuid,
  stocktake_id: { type: DataTypes.UUID, allowNull: false },
  observed_uid: { type: DataTypes.STRING(255), allowNull: false },
  pack_id: DataTypes.UUID,
  disposition: { type: DataTypes.ENUM('matched', 'missing', 'unexpected', 'wrong_location'), allowNull: false },
  observed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, options('stocktake_observations', [{ unique: true, fields: ['stocktake_id', 'observed_uid'] }]));

const StockAdjustment = sequelize.define('StockAdjustment', {
  id: uuid,
  stocktake_id: { type: DataTypes.UUID, allowNull: false },
  pack_id: { type: DataTypes.UUID, allowNull: false },
  delta_units: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      isNotZero(value) {
        if (value === 0) throw new Error('delta_units cannot be zero');
      },
    },
  },
  reason: { type: DataTypes.TEXT, allowNull: false },
  approved_by: { type: DataTypes.UUID, allowNull: false },
  approved_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, options('stock_adjustments', [{ fields: ['stocktake_id'] }]));

const OutboundOrder = sequelize.define('OutboundOrder', {
  id: uuid,
  destination_name: { type: DataTypes.STRING(255), allowNull: false },
  reference_number: DataTypes.STRING(100),
  status: { type: DataTypes.ENUM('draft', 'picking', 'confirmed', 'cancelled'), allowNull: false, defaultValue: 'draft' },
  created_by: { type: DataTypes.UUID, allowNull: false },
  confirmed_at: DataTypes.DATE,
}, options('outbound_orders', [{ fields: ['status'] }]));

const OutboundLine = sequelize.define('OutboundLine', {
  id: uuid,
  outbound_order_id: { type: DataTypes.UUID, allowNull: false },
  product_id: { type: DataTypes.UUID, allowNull: false },
  lot_id: DataTypes.UUID,
  requested_units: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, validate: { min: 1 } },
}, options('outbound_lines', [{ fields: ['outbound_order_id'] }]));

const OutboundScan = sequelize.define('OutboundScan', {
  id: uuid,
  outbound_line_id: { type: DataTypes.UUID, allowNull: false },
  pack_id: { type: DataTypes.UUID, allowNull: false },
  tag_id: { type: DataTypes.INTEGER, allowNull: false },
  scanned_by: { type: DataTypes.UUID, allowNull: false },
  scanned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, options('outbound_scans', [{ unique: true, fields: ['outbound_line_id', 'pack_id'] }]));

const TagLifecycleEvent = sequelize.define('TagLifecycleEvent', {
  id: uuid,
  tag_id: { type: DataTypes.INTEGER, allowNull: false },
  pack_id: DataTypes.UUID,
  event_type: { type: DataTypes.ENUM('assigned', 'attached', 'detach_pending', 'detached', 'inspection_passed', 'retired'), allowNull: false },
  actor_id: { type: DataTypes.UUID, allowNull: false },
  reason: DataTypes.TEXT,
  occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, options('tag_lifecycle_events', [{ fields: ['tag_id', 'occurred_at'] }]));

const AuditLog = sequelize.define('AuditLog', {
  id: uuid,
  actor_id: DataTypes.UUID,
  action: { type: DataTypes.STRING(100), allowNull: false },
  entity_type: { type: DataTypes.STRING(100), allowNull: false },
  entity_id: { type: DataTypes.UUID, allowNull: false },
  metadata: DataTypes.JSON,
}, options('audit_logs', [{ fields: ['entity_type', 'entity_id'] }]));

const IdempotencyKey = sequelize.define('IdempotencyKey', {
  id: uuid,
  user_id: { type: DataTypes.UUID, allowNull: false },
  key: { type: DataTypes.STRING(255), allowNull: false },
  request_hash: { type: DataTypes.STRING(255), allowNull: false },
  response_status: DataTypes.INTEGER,
  response_body: DataTypes.JSON,
  expires_at: { type: DataTypes.DATE, allowNull: false },
}, options('idempotency_keys', [{ unique: true, fields: ['user_id', 'key'] }, { fields: ['expires_at'] }]));

User.hasMany(RefreshSession, { foreignKey: 'user_id', as: 'refreshSessions' });
RefreshSession.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
RefreshSession.hasMany(WebSession, { foreignKey: 'refresh_session_id', as: 'webSessions' });
WebSession.belongsTo(RefreshSession, { foreignKey: 'refresh_session_id', as: 'refreshSession' });

Supplier.hasMany(Lot, { foreignKey: 'supplier_id', as: 'lots' });
Lot.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
Product.hasMany(Lot, { foreignKey: 'product_id', as: 'lots' });
Lot.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
PoSession.hasMany(PoSessionItem, { foreignKey: 'po_session_id', as: 'items' });
PoSessionItem.belongsTo(PoSession, { foreignKey: 'po_session_id', as: 'session' });
Product.hasMany(PoSessionItem, { foreignKey: 'product_id', as: 'poSessionItems' });
PoSessionItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
PoSessionItem.hasMany(PoPackPlan, { foreignKey: 'po_session_item_id', as: 'packPlans' });
PoPackPlan.belongsTo(PoSessionItem, { foreignKey: 'po_session_item_id', as: 'item' });
RfidTag.hasOne(PoPackPlan, { foreignKey: 'rfid_tag_id', as: 'poPackPlan' });
PoPackPlan.belongsTo(RfidTag, { foreignKey: 'rfid_tag_id', as: 'rfidTag' });
PoSession.hasMany(LabelPrintJob, { foreignKey: 'po_session_id', as: 'labelPrintJobs' });
LabelPrintJob.belongsTo(PoSession, { foreignKey: 'po_session_id', as: 'session' });
PoSessionItem.hasMany(LabelPrintJob, { foreignKey: 'po_session_item_id', as: 'labelPrintJobs' });
LabelPrintJob.belongsTo(PoSessionItem, { foreignKey: 'po_session_item_id', as: 'item' });
LabelPrintJob.hasMany(LabelPrintItem, { foreignKey: 'label_print_job_id', as: 'items' });
LabelPrintItem.belongsTo(LabelPrintJob, { foreignKey: 'label_print_job_id', as: 'job' });
PoPackPlan.hasMany(LabelPrintItem, { foreignKey: 'po_pack_plan_id', as: 'labelPrintItems' });
LabelPrintItem.belongsTo(PoPackPlan, { foreignKey: 'po_pack_plan_id', as: 'packPlan' });
Supplier.hasMany(InboundReceipt, { foreignKey: 'supplier_id', as: 'inboundReceipts' });
InboundReceipt.belongsTo(Supplier, { foreignKey: 'supplier_id', as: 'supplier' });
User.hasMany(InboundReceipt, { foreignKey: 'received_by', as: 'receivedReceipts' });
InboundReceipt.belongsTo(User, { foreignKey: 'received_by', as: 'receiver' });
InboundReceipt.hasMany(InboundReceiptLine, { foreignKey: 'inbound_receipt_id', as: 'lines' });
InboundReceiptLine.belongsTo(InboundReceipt, { foreignKey: 'inbound_receipt_id', as: 'receipt' });
Product.hasMany(InboundReceiptLine, { foreignKey: 'product_id', as: 'inboundReceiptLines' });
InboundReceiptLine.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
Lot.hasMany(InboundReceiptLine, { foreignKey: 'lot_id', as: 'inboundReceiptLines' });
InboundReceiptLine.belongsTo(Lot, { foreignKey: 'lot_id', as: 'lot' });
InboundReceiptLine.hasMany(Pack, { foreignKey: 'inbound_receipt_line_id', as: 'packs' });
Pack.belongsTo(InboundReceiptLine, { foreignKey: 'inbound_receipt_line_id', as: 'receiptLine' });
Lot.hasMany(Pack, { foreignKey: 'lot_id', as: 'packs' });
Pack.belongsTo(Lot, { foreignKey: 'lot_id', as: 'lot' });

Location.belongsTo(Location, { foreignKey: 'parent_id', as: 'parent' });
Location.hasMany(Location, { foreignKey: 'parent_id', as: 'children' });
Location.hasMany(Pack, { foreignKey: 'location_id', as: 'packs' });
Pack.belongsTo(Location, { foreignKey: 'location_id', as: 'location' });
RfidTag.hasMany(TagAssignment, { foreignKey: 'tag_id', as: 'assignments' });
TagAssignment.belongsTo(RfidTag, { foreignKey: 'tag_id', as: 'tag' });
Pack.hasMany(TagAssignment, { foreignKey: 'pack_id', as: 'tagAssignments' });
TagAssignment.belongsTo(Pack, { foreignKey: 'pack_id', as: 'pack' });
User.hasMany(TagAssignment, { foreignKey: 'assigned_by', as: 'tagAssignments' });
TagAssignment.belongsTo(User, { foreignKey: 'assigned_by', as: 'assignedBy' });

Pack.hasMany(StockMovement, { foreignKey: 'pack_id', as: 'stockMovements' });
StockMovement.belongsTo(Pack, { foreignKey: 'pack_id', as: 'pack' });
Location.hasMany(StockMovement, { foreignKey: 'from_location_id', as: 'outgoingMovements' });
StockMovement.belongsTo(Location, { foreignKey: 'from_location_id', as: 'fromLocation' });
Location.hasMany(StockMovement, { foreignKey: 'to_location_id', as: 'incomingMovements' });
StockMovement.belongsTo(Location, { foreignKey: 'to_location_id', as: 'toLocation' });
User.hasMany(StockMovement, { foreignKey: 'actor_id', as: 'stockMovements' });
StockMovement.belongsTo(User, { foreignKey: 'actor_id', as: 'actor' });

Location.hasMany(Stocktake, { foreignKey: 'location_id', as: 'stocktakes' });
Stocktake.belongsTo(Location, { foreignKey: 'location_id', as: 'location' });
User.hasMany(Stocktake, { foreignKey: 'started_by', as: 'stocktakes' });
Stocktake.belongsTo(User, { foreignKey: 'started_by', as: 'startedBy' });
Stocktake.hasMany(StocktakeExpectedPack, { foreignKey: 'stocktake_id', as: 'expectedPacks' });
StocktakeExpectedPack.belongsTo(Stocktake, { foreignKey: 'stocktake_id', as: 'stocktake' });
Pack.hasMany(StocktakeExpectedPack, { foreignKey: 'pack_id', as: 'stocktakeSnapshots' });
StocktakeExpectedPack.belongsTo(Pack, { foreignKey: 'pack_id', as: 'pack' });
Stocktake.hasMany(StocktakeObservation, { foreignKey: 'stocktake_id', as: 'observations' });
StocktakeObservation.belongsTo(Stocktake, { foreignKey: 'stocktake_id', as: 'stocktake' });
Pack.hasMany(StocktakeObservation, { foreignKey: 'pack_id', as: 'stocktakeObservations' });
StocktakeObservation.belongsTo(Pack, { foreignKey: 'pack_id', as: 'pack' });
Stocktake.hasMany(StockAdjustment, { foreignKey: 'stocktake_id', as: 'adjustments' });
StockAdjustment.belongsTo(Stocktake, { foreignKey: 'stocktake_id', as: 'stocktake' });
Pack.hasMany(StockAdjustment, { foreignKey: 'pack_id', as: 'stockAdjustments' });
StockAdjustment.belongsTo(Pack, { foreignKey: 'pack_id', as: 'pack' });
User.hasMany(StockAdjustment, { foreignKey: 'approved_by', as: 'approvedAdjustments' });
StockAdjustment.belongsTo(User, { foreignKey: 'approved_by', as: 'approvedBy' });

User.hasMany(OutboundOrder, { foreignKey: 'created_by', as: 'outboundOrders' });
OutboundOrder.belongsTo(User, { foreignKey: 'created_by', as: 'createdBy' });
OutboundOrder.hasMany(OutboundLine, { foreignKey: 'outbound_order_id', as: 'lines' });
OutboundLine.belongsTo(OutboundOrder, { foreignKey: 'outbound_order_id', as: 'outboundOrder' });
Product.hasMany(OutboundLine, { foreignKey: 'product_id', as: 'outboundLines' });
OutboundLine.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
Lot.hasMany(OutboundLine, { foreignKey: 'lot_id', as: 'outboundLines' });
OutboundLine.belongsTo(Lot, { foreignKey: 'lot_id', as: 'lot' });
OutboundLine.hasMany(OutboundScan, { foreignKey: 'outbound_line_id', as: 'scans' });
OutboundScan.belongsTo(OutboundLine, { foreignKey: 'outbound_line_id', as: 'outboundLine' });
Pack.hasMany(OutboundScan, { foreignKey: 'pack_id', as: 'outboundScans' });
OutboundScan.belongsTo(Pack, { foreignKey: 'pack_id', as: 'pack' });
RfidTag.hasMany(OutboundScan, { foreignKey: 'tag_id', as: 'outboundScans' });
OutboundScan.belongsTo(RfidTag, { foreignKey: 'tag_id', as: 'tag' });
User.hasMany(OutboundScan, { foreignKey: 'scanned_by', as: 'outboundScans' });
OutboundScan.belongsTo(User, { foreignKey: 'scanned_by', as: 'scannedBy' });

RfidTag.hasMany(TagLifecycleEvent, { foreignKey: 'tag_id', as: 'lifecycleEvents' });
TagLifecycleEvent.belongsTo(RfidTag, { foreignKey: 'tag_id', as: 'tag' });
Pack.hasMany(TagLifecycleEvent, { foreignKey: 'pack_id', as: 'tagLifecycleEvents' });
TagLifecycleEvent.belongsTo(Pack, { foreignKey: 'pack_id', as: 'pack' });
User.hasMany(TagLifecycleEvent, { foreignKey: 'actor_id', as: 'tagLifecycleEvents' });
TagLifecycleEvent.belongsTo(User, { foreignKey: 'actor_id', as: 'actor' });
User.hasMany(AuditLog, { foreignKey: 'actor_id', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'actor_id', as: 'actor' });
User.hasMany(IdempotencyKey, { foreignKey: 'user_id', as: 'idempotencyKeys' });
IdempotencyKey.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

module.exports = {
  sequelize,
  User,
  RefreshSession,
  WebSession,
  Supplier,
  Product,
  PoSession,
  PoSessionItem,
  PoPackPlan,
  LabelPrintJob,
  LabelPrintItem,
  Lot,
  Location,
  InboundReceipt,
  InboundReceiptLine,
  Pack,
  RfidTag,
  TagAssignment,
  StockMovement,
  Stocktake,
  StocktakeExpectedPack,
  StocktakeObservation,
  StockAdjustment,
  OutboundOrder,
  OutboundLine,
  OutboundScan,
  TagLifecycleEvent,
  AuditLog,
  IdempotencyKey,
};
