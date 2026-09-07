// darts-engine/kernel.js — EL KERNEL DE VISITA Y LA CARRERA DEL 501 (blueprint 8.0, bloques 9-15)
//
// Átomo mecánico: una decisión de objetivo (a) y un resultado de lanzamiento (y). Con el nivel de dato que
// hay hoy (L1: media de tres dardos, 180s por leg, % de dobles), la política y la precisión NO son
// identificables por separado; por eso el kernel se parametriza con TRES habilidades interpretables que sí
// se pueden anclar a lo observado —precisión al triple (pT), precisión al doble (pD) y arrastre dentro de la
// visita (rho, el "groove" que separa 180s de una media)— y una política de checkout que se RESUELVE por
// programación dinámica (mínimo de dardos esperados), no por una tabla de salidas copiada.
//
// Lo que sale de aquí es EXACTO respecto al kernel: la distribución de visitas necesarias para cerrar 501
// jugando solo (T), conjunta con el número de 180s y con el valor del checkout terminal. La carrera del leg
// (compiler.js) la compone con la identidad P(A gana | A sale) = Σ_k P(T_A = k) P(T_B ≥ k). No hay Monte Carlo
// en la probabilidad: el muestreo queda para pintar trayectorias, no para calcular precios.
'use strict';

const R = require('./rules');

const KMAX = 36;          // visitas máximas contempladas por leg (la masa residual se declara, no se esconde)
const N180MAX = 3;        // 180s por jugador y leg: como mucho dos desde 501 (501→321→141); tres es imposible
const UNOPENED = 502;     // pseudo-marcador: 501 sin abrir en double-in

// ── EL KERNEL POR DARDO ──────────────────────────────────────────────────────────────────────────────────
// Regional, sin geometría: la masa que no acierta el objetivo se reparte entre el mismo número (otro anillo)
// y los dos vecinos de la diana. Las proporciones son PRIORS declarados (bloque 12.1: "priors nunca eliminan
// misses plausibles"), no medidas de ningún jugador; las tres habilidades sí se anclan a datos.
function dartKernel(aim, sk, prevTrebleHit) {
  const out = [];
  const push = (y, p) => { if (p > 1e-9) out.push([y, p]); };
  if (aim.kind === 'T') {
    const n = aim.n, [l, r] = R.neighbours(n);
    const p = prevTrebleHit ? sk.pT + sk.rho * (1 - sk.pT) : sk.pT;
    const m = 1 - p;
    // `s` = qué parte del fallo se queda en el single grande del mismo número (la "calidad del fallo"): es la
    // segunda habilidad identificable con media + tasa de 180s, y separa al que falla cerca del que falla lejos
    const s = sk.s != null ? sk.s : 0.8;
    push(R.outcome('T', n), p);
    push(R.outcome('S', n), m * s);
    push(R.outcome('T', l), m * (1 - s) * 0.125); push(R.outcome('T', r), m * (1 - s) * 0.125);
    push(R.outcome('S', l), m * (1 - s) * 0.375); push(R.outcome('S', r), m * (1 - s) * 0.375);
    return out;
  }
  if (aim.kind === 'D') {
    const n = aim.n, [l, r] = R.neighbours(n);
    const p = sk.pD, m = 1 - p;
    push(R.outcome('D', n), p);
    push(R.outcome('S', n), m * 0.56);          // fallo por dentro: el single del mismo número
    push(R.outcome('MISS'), m * 0.36);          // fallo por fuera: cero
    push(R.outcome('D', l), m * 0.04); push(R.outcome('D', r), m * 0.04);
    return out;
  }
  if (aim.kind === 'DB') {
    const p = sk.pB, m = 1 - p;
    push(R.outcome('DB'), p);
    push(R.outcome('SB'), m * 0.58);
    // el resto cae en singles del anillo interior: se representa con dos singles típicos (alto y bajo)
    push(R.outcome('S', 20), m * 0.21); push(R.outcome('S', 3), m * 0.21);
    return out;
  }
  if (aim.kind === 'SB') {
    const p = Math.min(0.9, sk.pB + 0.25), m = 1 - p;
    push(R.outcome('SB'), p); push(R.outcome('DB'), m * 0.25); push(R.outcome('S', 20), m * 0.375); push(R.outcome('S', 3), m * 0.375);
    return out;
  }
  // single (jugada de preparación): se apunta al single grande y el error va al triple/doble del mismo número
  // y a los singles vecinos
  const n = aim.n, [l, r] = R.neighbours(n);
  const p = sk.pS, m = 1 - p;
  push(R.outcome('S', n), p);
  push(R.outcome('T', n), m * 0.30); push(R.outcome('D', n), m * 0.12);
  push(R.outcome('S', l), m * 0.29); push(R.outcome('S', r), m * 0.29);
  return out;
}

// habilidades derivadas de las tres primarias
function skills({ pT, pD, rho = 0.3, s = 0.8 }) {
  const t = Math.min(0.75, Math.max(0.05, pT)), d = Math.min(0.75, Math.max(0.08, pD));
  return { pT: t, pD: d, rho: Math.min(0.8, Math.max(0, rho)), s: Math.min(0.96, Math.max(0.5, s)), pS: Math.min(0.93, 0.62 + 0.5 * t), pB: Math.max(0.05, d * 0.72) };
}

// acciones candidatas para la política de cierre/preparación
const ACTIONS = (() => {
  const a = [];
  for (let n = 1; n <= 20; n++) { a.push({ kind: 'T', n }); a.push({ kind: 'S', n }); a.push({ kind: 'D', n }); }
  a.push({ kind: 'DB', n: 25 }); a.push({ kind: 'SB', n: 25 });
  return a;
})();
const aimKey = (a) => a.kind + a.n;

// ── LA POLÍTICA: MÍNIMO DE DARDOS ESPERADOS (bloque 13, objetivo declarado: "cerrar solo lo antes posible") ─
// W(r, d) = dardos esperados hasta cerrar desde r con d dardos en la mano. Aproximación declarada: un bust
// devuelve a r (no al inicio real de la visita, que la política no conoce). La DINÁMICA del kernel de visita
// sí aplica el bust exacto; solo la elección de objetivo usa esta vista. Por encima de 170 la política es
// T20 (con el cambio a T19 cuando el 20 está "tapado" fuera del alcance de un modelo regional).
const POLICY_CACHE = new Map();
function policyFor(sk) {
  // la política depende sobre todo de la precisión al doble; el triple entra en pasos gruesos (0,1) para que
  // la calibración por bisección no recompute la DP en cada paso
  const key = [Math.round(sk.pT * 10), Math.round(sk.pD * 20)].join('|');
  let pol = POLICY_CACHE.get(key);
  if (pol) return pol;
  const W = []; // W[r][d] d∈{1,2,3}
  for (let r = 0; r <= 170; r++) W[r] = [0, 0, 0, 0];
  const best = []; for (let r = 0; r <= 170; r++) best[r] = [null, null, null, null];
  const kern = new Map(); for (const a of ACTIONS) kern.set(aimKey(a), dartKernel(a, sk, false));
  const val = (r, d) => (r === 0 ? 0 : W[r][d === 0 ? 3 : d]);
  for (let sweep = 0; sweep < 60; sweep++) {
    let delta = 0;
    for (let r = 2; r <= 170; r++) {
      for (let d = 1; d <= 3; d++) {
        let bestV = Infinity, bestA = null;
        for (const a of ACTIONS) {
          // no se apunta a lo que sobrepasa seguro ni a un cierre imposible con score impar
          const aScore = a.kind === 'DB' ? 50 : a.kind === 'SB' ? 25 : (a.kind === 'S' ? 1 : a.kind === 'D' ? 2 : 3) * a.n;
          if (aScore > r) continue;
          if (r - aScore === 1) continue;
          if (r - aScore === 0 && !(a.kind === 'D' || a.kind === 'DB')) continue;
          // realismo declarado: un single o el 25 solo se apuntan como PREPARACIÓN que deja un doble limpio
          // (par ≤ 40 o 50); nadie tira a un single para dejarse 43
          if ((a.kind === 'S' || a.kind === 'SB') && !((r - aScore <= 40 && (r - aScore) % 2 === 0) || r - aScore === 50)) continue;
          let v = 1;
          for (const [y, p] of kern.get(aimKey(a))) {
            const t = R.applyDart(r, y);
            if (t.type === 'FINISH') continue;
            if (t.type === 'BUST') v += p * (val(r, 3) + 0.5); // bust: vuelta al inicio + medio dardo de penalización por el turno perdido
            else v += p * val(t.r, d - 1);
          }
          if (v < bestV - 1e-12) { bestV = v; bestA = a; }
        }
        delta = Math.max(delta, Math.abs(bestV - W[r][d]));
        W[r][d] = bestV; best[r][d] = bestA;
      }
    }
    if (delta < 1e-7) break;
  }
  pol = { W, best, key };
  POLICY_CACHE.set(key, pol);
  return pol;
}
function aimFor(pol, r, d) {
  if (r > 170) return { kind: 'T', n: 20 };
  return pol.best[r][d] || { kind: 'T', n: 20 };
}

// ── EL KERNEL DE VISITA ──────────────────────────────────────────────────────────────────────────────────
// Desde un marcador de inicio r0 (o UNOPENED en double-in) enumera los ≤3 dardos bajo la política y
// devuelve la transición agregada: a qué marcador se llega, cuántos dardos se tiraron, si se cerró (y con
// qué doble), si la visita fue un 180. El bust devuelve EXACTAMENTE a r0 y termina la visita.
// LA VISITA DE PUNTUACIÓN PURA (r ≥ 182): tres dardos al T20, sin cierre ni bust posibles. Su distribución
// de puntos no depende del marcador, así que se enumera UNA vez por habilidad y se reutiliza — es lo que
// hace que un leg entero cueste milisegundos en vez de recorrer 343 caminos para cada uno de 320 marcadores.
const SCORING_CACHE = new Map();
function scoringVisit(sk) {
  const key = [sk.pT, sk.rho, sk.s].join('|');
  let d = SCORING_CACHE.get(key);
  if (d) return d;
  const acc = new Map(); // score → {p, p180}
  (function rec(depth, prevT, scored, p) {
    if (depth === 3) { const o = acc.get(scored) || { p: 0 }; o.p += p; acc.set(scored, o); return; }
    for (const [y, py] of dartKernel({ kind: 'T', n: 20 }, sk, prevT)) rec(depth + 1, y.kind === 'T' && y.n === 20, scored + y.score, p * py);
  })(0, false, 0, 1);
  d = [...acc.entries()].map(([s, o]) => ({ s, p: o.p, is180: s === 180 })).sort((a, b) => a.s - b.s);
  if (SCORING_CACHE.size > 2000) SCORING_CACHE.clear();
  SCORING_CACHE.set(key, d);
  return d;
}

function visitKernel(r0, sk, pol, { doubleIn = false } = {}) {
  if (r0 >= 182 && r0 !== UNOPENED) {
    // atajo exacto: ninguna suma de tres dardos al 20 supera 180, así que desde ≥182 no hay bust ni cierre
    return scoringVisit(sk).map((d) => ({ to: r0 - d.s, darts: 3, fin: false, dbl: null, n180: d.is180 ? 1 : 0, p: d.p }));
  }
  const trans = new Map(); // key → {to, darts, fin, dbl, n180:0|1, p}
  const add = (to, darts, fin, dbl, is180, p) => {
    if (p < 1e-10) return;
    const k = to + '|' + darts + '|' + (fin ? 1 : 0) + '|' + (dbl || '') + '|' + (is180 ? 1 : 0);
    const cur = trans.get(k);
    if (cur) cur.p += p; else trans.set(k, { to, darts, fin, dbl: dbl || null, n180: is180 ? 1 : 0, p });
  };
  const unopened = doubleIn && r0 === UNOPENED;
  const startR = unopened ? 501 : r0;
  (function rec(r, d, opened, prevT, scored, p) {
    if (d === 0) { add(opened ? r : UNOPENED, 3, false, null, scored === 180, p); return; }
    let aim;
    if (!opened) aim = { kind: 'D', n: 20 };                    // apertura: los profesionales van al D20 (prior declarado)
    else aim = aimFor(pol, r, d);
    for (const [y, py] of dartKernel(aim, sk, prevT)) {
      const t = R.applyDart(r, y, { doubleIn, opened });
      const dartsUsed = 4 - d;
      if (t.type === 'NOOPEN') { rec(r, d - 1, false, false, scored, p * py); continue; }
      if (t.type === 'BUST') { add(unopened ? UNOPENED : r0, dartsUsed, false, null, false, p * py); continue; }
      if (t.type === 'FINISH') { add(0, dartsUsed, true, y.key, false, p * py); continue; }
      const hitT = aim.kind === 'T' && y.kind === 'T' && y.n === aim.n;
      rec(t.r, d - 1, true, hitT, scored + y.score, p * py);
    }
  })(startR, 3, !unopened, false, 0, 1);
  return [...trans.values()];
}

// ── EL JUGADOR SOLO ANTE EL 501: distribución de visitas, dardos, 180s y checkout ───────────────────────
// Devuelve, para un jugador con habilidades `sk` y un marcador de arranque (501 o UNOPENED):
//   fin[k][n]   P(cierra exactamente en su visita k con n 180s acumulados)
//   alive[k][n] P(sigue vivo tras k visitas con n 180s)  (alive[0][0] = 1)
//   darts: PMF del total de dardos tirados hasta cerrar; expDarts; mass residual tras KMAX
//   checkout: PMF del valor del checkout terminal (puntos anotados en la visita que cierra)
//   dbl: PMF del doble con el que cierra; p180Leg: E[180s por leg]; visits: PMF de visitas
function soloLeg(sk, { doubleIn = false, start = null, kmax = KMAX } = {}) {
  const pol = policyFor(sk);
  const r0 = start != null ? start : (doubleIn ? UNOPENED : 501);
  const KC = new Map(); // kernel por marcador, perezoso
  const kernelOf = (r) => { let k = KC.get(r); if (!k) { k = visitKernel(r, sk, pol, { doubleIn }); KC.set(r, k); } return k; };
  // masa por [n180][r]
  let M = Array.from({ length: N180MAX + 1 }, () => new Float64Array(UNOPENED + 1));
  M[0][r0] = 1;
  const fin = Array.from({ length: kmax + 1 }, () => new Float64Array(N180MAX + 1));
  const alive = Array.from({ length: kmax + 1 }, () => new Float64Array(N180MAX + 1));
  alive[0][0] = 1;
  const darts = new Float64Array(3 * kmax + 4);
  const checkout = new Float64Array(171);
  const dbl = new Map();
  let expDarts = 0, exp180 = 0;
  for (let k = 1; k <= kmax; k++) {
    const N = Array.from({ length: N180MAX + 1 }, () => new Float64Array(UNOPENED + 1));
    let any = false;
    for (let n = 0; n <= N180MAX; n++) {
      const row = M[n];
      for (let r = 2; r <= UNOPENED; r++) {
        const m = row[r];
        if (m < 1e-13) continue;
        any = true;
        for (const t of kernelOf(r)) {
          const p = m * t.p;
          const n2 = Math.min(N180MAX, n + t.n180);
          expDarts += p * t.darts;
          if (t.fin) {
            fin[k][n2] += p; darts[3 * (k - 1) + t.darts] += p; checkout[r === UNOPENED ? 0 : r] += p;
            dbl.set(t.dbl, (dbl.get(t.dbl) || 0) + p);
          } else N[n2][t.to] += p;
        }
      }
    }
    M = N;
    let tot = 0;
    for (let n = 0; n <= N180MAX; n++) { let s = 0; const row = M[n]; for (let r = 2; r <= UNOPENED; r++) s += row[r]; alive[k][n] = s; tot += s; }
    if (!any || tot < 1e-10) { for (let k2 = k + 1; k2 <= kmax; k2++) for (let n = 0; n <= N180MAX; n++) alive[k2][n] = alive[k][n]; break; }
  }
  let residual = 0; for (let n = 0; n <= N180MAX; n++) residual += alive[kmax][n];
  // E[180s por leg] = Σ_k Σ_n n·fin[k][n] + masa residual con sus 180s
  for (let k = 1; k <= kmax; k++) for (let n = 1; n <= N180MAX; n++) exp180 += n * fin[k][n];
  for (let n = 1; n <= N180MAX; n++) exp180 += n * alive[kmax][n];
  const visits = new Float64Array(kmax + 1);
  for (let k = 1; k <= kmax; k++) for (let n = 0; n <= N180MAX; n++) visits[k] += fin[k][n];
  // el checkout se normaliza sobre lo cerrado
  let zc = 0; for (let c = 0; c <= 170; c++) zc += checkout[c];
  const ck = []; for (let c = 2; c <= 170; c++) if (checkout[c] > 1e-9) ck.push([c, checkout[c] / (zc || 1)]);
  const dblRows = [...dbl.entries()].map(([k, p]) => [k, p / (zc || 1)]).sort((a, b) => b[1] - a[1]);
  return { fin, alive, visits, darts, expDarts, exp180, residual, checkout: ck, checkoutCdf: cdfOf(ck), dbl: dblRows, kmax, avg3: 1503 / expDarts, policyKey: pol.key };
}
function cdfOf(pmf) { const out = []; let s = 0; for (const [c, p] of pmf) { s += p; out.push([c, s]); } return out; }

// ── ANCLAJE A LO OBSERVADO: de (media, 180/leg, % dobles) a (pT, rho, pD) ────────────────────────────────
// La media de tres dardos de un leg jugado solo es 1503 / E[dardos]; se busca pT por bisección para que el
// motor reproduzca la media observada dado pD (del % de dobles, que ES precisión por dardo al doble) y rho
// (del ritmo de 180s por leg). Como los tres interactúan (más arrastre → más media), se iteran dos vueltas.
const CAL_CACHE = new Map();
// `per180` es por LEG; `per180Visit` es por VISITA (180s / (dardos/3)), que es lo que sale de un leaderboard
// con puntos y dardos pero sin legs. Se acepta cualquiera de las dos; por visita se compara con
// exp180 / (expDarts/3) del propio kernel, así la conversión a legs la hace el motor y no una regla de tres.
function calibrate({ avg, per180 = null, per180Visit = null, checkoutPct = null }, { doubleIn = false } = {}) {
  // se redondea a media unidad de media y a dos centésimas de 180/leg: dos jugadores casi iguales comparten
  // calibración, y la caché deja de ser decorativa
  const a = Math.round(2 * Math.min(115, Math.max(45, +avg || 80))) / 2;
  const cp = Math.round(100 * (checkoutPct != null && checkoutPct > 0 ? Math.min(0.6, Math.max(0.15, checkoutPct)) : (0.22 + 0.2 * (a - 60) / 45))) / 100;
  const p180 = per180 != null && per180 > 0 ? Math.round(50 * Math.min(1.2, per180)) / 50 : null;
  const p180v = p180 == null && per180Visit != null && per180Visit > 0 ? Math.round(200 * Math.min(0.4, per180Visit)) / 200 : null;
  const key = [a, p180 != null ? p180 : 'x', p180v != null ? 'v' + p180v : 'x', cp, doubleIn ? 1 : 0].join('|');
  const hit = CAL_CACHE.get(key); if (hit) return hit;
  // DOS OBSERVABLES, DOS PARÁMETROS. La media identifica la precisión al triple (pT) dada la calidad del
  // fallo; la tasa de 180s identifica el ARRASTRE dentro de la visita (rho: cuánto sube el segundo y tercer
  // triple tras acertar el primero) — que es justo lo que separa a dos jugadores de la misma media con
  // distinta cola de 180s. La calidad del fallo (s: cuánto del fallo cae en el 20 simple) queda en el prior
  // de élite 0,88: con datos de partido no es separable de pT. Sin tasa de 180s, rho se queda en el prior
  // 0,2 y pT sale de la media sola (menos identificado, y se dice: `identified: 'avg'`).
  const S_ELITE = 0.88, RHO_PRIOR = 0.2;
  let rho = RHO_PRIOR, pT = 0.3, s = S_ELITE;
  let leg = null, sk = null;
  const rate180 = (L) => (p180 != null ? L.exp180 : L.exp180 / (L.expDarts / 3));
  const target180 = p180 != null ? p180 : p180v;
  const fitT = (iters) => { let lo = 0.06, hi = 0.72; for (let i = 0; i < iters; i++) { pT = (lo + hi) / 2; sk = skills({ pT, pD: cp, rho, s }); leg = soloLeg(sk, { doubleIn }); if (leg.avg3 < a) lo = pT; else hi = pT; } };
  const fitR = (iters) => { let lo = 0, hi = 0.8; for (let i = 0; i < iters; i++) { rho = (lo + hi) / 2; sk = skills({ pT, pD: cp, rho, s }); leg = soloLeg(sk, { doubleIn }); if (rate180(leg) < target180) lo = rho; else hi = rho; } };
  let identified = 'avg';
  if (target180 != null) {
    fitT(10); fitR(7); fitT(8); fitR(6); fitT(7);
    identified = Math.abs(rate180(leg) - target180) / target180 < 0.15 ? 'avg+180' : 'avg (180s fuera de rango: rho en el tope)';
  } else fitT(11);
  sk = skills({ pT, pD: cp, rho, s });
  leg = soloLeg(sk, { doubleIn });
  const out = { sk, leg, identified, target: { avg: a, per180: p180, per180Visit: p180v, checkoutPct: cp }, fitted: { avg3: leg.avg3, exp180: leg.exp180, exp180Visit: leg.exp180 / (leg.expDarts / 3), expDarts: leg.expDarts } };
  if (CAL_CACHE.size > 400) CAL_CACHE.clear();
  CAL_CACHE.set(key, out);
  return out;
}

// ── MUESTREO DE TRAYECTORIAS (solo para pintar: River, Filmstrip; jamás para el precio) ─────────────────
function sampleVisit(r0, sk, pol, rng, { doubleIn = false } = {}) {
  const trans = visitKernel(r0, sk, pol, { doubleIn });
  let u = rng(), acc = 0;
  for (const t of trans) { acc += t.p; if (u <= acc) return t; }
  return trans[trans.length - 1];
}
function sampleLeg(skA, skB, { starter = 'a', doubleIn = false, rng = Math.random } = {}) {
  const pa = policyFor(skA), pb = policyFor(skB);
  const st = { a: doubleIn ? UNOPENED : 501, b: doubleIn ? UNOPENED : 501 };
  const visits = [];
  let turn = starter, n = 0;
  while (n < 80) {
    const sk = turn === 'a' ? skA : skB, pol = turn === 'a' ? pa : pb;
    const from = st[turn];
    const t = sampleVisit(from, sk, pol, rng, { doubleIn });
    const to = t.fin ? 0 : t.to;
    visits.push({ who: turn, from: from === UNOPENED ? 501 : from, to: to === UNOPENED ? 501 : to, darts: t.darts, scored: (from === UNOPENED ? 501 : from) - (to === UNOPENED ? 501 : to), fin: t.fin, dbl: t.dbl, is180: !!t.n180, bust: !t.fin && t.to === from && t.darts < 3 });
    st[turn] = to;
    if (t.fin) return { winner: turn, visits };
    turn = turn === 'a' ? 'b' : 'a'; n++;
  }
  return { winner: null, visits };
}

module.exports = { KMAX, N180MAX, UNOPENED, dartKernel, skills, policyFor, aimFor, visitKernel, soloLeg, calibrate, sampleLeg, ACTIONS };
