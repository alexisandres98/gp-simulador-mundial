// tennis-engine/compiler.js — EL COMPILADOR DE PUNTUACIÓN (blueprint 6.0, bloques 16-17)
//
// El átomo es el punto: P(el sacador gana el punto) para cada lado. Todo lo demás se COMPILA con las
// reglas exactas del tenis — juego con deuce, tiebreak con alternancia real de saque, set con TB en
// 6-6, partido al mejor de 3 o 5 — de modo que ganador, totales de juegos, hándicap y probabilidad de
// tiebreak salen del MISMO estado y no pueden contradecirse entre sí (T-0414).
//
// Aproximaciones internas declaradas:
//  · puntos IID dentro del partido (la no-IID es hipótesis de investigación, bloque 16)
//  · quién saca primero en cada set se promedia (efecto pequeño y simétrico)
//  · el super-tiebreak de set final se trata como tiebreak normal (misma mecánica, más largo)
'use strict';

// P(el sacador gana un juego) con p = prob de punto al saque. Fórmula cerrada con deuce.
function gameHold(p) {
  const q = 1 - p;
  const deuce = 20 * Math.pow(p, 3) * Math.pow(q, 3) * (p * p / (1 - 2 * p * q));
  return Math.pow(p, 4) * (1 + 4 * q + 10 * q * q) + deuce;
}

// P(A gana el tiebreak) sacando A el primer punto. pa/pb = prob de punto al saque de cada uno.
// Secuencia real: 1 punto A, luego bloques de 2 alternando. DP exacta hasta 6-6; cierre en cadena.
function tiebreak(pa, pb) {
  const memo = new Map();
  const at66 = () => { const w = pa * (1 - pb); const l = (1 - pa) * pb; return w / (w + l); };
  function pt(n) { // ¿saca A el punto n (0-index)? patrón: A | BB | AA | BB…
    return n === 0 ? true : (Math.floor((n - 1) / 2) % 2 === 1);
  }
  function f(a, b) {
    if (a >= 7 && a - b >= 2) return 1;
    if (b >= 7 && b - a >= 2) return 0;
    if (a === 6 && b === 6) return at66();
    const k = a * 16 + b; if (memo.has(k)) return memo.get(k);
    const aServes = pt(a + b);
    const pWin = aServes ? pa : (1 - pb);
    const v = pWin * f(a + 1, b) + (1 - pWin) * f(a, b + 1);
    memo.set(k, v); return v;
  }
  return f(0, 0);
}

// Set estándar (6 juegos, dif 2, TB en 6-6). Devuelve, sacando A el primer juego:
//   pA — prob de que A gane el set
//   dist — [{games, tb, pA_frac, pB_frac}] prob por total de juegos del set, partida por ganador
function setDist(pa, pb, shock) {
  // choque de ejecución (T-0374): el juego se sirve en un estado bueno o malo con igual prob —
  // captura la varianza intra-partido que el supuesto IID plancha y que infla los holds.
  const sh = shock || 0;
  const holdA = sh ? (gameHold(pa + sh) + gameHold(pa - sh)) / 2 : gameHold(pa);
  const holdB = sh ? (gameHold(pb + sh) + gameHold(pb - sh)) / 2 : gameHold(pb);
  const out = new Map(); // key games*2+tb → {a, b}
  const add = (g, tb, winA, pr) => {
    const k = g * 2 + tb;
    const o = out.get(k) || { a: 0, b: 0 };
    if (winA) o.a += pr; else o.b += pr;
    out.set(k, o);
  };
  (function f(a, b, pr) {
    if (pr < 1e-12) return;
    if (a >= 6 && a - b >= 2) return add(a + b, 0, true, pr);
    if (b >= 6 && b - a >= 2) return add(a + b, 0, false, pr);
    if (a === 6 && b === 6) {
      const t = tiebreak(pa, pb); // el que saca primero en el TB alterna; promedio simétrico
      const t2 = 1 - tiebreak(pb, pa);
      const pT = (t + t2) / 2;
      add(13, 1, true, pr * pT); add(13, 1, false, pr * (1 - pT));
      return;
    }
    const aServes = (a + b) % 2 === 0;
    const pWin = aServes ? holdA : (1 - holdB);
    f(a + 1, b, pr * pWin); f(a, b + 1, pr * (1 - pWin));
  })(0, 0, 1);
  let pA = 0; const dist = [];
  for (const [k, o] of out) { pA += o.a; dist.push({ games: k >> 1, tb: k & 1, a: o.a, b: o.b }); }
  return { pA, dist };
}

// Partido al mejor de N. Promedia quién saca primero el set (aprox declarada) y convoluciona la
// distribución de juegos por set condicionada al ganador. Devuelve el estado completo del que salen
// TODOS los mercados derivados.
function matchDist(pa, pb, bestOf, shock) {
  const s1 = setDist(pa, pb, shock), s2raw = setDist(pb, pa, shock);
  // s2raw está "del lado de B": convertir a lado A
  const s2 = { pA: 1 - s2raw.pA, dist: s2raw.dist.map((d) => ({ games: d.games, tb: d.tb, a: d.b, b: d.a })) };
  const pSet = (s1.pA + s2.pA) / 2;
  const dist = new Map(); // juegos → prob (promedio de ambos órdenes de saque)
  const distW = new Map(), distL = new Map(); // condicionadas a ganar/perder A el set
  let tbA = 0, tbTot = 0;
  for (const src of [s1, s2]) {
    for (const d of src.dist) {
      dist.set(d.games, (dist.get(d.games) || 0) + (d.a + d.b) / 2);
      distW.set(d.games, (distW.get(d.games) || 0) + d.a / 2);
      distL.set(d.games, (distL.get(d.games) || 0) + d.b / 2);
      if (d.tb) tbTot += (d.a + d.b) / 2;
    }
  }
  const norm = (m, z) => { const o = []; for (const [g, p] of m) o.push([g, p / z]); return o.sort((x, y) => x[0] - y[0]); };
  const setGamesW = norm(distW, pSet);            // dist de juegos si A gana el set
  const setGamesL = norm(distL, 1 - pSet);        // dist si la pierde
  const need = Math.ceil(bestOf / 2);

  // DP sobre sets: estado (setsA, setsB) → prob; al terminar acumula caminos con nº de sets
  const paths = []; // {pr, sA, sB}
  (function f(sA, sB, pr) {
    if (sA === need) return paths.push({ pr, sA, sB, winA: true });
    if (sB === need) return paths.push({ pr, sA, sB, winA: false });
    f(sA + 1, sB, pr * pSet); f(sA, sB + 1, pr * (1 - pSet));
  })(0, 0, 1);

  let pMatchA = 0; const setScores = {}; const totalGames = new Map();
  let expGames = 0, pNoTb = 0;
  const pNoTbSet = 1 - tbTot; // prob de que UN set no tenga TB
  // juegos ganados por jugador (para hándicap): acumular dist conjunta (gA, gB) por camino
  const margin = new Map(); // (gA - gB) → prob
  const gamesOfSet = (winA) => (winA ? setGamesW : setGamesL);
  // dist de (total, margen) por set condicionado a ganador: necesitamos gA y gB por marcador de set.
  // Reconstruimos por marcador exacto del set: usar dist por marcador (a,b) en lugar de solo total.
  // setDist ya colapsó a totales; recomputamos marcadores exactos aquí para el margen:
  const score1 = exactScores(pa, pb, shock), score2raw = exactScores(pb, pa, shock);
  const score2 = score2raw.map((d) => ({ a: d.b, b: d.a, pr: d.pr }));
  const scoreAvg = avgScores(score1, score2);
  const scoreW = scoreAvg.filter((d) => d.a > d.b), scoreL = scoreAvg.filter((d) => d.b > d.a);
  const zW = scoreW.reduce((s, d) => s + d.pr, 0) || 1, zL = scoreL.reduce((s, d) => s + d.pr, 0) || 1;
  scoreW.forEach((d) => { d.pr /= zW; }); scoreL.forEach((d) => { d.pr /= zL; });

  for (const ph of paths) {
    if (ph.winA) pMatchA += ph.pr;
    const key = ph.winA ? `${ph.sA}-${ph.sB}` : `${ph.sB}-${ph.sA}`;
    const side = ph.winA ? 'a' : 'b';
    setScores[key] = setScores[key] || { a: 0, b: 0 };
    setScores[key][side] += ph.pr;
    // convolución de juegos del camino: sA sets con dist W, sB con dist L (el orden no altera la suma)
    let acc = [{ g: 0, m: 0, pr: 1 }];
    for (let i = 0; i < ph.sA; i++) acc = conv(acc, scoreW);
    for (let i = 0; i < ph.sB; i++) acc = conv(acc, scoreL);
    for (const st of acc) {
      totalGames.set(st.g, (totalGames.get(st.g) || 0) + ph.pr * st.pr);
      margin.set(st.m, (margin.get(st.m) || 0) + ph.pr * st.pr);
      expGames += ph.pr * st.pr * st.g;
    }
    pNoTb += ph.pr * Math.pow(pNoTbSet, ph.sA + ph.sB);
  }
  return {
    pA: pMatchA, pSetA: pSet, holdA: gameHold(pa), holdB: gameHold(pb),
    tbAny: 1 - pNoTb, expGames,
    totalGames: [...totalGames.entries()].sort((x, y) => x[0] - y[0]),
    margin: [...margin.entries()].sort((x, y) => x[0] - y[0]),
    setScores,
  };

  function conv(acc, scores) {
    const m = new Map(); const out = [];
    for (const st of acc) for (const d of scores) {
      const g = st.g + d.a + d.b, mg = st.m + d.a - d.b, pr = st.pr * d.pr;
      const k = g * 200 + (mg + 100);
      const cur = m.get(k); if (cur) cur.pr += pr; else m.set(k, { g, m: mg, pr });
    }
    for (const v of m.values()) if (v.pr > 1e-10) out.push(v);
    return out;
  }
}

// marcadores exactos de set (a,b) con A sacando primero
function exactScores(pa, pb, shock) {
  const sh = shock || 0;
  const holdA = sh ? (gameHold(pa + sh) + gameHold(pa - sh)) / 2 : gameHold(pa);
  const holdB = sh ? (gameHold(pb + sh) + gameHold(pb - sh)) / 2 : gameHold(pb);
  const out = new Map();
  (function f(a, b, pr) {
    if (pr < 1e-12) return;
    if (a >= 6 && a - b >= 2) { const k = a * 16 + b; out.set(k, (out.get(k) || 0) + pr); return; }
    if (b >= 6 && b - a >= 2) { const k = a * 16 + b; out.set(k, (out.get(k) || 0) + pr); return; }
    if (a === 6 && b === 6) {
      const t = (tiebreak(pa, pb) + 1 - tiebreak(pb, pa)) / 2;
      out.set(7 * 16 + 6, (out.get(7 * 16 + 6) || 0) + pr * t);
      out.set(6 * 16 + 7, (out.get(6 * 16 + 7) || 0) + pr * (1 - t));
      return;
    }
    const aServes = (a + b) % 2 === 0;
    const pWin = aServes ? holdA : (1 - holdB);
    f(a + 1, b, pr * pWin); f(a, b + 1, pr * (1 - pWin));
  })(0, 0, 1);
  return [...out.entries()].map(([k, pr]) => ({ a: k >> 4, b: k & 15, pr }));
}

function avgScores(s1, s2) {
  const m = new Map();
  for (const arr of [s1, s2]) for (const d of arr) {
    const k = d.a * 16 + d.b; m.set(k, (m.get(k) || 0) + d.pr / 2);
  }
  return [...m.entries()].map(([k, pr]) => ({ a: k >> 4, b: k & 15, pr }));
}

// Vía ligera para la validación masiva: ganador, juegos esperados y P(TB) sin convolucionar
// las distribuciones completas (mismas matemáticas de set, ~20× más rápida que matchDist).
const LITE_CACHE = new Map(); // rejilla de 0,002 en p de punto: error < 3e-3 en pA, reutilización masiva
function matchLite(pa, pb, bestOf, shock) {
  const ka = Math.round(pa * 500), kb = Math.round(pb * 500), ks = Math.round((shock || 0) * 500);
  const key = ((ka * 4096 + kb * 8 + (bestOf === 5 ? 1 : 0)) * 64) + ks;
  const hit = LITE_CACHE.get(key); if (hit) return hit;
  pa = ka / 500; pb = kb / 500;
  const s1 = setDist(pa, pb, shock), s2raw = setDist(pb, pa, shock);
  const pSet = (s1.pA + (1 - s2raw.pA)) / 2;
  let eW = 0, zW = 0, eL = 0, zL = 0, tb = 0;
  for (const src of [s1.dist, s2raw.dist.map((d) => ({ games: d.games, tb: d.tb, a: d.b, b: d.a }))]) {
    for (const d of src) { eW += d.games * d.a / 2; zW += d.a / 2; eL += d.games * d.b / 2; zL += d.b / 2; if (d.tb) tb += (d.a + d.b) / 2; }
  }
  const gW = zW ? eW / zW : 0, gL = zL ? eL / zL : 0;
  const need = Math.ceil(bestOf / 2);
  let pA = 0, expGames = 0, pNoTb = 0;
  (function f(sA, sB, pr) {
    if (sA === need || sB === need) {
      if (sA === need) pA += pr;
      pNoTb += pr * Math.pow(1 - tb, sA + sB);
      expGames += pr * (sA * gW + sB * gL);
      return;
    }
    f(sA + 1, sB, pr * pSet); f(sA, sB + 1, pr * (1 - pSet));
  })(0, 0, 1);
  const out = { pA, expGames, tbAny: 1 - pNoTb, pSetA: pSet };
  if (LITE_CACHE.size < 400000) LITE_CACHE.set(key, out);
  return out;
}

module.exports = { gameHold, tiebreak, setDist, matchDist, matchLite };
