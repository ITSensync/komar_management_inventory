const fields = ['code', 'name', 'description', 'status'];

function normalizeRack(input, current = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { errors: [{ field: 'body', message: 'Rack data must be an object.' }] };
  }

  const errors = [];
  const unknownFields = Object.keys(input).filter((field) => !fields.includes(field));
  unknownFields.forEach((field) => errors.push({ field, message: 'Field is not allowed.' }));
  const has = (field) => Object.prototype.hasOwnProperty.call(input, field);
  if (current && !fields.some(has)) errors.push({ field: 'body', message: 'At least one rack field is required.' });

  const data = {
    code: current ? current.code : undefined,
    name: current ? current.name : undefined,
    description: current ? current.description : null,
    status: current ? current.status : 'active',
  };

  if (has('code')) data.code = normalizeText(input.code, 'code', 100, errors, true);
  if (has('name')) data.name = normalizeText(input.name, 'name', 255, errors);
  if (has('description')) data.description = normalizeOptionalText(input.description, 'description', 1000, errors);
  if (has('status')) {
    if (!['active', 'inactive'].includes(input.status)) errors.push({ field: 'status', message: 'Must be active or inactive.' });
    else data.status = input.status;
  }

  if (!current) {
    if (data.code === undefined) errors.push({ field: 'code', message: 'Field is required.' });
    if (data.name === undefined) errors.push({ field: 'name', message: 'Field is required.' });
  }

  return { data, errors };
}

function normalizeText(value, field, maxLength, errors, uppercase = false) {
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be a string.' });
    return undefined;
  }
  const normalized = (uppercase ? value.trim().toUpperCase() : value.trim());
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

module.exports = { normalizeRack };
