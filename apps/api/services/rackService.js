const { UniqueConstraintError } = require('sequelize');
const { Rack, InventoryMovement } = require('../models');
const { normalizeRack } = require('../utils/racks');

function validationResult(errors) {
  return { status: 400, body: { success: false, message: 'Validation failed.', errors } };
}

function failure(status, message) {
  return { status, body: { success: false, message } };
}

async function listRacks(status) {
  const where = status && ['active', 'inactive'].includes(status) ? { status } : undefined;
  return Rack.findAll({ where, order: [['code', 'ASC']] });
}

async function getRack(id) {
  return Rack.findByPk(id);
}

async function createRack(input) {
  const normalized = normalizeRack(input);
  if (normalized.errors.length) return validationResult(normalized.errors);
  try {
    const rack = await Rack.create(normalized.data);
    return { status: 201, body: { success: true, data: rack } };
  } catch (error) {
    if (error instanceof UniqueConstraintError) return failure(409, 'Rack code is already registered.');
    throw error;
  }
}

async function updateRack(id, input) {
  const rack = await Rack.findByPk(id);
  if (!rack) return failure(404, 'Rack not found.');
  const normalized = normalizeRack(input, rack.toJSON());
  if (normalized.errors.length) return validationResult(normalized.errors);
  try {
    await rack.update(normalized.data);
    return { status: 200, body: { success: true, data: rack } };
  } catch (error) {
    if (error instanceof UniqueConstraintError) return failure(409, 'Rack code is already registered.');
    throw error;
  }
}

async function getRackUsage(id) {
  return InventoryMovement.count({ where: { to_rack_id: id } });
}

module.exports = { createRack, getRack, getRackUsage, listRacks, updateRack };
