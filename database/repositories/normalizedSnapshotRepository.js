// normalizedSnapshotRepository.js — normalized_market_snapshots (append-only). SQL parametrizado.
// Precios en NUMERIC: se pasan como string para no perder precisión por el float de JS.
'use strict';
const db = require('../client');

const num = v => (v === undefined || v === null || v === '') ? null : String(v);

module.exports = {
  // insert({ rawSnapshotId?, providerId, externalEventId?, externalMarketId?, externalOutcomeId?, marketStatus?,
  //          side?, bestBid?, bestAsk?, midpoint?, lastTrade?, spread?, volume?, openInterest?, availableDepth?,
  //          currency?, isLive?, providerTimestamp?, normalizerVersion?, metadata? }) → row
  async insert(s) {
    const r = await db.query(
      `INSERT INTO normalized_market_snapshots
         (raw_snapshot_id, provider_id, external_event_id, external_market_id, external_outcome_id,
          market_status, side, best_bid, best_ask, midpoint, last_trade, spread, volume, open_interest,
          available_depth, currency, is_live, provider_timestamp, normalizer_version, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16,'USD'),COALESCE($17,false),$18,COALESCE($19,'v0'),COALESCE($20,'{}'::jsonb))
       RETURNING *`,
      [s.rawSnapshotId || null, s.providerId, s.externalEventId || null, s.externalMarketId || null, s.externalOutcomeId || null,
       s.marketStatus || null, s.side || null, num(s.bestBid), num(s.bestAsk), num(s.midpoint), num(s.lastTrade), num(s.spread),
       num(s.volume), num(s.openInterest), num(s.availableDepth), s.currency || null, s.isLive ?? null,
       s.providerTimestamp || null, s.normalizerVersion || null, s.metadata ? JSON.stringify(s.metadata) : null]
    );
    return r.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM normalized_market_snapshots WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // latestByMarket(providerId, externalMarketId) → row | null
  async latestByMarket(providerId, externalMarketId) {
    const r = await db.query(
      'SELECT * FROM normalized_market_snapshots WHERE provider_id = $1 AND external_market_id = $2 ORDER BY received_at DESC LIMIT 1',
      [providerId, externalMarketId]
    );
    return r.rows[0] || null;
  },
};
