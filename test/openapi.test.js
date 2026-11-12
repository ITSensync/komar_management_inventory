const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

test('serves the OpenAPI file and Swagger UI', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const specification = await fetch(`${baseUrl}/docs/openapi.yaml`);
    const swaggerUi = await fetch(`${baseUrl}/docs/`);

    assert.equal(specification.status, 200);
    assert.match(await specification.text(), /openapi: 3\.0\.3/);
    assert.equal(swaggerUi.status, 200);
    assert.match(await swaggerUi.text(), /KOMAR RFID Inventory API/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
