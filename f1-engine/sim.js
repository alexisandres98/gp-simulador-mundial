// f1-engine/sim.js — EL GEMELO DE CARRERA (blueprint 7.0, bloque 20): el field COMPLETO, conjuntamente.
//
// F-0008: 22 pilotos no son 22 apuestas independientes. Cada simulación muestrea UNA carrera entera:
// rendimiento = coche + piloto + efecto de parrilla + ruido común de campo + ruido individual, riesgo
// de abandono por coche y por piloto, y el orden final sale de ordenar el field superviviente. Ganador,
// podio, puntos, top-N y duelos H2H salen de las MISMAS simulaciones y no pueden contradecirse (F-0016).
//
// El generador es determinista por semilla (mulberry32): la misma carrera con la misma semilla produce
// el mismo mundo — los contrafactuales comparan decisiones con common random numbers (F-0029).
'use strict';

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd(); while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// field: [{id, perf, grid (1..n | null), dnf (prob 0..1)}]
// cfg:   { sigma (ruido individual), gridW (puntos de perf por posición de parrilla z), sims, seed }
// Devuelve por piloto: pWin, pPodium, pTop6, pPoints(top10), expFinish, pDnf efectiva, dist de posición.
function simulateRace(field, cfg) {
  const n = field.length;
  const sims = cfg.sims || 4000;
  const sigma = cfg.sigma != null ? cfg.sigma : 0.9;
  const gridW = cfg.gridW != null ? cfg.gridW : 0.5;
  const rnd = rng(cfg.seed != null ? cfg.seed : 42);
  const acc = field.map(() => ({ win: 0, pod: 0, t6: 0, t10: 0, fin: 0, dnf: 0, pos: new Array(n + 1).fill(0) }));
  // z de parrilla: 1º = mejor. Sin parrilla (pre-quali) el efecto viaja por la propia perf esperada.
  const gz = field.map((f) => (f.grid ? -((f.grid - (n + 1) / 2) / ((n - 1) / 2 || 1)) : 0));
  const order = new Array(n);
  for (let s = 0; s < sims; s++) {
    let alive = 0;
    for (let i = 0; i < n; i++) {
      const f = field[i];
      if (rnd() < (f.dnf || 0)) { order[i] = { i, v: -1e9 - rnd() }; acc[i].dnf++; continue; }
      order[i] = { i, v: f.perf + gridW * gz[i] + sigma * gauss(rnd) };
      alive++;
    }
    order.sort((a, b) => b.v - a.v);
    for (let p = 0; p < n; p++) {
      const i = order[p].i;
      const pos = p + 1;
      acc[i].fin += pos; acc[i].pos[pos]++;
      if (pos === 1) acc[i].win++;
      if (pos <= 3) acc[i].pod++;
      if (pos <= 6) acc[i].t6++;
      if (pos <= 10) acc[i].t10++;
    }
  }
  return field.map((f, i) => ({
    id: f.id,
    p_win: acc[i].win / sims, p_podium: acc[i].pod / sims, p_top6: acc[i].t6 / sims, p_points: acc[i].t10 / sims,
    exp_finish: acc[i].fin / sims, p_dnf: acc[i].dnf / sims,
    pos_dist: acc[i].pos.map((c) => c / sims),
  }));
}

// duelo H2H entre dos ids sobre el MISMO conjunto de simulaciones (correlación real del field)
function h2hProb(field, cfg, idA, idB) {
  const n = field.length;
  const sims = cfg.sims || 4000;
  const sigma = cfg.sigma != null ? cfg.sigma : 0.9;
  const gridW = cfg.gridW != null ? cfg.gridW : 0.5;
  const rnd = rng((cfg.seed != null ? cfg.seed : 42) + 7);
  const ia = field.findIndex((f) => f.id === idA), ib = field.findIndex((f) => f.id === idB);
  if (ia < 0 || ib < 0) return null;
  const gz = field.map((f) => (f.grid ? -((f.grid - (n + 1) / 2) / ((n - 1) / 2 || 1)) : 0));
  let wa = 0;
  for (let s = 0; s < sims; s++) {
    const va = rnd() < (field[ia].dnf || 0) ? -1e9 - rnd() : field[ia].perf + gridW * gz[ia] + sigma * gauss(rnd);
    const vb = rnd() < (field[ib].dnf || 0) ? -1e9 - rnd() : field[ib].perf + gridW * gz[ib] + sigma * gauss(rnd);
    if (va > vb) wa++;
  }
  return wa / sims;
}

module.exports = { simulateRace, h2hProb, rng, gauss };
