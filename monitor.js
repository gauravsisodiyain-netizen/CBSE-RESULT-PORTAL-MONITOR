'use strict';
const https = require('https');
const { performance } = require('perf_hooks');

const TLS_CODES = new Set(['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_NOT_YET_VALID']);

/** One real HTTPS GET. Resolves as soon as the response HEADERS arrive, then drops the connection (body is never downloaded). */
function realGetHeaders(url, { timeoutMs, userAgent, insecureTls }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = https.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', agent: false,
      rejectUnauthorized: !insecureTls,
      headers: { 'User-Agent': userAgent, Accept: 'text/html,*/*;q=0.8', 'Accept-Encoding': 'identity', Connection: 'close' },
    }, (res) => { const out = { status: res.statusCode, location: res.headers.location }; res.destroy(); finish(resolve, out); });
    const timer = setTimeout(() => { const e = new Error('timeout'); e.code = 'APP_TIMEOUT'; req.destroy(e); }, timeoutMs);
    req.on('error', (e) => finish(reject, e));
    req.end();
  });
}

function classify(err) {
  const code = err && err.code ? String(err.code) : '';
  if (code === 'APP_TIMEOUT' || code === 'ETIMEDOUT') return ['TIMEOUT', 'No response within the time limit'];
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return ['DNS_FAILURE', 'The website address could not be looked up (DNS)'];
  if (code === 'ECONNREFUSED') return ['CONNECTION_REFUSED', 'The server refused the connection'];
  if (code === 'ECONNRESET' || code === 'EPIPE') return ['CONNECTION_RESET', 'The connection was closed by the server'];
  if (TLS_CODES.has(code) || /certificate/i.test(err && err.message || '')) return ['TLS_ERROR', `Certificate could not be verified (${code || 'TLS'}); see README`];
  return ['NETWORK_ERROR', `Connection failed${code ? ` (${code})` : ''}`];
}

function createMonitor({ portals, settings, extraAllowedRedirectHosts = [], getHeaders = realGetHeaders, now = () => Date.now() }) {
  const allowedRedirect = new Set([...portals.map((p) => p.host), ...extraAllowedRedirectHosts]);
  const results = new Map(); const visible = new Set();
  let running = false, finished = 0, lastManual = 0, timer = null;

  async function checkPortal(p) {
    const checkedAt = new Date(now()).toISOString();
    const base = { portalId: p.id, checkedAt, redirected: false, redirectApproved: true, httpStatus: null, latencyMs: null };
    const fail = (errorCode, errorMessage, extra = {}) => ({ ...base, ok: false, errorCode, errorMessage, ...extra });
    const t0 = performance.now();
    let url = p.url, redirected = false;
    try {
      for (let hop = 0; hop <= settings.maxRedirects; hop++) {
        const remaining = settings.timeoutMs - (performance.now() - t0);
        if (remaining <= 0) return fail('TIMEOUT', 'No response within the time limit');
        const r = await getHeaders(url, { timeoutMs: remaining, userAgent: settings.userAgent, insecureTls: settings.insecureTls });
        if (r.status >= 300 && r.status < 400 && r.location) {
          redirected = true;
          let next; try { next = new URL(r.location, url); } catch { return fail('BAD_REDIRECT', 'The portal sent an invalid redirect', { redirected: true }); }
          if (next.protocol !== 'https:') return fail('INSECURE_REDIRECT', 'The portal redirected to an insecure (non-HTTPS) address', { redirected: true, redirectApproved: false });
          if (!allowedRedirect.has(next.hostname)) return fail('UNAPPROVED_REDIRECT', `Redirected to ${next.hostname}, which is not on the approved list`, { redirected: true, redirectApproved: false, httpStatus: r.status });
          url = next.toString(); continue;
        }
        const latencyMs = Math.max(1, Math.round(performance.now() - t0));
        if (r.status >= 200 && r.status < 400) return { ...base, ok: true, latencyMs, httpStatus: r.status, redirected };
        return fail(`HTTP_${r.status}`, `The server answered with HTTP ${r.status}`, { httpStatus: r.status, redirected });
      }
      return fail('TOO_MANY_REDIRECTS', 'Too many redirects', { redirected: true });
    } catch (err) { const [c, m] = classify(err); return fail(c, m); }
  }

  async function runChecks(showChecking) {
    if (running) return;
    running = true;                                   // set before any await
    if (showChecking) portals.forEach((p) => visible.add(p.id));
    try {
      const out = await Promise.all(portals.map(checkPortal));
      out.forEach((r) => results.set(r.portalId, r));
      finished = now();
    } finally { running = false; visible.clear(); }
  }

  // Two-stage verification (stage 1: allowlist of government domains; stage 2: exact destination + live redirect check).
  function verify(p) {
    const stage1 = /\.(gov|nic)\.in$/.test(p.host) ? 'passed' : 'failed';
    let staticOk = false;
    try {
      const u = new URL(p.url), d = p.domain.split('/')[0];
      staticOk = u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname === p.host &&
        u.pathname.startsWith(p.path) && (u.hostname === d || u.hostname === `www.${d}`);
    } catch { /* invalid URL */ }
    const last = results.get(p.id);
    const liveBad = last && ['UNAPPROVED_REDIRECT', 'INSECURE_REDIRECT', 'BAD_REDIRECT'].includes(last.errorCode);
    const stage2 = staticOk && !liveBad ? 'passed' : 'failed';
    return { status: stage1 === 'passed' && stage2 === 'passed' ? 'verified' : 'failed', stage1: { status: stage1 }, stage2: { status: stage2 }, checkedAt: new Date(now()).toISOString(), adminApproved: false };
  }

  function state() {
    const list = portals.map((p) => results.get(p.id)).filter(Boolean);
    const netCodes = ['DNS_FAILURE', 'NETWORK_ERROR'];
    const monitorError = list.length === portals.length && list.every((r) => !r.ok && netCodes.includes(r.errorCode))
      ? 'This computer could not reach any portal (check its internet connection, VPN or firewall).' : null;
    const cool = lastManual ? Math.max(0, Math.ceil(settings.manualCooldownSeconds - (now() - lastManual) / 1000)) : 0;
    return {
      results: list,
      verification: Object.fromEntries(portals.map((p) => [p.id, verify(p)])),
      visibleChecking: [...visible], checkInProgress: running,
      lastCheckedAt: finished ? new Date(finished).toISOString() : null,
      nextCheckAt: finished ? new Date(finished + settings.checkIntervalSeconds * 1000).toISOString() : null,
      checkIntervalSeconds: settings.checkIntervalSeconds, manualCooldownSecondsLeft: cool,
      thresholds: settings.thresholds, monitorError, serverTime: new Date(now()).toISOString(),
    };
  }

  /** "Run Check Now". Returns { status, body } for the HTTP layer. */
  function requestManualCheck() {
    if (running) return { status: 202, body: { accepted: true, alreadyRunning: true, state: state() } };
    const wait = settings.manualCooldownSeconds - (now() - lastManual) / 1000;
    if (lastManual && wait > 0) return { status: 429, body: { accepted: false, reason: 'cooldown', retryAfterSeconds: Math.ceil(wait), state: state() } };
    lastManual = now(); runChecks(true);
    return { status: 202, body: { accepted: true, state: state() } };
  }

  function start() { runChecks(false); timer = setInterval(() => runChecks(false), settings.checkIntervalSeconds * 1000); timer.unref?.(); }
  function stop() { clearInterval(timer); }
  return { start, stop, state, runChecks, requestManualCheck, checkPortal };
}

module.exports = { createMonitor, realGetHeaders, classify };
