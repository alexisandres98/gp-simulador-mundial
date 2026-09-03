'use strict';
// clubs-engine/eloOdds.js — RATING ALIMENTADO CON CUOTAS (3-sep-2026, BACKTESTS_FAMILIAS §3.6). PURO, sin I/O.
//
// Idea (Wunderlich & Memmert, PLoS ONE 2018): el Elo de resultados aprende de UN bit ruidoso por partido (quién
// ganó). El cierre del mercado, sin margen, resume mucha más información (plantilla, bajas, forma real). Un Elo
// cuyo "resultado observado" es la ESPERANZA IMPLÍCITA DEL CIERRE (p_local + ½·p_empate, con de-vig de Shin)
// converge hacia la fuerza que cotiza el mercado y la arrastra al siguiente partido — aprende de las cuotas
// sin copiarlas: entre partido y partido el rating es propio y la probabilidad sale del MISMO matchProbs.
//
// Este módulo comparte la matemática entre tres sitios: scripts/clubs-rating-backtest.js (walk-forward con
// football-data), scripts/smoke/elo-odds-smoke.js (prueba unitaria) y server.js (rating paralelo
// db.clubElosOdds, apagado tras GP_CLUB_ELO_SOURCE). La actualización con RESULTADO replica applyClubElo de
// server.js (K=30, factor G por margen, localía de la liga) para que el backtest mida las constantes de
// producción y no una copia aproximada.

const BASE_ELO = 1500;
const K_RESULT = 30;   // = CLUB_ELO_K de server.js (ligas domésticas)
const K_ODDS = 250;    // elegido en desarrollo (docs/ELO_CUOTAS_BACKTEST.md): cada partido cierra ≈72 % de la
                       // brecha Elo↔mercado; con K≥350 sobrepasa y empeora. Override: GP_CLUB_ELO_ODDS_K.
const W_HYBRID = 0.75; // peso de las cuotas en el modo híbrido (backtest); override: GP_CLUB_ELO_ODDS_W
const EPS = 1e-4;

// esperanza del local con su ventaja de cancha (logística de Elo)
function winExpectancy(eH, eA, hfa) { return 1 / (1 + Math.pow(10, -((eH + (hfa || 0)) - eA) / 400)); }

// factor G por margen de gol (mismo de applyClubElo / eloratings.net)
function marginFactor(hg, ag) {
  const margin = Math.abs(hg - ag);
  return margin <= 1 ? 1 : margin === 2 ? 1.5 : (11 + margin) / 8;
}

// Δ del LOCAL con el resultado (el visitante recibe −Δ). Idéntico a applyClubElo.
function resultDelta(eH, eA, hfa, hg, ag, K = K_RESULT) {
  const we = winExpectancy(eH, eA, hfa);
  const W = hg > ag ? 1 : hg === ag ? 0.5 : 0;
  return K * marginFactor(hg, ag) * (W - we);
}

// Esperanza implícita del cierre: p_local + ½·p_empate (misma escala que el resultado 1/½/0 del Elo).
// fair = { home, draw, away } sin margen (Shin). Devuelve null si no es una distribución válida.
function marketExpectancy(fair) {
  if (!fair) return null;
  const h = Number(fair.home), d = Number(fair.draw), a = Number(fair.away);
  if (![h, d, a].every((p) => Number.isFinite(p) && p >= 0)) return null;
  const s = h + d + a; if (!(s > 0.5 && s < 1.5)) return null;
  return Math.min(1 - EPS, Math.max(EPS, (h + 0.5 * d) / s));
}

// Δ del LOCAL con las CUOTAS (Wunderlich-Memmert): la observación es la esperanza del mercado, no el resultado.
function oddsDelta(eH, eA, hfa, fair, K = K_ODDS) {
  const em = marketExpectancy(fair);
  if (em == null) return null;
  return K * (em - winExpectancy(eH, eA, hfa));
}

// Diferencia de Elo (con localía incluida) que el mercado está cotizando: inversa de la logística.
function ratingDiffFromExpectancy(e) {
  const p = Math.min(1 - EPS, Math.max(EPS, Number(e)));
  return -400 * Math.log10(1 / p - 1);
}

// Actualización combinada: modo 'odds' (solo cuotas), 'results' (solo resultado), 'hybrid' (mezcla con peso w
// sobre el Δ de cuotas). Sin cierre disponible cae al resultado (el rating nunca se queda parado).
//   → { delta, used: 'odds'|'results'|'hybrid' } (delta = Δ del local; el visitante recibe −delta)
function combinedDelta({ eH, eA, hfa, hg, ag, fair, mode = 'odds', w = W_HYBRID, kOdds = K_ODDS, kResult = K_RESULT }) {
  const hasResult = Number.isFinite(hg) && Number.isFinite(ag);
  const dO = fair ? oddsDelta(eH, eA, hfa, fair, kOdds) : null;
  const dR = hasResult ? resultDelta(eH, eA, hfa, hg, ag, kResult) : null;
  if (mode === 'results') return dR != null ? { delta: dR, used: 'results' } : { delta: 0, used: 'none' };
  if (mode === 'hybrid') {
    if (dO != null && dR != null) return { delta: w * dO + (1 - w) * dR, used: 'hybrid' };
    if (dO != null) return { delta: dO, used: 'odds' };
    return dR != null ? { delta: dR, used: 'results' } : { delta: 0, used: 'none' };
  }
  if (dO != null) return { delta: dO, used: 'odds' };
  return dR != null ? { delta: dR, used: 'results' } : { delta: 0, used: 'none' };
}

// Regresión a la media entre temporadas: elo' = mean + (1−alpha)·(elo − mean). alpha=0 arrastra tal cual,
// alpha=1 reinicia al prior. Devuelve un mapa NUEVO (no muta).
function regressSeason(elos, alpha, mean = BASE_ELO) {
  const a = Math.min(1, Math.max(0, Number(alpha) || 0));
  const out = {};
  for (const [id, e] of Object.entries(elos || {})) out[id] = mean + (1 - a) * (Number(e) - mean);
  return out;
}

// Aplica una actualización sobre un overlay { tid: elo } (mismo contrato que db.clubElos: valores ABSOLUTOS
// redondeados a décimas). eH/eA son los Elo pre-partido que se usaron para predecir (ya con offsets de copa
// resueltos por quien llama); offH/offA se restan al guardar (prior por división, ver applyClubElo).
function applyToOverlay(overlay, hId, aId, eH, eA, delta, offH = 0, offA = 0) {
  overlay[hId] = Math.round((eH - offH + delta) * 10) / 10;
  overlay[aId] = Math.round((eA - offA - delta) * 10) / 10;
  return overlay;
}

// Env: fuente del rating que lee clubElo() en producción. 'results' (default) = comportamiento de siempre.
function eloSource(env = process.env) {
  const s = String(env.GP_CLUB_ELO_SOURCE || 'results').trim().toLowerCase();
  return s === 'odds' ? 'odds' : 'results';
}
function oddsParams(env = process.env) {
  const k = Number(env.GP_CLUB_ELO_ODDS_K);
  const w = Number(env.GP_CLUB_ELO_ODDS_W);
  const mode = String(env.GP_CLUB_ELO_ODDS_MODE || 'odds').trim().toLowerCase();
  return {
    kOdds: Number.isFinite(k) && k > 0 ? k : K_ODDS,
    w: Number.isFinite(w) && w >= 0 && w <= 1 ? w : W_HYBRID,
    mode: ['odds', 'hybrid', 'results'].includes(mode) ? mode : 'odds',
  };
}

module.exports = {
  BASE_ELO, K_RESULT, K_ODDS, W_HYBRID,
  winExpectancy, marginFactor, resultDelta, marketExpectancy, oddsDelta, ratingDiffFromExpectancy,
  combinedDelta, regressSeason, applyToOverlay, eloSource, oddsParams,
};
