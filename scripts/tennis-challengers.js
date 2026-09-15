#!/usr/bin/env node
// scripts/tennis-challengers.js — T2.15: EL TOTAL DE JUEGOS CON MARCADORES LEGALES
//
// ── LA PREGUNTA ─────────────────────────────────────────────────────────────────────────────────────────
// La distribución de juegos de un partido de tenis es una MEZCLA de dos jorobas: el partido que acaba en
// dos sets y el que se va a tres. Entre las dos hay un valle, y el soporte tiene agujeros: al mejor de tres
// no existe un partido de 11 juegos ni de 40, y entre 12 y 39 solo caben ciertas sumas de marcadores de set
// legales (6-0, 6-1 … 7-5, 7-6).
//
// El compilador de la casa YA sabe eso —camino a camino, con marcadores exactos— y luego producción lo
// aplasta de dos maneras, las dos sobre la mezcla entera:
//   · `shift`: desplaza toda la distribución para que su media sea la calibrada (calG = a + b·E[juegos],
//     con b = 1,386 en ATP bo3: no es un ajuste fino, es un reescalado grande);
//   · `C6`: suma un residuo empírico por tercil de juegos esperados y reparte la masa fraccionaria entre
//     los dos enteros vecinos.
// Los dos mueven la mezcla COMO SI FUERA UNA SOLA JOROBA y dejan masa donde no puede caer ningún partido.
// El backtest del 2-sep ya lo había visto sin nombrarlo: «la real es bimodal por número de sets y el
// desplazamiento predecía over 45,1 % donde ocurría 40,7 %».
//
// ── EL ASPIRANTE ────────────────────────────────────────────────────────────────────────────────────────
// C7 modela PRIMERO cuántos sets dura el partido y DESPUÉS los juegos condicionados a ese número, cada
// componente sobre su propio soporte legal:
//
//     P(juegos = g) = Σ_k P(k sets) · P(juegos = g | k sets)
//
// P(k sets) se recalibra con una Platt sobre el logit del compilador; cada componente se inclina
// exponencialmente (`lib/conteos.js`, la misma inclinación que usa el challenger de tarjetas) hasta que su
// media sea la que dice una recta ajustada en entrenamiento. La inclinación NO puede sacar masa del soporte
// legal: q(g) ∝ p(g)·e^{θg} vale cero donde p vale cero. Ése es el punto entero.
//
// ── CONTRA QUIÉN COMPITE ────────────────────────────────────────────────────────────────────────────────
//   C0_crudo   el compilador sin calibrar (el suelo: si nadie le gana, la calibración sobra)
//   C0_shift   producción hoy fuera de ATP bo3
//   C6         producción hoy en ATP bo3 (residuo empírico por tercil)
//   CE         empírico por favoritismo: histograma del total por (circuito × formato × tercil de |p−0,5|)
//   mercado    NO SE PUEDE: ver el apartado "lo que no se ha podido medir" al final de la salida
//
// Todos sobre las MISMAS filas y con la MISMA información. Incertidumbre por racimos de PARTIDO
// (`lib/inferencia.js`) y Benjamini-Hochberg al 10 % sobre todas las comparaciones declaradas.
//
// ── CÓMO SE USA ─────────────────────────────────────────────────────────────────────────────────────────
//   node scripts/tennis-challengers.js                          # todo, con el holdout por defecto
//   node scripts/tennis-challengers.js --holdout 20250101 --out /tmp/ten.json
//   node scripts/tennis-challengers.js --tour atp --bo 3        # el único sitio donde C6 corre en producción
'use strict';

const fs = require('fs');
const D = require('../tennis-engine/data.js');
const C = require('../tennis-engine/compiler.js');
const CN = require('../lib/conteos.js');
const INF = require('../lib/inferencia.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const CONGELA = process.argv.includes('--congelado');
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r5 = (x) => (Number.isFinite(x) ? +x.toFixed(5) : null);

const DESDE = Number(arg('--desde', '20180101'));
const HOLDOUT = Number(arg('--holdout', '20250101'));
const TOUR = String(arg('--tour', 'ambos')).toLowerCase();
const BO = String(arg('--bo', 'ambos'));
const KMAX = 80;                       // ningún partido al mejor de cinco pasa de 80 juegos
const EPS = 1e-12;

// ══ 1. LA PASADA: el compilador en el estado PREVIO a cada partido ══════════════════════════════════════
// El estado sale de `D.recorre`, que es LA MISMA regla de actualización que usa producción (probado en
// `tests/tennis-replay.test.js`). Nada de lo que se calcula aquí ha visto el resultado del partido.
//
// CACHÉ DECLARADA: `matchDist` cuesta ~12 ms y hay decenas de miles de partidos. Se cachea por las
// probabilidades de punto redondeadas a 0,0025 — el mismo truco que `matchLite`, con el error acotado por
// esa rejilla. Sin ella la pasada tarda cinco minutos; con ella, menos de uno.
const CACHE = new Map();
function distDe(pa, pb, bo, shock) {
  const k = `${Math.round(pa * 400)}|${Math.round(pb * 400)}|${bo}|${Math.round(shock * 400)}`;
  let v = CACHE.get(k);
  if (!v) { v = C.matchDist(Math.round(pa * 400) / 400, Math.round(pb * 400) / 400, bo, shock); CACHE.set(k, v); }
  return v;
}

const recs = [];
let descartados = { retiro: 0, marcador_incoherente: 0, fuera_de_filtro: 0, sin_juegos: 0 };
const t0 = Date.now();
D.recorre({ desde: DESDE, onMatch: (r, t, ctx) => {
  const F = ctx.F;
  const tn = r[F.tour], bo = r[F.best_of] === 5 ? 5 : 3;
  if (TOUR !== 'ambos' && ((TOUR === 'atp' && tn !== 0) || (TOUR === 'wta' && tn !== 1))) { descartados.fuera_de_filtro++; return; }
  if (BO !== 'ambos' && +BO !== bo) { descartados.fuera_de_filtro++; return; }
  if (r[F.ret]) { descartados.retiro++; return; }          // un retiro trunca el total: no es una observación
  const gw = r[F.games_w], gl = r[F.games_l], sw = r[F.sets_w], sl = r[F.sets_l];
  if (!(gw >= 0 && gl >= 0) || gw + gl <= 0) { descartados.sin_juegos++; return; }
  const total = gw + gl, nsets = sw + sl;
  const need = Math.ceil(bo / 2);
  if (sw !== need || nsets < need || nsets > 2 * need - 1) { descartados.marcador_incoherente++; return; }
  const mp = D.probsEn(t, r[F.wid], r[F.lid], r[F.surface]);
  const md = distDe(mp.paSrv, mp.pbSrv, bo, t.cst.shock || 0);
  // `pA` aquí es la probabilidad del GANADOR real; para el favoritismo hace falta el módulo, que es
  // simétrico y por tanto no filtra el resultado.
  recs.push({
    d: r[F.date], tn, bo, surf: r[F.surface], total, nsets,
    exp: md.expGames, pA: md.pA, pSet: md.pSetA,
    pN: md.pNSets, gN: md.gamesByNSets, tg: md.totalGames,
  });
} });
console.error(`pasada: ${recs.length} partidos en ${((Date.now() - t0) / 1000).toFixed(1)} s · caché ${CACHE.size} entradas · descartados ${JSON.stringify(descartados)}`);

// ══ 2. LAS PMF DE CADA ASPIRANTE ═══════════════════════════════════════════════════════════════════════
const vacia = () => new Array(KMAX + 1).fill(0);
function aPmf(pares, { fraccional = false } = {}) {
  const p = vacia();
  for (const [g, pr] of pares) {
    if (!fraccional) { const k = Math.max(0, Math.min(KMAX, Math.round(g))); p[k] += pr; continue; }
    // la masa fraccionaria se reparte entre los dos enteros vecinos — la misma mecánica que usa `gamesPmf`
    const f = Math.floor(g), w = g - f;
    const a = Math.max(0, Math.min(KMAX, f)), b = Math.max(0, Math.min(KMAX, f + 1));
    p[a] += pr * (1 - w); if (w > 1e-12) p[b] += pr * w;
  }
  return CN.normaliza(p);
}
const medOf = (pmf) => { let m = 0; for (let k = 0; k <= KMAX; k++) m += k * pmf[k]; return m; };

// C0 crudo: el compilador tal cual, sin tocar
const c0crudo = (x) => aPmf(x.tg);
// C0 shift: producción fuera de ATP bo3 — desplaza TODA la distribución
function c0shift(x, cal) {
  const calG = cal[0] + cal[1] * x.exp;
  const shift = calG - x.exp;
  return aPmf(x.tg.map(([g, p]) => [g + shift, p]), { fraccional: true });
}
// C6: producción en ATP bo3 — calG + residuo empírico del tercil, masa fraccionaria a los vecinos
function c6(x, cal, tabla) {
  if (!tabla || !Array.isArray(tabla.cuts) || tabla.cuts.length !== 2) return null;
  const calG = cal[0] + cal[1] * x.exp;
  const t = x.exp < tabla.cuts[0] ? 0 : x.exp < tabla.cuts[1] ? 1 : 2;
  const pares = Object.entries(tabla.hist[t]).map(([rs, p]) => [calG + +rs, p]);
  return aPmf(pares, { fraccional: true });
}

// ── C7: la mezcla legal ────────────────────────────────────────────────────────────────────────────────
// `fit` trae, POR CIRCUITO Y FORMATO: las Platt de la duración y las rectas de la media condicionada.
//
// EL ERROR QUE HUBO QUE CORREGIR A MITAD (15-sep, y queda escrito porque el registro de experimentos lo
// exige). La primera versión indexaba las rectas de la media SOLO por número de sets, así que el "3" de un
// partido al mejor de tres —un partido igualado que se fue al desempate— y el "3" de un partido al mejor de
// cinco —una paliza en tres sets— caían en la misma recta. Y la Platt se saltaba el bo5 entero porque allí
// hay TRES duraciones posibles y el código solo sabía recalibrar dos. Resultado: C7 en bo5 salía con 11,79
// pp de error de calibración, casi tanto como el compilador sin calibrar. No era el modelo: era el ajuste.
// Ahora cada estrato tiene lo suyo y la duración se recalibra en cascada binaria, que vale para los dos
// formatos: P(pasa del mínimo) y, en bo5, P(llega al quinto | pasó del mínimo).
const estrato = (x) => `${x.tn}|${x.bo}`;
function probsDuracion(x, fit) {
  const pN = new Map(x.pN);
  const ks = [...pN.keys()].sort((a, b) => a - b);
  const pl = fit.pl && fit.pl[estrato(x)];
  if (!pl || ks.length < 2) return pN;
  const platt = (p, c) => { if (!c) return p;
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
    return 1 / (1 + Math.exp(-(c.a + c.b * Math.log(q / (1 - q))))); };
  if (ks.length === 2) {                       // bo3: 2 o 3 sets
    const q = platt(pN.get(ks[1]) || 0, pl.mas);
    return new Map([[ks[0], 1 - q], [ks[1], q]]);
  }
  // bo5: 3, 4 o 5 sets. Cascada: P(≥4) y P(=5 | ≥4). Las dos por separado, las dos legales.
  const pMas = (pN.get(ks[1]) || 0) + (pN.get(ks[2]) || 0);
  const q1 = platt(pMas, pl.mas);
  const cond = pMas > 0 ? (pN.get(ks[2]) || 0) / pMas : 0;
  const q2 = platt(cond, pl.ultimo);
  return new Map([[ks[0], 1 - q1], [ks[1], q1 * (1 - q2)], [ks[2], q1 * q2]]);
}
function c7(x, fit) {
  const acumulado = vacia();
  const probs = fit.modo === 'crudo' ? new Map(x.pN) : probsDuracion(x, fit);
  // cada componente, inclinada sobre SU soporte legal hasta la media que dice la recta del entrenamiento
  for (const [k, pares] of x.gN) {
    const w = probs.get(k) || 0;
    if (!(w > 0)) continue;
    let pmf = aPmf(pares);
    const rec = fit.media && fit.media[`${estrato(x)}|${k}`];
    if (rec) {
      const objetivo = rec[0] + rec[1] * medOf(pmf);
      if (objetivo > 0) pmf = CN.normaliza(inclinaEnSoporte(pmf, objetivo));
    }
    for (let g = 0; g <= KMAX; g++) acumulado[g] += w * pmf[g];
  }
  return CN.normaliza(acumulado);
}
// inclinación exponencial q(g) ∝ p(g)·e^{θg}: mueve la media SIN sacar masa del soporte (donde p vale
// cero, q vale cero). Es la diferencia entera con el desplazamiento de producción.
function inclinaEnSoporte(p, objetivo) {
  const media = (th) => { let s = 0, m = 0; for (let g = 0; g <= KMAX; g++) { const v = p[g] * Math.exp(th * (g - 25)); s += v; m += g * v; } return s > 0 ? m / s : 0; };
  let lo = -3, hi = 3;
  if (media(lo) > objetivo) lo = -12; if (media(hi) < objetivo) hi = 12;
  if (media(lo) > objetivo || media(hi) < objetivo) return p.slice();   // fuera del alcance: se deja igual
  for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (media(mid) < objetivo) lo = mid; else hi = mid; }
  const th = 0.5 * (lo + hi);
  return p.map((v, g) => v * Math.exp(th * (g - 25)));
}

// ── CE: empírico por favoritismo ───────────────────────────────────────────────────────────────────────
// El competidor que no sabe nada de tenis: el histograma del total en su estrato. Si le gana al compilador,
// el compilador no está aportando forma, solo nivel.
function claveCE(x, cortes, nb) {
  const fav = Math.abs(x.pA - 0.5);
  let b = 0;
  for (let i = 0; i < cortes.length; i++) if (fav >= cortes[i]) b = i + 1;
  return `${x.tn}|${x.bo}|${nb > 1 ? b : 0}`;
}
function ajustaCE(train, { nb, lambda }) {
  const favs = train.map((x) => Math.abs(x.pA - 0.5)).sort((a, b) => a - b);
  const cortes = [];
  for (let i = 1; i < nb; i++) cortes.push(favs[Math.floor((i / nb) * (favs.length - 1))]);
  const H = new Map();
  const legal = new Map();               // soporte observado por estrato: el empírico no inventa totales
  for (const x of train) {
    const k = claveCE(x, cortes, nb);
    if (!H.has(k)) { H.set(k, vacia()); legal.set(k, new Set()); }
    H.get(k)[Math.min(KMAX, x.total)]++;
    legal.get(k).add(Math.min(KMAX, x.total));
  }
  const pmfs = new Map();
  for (const [k, h] of H) {
    const sop = legal.get(k);
    const p = vacia();
    let n = 0; for (const g of sop) n += h[g];
    for (const g of sop) p[g] = (h[g] + lambda / sop.size) / (n + lambda);
    pmfs.set(k, CN.normaliza(p));
  }
  const global = (() => { const p = vacia(); for (const x of train) p[Math.min(KMAX, x.total)]++; return CN.normaliza(p); })();
  return { cortes, nb, lambda, pmfs, global, pmf: (x) => pmfs.get(claveCE(x, cortes, nb)) || global };
}

// ══ 3. LOS AJUSTES DE C7 ═══════════════════════════════════════════════════════════════════════════════
// Platt sobre el logit de P(k máximo de sets): dos parámetros por rejilla, minimizando log-loss EN
// ENTRENAMIENTO. La rejilla es fija y declarada; la elección entre modos se hace en la validación interna.
function platt1(xs, ys) {
  if (xs.length < 200) return null;
  let mejor = null;
  const eval1 = (a, b) => { let L = 0; for (let i = 0; i < xs.length; i++) { const q = 1 / (1 + Math.exp(-(a + b * xs[i]))); L -= ys[i] ? Math.log(Math.max(EPS, q)) : Math.log(Math.max(EPS, 1 - q)); } return L / xs.length; };
  let ca = 0, cb = 1, paso = 1;
  for (let it = 0; it < 7; it++) {                 // descenso por rejilla que se estrecha (reproducible)
    for (const a of [ca - paso, ca - paso / 2, ca, ca + paso / 2, ca + paso]) {
      for (const b of [cb - paso, cb - paso / 2, cb, cb + paso / 2, cb + paso]) {
        const L = eval1(a, b);
        if (!mejor || L < mejor.L) mejor = { a, b, L };
      }
    }
    ca = mejor.a; cb = mejor.b; paso /= 2;
  }
  return { a: r4(mejor.a), b: r4(mejor.b), logloss_train: r5(mejor.L), n: xs.length };
}
// una Platt POR CIRCUITO Y FORMATO, en cascada binaria: P(pasa del mínimo de sets) y, en bo5,
// P(llega al quinto | pasó del mínimo).
function ajustaPlatt(train) {
  const acc = {};
  for (const x of train) {
    const e = estrato(x);
    if (!acc[e]) acc[e] = { xs1: [], ys1: [], xs2: [], ys2: [] };
    const pN = new Map(x.pN); const ks = [...pN.keys()].sort((a, b) => a - b);
    if (ks.length < 2) continue;
    const pMas = ks.slice(1).reduce((s, k) => s + (pN.get(k) || 0), 0);
    const p1 = Math.min(1 - 1e-6, Math.max(1e-6, pMas));
    acc[e].xs1.push(Math.log(p1 / (1 - p1))); acc[e].ys1.push(x.nsets > ks[0] ? 1 : 0);
    if (ks.length === 3 && x.nsets > ks[0]) {
      const cond = pMas > 0 ? (pN.get(ks[2]) || 0) / pMas : 0;
      const p2 = Math.min(1 - 1e-6, Math.max(1e-6, cond));
      acc[e].xs2.push(Math.log(p2 / (1 - p2))); acc[e].ys2.push(x.nsets === ks[2] ? 1 : 0);
    }
  }
  const out = {};
  for (const [e, a] of Object.entries(acc)) out[e] = { mas: platt1(a.xs1, a.ys1), ultimo: platt1(a.xs2, a.ys2) };
  return out;
}
// recta de la media condicionada: total real ≈ a + b · E_compilador[total | k sets], POR CIRCUITO, FORMATO
// Y NÚMERO DE SETS, y ajustada SOLO con los partidos que de verdad duraron k sets (que es la condición del
// condicionante). Mezclar formatos aquí fue el error de la primera corrida.
function ajustaMedias(train) {
  const out = {};
  const porK = new Map();
  for (const x of train) {
    const k = `${estrato(x)}|${x.nsets}`;
    if (!porK.has(k)) porK.set(k, []);
    const g = (x.gN.find(([kk]) => kk === x.nsets) || [null, null])[1];
    if (!g) continue;
    porK.get(k).push([medOf(aPmf(g)), x.total]);
  }
  for (const [k, pares] of porK) {
    if (pares.length < 200) { out[k] = [0, 1]; continue; }
    const n = pares.length;
    const mx = pares.reduce((s, p) => s + p[0], 0) / n, my = pares.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0, sxx = 0;
    for (const [px, py] of pares) { sxy += (px - mx) * (py - my); sxx += (px - mx) ** 2; }
    const b = sxx > 0 ? sxy / sxx : 1;
    out[k] = [r4(my - b * mx), r4(b)];
  }
  return out;
}

// ══ 4. PUNTUACIÓN ══════════════════════════════════════════════════════════════════════════════════════
const MODOS = ['crudo', 'solo_nsets', 'nsets_y_media'];
function fitC7(train, modo) {
  if (modo === 'crudo') return { modo };
  const pl = ajustaPlatt(train);
  if (modo === 'solo_nsets') return { modo, pl };
  return { modo, pl, media: ajustaMedias(train) };
}
function puntua(recs2, pmfDe) {
  const ls = [], cr = [];
  for (const x of recs2) {
    const p = pmfDe(x);
    if (!p) { ls.push(null); cr.push(null); continue; }
    ls.push(CN.logScore(p, x.total)); cr.push(CN.crps(p, x.total));
  }
  return { ls, cr };
}

// ══ 5. EL PROTOCOLO ════════════════════════════════════════════════════════════════════════════════════
// PRIMARIO — walk-forward por trimestre: cada bloque se puntúa con lo ajustado SOLO con lo estrictamente
// anterior, y el modo de C7 y los hiperparámetros de CE se eligen en la validación interna (el último 20 %
// del entrenamiento), que nunca toca el bloque evaluado.
const holdout = recs.filter((x) => x.d >= HOLDOUT).sort((a, b) => a.d - b.d);
const trimestre = (d) => `${String(d).slice(0, 4)}T${Math.floor((+String(d).slice(4, 6) - 1) / 3) + 1}`;
const bloques = [...new Set(holdout.map((x) => trimestre(x.d)))].sort();
const priors = D.leeBase().priors;
const calDe = (tn, bo) => ((priors.tours[tn === 0 ? 'atp' : 'wta'] || {}).constants.gamesCal || {})[bo === 5 ? 'bo5' : 'bo3'] || [0, 1];
const tablaDe = (tn, bo) => (((priors.tours[tn === 0 ? 'atp' : 'wta'] || {}).constants.gamesResid || {})[bo === 5 ? 'bo5' : 'bo3']) || null;

const ASPIRANTES = ['C0_crudo', 'C0_shift', 'C6', 'CE', 'C7'];
const ev = { filas: [], elegidos: [] };
for (const b of bloques) {
  const test = holdout.filter((x) => trimestre(x.d) === b);
  // LA COMPROBACIÓN DE INFORMACIÓN IGUAL (`--congelado`). En el protocolo normal C7 y CE se reajustan cada
  // trimestre con todo lo anterior, mientras que las constantes de producción (`gamesCal`, `gamesResid`)
  // están congeladas en enero de 2025. Eso le da al aspirante información que la referencia no tiene, y una
  // comparación así no prueba que el MÉTODO sea mejor: puede estar probando que los datos son más frescos.
  // Con `--congelado` todo el mundo entrena con la misma ventana que usó producción.
  const train = CONGELA ? recs.filter((x) => x.d < HOLDOUT) : recs.filter((x) => x.d < Math.min(...test.map((y) => y.d)));
  if (train.length < 2000 || !test.length) continue;
  const corte = train[Math.floor(train.length * 0.8)].d;
  const trIn = train.filter((x) => x.d < corte), vaIn = train.filter((x) => x.d >= corte);
  // hiperparámetro de C7: el modo
  let mejorModo = null;
  for (const modo of MODOS) {
    const f = fitC7(trIn, modo);
    const s = puntua(vaIn, (x) => c7(x, f));
    const m = s.ls.reduce((a, c) => a + c, 0) / s.ls.length;
    if (!mejorModo || m < mejorModo.m) mejorModo = { modo, m };
  }
  // hiperparámetros de CE: número de estratos y suavizado
  let mejorCE = null;
  for (const nb of [1, 3, 5]) for (const lambda of [1, 5, 20]) {
    const f = ajustaCE(trIn, { nb, lambda });
    const s = puntua(vaIn, (x) => f.pmf(x));
    const m = s.ls.reduce((a, c) => a + c, 0) / s.ls.length;
    if (!mejorCE || m < mejorCE.m) mejorCE = { nb, lambda, m };
  }
  const f7 = fitC7(train, mejorModo.modo);
  const fce = ajustaCE(train, { nb: mejorCE.nb, lambda: mejorCE.lambda });
  ev.elegidos.push({ bloque: b, n_test: test.length, n_train: train.length, c7_modo: mejorModo.modo,
    ce_estratos: mejorCE.nb, ce_lambda: mejorCE.lambda, platt: f7.pl || null, medias: f7.media || null });
  for (const x of test) {
    const fila = { d: x.d, tn: x.tn, bo: x.bo, total: x.total, nsets: x.nsets, bloque: b, id: `${x.d}|${ev.filas.length}` };
    fila.pmf = {
      C0_crudo: c0crudo(x),
      C0_shift: c0shift(x, calDe(x.tn, x.bo)),
      C6: c6(x, calDe(x.tn, x.bo), tablaDe(x.tn, x.bo)),
      CE: fce.pmf(x),
      C7: c7(x, f7),
    };
    ev.filas.push(fila);
  }
}

// ══ 6. RESULTADOS ══════════════════════════════════════════════════════════════════════════════════════
function resumen(filas, etiqueta) {
  const out = { etiqueta, n: filas.length, por_aspirante: {}, comparaciones: [] };
  const sc = {};
  for (const a of ASPIRANTES) {
    const ls = [], cr = [];
    for (const f of filas) { const p = f.pmf[a]; if (!p) continue; ls.push(CN.logScore(p, f.total)); cr.push(CN.crps(p, f.total)); }
    sc[a] = { ls, cr };
    out.por_aspirante[a] = { n: ls.length,
      log_score: ls.length ? r5(ls.reduce((s, x) => s + x, 0) / ls.length) : null,
      crps: cr.length ? r5(cr.reduce((s, x) => s + x, 0) / cr.length) : null };
  }
  // diferencias PAREADAS contra cada referencia, con racimo = PARTIDO (una fila por partido: el bootstrap
  // por racimos coincide entonces con el error estándar clásico, y el módulo lo dice)
  const refs = ['C0_crudo', 'C0_shift', 'C6'];
  for (const ref of refs) {
    for (const a of ASPIRANTES) {
      if (a === ref) continue;
      const pares = [];
      filas.forEach((f, i) => { if (f.pmf[a] && f.pmf[ref]) pares.push({ i, d: CN.logScore(f.pmf[a], f.total) - CN.logScore(f.pmf[ref], f.total) }); });
      if (pares.length < 100) continue;
      const bs = INF.bootstrapClusters(pares, { valor: (x) => x.d, cluster: (x) => x.i, replicas: 2000, semilla: 42 });
      out.comparaciones.push({ aspirante: a, contra: ref, n: pares.length,
        delta_log: r5(bs.media), ic: bs.ic ? bs.ic.map(r5) : null, t: r2(bs.t),
        p: INF.pDeT(bs.t, pares.length - 1) });
    }
  }
  const ps = out.comparaciones.map((c) => c.p).filter((x) => x != null);
  const bh = INF.bh(ps, 0.10);
  out.bh = { m: bh.m, umbral: bh.umbral, q: 0.10,
    sobreviven: out.comparaciones.filter((c) => c.p != null && c.p <= bh.umbral).map((c) => `${c.aspirante} vs ${c.contra}`) };
  return out;
}

// calibración EN LÍNEAS: las que de verdad se cotizan. No se inventan: se toman las que cubren el 20-80 %
// de los totales REALES de ese estrato, que es donde las casas cuelgan la suya (comprobable contra el
// libro de picks de tenis y contra el tablero en vivo, ver el documento).
function calibracion(filas) {
  const out = {};
  for (const tn of [0, 1]) for (const bo of [3, 5]) {
    const sub = filas.filter((f) => f.tn === tn && f.bo === bo);
    if (sub.length < 200) continue;
    const tot = sub.map((f) => f.total).sort((a, b) => a - b);
    const q = (p) => tot[Math.floor(p * (tot.length - 1))];
    const lo = Math.floor(q(0.20)) + 0.5, hi = Math.floor(q(0.80)) + 0.5;
    const lineas = [];
    for (let L = lo; L <= hi; L += 1) lineas.push(L);
    const clave = `${tn === 0 ? 'atp' : 'wta'}_bo${bo}`;
    out[clave] = { n: sub.length, lineas, por_aspirante: {} };
    for (const a of ASPIRANTES) {
      const filasA = sub.filter((f) => f.pmf[a]);
      if (!filasA.length) continue;
      out[clave].por_aspirante[a] = lineas.map((L) => {
        const pred = filasA.map((f) => CN.pOver(f.pmf[a], L));
        const real = filasA.map((f) => (f.total > L ? 1 : 0));
        const mp = pred.reduce((s, x) => s + x, 0) / pred.length;
        const mr = real.reduce((s, x) => s + x, 0) / real.length;
        return { linea: L, pred_pct: r2(100 * mp), real_pct: r2(100 * mr), error_pp: r2(100 * (mp - mr)) };
      });
      const errs = out[clave].por_aspirante[a].map((x) => Math.abs(x.error_pp));
      out[clave].por_aspirante[a + '_error_medio_abs_pp'] = r2(errs.reduce((s, x) => s + x, 0) / errs.length);
    }
  }
  return out;
}

// masa en totales IMPOSIBLES: el número que resume de qué va todo esto
function masaIlegal(filas) {
  const legalPorBo = {};
  for (const bo of [3, 5]) {
    const need = Math.ceil(bo / 2);
    const set = new Set([6, 7, 8, 9, 10, 12, 13]);
    const sop = new Set();
    const rec = (n, acc) => { if (n === 0) { sop.add(acc); return; } for (const s of set) rec(n - 1, acc + s); };
    for (let k = need; k <= 2 * need - 1; k++) rec(k, 0);
    legalPorBo[bo] = sop;
  }
  const out = {};
  for (const a of ASPIRANTES) {
    let s = 0, n = 0;
    for (const f of filas) {
      const p = f.pmf[a]; if (!p) continue;
      const leg = legalPorBo[f.bo];
      let m = 0; for (let g = 0; g <= KMAX; g++) if (!leg.has(g)) m += p[g];
      s += m; n++;
    }
    out[a] = n ? r4(100 * s / n) : null;
  }
  return out;
}

const salida = {
  at: new Date().toISOString(),
  universo: { desde: DESDE, holdout_desde: HOLDOUT, tour: TOUR, best_of: BO,
    partidos_utiles: recs.length, evaluados: ev.filas.length, bloques: bloques.length, descartados },
  data_as_of: D.leeBase().data_as_of,
  protocolo: (CONGELA ? 'ventana CONGELADA en el holdout (todos entrenan con la MISMA información que las constantes de producción): ' : '')
    + 'walk-forward por trimestre; entrenamiento = todo lo estrictamente anterior; el modo de C7 y los hiperparámetros de CE se eligen en el último 20 % del entrenamiento (validación interna), que nunca toca el bloque evaluado. Racimo = partido. Benjamini-Hochberg al 10 % sobre las comparaciones declaradas.',
  global: resumen(ev.filas, 'todo'),
  atp_bo3: resumen(ev.filas.filter((f) => f.tn === 0 && f.bo === 3), 'ATP bo3 (el único sitio donde C6 está en producción)'),
  wta_bo3: resumen(ev.filas.filter((f) => f.tn === 1 && f.bo === 3), 'WTA bo3'),
  bo5: resumen(ev.filas.filter((f) => f.bo === 5), 'bo5 (los cuatro grandes)'),
  calibracion: calibracion(ev.filas),
  masa_en_totales_imposibles_pct: masaIlegal(ev.filas),
  elegidos_por_bloque: ev.elegidos,
  no_medible: [
    'EL MERCADO. La comparación contra el precio exige el archivo de cierres de tenis y el libro de picks, ' +
    'que viven en el disco persistente de Render y no tienen ruta de exportación: `/api/internal/tennis` ' +
    'devuelve el agregado y las 40 últimas liquidadas, no las 766. Con 40 filas de una sola gira no se ' +
    'puede medir nada, así que aquí no se finge: el aspirante que gane a los demás sigue sin haber ganado ' +
    'al precio, y eso es lo único que decide si hay dinero.',
  ],
};

const dest = arg('--out', null);
if (dest) { fs.writeFileSync(dest, JSON.stringify(salida, null, 1)); console.error('escrito', dest); }
else console.log(JSON.stringify(salida, null, 1));
