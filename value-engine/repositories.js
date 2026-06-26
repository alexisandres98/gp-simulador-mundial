// value-engine/repositories.js — Sprint 7. DB del Value Engine + Picks. SQL parametrizado.
'use strict';
const db = require('../database/client');
const jsonOr = v => (v == null ? null : JSON.stringify(v));
const numOr = v => (v === undefined || v === null || v === '') ? null : String(v);
const uuidOrNull = v => (/^[0-9a-f-]{36}$/i.test(String(v || '')) ? v : null);

const evaluations = {
  async insert(e, client = db) {
    const r = await client.query(
      `INSERT INTO value_evaluations
        (canonical_event_id, canonical_market_id, canonical_outcome_id, selection, classification,
         gp_probability, gp_calibrated_probability, sportsbook_consensus_probability, prediction_market_probability, sharp_reference_probability,
         ensemble_probability, conservative_probability, best_price_type, best_decimal_odds, best_prediction_market_price,
         break_even_probability, fair_odds, conservative_fair_odds, minimum_acceptable_odds, maximum_acceptable_price,
         raw_edge_pp, adjusted_edge_pp, raw_ev, adjusted_ev, uncertainty_score, quality_score, source_count, independence_group_count,
         input_snapshot_ids, mapping_version, rules_version, model_version, ensemble_version, no_vig_version, classification_version,
         input_hash, rejection_reasons, warnings, strong_blockers, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
         COALESCE($29,'[]'::jsonb),$30,$31,$32,$33,$34,$35,$36,COALESCE($37,'[]'::jsonb),COALESCE($38,'[]'::jsonb),COALESCE($39,'[]'::jsonb),$40)
       ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
      [uuidOrNull(e.canonical_event_id), uuidOrNull(e.canonical_market_id), e.canonical_outcome_id, e.selection, e.classification,
       numOr(e.gp_probability), numOr(e.gp_calibrated_probability), numOr(e.sportsbook_consensus_probability), numOr(e.prediction_market_probability), numOr(e.sharp_reference_probability),
       numOr(e.ensemble_probability), numOr(e.conservative_probability), e.best_price_type, numOr(e.best_decimal_odds), numOr(e.best_prediction_market_price),
       numOr(e.break_even_probability), numOr(e.fair_odds), numOr(e.conservative_fair_odds), numOr(e.minimum_acceptable_odds), numOr(e.maximum_acceptable_price),
       numOr(e.raw_edge_pp), numOr(e.adjusted_edge_pp), numOr(e.raw_ev), numOr(e.adjusted_ev), e.uncertainty_score, e.quality_score, e.source_count, e.independence_group_count,
       jsonOr(e.input_snapshot_ids), e.mapping_version, e.rules_version, e.model_version, e.ensemble_version, e.no_vig_version, e.classification_version,
       e.input_hash, jsonOr(e.rejection_reasons), jsonOr(e.warnings), jsonOr(e.strong_blockers), jsonOr(e._detail || e.detail)]
    );
    return r.rows[0] || (await client.query('SELECT * FROM value_evaluations WHERE input_hash=$1', [e.input_hash])).rows[0];
  },
  async byId(id) { return (await db.query('SELECT * FROM value_evaluations WHERE id=$1', [id])).rows[0] || null; },
  async recent({ classification = null, limit = 50 } = {}) {
    const w = classification ? 'WHERE ve.classification=$2' : '';
    const p = classification ? [Math.min(limit, 200), classification] : [Math.min(limit, 200)];
    // join nombres del evento canónico para el admin preview (home/away)
    return (await db.query(`SELECT ve.*, ce.home_participant, ce.away_participant FROM value_evaluations ve
      LEFT JOIN canonical_events ce ON ce.id=ve.canonical_event_id ${w} ORDER BY ve.created_at DESC LIMIT $1`, p)).rows;
  },
  async counts() {
    return (await db.query(`SELECT classification, count(*)::int n FROM value_evaluations GROUP BY 1`)).rows;
  },
};

const opportunities = {
  async upsert(o, client = db) {
    const r = await client.query(
      `INSERT INTO value_opportunities (opportunity_key, canonical_event_id, canonical_market_id, canonical_outcome_id, selection, status, current_evaluation_id, best_adjusted_ev, best_adjusted_edge_pp, best_decimal_odds, last_validated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (opportunity_key) DO UPDATE SET
         status=EXCLUDED.status, current_evaluation_id=EXCLUDED.current_evaluation_id, last_seen_at=now(), last_validated_at=now(),
         observation_count=value_opportunities.observation_count+1,
         best_adjusted_ev=GREATEST(COALESCE(value_opportunities.best_adjusted_ev,'-9'),COALESCE(EXCLUDED.best_adjusted_ev,'-9')),
         best_adjusted_edge_pp=GREATEST(COALESCE(value_opportunities.best_adjusted_edge_pp,'-9'),COALESCE(EXCLUDED.best_adjusted_edge_pp,'-9')),
         best_decimal_odds=GREATEST(COALESCE(value_opportunities.best_decimal_odds,'0'),COALESCE(EXCLUDED.best_decimal_odds,'0'))
       RETURNING *`,
      [o.opportunity_key, uuidOrNull(o.canonical_event_id), uuidOrNull(o.canonical_market_id), o.canonical_outcome_id, o.selection, o.status, uuidOrNull(o.current_evaluation_id), numOr(o.best_adjusted_ev), numOr(o.best_adjusted_edge_pp), numOr(o.best_decimal_odds)]
    );
    return r.rows[0];
  },
  async byKey(key) { return (await db.query('SELECT * FROM value_opportunities WHERE opportunity_key=$1', [key])).rows[0] || null; },
};

const candidates = {
  async create(c, client = db) {
    const r = await client.query(
      `INSERT INTO pick_candidates (value_evaluation_id, value_opportunity_id, canonical_event_id, canonical_market_id, canonical_outcome_id, candidate_status, selection, market_label, observed_odds, minimum_acceptable_odds, observed_price, maximum_acceptable_price, sportsbook_code, deep_link, signal_quality, uncertainty_score, context_status, candidate_reason, blocking_reasons)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'pending_review'),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,COALESCE($18,'[]'::jsonb),COALESCE($19,'[]'::jsonb)) RETURNING *`,
      [uuidOrNull(c.value_evaluation_id), uuidOrNull(c.value_opportunity_id), uuidOrNull(c.canonical_event_id), uuidOrNull(c.canonical_market_id), c.canonical_outcome_id, c.candidate_status, c.selection, c.market_label, numOr(c.observed_odds), numOr(c.minimum_acceptable_odds), numOr(c.observed_price), numOr(c.maximum_acceptable_price), c.sportsbook_code, c.deep_link, c.signal_quality, c.uncertainty_score, c.context_status, jsonOr(c.candidate_reason), jsonOr(c.blocking_reasons)]
    );
    return r.rows[0];
  },
  async byId(id) { return (await db.query('SELECT * FROM pick_candidates WHERE id=$1', [id])).rows[0] || null; },
  async list({ status = null, limit = 100 } = {}) {
    const w = status ? 'WHERE candidate_status=$2' : ''; const p = status ? [Math.min(limit, 200), status] : [Math.min(limit, 200)];
    return (await db.query(`SELECT * FROM pick_candidates ${w} ORDER BY created_at DESC LIMIT $1`, p)).rows;
  },
  async setStatus(id, status, client = db) { await client.query('UPDATE pick_candidates SET candidate_status=$2 WHERE id=$1', [id, status]); },
};

const publications = {
  async create(p, client = db) {
    const r = await client.query(
      `INSERT INTO pick_publications (pick_candidate_id, value_evaluation_id, public_id, publication_status, selection, event_label, market_label, period, observed_odds, minimum_acceptable_odds, current_odds, observed_price, maximum_acceptable_price, sportsbook_code, deep_link, signal_id, public_payload, rationale, reviewed_by, published_at)
       VALUES ($1,$2,$3,COALESCE($4,'published'),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [uuidOrNull(p.pick_candidate_id), uuidOrNull(p.value_evaluation_id), p.public_id, p.publication_status, p.selection, p.event_label, p.market_label, p.period, numOr(p.observed_odds), numOr(p.minimum_acceptable_odds), numOr(p.current_odds), numOr(p.observed_price), numOr(p.maximum_acceptable_price), p.sportsbook_code, p.deep_link, uuidOrNull(p.signal_id), jsonOr(p.public_payload), p.rationale, p.reviewed_by, p.published_at]
    );
    return r.rows[0];
  },
  async byId(id) { return (await db.query('SELECT * FROM pick_publications WHERE id=$1', [id])).rows[0] || null; },
  async byPublicId(id) { return (await db.query('SELECT * FROM pick_publications WHERE public_id=$1', [id])).rows[0] || null; },
  async update(id, patch, client = db) {
    const cols = { publication_status: patch.status, current_odds: numOr(patch.current_odds), closed_at: patch.closed_at, withdrawn_at: patch.withdrawn_at, unpublication_reason: patch.reason, rationale: patch.rationale };
    const set = [], p = [];
    for (const [k, v] of Object.entries(cols)) if (v !== undefined) { p.push(v); set.push(`${k}=$${p.length}`); }
    if (!set.length) return;
    p.push(id); await client.query(`UPDATE pick_publications SET ${set.join(',')} WHERE id=$${p.length}`, p);
  },
  async listPublic({ limit = 50 } = {}) {
    return (await db.query(`SELECT * FROM pick_publications WHERE publication_status IN ('published','price_moved','closed','settlement_pending','settled','void','disputed') ORDER BY published_at DESC NULLS LAST LIMIT $1`, [Math.min(limit, 100)])).rows;
  },
  async counts() {
    return (await db.query(`SELECT publication_status, count(*)::int n FROM pick_publications GROUP BY 1`)).rows;
  },
};

const history = {
  async insert(h, client = db) {
    await client.query(`INSERT INTO pick_publication_history (publication_id, previous_status, new_status, action, actor_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'{}'::jsonb))`,
      [h.publication_id, h.previous_status || null, h.new_status || null, h.action, h.actor_id || null, h.reason || null, jsonOr(h.metadata)]);
  },
  async forPublication(id) { return (await db.query('SELECT * FROM pick_publication_history WHERE publication_id=$1 ORDER BY created_at ASC', [id])).rows; },
};

module.exports = { evaluations, opportunities, candidates, publications, history };
