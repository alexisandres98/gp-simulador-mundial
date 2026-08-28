// canonical-graph/scheduler.js — planificador de matching canónico (Sprint 2). Lock advisory 'canonical-graph:match'.
// Hace autónomo el pipeline: ingesta (Sprint 1) → MATCH (esto) → evaluación de arbitraje (Sprint 3).
// Lee la metadata de mercado del CATÁLOGO (rápido), matchea y persiste mappings. Best-effort, anti-solape.
// Solo arranca si CANONICAL_GRAPH_ENABLED + WRITE_ENABLED + AUTO_MATCH_ENABLED.
'use strict';
const cfg = require('./config');
const client = require('../database/client');
const dbRepos = require('../database/repositories');
const index = require('./index');
const review = require('./review');
const locks = require('../market-data/locks');
const log = require('../database/logger');

const INTERVAL_MS = (() => { const n = parseInt(process.env.CANONICAL_SCHEDULER_INTERVAL_MS, 10); return Number.isFinite(n) ? n : 300000; })(); // 5 min
const PA = 'polymarket', PB = 'kalshi';
const state = { started: false, timer: null, running: false, lastRunAt: null };

// loadMarkets — metadata de mercado desde el catálogo (title + description=reglas). Fuente única usada también por la CLI.
async function loadMarkets(providerCode) {
  const prov = await dbRepos.providers.findByCode(providerCode);
  if (!prov) return [];
  const r = await client.query(
    `SELECT external_event_id, external_market_id, title, description, market_type_raw, status,
            start_time, close_time, resolution_source, raw_metadata
     FROM provider_market_catalog WHERE provider_id = $1 LIMIT 2000`, [prov.id]);
  return r.rows.map(c => ({
    title: c.title, description: c.description, question: c.title,
    conditionId: c.external_market_id, id: c.external_market_id, ticker: c.external_market_id,
    slug: (c.raw_metadata && c.raw_metadata.slug) || null,
    event_ticker: c.external_event_id, eventSlug: c.external_event_id, externalEventId: c.external_event_id,
    status: c.status, close_time: c.close_time, startTime: c.start_time, resolutionSource: c.resolution_source,
  }));
}

async function tick() {
  if (state.running) { log.warn('canonical: ciclo omitido por solape'); return { skipped: 'overlap' }; }
  state.running = true;
  const _h0 = Math.round(process.memoryUsage().heapUsed / 1048576);
  try {
    const lr = await locks.withLock('canonical-graph', 'match', async () => {
      const a = await loadMarkets(PA), b = await loadMarkets(PB);
      if (!a.length || !b.length) return { skipped: 'no_markets' };
      const res = index.matchProviders(a, b, PA, PB);
      const persisted = await review.persistResults(res.results, { providerA: PA, providerB: PB });
      return { analyzed: res.results.length, persisted };
    });
    state.lastRunAt = new Date().toISOString();
    const _h1 = Math.round(process.memoryUsage().heapUsed / 1048576);
    if (_h1 - _h0 > 200) log.warn('canonical: ciclo con salto de memoria', { heap_antes_mb: _h0, heap_despues_mb: _h1 });
    return lr.acquired ? lr.result : { skipped: lr.skipped };
  } catch (e) { log.error('canonical: error en ciclo', { error: e.message }); return { error: 'cycle_error' }; }
  finally { state.running = false; }
}

function start() {
  if (state.started) return { started: true, alreadyRunning: true };
  if (!cfg.flags.autoMatchEnabled) return { started: false, reason: 'auto_match_disabled' };
  state.started = true;
  state.timer = setInterval(() => { tick().catch(() => {}); }, INTERVAL_MS);
  if (state.timer.unref) state.timer.unref();
  setTimeout(() => { tick().catch(() => {}); }, 20000); // primer match diferido (no competir con el arranque)
  log.info('canonical: scheduler iniciado', { intervalMs: INTERVAL_MS });
  return { started: true, intervalMs: INTERVAL_MS };
}
function stop() { if (state.timer) clearInterval(state.timer); state.timer = null; state.started = false; return { started: false }; }
async function runOnce() { return tick(); }

module.exports = { start, stop, runOnce, loadMarkets, status: () => ({ started: state.started, running: state.running, lastRunAt: state.lastRunAt, intervalMs: INTERVAL_MS }) };
