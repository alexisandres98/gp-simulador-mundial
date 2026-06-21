// rawSnapshotRepository.js — raw_market_snapshots. Inmutable tras insertar. SQL parametrizado.
// IMPORTANTE: insert() SIEMPRE inserta (cada observación temporal es válida aunque el checksum se
// repita). El checksum se calcula del CONTENIDO (excluye received_at/secretos) y NO se usa para
// deduplicar/borrar observaciones. Ver sprint-0-data-policies.md y migración 005.
'use strict';
const db = require('../client');
const { computeChecksum } = require('../checksum');

module.exports = {
  // insert({ providerId, externalEventId?, externalMarketId?, externalOutcomeId?, payload, providerTimestamp?,
  //          requestLatencyMs?, ingestionRunId?, checksum? }) → row
  // Si no se pasa checksum, se calcula determinísticamente del payload (contenido estable).
  async insert(s) {
    const checksum = s.checksum || (s.payload != null ? computeChecksum(s.payload) : null);
    const r = await db.query(
      `INSERT INTO raw_market_snapshots
         (provider_id, external_event_id, external_market_id, external_outcome_id, payload,
          provider_timestamp, request_latency_ms, ingestion_run_id, checksum)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [s.providerId, s.externalEventId || null, s.externalMarketId || null, s.externalOutcomeId || null,
       JSON.stringify(s.payload), s.providerTimestamp || null, s.requestLatencyMs ?? null,
       s.ingestionRunId || null, checksum]
    );
    return r.rows[0];
  },
  async findById(id) {
    const r = await db.query('SELECT * FROM raw_market_snapshots WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // existsByChecksum(providerId, checksum) → boolean (idempotencia / dedup)
  async existsByChecksum(providerId, checksum) {
    if (!checksum) return false;
    const r = await db.query('SELECT 1 FROM raw_market_snapshots WHERE provider_id = $1 AND checksum = $2 LIMIT 1', [providerId, checksum]);
    return r.rowCount > 0;
  },
  // latestByMarket(providerId, externalMarketId) → row | null
  async latestByMarket(providerId, externalMarketId) {
    const r = await db.query(
      'SELECT * FROM raw_market_snapshots WHERE provider_id = $1 AND external_market_id = $2 ORDER BY received_at DESC LIMIT 1',
      [providerId, externalMarketId]
    );
    return r.rows[0] || null;
  },
};
