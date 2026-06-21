// catalogRepository.js — provider_market_catalog (Sprint 1). SQL parametrizado.
// Catálogo ligero de mercados externos descubiertos. NO es el mercado canónico.
'use strict';
const db = require('../../database/client');

module.exports = {
  // upsertMarket(m) → row. Inserta o actualiza last_seen_at/status/título/cierre. NO borra mercados que dejan de verse.
  async upsertMarket(m) {
    const r = await db.query(
      `INSERT INTO provider_market_catalog
         (provider_id, external_event_id, external_market_id, title, description, market_type_raw, status,
          start_time, close_time, settlement_time, resolution_source, rules_url, raw_metadata, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'unknown'),$8,$9,$10,$11,$12,COALESCE($13,'{}'::jsonb),now())
       ON CONFLICT (provider_id, external_market_id) DO UPDATE SET
         external_event_id = COALESCE(EXCLUDED.external_event_id, provider_market_catalog.external_event_id),
         title = COALESCE(EXCLUDED.title, provider_market_catalog.title),
         description = COALESCE(EXCLUDED.description, provider_market_catalog.description),
         market_type_raw = COALESCE(EXCLUDED.market_type_raw, provider_market_catalog.market_type_raw),
         status = EXCLUDED.status,
         start_time = COALESCE(EXCLUDED.start_time, provider_market_catalog.start_time),
         close_time = COALESCE(EXCLUDED.close_time, provider_market_catalog.close_time),
         settlement_time = COALESCE(EXCLUDED.settlement_time, provider_market_catalog.settlement_time),
         resolution_source = COALESCE(EXCLUDED.resolution_source, provider_market_catalog.resolution_source),
         rules_url = COALESCE(EXCLUDED.rules_url, provider_market_catalog.rules_url),
         raw_metadata = EXCLUDED.raw_metadata,
         last_seen_at = now()
       RETURNING *`,
      [m.providerId, m.externalEventId || null, m.externalMarketId, m.title || null, m.description || null,
       m.marketTypeRaw || null, m.status || null, m.startTime || null, m.closeTime || null, m.settlementTime || null,
       m.resolutionSource || null, m.rulesUrl || null, m.rawMetadata ? JSON.stringify(m.rawMetadata) : null]
    );
    return r.rows[0];
  },
  // listTracked(providerId, limit) → row[]  (mercados activos/no cerrados primero)
  async listTracked(providerId, limit = 200) {
    const r = await db.query(
      "SELECT * FROM provider_market_catalog WHERE provider_id = $1 AND status <> 'settled' ORDER BY last_seen_at DESC LIMIT $2",
      [providerId, limit]
    );
    return r.rows;
  },
  async countByProvider(providerId) {
    const r = await db.query('SELECT count(*)::int n FROM provider_market_catalog WHERE provider_id = $1', [providerId]);
    return r.rows[0].n;
  },
};
