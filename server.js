require('dotenv').config();
const express = require('express');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const sequelize = require('./config/database');
require('./models');
const rfidRoutes = require('./routes/rfidRoutes');
const productRoutes = require('./routes/productRoutes');
const errorHandler = require('./middleware/errorHandler');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', rfidRoutes);
app.use('/api', productRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
  });
});

app.get('/docs/openapi.yaml', (req, res) => {
  res.type('application/yaml').sendFile(path.join(__dirname, 'docs', 'openapi.yaml'));
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(null, {
  customSiteTitle: 'KOMAR RFID Inventory API',
  swaggerOptions: { url: '/docs/openapi.yaml' },
}));

app.use(errorHandler);

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Sync database and start server
const startServer = async () => {
  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✓ Database connection successful');

    // Create missing tables without altering an existing schema.
    await sequelize.sync();
    console.log('✓ Database synchronized');

    const localIP = getLocalIP();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Server running`);
      console.log(`  - Local: http://localhost:${PORT}`);
      console.log(`  - Network: http://${localIP}:${PORT}`);
      console.log(`✓ Health check: http://${localIP}:${PORT}/health`);
      console.log(`✓ API endpoint: http://${localIP}:${PORT}/api/rfid`);
    });
  } catch (error) {
    console.error('✗ Server startup error:', error.message);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
