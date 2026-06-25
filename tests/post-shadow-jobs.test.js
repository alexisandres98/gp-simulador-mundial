// tests/post-shadow-jobs.test.js — Post-shadow Bloque C (puro). runWithAbort cancela de verdad la ejecución
// subyacente tras timeout y espera su terminación; runOnce respeta el AbortSignal.
'use strict';
process.env.SPORTSBOOK_PROVIDER_ENABLED = 'true';  // para que runOnce no salga 'disabled'
const path = require('path');
const R = path.join(__dirname, '..');
const { runWithAbort } = require(R + '/operations/runner');
const ingestion = require(R + '/sportsbook-providers/ingestion');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const delay = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1) success path
  const r = await runWithAbort(async () => 'done', 1000, 100);
  ok('success: devuelve resultado', r === 'done');

  // 2) timeout aborta la señal Y espera terminación real (no deja trabajo en background)
  let aborted = false, settledAfterAbort = false;
  let threw = null;
  try {
    await runWithAbort(async (signal) => {
      signal.addEventListener('abort', () => { aborted = true; });
      for (let i = 0; i < 50; i++) { await delay(20); if (signal.aborted) { settledAfterAbort = true; return 'stopped'; } }
      return 'never';
    }, 50, 1000);
  } catch (e) { threw = e; }
  ok('timeout: lanza error timeout', threw && /timed_out|timeout/i.test(threw.code || threw.message), String(threw));
  ok('timeout: abortó la señal subyacente', aborted === true);
  ok('timeout: esperó terminación real antes de propagar', settledAfterAbort === true);

  // 3) grace acotada: si el job NO coopera, runWithAbort no se cuelga (sale por graceMs)
  const t0 = Date.now();
  try { await runWithAbort(async () => { await delay(5000); }, 30, 80); } catch { /* timeout */ }
  ok('grace acotada: no se cuelga (< 1s)', Date.now() - t0 < 1000, `${Date.now() - t0}ms`);

  // 4) runOnce respeta un signal ya abortado (provider inyectado, sin red/DB)
  const fakeProvider = {
    async discoverCompetitions() { return [{ key: 'soccer_fifa_world_cup', title: 'World Cup', group: 'Soccer' }]; },
    async fetchQuotes() { return { events: [], quota: { remaining: 19000, used: 1000 } }; },
  };
  const ac = new AbortController(); ac.abort();
  let cancelled = null;
  try { await ingestion.runOnce({ provider: fakeProvider, signal: ac.signal }); }
  catch (e) { cancelled = e; }
  ok('runOnce: signal abortado → cancelled', cancelled && cancelled.code === 'cancelled', String(cancelled));

  // 5) runOnce SIN abortar corre normal (dry-run, write=false sin DB)
  const res = await ingestion.runOnce({ provider: fakeProvider });
  ok('runOnce: sin abortar corre (status ok/partial)', res && /ok|partial/.test(res.status), JSON.stringify(res));

  console.log(`\n[post-shadow-jobs] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
