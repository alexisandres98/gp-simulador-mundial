// nfl-engine/simulate.js — LA DISTRIBUCIÓN CONJUNTA (margen, total), no dos medias sueltas (17-ago).
//
// El blueprint §17 es explícito: para spreads/totales hay que generar una distribución CONJUNTA con la masa
// real en los números clave (NFL-0454/0460/0461). La forma honesta de conseguirla sin inventar una Normal:
//
//   (margen, total) = (mu_margen, mu_total) + PAR DE RESIDUOS muestreado del histórico real contra el
//   cierre 2016-2025 (2.761 partidos) + ruido discreto por la varianza EXTRA del modelo medida fuera de
//   muestra (nuestro mu es peor que el cierre en ~3.6/3.3 puntos de desvío; fingir lo contrario sería
//   vestirse con la precisión del mercado sin tenerla).
//
// Muestrear PARES del mismo partido conserva gratis lo que a los modelos paramétricos les cuesta:
//   · la masa en 3/6/7/10/14 (los residuos vienen de marcadores reales de NFL),
//   · la correlación margen-total (las palizas suelen venir con más puntos),
//   · las colas pesadas reales.
//
// La semilla es determinista y viaja con cada predicción (NFL-0479): la misma entrada reproduce la misma
// distribución, y una auditoría puede repetir el cálculo.
'use strict';

// mulberry32 — determinista, suficiente para Monte Carlo de producto
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ruido discreto ~ N(0, sigma) redondeado — mantiene los margenes en la rejilla entera donde viven los
// números clave; un ruido continuo desharía la masa que el pool trae de la realidad
function discreteNoise(rnd, sigma) {
  if (!sigma) return 0;
  const u1 = Math.max(1e-9, rnd()), u2 = rnd();
  return Math.round(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma);
}

function simulate({ muMargin, muTotal, priors, n = 20000, seed = 17 }) {
  const pool = (priors && priors.resid_pool) || [];
  if (!pool.length) return null;
  const sm = (priors && priors.sigma_extra_margin) || 0;
  const st = (priors && priors.sigma_extra_total) || 0;
  const rnd = rng(seed);
  const margins = new Array(n), totals = new Array(n);
  let homeWin = 0, tie = 0;
  const marginMass = {}, totalMass = {};
  for (let i = 0; i < n; i++) {
    const p = pool[(rnd() * pool.length) | 0];
    const m = Math.round(muMargin + p[0] + discreteNoise(rnd, sm));
    const t = Math.max(2, Math.round(muTotal + p[1] + discreteNoise(rnd, st)));
    margins[i] = m; totals[i] = t;
    if (m > 0) homeWin++; else if (m === 0) tie++;
    marginMass[m] = (marginMass[m] || 0) + 1;
    totalMass[t] = (totalMass[t] || 0) + 1;
  }
  margins.sort((a, b) => a - b); totals.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  // CDFs para cotizar cualquier línea alternativa desde la misma distribución (NFL-0464)
  const coverProb = (line) => {           // P(local cubre línea `line` — línea del local, positiva = favorito)
    let c = 0, push = 0;
    for (const m of margins) { if (m > line) c++; else if (m === line) push++; }
    return { p: c / Math.max(1, n - push), push: +(push / n).toFixed(4) };
  };
  const overProb = (line) => {
    let c = 0, push = 0;
    for (const t of totals) { if (t > line) c++; else if (t === line) push++; }
    return { p: c / Math.max(1, n - push), push: +(push / n).toFixed(4) };
  };
  // masa en los números clave, en ambos signos (NFL-0460)
  const key = {};
  for (const k of [3, 6, 7, 10, 14]) {
    key[k] = +(((marginMass[k] || 0) + (marginMass[-k] || 0)) / n).toFixed(4);
  }
  return {
    n, seed,
    mu_margin: +muMargin.toFixed(2), mu_total: +muTotal.toFixed(2),
    p_home: +((homeWin + 0.5 * tie) / n).toFixed(4),
    p_tie: +(tie / n).toFixed(4),
    margin: { p10: q(margins, 0.10), p25: q(margins, 0.25), p50: q(margins, 0.50), p75: q(margins, 0.75), p90: q(margins, 0.90) },
    total: { p10: q(totals, 0.10), p25: q(totals, 0.25), p50: q(totals, 0.50), p75: q(totals, 0.75), p90: q(totals, 0.90) },
    // equipo local/visitante: derivados del par (total±margen)/2 — se publican como medias, no como marcador exacto
    team_home_mu: +((muTotal + muMargin) / 2).toFixed(1),
    team_away_mu: +((muTotal - muMargin) / 2).toFixed(1),
    key_mass: key,
    margin_hist: Object.fromEntries(Object.entries(marginMass).filter(([, c]) => c / n >= 0.004).map(([k, c]) => [k, +(c / n).toFixed(4)])),
    total_hist: Object.fromEntries(Object.entries(totalMass).filter(([, c]) => c / n >= 0.004).map(([k, c]) => [k, +(c / n).toFixed(4)])),
    coverProb, overProb,
  };
}

module.exports = { simulate, rng };
