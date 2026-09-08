// tt-engine/compiler.js — EL COMPILADOR EXACTO: punto → game → partido (blueprint 9.0, bloque 12)
//
// Dos números describen un duelo estacionario: a = P(A gana el punto cuando sirve A) y b = P(A gana el
// punto cuando sirve B). Con ellos y las reglas exactas (11 puntos, dos de diferencia, bloques de dos
// servicios, alternancia punto a punto desde 10–10, primer servidor que alterna por game) se compila:
//
//   · el GAME por recursión exacta sobre el marcador (masas por ganador × puntos) con la cola de deuce
//     resuelta ANALÍTICAMENTE por bloques de dos puntos: u = ab, v = (1−a)(1−b), r = 1−u−v,
//     P(A gana | deuce) = u/(u+v), E[puntos extra] = 2/(u+v), P(extra = 2k ∧ gana A) = r^(k−1)·u;
//   · el PARTIDO al mejor de N por convolución de los games, llevando por cada estado (games A, games B)
//     la distribución de PUNTOS TOTALES y la de MARGEN DE PUNTOS — de ahí salen ganador, marcador exacto,
//     total de games, hándicap de games, total de puntos, hándicap de puntos y los mercados por game, todos
//     del MISMO estado, sin poder contradecirse;
//   · la LATTICE de estados (P(gana el game | i–j) y P(gana el partido | games, puntos)) y el LEVERAGE de
//     cada punto, que es lo que pinta el Game State Lattice y el Leverage Spine de la pantalla.
//
// Las colas truncadas llevan su ε explícito: NUNCA se asigna la masa residual a un ganador (12.2).
// Verificación sintética del blueprint (12.3): a=b=0,5 → 18,828453 puntos/game y P(deuce)=0,176197;
// a=0,6 b=0,5 → P(game)=0,687816 y P(BO5)=0,820431; a=0,7 b=0,3 → P(game)=0,5 con 19,246538 puntos.
// `selfTest()` reproduce la tabla completa y falla si algún dígito se mueve.
'use strict';

const R = require('./rules');

const P = R.RULESET.points;         // 11
const D = R.RULESET.deuce_from;     // 10
const EPS_TAIL = 1e-11;             // masa residual máxima permitida en la cola de deuce
const KMAX = 600;                   // bloques de deuce como máximo (r^600 solo importa con u+v ≈ 0)
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ══ 1. EL GAME ══════════════════════════════════════════════════════════════════════════════════════════
// a, b ∈ (0,1); first = 'a' | 'b' (quién sirve el primer punto del game)
function compileGame(a, b, first) {
  a = clamp(+a, 1e-4, 1 - 1e-4); b = clamp(+b, 1e-4, 1 - 1e-4);
  const pOf = (n) => (R.serverAt(n, first) === 'a' ? a : b);
  // masa hacia delante sobre estados no terminales (i, j ≤ 10, salvo 10–10 que es el deuce)
  const M = Array.from({ length: D + 1 }, () => new Float64Array(D + 1));
  M[0][0] = 1;
  let deuce = 0;
  const out = []; // {w, t, m, p} — m = puntos A − puntos B
  for (let n = 0; n < 2 * D; n++) {
    const p = pOf(n);
    for (let i = Math.max(0, n - D); i <= Math.min(D, n); i++) {
      const j = n - i; if (j < 0 || j > D) continue;
      const m = M[i][j]; if (!(m > 0)) continue;
      if (i === D && j === D) continue; // el deuce se acumula aparte
      // A gana el punto
      if (i + 1 === P && j <= P - 2) out.push({ w: 'a', t: P + j, m: P - j, p: m * p });
      else if (i + 1 === D && j === D) deuce += m * p;
      else M[i + 1][j] += m * p;
      // B gana el punto
      if (j + 1 === P && i <= P - 2) out.push({ w: 'b', t: P + i, m: -(P - i), p: m * (1 - p) });
      else if (j + 1 === D && i === D) deuce += m * (1 - p);
      else M[i][j + 1] += m * (1 - p);
    }
  }
  // la cola analítica del deuce: bloques de dos puntos (un servicio cada uno)
  const u = a * b, v = (1 - a) * (1 - b), r = 1 - u - v;
  const pDeuceA = u + v > 0 ? u / (u + v) : 0.5;
  const expExtra = u + v > 0 ? 2 / (u + v) : Infinity;
  let eps = 0;
  if (deuce > 0) {
    let rk = 1, k = 1;
    for (; k <= KMAX; k++) {
      const blk = deuce * rk;
      if (blk * (u + v) < 1e-16 && k > 3) break;
      out.push({ w: 'a', t: 2 * D + 2 * k, m: 2, p: blk * u });
      out.push({ w: 'b', t: 2 * D + 2 * k, m: -2, p: blk * v });
      rk *= r;
      if (deuce * rk < EPS_TAIL) break;
    }
    eps = deuce * rk; // masa que quedó sin colocar (se reporta, nunca se adjudica)
  }
  // agregados
  let pA = 0, expT = 0, pDeu = deuce, tot = new Map();
  for (const o of out) { if (o.w === 'a') pA += o.p; expT += o.t * o.p; tot.set(o.t, (tot.get(o.t) || 0) + o.p); }
  const lattice = gameLattice(a, b, first, pDeuceA);
  return {
    a, b, first, p_a: pA, exp_points: expT, p_deuce: pDeu, eps,
    deuce: { u, v, r, p_a: pDeuceA, exp_extra: expExtra, mass: pDeu },
    outcomes: out,
    total: [...tot.entries()].sort((x, y) => x[0] - y[0]),
    lattice,
  };
}
// P(A gana el game | i–j, primer servidor) para i, j ∈ 0..10 — el Game State Lattice
function gameLattice(a, b, first, pDeuceA) {
  const G = Array.from({ length: D + 1 }, () => new Float64Array(D + 1));
  const val = (i, j) => (i === P ? 1 : j === P ? 0 : i === D && j === D ? pDeuceA : G[i][j]);
  for (let n = 2 * D - 1; n >= 0; n--) {
    const p = R.serverAt(n, first) === 'a' ? a : b;
    for (let i = Math.max(0, n - D); i <= Math.min(D, n); i++) {
      const j = n - i; if (j < 0 || j > D) continue;
      G[i][j] = p * val(i + 1, j) + (1 - p) * val(i, j + 1);
    }
  }
  G[D][D] = pDeuceA;
  return G.map((row) => Array.from(row));
}
// P(A gana el game) desde un marcador cualquiera (incluido más allá de 10–10, donde solo importa la paridad)
function gameProbFrom(gm, i, j) {
  if (i >= P && i - j >= 2) return 1;
  if (j >= P && j - i >= 2) return 0;
  if (i >= D && j >= D) {
    // desde el deuce (o desde ventaja): un punto de ventaja se resuelve con el siguiente punto o vuelve al deuce
    const { u, v } = gm.deuce; const pd = gm.deuce.p_a;
    if (i === j) return pd;
    const n = i + j; const s = R.serverAt(n, gm.first); const p = s === 'a' ? gm.a : gm.b;
    if (i > j) return p + (1 - p) * pd;   // ventaja A: gana el punto o vuelve al deuce
    return p * pd;                         // ventaja B: si A gana vuelve al deuce, si no pierde
  }
  return gm.lattice[i][j];
}

// ══ 2. EL PARTIDO ═══════════════════════════════════════════════════════════════════════════════════════
const T_MAX = 8 * 128;   // puntos totales máximos representados (7 games × colas largas caben de sobra)
const M_OFF = 8 * 128;   // desplazamiento del margen (±)
const PRUNE = 1e-12;

function compileMatchFixed(a, b, bestOf, first) {
  const fmt = R.bestOfFormat(bestOf);
  const need = fmt.need;
  const gA = compileGame(a, b, 'a'), gB = compileGame(a, b, 'b');
  const gameOf = (g) => ((g % 2 === 1) === (first === 'a') ? gA : gB); // el primer servidor alterna por game
  // estados (ga, gb): masa, pmf de puntos totales, pmf de margen
  const key = (ga, gb) => ga * 8 + gb;
  const S = new Map();
  const mk = () => ({ mass: 0, t: new Float64Array(T_MAX), m: new Float64Array(2 * M_OFF) });
  const s0 = mk(); s0.mass = 1; s0.t[0] = 1; s0.m[M_OFF] = 1; S.set(key(0, 0), s0);
  const finals = []; // {ga, gb, state}
  const perGame = []; // por número de game: P(se juega), P(A lo gana), E[puntos]
  let eps = 0;
  for (let g = 1; g <= fmt.best_of; g++) {
    const gm = gameOf(g);
    let played = 0, winA = 0, expT = 0;
    for (let ga = 0; ga < need; ga++) for (let gb = 0; gb < need; gb++) {
      if (ga + gb !== g - 1) continue;
      const st = S.get(key(ga, gb)); if (!st || !(st.mass > 0)) continue;
      played += st.mass; winA += st.mass * gm.p_a; expT += st.mass * gm.exp_points;
      // índices no nulos del estado (para no barrer 1.024 × 2.048 posiciones por transición)
      const ti = [], mi = [];
      for (let t = 0; t < T_MAX; t++) if (st.t[t] > PRUNE) ti.push(t);
      for (let m = 0; m < 2 * M_OFF; m++) if (st.m[m] > PRUNE) mi.push(m);
      for (const o of gm.outcomes) {
        if (!(o.p > 0)) continue;
        const na = ga + (o.w === 'a' ? 1 : 0), nb = gb + (o.w === 'b' ? 1 : 0);
        let nx = S.get(key(na, nb)); if (!nx) { nx = mk(); S.set(key(na, nb), nx); }
        nx.mass += st.mass * o.p;
        for (const t of ti) { const nt = t + o.t; if (nt < T_MAX) nx.t[nt] += st.t[t] * o.p; else eps += st.t[t] * o.p; }
        for (const m of mi) { const nm = m + o.m; if (nm >= 0 && nm < 2 * M_OFF) nx.m[nm] += st.m[m] * o.p; else eps += st.m[m] * o.p; }
      }
    }
    perGame.push({ game: g, p_played: played, p_a: played > 0 ? winA / played : null, exp_points: played > 0 ? expT / played : null, first: (g % 2 === 1) === (first === 'a') ? 'a' : 'b', p_deuce: gm.p_deuce });
    eps += gm.eps;
  }
  for (let ga = 0; ga <= need; ga++) for (let gb = 0; gb <= need; gb++) {
    if ((ga === need) === (gb === need)) continue; // exactamente uno llegó
    const st = S.get(key(ga, gb)); if (st && st.mass > 0) finals.push({ ga, gb, st });
  }
  // agregados
  let pA = 0, expG = 0, expT = 0;
  const score = [], gamesTotal = new Map(), gamesMargin = new Map();
  const tPmf = new Float64Array(T_MAX), mPmf = new Float64Array(2 * M_OFF);
  for (const f of finals) {
    if (f.ga === need) pA += f.st.mass;
    score.push([`${f.ga}-${f.gb}`, f.st.mass]);
    const n = f.ga + f.gb; gamesTotal.set(n, (gamesTotal.get(n) || 0) + f.st.mass);
    const mg = f.ga - f.gb; gamesMargin.set(mg, (gamesMargin.get(mg) || 0) + f.st.mass);
    expG += n * f.st.mass;
    for (let t = 0; t < T_MAX; t++) if (f.st.t[t] > 0) { tPmf[t] += f.st.t[t]; expT += t * f.st.t[t]; }
    for (let m = 0; m < 2 * M_OFF; m++) if (f.st.m[m] > 0) mPmf[m] += f.st.m[m];
  }
  // P(A gana el partido | ga, gb) — la lattice de games, para el leverage por game
  const Mx = Array.from({ length: need + 1 }, () => new Float64Array(need + 1));
  for (let ga = need; ga >= 0; ga--) for (let gb = need; gb >= 0; gb--) {
    if (ga === need && gb === need) continue;
    if (ga === need) { Mx[ga][gb] = 1; continue; }
    if (gb === need) { Mx[ga][gb] = 0; continue; }
    const pg = gameOf(ga + gb + 1).p_a;
    Mx[ga][gb] = pg * Mx[ga + 1][gb] + (1 - pg) * Mx[ga][gb + 1];
  }
  const toPairs = (arr, off) => { const o = []; for (let i = 0; i < arr.length; i++) if (arr[i] > 1e-9) o.push([i - (off || 0), arr[i]]); return o; };
  return {
    format: fmt, first, a, b, eps,
    p_a: pA, exp_games: expG, exp_points: expT,
    score: score.sort((x, y) => y[1] - x[1]),
    games_total: [...gamesTotal.entries()].sort((x, y) => x[0] - y[0]),
    games_margin: [...gamesMargin.entries()].sort((x, y) => x[0] - y[0]),
    points_total: toPairs(tPmf, 0),
    points_margin: toPairs(mPmf, M_OFF),
    per_game: perGame,
    game_a: gA, game_b: gB,           // el game según quién sirve primero
    match_lattice: Mx.map((r) => Array.from(r)),
  };
}

// mezcla 50/50 de los dos primeros servidores cuando el sorteo se desconoce (lo habitual antes del partido)
function mixPairs(x, y) {
  const m = new Map();
  for (const [k, p] of x) m.set(k, (m.get(k) || 0) + p / 2);
  for (const [k, p] of y) m.set(k, (m.get(k) || 0) + p / 2);
  return [...m.entries()].sort((p, q) => (typeof p[0] === 'number' ? p[0] - q[0] : q[1] - p[1]));
}
const CACHE = new Map();
const CACHE_MAX = 4000;
function compileMatch(a, b, { best_of = 5, first = null } = {}) {
  const ck = `${(+a).toFixed(4)}|${(+b).toFixed(4)}|${best_of}|${first || 'x'}`;
  const hit = CACHE.get(ck); if (hit) return hit;
  let out;
  if (first === 'a' || first === 'b') out = { ...compileMatchFixed(a, b, best_of, first), scenarios: null };
  else {
    const A = compileMatchFixed(a, b, best_of, 'a'), B = compileMatchFixed(a, b, best_of, 'b');
    out = {
      format: A.format, first: 'unknown', a: A.a, b: A.b, eps: (A.eps + B.eps) / 2,
      p_a: (A.p_a + B.p_a) / 2, exp_games: (A.exp_games + B.exp_games) / 2, exp_points: (A.exp_points + B.exp_points) / 2,
      score: mixPairs(A.score, B.score).sort((x, y) => y[1] - x[1]), games_total: mixPairs(A.games_total, B.games_total), games_margin: mixPairs(A.games_margin, B.games_margin),
      points_total: mixPairs(A.points_total, B.points_total), points_margin: mixPairs(A.points_margin, B.points_margin),
      per_game: A.per_game.map((g, i) => ({ game: g.game, p_played: (g.p_played + B.per_game[i].p_played) / 2, p_a: g.p_a != null && B.per_game[i].p_a != null ? (g.p_a + B.per_game[i].p_a) / 2 : null, exp_points: g.exp_points != null ? (g.exp_points + B.per_game[i].exp_points) / 2 : null, first: 'mix', p_deuce: (g.p_deuce + B.per_game[i].p_deuce) / 2 })),
      game_a: A.game_a, game_b: A.game_b,
      match_lattice: A.match_lattice.map((row, i) => row.map((v, j) => (v + B.match_lattice[i][j]) / 2)),
      scenarios: { a_first: { p_a: A.p_a, exp_points: A.exp_points }, b_first: { p_a: B.p_a, exp_points: B.exp_points } },
    };
  }
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(ck, out);
  return out;
}

// ══ 3. LECTURAS SOBRE LAS DISTRIBUCIONES ═══════════════════════════════════════════════════════════════
const over = (pairs, line) => pairs.reduce((s, [x, p]) => s + (x > line ? p : 0), 0);
const under = (pairs, line) => pairs.reduce((s, [x, p]) => s + (x < line ? p : 0), 0);
const at = (pairs, x) => pairs.reduce((s, [k, p]) => s + (k === x ? p : 0), 0);
// hándicap: lado A cubre si margen + línea > 0; push si = 0 (línea entera)
function cover(marginPairs, line, side) {
  let win = 0, push = 0;
  for (const [m, p] of marginPairs) { const v = (side === 'a' ? m : -m) + line; if (v > 0) win += p; else if (v === 0) push += p; }
  return { win, push, lose: 1 - win - push, p_nopush: 1 - push > 0 ? win / (1 - push) : null };
}
// la probabilidad del modelo para cualquier selección de la gramática de la casa
// fam ∈ ML · GAMES_TOTAL · GAMES_HCP · POINTS_TOTAL · POINTS_HCP · CORRECT_SCORE · GAME_ML · GAME_POINTS_TOTAL · GAME_POINTS_HCP · GAME_DEUCE
function probOf(mm, fam, side, line, gameNo) {
  const g = gameNo ? gameFor(mm, gameNo) : null;
  switch (fam) {
    case 'ML': return side === 'a' ? mm.p_a : side === 'b' ? 1 - mm.p_a : null;
    case 'GAMES_TOTAL': return side === 'over' ? over(mm.games_total, line) : side === 'under' ? under(mm.games_total, line) : null;
    case 'GAMES_HCP': { if (side !== 'a' && side !== 'b') return null; const c = cover(mm.games_margin, line, side); return c.p_nopush != null ? c.p_nopush : c.win; }
    case 'POINTS_TOTAL': return side === 'over' ? over(mm.points_total, line) : side === 'under' ? under(mm.points_total, line) : null;
    case 'POINTS_HCP': { if (side !== 'a' && side !== 'b') return null; const c = cover(mm.points_margin, line, side); return c.p_nopush != null ? c.p_nopush : c.win; }
    case 'CORRECT_SCORE': return at(mm.score, String(side || line).replace(/\s+/g, ''));
    case 'GAME_ML': return g ? (side === 'a' ? g.p_a : side === 'b' ? 1 - g.p_a : null) : null;
    case 'GAME_POINTS_TOTAL': return g ? (side === 'over' ? over(g.total, line) : side === 'under' ? under(g.total, line) : null) : null;
    case 'GAME_POINTS_HCP': { if (!g || (side !== 'a' && side !== 'b')) return null; const mp = gameMargin(g); const c = cover(mp, line, side); return c.p_nopush != null ? c.p_nopush : c.win; }
    case 'GAME_DEUCE': return g ? (side === 'yes' || side === 'over' ? g.p_deuce : 1 - g.p_deuce) : null;
    default: return null;
  }
}
// el game k del partido: su compilación depende de quién sirve primero en ese game (mezcla si se desconoce)
function gameFor(mm, k) {
  if (mm.first === 'a' || mm.first === 'b') return ((k % 2 === 1) === (mm.first === 'a')) ? mm.game_a : mm.game_b;
  const A = mm.game_a, B = mm.game_b;
  return { p_a: (A.p_a + B.p_a) / 2, exp_points: (A.exp_points + B.exp_points) / 2, p_deuce: (A.p_deuce + B.p_deuce) / 2, total: mixPairs(A.total, B.total), outcomes: A.outcomes.map((o) => ({ ...o, p: o.p / 2 })).concat(B.outcomes.map((o) => ({ ...o, p: o.p / 2 }))), deuce: A.deuce, mixed: true };
}
function gameMargin(g) { const m = new Map(); for (const o of g.outcomes) m.set(o.m, (m.get(o.m) || 0) + o.p); return [...m.entries()].sort((x, y) => x[0] - y[0]); }

// ── EQUIVALENCIAS DE PAGO (blueprint bloque 9): apuestas distintas que pagan igual por las reglas ────────
function payoffEquivalences(mm) {
  const g1 = gameFor(mm, 1);
  const eq = [];
  eq.push({ id: 'game_deuce_lines', es: 'En un game, "más de 20,5 puntos" y "más de 21,5 puntos" son la misma apuesta: el total 21 no existe (11–10 no cierra). Las dos valen P(deuce).', p: g1.p_deuce, lines: ['20.5', '21.5'] });
  eq.push({ id: 'game_hcp_is_ml', es: 'Un hándicap de game de ±1,5 es idéntico al ganador del game: el margen mínimo es 2 puntos.', p: g1.p_a, lines: ['-1.5', '+1.5'] });
  const s30 = at(mm.score, `${mm.format.need}-0`), s03 = at(mm.score, `0-${mm.format.need}`);
  eq.push({ id: 'sweep_is_under', es: `"Menos de ${mm.format.need + 0.5} games" es exactamente la suma de los dos marcadores sin réplica (${mm.format.need}-0 y 0-${mm.format.need}).`, p: s30 + s03, lines: [`${mm.format.need + 0.5}`] });
  eq.push({ id: 'points_not_games', es: `"Más de ${Math.round(mm.exp_points) - 0.5} puntos" NO equivale a "más de ${mm.format.need + 0.5} games": un partido corto con deuces largos supera la línea de puntos sin llegar al game extra.`, p: null, lines: [] });
  return eq;
}

// ── PROBABILIDAD EN VIVO desde un estado completo (games, puntos, servidor) ─────────────────────────────
function liveProb(a, b, { best_of = 5, ga = 0, gb = 0, i = 0, j = 0, first_this_game = null } = {}) {
  const fmt = R.bestOfFormat(best_of);
  if (ga >= fmt.need) return 1; if (gb >= fmt.need) return 0;
  const run = (firstG) => {
    // primer servidor del partido coherente con el del game actual
    const g = ga + gb + 1;
    const firstMatch = (g % 2 === 1) ? firstG : R.other(firstG);
    const mm = compileMatchFixed(a, b, best_of, firstMatch);
    const gm = firstG === 'a' ? mm.game_a : mm.game_b;
    const pg = gameProbFrom(gm, i, j);
    const M = mm.match_lattice;
    return pg * M[ga + 1][gb] + (1 - pg) * M[ga][gb + 1];
  };
  if (first_this_game === 'a' || first_this_game === 'b') return run(first_this_game);
  return (run('a') + run('b')) / 2;
}

// ══ 4. AUTOVERIFICACIÓN (tabla sintética del blueprint 12.3) ═══════════════════════════════════════════
function selfTest() {
  const rows = [
    { a: 0.5, b: 0.5, p_game: 0.5, pts: 18.828453, deuce: 0.176197, bo5: 0.5 },
    { a: 0.7, b: 0.3, p_game: 0.5, pts: 19.246538, deuce: 0.193236, bo5: 0.5 },
    { a: 0.6, b: 0.5, p_game: 0.687816, pts: 18.545897, deuce: 0.160047, bo5: 0.820431 },
    { a: 0.65, b: 0.45, p_game: 0.690924, pts: 18.580760, deuce: 0.162199, bo5: 0.824707 },
  ];
  const out = [];
  let ok = true;
  for (const r of rows) {
    // la tabla del blueprint está calculada con A sirviendo el primer punto del game (gA)
    const gA = compileGame(r.a, r.b, 'a'), gB = compileGame(r.a, r.b, 'b');
    const pg = (gA.p_a + gB.p_a) / 2, pts = gA.exp_points, deu = (gA.p_deuce + gB.p_deuce) / 2;
    const m = compileMatch(r.a, r.b, { best_of: 5 });
    const row = { a: r.a, b: r.b, p_game: +pg.toFixed(6), pts: +pts.toFixed(6), deuce: +deu.toFixed(6), bo5: +m.p_a.toFixed(6), eps: m.eps,
      extra_from_deuce: +gA.deuce.exp_extra.toFixed(6), sum_score: +m.score.reduce((s, x) => s + x[1], 0).toFixed(9), sum_points: +m.points_total.reduce((s, x) => s + x[1], 0).toFixed(9) };
    row.ok = Math.abs(row.p_game - r.p_game) < 1e-6 && Math.abs(row.pts - r.pts) < 1e-6 && Math.abs(row.deuce - r.deuce) < 1e-6 && Math.abs(row.bo5 - r.bo5) < 1e-6 && Math.abs(row.sum_score - 1) < 1e-7 && Math.abs(row.sum_points - 1) < 1e-6;
    if (!row.ok) ok = false;
    out.push(row);
  }
  // pruebas críticas de reglas (12.1)
  const crit = [[10, 9, false], [11, 9, true], [11, 10, false], [12, 10, true], [13, 12, false], [9, 11, true]].map(([i, j, exp]) => ({ score: `${i}-${j}`, legal: R.legalGameScore(i, j), expected: exp, ok: R.legalGameScore(i, j) === exp }));
  if (crit.some((c) => !c.ok)) ok = false;
  // identidad de pago: over 20,5 = over 21,5 = P(deuce); hándicap de game ±1,5 = ganador del game
  const g = compileGame(0.58, 0.47, 'a');
  const eq1 = Math.abs(over(g.total, 20.5) - over(g.total, 21.5)) < 1e-12 && Math.abs(over(g.total, 20.5) - g.p_deuce) < 1e-9;
  const mm = compileMatch(0.58, 0.47, { best_of: 7, first: 'a' });
  const eq2 = Math.abs(probOf(mm, 'GAME_POINTS_HCP', 'a', -1.5, 1) - probOf(mm, 'GAME_ML', 'a', null, 1)) < 1e-9;
  if (!eq1 || !eq2) ok = false;
  return { ok, rows: out, critical: crit, equivalences: { deuce_lines: eq1, hcp15_is_ml: eq2 } };
}

module.exports = { compileGame, compileMatch, compileMatchFixed, gameProbFrom, gameFor, gameMargin, probOf, over, under, at, cover, payoffEquivalences, liveProb, selfTest, T_MAX, M_OFF };
