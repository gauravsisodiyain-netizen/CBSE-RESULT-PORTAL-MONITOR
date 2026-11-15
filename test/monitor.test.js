'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../config');
const { createMonitor, classify } = require('../monitor');

const S = { ...cfg.settings, timeoutMs: 1500 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (getHeaders, over = {}, portals = cfg.portals) => createMonitor({ portals, settings: { ...S, ...over }, extraAllowedRedirectHosts: cfg.extraAllowedRedirectHosts, getHeaders });
const byId = (m) => Object.fromEntries(m.state().results.map((r) => [r.portalId, r]));

test('exactly the 7 supplied portals, with the exact official URLs', () => {
  assert.deepStrictEqual(cfg.portals.map((p) => p.url), [
    'https://www.cbse.gov.in/', 'https://results.digilocker.gov.in/', 'https://web.umang.gov.in/', 'https://www.india.gov.in/',
    'https://cbse.digitallocker.gov.in/', 'https://www.edudel.nic.in/', 'https://www.edudel.nic.in/dbse/index.html']);
});

test('latency is measured per portal', async () => {
  const delays = { 'www.cbse.gov.in': 100, 'results.digilocker.gov.in': 300, 'web.umang.gov.in': 500 };
  const m = mk(async (url) => { await sleep(delays[new URL(url).hostname] ?? 50); return { status: 200 }; });
  await m.runChecks(false); const r = byId(m);
  for (const [id, d] of [['cbse-official-website', 100], ['digilocker-results', 300], ['umang', 500]]) assert(r[id].ok && r[id].latencyMs >= d && r[id].latencyMs < d + 150, `${id}: ${r[id].latencyMs}`);
  assert.strictEqual(m.state().results.length, 7);
});

test('HTTP 503 is Offline with its code', async () => {
  const m = mk(async () => ({ status: 503 })); await m.runChecks(false);
  const r = m.state().results[0]; assert(!r.ok && r.errorCode === 'HTTP_503' && r.latencyMs === null);
});

test('no answer within the timeout is TIMEOUT', async () => {
  const m = mk(async (u, o) => { await sleep(o.timeoutMs + 50); const e = new Error('x'); e.code = 'APP_TIMEOUT'; throw e; }, { timeoutMs: 300 });
  await m.runChecks(false); assert.strictEqual(m.state().results[0].errorCode, 'TIMEOUT');
});

test('approved redirect is followed and marked redirected', async () => {
  const m = mk(async (url) => (url === 'https://www.cbse.gov.in/' ? { status: 301, location: 'https://cbse.gov.in/final' } : { status: 200 }));
  await m.runChecks(false); const r = byId(m)['cbse-official-website']; assert(r.ok && r.redirected && r.redirectApproved);
});

test('unapproved redirect is NOT followed and verification fails for that portal only', async () => {
  const m = mk(async (url) => (new URL(url).hostname === 'web.umang.gov.in' ? { status: 302, location: 'https://evil.example.com/x' } : { status: 200 }));
  await m.runChecks(false); const st = m.state(); const r = byId(m).umang;
  assert(!r.ok && r.errorCode === 'UNAPPROVED_REDIRECT' && /evil\.example\.com/.test(r.errorMessage));
  assert.strictEqual(st.verification.umang.status, 'failed'); assert.strictEqual(st.verification['cbse-official-website'].status, 'verified');
});

test('insecure (http) redirect and redirect loops are rejected', async () => {
  let m = mk(async () => ({ status: 302, location: 'http://www.cbse.gov.in/' })); await m.runChecks(false);
  assert.strictEqual(m.state().results[0].errorCode, 'INSECURE_REDIRECT');
  m = mk(async () => ({ status: 302, location: 'https://www.cbse.gov.in/again' })); await m.runChecks(false);
  assert.strictEqual(m.state().results[0].errorCode, 'TOO_MANY_REDIRECTS');
});

test('all DNS failures produce an explanatory monitorError (never a fake fastest)', async () => {
  const m = mk(async () => { const e = new Error('x'); e.code = 'ENOTFOUND'; throw e; }); await m.runChecks(false);
  assert(m.state().results.every((r) => !r.ok && r.errorCode === 'DNS_FAILURE') && /could not reach any portal/.test(m.state().monitorError));
});

test('a portal being down does not change its verified status; a tampered URL does', async () => {
  let m = mk(async () => ({ status: 503 })); await m.runChecks(false);
  assert(Object.values(m.state().verification).every((v) => v.status === 'verified'));
  const bad = cfg.portals.map((p) => (p.id === 'umang' ? { ...p, url: 'https://web.umang.gov.in.evil.com/' } : p));
  m = createMonitor({ portals: bad, settings: S, getHeaders: async () => ({ status: 200 }) });
  assert.strictEqual(m.state().verification.umang.status, 'failed');
});

test('manual check: runs, cooldown 429, alreadyRunning 202', async () => {
  let n = 0, clock = 1e6;
  const m = createMonitor({ portals: cfg.portals, settings: { ...S, manualCooldownSeconds: 15 }, now: () => clock, getHeaders: async () => { n++; await sleep(80); return { status: 200 }; } });
  assert.strictEqual(m.requestManualCheck().status, 202); assert.strictEqual(m.state().visibleChecking.length, 7);
  assert(m.requestManualCheck().body.alreadyRunning);
  await sleep(250); assert.strictEqual(n, 7);
  clock += 5000; const c = m.requestManualCheck(); assert.strictEqual(c.status, 429); assert.strictEqual(c.body.retryAfterSeconds, 10);
  clock += 11000; assert.strictEqual(m.requestManualCheck().status, 202); await sleep(250); assert.strictEqual(n, 14);
});

test('error classification', () => {
  const k = (code) => classify({ code })[0];
  assert.deepStrictEqual([k('ENOTFOUND'), k('ECONNREFUSED'), k('CERT_HAS_EXPIRED'), k('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), k('ECONNRESET'), k('APP_TIMEOUT')],
    ['DNS_FAILURE', 'CONNECTION_REFUSED', 'TLS_ERROR', 'TLS_ERROR', 'CONNECTION_RESET', 'TIMEOUT']);
});
