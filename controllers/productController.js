const productService = require('../services/productService');

async function listProducts(req, res, next) {
  try {
    const products = await productService.listProducts();
    res.json({ success: true, data: products });
  } catch (error) {
    next(error);
  }
}

async function createProduct(req, res, next) {
  try {
    const result = await productService.createProduct(req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

async function getProduct(req, res, next) {
  try {
    const product = await productService.getProductById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
}

async function updateProduct(req, res, next) {
  try {
    const result = await productService.updateProduct(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

async function removeProduct(req, res, next) {
  try {
    const result = await productService.deleteProduct(req.params.id);
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
}

module.exports = { createProduct, getProduct, listProducts, removeProduct, updateProduct };
