// prop-engine/lineupAdjust.js — PROTOTIPO SHADOW: ajuste de λ del equipo por ALINEACIÓN confirmada.
// PURO, NO cableado a producción. Idea (research 4-jul + data TheStatsAPI): el xG90 por jugador permite medir
// cuánta generación real de gol está EN CANCHA. Cuando sale el once (75 min antes del KO), el factor es:
//     factor = Σ xg90(titulares confirmados) / Σ xg90(once habitual)      (clamp ±30%)
// y la λ del modelo se ajustaría λ' = λ × factor. Si no juega Mbappé (~40% del xG de Francia), la λ baja en
// su participación real menos lo que aporta su reemplazo — automático y explicable, vs el tratamiento
// cualitativo del context engine. Jugadores nunca vistos usan el prior de su posición (prop-engine/players).
'use strict';
const { POS_PRIOR } = require('./players');

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const CLAMP = 0.3; // el ajuste por alineación mueve λ hasta ±30% (rotaciones masivas ya son otro régimen)

// Once HABITUAL de un equipo: los 11 con más titularidades (desempate por minutos) del fit de jugadores.
function usualXi(fitres, teamCode) {
  return Object.values(fitres.players)
    .filter(p => p.team === teamCode)
    .sort((a, b) => (b.starts - a.starts) || (b.minutes - a.minutes))
    .slice(0, 11);
}

// starters: array de { pid } | { pid, pos } | { name, pos } (si el pid no está en el fit, usa prior de posición).
function xgOf(fitres, starter) {
  const known = starter.pid && fitres.players[starter.pid];
  if (known) return { xg90: known.xg90, name: known.name, known: true };
  const pr = POS_PRIOR[starter.pos] || POS_PRIOR.M;
  return { xg90: pr.xg90, name: starter.name || starter.pid || '?', known: false };
}

// Devuelve { factor, baseline_xg90, lineup_xg90, missing:[{name, xg90, share}], unknown_count }.
function lineupAdjustment(fitres, teamCode, starters) {
  const usual = usualXi(fitres, teamCode);
  const baseline = usual.reduce((s, p) => s + p.xg90, 0);
  if (!(baseline > 0) || !starters || !starters.length) return { factor: 1, baseline_xg90: baseline || 0, lineup_xg90: baseline || 0, missing: [], unknown_count: 0 };
  const resolved = starters.map(s => xgOf(fitres, s));
  const lineup = resolved.reduce((s, p) => s + p.xg90, 0);
  const startersPids = new Set(starters.map(s => s.pid).filter(Boolean));
  const missing = usual
    .filter(p => !startersPids.has(p.pid))
    .map(p => ({ pid: p.pid, name: p.name, xg90: +p.xg90.toFixed(3), share: +(p.xg90 / baseline).toFixed(3) }))
    .sort((a, b) => b.xg90 - a.xg90);
  return {
    factor: clamp(lineup / baseline, 1 - CLAMP, 1 + CLAMP),
    baseline_xg90: +baseline.toFixed(3),
    lineup_xg90: +lineup.toFixed(3),
    missing,
    unknown_count: resolved.filter(r => !r.known).length,
  };
}

module.exports = { lineupAdjustment, usualXi, CLAMP };
