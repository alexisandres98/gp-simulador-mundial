// gp-product/arbitrage.js — Fase R.4. Capa de producto de Arbitraje para la beta interna. READ-ONLY. Carga
// oportunidades + su evaluación actual + legs + evento, sintetiza el ESTADO §12 con arb-engine/policy desde los
// gates YA persistidos (semantic/temporal/capacity, mig 038/039), y arma DTOs NEUTRALES (códigos, ISO, sin
// secretos/identidades de independencia/payloads crudos). NUNCA escribe ni ejecuta órdenes.
'use strict';
const policy = require('../arb-engine/policy');

const round = (x, d = 4) => (x == null || !Number.isFinite(Number(x))) ? null : Number(Number(x).toFixed(d));
const iso = (t) => { if (!t) return null; try { return new Date(t).toISOString(); } catch { return null; } };

// reconstruye el objeto `ev` que espera policy.classifyOpportunity desde una fila plana de arb_evaluations.
function reconstructEv(row, legs) {
  const tc = row.temporal_capacity || {};
  return {
    classification: row.classification,
    reasons: row.rejection_reasons || [],
    warnings: row.warning_codes || [],
    semantic: { ok: row.semantic_ok, fatal: row.semantic_fatal, sub_reason: row.semantic_sub_reason, blockers: row.semantic_blockers || [] },
    temporal: tc.temporal || { ok: row.temporal_ok, reasons: [], evidence: {} },
    capacity: tc.capacity || { capacity_status: row.capacity_status, confirmed_executable_size: row.confirmed_executable_size },
    evaluation: {
      grossProfit: row.gross_margin, netProfit: row.net_profit, netRoi: row.net_roi, capitalRequired: row.capital_required,
      feeStatus: (row.warning_codes || []).includes('fee_unknown') ? 'unknown' : 'known',
      fullyFillable: row.capacity_status === 'CONFIRMED',
      legs: (legs || []).map(l => ({ provider: l.provider_code || l.provider_id, side: l.side })),
    },
  };
}

// lista de oportunidades de arbitraje (con estado §12). Sin fabricar nada: si no hay, devuelve [].
async function list(db, { limit = 80 } = {}) {
  const rows = await db.query(
    `SELECT o.id, o.opportunity_key, o.canonical_event_id, o.canonical_market_id, o.classification AS opp_classification,
            o.status, o.best_net_roi, o.best_net_profit, o.best_executable_size, o.observation_count,
            o.first_detected_at, o.last_seen_at, o.last_validated_at, o.expired_at,
            e.id AS eval_id, e.classification, e.net_roi, e.net_profit, e.capital_required, e.gross_margin,
            e.confidence_score, e.confidence_label, e.rejection_reasons, e.warning_codes,
            e.semantic_ok, e.semantic_fatal, e.semantic_sub_reason, e.semantic_blockers,
            e.temporal_ok, e.capacity_status, e.confirmed_executable_size, e.temporal_capacity,
            ce.home_participant, ce.away_participant, ce.scheduled_start, ce.competition
       FROM arb_opportunities o
       LEFT JOIN arb_evaluations e ON e.id = o.current_evaluation_id
       LEFT JOIN canonical_events ce ON ce.id = o.canonical_event_id
      ORDER BY o.last_seen_at DESC NULLS LAST
      LIMIT $1`, [limit]).catch(() => ({ rows: [] }));
  return rows.rows;
}

const LEG_COLS = `l.evaluation_id, l.leg_index, l.side, l.best_price, l.vwap, l.quantity, l.fee, l.depth_consumed,
            l.price_source, l.snapshot_age_ms, p.code AS provider_code, p.name AS provider_name`;

async function legsFor(db, evalId) {
  if (!evalId) return [];
  const r = await db.query(
    `SELECT ${LEG_COLS} FROM arb_evaluation_legs l LEFT JOIN providers p ON p.id = l.provider_id
      WHERE l.evaluation_id = $1 ORDER BY l.leg_index`, [evalId]).catch(() => ({ rows: [] }));
  return r.rows;
}

// legsForMany — anti-N+1 (§17): una sola query para todas las evaluaciones; devuelve Map(evalId → legs[]).
async function legsForMany(db, evalIds) {
  const ids = (evalIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const r = await db.query(
    `SELECT ${LEG_COLS} FROM arb_evaluation_legs l LEFT JOIN providers p ON p.id = l.provider_id
      WHERE l.evaluation_id = ANY($1::uuid[]) ORDER BY l.evaluation_id, l.leg_index`, [ids]).catch(() => ({ rows: [] }));
  const m = new Map();
  for (const row of r.rows) { if (!m.has(row.evaluation_id)) m.set(row.evaluation_id, []); m.get(row.evaluation_id).push(row); }
  return m;
}

// DTO de tarjeta (lista). Neutral. Estado §12 sintetizado.
function cardDto(row, legs, resolveTeamId) {
  const ev = reconstructEv(row, legs);
  const verdict = policy.classifyOpportunity(ev);
  const homeId = resolveTeamId ? resolveTeamId(row.home_participant) : null;
  const awayId = resolveTeamId ? resolveTeamId(row.away_participant) : null;
  return {
    opportunity_id: row.id,
    event_id: row.canonical_event_id,
    home: { team_id: homeId, name_fallback: row.home_participant || null },
    away: { team_id: awayId, name_fallback: row.away_participant || null },
    competition_code: 'FIFA_WORLD_CUP_2026',
    kickoff_at: iso(row.scheduled_start),
    strategy_code: (row.classification === '1x2' || row.opp_classification === '1x2') ? '1X2' : 'BINARY',
    state_code: verdict.state,                 // §12: EXECUTABLE/THEORETICAL_ONLY/PARTIAL_EXECUTION_RISK/BLOCKED/…
    executable: verdict.executable,            // siempre false hoy (0 ejecutables)
    net_roi: round(row.net_roi, 4),
    net_profit: round(row.net_profit, 4),
    executable_capital: round(row.confirmed_executable_size, 2),
    capacity_status: row.capacity_status || null,
    confidence_label: row.confidence_label || null,
    venues: Array.from(new Set((legs || []).map(l => l.provider_name || l.provider_code).filter(Boolean))),
    updated_at: iso(row.last_seen_at),
    blockers: verdict.reasons || [],
    policy_version: verdict.policy_version,
  };
}

// DTO de detalle: legs + economía + riesgos + compat de settlement + expiry. Sin secretos.
function detailDto(row, legs, resolveTeamId) {
  const card = cardDto(row, legs, resolveTeamId);
  const ev = reconstructEv(row, legs);
  return Object.assign({}, card, {
    legs: (legs || []).map(l => ({
      leg_index: l.leg_index,
      outcome_code: l.side ? String(l.side).toUpperCase() : null,
      venue: l.provider_name || l.provider_code || null,    // dónde apostar (público); NO grupo de independencia
      price: round(l.best_price, 4),
      vwap: round(l.vwap, 4),
      quantity: round(l.quantity, 2),
      fee: round(l.fee, 6),
      depth_levels_consumed: l.depth_consumed != null ? Number(l.depth_consumed) : null,
      price_source_code: (l.price_source || '').toUpperCase() || null,
      snapshot_age_ms: l.snapshot_age_ms != null ? Number(l.snapshot_age_ms) : null,
      deep_link: null,                                       // R.4: deep link validado se resuelve en el endpoint
    })),
    economics: {
      gross_margin: round(row.gross_margin, 4),
      net_margin: round(row.net_roi, 4),
      net_profit: round(row.net_profit, 4),
      required_capital: round(row.capital_required, 2),
      executable_capital: round(row.confirmed_executable_size, 2),
      limiting_leg_index: ev.capacity && ev.capacity.limiting_leg_index != null ? ev.capacity.limiting_leg_index : null,
    },
    temporal: ev.temporal && ev.temporal.evidence ? {
      oldest_leg_at: ev.temporal.evidence.oldest_leg_at, newest_leg_at: ev.temporal.evidence.newest_leg_at,
      cross_leg_time_spread_ms: ev.temporal.evidence.cross_leg_time_spread_ms, ok: ev.temporal.ok,
    } : { ok: row.temporal_ok },
    settlement_compatibility: {
      semantic_ok: row.semantic_ok, sub_reason_code: row.semantic_sub_reason,
      blocker_codes: (row.semantic_blockers || []).map(b => b.code),
    },
    risk_codes: deriveRiskCodes(row, ev),
    lifecycle: {
      first_detected_at: iso(row.first_detected_at), last_validated_at: iso(row.last_validated_at),
      last_seen_at: iso(row.last_seen_at), expired_at: iso(row.expired_at), observation_count: row.observation_count,
    },
  });
}

function deriveRiskCodes(row, ev) {
  const codes = new Set();
  if (row.capacity_status !== 'CONFIRMED') codes.add('CAPACITY_NOT_CONFIRMED');
  if (row.temporal_ok === false) codes.add('NOT_CONTEMPORANEOUS');
  if (row.semantic_ok === false) codes.add('SEMANTIC_UNVERIFIED');
  for (const w of (row.warning_codes || [])) {
    if (w === 'derived_ask') codes.add('DERIVED_PRICE');
    if (w === 'thin_executable_size') codes.add('THIN_SIZE');
    if (w === 'high_volatility') codes.add('HIGH_VOLATILITY');
  }
  codes.add('EXECUTION_RISK');           // §20: siempre hay riesgo de ejecución; nunca "ganancia segura"
  return Array.from(codes);
}

// observatory — Fase R.5 §25. Telemetría READ-ONLY del dry-run de arbitraje (admin). Sin secretos. Reporta
// honestamente: detectadas/bloqueadas/teóricas/ejecutables/stale + razones principales de bloqueo + frescura.
async function observatory(db, { windowMin = 15 } = {}) {
  const w = `created_at > now() - interval '${Number(windowMin)} minutes'`;
  const one = async (s) => (await db.query(s).catch(() => ({ rows: [] }))).rows;
  const [byClass, bySemantic, byTemporal, byCapacity, blockers, executable, opps, mappings, lastEval] = await Promise.all([
    one(`SELECT classification, count(*)::int n FROM arb_evaluations WHERE ${w} GROUP BY 1 ORDER BY 2 DESC`),
    one(`SELECT semantic_ok, semantic_fatal, count(*)::int n FROM arb_evaluations WHERE ${w} GROUP BY 1,2`),
    one(`SELECT temporal_ok, count(*)::int n FROM arb_evaluations WHERE ${w} GROUP BY 1`),
    one(`SELECT capacity_status, count(*)::int n FROM arb_evaluations WHERE ${w} GROUP BY 1`),
    one(`SELECT semantic_sub_reason, count(*)::int n FROM arb_evaluations WHERE ${w} AND semantic_ok=false GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
    one(`SELECT count(*)::int n FROM arb_evaluations WHERE classification IN ('pure_arb','execution_sensitive') AND created_at > now() - interval '60 minutes'`),
    one(`SELECT status, count(*)::int n FROM arb_opportunities GROUP BY 1`),
    one(`SELECT mapping_status, count(*)::int n FROM provider_market_mappings GROUP BY 1`),
    one(`SELECT max(created_at) last FROM arb_evaluations`),
  ]);
  return {
    window_minutes: windowMin,
    evaluations_by_classification: byClass,
    semantic: bySemantic, temporal: byTemporal, capacity: byCapacity,
    top_block_reasons: blockers,
    executable_candidates_60m: executable[0] ? executable[0].n : 0,   // honesto: 0 esperado
    opportunities_by_status: opps,
    mappings_by_status: mappings,
    last_evaluation_at: lastEval[0] ? lastEval[0].last : null,
    auto_execution: false, public_enabled: false,                     // INVARIANTES
    generated_at: new Date().toISOString(),
  };
}

module.exports = { list, legsFor, legsForMany, cardDto, detailDto, reconstructEv, observatory };
