// value-engine/ensemble.js — Sprint 7 §20-21. Ensemble por weighted logit pooling. Pesos versionados.
// V2 nunca alimenta el ensemble oficial. GP limitado con muestra insuficiente. Fuentes faltantes se reponderan.
'use strict';
const cfg = require('./config');

const OUTCOMES = ['home', 'draw', 'away'];
function logit(p, clip = cfg.params.ensembleLogitClip) { const c = Math.min(1 - clip, Math.max(clip, p)); return Math.log(c / (1 - c)); }
function logistic(x) { return 1 / (1 + Math.exp(-x)); }

// compute(sources, opts) → { ensemble_probability, weights_used, sources_used, version, notes }
//   sources: { sportsbook_consensus:{home,draw,away}|null, gp:{probabilities, sampleStatus, calibrationStatus}|null,
//              prediction_markets:{home,draw,away}|null, sharp:{home,draw,away}|null }
function compute(sources = {}) {
  const w0 = cfg.params.weights;
  const avail = [];
  if (probsOk(sources.sportsbook_consensus)) avail.push({ key: 'sportsbook_consensus', p: sources.sportsbook_consensus, w: w0.sportsbookConsensus });
  if (sources.gp && probsOk(sources.gp.probabilities)) {
    let gw = w0.gpModel;
    // política conservadora: muestra insuficiente/early → peso GP capado
    if (['insufficient', 'early'].includes(sources.gp.sampleStatus) || sources.gp.calibrationStatus === 'insufficient_data') gw = Math.min(gw, w0.maxGpWithInsufficientSample);
    avail.push({ key: 'gp', p: sources.gp.probabilities, w: gw });
  }
  if (probsOk(sources.prediction_markets)) avail.push({ key: 'prediction_markets', p: sources.prediction_markets, w: w0.predictionMarkets });
  if (probsOk(sources.sharp) && w0.sharpReference > 0) avail.push({ key: 'sharp', p: sources.sharp, w: w0.sharpReference });

  if (!avail.length) return { status: 'unavailable', reason: 'no_sources', version: cfg.VERSIONS.ensemble };
  // reponderar al subconjunto disponible (pesos suman 1)
  const sumW = avail.reduce((a, x) => a + x.w, 0) || 1;
  avail.forEach(x => { x.wn = x.w / sumW; });

  const ens = {};
  for (const o of OUTCOMES) ens[o] = logistic(avail.reduce((a, x) => a + x.wn * logit(x.p[o]), 0));
  const s = OUTCOMES.reduce((a, o) => a + ens[o], 0);
  const ensemble = {}; for (const o of OUTCOMES) ensemble[o] = +(ens[o] / s).toFixed(8);

  return {
    status: 'ok', ensemble_probability: ensemble,
    weights_used: avail.map(x => ({ source: x.key, weight: +x.wn.toFixed(6) })),
    sources_used: avail.map(x => x.key), source_count: avail.length, version: cfg.VERSIONS.ensemble,
    note: 'V2 experimental NO incluido (peso oficial 0).',
  };
}

function probsOk(p) { return p && OUTCOMES.every(o => Number.isFinite(p[o]) && p[o] > 0 && p[o] < 1); }

module.exports = { compute, logit, logistic };
