'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createMonitor } = require('./monitor');

function createServer({ monitor, mode = config.mode, indexPath = path.join(__dirname, 'public', 'index.html') } = {}) {
  const mon = monitor || createMonitor({ portals: config.portals, settings: config.settings, extraAllowedRedirectHosts: config.extraAllowedRedirectHosts });
  const html = fs.readFileSync(indexPath);
  const common = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const json = (res, status, body) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { ...common, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
  };
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/healthz') { res.writeHead(200, { ...common, 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }
    const api = mode !== 'browser';   // in browser mode there is no API, so the page measures from the visitor's browser
    if (api && pathname === '/api/portals' && req.method === 'GET') return json(res, 200, mon.state());
    if (api && pathname === '/api/check' && req.method === 'POST') {
      // same-origin only: browsers cannot add this header cross-site without our consent
      if (req.headers['x-requested-with'] !== 'portal-monitor') return json(res, 403, { error: 'forbidden' });
      const r = mon.requestManualCheck();
      if (r.status === 429) res.setHeader('Retry-After', String(r.body.retryAfterSeconds));
      return json(res, r.status, r.body);
    }
    if ((pathname === '/' || pathname === '/index.html') && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': html.length });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    json(res, 404, { error: 'not found' });
  });
  return { server, monitor: mon };
}

/** Visits `<baseUrl>/healthz` every `minutes` minutes so a free host does not put the app to sleep. */
function startKeepAlive(baseUrl, minutes = 10, doFetch = fetch) {
  const url = String(baseUrl).replace(/\/+$/, '') + '/healthz';
  const ping = () => doFetch(url, { headers: { 'User-Agent': 'cbse-portal-monitor-keepalive' } }).then((r) => r.ok, () => false);
  const timer = setInterval(ping, Math.max(0.001, minutes) * 60 * 1000);
  if (timer.unref) timer.unref();                // never keeps the process alive on its own
  return { url, ping, stop: () => clearInterval(timer) };
}

module.exports = { createServer, startKeepAlive };

if (require.main === module) {
  const { server, monitor } = createServer();
  server.listen(config.port, config.host, () => {
    if (config.mode === 'server') monitor.start();
    console.log(`\n  CBSE Result Portals Monitor is running (${config.mode} mode)\n  Open:  http://localhost:${config.port}\n  ${config.mode === 'server' ? `Checks every ${config.settings.checkIntervalSeconds}s` : "Checks run in each visitor's browser"} · Ctrl+C to stop\n`);
    if (config.settings.insecureTls) console.log('  WARNING: MONITOR_INSECURE_TLS=1 — certificate validation is OFF (troubleshooting only).\n');
    const ka = config.keepAlive;
    if (ka.enabled && ka.url) { const k = startKeepAlive(ka.url, ka.minutes); console.log(`  Keep-alive ON: visiting ${k.url} every ${ka.minutes} min so the host does not put this app to sleep.\n`); }
  });
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Try:  PORT=3001 node server.js` : e); process.exit(1); });
}
