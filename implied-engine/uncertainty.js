// implied-engine/uncertainty.js — LA INCERTIDUMBRE POR MUESTRA, TRANSVERSAL (9-sep)
//
// De dónde viene. En tenis de mesa y dardos cada tesis nace con `unc_pp`: cuántos puntos porcentuales de la
// probabilidad del modelo son ruido de MUESTRA (pocos partidos de uno de los dos lados), y la puerta exige
// edge ≥ 0,75 × unc_pp. La autopsia del 2-sep encontró la "ley común" de las familias que pierden: la pick nace
// justo donde modelo − mercado es máximo, y con un modelo más ruidoso que el mercado esa selección recoge
// sobre todo error del modelo. Un umbral plano de 3 pp no distingue un edge de 4 pp con 40 partidos por lado
// de uno con 6. Este módulo pone el mismo número en todas las sombras.
//
// QUÉ NO HACE. No cambia qué picks nacen: las familias congeladas (`cards_under_v1`, `cs2_rounds_v1`,
// `lol_kills_hcp_v1`, `corners_over_v1`) siguen con su regla. Aquí solo se ETIQUETA cada tesis con unc_pp y con
// el veredicto que habría dado la puerta, para que el track pueda partir la muestra en dos y decir si la puerta
// hubiera ahorrado dinero. Cambiar la regla es decisión de Alexis con esa tabla delante.
'use strict';

// La forma es la de tt-engine/data.js: 100 · k · sqrt(1/(nA+2) + 1/(nB+2)). k = 0,28 es la desviación típica
// de una probabilidad binaria cerca de 0,5 por observación efectiva (√(p(1−p)) ≈ 0,5 · factor de encogimiento
// del Elo ≈ 0,56); con nA = nB = 8 da 6,3 pp, con 30 por lado 3,5 pp, con 100 por lado 2,0 pp.
const K_DEFAULT = 0.28;
const RATIO_DEFAULT = 0.75;

function uncPp(nA, nB, { k = K_DEFAULT } = {}) {
  const a = Math.max(0, Number(nA) || 0), b = Math.max(0, Number(nB) || 0);
  return +(100 * k * Math.sqrt(1 / (a + 2) + 1 / (b + 2))).toFixed(2);
}

// Para mercados de UN solo proceso (total de un partido, kills de un mapa) donde la muestra es la del cruce
// y no la de dos lados: n observaciones de la cantidad que se modela.
function uncPpOne(n, { k = K_DEFAULT } = {}) {
  const a = Math.max(0, Number(n) || 0);
  return +(100 * k * Math.sqrt(2 / (a + 2))).toFixed(2);
}

// El veredicto que habría dado la puerta de TT/dardos: edge ≥ ratio × unc. Devuelve un objeto pequeño que se
// cuelga de la tesis (`unc`), nunca un booleano suelto, para que el track sepa con qué constantes se juzgó.
function gateVerdict(edgePp, uncPpValue, { ratio = RATIO_DEFAULT } = {}) {
  const e = Number(edgePp), u = Number(uncPpValue);
  if (!Number.isFinite(e) || !Number.isFinite(u)) return { unc_pp: Number.isFinite(u) ? u : null, ratio, passes: null, margin_pp: null };
  return { unc_pp: u, ratio, passes: e >= ratio * u, margin_pp: +(e - ratio * u).toFixed(2) };
}

// Partir una lista de tesis liquidadas por el veredicto: la tabla que decide si la puerta vale.
function splitByGate(list, { unitsOf = (p) => p.units, clvOf = (p) => p.clv_pct } = {}) {
  const agg = (rows) => {
    const u = rows.map(unitsOf).filter(Number.isFinite), c = rows.map(clvOf).filter(Number.isFinite);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    return { n: rows.length, units: +sum(u).toFixed(2), roi_pct: u.length ? +(100 * sum(u) / u.length).toFixed(2) : null,
      clv_avg_pct: c.length ? +(sum(c) / c.length).toFixed(2) : null, clv_n: c.length };
  };
  const pass = list.filter((p) => p.unc && p.unc.passes === true), fail = list.filter((p) => p.unc && p.unc.passes === false);
  const sin = list.filter((p) => !p.unc || p.unc.passes == null);
  return { con_puerta: agg(pass), sin_puerta: agg(fail), sin_dato: agg(sin), ratio: RATIO_DEFAULT };
}

module.exports = { uncPp, uncPpOne, gateVerdict, splitByGate, K_DEFAULT, RATIO_DEFAULT };
