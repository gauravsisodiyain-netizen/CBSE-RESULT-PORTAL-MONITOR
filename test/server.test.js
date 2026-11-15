'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../config');
const { createMonitor } = require('../monitor');
const { createServer } = require('../server');

const fakeMonitor = () => createMonitor({ portals: cfg.portals, settings: { ...cfg.settings, manualCooldownSeconds: 15 }, extraAllowedRedirectHosts: cfg.extraAllowedRedirectHosts, getHeaders: async () => ({ status: 200 }) });
const listen = (opts) => new Promise((res) => { const { server, monitor } = createServer(opts); server.listen(0, '127.0.0.1', () => res({ server, monitor, base: `http://127.0.0.1:${server.address().port}` })); });
const H = { 'X-Requested-With': 'portal-monitor' };

test('serves the page, health check, 404, and the portal API', async () => {
  const mon = fakeMonitor(); await mon.runChecks(false);
  const { server, base } = await listen({ monitor: mon, mode: 'server' });
  try {
    const page = await fetch(base + '/'); const html = await page.text();
    assert(page.ok && /text\/html/.test(page.headers.get('content-type')) && html.includes('CBSE Result Portals Monitor'));
    assert.strictEqual((await fetch(base + '/healthz')).status, 200);
    assert.strictEqual((await fetch(base + '/nope')).status, 404);
    const api = await fetch(base + '/api/portals'); const d = await api.json();
    assert(api.ok && d.results.length === 7 && d.results.every((r) => r.ok) && Object.values(d.verification).every((v) => v.status === 'verified'));
    assert.strictEqual(api.headers.get('cache-control'), 'no-store');
  } finally { server.close(); }
});

test('POST /api/check: forged request 403, real request 202, repeat inside cooldown 429', async () => {
  const { server, base } = await listen({ monitor: fakeMonitor(), mode: 'server' });
  try {
    assert.strictEqual((await fetch(base + '/api/check', { method: 'POST' })).status, 403);
    assert.strictEqual((await fetch(base + '/api/check', { method: 'POST', headers: H })).status, 202);
    await new Promise((r) => setTimeout(r, 200));
    const again = await fetch(base + '/api/check', { method: 'POST', headers: H });
    assert.strictEqual(again.status, 429); assert(Number(again.headers.get('retry-after')) > 0);
  } finally { server.close(); }
});

test('browser mode: page and health check only, no API (the page then measures in the browser)', async () => {
  const { server, base } = await listen({ monitor: fakeMonitor(), mode: 'browser' });
  try {
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/healthz')).status, 200);
    assert.strictEqual((await fetch(base + '/api/portals')).status, 404);
    assert.strictEqual((await fetch(base + '/api/check', { method: 'POST', headers: H })).status, 404);
  } finally { server.close(); }
});

test('keep-alive: builds the /healthz address and really visits it on a timer', async () => {
  const { startKeepAlive } = require('../server');
  assert.strictEqual(startKeepAlive('https://x.onrender.com/', 10, async () => ({ ok: true })).url, 'https://x.onrender.com/healthz');
  // real round trip against a running server, using a very short interval
  let hits = 0;
  const { server, base } = await listen({ monitor: fakeMonitor(), mode: 'server' });
  server.on('request', (req) => { if (req.url === '/healthz') hits++; });
  const ka = startKeepAlive(base, 0.002);                    // about every 120 ms
  try {
    await new Promise((r) => setTimeout(r, 500));
    assert(hits >= 2, `expected at least 2 self-visits, got ${hits}`);
    assert.strictEqual(await ka.ping(), true);               // a manual visit also reports success
  } finally { ka.stop(); server.close(); }
});
