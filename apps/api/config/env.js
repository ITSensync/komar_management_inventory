const path = require('path');
const dotenv = require('dotenv');

// All services share the root .env file. A caller may override it explicitly
// with ENV_FILE for isolated tests or deployments.
dotenv.config({ path: process.env.ENV_FILE || path.resolve(__dirname, '../../../.env') });
