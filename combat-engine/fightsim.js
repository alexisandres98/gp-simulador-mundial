// combat-engine/fightsim.js — SIMULADOR DE RUTAS, MÉTODO, ASALTO Y TARJETAS (16-ago).
// Módulos 123-146 del blueprint de combate.
//
// QUÉ HACE DISTINTO A UN CLASIFICADOR. Un modelo que devuelve "62% Fulano" no sabe *cómo* gana. Este
// simula RUTAS: cada iteración recorre la pelea asalto a asalto, decide en qué fase se pelea, acumula
// daño y fatiga, y en cada asalto compiten tres riesgos —KO, sumisión y llegar al final—. De ahí salen,
// de forma COHERENTE ENTRE SÍ y no como cinco modelos sueltos:
//   ganador · método · asalto de finalización · duración · tarjetas de los jueces · totales de asaltos.
//
// LA IDEA MÁS IMPORTANTE: RIESGOS COMPETITIVOS (módulo 137). La probabilidad de KO no es una tasa
// histórica: es un peligro que corre en el tiempo y que COMPITE con los otros. Un peleador con altísima
// amenaza de sumisión reduce la probabilidad de KO del rival simplemente porque la pelea acaba antes. Un
// modelo que estima cada método por separado y luego normaliza a 1 no captura eso y produce combinaciones
// imposibles (mucho KO temprano *y* mucha decisión).
//
// LA SEGUNDA: LOS JUECES SON UNA DISTRIBUCIÓN, NO UNA FUNCIÓN. Módulo 128. Tres jueces ven la misma pelea y
// no siempre coinciden. Simular tres tarjetas independientes con ruido correlacionado es lo que produce
// unánime / dividida / mayoritaria / empate con probabilidades reales — y lo que permite decir "esta pelea
// tiene un 22% de acabar en decisión dividida", que es un mercado que se cotiza.
//
// LA TERCERA: LA FATIGA CONECTA ESTILO CON MÉTODO. Módulo 91-100. El mismo golpeador es otro en el asalto
// 4. Sin curva de fatiga, los KO se reparten uniformemente por asalto, y en la realidad se concentran donde
// el desgaste ya hizo efecto.
//
// PURO y determinista con semilla. Sin red, sin disco, sin db.
'use strict';

const SY = require('./style');

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---- 1) PELIGROS POR MINUTO -----------------------------------------------------------------------------
// Se traducen los perfiles a tres peligros por minuto de pelea, cada uno condicionado a la fase.
// El KO vive de pie y en el suelo (ground-and-pound); la sumisión solo con control.
function hazards(pa, pb, mu) {
  const A = pa.striking, B = pb.striking, Ag = pa.grappling, Bg = pb.grappling;
  if (!A || !B) return null;
  const ph = mu.phase_prob;
  // KO: poder propio × fragilidad rival, escalado por cuánto tiempo se está en la fase donde ese poder vale
  const koBase = (p, q, standShare) => {
    const power = (p.power.kd_per15 || 0) / 15;                       // derribos por minuto
    const chin = 1 + 2.2 * (q.durability.kd_absorbed_per15 || 0) / 15; // recibir muchos derribos multiplica
    const conv = 0.28 + 0.5 * (p.power.ko_rate || 0);                 // no todo derribo termina en KO
    return power * chin * conv * (0.35 + 0.65 * standShare);
  };
  const standShare = (ph.pie || 0) + 0.5 * (ph.clinch || 0);
  // Sumisión: intentos por minuto de control × tiempo de control esperado × conversión histórica
  const subBase = (pg, qg) => {
    if (!pg || !qg) return 0;
    const ctrlShare = Math.min(1, (pg.control.min_per15 || 0) / 15);
    const attempts = (pg.submission.att_per_control_min || 0) * ctrlShare;
    const conv = 0.18 + 0.55 * (pg.submission.finish_rate || 0);
    const vuln = 1 + 2.5 * (qg.submission.lost_by_sub_rate || 0);
    return attempts * conv * vuln * (0.25 + 0.75 * (ph.suelo || 0));
  };
  return {
    ko_a: koBase(A, B, standShare), ko_b: koBase(B, A, standShare),
    sub_a: subBase(Ag, Bg), sub_b: subBase(Bg, Ag),
    stand_share: r4(standShare),
  };
}

// ---- 2) PUNTUACIÓN DE ASALTO (módulos 123-129) ----------------------------------------------------------
// El asalto lo gana quien acumula más ofensiva EFECTIVA, no quien tira más. La ventaja de fase del cruce
// se convierte en una diferencia esperada, y a eso se le suma el ruido del propio asalto.
function roundEdge(mu, fatigueA, fatigueB) {
  let e = 0;
  for (const d of mu.dims) {
    const reach = mu.phase_prob[d.phase] || 0.5;
    e += d.edge * reach;
  }
  // la fatiga penaliza al que se cansa más: cada punto de fatiga cuesta ofensiva efectiva
  return e / Math.max(1, mu.dims.length) * 3 + (fatigueB - fatigueA) * 0.8;
}

// ---- 3) SIMULACIÓN COMPLETA -----------------------------------------------------------------------------
// ---- ANCLAJE AL MODELO DE HABILIDAD (la corrección del 16-ago) ------------------------------------------
// LO QUE LA VALIDACIÓN DEMOSTRÓ, sobre 3.140 peleas con ventana móvil:
//   · QUIÉN GANA: Brier 0,276 contra 0,250 de decir siempre 50%. PEOR QUE UNA MONEDA. Y descalibrado de
//     forma brutal: cuando decía 93% ganaba el 67%; cuando decía 8% ganaba el 46%. 7 de 8 tramos fuera de
//     intervalo, y una resolución de 0,004 — o sea, prácticamente no distingue.
//   · CÓMO TERMINA: KO 29,4% predicho contra 32,3% real · sumisión 19,4 contra 17,6 · decisión 51,2 contra
//     50,1 · llega al límite 51,3 contra 50,1. Las cuatro dentro de 3 puntos. EXCELENTE.
//
// La lectura es clara y la corrección se sigue sola: el motor de fases sabe CÓMO se resuelve una pelea y no
// sabe QUIÉN es mejor. Dos peleadores con perfiles estadísticos parecidos salen 50/50 aunque uno esté dos
// niveles por encima, porque este motor no tiene un término de habilidad latente — y el Elo que ya teníamos
// sí lo tiene.
//
// Entonces: el GANADOR lo fija el modelo de habilidad; el MÉTODO, el ASALTO y la DURACIÓN los fija el motor
// de fases. Se busca el desplazamiento `k` que hace que la simulación reproduzca la probabilidad del prior,
// y con ese desplazamiento puesto se lee todo lo demás. Es el mismo principio que en baloncesto: anclarse a
// lo que funciona y dejar que el modelo mande solo donde ha demostrado que sabe.
function solveTilt(pa, pb, M, H, target, opts) {
  let lo = -3, hi = 3;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const p = core(pa, pb, M, H, { ...opts, n: 1200, seed: 991, tilt: mid }).win.a;
    if (p < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- CONTEXTO DE LA PELEA (20-ago): árbitro y báscula, SI Y SOLO SI están medidos --------------------
// El enchufe existe; hoy no hace nada, y eso es un resultado, no un olvido. Se midió el efecto del ÁRBITRO
// sobre la tasa de finalización contra lo esperado de cada pelea (división × asaltos × lustro) sobre 8.937
// peleas, y el de FALLAR EL PESO sobre las 1.806 con datos de báscula. Dentro de muestra el árbitro parece
// tener efecto —John McCarthy termina el 62,4 % frente al 56,9 % esperado, z=2,62— pero con 24 árbitros
// probados un z de 2,6 es lo que sale por puro azar, y la validación walk-forward lo confirma: el Brier
// EMPEORA (0,2466 → 0,2470) y solo 1 de 12 años mejora. El peso, con 67 peleas fallidas, no llega ni a eso.
//
// Así que el ajuste queda escrito, medido y APAGADO por su propia validación. `officials-priors-<liga>.json`
// lleva `measured:false`; el día que la báscula acumule muestra o aparezca una liga donde el árbitro sí
// pese, se re-fitea, el archivo dice `measured:true` y esto se enciende solo. Ese es el trato: la puerta la
// abre la medición, no la intuición.
let _priors = { at: 0, data: null };
function priorsOficiales() {
  if (_priors.data !== null && Date.now() - _priors.at < 10 * 60e3) return _priors.data;
  let d = null;
  try {
    const fs = require('fs'), path = require('path');
    d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'combat', 'officials-priors-ufc.json'), 'utf8'));
  } catch { d = null; }
  _priors = { at: Date.now(), data: d };
  return d;
}
// factor multiplicativo sobre los peligros de finalización. 1 = sin efecto.
function factorContexto({ referee = null, pesoFallado = null } = {}) {
  const P = priorsOficiales();
  const out = { factor: 1, partes: [], measured: false };
  if (!P) return out;
  if (referee && P.arbitros && P.arbitros.measured) {
    const e = (P.arbitros.efectos || {})[referee];
    if (e && e.factor_finish) { out.factor *= e.factor_finish; out.partes.push({ que: 'árbitro', quien: referee, x: e.factor_finish, n: e.n }); out.measured = true; }
  }
  if (pesoFallado != null && P.peso && P.peso.measured) {
    const e = (P.peso.efectos || {})[pesoFallado ? 'fallo' : 'limpio'];
    if (e && e.factor_finish) { out.factor *= e.factor_finish; out.partes.push({ que: 'báscula', quien: pesoFallado ? 'falló el peso' : 'limpio', x: e.factor_finish, n: e.n }); out.measured = true; }
  }
  // techo de seguridad: ningún contexto puede mover la finalización más de un 15 %
  out.factor = Math.max(0.85, Math.min(1.15, out.factor));
  return out;
}

function simulate(pa, pb, {
  rounds = 3, roundMin = 5, n = 20000, seed = 17, mu = null, sa = null, sb = null,
  cardioA = 0.5, cardioB = 0.5, priorA = null, referee = null, pesoFallado = null,
} = {}) {
  const M = mu || SY.matchup(pa, pb, sa, sb);
  if (!M) return null;
  const H0 = hazards(pa, pb, M);
  const ctx = factorContexto({ referee, pesoFallado });
  const H = H0 && ctx.factor !== 1
    ? { ...H0, ko_a: H0.ko_a * ctx.factor, ko_b: H0.ko_b * ctx.factor, sub_a: H0.sub_a * ctx.factor, sub_b: H0.sub_b * ctx.factor }
    : H0;
  if (!H) return null;
  const base = { rounds, roundMin, cardioA, cardioB };
  // si llega una probabilidad de habilidad (Elo), se ancla a ella; si no, se corre sin anclar y se avisa
  const tilt = (priorA != null && priorA > 0.02 && priorA < 0.98) ? solveTilt(pa, pb, M, H, priorA, base) : 0;
  const out = core(pa, pb, M, H, { ...base, n, seed, tilt });
  out.anchor = priorA != null
    ? { prior_a: r4(priorA), tilt: r2(tilt), source: 'modelo de habilidad (Elo)',
      note: 'el ganador viene del modelo de habilidad; el método, el asalto y la duración salen del motor de fases' }
    : { prior_a: null, tilt: 0, source: null,
      note: 'SIN anclar: la validación mostró que este motor por sí solo predice al ganador peor que una moneda (Brier 0,276 vs 0,250)' };
  out.matchup = M;
  // el contexto viaja SIEMPRE, aunque no aplique: que el factor sea 1 y `measured:false` es información
  out.contexto = ctx;
  out.uncertainty = uncertainty(out, pa, pb, M);
  return out;
}

function core(pa, pb, M, H, { rounds = 3, roundMin = 5, n = 20000, seed = 17, cardioA = 0.5, cardioB = 0.5, tilt = 0 } = {}) {
  const rnd = rng(seed);

  const res = {
    a_ko: 0, a_sub: 0, a_dec: 0, b_ko: 0, b_sub: 0, b_dec: 0, draw: 0,
    byRound: Array.from({ length: rounds }, () => ({ a_ko: 0, a_sub: 0, b_ko: 0, b_sub: 0 })),
    dist: 0, times: [], cards: { ud_a: 0, sd_a: 0, md_a: 0, ud_b: 0, sd_b: 0, md_b: 0, draw: 0 },
    roundWinsA: Array.from({ length: rounds }, () => 0),
  };

  for (let i = 0; i < n; i++) {
    let fatA = 0, fatB = 0, dmgA = 0, dmgB = 0;
    let ended = false, scoreA = 0, scoreB = 0;
    const cards = [0, 0, 0];                       // diferencia acumulada de cada juez
    // ruido de pelea: hay noches buenas y noches malas, y afecta a los dos asaltos por igual
    const nightA = gauss(rnd) * 0.35, nightB = gauss(rnd) * 0.35;

    for (let r = 1; r <= rounds && !ended; r++) {
      // FATIGA: crece con el asalto, más rápido en quien tiene peor cardio. El daño acumulado la acelera.
      fatA += (0.16 + 0.22 * (1 - cardioA)) * (1 + dmgA * 0.5);
      fatB += (0.16 + 0.22 * (1 - cardioB)) * (1 + dmgB * 0.5);

      // PELIGROS DEL ASALTO: la fatiga del rival abre la puerta al KO; la propia la cierra.
      // EL DESPLAZAMIENTO DE HABILIDAD entra en los dos sitios donde se decide una pelea: en los peligros
      // (el mejor termina más y le terminan menos) y en la puntuación del asalto. Repartirlo así conserva
      // el reparto de método del motor de fases mientras mueve el ganador hacia donde dice la habilidad.
      const tA = Math.exp(tilt * 0.55), tB = Math.exp(-tilt * 0.55);
      const kA = H.ko_a * tA * roundMin * (1 + fatB * 0.9 + dmgB * 1.4) * (1 - Math.min(0.5, fatA * 0.25)) * Math.exp(nightA);
      const kB = H.ko_b * tB * roundMin * (1 + fatA * 0.9 + dmgA * 1.4) * (1 - Math.min(0.5, fatB * 0.25)) * Math.exp(nightB);
      const sA = H.sub_a * tA * roundMin * (1 + fatB * 0.7);
      const sB = H.sub_b * tB * roundMin * (1 + fatA * 0.7);

      // RIESGOS COMPETITIVOS: se sortea si ocurre ALGO y, si ocurre, cuál de los cuatro. Es la forma
      // correcta: los cuatro peligros compiten por el mismo minuto de pelea.
      const tot = kA + kB + sA + sB;
      const pAny = 1 - Math.exp(-tot);
      if (rnd() < pAny) {
        const u = rnd() * tot;
        const t = (r - 1) * roundMin + rnd() * roundMin;
        res.times.push(t);
        if (u < kA) { res.a_ko++; res.byRound[r - 1].a_ko++; }
        else if (u < kA + sA) { res.a_sub++; res.byRound[r - 1].a_sub++; }
        else if (u < kA + sA + kB) { res.b_ko++; res.byRound[r - 1].b_ko++; }
        else { res.b_sub++; res.byRound[r - 1].b_sub++; }
        ended = true;
        break;
      }

      // NADIE TERMINA: se puntúa el asalto. Cada juez ve lo mismo con ruido propio (129).
      const edge = roundEdge(M, fatA, fatB) + (nightA - nightB) + tilt;
      const shared = gauss(rnd) * 0.55;                 // lo que pasó de verdad en el asalto
      let winsA = 0;
      for (let j = 0; j < 3; j++) {
        const seen = edge + shared + gauss(rnd) * 0.42;  // el sesgo propio de cada juez
        // 10-8 cuando la diferencia es aplastante (124)
        const mag = Math.abs(seen) > 2.1 ? 2 : 1;
        cards[j] += seen > 0 ? mag : -mag;
        if (j === 0 && seen > 0) winsA = 1;
      }
      res.roundWinsA[r - 1] += winsA;
      scoreA += edge > 0 ? 1 : 0; scoreB += edge > 0 ? 0 : 1;
      // daño acumulado: el que pierde el asalto se lleva más
      if (edge > 0) dmgB += 0.16 + Math.min(0.3, Math.abs(edge) * 0.1);
      else dmgA += 0.16 + Math.min(0.3, Math.abs(edge) * 0.1);
    }

    if (!ended) {
      res.dist++;
      res.times.push(rounds * roundMin);
      // TARJETAS: se cuenta cuántos jueces dieron cada lado (128)
      const forA = cards.filter((c) => c > 0).length, forB = cards.filter((c) => c < 0).length;
      if (forA === 3) { res.a_dec++; res.cards.ud_a++; }
      else if (forA === 2) { res.a_dec++; res.cards[cards.some((c) => c === 0) ? 'md_a' : 'sd_a']++; }
      else if (forB === 3) { res.b_dec++; res.cards.ud_b++; }
      else if (forB === 2) { res.b_dec++; res.cards[cards.some((c) => c === 0) ? 'md_b' : 'sd_b']++; }
      else { res.draw++; res.cards.draw++; }
    }
  }

  const p = (x) => r4(x / n);
  const times = res.times.sort((a, b) => a - b);
  const q = (f) => (times.length ? r2(times[Math.floor(f * (times.length - 1))]) : null);
  const pa_win = (res.a_ko + res.a_sub + res.a_dec) / n;

  const out = {
    win: { a: p(res.a_ko + res.a_sub + res.a_dec), b: p(res.b_ko + res.b_sub + res.b_dec), draw: p(res.draw) },
    // 141 · vector de método, coherente por construcción
    method: {
      a_ko: p(res.a_ko), a_sub: p(res.a_sub), a_dec: p(res.a_dec),
      b_ko: p(res.b_ko), b_sub: p(res.b_sub), b_dec: p(res.b_dec), draw: p(res.draw),
    },
    // 140 · llega al final
    distance: { prob: p(res.dist), finish_prob: p(n - res.dist) },
    // 142 · asalto de finalización
    round_of_finish: res.byRound.map((r, i) => ({
      round: i + 1, a_ko: p(r.a_ko), a_sub: p(r.a_sub), b_ko: p(r.b_ko), b_sub: p(r.b_sub),
      any: p(r.a_ko + r.a_sub + r.b_ko + r.b_sub),
    })),
    // 143 · duración: la base de los mercados de total de asaltos
    time: { mean: r2(times.reduce((s, x) => s + x, 0) / Math.max(1, times.length)),
      p25: q(0.25), median: q(0.5), p75: q(0.75),
      over_1_5: p(times.filter((t) => t > 7.5).length), over_2_5: p(times.filter((t) => t > 12.5).length),
      over_4_5: rounds >= 5 ? p(times.filter((t) => t > 22.5).length) : null },
    // 128 · tipos de decisión
    decision: {
      ud_a: p(res.cards.ud_a), sd_a: p(res.cards.sd_a), md_a: p(res.cards.md_a),
      ud_b: p(res.cards.ud_b), sd_b: p(res.cards.sd_b), md_b: p(res.cards.md_b),
      draw: p(res.cards.draw),
      split_or_majority: p(res.cards.sd_a + res.cards.md_a + res.cards.sd_b + res.cards.md_b),
    },
    // 129 · qué asaltos están realmente en el aire
    rounds: res.roundWinsA.map((w, i) => ({ round: i + 1, p_a: p(w),
      close: Math.abs(w / n - 0.5) < 0.08 ? true : false })),
    sims: n, rounds_sched: rounds,
    hazards: { ko_a_per_min: r4(H.ko_a), ko_b_per_min: r4(H.ko_b), sub_a_per_min: r4(H.sub_a), sub_b_per_min: r4(H.sub_b), stand_share: H.stand_share },
  };
  return out;
}

// ---- 4) INCERTIDUMBRE (módulo 146) ----------------------------------------------------------------------
// La aleatoria es el propio combate: aunque supiéramos todo, un golpe cambia la noche. La epistémica es lo
// que no sabemos: muestras cortas, estilos poco definidos, fases inciertas. Solo la segunda baja con datos.
function uncertainty(out, pa, pb, M) {
  const p = out.win.a;
  const aleatoric = Math.sqrt(p * (1 - p)) * 100 / Math.sqrt(1);      // varianza intrínseca del resultado
  const nA = (pa.striking && pa.striking.sample.fights) || 0;
  const nB = (pb.striking && pb.striking.sample.fights) || 0;
  const sampleTerm = 14 / Math.sqrt(Math.max(1, Math.min(nA, nB)));   // muestra corta = más ignorancia
  const fragTerm = (M.fragility && M.fragility.concentration ? M.fragility.concentration : 0.4) * 12;
  const epistemic = Math.sqrt(sampleTerm ** 2 + fragTerm ** 2);
  return {
    aleatoric_pp: r2(aleatoric), epistemic_pp: r2(epistemic),
    total_pp: r2(Math.sqrt(aleatoric ** 2 + epistemic ** 2)),
    drivers: [
      { source: 'muestra de los dos peleadores', pp: r2(sampleTerm), detail: `${nA} y ${nB} peleas con estadística` },
      { source: 'concentración de la ventaja en una fase', pp: r2(fragTerm), detail: M.fragility && M.fragility.level },
    ],
    note: epistemic > aleatoric * 0.5
      ? 'una parte grande de la incertidumbre es ignorancia nuestra, no azar del combate: con más peleas se estrecharía'
      : 'la incertidumbre es sobre todo el propio combate, que no baja con más datos',
  };
}

module.exports = { simulate, core, solveTilt, hazards, roundEdge, uncertainty, rng, gauss, factorContexto, priorsOficiales };
