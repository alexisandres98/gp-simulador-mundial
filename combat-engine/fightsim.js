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
function simulate(pa, pb, {
  rounds = 3, roundMin = 5, n = 20000, seed = 17, mu = null, sa = null, sb = null,
  cardioA = 0.5, cardioB = 0.5, priorA = null,
} = {}) {
  const M = mu || SY.matchup(pa, pb, sa, sb);
  if (!M) return null;
  const H = hazards(pa, pb, M);
  if (!H) return null;
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
      const kA = H.ko_a * roundMin * (1 + fatB * 0.9 + dmgB * 1.4) * (1 - Math.min(0.5, fatA * 0.25)) * Math.exp(nightA);
      const kB = H.ko_b * roundMin * (1 + fatA * 0.9 + dmgA * 1.4) * (1 - Math.min(0.5, fatB * 0.25)) * Math.exp(nightB);
      const sA = H.sub_a * roundMin * (1 + fatB * 0.7);
      const sB = H.sub_b * roundMin * (1 + fatA * 0.7);

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
      const edge = roundEdge(M, fatA, fatB) + (nightA - nightB);
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
    matchup: M,
    hazards: { ko_a_per_min: r4(H.ko_a), ko_b_per_min: r4(H.ko_b), sub_a_per_min: r4(H.sub_a), sub_b_per_min: r4(H.sub_b), stand_share: H.stand_share },
  };
  // 146 · descomposición de la incertidumbre
  out.uncertainty = uncertainty(out, pa, pb, M);
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

module.exports = { simulate, hazards, roundEdge, uncertainty, rng, gauss };
