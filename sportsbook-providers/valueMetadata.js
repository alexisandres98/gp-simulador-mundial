// sportsbook-providers/valueMetadata.js — Checkpoint 2.2. Calcula la METADATA aditiva de cada evaluación
// (best sportsbook, source counts verificados, descomposición del edge, quality raw/max + diagnostic V2).
// NO toca fórmulas/thresholds/clasificación: solo computa columnas informativas para persistir vía UPDATE.
'use strict';
const qualityScore = require('../value-engine/qualityScore');
const seedRows = require('./source-catalog-seed').seedRows;

// bestBookForOutcome(cleanSets, outcome, catalog) — la casa con la mejor cuota para un outcome, con desempate
// determinístico: (1) verificada > unverified; (2) provider_update más reciente; (3) code estable.
function bestBookForOutcome(cleanSets, outcome, catalog = {}) {
  const cands = cleanSets
    .map(s => ({ sportsbook: s.sportsbook, odds: s.quotes[outcome] && s.quotes[outcome].odds, provider_update: s.provider_update, observed_at: s.observed_at }))
    .filter(x => x.odds != null);
  if (!cands.length) return null;
  const maxOdds = Math.max(...cands.map(x => x.odds));
  const tied = cands.filter(x => x.odds === maxOdds);
  const verifStatus = code => (catalog[code] && catalog[code].verification_status) || 'unverified';
  tied.sort((a, b) => {
    const va = verifStatus(a.sportsbook) === 'verified' ? 0 : 1, vb = verifStatus(b.sportsbook) === 'verified' ? 0 : 1;
    if (va !== vb) return va - vb;                                              // verificada primero
    const ta = +new Date(a.provider_update || 0), tb = +new Date(b.provider_update || 0);
    if (tb !== ta) return tb - ta;                                             // más reciente
    return String(a.sportsbook).localeCompare(String(b.sportsbook));           // estable por code
  });
  const winner = tied[0];
  const name = (catalog[winner.sportsbook] && catalog[winner.sportsbook].sportsbook_name) || winner.sportsbook;
  return {
    best_sportsbook_code: winner.sportsbook, best_sportsbook_name: name,
    best_price_observed_at: winner.observed_at || null, best_price_provider_updated_at: winner.provider_update || null,
    best_price_deep_link: null, odds: maxOdds,
    comparables: cands.sort((a, b) => b.odds - a.odds).map(x => ({ sportsbook: x.sportsbook, odds: x.odds, provider_update: x.provider_update })),
  };
}

// edgeSourceCode(ensemble, consensus, breakEven) — de dónde viene el edge (no altera la clasificación).
function edgeSourceCode(ensemble, consensus, breakEven) {
  const raw = ensemble - breakEven;
  if (raw <= 0) return 'NO_ACTIONABLE_EDGE';
  const modelShare = (ensemble - consensus) / raw;
  if (modelShare >= 0.6) return 'MODEL_DISAGREEMENT';
  if (modelShare <= 0.2) return 'BEST_PRICE_DISPERSION';
  return 'HYBRID';
}

// computeMetadata(built, evalRow, opts) → objeto con las columnas a UPDATE para una evaluación (un outcome).
// built: salida de buildEventInput (sets/clean/cls/gp). evalRow: fila persistida (probs/odds/source_count...).
function computeMetadata(built, evalRow, { evaluationMode = 'internal_validation', validationRunId = null, catalog = {} } = {}) {
  const sel = evalRow.selection;
  const N = x => x == null ? null : Number(x);
  const gp = N(evalRow.gp_probability), cons = N(evalRow.sportsbook_consensus_probability), ens = N(evalRow.ensemble_probability);
  const be = N(evalRow.best_decimal_odds) ? 1 / N(evalRow.best_decimal_odds) : null;
  const cls = built.cls;
  const by = cls.by_status || {};
  const best = bestBookForOutcome(built.clean, sel, catalog);

  // quality legacy raw/max (mismo ctx que evaluate.js, reproduce el score sin cambiarlo)
  const gpObj = built.input.gp || {};
  const qctx = {
    sourceCount: evalRow.source_count, independenceCount: evalRow.independence_group_count,
    freshnessOk: true, marketComplete: true, calibrationStatus: gpObj.calibrationStatus, sampleStatus: gpObj.sampleStatus,
    lowLiquidity: false, rulesOk: true, mappingMatched: true, lineupMissing: false, priceStable: true, methodDisagreement: null,
  };
  const qLegacy = qualityScore.compute(qctx);
  const qV2 = qualityScore.computeDiagnosticV2({ ...qctx, usableSourceCount: built.clean.length, verifiedIndependenceGroups: cls.verified_independence_groups, predictionMarketAvailable: false });

  return {
    evaluation_mode: evaluationMode, validation_run_id: validationRunId,
    registry_eligible: false, pick_candidate_eligible: false, public_eligible: false,
    official_gp_model: 'V1', challenger_gp_model: 'V2', challenger_official_weight: 0,
    // best sportsbook
    best_sportsbook_code: best && best.best_sportsbook_code, best_sportsbook_name: best && best.best_sportsbook_name,
    best_price_observed_at: best && best.best_price_observed_at, best_price_provider_updated_at: best && best.best_price_provider_updated_at,
    best_price_deep_link: best && best.best_price_deep_link,
    // counts
    raw_sportsbook_count: built.sets.length, usable_sportsbook_count: built.clean.length,
    verified_sportsbook_count: by.verified || 0, unverified_sportsbook_count: by.unverified || 0,
    duplicate_skin_count: by.duplicate_skin || 0, excluded_sportsbook_count: by.excluded || 0,
    verified_independence_group_count: cls.verified_independence_groups,
    // edge decomposition
    gp_vs_consensus_pp: gp != null && cons != null ? +(gp - cons).toFixed(8) : null,
    ensemble_vs_consensus_pp: ens != null && cons != null ? +(ens - cons).toFixed(8) : null,
    consensus_vs_best_price_break_even_pp: cons != null && be != null ? +(cons - be).toFixed(8) : null,
    edge_source_code: (ens != null && cons != null && be != null) ? edgeSourceCode(ens, cons, be) : null,
    // quality
    quality_raw_points: qLegacy.raw_points, quality_max_points: qLegacy.max_points, quality_normalized_percent: qLegacy.normalized_percent,
    quality_components: qLegacy.factors, quality_policy_version: qLegacy.version,
    quality_diagnostic_v2_score: qV2.quality_diagnostic_v2_score, quality_diagnostic_v2_components: qV2.quality_diagnostic_v2_components,
    _best_comparables: best && best.comparables,
  };
}

module.exports = { computeMetadata, bestBookForOutcome, edgeSourceCode };
