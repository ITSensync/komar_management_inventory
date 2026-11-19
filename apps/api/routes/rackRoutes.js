const express = require('express');
const controller = require('../controllers/rackController');

const router = express.Router();

router.get('/mobile/racks', (req, res, next) => {
  req.query.status = 'active';
  return controller.listRacks(req, res, next);
});
router.get('/racks', controller.listRacks);
router.post('/racks', controller.createRack);
router.get('/racks/:id', controller.getRack);
router.patch('/racks/:id', controller.updateRack);

module.exports = router;
