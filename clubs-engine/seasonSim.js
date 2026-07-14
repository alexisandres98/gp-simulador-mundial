// clubs-engine/seasonSim.js — SIMULADOR DE TEMPORADA por liga (Monte Carlo), MISMO espíritu que el simulador del
// Mundial (simulateTournament): parte del estado ACTUAL y simula lo que falta N veces → prob de campeón/top-N/
// descenso por equipo. Data disponible: standings (pts/gd actuales) + Elo dinámico + resultados jugados. El
// calendario restante se RECONSTRUYE de los resultados (liga round-robin: cada equipo hospeda a cada otro una vez
// → doble RR). No hace falta que el proveedor liste todos los fixtures: se derivan de lo jugado. Se actualiza solo
// conforme llegan resultados (el server recomputa). Regla: construir con lo disponible, mejorar con más data.
'use strict';
const { matchProbs } = require('../engine');

function projectSeason({ standings = [], eloOf, hfa = 60, results = [], meetings = 2, topN = 4, relegate = 4, sims = 4000, rng = Math.random } = {}) {
  const teams = standings.map(s => s.id);
  const T = teams.length;
  if (T < 4 || typeof eloOf !== 'function') return null;
  const pts0 = {}, gd0 = {}, gf0 = {};
  standings.forEach(s => { pts0[s.id] = s.pts || 0; gd0[s.id] = (s.gf || 0) - (s.ga || 0); gf0[s.id] = s.gf || 0; });
  // orientaciones ya jugadas esta temporada: hosted[home][away] = veces que home hospedó a away
  const hosted = {}; teams.forEach(t => hosted[t] = {});
  for (const r of results) { if (r.hg == null || !hosted[r.home_id]) continue; hosted[r.home_id][r.away_id] = (hosted[r.home_id][r.away_id] || 0) + 1; }
  // fixtures RESTANTES: cada equipo hospeda a cada otro `hostEach` veces (doble RR = 1) menos lo ya jugado
  const hostEach = Math.max(1, Math.round(meetings / 2));
  const remaining = [];
  for (const h of teams) for (const a of teams) {
    if (h === a) continue;
    const played = (hosted[h] && hosted[h][a]) || 0;
    for (let k = played; k < hostEach; k++) remaining.push([h, a]);
  }
  if (!remaining.length) return null; // temporada terminada
  // probs 1X2 pre-calculadas de cada fixture restante (Elo + localía de la liga)
  const fx = remaining.map(([h, a]) => { const p = matchProbs((eloOf(h) || 1500) + hfa, eloOf(a) || 1500); return { h, a, pH: p.home, pHD: p.home + p.draw }; });
  const champ = {}, top = {}, releg = {}, sumPts = {}, sumRank = {};
  teams.forEach(t => { champ[t] = 0; top[t] = 0; releg[t] = 0; sumPts[t] = 0; sumRank[t] = 0; });
  const pts = {};
  for (let s = 0; s < sims; s++) {
    for (const t of teams) pts[t] = pts0[t];
    for (const f of fx) { const r = rng(); if (r < f.pH) pts[f.h] += 3; else if (r < f.pHD) { pts[f.h]++; pts[f.a]++; } else pts[f.a] += 3; }
    const order = teams.slice().sort((x, y) => (pts[y] - pts[x]) || (gd0[y] - gd0[x]) || (gf0[y] - gf0[x]));
    for (let i = 0; i < order.length; i++) { const t = order[i]; sumPts[t] += pts[t]; sumRank[t] += i + 1; if (i === 0) champ[t]++; if (i < topN) top[t]++; if (i >= T - relegate) releg[t]++; }
  }
  const out = {};
  teams.forEach(t => { out[t] = { champion: +(champ[t] / sims).toFixed(4), top: +(top[t] / sims).toFixed(4), relegation: +(releg[t] / sims).toFixed(4), exp_points: +(sumPts[t] / sims).toFixed(1), exp_rank: +(sumRank[t] / sims).toFixed(1) }; });
  return { teams: out, remaining: remaining.length, played: results.filter(r => r.hg != null).length, sims, meetings, top_n: topN, relegate };
}

module.exports = { projectSeason };
