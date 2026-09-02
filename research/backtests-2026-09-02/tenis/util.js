'use strict';
// utilidades compartidas de los backtests de tenis: logística con offset, métricas, bootstrap, CRPS
const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lg = (p) => logit(clamp(p, 1e-4, 1 - 1e-4));

// métricas de clasificación binaria (misma definición que scripts/tennis-fit.js)
function metrics(predsIn) {
  // un NaN en p colgaba el bucle de empates del AUC (NaN !== NaN): se cuenta y se sustituye por 0,5
  let nans = 0; const preds = predsIn.map((o) => (Number.isFinite(o.p) ? o : (nans++, { p: 0.5, y: o.y })));
  if (nans) console.warn(`[metrics] ${nans} predicciones NaN → 0,5`);
  let ll = 0, br = 0, acc = 0;
  for (const { p, y } of preds) {
    const pc = clamp(p, 1e-6, 1 - 1e-6);
    ll += y ? -Math.log(pc) : -Math.log(1 - pc);
    br += (pc - y) * (pc - y);
    acc += (pc >= 0.5) === (y === 1) ? 1 : 0;
  }
  const n = preds.length;
  const sorted = [...preds].sort((a, b) => a.p - b.p);
  let sumRankPos = 0, nPos = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i; while (j < sorted.length && sorted[j].p === sorted[i].p) j++;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) { if (sorted[k].y === 1) { sumRankPos += avg; nPos++; } }
    i = j;
  }
  const nNeg = n - nPos;
  const auc = nNeg && nPos ? (sumRankPos - nPos * (nPos + 1) / 2) / (nPos * nNeg) : 0.5;
  return { n, logloss: ll / n, brier: br / n, acc: acc / n, auc, skill_pct: 100 * (1 - (ll / n) / Math.log(2)) };
}

// regresión logística por Newton-Raphson con ridge pequeño. X: filas de features (sin intercepto),
// offset: término fijo en el logit (p.ej. logit del ensamble), y: 0/1. Devuelve coeficientes, SE, t.
function logisticFit(X, y, offset, { intercept = true, ridge = 1e-4, iters = 50 } = {}) {
  const k0 = X[0].length, k = k0 + (intercept ? 1 : 0);
  const row = (i) => (intercept ? [1, ...X[i]] : X[i]);
  let b = new Array(k).fill(0);
  const solve = (A, g) => { // Gauss con pivote
    const n = g.length; const M = A.map((r, i) => [...r, g[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-14) return null;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let cc = c; cc <= n; cc++) M[r][cc] -= f * M[c][cc]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  };
  let H = null;
  // log-verosimilitud penalizada (para el amortiguamiento del paso de Newton)
  const pll = (bb) => { let s = 0; for (let i = 0; i < X.length; i++) { const xi = row(i); let z = offset ? offset[i] : 0; for (let j = 0; j < k; j++) z += bb[j] * xi[j]; const p = clamp(sig(z), 1e-12, 1 - 1e-12); s += y[i] ? Math.log(p) : Math.log(1 - p); } for (let j = 0; j < k; j++) s -= 0.5 * ridge * bb[j] * bb[j]; return s; };
  let cur = pll(b);
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0); H = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? ridge : 0)));
    for (let i = 0; i < X.length; i++) {
      const xi = row(i); let z = offset ? offset[i] : 0; for (let j = 0; j < k; j++) z += b[j] * xi[j];
      const p = sig(z), w = p * (1 - p);
      for (let j = 0; j < k; j++) { g[j] += (y[i] - p) * xi[j] - ridge * b[j]; for (let l = 0; l < k; l++) H[j][l] += w * xi[j] * xi[l]; }
    }
    const step = solve(H, g); if (!step) break;
    // Newton amortiguado: se acorta el paso hasta que la verosimilitud penalizada no baje (evita la divergencia
    // con columnas colineales o eventos raros, que disparaba coeficientes a 1e+170)
    let lam = 1, nb = null, nl = -Infinity;
    for (let h = 0; h < 12; h++) { nb = b.map((v, j) => v + lam * step[j]); nl = pll(nb); if (nl >= cur - 1e-9) break; lam /= 2; }
    if (nl < cur - 1e-9) break;
    const moved = Math.max(...step.map((s) => Math.abs(s * lam)));
    b = nb; cur = nl;
    if (moved < 1e-8) break;
  }
  // SE a partir de la inversa de H (columnas de la identidad)
  const se = new Array(k).fill(NaN);
  for (let j = 0; j < k; j++) { const e = new Array(k).fill(0); e[j] = 1; const col = solve(H, e); if (col) se[j] = Math.sqrt(Math.max(0, col[j])); }
  const predict = (xr, off) => sig((off || 0) + (intercept ? b[0] : 0) + xr.reduce((s, v, j) => s + v * b[j + (intercept ? 1 : 0)], 0));
  return { coef: b, se, t: b.map((v, j) => v / se[j]), predict, intercept };
}

// bootstrap pareado de una diferencia de medias por partido (métrica base − variante): media, SE, IC95
function pairedBootstrap(diffs, B = 2000, seed = 7) {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const n = diffs.length; const means = [];
  for (let b = 0; b < B; b++) { let acc = 0; for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)]; means.push(acc / n); }
  means.sort((a, b) => a - b);
  const m = diffs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(means.reduce((a, v) => a + (v - m) ** 2, 0) / B);
  return { mean: m, se: sd, lo95: means[Math.floor(0.025 * B)], hi95: means[Math.floor(0.975 * B)], t: sd ? m / sd : 0, n };
}
function meanSe(xs) { const n = xs.length; const m = xs.reduce((a, b) => a + b, 0) / n; const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, n - 1); return { mean: m, se: Math.sqrt(v / n), sd: Math.sqrt(v), n, t: m / Math.sqrt(v / n) }; }

// distribuciones discretas de juegos: objeto {min, p:[...]} sobre enteros min..min+p.length-1
function distFromPairs(pairs) { const min = pairs[0][0], max = pairs[pairs.length - 1][0]; const p = new Array(max - min + 1).fill(0); for (const [g, pr] of pairs) p[g - min] += pr; return { min, p }; }
function distMean(d) { let m = 0; d.p.forEach((pr, i) => { m += pr * (d.min + i); }); return m; }
function distSd(d) { const m = distMean(d); let v = 0; d.p.forEach((pr, i) => { v += pr * (d.min + i - m) ** 2; }); return Math.sqrt(Math.max(0, v)); }
function distMedian(d) { let c = 0; for (let i = 0; i < d.p.length; i++) { c += d.p[i]; if (c >= 0.5) return d.min + i; } return d.min + d.p.length - 1; }
function distCdf(d, x) { let c = 0; for (let i = 0; i < d.p.length; i++) { if (d.min + i <= x) c += d.p[i]; else break; } return c; }
function distPover(d, line) { let s = 0; for (let i = 0; i < d.p.length; i++) if (d.min + i > line) s += d.p[i]; return s; }
function distPmf(d, g) { const i = g - d.min; return i >= 0 && i < d.p.length ? d.p[i] : 0; }
// transformación afín g' = a + b·g con reparto fraccional de la masa entre enteros vecinos
function distAffine(d, a, b) {
  const vals = d.p.map((pr, i) => [a + b * (d.min + i), pr]);
  const lo = Math.floor(Math.min(...vals.map((v) => v[0]))), hi = Math.ceil(Math.max(...vals.map((v) => v[0])));
  const p = new Array(hi - lo + 1).fill(0);
  for (const [x, pr] of vals) { const f = Math.floor(x), w = x - f; p[f - lo] += pr * (1 - w); if (w > 0) p[f + 1 - lo] += pr * w; }
  return { min: lo, p };
}
function distMix(d1, d2, m) { // (1−m)·d1 + m·d2
  const lo = Math.min(d1.min, d2.min), hi = Math.max(d1.min + d1.p.length, d2.min + d2.p.length) - 1;
  const p = new Array(hi - lo + 1).fill(0);
  d1.p.forEach((pr, i) => { p[d1.min + i - lo] += (1 - m) * pr; }); d2.p.forEach((pr, i) => { p[d2.min + i - lo] += m * pr; });
  return { min: lo, p };
}
function crps(d, x) { // CRPS discreto: Σ_k (F(k) − 1[x ≤ k])² sobre el soporte
  let c = 0, s = 0; const lo = Math.min(d.min, x), hi = Math.max(d.min + d.p.length - 1, x);
  for (let k = lo; k <= hi; k++) { c += distPmf(d, k); s += (c - (x <= k ? 1 : 0)) ** 2; }
  return s;
}
const r = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);

module.exports = { logit, sig, clamp, lg, metrics, logisticFit, pairedBootstrap, meanSe, distFromPairs, distMean, distSd, distMedian, distCdf, distPover, distPmf, distAffine, distMix, crps, r };
