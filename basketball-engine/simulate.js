// basketball-engine/simulate.js — MONTE CARLO DE PARTIDO (15-ago).
//
// Un número solo ("Boston 62.4%") finge una precisión que no existe. Este módulo produce DISTRIBUCIONES:
// probabilidad por margen, por total, de prórroga, de ganar por 1-5 / 6-10 / 11+, e intervalo de confianza
// sobre la propia probabilidad. Todo lo que el panel de partido necesita sale de una sola simulación.
//
// ESTRUCTURA DEL RUIDO, y es la parte que la mayoría hace mal:
//   posesiones ~ N(μ_pace, σ_poss)                        ← compartidas por los dos equipos
//   ambiente   ~ N(0, σ_env)                              ← shock de eficiencia COMPARTIDO
//   ppp_i      = μ_i + ambiente + ε_i,  ε_i ~ N(0, σ_ind)
// El término de AMBIENTE existe porque hay partidos donde anotan los dos y partidos donde no anota nadie
// (arbitraje, ritmo, cansancio). Sin él, la correlación entre los puntos de ambos equipos sale ~0.2 cuando
// la real es 0.39 (medido en 275 partidos WNBA) y el simulador produce TOTALES DEMASIADO ESTRECHOS — o sea
// que sobreestimaría el valor en over/under, justo el mercado que queremos atacar.
// Los tres σ NO son constantes inventadas: salen de los residuos del propio ajuste (ver fitRatings).
//
// PURO y determinista con semilla: la misma entrada da la misma salida, que es condición para que un
// backtest signifique algo.
'use strict';

// PRNG con semilla (mulberry32). Math.random() haría que dos llamadas al mismo partido dieran números
// distintos y el usuario vería la probabilidad "temblar" al refrescar.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// normal estándar por Box-Muller
function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r(); while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const hashSeed = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---- SIMULACIÓN -----------------------------------------------------------------------------------------
// R = rating de fitRatings · devuelve la proyección + todas las distribuciones.
function simulate(R, homeId, awayId, { n = 20000, neutral = false, seed = null, adj = null, otMin = 5, regMin = 40 } = {}) {
  if (!R) return null;
  const off = (id) => (R.off[id] || 0), def = (id) => (R.def[id] || 0), pc = (id) => (R.pace[id] || 0);
  const hca = neutral ? 0 : R.hca;
  // `adj` deja inyectar ajustes exógenos en puntos por 100 (lesiones, descanso, viaje) sin tocar el rating:
  // el motor describe a los equipos, el contexto se suma aparte y queda auditable por separado.
  const aH = (adj && adj.home) || 0, aA = (adj && adj.away) || 0, aP = (adj && adj.pace) || 0;
  const muPoss = R.lgPace + pc(homeId) + pc(awayId) + aP;
  const muH = (R.lgORtg + off(homeId) + def(awayId) + hca / 2 + aH) / 100;   // en PPP
  const muA = (R.lgORtg + off(awayId) + def(homeId) - hca / 2 + aA) / 100;
  const sP = R.sd.poss, sEnv = R.sd.ppp_env, sInd = R.sd.ppp_ind;

  const r = rng(seed != null ? seed : hashSeed(String(homeId) + ':' + String(awayId) + ':' + (R.at || '')));
  let hw = 0, ot = 0, sumH = 0, sumA = 0;
  const margins = new Int16Array(n), totals = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const poss = Math.max(55, muPoss + sP * gauss(r));
    const env = sEnv * gauss(r);
    let ph = Math.max(0.55, muH + env + sInd * gauss(r));
    let pa = Math.max(0.55, muA + env + sInd * gauss(r));
    let h = Math.round(poss * ph), a = Math.round(poss * pa);
    if (h === a) {
      // PRÓRROGA: 5 minutos con el ritmo prorrateado. Se resuelve de verdad en vez de romper el empate a
      // cara o cruz — el empate no es simétrico si un equipo es mejor, y P(prórroga) es un mercado propio.
      ot++;
      let guard = 0;
      while (h === a && guard++ < 6) {
        const op = Math.max(4, (poss * otMin / regMin));
        h += Math.round(op * Math.max(0.4, ph + 0.12 * gauss(r)));
        a += Math.round(op * Math.max(0.4, pa + 0.12 * gauss(r)));
      }
      if (h === a) h += (r() < 0.5 ? 1 : -1) * 2;   // rarísimo tras 6 prórrogas: se desempata y se sigue
    }
    if (h > a) hw++;
    margins[i] = h - a; totals[i] = h + a;
    sumH += h; sumA += a;
  }
  const p = hw / n;
  // INTERVALO sobre la propia probabilidad: error estándar binomial de la simulación + incertidumbre del
  // rating por muestra corta. Un equipo con 6 partidos jugados no merece la misma barra que uno con 38.
  const nH = R.n[homeId] || 0, nA = R.n[awayId] || 0;
  const seSim = Math.sqrt(p * (1 - p) / n);
  const seFit = 0.5 * Math.sqrt(1 / Math.max(3, nH) + 1 / Math.max(3, nA));   // ~puntos de margen por 100
  const sePts = seFit * muPoss / 100;                                          // a puntos de margen
  const seP = Math.min(0.18, sePts * 0.028 + seSim * 1.96);                    // 0.028 ≈ dP/dpuntos cerca del 50%
  const sorted = Array.from(margins).sort((x, y) => x - y);
  const tsorted = Array.from(totals).sort((x, y) => x - y);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  const band = (lo, hi) => { let c = 0; for (let i = 0; i < n; i++) { const m = margins[i]; if (m >= lo && m <= hi) c++; } return +(c / n).toFixed(4); };
  return {
    n, neutral,
    poss: +muPoss.toFixed(2),
    home_pts: +(sumH / n).toFixed(2), away_pts: +(sumA / n).toFixed(2),
    margin: +((sumH - sumA) / n).toFixed(2), total: +((sumH + sumA) / n).toFixed(2),
    win: { home: +p.toFixed(4), away: +(1 - p).toFixed(4) },
    win_ci: { lo: +Math.max(0, p - seP).toFixed(4), hi: +Math.min(1, p + seP).toFixed(4) },
    ot_prob: +(ot / n).toFixed(4),
    margin_q: { p05: q(sorted, .05), p25: q(sorted, .25), p50: q(sorted, .5), p75: q(sorted, .75), p95: q(sorted, .95) },
    total_q: { p05: q(tsorted, .05), p25: q(tsorted, .25), p50: q(tsorted, .5), p75: q(tsorted, .75), p95: q(tsorted, .95) },
    // los cubos que pidió el panel: ganar ajustado / cómodo / paliza, por lado
    bands: {
      home_1_5: band(1, 5), home_6_10: band(6, 10), home_11p: band(11, 999),
      away_1_5: band(-5, -1), away_6_10: band(-10, -6), away_11p: band(-999, -11),
    },
    // histograma de margen recortado a ±30 para pintar la curva sin outliers que aplasten la escala
    margin_hist: (() => { const h = {}; for (let i = 0; i < n; i++) { const k = Math.max(-30, Math.min(30, margins[i])); h[k] = (h[k] || 0) + 1; } return Object.entries(h).map(([k, v]) => [+k, +(v / n).toFixed(5)]).sort((a, b) => a[0] - b[0]); })(),
    total_hist: (() => { const h = {}; for (let i = 0; i < n; i++) { const k = Math.round(totals[i] / 5) * 5; h[k] = (h[k] || 0) + 1; } return Object.entries(h).map(([k, v]) => [+k, +(v / n).toFixed(5)]).sort((a, b) => a[0] - b[0]); })(),
    conf: nH >= 15 && nA >= 15 ? 'alta' : (nH >= 8 && nA >= 8 ? 'media' : 'baja'),
  };
}

// ---- MERCADOS DERIVADOS ---------------------------------------------------------------------------------
// De la MISMA simulación salen las tres familias. Que compartan simulación no es un ahorro: es la garantía
// de que ganador, hándicap y total son coherentes entre sí (no se puede favorecer al local en el moneyline
// y al visitante en el hándicap por redondeos distintos).
function markets(sim, { spreads = null, totalsLines = null } = {}) {
  if (!sim) return null;
  const hist = sim.margin_hist, tot = sim.total_hist;
  const pMarginGT = (line) => hist.filter(([m]) => m > line).reduce((s, [, p]) => s + p, 0);
  const pTotalGT = (line) => tot.filter(([t]) => t > line).reduce((s, [, p]) => s + p, 0);
  const half = (x) => Math.abs(x % 1) === 0.5;
  const sp = spreads || [-12.5, -9.5, -6.5, -4.5, -2.5, -1.5, 1.5, 2.5, 4.5, 6.5, 9.5, 12.5];
  const tl = totalsLines || [sim.total - 10, sim.total - 5, sim.total, sim.total + 5, sim.total + 10].map(x => Math.round(x) + 0.5);
  const fair = (p) => (p > 0.001 && p < 0.999 ? +(1 / p).toFixed(3) : null);
  return {
    moneyline: { home: sim.win.home, away: sim.win.away, fair_home: fair(sim.win.home), fair_away: fair(sim.win.away) },
    // hándicap: "local −4.5" gana si el margen > 4.5. Solo líneas .5 para no lidiar con empates (push).
    spread: sp.filter(half).map(line => { const p = pMarginGT(line); return { line, home: +p.toFixed(4), away: +(1 - p).toFixed(4), fair_home: fair(p), fair_away: fair(1 - p) }; }),
    total: tl.filter(half).map(line => { const p = pTotalGT(line); return { line, over: +p.toFixed(4), under: +(1 - p).toFixed(4), fair_over: fair(p), fair_under: fair(1 - p) }; }),
    ot: { yes: sim.ot_prob, fair_yes: fair(sim.ot_prob) },
  };
}

module.exports = { simulate, markets, rng, gauss };
