const { ForeignKeyConstraintError, UniqueConstraintError } = require('sequelize');
const { InboundReceiptLine, Lot, OutboundLine, Product } = require('../models');
const { normalizeProduct } = require('../utils/products');

function validationResult(errors) {
  return {
    status: 400,
    body: { success: false, message: 'Product validation failed.', errors },
  };
}

async function listProducts() {
  return Product.findAll({ order: [['name', 'ASC']] });
}

async function createProduct(input) {
  const normalized = normalizeProduct(input);
  if (normalized.errors.length) return validationResult(normalized.errors);

  try {
    const product = await Product.create(normalized.data);
    return { status: 201, body: { success: true, data: product } };
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    return {
      status: 409,
      body: { success: false, message: 'SKU is already registered.' },
    };
  }
}

async function getProductById(id) {
  return Product.findByPk(id);
}

async function updateProduct(id, input) {
  const product = await getProductById(id);
  if (!product) return { status: 404, body: { success: false, message: 'Product not found.' } };

  const normalized = normalizeProduct(input, product.toJSON());
  if (normalized.errors.length) return validationResult(normalized.errors);

  try {
    await product.update(normalized.data);
    return { status: 200, body: { success: true, data: product } };
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    return {
      status: 409,
      body: { success: false, message: 'SKU is already registered.' },
    };
  }
}

async function deleteProduct(id) {
  const product = await getProductById(id);
  if (!product) return { status: 404, body: { success: false, message: 'Product not found.' } };

  const references = await Promise.all([
    Lot.count({ where: { product_id: id } }),
    InboundReceiptLine.count({ where: { product_id: id } }),
    OutboundLine.count({ where: { product_id: id } }),
  ]);
  if (references.some(Boolean)) {
    return {
      status: 409,
      body: { success: false, message: 'Product is already used. Set status to inactive instead.' },
    };
  }

  try {
    await product.destroy();
    return { status: 200, body: { success: true, message: 'Product deleted successfully.' } };
  } catch (error) {
    if (!(error instanceof ForeignKeyConstraintError)) throw error;
    return {
      status: 409,
      body: { success: false, message: 'Product is already used. Set status to inactive instead.' },
    };
  }
}

module.exports = { createProduct, deleteProduct, getProductById, listProducts, updateProduct };
