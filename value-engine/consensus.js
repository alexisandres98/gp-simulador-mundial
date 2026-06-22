// value-engine/consensus.js — Sprint 7 §15. Consenso robusto (mediana) por outcome con grupos de independencia.
// No incluye stale/incompletos/reglas incompatibles. Máx. un voto pleno por independence_group. Exclusiones auditadas.
'use strict';

const OUTCOMES = ['home', 'draw', 'away'];
function median(xs) { const a = xs.filter(Number.isFinite).slice().sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function trimmedMean(xs, trim = 0.1) { const a = xs.filter(Number.isFinite).slice().sort((p, q) => p - q); if (!a.length) return null; const k = Math.floor(a.length * trim); const b = a.slice(k, a.length - k); const c = b.length ? b : a; return c.reduce((x, y) => x + y, 0) / c.length; }

// compute(books, opts) → consenso.
//   books: [{ sportsbook, operator_group/independence_group, probabilities:{home,draw,away}, complete, fresh, reason }]
function compute(books = []) {
  const exclusions = [];
  const included = [];
  for (const b of books) {
    if (b.complete === false) { exclusions.push({ sportsbook: b.sportsbook, reason: 'incomplete_market' }); continue; }
    if (b.fresh === false) { exclusions.push({ sportsbook: b.sportsbook, reason: 'stale' }); continue; }
    if (!b.probabilities || OUTCOMES.some(o => !Number.isFinite(b.probabilities[o]))) { exclusions.push({ sportsbook: b.sportsbook, reason: 'invalid_probabilities' }); continue; }
    included.push(b);
  }
  if (!included.length) return { status: 'unavailable', reason: 'no_valid_books', source_count: 0, independence_groups: 0, exclusions };

  // colapsar cada independence_group a su mediana (máx. un voto pleno por grupo)
  const groups = new Map();
  for (const b of included) {
    const g = b.independence_group || b.operator_group || b.sportsbook;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(b);
  }
  const groupReps = [];
  for (const [g, bs] of groups) {
    const rep = {}; for (const o of OUTCOMES) rep[o] = median(bs.map(x => x.probabilities[o]));
    groupReps.push({ group: g, books: bs.map(x => x.sportsbook), probabilities: rep });
  }

  const out = { status: 'ok', method: 'median_by_outcome_v1', sportsbooks_included: included.map(b => b.sportsbook), source_count: included.length, independence_groups: groupReps.length, probability_by_book: included.map(b => ({ sportsbook: b.sportsbook, group: b.independence_group || b.operator_group || b.sportsbook, probabilities: b.probabilities })), exclusions };
  const med = {}, tmean = {}, mn = {}, mx = {}, disp = {};
  for (const o of OUTCOMES) {
    const vals = groupReps.map(r => r.probabilities[o]).filter(Number.isFinite);
    med[o] = round(median(vals)); tmean[o] = round(trimmedMean(vals)); mn[o] = round(Math.min(...vals)); mx[o] = round(Math.max(...vals)); disp[o] = round(Math.max(...vals) - Math.min(...vals));
  }
  // renormalizar la mediana para que sume 1 (la mediana por outcome no garantiza Σ=1)
  const s = OUTCOMES.reduce((a, o) => a + med[o], 0);
  out.median_probability = {}; for (const o of OUTCOMES) out.median_probability[o] = round(med[o] / s);
  out.trimmed_mean_probability = tmean; out.min_probability = mn; out.max_probability = mx;
  out.dispersion = round(Math.max(...OUTCOMES.map(o => disp[o])));
  out.dispersion_by_outcome = disp;
  return out;
}

function round(v) { return v == null ? null : +v.toFixed(8); }

module.exports = { compute, median, trimmedMean, OUTCOMES };
