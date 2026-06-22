// value-engine/evaluate.js — Sprint 7. Orquestador: books → no-vig → consenso → ensemble → value → clasificación.
// Produce una value_evaluation por outcome (inmutable por input_hash). Sin look-ahead (usa precios fresh actuales).
'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const odds = require('./oddsNormalization');
const noVig = require('./noVig');
const consensus = require('./consensus');
const ensemble = require('./ensemble');
const vf = require('./valueFormulas');
const uncertainty = require('./uncertainty');
const qualityScore = require('./qualityScore');
const classification = require('./classification');

const OUTCOMES = ['home', 'draw', 'away'];

// bookNoVig(book) → { sportsbook, independence_group, probabilities, complete, fresh } usando el método oficial.
function bookNoVig(book) {
  const raws = OUTCOMES.map(o => {
    const q = book.quotes && book.quotes[o];
    if (!q) return null;
    const n = odds.normalizeQuote(q);
    return n.valid ? n.raw_implied_probability : null;
  });
  const complete = raws.every(r => r != null) && book.is_live !== true && book.market_status !== 'suspended';
  if (!complete) return { sportsbook: book.sportsbook, independence_group: book.independence_group, complete: false, fresh: book.fresh !== false, reason: 'incomplete' };
  const nv = noVig.removeVig(raws, { method: cfg.OFFICIAL_NO_VIG === 'no-vig-power-1' ? 'power' : 'proportional' });
  if (nv.official.status !== 'ok') return { sportsbook: book.sportsbook, independence_group: book.independence_group, complete: false, fresh: book.fresh !== false, reason: 'no_vig_failed' };
  const probs = {}; OUTCOMES.forEach((o, i) => { probs[o] = nv.official.probabilities[i]; });
  return { sportsbook: book.sportsbook, independence_group: book.independence_group, probabilities: probs, complete: true, fresh: book.fresh !== false, overround: nv.official.overround, method_disagreement: nv.method_disagreement };
}

// evaluateMarket(input) → { outcomes: { home, draw, away }, consensus, ensemble, sportsbookBooks }
//   input: { canonicalEventId, canonicalMarketId, canonicalOutcomeIds, gp:{probabilities,model_version,methodology_version,sampleStatus,calibrationStatus,input_cutoff_at,data_quality},
//            sportsbooks:[{sportsbook,independence_group,quotes:{home,draw,away:{odds,format,quoteStatus,quoteTimestamp}},is_live,market_status,fresh}],
//            predictionMarket:{probabilities,executablePrices,lowLiquidity,derived}, bestPrices:{home:{decimalOdds,provider},...},
//            mappingMatched, outcomeMatched, hardConflicts, rulesOk, freshnessOk, eventStarted, mappingVersion, rulesVersion, snapshotIds }
function evaluateMarket(input = {}) {
  const books = (input.sportsbooks || []).map(bookNoVig);
  const cons = consensus.compute(books);
  const consComplete = cons.status === 'ok' && cons.independence_groups >= 1;
  const methodDisagreement = Math.max(0, ...books.filter(b => b.method_disagreement != null).map(b => b.method_disagreement), 0);

  const results = {};
  for (const o of OUTCOMES) {
    const sbProb = consComplete ? cons.median_probability : null;
    const gp = input.gp ? { probabilities: input.gp.probabilities, sampleStatus: input.gp.sampleStatus, calibrationStatus: input.gp.calibrationStatus } : null;
    const ens = ensemble.compute({ sportsbook_consensus: sbProb, gp, prediction_markets: input.predictionMarket ? input.predictionMarket.probabilities : null });
    const ensProb = ens.status === 'ok' ? ens.ensemble_probability[o] : null;

    const gpVsMarket = (sbProb && input.gp) ? input.gp.probabilities[o] - sbProb[o] : 0;
    const pmDiscrepancy = (input.predictionMarket && sbProb) ? input.predictionMarket.probabilities[o] - sbProb[o] : 0;
    const unc = uncertainty.compute({
      dispersion: cons.dispersion, methodDisagreement, gpVsMarket, pmDiscrepancy,
      sampleStatus: input.gp && input.gp.sampleStatus, dataQuality: input.gp && input.gp.data_quality,
      freshnessOk: input.freshnessOk, sourceCount: cons.source_count, independenceCount: cons.independence_groups,
      derivedPrice: input.predictionMarket && input.predictionMarket.derived, lowLiquidity: input.predictionMarket && input.predictionMarket.lowLiquidity,
      lineupMissing: input.lineupMissing,
    });
    const conservativeProb = ensProb != null ? Math.max(0, ensProb - unc.uncertainty_buffer_pp) : null;

    // mejor precio actual (sportsbook decimal preferido para señal accionable; PM como alternativa)
    const bp = (input.bestPrices && input.bestPrices[o]) || {};
    const value = bp.decimalOdds ? vf.forSportsbook({ ensembleProb: ensProb, conservativeProb, decimalOdds: bp.decimalOdds })
      : bp.executablePrice ? vf.forPredictionMarket({ ensembleProb: ensProb, conservativeProb, executablePrice: bp.executablePrice }) : { status: 'no_price' };

    const quality = qualityScore.compute({
      sourceCount: cons.source_count, independenceCount: cons.independence_groups, freshnessOk: input.freshnessOk,
      marketComplete: consComplete, calibrationStatus: input.gp && input.gp.calibrationStatus, sampleStatus: input.gp && input.gp.sampleStatus,
      lowLiquidity: input.predictionMarket && input.predictionMarket.lowLiquidity, rulesOk: input.rulesOk, mappingMatched: input.mappingMatched,
      lineupMissing: input.lineupMissing, priceStable: input.priceStable, methodDisagreement,
    });

    const cls = classification.classify({
      adjustedEdgePp: value.adjusted_edge_pp, adjustedEv: value.adjusted_ev, sourceCount: cons.source_count, independenceGroups: cons.independence_groups,
      qualityScore: quality.quality_score, uncertaintyScore: unc.uncertainty_score, mappingMatched: input.mappingMatched, outcomeMatched: input.outcomeMatched,
      hardConflicts: input.hardConflicts, freshnessOk: input.freshnessOk, priceMeetsMinimum: value.price_meets_minimum, dataQuality: input.gp && input.gp.data_quality,
      consensusComplete: consComplete, modelVersioned: !!(input.gp && input.gp.model_version), eventStarted: input.eventStarted, deepLinkVerified: bp.deepLinkVerified,
    });

    const evaluation = {
      canonical_event_id: input.canonicalEventId || null, canonical_market_id: input.canonicalMarketId || null,
      canonical_outcome_id: (input.canonicalOutcomeIds && input.canonicalOutcomeIds[o]) || o,
      selection: o, classification: cls.classification,
      gp_probability: input.gp ? input.gp.probabilities[o] : null,
      gp_calibrated_probability: input.gp ? input.gp.probabilities[o] : null, // calibración aplicada en gpProbability.js si hay política
      sportsbook_consensus_probability: sbProb ? sbProb[o] : null,
      prediction_market_probability: input.predictionMarket ? input.predictionMarket.probabilities[o] : null,
      sharp_reference_probability: null,
      ensemble_probability: ensProb, conservative_probability: conservativeProb,
      best_price_type: bp.decimalOdds ? 'sportsbook' : bp.executablePrice ? 'prediction_market' : null,
      best_decimal_odds: bp.decimalOdds || null, best_prediction_market_price: bp.executablePrice || null,
      break_even_probability: value.break_even_probability ?? null, fair_odds: value.fair_odds ?? null, conservative_fair_odds: value.conservative_fair_odds ?? null,
      minimum_acceptable_odds: value.minimum_acceptable_odds ?? null, maximum_acceptable_price: value.maximum_acceptable_price ?? null,
      raw_edge_pp: value.raw_edge_pp ?? null, adjusted_edge_pp: value.adjusted_edge_pp ?? null, raw_ev: value.raw_ev ?? null, adjusted_ev: value.adjusted_ev ?? null,
      uncertainty_score: unc.uncertainty_score, quality_score: quality.quality_score,
      source_count: cons.source_count, independence_group_count: cons.independence_groups,
      input_snapshot_ids: input.snapshotIds || [], mapping_version: input.mappingVersion || null, rules_version: input.rulesVersion || null,
      model_version: input.gp ? input.gp.model_version : null, ensemble_version: cfg.VERSIONS.ensemble, no_vig_version: cfg.OFFICIAL_NO_VIG, classification_version: cfg.VERSIONS.classification,
      rejection_reasons: cls.classification === 'pass' ? cls.reasons : [], warnings: [...(unc.warnings || [])],
      strong_blockers: cls.blockers || [],
      _detail: { uncertainty: unc, quality, consensus_method: cons.method, ensemble_weights: ens.weights_used },
    };
    evaluation.input_hash = inputHash(evaluation, input);
    results[o] = evaluation;
  }
  return { outcomes: results, consensus: cons, sportsbookBooks: books };
}

function inputHash(ev, input) {
  return 've:' + crypto.createHash('sha256').update(JSON.stringify({
    e: ev.canonical_event_id, m: ev.canonical_market_id, o: ev.selection,
    gp: ev.gp_probability, sb: ev.sportsbook_consensus_probability, pm: ev.prediction_market_probability,
    odds: ev.best_decimal_odds, price: ev.best_prediction_market_price, snaps: (input.snapshotIds || []).slice().sort(),
    v: [ev.ensemble_version, ev.no_vig_version, ev.classification_version, ev.model_version, ev.mapping_version, ev.rules_version],
  })).digest('hex').slice(0, 32);
}

module.exports = { evaluateMarket, bookNoVig };
