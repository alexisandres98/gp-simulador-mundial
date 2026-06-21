// mappingRepository.js — provider_event_mappings + provider_market_mappings (Sprint 2). SQL parametrizado.
// El motor de equivalencia es Sprint 2; aquí solo el acceso a datos centralizado.
'use strict';
const db = require('../client');

module.exports = {
  // ---- eventos ----
  // upsertEventMapping({ providerId, externalEventId, canonicalEventId?, mappingStatus?, equivalenceScore?, mappingMethod?, mappingVersion?, reviewedBy?, metadata? }) → row
  async upsertEventMapping(m) {
    const r = await db.query(
      `INSERT INTO provider_event_mappings
         (provider_id, external_event_id, canonical_event_id, mapping_status, equivalence_score, mapping_method, mapping_version, reviewed_by, metadata)
       VALUES ($1,$2,$3,COALESCE($4,'needs_review'),$5,$6,COALESCE($7,'v0'),$8,COALESCE($9,'{}'::jsonb))
       ON CONFLICT (provider_id, external_event_id, mapping_version) DO UPDATE SET
         canonical_event_id = EXCLUDED.canonical_event_id, mapping_status = EXCLUDED.mapping_status,
         equivalence_score = EXCLUDED.equivalence_score, mapping_method = EXCLUDED.mapping_method,
         reviewed_by = EXCLUDED.reviewed_by, metadata = EXCLUDED.metadata
       RETURNING *`,
      [m.providerId, m.externalEventId, m.canonicalEventId || null, m.mappingStatus || null, m.equivalenceScore ?? null,
       m.mappingMethod || null, m.mappingVersion || null, m.reviewedBy || null, m.metadata ? JSON.stringify(m.metadata) : null]
    );
    return r.rows[0];
  },
  async findEventMapping(providerId, externalEventId, mappingVersion = 'v0') {
    const r = await db.query('SELECT * FROM provider_event_mappings WHERE provider_id = $1 AND external_event_id = $2 AND mapping_version = $3', [providerId, externalEventId, mappingVersion]);
    return r.rows[0] || null;
  },

  // ---- mercados ----
  // upsertMarketMapping({ providerId, externalMarketId, canonicalMarketId?, mappingStatus?, equivalenceScore?, mappingMethod?, mappingVersion?, rulesSnapshot?, reviewedBy?, metadata? }) → row
  async upsertMarketMapping(m) {
    const r = await db.query(
      `INSERT INTO provider_market_mappings
         (provider_id, external_market_id, canonical_market_id, mapping_status, equivalence_score, mapping_method, mapping_version, rules_snapshot, reviewed_by, metadata)
       VALUES ($1,$2,$3,COALESCE($4,'needs_review'),$5,$6,COALESCE($7,'v0'),$8,$9,COALESCE($10,'{}'::jsonb))
       ON CONFLICT (provider_id, external_market_id, mapping_version) DO UPDATE SET
         canonical_market_id = EXCLUDED.canonical_market_id, mapping_status = EXCLUDED.mapping_status,
         equivalence_score = EXCLUDED.equivalence_score, mapping_method = EXCLUDED.mapping_method,
         rules_snapshot = EXCLUDED.rules_snapshot, reviewed_by = EXCLUDED.reviewed_by, metadata = EXCLUDED.metadata
       RETURNING *`,
      [m.providerId, m.externalMarketId, m.canonicalMarketId || null, m.mappingStatus || null, m.equivalenceScore ?? null,
       m.mappingMethod || null, m.mappingVersion || null, m.rulesSnapshot ? JSON.stringify(m.rulesSnapshot) : null,
       m.reviewedBy || null, m.metadata ? JSON.stringify(m.metadata) : null]
    );
    return r.rows[0];
  },
  async findMarketMapping(providerId, externalMarketId, mappingVersion = 'v0') {
    const r = await db.query('SELECT * FROM provider_market_mappings WHERE provider_id = $1 AND external_market_id = $2 AND mapping_version = $3', [providerId, externalMarketId, mappingVersion]);
    return r.rows[0] || null;
  },

  // ---- outcomes (Sprint 0.1) ----
  // upsertOutcomeMapping({ providerId, externalMarketId?, externalOutcomeId?, canonicalOutcomeId?, mappingStatus?, equivalenceScore?, mappingMethod?, mappingVersion?, reviewedBy?, metadata? }) → row
  async upsertOutcomeMapping(m) {
    const r = await db.query(
      `INSERT INTO provider_outcome_mappings
         (provider_id, external_market_id, external_outcome_id, canonical_outcome_id, mapping_status, equivalence_score, mapping_method, mapping_version, reviewed_by, metadata)
       VALUES ($1,$2,$3,$4,COALESCE($5,'needs_review'),$6,$7,COALESCE($8,'v0'),$9,COALESCE($10,'{}'::jsonb))
       ON CONFLICT (provider_id, external_market_id, external_outcome_id, mapping_version) DO UPDATE SET
         canonical_outcome_id = EXCLUDED.canonical_outcome_id, mapping_status = EXCLUDED.mapping_status,
         equivalence_score = EXCLUDED.equivalence_score, mapping_method = EXCLUDED.mapping_method,
         reviewed_by = EXCLUDED.reviewed_by, metadata = EXCLUDED.metadata
       RETURNING *`,
      [m.providerId, m.externalMarketId || null, m.externalOutcomeId || null, m.canonicalOutcomeId || null, m.mappingStatus || null,
       m.equivalenceScore ?? null, m.mappingMethod || null, m.mappingVersion || null, m.reviewedBy || null, m.metadata ? JSON.stringify(m.metadata) : null]
    );
    return r.rows[0];
  },
  async findOutcomeMapping(providerId, externalMarketId, externalOutcomeId, mappingVersion = 'v0') {
    const r = await db.query(
      'SELECT * FROM provider_outcome_mappings WHERE provider_id = $1 AND external_market_id IS NOT DISTINCT FROM $2 AND external_outcome_id IS NOT DISTINCT FROM $3 AND mapping_version = $4',
      [providerId, externalMarketId || null, externalOutcomeId || null, mappingVersion]
    );
    return r.rows[0] || null;
  },
};
