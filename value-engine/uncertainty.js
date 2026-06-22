// value-engine/uncertainty.js — Sprint 7 §22. Separa probabilidad central de incertidumbre. Buffer explicable.
// La incertidumbre NO cambia silenciosamente la probabilidad central: produce un buffer para la prob conservadora.
'use strict';
const cfg = require('./config');

const MAX_BUFFER_PP = 0.05; // tope del buffer (5 pp)

// compute(ctx) → { uncertainty_score, uncertainty_label, uncertainty_buffer_pp, warnings, contributions }
//   ctx: { dispersion, methodDisagreement, gpVsMarket, pmDiscrepancy, sampleStatus, dataQuality, freshnessOk,
//          sourceCount, independenceCount, derivedPrice, lowLiquidity, lineupMissing }
function compute(ctx = {}) {
  const c = [];
  const add = (factor, pts, evidence, warn) => { c.push({ factor, points: pts, evidence, warning: warn || null }); };

  add('book_dispersion', scale(ctx.dispersion, 0.02, 0.10, 20), `dispersion ${fmt(ctx.dispersion)}`, ctx.dispersion > 0.08 ? 'high_dispersion' : null);
  add('no_vig_method_disagreement', ctx.methodDisagreement ? scale(ctx.methodDisagreement, 0.01, 0.05, 12) : 0, `Δ métodos ${fmt(ctx.methodDisagreement)}`, ctx.methodDisagreement > 0.02 ? 'method_disagreement' : null);
  add('gp_vs_market', scale(Math.abs(ctx.gpVsMarket || 0), 0.03, 0.15, 15), `GP−mercado ${fmt(ctx.gpVsMarket)}`, Math.abs(ctx.gpVsMarket || 0) > 0.1 ? 'large_model_market_gap' : null);
  add('prediction_market_discrepancy', scale(Math.abs(ctx.pmDiscrepancy || 0), 0.03, 0.15, 8), `PM Δ ${fmt(ctx.pmDiscrepancy)}`, null);
  add('model_sample', { insufficient: 12, early: 8, developing: 4, established: 0 }[ctx.sampleStatus] ?? 8, `muestra ${ctx.sampleStatus || 'desconocida'}`, ['insufficient', 'early'].includes(ctx.sampleStatus) ? 'small_model_sample' : null);
  add('data_quality', ctx.dataQuality != null ? (1 - clamp(ctx.dataQuality)) * 10 : 6, `calidad ${fmt(ctx.dataQuality)}`, (ctx.dataQuality ?? 1) < 0.5 ? 'low_data_quality' : null);
  add('freshness', ctx.freshnessOk === false ? 12 : 0, ctx.freshnessOk === false ? 'stale' : 'fresh', ctx.freshnessOk === false ? 'stale_inputs' : null);
  add('source_count', ctx.sourceCount != null ? Math.max(0, (cfg.params.thresholds.minSportsbookSources - ctx.sourceCount)) * 6 : 8, `fuentes ${ctx.sourceCount}`, (ctx.sourceCount || 0) < cfg.params.thresholds.minSportsbookSources ? 'few_sources' : null);
  add('independence', ctx.independenceCount != null ? Math.max(0, (cfg.params.thresholds.minIndependenceGroups - ctx.independenceCount)) * 6 : 6, `grupos ${ctx.independenceCount}`, (ctx.independenceCount || 0) < cfg.params.thresholds.minIndependenceGroups ? 'few_independent_groups' : null);
  add('derived_price', ctx.derivedPrice ? 5 : 0, ctx.derivedPrice ? 'precio derivado' : 'precio directo', ctx.derivedPrice ? 'derived_price' : null);
  add('liquidity', ctx.lowLiquidity ? 6 : 0, ctx.lowLiquidity ? 'baja liquidez' : 'liquidez ok', ctx.lowLiquidity ? 'low_liquidity' : null);
  add('lineup', ctx.lineupMissing ? 5 : 0, ctx.lineupMissing ? 'alineación sin confirmar' : 'contexto ok', ctx.lineupMissing ? 'lineup_unconfirmed' : null);

  const score = Math.min(100, Math.round(c.reduce((a, x) => a + (x.points || 0), 0)));
  const label = score < 25 ? 'low' : score < 50 ? 'medium' : 'high';
  const buffer = +((score / 100) * MAX_BUFFER_PP).toFixed(6);
  return { uncertainty_score: score, uncertainty_label: label, uncertainty_buffer_pp: buffer, warnings: c.filter(x => x.warning).map(x => x.warning), contributions: c, version: cfg.VERSIONS.uncertainty };
}

function clamp(v) { return Math.min(1, Math.max(0, Number(v) || 0)); }
function scale(v, lo, hi, maxPts) { if (!Number.isFinite(v)) return maxPts * 0.4; if (v <= lo) return 0; if (v >= hi) return maxPts; return +(((v - lo) / (hi - lo)) * maxPts).toFixed(3); }
function fmt(v) { return v == null ? 'n/a' : (typeof v === 'number' ? v.toFixed(3) : v); }

module.exports = { compute, MAX_BUFFER_PP };
