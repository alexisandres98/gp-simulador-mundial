// canonical-graph/repositories/graphRepository.js — acceso a datos del grafo canónico (Sprint 2).
// SQL parametrizado. Participantes/aliases, cola de revisión, historial de decisiones, conteos.
'use strict';
const db = require('../../database/client');
const { TEAMS } = require('../../data/tournament');
const aliases = require('../participantAliases');

module.exports = {
  // seedParticipants() — idempotente. Inserta las 48 selecciones + sus alias normalizados.
  async seedParticipants() {
    let participants = 0, aliasRows = 0;
    for (const t of TEAMS) {
      const canonical = t.en || t.name;
      const r = await db.query(
        `INSERT INTO canonical_participants (participant_type, canonical_name, short_name, country_code, sport, metadata)
         VALUES ('team',$1,$2,$3,'football',$4)
         ON CONFLICT (sport, canonical_name) DO UPDATE SET country_code = EXCLUDED.country_code, short_name = EXCLUDED.short_name
         RETURNING id`,
        [canonical, t.name, t.id, JSON.stringify({ flag: t.flag, group: t.group })]
      );
      participants++;
      const pid = r.rows[0].id;
      const all = [t.en, t.name, t.id, ...(t.aliases || []), ...((aliases.EXTRA_ALIASES[t.id]) || [])].filter(Boolean);
      const seen = new Set(); // dedup por equipo (el índice global validado exige unicidad de normalized_alias)
      for (const a of all) {
        const n = aliases.normalizeAlias(a);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        // ¿ya reclamado por otro equipo? (alias ambiguo) → skip conservador (no se asigna a dos equipos)
        const claimed = await db.query('SELECT 1 FROM participant_aliases WHERE normalized_alias=$1 AND provider_id IS NULL AND alias_type=$2 LIMIT 1', [n, 'validated']);
        if (claimed.rowCount) continue;
        const ins = await db.query(
          `INSERT INTO participant_aliases (canonical_participant_id, alias, normalized_alias, alias_type, confidence, source)
           VALUES ($1,$2,$3,'validated',1,'official_seed') RETURNING id`,
          [pid, a, n]
        );
        if (ins.rowCount) aliasRows++;
      }
    }
    return { participants, aliasRows };
  },

  // upsertReviewItem(item) → row. item: { entityType, providerA, providerB, externalIdA, externalIdB, candidatePayload, score, conflicts, evidence, priority }
  async upsertReviewItem(item) {
    const r = await db.query(
      `INSERT INTO mapping_review_queue (entity_type, provider_a, provider_b, external_id_a, external_id_b, candidate_payload, score, conflicts, evidence, priority, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0),'pending')
       ON CONFLICT (entity_type, provider_a, external_id_a, provider_b, external_id_b) DO UPDATE SET
         candidate_payload = EXCLUDED.candidate_payload, score = EXCLUDED.score, conflicts = EXCLUDED.conflicts,
         evidence = EXCLUDED.evidence, priority = EXCLUDED.priority, updated_at = now()
       RETURNING *`,
      [item.entityType, item.providerA || null, item.providerB || null, item.externalIdA || null, item.externalIdB || null,
       j(item.candidatePayload), num(item.score), j(item.conflicts), j(item.evidence), item.priority ?? null]
    );
    return r.rows[0];
  },

  // recordDecision(d) → row. d: { mappingEntityType, mappingEntityId?, previousStatus?, newStatus, previousScore?, newScore?, decisionSource, algorithmVersion?, reviewedBy?, reason?, evidence? }
  async recordDecision(d) {
    const r = await db.query(
      `INSERT INTO mapping_decision_history (mapping_entity_type, mapping_entity_id, previous_status, new_status, previous_score, new_score, decision_source, algorithm_version, reviewed_by, reason, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'auto'),$8,$9,$10,$11) RETURNING *`,
      [d.mappingEntityType, d.mappingEntityId || null, d.previousStatus || null, d.newStatus || null,
       num(d.previousScore), num(d.newScore), d.decisionSource || null, d.algorithmVersion || null,
       d.reviewedBy || null, d.reason || null, j(d.evidence)]
    );
    return r.rows[0];
  },

  // listReview(status, limit, offset) → rows (paginado)
  async listReview(status = 'pending', limit = 50, offset = 0) {
    const r = await db.query(
      'SELECT * FROM mapping_review_queue WHERE status = $1 ORDER BY priority DESC, created_at ASC LIMIT $2 OFFSET $3',
      [status, Math.min(limit, 200), offset]
    );
    return r.rows;
  },
  async getReviewItem(id) {
    const r = await db.query('SELECT * FROM mapping_review_queue WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  // decideReview(id, { decision, status, reviewedBy, notes }) → row
  async decideReview(id, { decision, status, reviewedBy, notes }) {
    const r = await db.query(
      `UPDATE mapping_review_queue SET status = COALESCE($2,status), decision = $3, reviewed_by = $4, notes = $5, reviewed_at = now()
       WHERE id = $1 RETURNING *`,
      [id, status || null, decision || null, reviewedBy || null, notes || null]
    );
    return r.rows[0] || null;
  },

  // statusCounts() → conteos para el status admin
  async statusCounts() {
    const r = await db.query(`SELECT
      (SELECT count(*)::int FROM canonical_participants) AS participants,
      (SELECT count(*)::int FROM participant_aliases) AS aliases,
      (SELECT count(*)::int FROM mapping_review_queue WHERE status='pending') AS review_pending,
      (SELECT count(*)::int FROM mapping_review_queue WHERE status='approved') AS review_approved,
      (SELECT count(*)::int FROM mapping_review_queue WHERE status='rejected') AS review_rejected,
      (SELECT count(*)::int FROM provider_event_mappings WHERE mapping_status='matched') AS events_matched,
      (SELECT count(*)::int FROM provider_market_mappings WHERE mapping_status='matched') AS markets_matched,
      (SELECT count(*)::int FROM provider_outcome_mappings WHERE mapping_status='matched') AS outcomes_matched,
      (SELECT count(*)::int FROM provider_market_rule_snapshots) AS rule_snapshots,
      (SELECT count(*)::int FROM mapping_decision_history) AS decisions`);
    return r.rows[0];
  },
};
function j(v) { return v == null ? null : JSON.stringify(v); }
function num(v) { return (v === undefined || v === null) ? null : String(v); }
