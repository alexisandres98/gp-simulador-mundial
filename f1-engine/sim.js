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

// ── DUELO H2H, CON LA REGLA DE LA CASA (16-sep, A34 de la auditoría externa) ─────────────────────────────
//
// EL ERROR QUE TENÍA. Un piloto que abandona recibía `v = −1e9 − rnd()`, así que **dos abandonos se
// resolvían a cara o cruz**: la mitad de esa masa se contaba como "gana A". Por reglamento no es así. En un
// duelo de pilotos, todas las casas grandes liquidan por vueltas completadas y **DEVUELVEN LA APUESTA si
// ninguno de los dos termina clasificado** (o si completan lo mismo). Una devolución no es media victoria:
// a cuota 1,90, ganar la mitad de los dobles abandonos paga 1,90 sobre esa masa y una devolución paga 1,00.
//
// Con un 8-12 % de abandono por piloto —lo normal en F1— el doble abandono ronda el 1 % de las carreras, y
// contar la mitad de ese 1 % como victoria infla la probabilidad medio punto. Medio punto sobre un listón de
// ventaja de 4 pp es un octavo del listón, siempre en la misma dirección.
//
// Es el mismo tratamiento que `goal-engine/mitades.js` le da a `h1_draw_no_bet`: la probabilidad justa de un
// mercado que devuelve es CONDICIONAL a que resuelva, y hay que calcularla así para poder compararla con un
// precio que también devuelve.
//
// Devuelve las tres masas y, además, `p` = P(gana A | resuelve), que es lo que se compara con la cuota.
function h2hProb(field, cfg, idA, idB, { detalle = false } = {}) {
  const n = field.length;
  const sims = cfg.sims || 4000;
  const sigma = cfg.sigma != null ? cfg.sigma : 0.9;
  const gridW = cfg.gridW != null ? cfg.gridW : 0.5;
  const rnd = rng((cfg.seed != null ? cfg.seed : 42) + 7);
  const ia = field.findIndex((f) => f.id === idA), ib = field.findIndex((f) => f.id === idB);
  if (ia < 0 || ib < 0) return null;
  const gz = field.map((f) => (f.grid ? -((f.grid - (n + 1) / 2) / ((n - 1) / 2 || 1)) : 0));
  let wa = 0, wb = 0, push = 0;
  for (let s = 0; s < sims; s++) {
    const da = rnd() < (field[ia].dnf || 0);
    const db = rnd() < (field[ib].dnf || 0);
    if (da && db) { push++; continue; }                  // ninguno clasificado: devolución
    if (da) { wb++; continue; }                          // solo abandona A: gana B, sin simular nada más
    if (db) { wa++; continue; }
    const va = field[ia].perf + gridW * gz[ia] + sigma * gauss(rnd);
    const vb = field[ib].perf + gridW * gz[ib] + sigma * gauss(rnd);
    if (va > vb) wa++; else wb++;
  }
  const resuelven = wa + wb;
  const p = resuelven > 0 ? wa / resuelven : null;       // la que se compara con el precio
  if (!detalle) return p;
  return {
    p, p_a_bruta: wa / sims, p_b_bruta: wb / sims, p_push: push / sims,
    sims, resuelven,
    nota: 'p = P(gana A | resuelve). El doble abandono DEVUELVE la apuesta por reglamento, así que la '
      + 'probabilidad justa es condicional a que resuelva — igual que un draw-no-bet. Repartir esa masa a '
      + 'cara o cruz infla la probabilidad medio punto, siempre en la misma dirección.',
  };
}

// ── LA MONOTONÍA, QUE NO ES OPCIONAL ────────────────────────────────────────────────────────────────────
// Ganar la carrera implica subir al podio, y subir al podio implica puntuar. Por construcción el simulador
// lo cumple —son condiciones anidadas sobre las MISMAS simulaciones— y precisamente por eso conviene
// comprobarlo: si alguien calibra una familia sin las otras, o encoge el podio hacia una referencia y no el
// ganador, la monotonía se rompe y el sistema publica que un piloto gana más veces de las que puntúa.
// Devuelve las violaciones, no un booleano: un "false" sin decir quién ni cuánto no sirve para arreglarlo.
function violacionesDeMonotonia(filas, { tol = 1e-9 } = {}) {
  const out = [];
  for (const r of filas || []) {
    const w = r.p_win, po = r.p_podium, t6 = r.p_top6, pt = r.p_points;
    const pares = [['p_win ≤ p_podium', w, po], ['p_podium ≤ p_top6', po, t6], ['p_top6 ≤ p_points', t6, pt]];
    for (const [que, a, b] of pares) {
      if (Number.isFinite(a) && Number.isFinite(b) && a > b + tol) {
        out.push({ id: r.id, regla: que, valores: [a, b], exceso: +(a - b).toFixed(6) });
      }
    }
  }
  return out;
}

module.exports = { simulateRace, h2hProb, violacionesDeMonotonia, rng, gauss };
