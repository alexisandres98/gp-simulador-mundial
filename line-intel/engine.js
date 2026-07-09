// line-intel/engine.js — Inteligencia de movimiento de línea (PURO, sin I/O).
// La serie temporal ya existe: goal_value_shadow persiste consenso no-vig + mejor cuota por mercado en cada
// ciclo del value engine (20-75 min). Este módulo la convierte en señal legible: hacia dónde se movió el
// mercado desde que publicamos una pick (a favor = el consenso se acerca a nuestra selección) y si hubo
// movimiento brusco (steam). SOLO INFORMATIVO/SHADOW: no gatea picks (regla de la casa: backtest antes de
// tocar gates). El server resuelve las series; acá solo matemática.

// Umbrales: un movimiento se considera real a partir de 1pp (el ruido de re-cotización queda como 'flat');
// steam = salto >= 2pp entre dos evaluaciones consecutivas dentro de una ventana de 2h.
const MOVE_MIN_PP = 1.0;
const STEAM_PP = 2.0;
const STEAM_WINDOW_MS = 2 * 60 * 60 * 1000;

// Movimiento de la línea para una pick: prob del mercado al PUBLICAR (ya guardada en la pick) vs consenso
// actual del mismo mercado. fair es la prob de NUESTRA selección → sube = el mercado nos da la razón.
function moveForPick(publishProb, latestFair) {
  if (publishProb == null || latestFair == null) return null;
  const pp = +((latestFair - publishProb) * 100).toFixed(1);
  const direction = pp >= MOVE_MIN_PP ? 'with' : pp <= -MOVE_MIN_PP ? 'against' : 'flat';
  return { pp, direction };
}

// Resumen de una serie completa [{fair, odds, at}] (ascendente por at) para análisis/observatorio.
function summarize(series) {
  const pts = (series || []).filter(s => s && s.fair != null).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  if (pts.length < 2) return pts.length === 1 ? { points: 1, open: pts[0].fair, close: pts[0].fair, move_pp: 0, direction: 'flat', steam: false } : null;
  const open = Number(pts[0].fair), close = Number(pts[pts.length - 1].fair);
  const movePp = +((close - open) * 100).toFixed(1);
  let steam = false, maxJumpPp = 0;
  for (let i = 1; i < pts.length; i++) {
    const dtMs = new Date(pts[i].at) - new Date(pts[i - 1].at);
    const jump = Math.abs(Number(pts[i].fair) - Number(pts[i - 1].fair)) * 100;
    if (jump > maxJumpPp) maxJumpPp = +jump.toFixed(1);
    if (jump >= STEAM_PP && dtMs <= STEAM_WINDOW_MS) steam = true;
  }
  return {
    points: pts.length,
    open: +open.toFixed(4), close: +close.toFixed(4),
    move_pp: movePp,
    direction: movePp >= MOVE_MIN_PP ? 'up' : movePp <= -MOVE_MIN_PP ? 'down' : 'flat',
    steam, max_jump_pp: maxJumpPp,
    from: pts[0].at, to: pts[pts.length - 1].at,
  };
}

module.exports = { moveForPick, summarize, MOVE_MIN_PP, STEAM_PP };
