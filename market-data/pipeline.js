// market-data/pipeline.js — orquestación de un ciclo de ingesta (Sprint 1, shadow mode).
// request → raw_snapshot → normalized_snapshot → orderbook levels → ingestion_run → freshness → metrics.
// BEST-EFFORT y AISLADO: un fallo de un mercado no rompe el ciclo; un fallo del ciclo no rompe la app.
// Gated por flags (writeEnabled + providerEnabled). Toma advisory lock por (provider+job).

'use strict';
const cfg = require('./config');
const repos = require('../database/repositories');
const catalogRepo = require('./repositories/catalogRepository');
const orderbookRepo = require('./repositories/orderbookRepository');
const { computeChecksum } = require('../database/checksum');
const locks = require('./locks');
const metrics = require('./metrics');
const freshness = require('./freshness');
const log = require('../database/logger');

const COLLECTORS = {
  polymarket: require('./providers/polymarketCollector'),
  kalshi: require('./providers/kalshiCollector'),
};

const PROVIDER_META = {
  polymarket: { name: 'Polymarket', baseUrl: 'https://gamma-api.polymarket.com', type: 'prediction_market', orderbook: true },
  kalshi: { name: 'Kalshi', baseUrl: 'https://api.elections.kalshi.com/trade-api/v2', type: 'prediction_market', orderbook: true },
};

// Marca como 'failed' las ingestion_runs que quedaron 'running' tras un crash (más viejas que el umbral).
async function reapAbandonedRuns(maxAgeMs = 10 * 60 * 1000) {
  try {
    const r = await require('../database/client').query(
      `UPDATE ingestion_runs SET status='failed', finished_at=now(),
         error_summary=COALESCE(error_summary,'') || ' [reaped: abandoned running]'
       WHERE status='running' AND started_at < now() - ($1::int * interval '1 millisecond') RETURNING id`,
      [maxAgeMs]
    );
    if (r.rowCount) log.warn('market-data: runs abandonadas marcadas como failed', { count: r.rowCount });
    return r.rowCount;
  } catch (e) { return 0; }
}

// runProviderCycle(providerName, opts) → resumen. No lanza.
async function runProviderCycle(providerName, opts = {}) {
  const collector = COLLECTORS[providerName];
  if (!collector) return { provider: providerName, skipped: 'unknown_provider' };
  if (!opts.force && !cfg.writeEnabled()) return { provider: providerName, skipped: 'write_disabled' };
  if (!opts.force && !cfg.providerEnabled(providerName)) return { provider: providerName, skipped: 'provider_disabled' };

  const lockRes = await locks.withLock(providerName, 'market-snapshot', () => runLocked(providerName, collector, opts));
  if (!lockRes.acquired) {
    if (lockRes.skipped === 'skipped_due_to_lock') metrics.record(providerName, { skippedByLock: 1 });
    return { provider: providerName, skipped: lockRes.skipped };
  }
  return lockRes.result;
}

async function runLocked(providerName, collector, opts) {
  const startedAt = new Date().toISOString();
  metrics.record(providerName, { lastStartedAt: startedAt, lastRunStatus: 'running' });
  // proveedor + ingestion_run
  const meta = PROVIDER_META[providerName];
  const provider = await repos.providers.upsertByCode({
    code: providerName, name: meta.name, providerType: meta.type, baseUrl: meta.baseUrl, supportsOrderbook: meta.orderbook, supportsHistorical: true,
  });
  const run = await repos.ingestionRuns.start({ providerId: provider.id, jobType: 'market-snapshot' });

  const tally = { received: 0, raw: 0, normalized: 0, obLevels: 0, rejected: 0, requests: 0, retries: 0, rateLimited: 0, errors: 0, latencies: [], freshness: {} };
  let collectRes;
  try {
    collectRes = await collector.collectMarkets({ fetcher: opts.fetcher, seedSlugs: opts.seedSlugs });
  } catch (e) {
    await finishRun(run.id, 'failed', tally, e.message);
    metrics.record(providerName, { lastRunStatus: 'failed', lastFinishedAt: new Date().toISOString(), errors: 1 });
    return { provider: providerName, status: 'failed', error: 'collect_failed' };
  }
  accStats(tally, collectRes.stats);
  tally.received = collectRes.markets.length;

  for (const mk of collectRes.markets) {
    try {
      await ingestMarket(providerName, provider.id, run.id, collector, mk, opts, tally);
    } catch (e) {
      tally.rejected++; tally.errors++;
      metrics.record(providerName, { rejected: 1, errors: 1 });
    }
  }

  metrics.record(providerName, { marketsTracked: collectRes.markets.length });
  const status = tally.errors && tally.normalized === 0 ? 'failed' : (tally.rejected || tally.errors ? 'partial' : 'success');
  await finishRun(run.id, status, tally, tally.errors ? `${tally.errors} errores` : null);
  metrics.record(providerName, {
    requests: tally.requests, retries: tally.retries, rateLimited: tally.rateLimited, errors: 0,
    rawWritten: tally.raw, normalizedWritten: tally.normalized, orderbookLevels: tally.obLevels,
    latencies: tally.latencies, lastRunStatus: status, lastFinishedAt: new Date().toISOString(),
    lastSuccessfulSnapshotAt: tally.normalized ? new Date().toISOString() : undefined,
  });
  return { provider: providerName, status, ...summary(tally) };
}

async function ingestMarket(providerName, providerId, runId, collector, mk, opts, tally) {
  const snap = mk.normalized.snapshot;
  const cat = mk.normalized.catalog;
  // catálogo (no borra; actualiza last_seen)
  await catalogRepo.upsertMarket({ providerId, ...cat });
  // raw snapshot (objeto EXACTO del mercado; no duplicamos el response completo)
  const checksum = computeChecksum(mk.raw);
  const rawBytes = Buffer.byteLength(JSON.stringify(mk.raw));
  const raw = await repos.rawSnapshots.insert({
    providerId, externalEventId: snap.externalEventId, externalMarketId: snap.externalMarketId,
    externalOutcomeId: snap.externalOutcomeId, payload: mk.raw, ingestionRunId: runId, checksum,
  });
  tally.raw++; metrics.record(providerName, { rawBytes, rawCount: 1 });
  // normalized snapshot
  const norm = await repos.normalizedSnapshots.insert({
    rawSnapshotId: raw.id, providerId,
    externalEventId: snap.externalEventId, externalMarketId: snap.externalMarketId, externalOutcomeId: snap.externalOutcomeId,
    marketStatus: snap.marketStatus, side: snap.side,
    bestBid: snap.bestBid, bestAsk: snap.bestAsk, midpoint: snap.midpoint, lastTrade: snap.lastTrade, spread: snap.spread,
    volume: snap.volume, openInterest: snap.openInterest, availableDepth: snap.availableDepth,
    currency: snap.currency, isLive: snap.isLive, providerTimestamp: snap.providerTimestamp,
    normalizerVersion: snap.normalizerVersion, metadata: snap.metadata,
  });
  tally.normalized++;
  if (!snap.providerTimestamp) metrics.record(providerName, { marketsNoTimestamp: 1 });
  // freshness (basis received_at si no hay provider ts)
  const fr = freshness.classify({ providerTimestamp: snap.providerTimestamp, receivedAt: norm.received_at, expectedIntervalMs: cfg.intervals[providerName] });
  tally.freshness[fr.state] = (tally.freshness[fr.state] || 0) + 1;

  // order book (best-effort; un fallo no tumba el mercado)
  if (meta(providerName).orderbook) {
    let ob = null;
    try { ob = await collector.fetchOrderBook(mk, { fetcher: opts.fetcher }); } catch { ob = null; }
    if (ob && ob.stats) accStats(tally, ob.stats);
    if (ob && ob.normalized && ob.normalized.levels && ob.normalized.levels.length) {
      // raw del book para auditabilidad
      if (ob.raw) {
        const obChecksum = computeChecksum(ob.raw);
        await repos.rawSnapshots.insert({ providerId, externalMarketId: snap.externalMarketId, externalOutcomeId: snap.externalOutcomeId, payload: ob.raw, ingestionRunId: runId, checksum: obChecksum });
        tally.raw++;
      }
      const levels = ob.normalized.levels.map(l => ({
        normalizedSnapshotId: norm.id, providerId, externalMarketId: snap.externalMarketId, externalOutcomeId: snap.externalOutcomeId,
        side: l.side, price: l.price, size: l.size, levelIndex: l.levelIndex, providerTimestamp: ob.normalized.providerTimestamp,
      }));
      const inserted = await orderbookRepo.insertLevels(levels);
      tally.obLevels += inserted;
    } else {
      metrics.record(providerName, { marketsNoOrderbook: 1 });
    }
  }
}

function meta(p) { return PROVIDER_META[p]; }
function accStats(tally, st) {
  if (!st) return;
  tally.requests += st.requestCount || 0; tally.retries += st.retryCount || 0; tally.rateLimited += st.rateLimited || 0;
  if (Array.isArray(st.latencies)) tally.latencies.push(...st.latencies);
  if (Array.isArray(st.errors)) tally.errors += st.errors.length;
}
function summary(t) { return { received: t.received, raw: t.raw, normalized: t.normalized, orderbookLevels: t.obLevels, rejected: t.rejected, requests: t.requests, freshness: t.freshness }; }
async function finishRun(id, status, t, errorSummary) {
  try {
    await repos.ingestionRuns.finish(id, {
      status, recordsReceived: t.received, recordsWritten: t.raw + t.normalized, recordsRejected: t.rejected,
      requestCount: t.requests, errorCount: t.errors, errorSummary,
    });
  } catch { /* best-effort */ }
}

module.exports = { runProviderCycle, reapAbandonedRuns, COLLECTORS, PROVIDER_META };
