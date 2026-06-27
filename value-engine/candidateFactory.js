// value-engine/candidateFactory.js — Fase J §7-13. Genera CANDIDATES internos (no Picks) desde oportunidades
// STRONG operativas que pasaron TODOS los gates técnicos del Value Engine (NO se tocan thresholds ni reglas).
// Un candidate NO es Pick/señal/Registry/recomendación pública. Dedup por identidad natural; lifecycle + price
// state + readiness gate (incl. ESPN mapping y deep link). NUNCA llega a CONVERTED_TO_PICK en esta fase.
'use strict';
const db = require('../database/client');
const deepLinks = require('../sportsbook-providers/deepLinks');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const num = v => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const ms = v => { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); };

function flags() {
  return {
    enabled: bool(process.env.VALUE_ENGINE_ENABLED, false) && bool(process.env.VALUE_ENGINE_WRITE_ENABLED, false),
    minLeadMs: int(process.env.CANDIDATE_MIN_KICKOFF_LEAD_MS, 30 * 60 * 1000), // kickoff suficientemente futuro
    staleMs: int(process.env.SPORTSBOOK_MAX_QUOTE_AGE_MS, 600000),
    minGroups: int(process.env.VALUE_MIN_INDEPENDENCE_GROUPS, 3),
  };
}

// identidad natural (§13): misma oportunidad NO crea candidate nuevo por ciclo.
function dedupKey(ev) {
  return [ev.canonical_event_id, ev.market || '1x2', ev.period || 'regulation_90m', ev.selection || ev.outcome, ev.model_version || 'V1', ev.value_policy_version || ev.classification_version || 'value-1'].join('|');
}

// price state (§12) a partir de la mejor cuota actual vs mínima + frescura + inicio del evento.
function priceState({ currentOdds, minOdds, observedAt, now, kickoff, suspended }) {
  if (kickoff != null && now >= kickoff) return 'EVENT_STARTED';
  if (suspended) return 'SUSPENDED';
  if (currentOdds == null) return 'UNAVAILABLE';
  if (observedAt != null && (now - observedAt) > flags().staleMs) return 'STALE';
  if (minOdds == null) return 'AVAILABLE';
  if (currentOdds < minOdds) return 'BELOW_MINIMUM';
  if (Math.abs(currentOdds - minOdds) < 1e-9) return 'AT_MINIMUM';
  return 'ABOVE_MINIMUM';
}

// refresca la mejor cuota actual del outcome desde sportsbook_quote_current (no cambia la prob original).
async function priceRefresh(canonicalEventId, outcome, client = db) {
  const r = await client.query(
    `SELECT odds_decimal, sportsbook_code, provider_update, observed_at, quote_status, is_live
       FROM sportsbook_quote_current
      WHERE canonical_event_id=$1 AND market_family='1x2'
        AND (external_outcome_id=$2 OR external_outcome_id LIKE '%:'||$2)
      ORDER BY odds_decimal DESC NULLS LAST LIMIT 1`, [canonicalEventId, outcome]).catch(() => ({ rows: [] }));
  const row = r.rows[0];
  if (!row) return { currentOdds: null, best_sportsbook: null, observed_at: null, suspended: false };
  return { currentOdds: num(row.odds_decimal), best_sportsbook: row.sportsbook_code, observed_at: row.provider_update || row.observed_at, suspended: row.quote_status === 'suspended' || row.is_live === true };
}

// readiness gate (§8): un candidate solo alcanza READY_FOR_REVIEW si TODO está. Si falta algo → BLOCKED_* (nunca listo).
async function readiness(cand, ctx = {}) {
  const now = ctx.now || Date.now();
  const blockers = [];
  const cei = cand.canonical_event_id;
  if (cand.price_state === 'EVENT_STARTED' || (cand.kickoff_at && now >= ms(cand.kickoff_at))) blockers.push('BLOCKED_EVENT_STARTED');
  if (cand.kickoff_at && (ms(cand.kickoff_at) - now) < flags().minLeadMs && (ms(cand.kickoff_at) - now) > 0) blockers.push('BLOCKED_KICKOFF_TOO_SOON');
  if (cand.price_state === 'BELOW_MINIMUM') blockers.push('BLOCKED_PRICE_BELOW_MINIMUM');
  if (cand.price_state === 'STALE') blockers.push('BLOCKED_STALE_PRICE');
  if ((cand.verified_independence_group_count || 0) < flags().minGroups) blockers.push('BLOCKED_INSUFFICIENT_GROUPS');
  if (!cei) blockers.push('BLOCKED_MISSING_CANONICAL');
  else {
    const espn = (await db.query(`SELECT 1 FROM signal_event_fixture_mappings WHERE canonical_event_id=$1 AND review_status='approved'`, [cei])).rows[0];
    if (!espn) blockers.push('BLOCKED_MISSING_ESPN_MAPPING');
  }
  if (!cand.deep_link) blockers.push('BLOCKED_MISSING_DEEP_LINK');
  // Registry + Metrics health
  const reg = await require('../signal-registry/registryAdmin').health().catch(() => null);
  if (!reg || (reg.audit_chain && reg.audit_chain.ok === false) || reg.product_kill_switch === true) blockers.push('BLOCKED_REGISTRY_UNHEALTHY');
  if (!bool(process.env.METRICS_ENGINE_ENABLED, false)) blockers.push('BLOCKED_METRICS_UNHEALTHY');
  return { ready: blockers.length === 0, blockers };
}

function lifecycleFor(priceSt, ready, blockers) {
  if (priceSt === 'EVENT_STARTED') return 'EXPIRED';
  if (ready) return 'READY_FOR_REVIEW';
  if (priceSt === 'BELOW_MINIMUM') return 'PRICE_BELOW_MINIMUM';
  if (priceSt === 'STALE') return 'STALE';
  if (priceSt === 'SUSPENDED') return 'SUSPENDED';
  return 'BLOCKED';
}

// procesa UNA evaluación STRONG → crea/actualiza candidate. Idempotente por dedup_key.
async function processStrong(ev, ctx = {}) {
  const now = ctx.now || Date.now();
  const outcome = ev.selection || ev.outcome;
  // value_evaluations no guarda kickoff/market/period → se toman de canonical_events / defaults 1X2 regulation.
  const ce = (await db.query(`SELECT scheduled_start FROM canonical_events WHERE id=$1`, [ev.canonical_event_id]).catch(() => ({ rows: [] }))).rows[0];
  ev = { ...ev, event_start_at: ce ? ce.scheduled_start : ctx.kickoff || null, market: ev.market || '1x2', period: ev.period || 'regulation_90m', value_policy_version: ev.classification_version || 'value-1' };
  const key = dedupKey(ev);
  const pr = await priceRefresh(ev.canonical_event_id, outcome);
  const minOdds = num(ev.minimum_acceptable_odds);
  const pst = priceState({ currentOdds: pr.currentOdds, minOdds, observedAt: ms(pr.observed_at), now, kickoff: ms(ev.event_start_at), suspended: pr.suspended });
  const dl = deepLinks.resolve({ sportsbookCode: ev.best_sportsbook_code || pr.best_sportsbook, providerLinks: ctx.providerLinks });
  const existing = (await db.query(`SELECT * FROM candidate_factory WHERE dedup_key=$1`, [key])).rows[0];

  const base = { ...existing, canonical_event_id: ev.canonical_event_id, market: ev.market || '1x2', period: ev.period || 'regulation_90m', outcome, kickoff_at: ev.event_start_at, verified_independence_group_count: ev.verified_independence_group_count, price_state: pst, deep_link: dl.url };
  const rd = await readiness(base, { now });
  const lifecycle = lifecycleFor(pst, rd.ready, rd.blockers);

  if (existing) {
    // §13: actualizar precio/sportsbook/freshness/status/blockers + historial; NO nueva fila, NO cambia prob.
    const transition = existing.candidate_lifecycle !== lifecycle ? [{ from: existing.candidate_lifecycle, to: lifecycle, at: new Date(now).toISOString(), price_state: pst }] : [];
    await db.query(
      `UPDATE candidate_factory SET current_best_odds=$2, best_sportsbook=$3, price_observed_at=$4, price_state=$5,
         deep_link=$6, deep_link_level=$7, candidate_lifecycle=$8, readiness_state=$9, readiness_blockers=$10,
         observation_count=observation_count+1, last_refreshed_at=now(),
         transition_history = transition_history || $11::jsonb
       WHERE candidate_id=$1`,
      [existing.candidate_id, pr.currentOdds, pr.best_sportsbook, pr.observed_at, pst, dl.url, dl.level, lifecycle, rd.ready ? 'READY' : 'BLOCKED', JSON.stringify(rd.blockers), JSON.stringify(transition)]);
    return { updated: true, candidate_id: existing.candidate_id, lifecycle, price_state: pst };
  }

  const r = await db.query(
    `INSERT INTO candidate_factory (dedup_key, canonical_event_id, canonical_market_id, market, period, outcome, selection,
       model_version, value_policy_version, value_evaluation_id, classification, gp_probability, consensus_probability,
       conservative_probability, adjusted_edge_pp, adjusted_ev, quality_score, uncertainty_score, verified_independence_group_count,
       edge_source_code, published_min_odds, detection_best_odds, detection_sportsbook, current_best_odds, minimum_odds,
       best_sportsbook, price_observed_at, price_state, deep_link, deep_link_level, candidate_lifecycle, readiness_state,
       readiness_blockers, candidate_reason, kickoff_at, evaluation_mode, registry_eligible, transition_history)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,'internal_operational',false,$35)
     ON CONFLICT (dedup_key) DO NOTHING RETURNING candidate_id`,
    [key, ev.canonical_event_id, ev.canonical_market_id, ev.market || '1x2', ev.period || 'regulation_90m', outcome,
     ev.model_version || 'V1', ev.value_policy_version || ev.classification_version || 'value-1', ev.id, ev.classification,
     num(ev.gp_probability), num(ev.sportsbook_consensus_probability), num(ev.conservative_probability), num(ev.adjusted_edge_pp), num(ev.adjusted_ev),
     ev.quality_score, ev.uncertainty_score, ev.verified_independence_group_count, ev.edge_source_code, minOdds, num(ev.best_decimal_odds), ev.best_sportsbook_code,
     pr.currentOdds, minOdds, pr.best_sportsbook, pr.observed_at, pst, dl.url, dl.level, lifecycle, rd.ready ? 'READY' : 'BLOCKED',
     JSON.stringify(rd.blockers), JSON.stringify({ edge_source_code: ev.edge_source_code }), ev.event_start_at,
     JSON.stringify([{ to: lifecycle, at: new Date(now).toISOString(), price_state: pst }])]);
  return { created: !!r.rows[0], candidate_id: r.rows[0] ? r.rows[0].candidate_id : null, lifecycle, price_state: pst };
}

// run — barrido: STRONG operativas elegibles → candidates. Con 0 STRONG → 0 candidates (resultado válido §1/§17).
async function run(opts = {}) {
  if (!flags().enabled || !db.isConfigured()) return { disabled: true, candidates: 0 };
  const evals = (await db.query(
    `SELECT * FROM value_evaluations WHERE classification='strong' AND evaluation_mode='internal_operational' AND pick_candidate_eligible=true
       ORDER BY created_at DESC LIMIT 200`).catch(() => ({ rows: [] }))).rows;
  const m = { strong_evals: evals.length, created: 0, updated: 0, ready: 0, blocked: 0 };
  for (const ev of evals) {
    try {
      const r = await processStrong(ev, opts);
      if (r.created) m.created++; if (r.updated) m.updated++;
      if (r.lifecycle === 'READY_FOR_REVIEW') m.ready++; else m.blocked++;
    } catch (e) { /* aislado: una falla de un candidate no rompe el resto */ }
  }
  return m;
}

// status — cola admin §14 + counts. Empty (0 candidates) es correcto.
async function status() {
  if (!db.isConfigured()) return { candidates: 0, by_lifecycle: {}, note: 'db not configured' };
  const rows = (await db.query(`SELECT * FROM candidate_factory WHERE superseded=false ORDER BY detected_at DESC LIMIT 100`).catch(() => ({ rows: [] }))).rows;
  const by = {}; for (const r of rows) by[r.candidate_lifecycle] = (by[r.candidate_lifecycle] || 0) + 1;
  return {
    candidates: rows.length, by_lifecycle: by, conversion_enabled: false,
    note: rows.length ? null : 'No apareció ninguna oportunidad que cumpliera los gates actuales.',
    items: rows.map(r => ({
      candidate_id: r.candidate_id, event: r.canonical_event_id, kickoff: r.kickoff_at, selection: r.selection, classification: r.classification,
      gp_probability: r.gp_probability, consensus_probability: r.consensus_probability, conservative_probability: r.conservative_probability,
      best_odds: r.current_best_odds, minimum_odds: r.minimum_odds, sportsbook: r.best_sportsbook, price_status: r.price_state,
      adjusted_edge_pp: r.adjusted_edge_pp, adjusted_ev: r.adjusted_ev, quality: r.quality_score, verified_groups: r.verified_independence_group_count,
      edge_source: r.edge_source_code, deep_link: r.deep_link, candidate_status: r.candidate_lifecycle, readiness: r.readiness_state,
      readiness_blockers: r.readiness_blockers, detected_at: r.detected_at, last_refreshed: r.last_refreshed_at,
    })),
  };
}

// reject / addNote / refreshReadiness — únicas acciones permitidas en esta fase (§14). NO approve/publish.
async function reject(candidateId, { adminId, reason } = {}) {
  const r = await db.query(`UPDATE candidate_factory SET candidate_lifecycle='REJECTED', readiness_state='REJECTED',
    transition_history = transition_history || $2::jsonb WHERE candidate_id=$1 AND candidate_lifecycle <> 'CONVERTED_TO_PICK' RETURNING candidate_id`,
    [candidateId, JSON.stringify([{ to: 'REJECTED', by: adminId, reason: (reason || '').slice(0, 500), at: new Date().toISOString() }])]);
  return { ok: !!r.rows[0] };
}
async function addNote(candidateId, { adminId, note } = {}) {
  const r = await db.query(`UPDATE candidate_factory SET internal_notes = internal_notes || $2::jsonb WHERE candidate_id=$1 RETURNING candidate_id`,
    [candidateId, JSON.stringify([{ by: adminId, note: (note || '').slice(0, 1000), at: new Date().toISOString() }])]);
  return { ok: !!r.rows[0] };
}

module.exports = { run, processStrong, status, reject, addNote, dedupKey, priceState, priceRefresh, readiness, lifecycleFor, flags };
