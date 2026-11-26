require('./config/env');
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const sequelize = require('./config/database');
require('./models');
const rfidRoutes = require('./routes/rfidRoutes');
const productRoutes = require('./routes/productRoutes');
const poSessionRoutes = require('./routes/poSessionRoutes');
const rackRoutes = require('./routes/rackRoutes');
const placementRoutes = require('./routes/placementRoutes');
const stocktakeRoutes = require('./routes/stocktakeRoutes');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const readerSocketService = require('./services/readerSocketService');
const logger = require('./utils/logger');
const os = require('os');

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3000;
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001,http://127.0.0.1:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Middleware
app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header (health checks, CLI tools, same-origin
    // server calls) are not browser cross-origin requests and remain allowed.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  optionsSuccessStatus: 204,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Routes
app.use('/api', rfidRoutes);
app.use('/api', productRoutes);
app.use('/api', poSessionRoutes);
app.use('/api', rackRoutes);
app.use('/api', placementRoutes);
app.use('/api', stocktakeRoutes);

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

    // Schema changes are owned by the one-shot `migrate` service. Keeping the
    // API read-only at startup prevents concurrent schema changes on rollout.
    console.log('✓ Database connection ready');

    const localIP = getLocalIP();
    readerSocketService.init(httpServer);
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ Server running`);
      console.log(`  - Local: http://localhost:${PORT}`);
      console.log(`  - Network: http://${localIP}:${PORT}`);
      console.log(`✓ Health check: http://${localIP}:${PORT}/health`);
      console.log(`✓ API endpoint: http://${localIP}:${PORT}/api/rfid`);
      console.log(`✓ RFID WebSocket: ws://${localIP}:${PORT}/ws`);
      logger.info('api.started', { port: PORT, websocket_path: '/ws' });
    });
  } catch (error) {
    console.error('✗ Server startup error:', error.message);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = { app, httpServer, startServer };
