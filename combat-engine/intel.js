// combat-engine/intel.js — LA CAPA QUE SIRVE INTELIGENCIA DE COMBATE (16-ago).
//
// Igual que `basketball-engine/store.js`: junta perfiles + estilo + cruce + simulación y arma el objeto que
// consumen los endpoints. Vive fuera de server.js a propósito.
//
// CACHÉ POR ORGANIZACIÓN. Construir los perfiles de 1.586 peleadores desde 9.247 peleas cuesta ~450 ms:
// barato una vez, caro en cada petición. Se recalcula cada 30 minutos o cuando el dataset cambia de tamaño.
'use strict';

const PH = require('./phases');
const SY = require('./style');
const FS = require('./fightsim');
const BX = require('./boxing');

const G = global._cbIntel = global._cbIntel || {};

// DOS MOTORES DETRÁS DE LA MISMA PUERTA (16-ago). MMA y boxeo no comparten dataset: MMA se alimenta de la
// estadística granular de ESPN y boxeo NO LA TIENE (no existe `espnstats-boxing.json`, y por eso hasta hoy
// boxeo entraba aquí y salía con `available:false` — no tenía capa profunda, tenía un hueco). Cada deporte
// usa el motor que su dato permite y los dos devuelven el MISMO contrato, para que la UI no tenga que saber
// de cuál viene: `dna`, `matchup` (con dims, phase_prob, routes y fragility), `projection` y `uncertainty`.
//
// `fights` y `stats` los pasa el llamador (server.js ya los tiene cargados y cacheados por organización).
function load(org, fights, stats, { force = false, ttl = 30 * 60e3, sport = null, index = null } = {}) {
  const sp = sport || (org === 'boxing' ? 'boxing' : 'mma');
  const key = sp + ':' + org;
  const cur = G[key];
  const n = (fights || []).length;
  if (cur && !force && cur.n === n && Date.now() - cur.at < ttl) return cur;
  const t0 = Date.now();
  let out;
  if (sp === 'boxing') {
    const B = BX.buildProfiles(fights || [], { index: index || null });
    out = { org, sport: 'boxing', n, at: Date.now(), ms: Date.now() - t0,
      profiles: B.profiles, vectors: BX.styleVectors(B.profiles), league: B.league,
      hazardShape: B.hazardShape, axes: BX.AXES.map((a) => ({ key: a.key, label: a.label })),
      phases: BX.PHASES, phase_strip: ['temprano', 'medio', 'profundo'], fighters: B.profiles.size };
  } else {
    const B = PH.buildProfiles(fights || [], stats || {}, {});
    out = { org, sport: 'mma', n, at: Date.now(), ms: Date.now() - t0,
      profiles: B.profiles, vectors: SY.styleVectors(B.profiles), league: B.league,
      axes: SY.AXES.map((a) => ({ key: a.key, label: a.label })),
      // `phases` es el diccionario de etiquetas (incluye 'lucha', que es una fase de las dims); `phase_strip`
      // son las que PARTICIONAN la pelea y suman 1 — dibujar 'lucha' en la cinta rompería el 100 %.
      phases: [{ key: 'pie', label: 'De pie' }, { key: 'clinch', label: 'Clinch' },
        { key: 'lucha', label: 'Lucha' }, { key: 'suelo', label: 'Suelo' }],
      phase_strip: ['pie', 'clinch', 'suelo'],
      fighters: B.profiles.size };
  }
  G[key] = out;
  return out;
}

// ---- INTELIGENCIA DE UNA PELEA ---------------------------------------------------------------------------
// Devuelve todo lo que el panel necesita: ADN de los dos, cruce por fase, rutas de victoria, fragilidad,
// simulación completa (método, asalto, duración, tarjetas) e incertidumbre.
//
// NO DEVUELVE UNA PICK. Igual que en baloncesto: esta probabilidad NO está anclada al mercado y el modelo
// de combate no ha demostrado batir al cierre. Quien quiera convertir esto en una selección tiene que
// pasarlo por el encogimiento al consenso y por las compuertas, como el resto del sistema.
function fightIntel(I, id1, id2, { rounds = 3, sims = 20000, seed = 17, priorA = null } = {}) {
  if (!I) return null;
  const a = String(id1), b = String(id2);
  const pa = I.profiles.get(a), pb = I.profiles.get(b);
  if (!pa || !pb) {
    return { available: false, missing: [!pa ? a : null, !pb ? b : null].filter(Boolean),
      note: I.sport === 'boxing'
        ? 'uno de los dos no tiene suficientes peleas con método conocido en nuestro histórico de boxeo'
        : 'uno de los dos no tiene suficientes peleas con estadística granular en nuestro histórico' };
  }
  if (I.sport === 'boxing') return boxingIntel(I, a, b, pa, pb, { rounds, sims, seed, priorA });
  const sa = I.vectors.get(a), sb = I.vectors.get(b);
  const mu = SY.matchup(pa, pb, sa, sb);
  // el cardio se aproxima con la muestra de minutos: quien ha peleado más asaltos largos aguanta mejor
  const cardio = (p) => {
    const m = (p.striking && p.striking.sample.minutes) || 0;
    const f = (p.striking && p.striking.sample.fights) || 1;
    return Math.max(0.2, Math.min(0.9, (m / Math.max(1, f)) / 12));
  };
  // EL ANCLA. `priorA` es la probabilidad del modelo de habilidad (el Elo que ya corría). Sin ella, la
  // validación sobre 3.140 peleas dice que este motor predice al ganador PEOR que una moneda; con ella, el
  // ganador lo fija quien sabe de habilidad y el método lo fija quien sabe de fases.
  const sim = FS.simulate(pa, pb, { rounds, n: sims, seed, mu, sa, sb, cardioA: cardio(pa), cardioB: cardio(pb), priorA });
  return {
    available: true, sport: 'mma',
    dna: { a: sa, b: sb },
    axes: I.axes, phases: I.phases, phase_strip: I.phase_strip,   // contrato compartido: la UI dibuja del payload, no de una lista fija
    profiles: { a: pa, b: pb },
    matchup: mu,
    projection: sim,
    disclaimer: priorA != null
      ? 'ganador anclado al modelo de habilidad; método, asalto y duración del motor de fases. NO anclado al mercado: no es una recomendación.'
      : 'SIN ancla de habilidad: el ganador de este motor está medido PEOR que una moneda (Brier 0,276 vs 0,250). Léase solo el método y la duración.',
    validated: {
      winner: 'brier 0,276 vs 0,250 de la moneda · 7 de 8 tramos descalibrados · por eso se ancla',
      method: 'KO 29,4% predicho vs 32,3% real · sumisión 19,4 vs 17,6 · decisión 51,2 vs 50,1 · límite 51,3 vs 50,1',
      n: 3140, method_note: 'ventana móvil por bloques sobre peleas anteriores',
    },
  };
}

// ---- LA MISMA PUERTA, EL MOTOR DE BOXEO ------------------------------------------------------------------
// Mismo contrato que arriba: ADN, cruce, rutas, fragilidad, proyección e incertidumbre. Lo que cambia es el
// vocabulario —tarjeta de 10 puntos, derribo, retirada en el banquillo, aguas profundas— porque es otro
// deporte y fingir que es MMA con guantes es exactamente lo que hacía el sistema hasta hoy.
function boxingIntel(I, a, b, pa, pb, { rounds, sims, seed, priorA }) {
  const va = I.vectors.get(a), vb = I.vectors.get(b);
  const mu = BX.matchup(pa, pb, va, vb, { rounds });
  const sim = BX.simulate(pa, pb, { rounds, n: sims, seed, mu, va, vb, priorA,
    hazardShape: I.hazardShape, league: I.league });
  return {
    available: true, sport: 'boxing',
    dna: { a: va, b: vb }, axes: I.axes, phases: I.phases, phase_strip: I.phase_strip,
    profiles: { a: pa, b: pb },
    matchup: mu, projection: sim,
    disclaimer: priorA != null
      ? 'ganador anclado al modelo de habilidad; asalto, vía y tarjetas del motor de boxeo. NO anclado al mercado: no es una recomendación.'
      : 'SIN ancla de habilidad. Léase sobre todo el asalto y la vía, que es donde este motor está medido.',
    validated: {
      breaks: 'se rompe la pelea: AUC 0,694 · Brier 0,221 contra 0,250 de la tasa base · predice 50,5 % y ocurre 51,1 % · calibración monótona por decil',
      timing: 'cuándo se rompe: asalto medio 5,11 predicho contra 5,30 real · "antes del 4º" 38,6 % contra 34,5 % (AUC 0,685)',
      method: 'KO 16,3/17,1 · TKO 30,0/29,4 · retirada 4,2/4,7 · decisión 47,2/48,9 · empate 2,25/1,77',
      winner: 'sin ancla: Brier 0,204 contra 0,250 de la moneda y 67,1 % de acierto — a diferencia de MMA, aquí el motor SÍ distingue al ganador. Se ancla igual: 3 de 8 tramos siguen descalibrados (ECE 3,62 pp) y el mercado de ganador está medido como el que pierde dinero.',
      n: 2768, method_note: 'ventana móvil por bloques sobre peleas anteriores, 2017 en adelante',
    },
    no_data: {
      punches: 'el dato de boxeo del que dispone GP no tiene conteo de golpes: el eje jab/poder se infiere de cómo se resuelven las peleas, no de CompuBox',
      knockdowns: 'tampoco hay conteo de caídas: el derribo es un mecanismo del simulador con razón declarada, no una medición',
      stance: 'la guardia solo se conoce para los dos peleadores en el 19,5 % de las peleas: se muestra como dato y no toca la probabilidad',
    },
  };
}

// Percentiles de la división para dibujar el ADN con escala. Se calcula sobre todos los perfiles cargados.
function dnaAxes(sport) {
  return (sport === 'boxing' ? BX.AXES : SY.AXES).map((a) => ({ key: a.key, label: a.label }));
}

module.exports = { load, fightIntel, dnaAxes };
