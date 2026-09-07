// darts-engine/compiler.js — LA CARRERA DEL LEG Y EL COMPILADOR DE FORMATOS (blueprint 8.0, bloques 15-16)
//
// El leg es una carrera alternada con absorción: si A sale, gana cuando T_A ≤ T_B; si recibe, cuando
// T_A < T_B. P(A gana | A sale) = Σ_k P(T_A = k) P(T_B ≥ k). De la misma identidad —llevando los 180s y el
// valor del checkout junto a T— salen conjuntos y sin contradicción: ganador, duración, 180s de cada uno,
// "most 180s" con su masa de empate y el checkout máximo. Los sets y el BO-N se compilan sobre esa carrera
// con la regla de saque exacta (alterna por leg; alterna por set), extensión a dos legs de diferencia y
// muerte súbita. Nada se promedia antes de tiempo: Eθ[F(p(θ))] ≠ F(Eθ[p(θ)]) y aquí la p del leg no es una
// moneda fija sino dos distribuciones enteras.
'use strict';

const K = require('./kernel');

const NCAP = 40;                 // 180s por jugador y partido que se llevan en la conjunta (más allá: masa despreciable)
const CKMAX = 170;

// ── LA CARRERA DE UN LEG ─────────────────────────────────────────────────────────────────────────────────
// LA, LB: salidas de kernel.soloLeg. Devuelve, por quién sale, la probabilidad de cada ganador con la
// conjunta de 180s (nA, nB ∈ 0..2) y la distribución del número de visitas del leg.
function legRace(LA, LB) {
  const out = {};
  for (const starter of ['a', 'b']) {
    const S = starter === 'a' ? LA : LB, Rc = starter === 'a' ? LB : LA; // S sale, Rc recibe
    const kmax = Math.min(S.fin.length, Rc.fin.length) - 1;
    const winS = { p: 0, n180: mk3(), visits: new Float64Array(2 * kmax + 2), ck: S.checkoutCdf };
    const winR = { p: 0, n180: mk3(), visits: new Float64Array(2 * kmax + 2), ck: Rc.checkoutCdf };
    for (let k = 1; k <= kmax; k++) {
      // el que sale cierra en su visita k con el receptor vivo tras k-1 visitas
      for (let ns = 0; ns <= K.N180MAX; ns++) {
        const fs = S.fin[k][ns]; if (fs < 1e-15) continue;
        for (let nr = 0; nr <= K.N180MAX; nr++) {
          const ar = Rc.alive[k - 1][nr]; if (ar < 1e-15) continue;
          const p = fs * ar; winS.p += p; winS.n180[ns][nr] += p; winS.visits[2 * k - 1] += p;
        }
      }
      // el receptor cierra en su visita k con el que sale vivo tras k visitas
      for (let nr = 0; nr <= K.N180MAX; nr++) {
        const fr = Rc.fin[k][nr]; if (fr < 1e-15) continue;
        for (let ns = 0; ns <= K.N180MAX; ns++) {
          const as = S.alive[k][ns]; if (as < 1e-15) continue;
          const p = fr * as; winR.p += p; winR.n180[nr][ns] += p; winR.visits[2 * k] += p;
        }
      }
    }
    // la masa que no cerró en KMAX visitas ninguno de los dos se reparte proporcionalmente (y se declara)
    const z = winS.p + winR.p;
    const residual = Math.max(0, 1 - z);
    if (z > 0 && residual > 1e-12) { winS.p += residual * winS.p / z; winR.p += residual * winR.p / z; }
    // n180 va indexado [ganador][perdedor] arriba; se vuelve a [A][B]
    const toAB = (w, isStarter) => {
      const arr = mk3();
      for (let i = 0; i <= K.N180MAX; i++) for (let j = 0; j <= K.N180MAX; j++) {
        const v = w.n180[i][j]; if (!v) continue;
        // w.n180[ganador][perdedor]: ganador = S si isStarter... se mapea a (nA, nB)
        const winnerIsA = (starter === 'a') === isStarter;
        if (winnerIsA) arr[i][j] += v; else arr[j][i] += v;
      }
      return arr;
    };
    const A = starter === 'a' ? winS : winR, B = starter === 'a' ? winR : winS;
    out[starter] = {
      a: { p: A.p, n180: toAB(A, starter === 'a'), visits: A.visits, ck: LA.checkoutCdf },
      b: { p: B.p, n180: toAB(B, starter === 'b'), visits: B.visits, ck: LB.checkoutCdf },
      residual,
    };
  }
  return out;
}
function mk3() { return Array.from({ length: K.N180MAX + 1 }, () => new Float64Array(K.N180MAX + 1)); }

// ── EL ESTADO QUE VIAJA POR LA DP ────────────────────────────────────────────────────────────────────────
// p: masa; j: conjunta de 180s (nA,nB) plana; ckA/ckB/ckAB: P(estado ∧ todos los checkouts ≤ c); ev: masa × visitas
function newState(p) {
  const j = new Float64Array((NCAP + 1) * (NCAP + 1)); j[0] = p;
  const ck = () => { const v = new Float64Array(CKMAX + 1); v.fill(p); return v; };
  return { p, j, ckA: ck(), ckB: ck(), ckAB: ck(), ev: 0 };
}
function cdfArray(ck) {
  // ck = [[c, F(c)]...] acumulada sobre el soporte; se expande a un vector 0..170 (F(c) = P(checkout ≤ c))
  const v = new Float64Array(CKMAX + 1);
  let cur = 0, i = 0;
  for (let c = 0; c <= CKMAX; c++) { while (i < ck.length && ck[i][0] <= c) { cur = ck[i][1]; i++; } v[c] = cur; }
  return v;
}
// aplica UN leg al estado: gana `w` ('a'|'b') con la salida de legRace `L` (ya con starter fijado)
function applyLeg(st, L, w, F, expVisits) {
  const out = { p: st.p * L.p, j: new Float64Array(st.j.length), ckA: new Float64Array(CKMAX + 1), ckB: new Float64Array(CKMAX + 1), ckAB: new Float64Array(CKMAX + 1), ev: 0 };
  const W = NCAP + 1;
  // 180s: convolución con la conjunta del leg (soporte 0..2 × 0..2)
  for (let a = 0; a <= NCAP; a++) for (let b = 0; b <= NCAP; b++) {
    const m = st.j[a * W + b]; if (m < 1e-16) continue;
    for (let i = 0; i <= K.N180MAX; i++) { const ai = Math.min(NCAP, a + i); for (let jn = 0; jn <= K.N180MAX; jn++) { const v = L.n180[i][jn]; if (!v) continue; out.j[ai * W + Math.min(NCAP, b + jn)] += m * v; } }
  }
  // checkouts: el ganador multiplica su acumulada; el perdedor no cerró
  const Fw = w === 'a' ? F.a : F.b;
  for (let c = 0; c <= CKMAX; c++) {
    out.ckA[c] = st.ckA[c] * L.p * (w === 'a' ? Fw[c] : 1);
    out.ckB[c] = st.ckB[c] * L.p * (w === 'b' ? Fw[c] : 1);
    out.ckAB[c] = st.ckAB[c] * L.p * Fw[c];
  }
  out.ev = (st.ev + st.p * expVisits) * L.p;
  return out;
}
function merge(into, s) {
  into.p += s.p;
  for (let i = 0; i < s.j.length; i++) into.j[i] += s.j[i];
  for (let c = 0; c <= CKMAX; c++) { into.ckA[c] += s.ckA[c]; into.ckB[c] += s.ckB[c]; into.ckAB[c] += s.ckAB[c]; }
  into.ev += s.ev;
}
const other = (s) => (s === 'a' ? 'b' : 'a');
function expOf(v) { let e = 0, z = 0; for (let i = 0; i < v.length; i++) { e += i * v[i]; z += v[i]; } return z ? e / z : 0; }

// ── LEGS: primero a N, con o sin dos de diferencia y tope ────────────────────────────────────────────────
// Devuelve las hojas terminales {la, lb, winner, state} y la masa final. `race` = legRace(LA, LB);
// `firstStarter` = quién sale en el primer leg. Opcionalmente arranca de un marcador (la0, lb0).
function runLegs(race, fmt, firstStarter, { la0 = 0, lb0 = 0, init = null } = {}) {
  const F = { a: cdfArray(race.a.a.ck), b: cdfArray(race.a.b.ck) };
  const EV = { a: { a: expOf(race.a.a.visits), b: expOf(race.a.b.visits) }, b: { a: expOf(race.b.a.visits), b: expOf(race.b.b.visits) } };
  const firstTo = fmt.first_to, two = !!fmt.two_clear, maxLegs = fmt.max_legs || (two ? fmt.best_of + 2 : fmt.best_of);
  const done = (la, lb) => {
    if (la + lb >= maxLegs) return la > lb ? 'a' : lb > la ? 'b' : null;
    if (la >= firstTo && (!two || la - lb >= 2)) return 'a';
    if (lb >= firstTo && (!two || lb - la >= 2)) return 'b';
    return null;
  };
  let layer = new Map([[la0 * 100 + lb0, init || newState(1)]]);
  const leaves = [];
  for (let n = la0 + lb0; n < maxLegs && layer.size; n++) {
    const starter = (n - la0 - lb0) % 2 === 0 ? firstStarter : other(firstStarter);
    const next = new Map();
    for (const [key, st] of layer) {
      const la = Math.floor(key / 100), lb = key % 100;
      const Ls = race[starter];
      for (const w of ['a', 'b']) {
        const s2 = applyLeg(st, Ls[w], w, F, EV[starter][w]);
        if (s2.p < 1e-14) continue;
        const la2 = la + (w === 'a' ? 1 : 0), lb2 = lb + (w === 'b' ? 1 : 0);
        const win = done(la2, lb2);
        if (win) { leaves.push({ la: la2, lb: lb2, winner: win, state: s2, legs: la2 + lb2 }); continue; }
        const k2 = la2 * 100 + lb2;
        const cur = next.get(k2);
        if (cur) merge(cur, s2); else next.set(k2, s2);
      }
    }
    layer = next;
  }
  return leaves;
}

// ── SETS: legs por set con saque alterno; el set alterna quién sale; último set con extensión ────────────
function runSets(race, fmt, firstStarter, { sa0 = 0, sb0 = 0, la0 = 0, lb0 = 0 } = {}) {
  const firstToSets = fmt.first_to_sets;
  let layer = [{ sa: sa0, sb: sb0, la: la0, lb: lb0, state: newState(1), setStarter: firstStarter }];
  const leaves = [];
  // el set en curso hereda su saque: quien saca el set `i` es firstStarter si i es par (0-index)
  let guard = 0;
  while (layer.length && guard++ < 200) {
    const next = [];
    for (const node of layer) {
      const deciding = node.sa === firstToSets - 1 && node.sb === firstToSets - 1;
      const legFmt = { first_to: fmt.first_to_legs, two_clear: deciding && fmt.final_set_two_clear, max_legs: deciding && fmt.final_set_two_clear ? fmt.final_set_max_legs : fmt.legs_per_set, best_of: fmt.legs_per_set };
      const setLeaves = runLegs(race, legFmt, node.setStarter, { la0: node.la, lb0: node.lb, init: node.state });
      for (const lf of setLeaves) {
        const sa = node.sa + (lf.winner === 'a' ? 1 : 0), sb = node.sb + (lf.winner === 'b' ? 1 : 0);
        const leaf = { sa, sb, setLegs: { la: lf.la, lb: lf.lb }, state: lf.state };
        if (sa >= firstToSets || sb >= firstToSets) { leaf.winner = sa >= firstToSets ? 'a' : 'b'; leaves.push(leaf); }
        else next.push({ sa, sb, la: 0, lb: 0, state: lf.state, setStarter: other(node.setStarter) });
      }
    }
    // fundir nodos con el mismo (sa, sb) para que el árbol no crezca exponencialmente
    const byKey = new Map();
    for (const nd of next) { const k = nd.sa * 10 + nd.sb; const cur = byKey.get(k); if (cur) merge(cur.state, nd.state); else byKey.set(k, nd); }
    layer = [...byKey.values()];
  }
  return leaves;
}

// ── DEL ÁRBOL A LOS MERCADOS ─────────────────────────────────────────────────────────────────────────────
function summarize(leaves, fmt) {
  const W = NCAP + 1;
  let pA = 0, ev = 0;
  const legsTotal = new Map(), legsA = new Map(), legsB = new Map(), margin = new Map(), score = new Map();
  const setsTotal = new Map(), setScore = new Map(), setMargin = new Map();
  const j = new Float64Array(W * W);
  const ckA = new Float64Array(CKMAX + 1), ckB = new Float64Array(CKMAX + 1), ckAB = new Float64Array(CKMAX + 1);
  const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const lf of leaves) {
    const st = lf.state, p = st.p;
    if (lf.winner === 'a') pA += p;
    ev += st.ev;
    for (let i = 0; i < W * W; i++) j[i] += st.j[i];
    for (let c = 0; c <= CKMAX; c++) { ckA[c] += st.ckA[c]; ckB[c] += st.ckB[c]; ckAB[c] += st.ckAB[c]; }
    if (fmt.kind === 'legs') {
      bump(legsTotal, lf.la + lf.lb, p); bump(legsA, lf.la, p); bump(legsB, lf.lb, p); bump(margin, lf.la - lf.lb, p); bump(score, lf.la + '-' + lf.lb, p);
    } else {
      bump(setsTotal, lf.sa + lf.sb, p); bump(setScore, lf.sa + '-' + lf.sb, p); bump(setMargin, lf.sa - lf.sb, p);
    }
  }
  const z = leaves.reduce((s, l) => s + l.state.p, 0) || 1;
  const pmf = (m) => [...m.entries()].map(([k, v]) => [typeof k === 'string' ? k : +k, v / z]).sort((x, y) => (typeof x[0] === 'number' ? x[0] - y[0] : String(x[0]).localeCompare(String(y[0]))));
  // 180s: marginales y "most"
  const a180 = new Float64Array(W), b180 = new Float64Array(W), t180 = new Float64Array(2 * W);
  let mostA = 0, mostB = 0, tie = 0, e180A = 0, e180B = 0;
  for (let a = 0; a <= NCAP; a++) for (let b = 0; b <= NCAP; b++) {
    const v = j[a * W + b] / z; if (!v) continue;
    a180[a] += v; b180[b] += v; t180[a + b] += v; e180A += a * v; e180B += b * v;
    if (a > b) mostA += v; else if (b > a) mostB += v; else tie += v;
  }
  const toPmf = (arr) => { const o = []; for (let i = 0; i < arr.length; i++) if (arr[i] > 1e-9) o.push([i, arr[i]]); return o; };
  // checkout máximo: F(c) = P(máximo ≤ c); el "sin checkout" (jugador que no ganó ningún leg) queda en c=0
  const ckOut = (v) => { const o = []; for (let c = 0; c <= CKMAX; c++) o.push([c, v[c] / z]); return o; };
  return {
    p_a: pA / z, mass: z, exp_visits: ev / z,
    legs: fmt.kind === 'legs' ? { total: pmf(legsTotal), a: pmf(legsA), b: pmf(legsB), margin: pmf(margin), score: pmf(score), exp_total: expOfPmf(pmf(legsTotal)) } : null,
    sets: fmt.kind === 'sets' ? { total: pmf(setsTotal), score: pmf(setScore), margin: pmf(setMargin), exp_total: expOfPmf(pmf(setsTotal)) } : null,
    x180: { a: toPmf(a180), b: toPmf(b180), total: toPmf(t180), exp_a: e180A, exp_b: e180B, most_a: mostA, most_b: mostB, tie },
    checkout_max: { a: ckOut(ckA), b: ckOut(ckB), match: ckOut(ckAB) },
  };
}
function expOfPmf(p) { return p.reduce((s, [k, v]) => s + (+k) * v, 0); }

// ── EL PARTIDO COMPLETO ──────────────────────────────────────────────────────────────────────────────────
// LA, LB: soloLeg de cada jugador (ya con double_in si el formato lo pide). `starter`: 'a' | 'b' | null
// (desconocido → se compilan los dos escenarios y se publica la mezcla 50/50 MÁS los dos por separado).
function compileMatch(LA, LB, fmt, { starter = null } = {}) {
  const race = legRace(LA, LB);
  const run = (s) => summarize(fmt.kind === 'sets' ? runSets(race, fmt, s) : runLegs(race, fmt, s), fmt);
  const scen = {};
  if (starter === 'a' || starter === 'b') scen[starter] = run(starter);
  else { scen.a = run('a'); scen.b = run('b'); }
  const main = starter === 'a' || starter === 'b' ? scen[starter] : mix(scen.a, scen.b);
  return {
    format: fmt, starter: starter || 'unknown',
    leg: { p_a_start: race.a.a.p, p_a_receive: race.b.a.p, p_b_start: race.b.b.p, p_b_receive: race.a.b.p,
      hold_a: race.a.a.p, hold_b: race.b.b.p, break_a: race.b.a.p, break_b: race.a.b.p,
      exp_visits_start: expOf(race.a.a.visits) * race.a.a.p + expOf(race.a.b.visits) * race.a.b.p,
      residual: Math.max(race.a.residual, race.b.residual) },
    ...main,
    scenarios: starter === 'a' || starter === 'b' ? null : { a_starts: { p_a: scen.a.p_a }, b_starts: { p_a: scen.b.p_a } },
    first_leg_p_a: starter === 'b' ? race.b.a.p : starter === 'a' ? race.a.a.p : (race.a.a.p + race.b.a.p) / 2,
  };
}
// mezcla 50/50 de dos resúmenes (bull-off desconocido: prior simétrico explícito, bloque 4.2)
function mix(x, y) {
  const mp = (p, q) => { const m = new Map(); for (const [k, v] of p) m.set(k, v / 2); for (const [k, v] of q) m.set(k, (m.get(k) || 0) + v / 2); return [...m.entries()].sort((a, b) => (typeof a[0] === 'number' ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0])))); };
  const blk = (bx, by, keys) => { if (!bx || !by) return null; const o = {}; for (const k of keys) o[k] = mp(bx[k], by[k]); for (const k of Object.keys(bx)) if (typeof bx[k] === 'number') o[k] = (bx[k] + by[k]) / 2; return o; };
  return {
    p_a: (x.p_a + y.p_a) / 2, mass: (x.mass + y.mass) / 2, exp_visits: (x.exp_visits + y.exp_visits) / 2,
    legs: blk(x.legs, y.legs, ['total', 'a', 'b', 'margin', 'score']),
    sets: blk(x.sets, y.sets, ['total', 'score', 'margin']),
    x180: blk(x.x180, y.x180, ['a', 'b', 'total']),
    checkout_max: { a: mp(x.checkout_max.a, y.checkout_max.a), b: mp(x.checkout_max.b, y.checkout_max.b), match: mp(x.checkout_max.match, y.checkout_max.match) },
  };
}

// ── LECTURAS DE MERCADO SOBRE UNA PMF ────────────────────────────────────────────────────────────────────
// P(X > línea), P(X < línea) y P(push) para totales; para hándicaps se pasa la PMF del margen A−B.
function overUnder(pmf, line) {
  let over = 0, under = 0, push = 0;
  for (const [k, p] of pmf) { if (k > line + 1e-9) over += p; else if (k < line - 1e-9) under += p; else push += p; }
  return { over, under, push };
}
function handicap(marginPmf, lineA) {
  // A cubre si (margen + línea) > 0
  let cover = 0, fail = 0, push = 0;
  for (const [m, p] of marginPmf) { const v = m + lineA; if (v > 1e-9) cover += p; else if (v < -1e-9) fail += p; else push += p; }
  return { cover, fail, push };
}
// P(máximo checkout > c) desde la acumulada [[c, F(c)]]
function checkoutOver(cdf, c) { let F = 0; for (const [k, v] of cdf) { if (k <= c) F = v; else break; } return 1 - F; }

module.exports = { legRace, compileMatch, runLegs, runSets, summarize, overUnder, handicap, checkoutOver, NCAP };
