'use strict';
// lib/devig.js — de-vig del 1X2 de clubes (2-sep-2026, backtests §3.1 y AUTOPSIA §4.1).
//
// El de-vig PROPORCIONAL (p_i = q_i / Σq) reparte el margen a prorrata y SOBREESTIMA la probabilidad del
// longshot: en el libro de SOLID, cuota >5 ⇒ mercado 17,1 % vs observado 13,1 % (n=84). Shin (1993) modela
// el margen como protección del corredor frente a apostadores informados (fracción z) y lo carga sobre las
// probabilidades pequeñas — la corrección que la literatura de cuotas de fútbol encuentra más cercana a la
// frecuencia real (Štrumbelj 2014). Aquí SOLO se usa en el 1X2 (tres resultados). Los totales (goles,
// córners, tarjetas) siguen con el proporcional a dos lados en su código de siempre: NO pasan por aquí.
//
// Sin dependencias: se puede probar con `node -e` sin arrancar el servidor.

const noVig = require('../value-engine/noVig');

// shinDevig(oddsArr, opts) → { probabilities, z, overround, method, status }
//   oddsArr: cuotas decimales (>1), n ≥ 2 (en el 1X2, [local, empate, visita]).
//   Resuelve z por bisección en f(z) = Σ p_i(z) − 1 con
//     p_i(z) = ( sqrt(z² + 4·(1−z)·q_i²/β) − z ) / (2·(1−z)),   q_i = 1/o_i,   β = Σq_i.
//   f(0) = sqrt(β) − 1 > 0 cuando hay margen; f decrece con z → una sola raíz en (0, 1).
//   Reserva: sin margen (β ≤ 1) o sin cambio de signo → potencia → proporcional (nunca devuelve null si las
//   cuotas son válidas).
function shinDevig(oddsArr, { tol = 1e-12, maxIter = 200 } = {}) {
  const odds = Array.isArray(oddsArr) ? oddsArr.map(Number) : [];
  const valid = odds.length >= 2 && odds.every((o) => Number.isFinite(o) && o > 1);
  if (!valid) return { probabilities: null, z: null, overround: null, method: 'shin', status: 'invalid' };
  const q = odds.map((o) => 1 / o);
  const beta = q.reduce((a, b) => a + b, 0);
  const overround = +(beta - 1).toFixed(8);
  const fallback = (why) => {
    const pw = noVig.power(q);
    if (pw.status === 'ok') return { probabilities: pw.probabilities, z: null, overround, method: 'power', status: 'ok', fallback_reason: why };
    const pr = noVig.proportional(q);
    return { probabilities: pr.probabilities, z: null, overround, method: 'proportional', status: pr.status === 'ok' ? 'ok' : 'invalid', fallback_reason: why };
  };
  if (!(beta > 1 + 1e-9)) return fallback('no_overround'); // sin margen no hay z que estimar
  const probsAt = (z) => q.map((qi) => (Math.sqrt(z * z + 4 * (1 - z) * qi * qi / beta) - z) / (2 * (1 - z)));
  const f = (z) => probsAt(z).reduce((a, b) => a + b, 0) - 1;
  let lo = 0, hi = 1 - 1e-9;
  let flo = f(lo), fhi = f(hi);
  if (!(flo > 0) || !(fhi < 0)) return fallback('no_sign_change');
  let mid = 0;
  for (let i = 0; i < maxIter; i++) {
    mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < tol) break;
    if (fm > 0) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
  }
  const probs = probsAt(mid);
  const s = probs.reduce((a, b) => a + b, 0);
  if (!(s > 0) || probs.some((p) => !Number.isFinite(p) || p < 0)) return fallback('degenerate');
  return { probabilities: probs.map((p) => +(p / s).toFixed(8)), z: +mid.toFixed(8), overround, method: 'shin', status: 'ok' };
}

// mediana simple (misma definición que usa el server en los cierres)
function median(a) {
  const s = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!s.length) return null;
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2;
}

// shinConsensus1x2(books) → { fair, fair_prop, books, method }
//   books: [{ home, draw, away }] cuotas decimales por casa (solo casas con los TRES lados).
//   Shin POR CASA y mediana entre casas por resultado; la mediana de tres medianas no suma exactamente 1, así
//   que se renormaliza a prorrata (ajuste de milésimas, no un de-vig). `fair_prop` es la misma mediana con el
//   proporcional por casa: se guarda al lado para poder comparar los dos en el libro (market_prob_prop).
function shinConsensus1x2(books) {
  const U = ['home', 'draw', 'away'];
  const shinRows = [], propRows = [];
  for (const b of books || []) {
    if (!b) continue;
    const odds = U.map((k) => Number(b[k]));
    if (!odds.every((o) => Number.isFinite(o) && o > 1)) continue;
    const sh = shinDevig(odds);
    const pr = noVig.proportional(odds.map((o) => 1 / o));
    if (sh.status === 'ok' && sh.probabilities) shinRows.push(sh.probabilities);
    if (pr.status === 'ok' && pr.probabilities) propRows.push(pr.probabilities);
  }
  if (!shinRows.length) return { fair: null, fair_prop: null, books: 0, method: 'shin_by_book_median' };
  const norm = (rows) => {
    const med = U.map((_, i) => median(rows.map((r) => r[i])));
    const s = med.reduce((a, b) => a + b, 0);
    const out = {};
    U.forEach((k, i) => { out[k] = +(med[i] / s).toFixed(6); });
    return out;
  };
  return { fair: norm(shinRows), fair_prop: propRows.length ? norm(propRows) : null, books: shinRows.length, method: 'shin_by_book_median' };
}

// publishableProb(pMkt, pGp, c) → p_pub = σ( logit(p_mkt) + c·(logit(p_gp) − logit(p_mkt)) )
//   Blend en logit del backtest (BACKTESTS_FAMILIAS §3.1): c=0 publica el consenso tal cual; c=1 el modelo.
//   Recorta a [1e-4, 1−1e-4] para que el logit exista.
function publishableProb(pMkt, pGp, c) {
  const cl = (p) => Math.min(1 - 1e-4, Math.max(1e-4, Number(p)));
  const logit = (p) => Math.log(p / (1 - p));
  const k = cl(pMkt);
  const cc = Number(c);
  if (!Number.isFinite(cc) || cc === 0) return k;
  const m = Number.isFinite(Number(pGp)) ? cl(pGp) : k;
  const x = logit(k) + cc * (logit(m) - logit(k));
  return 1 / (1 + Math.exp(-x));
}

module.exports = { shinDevig, shinConsensus1x2, publishableProb, median };
