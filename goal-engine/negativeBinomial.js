// goal-engine/negativeBinomial.js — Fase N.7. Alternativa con OVERDISPERSION (Negative Binomial) para goles.
// PURO. La varianza observada (3.51) supera a la del Poisson (2.77) → el NB permite var = μ + μ²/r (r = dispersión;
// r→∞ recupera Poisson). Se evalúa en SHADOW contra Poisson+DC; NO sustituye el modelo oficial automáticamente.
'use strict';
const DC_RHO = -0.13, CALIB_LAMBDA = 0.15;

// NB pmf por media μ y dispersión r: P(k) = C(k+r-1,k) (r/(r+μ))^r (μ/(r+μ))^k
function nbPmf(mu, r, k) {
  if (mu <= 0) return k === 0 ? 1 : 0;
  const p = r / (r + mu);
  // log-gamma para estabilidad
  const lg = x => { // Lanczos
    const g = [76.18009172947146,-86.50532032941677,24.01409824083091,-1.231739572450155,0.1208650973866179e-2,-0.5395239384953e-5];
    let xx = x, y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) { y += 1; ser += g[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / xx);
  };
  const logp = lg(k + r) - lg(r) - lg(k + 1) + r * Math.log(p) + k * Math.log(1 - p);
  return Math.exp(logp);
}
function dcTau(h, a, lh, la) {
  if (h === 0 && a === 0) return 1 - lh * la * DC_RHO;
  if (h === 0 && a === 1) return 1 + lh * DC_RHO;
  if (h === 1 && a === 0) return 1 + la * DC_RHO;
  if (h === 1 && a === 1) return 1 - DC_RHO;
  return 1;
}
function calib(pH, pD, pA) { const L = CALIB_LAMBDA; return { home: (1 - L) * pH + L / 3, draw: (1 - L) * pD + L / 3, away: (1 - L) * pA + L / 3 }; }

// matriz NB + DC. dispersion r típico fútbol ~ 6-12 (cuanto menor, más overdispersion).
function buildMatrixNB(lh, la, { r = 8, n = 12 } = {}) {
  const ph = [], pa = [];
  for (let k = 0; k <= n; k++) { ph.push(nbPmf(lh, r, k)); pa.push(nbPmf(la, r, k)); }
  const M = []; let T = 0;
  for (let h = 0; h <= n; h++) { M[h] = []; for (let a = 0; a <= n; a++) { const p = ph[h] * pa[a] * dcTau(h, a, lh, la); M[h][a] = p; T += p; } }
  return { matrix: M.map(row => row.map(p => p / T)), mass: T };
}

function oneX2(matrix) { let pH = 0, pD = 0, pA = 0; for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) { const p = matrix[h][a]; if (h > a) pH += p; else if (h === a) pD += p; else pA += p; } const c = calib(pH, pD, pA); return { raw: { home: pH, draw: pD, away: pA }, calibrated: c }; }
function overProb(matrix, line) { let o = 0; for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) if (h + a > line) o += matrix[h][a]; return o; }
function bttsYes(matrix) { let y = 0; for (let h = 1; h < matrix.length; h++) for (let a = 1; a < matrix[h].length; a++) y += matrix[h][a]; return y; }

// desacuerdo entre familias (Poisson+DC vs NB): media |Δ| en O/U 2.5 + BTTS + 1X2. Contribuye a uncertainty.
function familyDisagreement(poissonMatrix, nbMatrix) {
  const dOU = Math.abs(overProb(poissonMatrix, 2.5) - overProb(nbMatrix, 2.5));
  const dBT = Math.abs(bttsYes(poissonMatrix) - bttsYes(nbMatrix));
  const p1 = oneX2(poissonMatrix).calibrated, n1 = oneX2(nbMatrix).calibrated;
  const d1 = (Math.abs(p1.home - n1.home) + Math.abs(p1.draw - n1.draw) + Math.abs(p1.away - n1.away)) / 3;
  return +(((dOU + dBT + d1) / 3)).toFixed(6);
}

module.exports = { nbPmf, buildMatrixNB, oneX2, overProb, bttsYes, familyDisagreement };
