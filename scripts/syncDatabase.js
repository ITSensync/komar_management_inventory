const { sequelize } = require('../models');

const alter = process.argv.includes('--alter');

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter });
    console.log(`Database schema ${alter ? 'updated' : 'created'} successfully.`);
  } catch (error) {
    console.error('Database schema sync failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

syncDatabase();
