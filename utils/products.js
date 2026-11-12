const fields = ['sku', 'name', 'base_unit', 'units_per_pack', 'min_outbound_units', 'expiry_required', 'status'];

function normalizeProduct(input, current) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Product data must be an object.' }] };
  }

  const errors = [];
  const unknownFields = Object.keys(input).filter((field) => !fields.includes(field));
  for (const field of unknownFields) {
    errors.push({ field, message: 'Field is not allowed.' });
  }

  const has = (field) => Object.prototype.hasOwnProperty.call(input, field);
  if (current && !fields.some(has)) {
    errors.push({ field: 'body', message: 'At least one product field is required.' });
  }

  const product = {
    sku: current ? current.sku : undefined,
    name: current ? current.name : undefined,
    base_unit: current ? current.base_unit : 'pcs',
    units_per_pack: current ? current.units_per_pack : undefined,
    min_outbound_units: current ? current.min_outbound_units : undefined,
    expiry_required: current ? current.expiry_required : false,
    status: current ? current.status : 'active',
  };

  if (has('sku')) product.sku = normalizeText(input.sku, 'sku', 100, errors, true);
  if (has('name')) product.name = normalizeText(input.name, 'name', 255, errors);
  if (has('base_unit')) product.base_unit = normalizeText(input.base_unit, 'base_unit', 20, errors, false, true);
  if (has('units_per_pack')) product.units_per_pack = normalizePositiveInteger(input.units_per_pack, 'units_per_pack', errors);
  if (has('min_outbound_units')) product.min_outbound_units = normalizePositiveInteger(input.min_outbound_units, 'min_outbound_units', errors);

  if (has('expiry_required')) {
    if (typeof input.expiry_required !== 'boolean') {
      errors.push({ field: 'expiry_required', message: 'Must be a boolean.' });
    } else {
      product.expiry_required = input.expiry_required;
    }
  }

  if (has('status')) {
    if (!['active', 'inactive'].includes(input.status)) {
      errors.push({ field: 'status', message: 'Must be active or inactive.' });
    } else {
      product.status = input.status;
    }
  }

  for (const field of ['sku', 'name', 'units_per_pack', 'min_outbound_units']) {
    if (product[field] === undefined) {
      errors.push({ field, message: 'Field is required.' });
    }
  }

  if (Number.isInteger(product.units_per_pack)
    && Number.isInteger(product.min_outbound_units)
    && product.min_outbound_units % product.units_per_pack !== 0) {
    errors.push({ field: 'min_outbound_units', message: 'Must be a multiple of units_per_pack.' });
  }

  return { data: product, errors };
}

function normalizeText(value, field, maxLength, errors, uppercase = false, lowercase = false) {
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be a string.' });
    return undefined;
  }

  let normalized = value.trim();
  if (uppercase) normalized = normalized.toUpperCase();
  if (lowercase) normalized = normalized.toLowerCase();

  if (!normalized || normalized.length > maxLength) {
    errors.push({ field, message: `Must contain 1 to ${maxLength} characters.` });
    return undefined;
  }

  return normalized;
}

function normalizePositiveInteger(value, field, errors) {
  if (!Number.isInteger(value) || value < 1) {
    errors.push({ field, message: 'Must be a positive integer.' });
    return undefined;
  }

  return value;
}

module.exports = { normalizeProduct };
