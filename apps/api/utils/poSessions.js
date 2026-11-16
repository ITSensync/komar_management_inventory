const sessionFields = ['session_number', 'reference_number', 'notes'];
const itemFields = ['product_id', 'ordered_supplier_pack_quantity', 'min_outbound_units', 'expires_on', 'notes'];

function normalizePoSession(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Session data must be an object.' }] };
  }

  const errors = [];
  const unknownFields = Object.keys(input).filter((field) => !sessionFields.includes(field));
  unknownFields.forEach((field) => errors.push({ field, message: 'Field is not allowed.' }));
  const has = (field) => Object.prototype.hasOwnProperty.call(input, field);

  if (current && !sessionFields.some(has)) {
    errors.push({ field: 'body', message: 'At least one session field is required.' });
  }

  const data = {
    session_number: current ? current.session_number : undefined,
    reference_number: current ? current.reference_number : null,
    notes: current ? current.notes : null,
  };

  if (has('session_number')) data.session_number = normalizeText(input.session_number, 'session_number', 100, errors, true);
  if (has('reference_number')) data.reference_number = normalizeOptionalText(input.reference_number, 'reference_number', 100, errors);
  if (has('notes')) data.notes = normalizeOptionalText(input.notes, 'notes', 5000, errors);

  if (!data.session_number) errors.push({ field: 'session_number', message: 'Field is required.' });
  return { data, errors };
}

function normalizePoSessionItem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Session item data must be an object.' }] };
  }

  const errors = [];
  const unknownFields = Object.keys(input).filter((field) => !itemFields.includes(field));
  unknownFields.forEach((field) => errors.push({ field, message: 'Field is not allowed.' }));

  const data = {
    product_id: normalizeUuid(input.product_id, 'product_id', errors),
    ordered_supplier_pack_quantity: normalizePositiveInteger(input.ordered_supplier_pack_quantity, 'ordered_supplier_pack_quantity', errors),
    min_outbound_units: normalizePositiveInteger(input.min_outbound_units, 'min_outbound_units', errors),
    expires_on: normalizeOptionalDate(input.expires_on, 'expires_on', errors),
    notes: normalizeOptionalText(input.notes, 'notes', 5000, errors),
  };

  return { data, errors };
}

function calculateRepackPlan({ orderedSupplierPackQuantity, supplierPackUnits, minOutboundUnits, baseUnit = 'pcs' }) {
  const errors = [];
  if (!Number.isInteger(supplierPackUnits) || supplierPackUnits < 1) {
    errors.push({ field: 'product_id', message: 'Product must have a positive supplier_pack_units value before it can be used in a PO session.' });
    return { errors };
  }
  const orderedQuantity = orderedSupplierPackQuantity * supplierPackUnits;
  if (!Number.isSafeInteger(orderedQuantity) || orderedQuantity < 1) {
    errors.push({ field: 'ordered_supplier_pack_quantity', message: 'Calculated ordered quantity is outside the supported range.' });
    return { errors };
  }
  if (orderedQuantity % minOutboundUnits !== 0) {
    const packLabel = orderedSupplierPackQuantity === 1 ? 'supplier pack' : 'supplier packs';
    errors.push({
      field: 'min_outbound_units',
      message: `Total ${orderedQuantity} ${baseUnit} from ${orderedSupplierPackQuantity} ${packLabel} cannot be evenly divided into repack units of ${minOutboundUnits}.`,
    });
    return { errors };
  }
  return {
    errors,
    data: {
      ordered_quantity: orderedQuantity,
      required_rfid_count: orderedQuantity / minOutboundUnits,
    },
  };
}

function normalizePrintFormat(value) {
  return value === undefined ? { data: 'pdf', errors: [] } : ['pdf', 'zpl'].includes(value)
    ? { data: value, errors: [] }
    : { data: undefined, errors: [{ field: 'format', message: 'Must be pdf or zpl.' }] };
}

function normalizeText(value, field, maxLength, errors, uppercase = false) {
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be a string.' });
    return undefined;
  }
  let normalized = value.trim();
  if (uppercase) normalized = normalized.toUpperCase();
  if (!normalized || normalized.length > maxLength) {
    errors.push({ field, message: `Must contain 1 to ${maxLength} characters.` });
    return undefined;
  }
  return normalized;
}

function normalizeOptionalText(value, field, maxLength, errors) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeText(value, field, maxLength, errors);
}

function normalizePositiveInteger(value, field, errors) {
  if (!Number.isInteger(value) || value < 1) {
    errors.push({ field, message: 'Must be a positive integer.' });
    return undefined;
  }
  return value;
}

function normalizeUuid(value, field, errors) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    errors.push({ field, message: 'Must be a UUID.' });
    return undefined;
  }
  return value;
}

function normalizeOptionalDate(value, field, errors) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push({ field, message: 'Must use YYYY-MM-DD format.' });
    return undefined;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    errors.push({ field, message: 'Must be a valid calendar date.' });
    return undefined;
  }
  return value;
}

module.exports = { calculateRepackPlan, normalizePoSession, normalizePoSessionItem, normalizePrintFormat };
