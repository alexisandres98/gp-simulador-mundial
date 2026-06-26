// signal-registry/repositories.js — Sprint 5. Acceso a DB del registro (parametrizado). Tablas inmutables:
// solo INSERT (UPDATE/DELETE bloqueado por triggers). signal_state_projection es la única mutable.
'use strict';
const db = require('../database/client');
const jsonOr = v => (v == null ? null : JSON.stringify(v));
const numOr = v => (v === undefined || v === null || v === '') ? null : String(v);
const uuidOrNull = v => (/^[0-9a-f-]{36}$/i.test(String(v || '')) ? v : null);

// ---------- signals (inmutable) ----------
const signals = {
  // chainHead(client) → { chain_position, registry_hash } del último, o null. Llamar con lock tomado.
  async chainHead(client = db) {
    const r = await client.query('SELECT chain_position, registry_hash FROM signals WHERE chain_position IS NOT NULL ORDER BY chain_position DESC LIMIT 1');
    return r.rows[0] || null;
  },
  async insert(s, client = db) {
    const r = await client.query(
      `INSERT INTO signals
        (signal_type, signal_schema_version, public_id, visibility, registry_status, verification_status,
         score_eligible, experimental, legacy, canonical_event_id, canonical_market_id, canonical_outcome_id,
         direction, event_start_at, market_close_at, source_created_at, published_at, locked_at, input_cutoff_at,
         model_version, methodology_version, mapping_version, rules_version, normalizer_version,
         signal_payload, public_payload, snapshot_ids, content_hash, previous_registry_hash, registry_hash,
         chain_position, prediction_edition, supersedes_signal_id, status, metadata)
       VALUES ($1,$2,$3,COALESCE($4,'internal'),COALESCE($5,'registered'),COALESCE($6,'verified'),
         $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
         COALESCE($25,'{}'::jsonb),$26,COALESCE($27::uuid[],'{}'::uuid[]),$28,$29,$30,$31,$32,$33,'published',COALESCE($34,'{}'::jsonb))
       RETURNING *`,
      [s.signal_type, s.signal_schema_version, s.public_id, s.visibility, s.registry_status, s.verification_status,
       !!s.score_eligible, !!s.experimental, !!s.legacy, uuidOrNull(s.canonical_event_id), uuidOrNull(s.canonical_market_id), uuidOrNull(s.canonical_outcome_id),
       s.direction || null, s.event_start_at || null, s.market_close_at || null, s.source_created_at || null, s.published_at, s.locked_at, s.input_cutoff_at || null,
       s.model_version || null, s.methodology_version || null, s.mapping_version || null, s.rules_version || null, s.normalizer_version || null,
       jsonOr(s.signal_payload), jsonOr(s.public_payload), s.snapshot_ids || [], s.content_hash, s.previous_registry_hash, s.registry_hash,
       s.chain_position, s.prediction_edition || null, uuidOrNull(s.supersedes_signal_id), jsonOr(s.metadata)]
    );
    return r.rows[0];
  },
  async byPublicId(publicId) { const r = await db.query('SELECT * FROM signals WHERE public_id=$1', [publicId]); return r.rows[0] || null; },
  async byId(id) { const r = await db.query('SELECT * FROM signals WHERE id=$1', [id]); return r.rows[0] || null; },
  async list({ signalType = null, verification = null, scoreEligible = null, limit = 50, offset = 0 } = {}) {
    const w = [], p = [];
    if (signalType) { p.push(signalType); w.push(`signal_type=$${p.length}`); }
    if (verification) { p.push(verification); w.push(`verification_status=$${p.length}`); }
    if (scoreEligible != null) { p.push(scoreEligible); w.push(`score_eligible=$${p.length}`); }
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    p.push(Math.min(limit, 200)); const lim = `$${p.length}`; p.push(Math.max(offset, 0)); const off = `$${p.length}`;
    const r = await db.query(`SELECT * FROM signals ${where} ORDER BY chain_position DESC NULLS LAST LIMIT ${lim} OFFSET ${off}`, p);
    return r.rows;
  },
  async allOrdered(client = db) { const r = await client.query('SELECT * FROM signals WHERE chain_position IS NOT NULL ORDER BY chain_position ASC'); return r.rows; },
  async rangeByDate(date) {
    const r = await db.query(
      `SELECT * FROM signals WHERE chain_position IS NOT NULL AND published_at::date = $1::date ORDER BY chain_position ASC`, [date]);
    return r.rows;
  },
};

// ---------- signal_events (inmutable, hash-linked por señal) ----------
const events = {
  async lastForSignal(signalId, client = db) {
    const r = await client.query('SELECT * FROM signal_events WHERE signal_id=$1 ORDER BY created_at DESC, event_version DESC LIMIT 1', [signalId]);
    return r.rows[0] || null;
  },
  async insert(e, client = db) {
    const r = await client.query(
      `INSERT INTO signal_events (signal_id, event_type, event_version, actor_type, actor_id, reason_code, event_payload, previous_event_hash, event_hash)
       VALUES ($1,$2,COALESCE($3,1),COALESCE($4,'system'),$5,$6,COALESCE($7,'{}'::jsonb),$8,$9) RETURNING *`,
      [e.signal_id, e.event_type, e.event_version, e.actor_type, e.actor_id || null, e.reason_code || null, jsonOr(e.event_payload), e.previous_event_hash || null, e.event_hash]
    );
    return r.rows[0];
  },
  async listForSignal(signalId) { const r = await db.query('SELECT * FROM signal_events WHERE signal_id=$1 ORDER BY created_at ASC, event_version ASC', [signalId]); return r.rows; },
};

// ---------- signal_source_references (inmutable) ----------
const sourceRefs = {
  async insert(ref, client = db) {
    const r = await client.query(
      `INSERT INTO signal_source_references (signal_id, source_type, source_id, source_version, provider_id, snapshot_timestamp, content_hash, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'{}'::jsonb)) RETURNING *`,
      [ref.signal_id, ref.source_type, ref.source_id || null, ref.source_version || null, uuidOrNull(ref.provider_id), ref.snapshot_timestamp || null, ref.content_hash || null, jsonOr(ref.metadata)]
    );
    return r.rows[0];
  },
  async listForSignal(signalId) { const r = await db.query('SELECT * FROM signal_source_references WHERE signal_id=$1 ORDER BY created_at ASC', [signalId]); return r.rows; },
};

// ---------- signal_settlements (inmutable, versionado) ----------
const settlements = {
  async latestVersion(signalId, client = db) { const r = await client.query('SELECT COALESCE(max(settlement_version),0)::int v FROM signal_settlements WHERE signal_id=$1', [signalId]); return r.rows[0].v; },
  async exists(signalId, source, sourceVersion) {
    const r = await db.query('SELECT 1 FROM signal_settlements WHERE signal_id=$1 AND settlement_source IS NOT DISTINCT FROM $2 AND source_reference IS NOT DISTINCT FROM $3 LIMIT 1', [signalId, source || null, sourceVersion || null]);
    return r.rowCount > 0;
  },
  async insert(s, client = db) {
    const r = await client.query(
      `INSERT INTO signal_settlements (signal_id, settlement_version, settlement_status, result_type, winning_outcome_id, event_result,
         settlement_source, source_reference, source_timestamp, settled_at, is_final, void_reason, correction_reason, realized_roi, settlement_payload, content_hash,
         result_outcome, provider_result_status, result_observed_at, result_finalized_at, regulation_score, settlement_policy_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,false),$12,$13,$14,COALESCE($15,'{}'::jsonb),$16,
         $17,$18,$19,$20,$21,$22) RETURNING *`,
      [s.signal_id, s.settlement_version, s.settlement_status, s.result_type || null, s.winning_outcome_id || null, jsonOr(s.event_result),
       s.settlement_source || null, s.source_reference || null, s.source_timestamp || null, s.settled_at || null, s.is_final, s.void_reason || null, s.correction_reason || null,
       numOr(s.realized_roi), jsonOr(s.settlement_payload), s.content_hash || null,
       s.result_outcome || null, s.provider_result_status || null, s.result_observed_at || null, s.result_finalized_at || null, jsonOr(s.regulation_score), s.settlement_policy_version || null]
    );
    return r.rows[0];
  },
  async listForSignal(signalId) { const r = await db.query('SELECT * FROM signal_settlements WHERE signal_id=$1 ORDER BY settlement_version ASC', [signalId]); return r.rows; },
};

// ---------- signal_closing_snapshots (inmutable) ----------
const closing = {
  async exists(signalId, benchmarkType) { const r = await db.query('SELECT 1 FROM signal_closing_snapshots WHERE signal_id=$1 AND benchmark_type=$2 LIMIT 1', [signalId, benchmarkType]); return r.rowCount > 0; },
  async insert(c, client = db) {
    const r = await client.query(
      `INSERT INTO signal_closing_snapshots (signal_id, benchmark_type, provider_id, external_market_id, external_outcome_id,
         best_bid, best_ask, midpoint, last_trade, executable_price, snapshot_id, observed_at, event_start_at, capture_status, capture_method, metadata,
         canonical_event_id, market, period, outcome, closing_odds, closing_probability, closing_source, provider_updated_at, kickoff_at, closing_status, closing_reason_code, closing_policy_version, clv_components)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,'captured'),$15,COALESCE($16,'{}'::jsonb),
         $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       ON CONFLICT (signal_id, benchmark_type) DO NOTHING RETURNING *`,
      [c.signal_id, c.benchmark_type, uuidOrNull(c.provider_id), c.external_market_id || null, c.external_outcome_id || null,
       numOr(c.best_bid), numOr(c.best_ask), numOr(c.midpoint), numOr(c.last_trade), numOr(c.executable_price), c.snapshot_id || null,
       c.observed_at || null, c.event_start_at || null, c.capture_status, c.capture_method || null, jsonOr(c.metadata),
       uuidOrNull(c.canonical_event_id), c.market || null, c.period || null, c.outcome || null, numOr(c.closing_odds), numOr(c.closing_probability),
       c.closing_source || null, c.provider_updated_at || null, c.kickoff_at || null, c.closing_status || null, c.closing_reason_code || null,
       c.closing_policy_version || null, jsonOr(c.clv_components)]
    );
    return r.rows[0] || null;
  },
  async listForSignal(signalId) { const r = await db.query('SELECT * FROM signal_closing_snapshots WHERE signal_id=$1 ORDER BY created_at ASC', [signalId]); return r.rows; },
};

// ---------- signal_registry_commitments (inmutable) ----------
const commitments = {
  async upsert(c, client = db) {
    const r = await client.query(
      `INSERT INTO signal_registry_commitments (commitment_date, first_chain_position, last_chain_position, signal_count, root_hash, algorithm)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'merkle-sha256-v1'))
       ON CONFLICT (commitment_date) DO NOTHING RETURNING *`,
      [c.commitment_date, c.first_chain_position, c.last_chain_position, c.signal_count, c.root_hash, c.algorithm]
    );
    return r.rows[0] || null;
  },
  async byDate(date) { const r = await db.query('SELECT * FROM signal_registry_commitments WHERE commitment_date=$1', [date]); return r.rows[0] || null; },
  async list({ limit = 60 } = {}) { const r = await db.query('SELECT * FROM signal_registry_commitments ORDER BY commitment_date DESC LIMIT $1', [Math.min(limit, 365)]); return r.rows; },
};

// ---------- signal_state_projection (MUTABLE) ----------
const projection = {
  async upsert(p, client = db) {
    await client.query(
      `INSERT INTO signal_state_projection (signal_id, current_status, verification_status, score_eligible, settlement_status, latest_settlement_version, closing_captured, last_event_type, last_event_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,false),$8,$9)
       ON CONFLICT (signal_id) DO UPDATE SET
         current_status=COALESCE(EXCLUDED.current_status, signal_state_projection.current_status),
         verification_status=COALESCE(EXCLUDED.verification_status, signal_state_projection.verification_status),
         score_eligible=EXCLUDED.score_eligible,
         settlement_status=COALESCE(EXCLUDED.settlement_status, signal_state_projection.settlement_status),
         latest_settlement_version=COALESCE(EXCLUDED.latest_settlement_version, signal_state_projection.latest_settlement_version),
         closing_captured=signal_state_projection.closing_captured OR EXCLUDED.closing_captured,
         last_event_type=COALESCE(EXCLUDED.last_event_type, signal_state_projection.last_event_type),
         last_event_at=COALESCE(EXCLUDED.last_event_at, signal_state_projection.last_event_at)`,
      [p.signal_id, p.current_status || null, p.verification_status || null, !!p.score_eligible, p.settlement_status || null, p.latest_settlement_version || null, p.closing_captured, p.last_event_type || null, p.last_event_at || null]
    );
  },
  async get(signalId) { const r = await db.query('SELECT * FROM signal_state_projection WHERE signal_id=$1', [signalId]); return r.rows[0] || null; },
};

async function statusCounts() {
  const r = await db.query(`SELECT
    (SELECT count(*)::int FROM signals) AS total,
    (SELECT count(*)::int FROM signals WHERE verification_status='verified') AS verified,
    (SELECT count(*)::int FROM signals WHERE verification_status='legacy_unverified') AS legacy,
    (SELECT count(*)::int FROM signals WHERE experimental) AS experimental,
    (SELECT count(*)::int FROM signals WHERE score_eligible) AS score_eligible,
    (SELECT count(*)::int FROM signal_state_projection WHERE settlement_status IS NULL OR settlement_status='pending') AS pending_settlement,
    (SELECT count(*)::int FROM signal_closing_snapshots WHERE capture_status='unavailable') AS closing_unavailable,
    (SELECT max(chain_position)::int FROM signals) AS chain_head,
    (SELECT count(*)::int FROM signal_registry_commitments) AS commitments`);
  return r.rows[0];
}

module.exports = { signals, events, sourceRefs, settlements, closing, commitments, projection, statusCounts };
