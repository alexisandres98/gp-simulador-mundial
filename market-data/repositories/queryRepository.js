// queryRepository.js — consultas internas del histórico (Sprint 1). Parametrizadas, con índices.
// NO se exponen como APIs públicas (solo uso interno / admin / CLI).
'use strict';
const db = require('../../database/client');

module.exports = {
  // getLatestSnapshot(providerId, market, outcome) → normalized snapshot más reciente
  async getLatestSnapshot(providerId, externalMarketId, externalOutcomeId) {
    const r = await db.query(
      `SELECT * FROM normalized_market_snapshots
       WHERE provider_id=$1 AND external_market_id=$2 AND external_outcome_id IS NOT DISTINCT FROM $3
       ORDER BY received_at DESC LIMIT 1`,
      [providerId, externalMarketId, externalOutcomeId || null]
    );
    return r.rows[0] || null;
  },
  // getSnapshotTimeline(providerId, market, outcome, from, to, limit) → histórico ordenado (usa idx_norm_market_timeline)
  async getSnapshotTimeline(providerId, externalMarketId, externalOutcomeId, from, to, limit = 500) {
    const r = await db.query(
      `SELECT id, best_bid, best_ask, midpoint, last_trade, spread, volume, open_interest, market_status, provider_timestamp, received_at
       FROM normalized_market_snapshots
       WHERE provider_id=$1 AND external_market_id=$2 AND external_outcome_id IS NOT DISTINCT FROM $3
         AND received_at >= COALESCE($4, received_at) AND received_at <= COALESCE($5, received_at)
       ORDER BY received_at DESC LIMIT $6`,
      [providerId, externalMarketId, externalOutcomeId || null, from || null, to || null, limit]
    );
    return r.rows;
  },
  async getLatestOrderBook(normalizedSnapshotId) {
    return require('./orderbookRepository').getLatestOrderBook(normalizedSnapshotId);
  },
  async getRecentIngestionRuns(providerId, limit = 20) {
    return require('../../database/repositories').ingestionRuns.recent(providerId, limit);
  },
  // getProviderFreshness(providerId) → último snapshot exitoso por mercado (resumen ligero)
  async getProviderFreshness(providerId) {
    const r = await db.query(
      `SELECT external_market_id, max(received_at) AS last_received, max(provider_timestamp) AS last_provider_ts, count(*)::int AS observations
       FROM normalized_market_snapshots WHERE provider_id=$1
       GROUP BY external_market_id ORDER BY last_received DESC LIMIT 200`,
      [providerId]
    );
    return r.rows;
  },
  async getTrackedMarkets(providerId, limit = 200) {
    return require('./catalogRepository').listTracked(providerId, limit);
  },
  // countsLastHour(providerId) → { snapshots, orderbookLevels, lastReceivedAt }
  async countsLastHour(providerId) {
    const r = await db.query(
      `SELECT
        (SELECT count(*)::int FROM normalized_market_snapshots WHERE provider_id=$1 AND received_at > now()-interval '1 hour') AS snapshots,
        (SELECT count(*)::int FROM normalized_orderbook_levels WHERE provider_id=$1 AND received_at > now()-interval '1 hour') AS ob,
        (SELECT max(received_at) FROM normalized_market_snapshots WHERE provider_id=$1) AS last_received`,
      [providerId]
    );
    return { snapshots: r.rows[0].snapshots, orderbookLevels: r.rows[0].ob, lastReceivedAt: r.rows[0].last_received };
  },
  // getStorageCounts() → conteos globales (para métricas/estimación)
  async getStorageCounts() {
    const r = await db.query(`SELECT
      (SELECT count(*)::bigint FROM raw_market_snapshots) AS raw_snapshots,
      (SELECT count(*)::bigint FROM normalized_market_snapshots) AS normalized_snapshots,
      (SELECT count(*)::bigint FROM normalized_orderbook_levels) AS orderbook_levels,
      (SELECT count(*)::bigint FROM provider_market_catalog) AS catalog_markets,
      (SELECT count(*)::bigint FROM ingestion_runs) AS ingestion_runs`);
    const x = r.rows[0];
    return { rawSnapshots: Number(x.raw_snapshots), normalizedSnapshots: Number(x.normalized_snapshots), orderbookLevels: Number(x.orderbook_levels), catalogMarkets: Number(x.catalog_markets), ingestionRuns: Number(x.ingestion_runs) };
  },
};
