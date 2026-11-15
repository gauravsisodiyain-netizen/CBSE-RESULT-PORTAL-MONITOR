'use strict';
// ---------------------------------------------------------------------------
// CONFIG — everything you may want to change lives here.
// ---------------------------------------------------------------------------
module.exports = {
  port: Number(process.env.PORT) || 3000,
  // On a host (Render, Railway, ...) the platform sets PORT, so listen on all interfaces.
  // Locally (no PORT set) listen on 127.0.0.1 = only this computer can open it.
  host: process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1'),
  // 'server'  = this Node server checks the portals (real HTTP status, redirects, shared results).
  // 'browser' = the server only serves the page; each visitor's browser measures the portals.
  //             Use this if your host's servers cannot reach the Indian government sites (geo-blocking).
  mode: process.env.MONITOR_MODE === 'browser' ? 'browser' : 'server',
  // Keep-alive for hosts that put idle free services to sleep (Render's free plan sleeps after 15 minutes).
  // The server visits its own public /healthz page every few minutes. On Render the address is found automatically
  // (RENDER_EXTERNAL_URL). Elsewhere set KEEP_ALIVE_URL, or turn it off with KEEP_ALIVE=off.
  keepAlive: {
    url: process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '',
    minutes: Number(process.env.KEEP_ALIVE_MINUTES) || 10,     // must stay below the host's idle limit (15 on Render)
    enabled: process.env.KEEP_ALIVE !== 'off',
  },

  settings: {
    thresholds: { excellentMs: 600, goodMs: 1500 }, // <= excellent, <= good, otherwise Slow
    timeoutMs: 10000,             // no answer within this time => Offline (Timed out)
    checkIntervalSeconds: 120,    // automatic checks: one round for ALL visitors, not per visitor
    manualCooldownSeconds: 15,    // minimum gap between two "Run Check Now" presses
    maxRedirects: 5,
    userAgent: process.env.MONITOR_USER_AGENT ||
      'Mozilla/5.0 (compatible; CBSEPortalMonitor/1.0; independent student utility; availability check)',
    // Only for troubleshooting: skip TLS certificate validation (see README). Default OFF.
    insecureTls: process.env.MONITOR_INSECURE_TLS === '1',
  },

  // The seven portals (exact names, domains and URLs as supplied). `host`/`path` form the allowlist.
  portals: [
    { id: 'cbse-official-website',            name: 'CBSE Official Website',                            domain: 'www.cbse.gov.in',                url: 'https://www.cbse.gov.in/',                    host: 'www.cbse.gov.in',           path: '/' },
    { id: 'digilocker-results',               name: 'DigiLocker Results',                               domain: 'results.digilocker.gov.in',      url: 'https://results.digilocker.gov.in/',          host: 'results.digilocker.gov.in', path: '/' },
    { id: 'umang',                            name: 'UMANG Official Website',                           domain: 'web.umang.gov.in',               url: 'https://web.umang.gov.in/',                   host: 'web.umang.gov.in',          path: '/' },
    { id: 'national-portal-of-india',         name: 'National Portal of India',                         domain: 'india.gov.in',                   url: 'https://www.india.gov.in/',                   host: 'www.india.gov.in',          path: '/' },
    { id: 'cbse-digital-academic-repository', name: 'CBSE Digital Academic Repository',                 domain: 'cbse.digitallocker.gov.in',      url: 'https://cbse.digitallocker.gov.in/',          host: 'cbse.digitallocker.gov.in', path: '/' },
    { id: 'delhi-education-department',       name: 'Delhi Education Department',                       domain: 'edudel.nic.in',                  url: 'https://www.edudel.nic.in/',                  host: 'www.edudel.nic.in',         path: '/' },
    { id: 'dbse-results',                     name: 'Delhi Board of School Education (DBSE) Results',   domain: 'edudel.nic.in/dbse/index.html',  url: 'https://www.edudel.nic.in/dbse/index.html',   host: 'www.edudel.nic.in',         path: '/dbse/' },
  ],

  // Extra hostnames a portal is allowed to redirect to (besides the seven hosts above).
  // A redirect anywhere else is NOT followed: the portal is flagged "Unexpected redirect" so you can review it.
  extraAllowedRedirectHosts: [
    'cbse.gov.in', 'india.gov.in', 'edudel.nic.in', 'digilocker.gov.in', 'www.digilocker.gov.in',
  ],
};
