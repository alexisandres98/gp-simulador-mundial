// gp-product/dto.js — Fase Q §15. Transformadores PUROS (sin IO) de filas de DB → contratos de cliente.
// Principios duros:
//  · Códigos NEUTRALES (outcome_code HOME/DRAW/AWAY, market_code, period_code, classification, risk_code,
//    blocker_code, price_state) — el idioma se resuelve en el cliente vía i18n. NUNCA texto localizado aquí.
//  · Team IDs estables (CRO/GHA), no nombres traducidos. El cliente localiza con TEAMS_I18N.
//  · Timestamps SIEMPRE ISO 8601 UTC. El cliente formatea a la zona del usuario.
//  · NO se expone: secretos, identidades de independencia de fuentes, nombres de proveedores de datos,
//    notas de admin, documentos de noticias crudos, ni HTML. (El sportsbook del mejor precio SÍ es público.)
//  · "Análisis" = factores REALMENTE aplicados (applied_impact != 0). Nunca factores de impacto 0 como si
//    hubieran influido. Nada inventado.
'use strict';

const round = (x, d = 4) => (x == null || !Number.isFinite(Number(x))) ? null : Number(Number(x).toFixed(d));
const iso = (t) => { if (!t) return null; try { return new Date(t).toISOString(); } catch { return null; } };
const OUTCOME_CODE = { home: 'HOME', draw: 'DRAW', away: 'AWAY' };
const upper = (s) => s == null ? null : String(s).toUpperCase();

// --- Encabezado de partido (neutral, localizable en cliente) ---
function matchHeader(ev, resolveTeamId) {
  const homeId = resolveTeamId ? resolveTeamId(ev.home_participant) : null;
  const awayId = resolveTeamId ? resolveTeamId(ev.away_participant) : null;
  return {
    event_id: ev.id,
    home: { team_id: homeId, name_fallback: ev.home_participant || null },
    away: { team_id: awayId, name_fallback: ev.away_participant || null },
    competition_code: 'FIFA_WORLD_CUP_2026',
    stage_code: ev.stage ? upper(ev.stage) : null,        // KNOCKOUT/GROUP/etc si se conoce; null = desconocido
    kickoff_at: iso(ev.scheduled_start),
    venue: ev.venue || null,
    status_code: upper(ev.status || 'scheduled'),         // SCHEDULED / LIVE / FINISHED / POSTPONED
  };
}

// --- Vector de probabilidad GP 1X2 (regulation). Suma debe ser ~1 (el cliente verifica tolerancia). ---
// evalsByOutcome: { home:{...}, draw:{...}, away:{...} } filas de value_evaluations (última por outcome).
function probabilityVector(evalsByOutcome, { market_code = '1X2', period_code = 'REGULATION' } = {}) {
  const outcomes = ['home', 'draw', 'away'].map((o) => {
    const e = evalsByOutcome[o] || {};
    return {
      outcome_code: OUTCOME_CODE[o],
      team_ref: o === 'draw' ? null : o,                  // 'home'|'away' → el cliente mapea al team del header
      gp_probability: round(e.gp_probability, 4),
      market_probability: round(e.sportsbook_consensus_probability, 4),
    };
  });
  const sum = outcomes.reduce((a, x) => a + (x.gp_probability || 0), 0);
  return {
    market_code, period_code,
    period_note_code: 'REGULATION_90',                    // "90 min; no incluye prórroga ni penales"
    outcomes,
    sums_to_one: Math.abs(sum - 1) <= 0.01,               // tolerancia de redondeo
    sum: round(sum, 4),
  };
}

// --- Probabilidad de clasificación (eliminatorias). SIEMPRE separada de 1X2 90'. ---
function qualifyBlock(knockout) {
  if (!knockout || knockout.home_qualify == null) return null;
  return {
    market_code: 'QUALIFY',
    semantics_code: 'ADVANCE_INCLUDES_ET_PENALTIES',      // distinta de 1X2 90' — el cliente NO las compara
    home_qualify: round(knockout.home_qualify, 4),
    away_qualify: round(knockout.away_qualify, 4),
  };
}

// --- Análisis: factores REALMENTE aplicados. Sin source_name. Sin impacto 0. ---
// observations: filas de context_observations. snapshot: fila de v2_probability_snapshots.
function analysisFactors(observations = [], snapshot = null) {
  // Factores con impacto per-factor REALMENTE aplicado (≠0): se muestran como drivers con su delta.
  const applied = (observations || [])
    .filter((o) => Number(o.applied_impact) !== 0 && o.applied_impact != null)
    .map((o) => ({
      factor_code: upper(o.factor_code),                  // FORM/AVAILABILITY/GOALKEEPER/REST/TACTICS/VENUE/WEATHER...
      category_code: upper(o.category),                   // PERFORMANCE/SQUAD/CONTEXT...
      subject_team_id: o.subject_type === 'team' ? o.subject_id : null,
      direction_code: upper(o.direction),                 // HOME/AWAY/NEUTRAL
      applied_impact: round(o.applied_impact, 4),         // delta Elo aplicado (con signo)
      evidence_class: upper(o.fact_or_inference),         // FACT / INFERENCE  (RUMOR/UNKNOWN nunca llegan aplicados)
      confidence: round(o.confidence, 2),
      timestamp_quality_code: upper(o.timestamp_quality), // SOURCE_PUBLISHED/INGESTION_OBSERVED/...
    }))
    .sort((a, b) => Math.abs(b.applied_impact) - Math.abs(a.applied_impact));
  // Factores EVALUADOS (categorías distintas presentes en las observaciones). Se listan SIN afirmar impacto
  // per-factor cuando el applied_impact es 0; el efecto real se comunica con el ajuste NETO del snapshot.
  // Factores evaluados con su metadata real (evidencia/confianza/freshness), SIN claim de pp per-factor cuando
  // applied_impact=0. Se queda con la observación de mayor confianza por factor (4D#11).
  const evalSet = new Map();
  for (const o of (observations || [])) {
    const key = upper(o.factor_code);
    if (!key) continue;
    const conf = o.confidence != null ? Number(o.confidence) : null;
    const prev = evalSet.get(key);
    if (!prev || (conf != null && (prev.confidence == null || conf > prev.confidence))) {
      evalSet.set(key, {
        factor_code: key,
        category_code: upper(o.category),
        evidence_class: upper(o.fact_or_inference),     // FACT / INFERENCE
        confidence: round(conf, 2),
        timestamp_quality_code: upper(o.timestamp_quality), // SOURCE_PUBLISHED / INGESTION_OBSERVED / ...
        subject_team_id: o.subject_type === 'team' ? o.subject_id : null,
        applied: false,                                  // este factor NO tiene impacto per-factor aislado
      });
    }
  }
  const adj = snapshot && snapshot.context_adjustments ? snapshot.context_adjustments : null;
  const adjOut = adj ? { HOME: round(adj.home, 4), DRAW: round(adj.draw, 4), AWAY: round(adj.away, 4) } : null;
  const netMoved = adjOut && ['HOME', 'DRAW', 'AWAY'].some(k => Math.abs(adjOut[k] || 0) >= 0.002);
  return {
    context_state_code: snapshot ? upper(snapshot.context_state) : 'BASE_ONLY',
    base_vector: snapshot ? pickVec(snapshot.base_probability_vector) : null,
    final_vector: snapshot ? pickVec(snapshot.final_probability_vector) : null,
    context_adjustments: adjOut,                          // efecto NETO real del contexto sobre la base
    context_moved_line: !!netMoved,                       // ¿el contexto movió materialmente la línea?
    applied_factors: applied,                             // drivers con delta per-factor (si los hay)
    evaluated_factors: Array.from(evalSet.values()),      // factores evaluados (sin claim de impacto per-factor)
    factor_count: snapshot ? (snapshot.factor_count || 0) : 0,
    source_count: snapshot ? (snapshot.source_count || 0) : 0,
    data_freshness_code: snapshot ? freshnessCode(snapshot.data_freshness) : null,
    context_completeness: snapshot ? round(snapshot.context_completeness, 2) : null,
  };
}
function pickVec(v) { return v ? { HOME: round(v.home, 4), DRAW: round(v.draw, 4), AWAY: round(v.away, 4) } : null; }
function freshnessCode(f) { if (f == null) return null; const n = Number(f); if (n >= 0.8) return 'FRESH'; if (n >= 0.4) return 'AGING'; return 'STALE'; }

// --- Riesgos: códigos estructurados desde warnings/blockers/uncertainty/completeness. Sin garantías. ---
function riskCodes(evalRows = [], snapshot = null, { earlyTrackRecord = true } = {}) {
  const codes = new Set();
  for (const e of evalRows) {
    for (const w of (e.warnings || [])) {
      if (w === 'method_disagreement') codes.add('MODEL_DISAGREEMENT');
      if (w === 'large_model_market_gap') codes.add('LARGE_MARKET_DISAGREEMENT');
    }
    if ((e.uncertainty_score || 0) >= 50) codes.add('MODEL_UNCERTAINTY');
  }
  if (snapshot) {
    if (Number(snapshot.context_completeness) < 0.5) codes.add('CONTEXT_INCOMPLETE');
    if (freshnessCode(snapshot.data_freshness) === 'STALE') codes.add('LOWER_QUALITY_TIMESTAMP');
    if (snapshot.missing_critical_inputs) codes.add('LINEUP_NOT_CONFIRMED');
  }
  if (earlyTrackRecord) codes.add('EARLY_TRACK_RECORD');
  return Array.from(codes);
}

// --- Tarjeta Value (neutral). Solo elegibles deben mostrarse como accionables. ---
function valueCard(e, { resolveTeamId } = {}) {
  const blockers = computeBlockers(e);
  const actionable = e.classification === 'strong' && blockers.length === 0;
  return {
    evaluation_id: e.id,
    event_id: e.canonical_event_id,
    outcome_code: OUTCOME_CODE[e.selection] || upper(e.selection),
    team_ref: e.selection === 'draw' ? null : e.selection,
    market_code: '1X2',
    period_code: 'REGULATION',
    classification_code: upper(e.classification),         // PASS/WATCH/LEAN/STRONG
    gp_probability: round(e.gp_probability, 4),
    market_probability: round(e.sportsbook_consensus_probability, 4),
    best_odds: round(e.best_decimal_odds, 2),
    minimum_odds: round(e.minimum_acceptable_odds, 2),
    break_even_probability: round(e.break_even_probability, 4),
    adjusted_edge_pp: round(e.adjusted_edge_pp, 4),
    adjusted_ev: round(e.adjusted_ev, 4),
    quality_score: e.quality_score != null ? Number(e.quality_score) : null,
    uncertainty_score: e.uncertainty_score != null ? Number(e.uncertainty_score) : null,
    independence_group_count: e.verified_independence_group_count != null ? Number(e.verified_independence_group_count) : null,
    edge_source_code: upper(e.edge_source_code),
    best_sportsbook: e.best_sportsbook_name || null,      // público: dónde está el mejor precio
    price_observed_at: iso(e.best_price_observed_at),
    actionable,
    blockers,                                             // [] si accionable
    risk_codes: riskCodes([e], null),
  };
}
function computeBlockers(e) {
  const b = [];
  for (const x of (e.strong_blockers || [])) b.push(upper(x));   // p.ej. EDGE_BELOW_STRONG
  for (const x of (e.rejection_reasons || [])) {
    if (x === 'no_positive_edge') b.push('NO_POSITIVE_EDGE');
  }
  return Array.from(new Set(b));
}

// --- Pick (desde internal_picks neutral snapshot, mig 032). Localizable. Sin stake. ---
function pickDto(p) {
  return {
    pick_id: p.pick_id,
    event_id: p.canonical_event_id,
    event_display_fallback: p.event_display || null,
    home_team_id: p.canonical_home_team_id || null,
    away_team_id: p.canonical_away_team_id || null,
    outcome_code: p.outcome_code || null,                 // HOME/DRAW/AWAY
    selection_display_key: p.selection_display_key || null,  // 'selection.team_to_win'
    selection_display_args: p.selection_display_args || null, // { team_id }
    market_code: p.market_code || '1X2',
    period_code: p.period_code || 'REGULATION',
    kickoff_at: iso(p.kickoff_at),
    gp_probability: round(p.gp_probability, 4),
    consensus_probability: round(p.consensus_probability, 4),
    break_even_probability: round(p.published_break_even_probability, 4),
    published_odds: round(p.published_odds, 2),
    minimum_odds: round(p.minimum_odds, 2),
    sportsbook: p.sportsbook || null,
    deep_link: p.deep_link || null,
    adjusted_edge_pp: round(p.adjusted_edge_pp, 4),
    adjusted_ev: round(p.adjusted_ev, 4),
    quality_score: p.quality_score != null ? Number(p.quality_score) : null,
    uncertainty_score: p.uncertainty_score != null ? Number(p.uncertainty_score) : null,
    risk_codes: Array.isArray(p.risks_displayed) ? p.risks_displayed.map(upper) : [],
    model_label_code: p.official_model === 'V2' ? 'CURRENT' : 'PREVIOUS', // nunca "V1/V2" al cliente
    theoretical_stake_model: p.theoretical_stake_model || 'flat_1_unit',
    executed_by_gp: !!p.executed_by_gp,                   // siempre false
    price_state_code: p.price_state_code || null,         // lo calcula el repo con precio actual vs mínima
    lifecycle_code: p.lifecycle_code || null,
    result_code: p.result_code || null,                  // WIN/LOSS/VOID/PENDING
    clv: round(p.clv, 4),
    settled_at: iso(p.settled_at),
  };
}

// --- Goal Insights (informativo, detrás de flag). Distribución, NO marcador determinista. ---
function goalInsights(g) {
  if (!g) return null;
  const ou = g.over_under || {};
  return {
    informational: true,                                  // el cliente muestra el disclaimer experimental
    expected_goals: { HOME: round(g.lambda_home, 2), AWAY: round(g.lambda_away, 2), TOTAL: round(g.lambda_total, 2) },
    over_under: {
      '1.5': pct(ou['1.5']), '2.5': pct(ou['2.5']), '3.5': pct(ou['3.5']),
    },
    btts: g.btts ? { yes: round(g.btts.yes, 4), no: round(g.btts.no, 4) } : null,
    top_scores: (g.top_scores || []).slice(0, 5).map((s) => ({ score: s.score, probability: round(s.probability, 4) })),
  };
}
function pct(o) { if (o == null) return null; if (typeof o === 'number') return { over: round(o, 4) }; return { over: round(o.over, 4), under: round(o.under, 4) }; }

module.exports = {
  matchHeader, probabilityVector, qualifyBlock, analysisFactors, riskCodes,
  valueCard, computeBlockers, pickDto, goalInsights,
  _helpers: { round, iso, freshnessCode },
};
