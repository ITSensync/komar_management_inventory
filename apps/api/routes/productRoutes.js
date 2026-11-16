const express = require('express');
const productController = require('../controllers/productController');

const router = express.Router();

router.get('/products', productController.listProducts);
router.post('/products', productController.createProduct);
router.get('/products/:id', productController.getProduct);
router.put('/products/:id', productController.updateProduct);
router.delete('/products/:id', productController.removeProduct);

module.exports = router;
