const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.CORS_ORIGINS = 'http://localhost:3001,http://127.0.0.1:3001';
const { app } = require('../server');

test('allows the configured local frontend origin and handles its preflight request', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://localhost:3001' },
    });
    const preflight = await fetch(`${baseUrl}/api/po-sessions`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3001',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const rejected = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'http://untrusted.example' },
    });

    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3001');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3001');
    assert.equal(rejected.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
