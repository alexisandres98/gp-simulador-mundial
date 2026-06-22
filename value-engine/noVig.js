// value-engine/noVig.js — Sprint 7 §13-14. Métodos no-vig VERSIONADOS. No se elige el método por mayor edge.
'use strict';

const sum = a => a.reduce((x, y) => x + y, 0);

// proportional(qs) → { probabilities, overround, method }   p_i = q_i / Σq_i
function proportional(qs) {
  const valid = qs.every(q => Number.isFinite(q) && q > 0);
  if (!valid || qs.length < 2) return { probabilities: null, overround: null, method: 'no-vig-proportional-1', status: 'invalid' };
  const s = sum(qs);
  return { probabilities: qs.map(q => +(q / s).toFixed(8)), overround: +(s - 1).toFixed(8), method: 'no-vig-proportional-1', status: 'ok' };
}

// power(qs, opts) → { probabilities, overround, k, method }   encuentra k tal que Σ(q_i^k)=1, p_i=q_i^k.
// Solver de bisección determinístico con tolerancia y límites.
function power(qs, { tol = 1e-10, maxIter = 200, kLo = 0.2, kHi = 5 } = {}) {
  const valid = qs.every(q => Number.isFinite(q) && q > 0);
  if (!valid || qs.length < 2) return { probabilities: null, overround: null, k: null, method: 'no-vig-power-1', status: 'invalid' };
  const f = k => sum(qs.map(q => Math.pow(q, k))) - 1; // decreciente en k (qs<1)
  let lo = kLo, hi = kHi, flo = f(lo), fhi = f(hi);
  // expandir hi si hace falta
  let guard = 0;
  while (flo * fhi > 0 && guard++ < 40) { hi *= 1.5; fhi = f(hi); if (hi > 1e6) break; }
  if (flo * fhi > 0) return { probabilities: null, overround: null, k: null, method: 'no-vig-power-1', status: 'no_convergence' };
  let mid = (lo + hi) / 2;
  for (let i = 0; i < maxIter; i++) {
    mid = (lo + hi) / 2; const fm = f(mid);
    if (Math.abs(fm) < tol) break;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  const probs = qs.map(q => Math.pow(q, mid));
  const s = sum(probs);
  return { probabilities: probs.map(p => +(p / s).toFixed(8)), overround: +(sum(qs) - 1).toFixed(8), k: +mid.toFixed(8), method: 'no-vig-power-1', status: 'ok' };
}

// removeVig(rawProbs, { method }) → resultado del método pedido + el alternativo para sensibilidad.
function removeVig(rawProbs, { method = 'proportional' } = {}) {
  const official = method === 'power' ? power(rawProbs) : proportional(rawProbs);
  const alt = method === 'power' ? proportional(rawProbs) : power(rawProbs);
  let disagreement = null;
  if (official.status === 'ok' && alt.status === 'ok') {
    disagreement = +Math.max(...official.probabilities.map((p, i) => Math.abs(p - alt.probabilities[i]))).toFixed(8);
  }
  return { official, alternative: alt, method_disagreement: disagreement, method_disagreement_warning: disagreement != null && disagreement > 0.02 };
}

module.exports = { proportional, power, removeVig };
