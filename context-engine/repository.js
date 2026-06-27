// context-engine/repository.js — Fase M.2. Acceso a la data layer de contexto/V2 (migración 033).
// INERTE por defecto (CONTEXT_ENGINE_ENABLED=false): nada llama a esto desde el pipeline oficial todavía.
// Refuerza ANTI-LEAKAGE tanto al ESCRIBIR (applied_impact=0 si no es point-in-time elegible) como al LEER
// (listEligibleObservations descarta cualquier observación posterior al cutoff). NO toca V1/Registry/Picks.
'use strict';
const db = require('../database/client');
const prov = require('./provenance');
const tstamp = require('./timestamps');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
function enabled() { return bool(process.env.CONTEXT_ENGINE_ENABLED, false); }
const DEFAULT_POLICY_VERSION = process.env.CONTEXT_POLICY_VERSION || 'context-policy-1';

// Inserta una observación de contexto (append-only). Calcula evidence_hash y el applied_impact respetando el
// cutoff point-in-time + la policy del factor. Si no es elegible (sin timestamp o posterior al cutoff) → impacto 0.
async function recordObservation(obs, { cutoff = null, policy = {}, now = null, client = db } = {}) {
  const klass = prov.classify(obs.fact_or_inference);
  const nowIso = now || new Date().toISOString();
  // jerarquía de timestamps (N.2): first_seen_at = ahora si no viene (1er ingreso real); nunca se backdatea.
  const firstSeen = tstamp.reconcileFirstSeen(obs.first_seen_at, nowIso);
  const tsObs = { ...obs, first_seen_at: firstSeen };
  const quality = tstamp.classifyTimestamp(tsObs);
  let eff = prov.effectiveImpact({ ...obs, fact_or_inference: klass }, cutoff, policy);
  // FORWARD-ONLY: si el único timestamp es de ingesta/manual, exigir usabilidad point-in-time por first_seen_at.
  const pit = cutoff != null ? tstamp.usableAt(tsObs, cutoff) : { usable: true, quality, confidence: 0 };
  if (!pit.usable && !eff.blocked) { eff = { ...eff, applied_impact: 0, blocked: true, reason: pit.reason }; }
  const tconf = pit.confidence != null ? pit.confidence : (tstamp.QUALITY_CONFIDENCE[quality] || 0);
  const evidence = obs.evidence_hash || prov.evidenceHash(obs);
  const r = await client.query(
    `INSERT INTO context_observations
       (ingestion_run_id, context_policy_version, factor_code, category, subject_type, subject_id, canonical_event_id,
        source_type, source_name, source_reference, observed_at, published_at, valid_from, valid_until, confidence,
        fact_or_inference, direction, raw_value, normalized_value, proposed_impact, applied_impact, reason,
        evidence_hash, cutoff_at, timestamp_quality, timestamp_confidence, first_seen_at, last_seen_at, provider_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,
    [obs.ingestion_run_id || null, obs.context_policy_version || DEFAULT_POLICY_VERSION, obs.factor_code,
     obs.category || null, obs.subject_type, obs.subject_id || null, obs.canonical_event_id || null,
     obs.source_type || 'provider', obs.source_name, obs.source_reference || null,
     obs.observed_at || null, obs.published_at || null, obs.valid_from || null, obs.valid_until || null,
     Number(obs.confidence) || 0, klass, obs.direction || null,
     obs.raw_value != null ? JSON.stringify(obs.raw_value) : null, obs.normalized_value ?? null,
     Number(obs.proposed_impact) || 0, eff.applied_impact, eff.blocked ? `blocked:${eff.reason}` : (obs.reason || 'applied'),
     evidence, cutoff || null, quality, tconf, firstSeen, nowIso, obs.provider_updated_at || null]);
  return { row: r.rows[0], applied_impact: eff.applied_impact, blocked: eff.blocked, reason: eff.reason, timestamp_quality: quality };
}

// candidate V2 SHADOW (hipotético; nunca oficial).
async function recordShadowCandidate(c, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO v2_shadow_candidates
       (v2_snapshot_id,canonical_event_id,market_code,period_code,outcome,gp_probability,consensus_probability,
        best_decimal_odds,adjusted_edge_pp,adjusted_ev,uncertainty,classification,context_state,cutoff_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.v2_snapshot_id || null, c.canonical_event_id || null, c.market_code || '1X2', c.period_code || 'REGULATION',
     c.outcome, c.gp_probability ?? null, c.consensus_probability ?? null, c.best_decimal_odds ?? null,
     c.adjusted_edge_pp ?? null, c.adjusted_ev ?? null, c.uncertainty ?? null, c.classification || null,
     c.context_state || null, c.cutoff_at || null]);
  return r.rows[0];
}

// Lee SOLO observaciones elegibles point-in-time para un evento y cutoff (anti-leakage en lectura).
// Filtra en SQL por timestamp <= cutoff y re-verifica con la lógica pura (defensa en profundidad).
async function listEligibleObservations({ canonicalEventId, cutoff, client = db } = {}) {
  const rows = (await client.query(
    `SELECT * FROM context_observations
       WHERE canonical_event_id = $1
         AND COALESCE(published_at, observed_at) IS NOT NULL
         AND GREATEST(COALESCE(published_at, observed_at), COALESCE(observed_at, published_at)) <= $2
       ORDER BY factor_code, created_at DESC`, [canonicalEventId, cutoff])).rows;
  return rows.filter(o => prov.pointInTimeEligible(o, cutoff).eligible);
}

async function recordEvaluationRun(run, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO context_evaluation_runs
       (canonical_event_id, context_policy_version, factor_policy_version, cutoff_at, observation_count,
        applied_factor_count, context_state, context_completeness, data_freshness, missing_critical_inputs, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [run.canonical_event_id || null, run.context_policy_version || DEFAULT_POLICY_VERSION, run.factor_policy_version || null,
     run.cutoff_at || null, run.observation_count || 0, run.applied_factor_count || 0,
     run.context_state || 'BASE_ONLY_FALLBACK', run.context_completeness ?? null, run.data_freshness ?? null,
     JSON.stringify(run.missing_critical_inputs || []), run.notes || null]);
  return r.rows[0];
}

// Snapshot V2 idempotente por input_hash (misma entrada → mismo snapshot, no duplica).
async function recordV2Snapshot(snap, { client = db } = {}) {
  const ins = await client.query(
    `INSERT INTO v2_probability_snapshots
       (context_evaluation_run_id, canonical_event_id, market_code, period_code, model_family, model_version,
        context_policy_version, calibration_version, base_probability_vector, context_adjustments,
        pre_uncertainty_vector, final_probability_vector, confidence, uncertainty, data_freshness,
        context_completeness, source_count, factor_count, missing_critical_inputs, context_state, cutoff_at, input_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
    [snap.context_evaluation_run_id || null, snap.canonical_event_id || null, snap.market_code || '1X2',
     snap.period_code || 'REGULATION', snap.model_family || 'GP_INTELLIGENCE_V2', snap.model_version,
     snap.context_policy_version || DEFAULT_POLICY_VERSION, snap.calibration_version || null,
     JSON.stringify(snap.base_probability_vector || null), JSON.stringify(snap.context_adjustments || null),
     JSON.stringify(snap.pre_uncertainty_vector || null), JSON.stringify(snap.final_probability_vector || null),
     snap.confidence ?? null, snap.uncertainty ?? null, snap.data_freshness ?? null, snap.context_completeness ?? null,
     snap.source_count || 0, snap.factor_count || 0, JSON.stringify(snap.missing_critical_inputs || []),
     snap.context_state || 'BASE_ONLY_FALLBACK', snap.cutoff_at || null, snap.input_hash]);
  if (ins.rows[0]) return { row: ins.rows[0], idempotent: false };
  const ex = await client.query(`SELECT * FROM v2_probability_snapshots WHERE input_hash=$1`, [snap.input_hash]);
  return { row: ex.rows[0], idempotent: true };
}

async function upsertSource(src, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO contextual_source_catalog
       (source_key, source_name, source_type, categories, base_url, has_source_timestamps, national_team_coverage,
        license_note, quota_note, verification_status, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (source_key) DO UPDATE SET source_name=EXCLUDED.source_name, source_type=EXCLUDED.source_type,
       categories=EXCLUDED.categories, base_url=EXCLUDED.base_url, has_source_timestamps=EXCLUDED.has_source_timestamps,
       national_team_coverage=EXCLUDED.national_team_coverage, license_note=EXCLUDED.license_note,
       quota_note=EXCLUDED.quota_note, verification_status=EXCLUDED.verification_status, is_active=EXCLUDED.is_active,
       version=contextual_source_catalog.version+1 RETURNING *`,
    [src.source_key, src.source_name, src.source_type, JSON.stringify(src.categories || []), src.base_url || null,
     !!src.has_source_timestamps, src.national_team_coverage || 'unknown', src.license_note || null,
     src.quota_note || null, src.verification_status || 'unverified', src.is_active !== false]);
  return r.rows[0];
}

async function upsertFactorPolicy(p, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO factor_policy_versions
       (context_policy_version, factor_code, category, subject_type, max_logit_delta, max_category_logit_delta,
        confidence_weight, decay_half_life_ms, min_sample_size, fact_required, default_impact, enabled,
        effective_from, effective_to, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (context_policy_version, factor_code) DO UPDATE SET category=EXCLUDED.category,
       subject_type=EXCLUDED.subject_type, max_logit_delta=EXCLUDED.max_logit_delta,
       max_category_logit_delta=EXCLUDED.max_category_logit_delta, confidence_weight=EXCLUDED.confidence_weight,
       decay_half_life_ms=EXCLUDED.decay_half_life_ms, min_sample_size=EXCLUDED.min_sample_size,
       fact_required=EXCLUDED.fact_required, default_impact=EXCLUDED.default_impact, enabled=EXCLUDED.enabled,
       effective_from=EXCLUDED.effective_from, effective_to=EXCLUDED.effective_to, notes=EXCLUDED.notes RETURNING *`,
    [p.context_policy_version || DEFAULT_POLICY_VERSION, p.factor_code, p.category, p.subject_type || 'team',
     p.max_logit_delta || 0, p.max_category_logit_delta || 0, p.confidence_weight ?? 1, p.decay_half_life_ms ?? null,
     p.min_sample_size || 0, !!p.fact_required, p.default_impact || 0, !!p.enabled,
     p.effective_from || null, p.effective_to || null, p.notes || null]);
  return r.rows[0];
}

module.exports = {
  enabled, DEFAULT_POLICY_VERSION,
  recordObservation, listEligibleObservations, recordEvaluationRun, recordV2Snapshot, recordShadowCandidate, upsertSource, upsertFactorPolicy,
};
