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

const G = global._cbIntel = global._cbIntel || {};

// `fights` y `stats` los pasa el llamador (server.js ya los tiene cargados y cacheados por organización).
function load(org, fights, stats, { force = false, ttl = 30 * 60e3 } = {}) {
  const cur = G[org];
  const n = (fights || []).length;
  if (cur && !force && cur.n === n && Date.now() - cur.at < ttl) return cur;
  const t0 = Date.now();
  const B = PH.buildProfiles(fights || [], stats || {}, {});
  const V = SY.styleVectors(B.profiles);
  const out = { org, n, at: Date.now(), ms: Date.now() - t0,
    profiles: B.profiles, vectors: V, league: B.league, fighters: B.profiles.size };
  G[org] = out;
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
      note: 'uno de los dos no tiene suficientes peleas con estadística granular en nuestro histórico' };
  }
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
    available: true,
    dna: { a: sa, b: sb },
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

// Percentiles de la división para dibujar el ADN con escala. Se calcula sobre todos los perfiles cargados.
function dnaAxes() { return SY.AXES.map((a) => ({ key: a.key, label: a.label })); }

module.exports = { load, fightIntel, dnaAxes };
