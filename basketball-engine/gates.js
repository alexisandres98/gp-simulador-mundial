// basketball-engine/gates.js — LAS COMPUERTAS Y EL "NO PICK" (16-ago).
//
// LA FRASE DEL BLUEPRINT QUE ORDENA ESTE ARCHIVO: "la pick es la última etapa, no el producto primario", y
// "No Pick es un resultado válido y visible".
//
// LO QUE HACE UN PRODUCTO SERIO Y NO HACE UN TIPSTER: publicar MENOS. Un generador de candidatos honesto
// encuentra decenas de ventajas nominales por noche; casi todas son error de modelo, precio muerto o la
// misma tesis repetida. Este archivo es el filtro, y su salida más importante no es la lista de picks: es
// la lista de RECHAZOS CON MOTIVO, porque eso es lo que se puede auditar después.
//
// CADA COMPUERTA DEVUELVE UN CÓDIGO. No "no cumple criterios": `edge_insuficiente`, `incertidumbre_alta`,
// `precio_rancio`, `alineacion_sin_resolver`, `modelo_degradado`, `tesis_repetida`, `dato_incompleto`,
// `sin_liquidez`. Un rechazo sin código es un rechazo que nadie puede revisar dentro de seis meses.
//
// LA COMPUERTA QUE MÁS PICKS MATA, Y CON RAZÓN: la de incertidumbre. Una ventaja de 5 pp con una
// incertidumbre epistémica de 7 pp no es una ventaja pequeña — es una ventaja cuyo signo no conocemos.
//
// PURO: entra un candidato ya valorado, sale una decisión. Sin red, sin disco, sin db.
'use strict';

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// ---- UMBRAL MÍNIMO POR FAMILIA ---------------------------------------------------------------------------
// No es un número redondo elegido a ojo: sale de cuánto se equivoca el modelo en esa familia y de cuánto
// margen carga el mercado. Donde el modelo es peor (props, cuartos) el listón sube. Donde el mercado es más
// eficiente (moneyline) también, porque ahí una ventaja aparente casi siempre es error propio.
const FAMILY = {
  moneyline: { min_edge_pp: 2.5, min_ev: 0.02, label: 'Ganador' },
  spread: { min_edge_pp: 2.0, min_ev: 0.02, label: 'Hándicap' },
  total: { min_edge_pp: 2.0, min_ev: 0.02, label: 'Total' },
  team_total: { min_edge_pp: 2.5, min_ev: 0.025, label: 'Total de equipo' },
  first_half: { min_edge_pp: 3.0, min_ev: 0.03, label: 'Primera parte' },
  quarter: { min_edge_pp: 3.5, min_ev: 0.035, label: 'Cuarto' },
  player_points: { min_edge_pp: 3.5, min_ev: 0.035, label: 'Puntos de jugador' },
  player_rebounds: { min_edge_pp: 4.0, min_ev: 0.04, label: 'Rebotes' },
  player_assists: { min_edge_pp: 4.0, min_ev: 0.04, label: 'Asistencias' },
  player_threes: { min_edge_pp: 5.0, min_ev: 0.05, label: 'Triples' },
  default: { min_edge_pp: 3.0, min_ev: 0.03, label: 'Otro' },
};
const familyOf = (k) => FAMILY[k] || FAMILY.default;

const REASONS = {
  edge_insuficiente: 'la ventaja no supera el listón de su familia',
  ev_insuficiente: 'el valor esperado no llega al mínimo',
  incertidumbre_alta: 'la ventaja es más pequeña que su propia incertidumbre',
  precio_rancio: 'la cuota es demasiado vieja para considerarla ejecutable',
  precio_no_jugable: 'la cuota disponible ya está por debajo del mínimo jugable',
  alineacion_sin_resolver: 'hay una duda de alineación que mueve el precio más que la ventaja',
  dato_incompleto: 'faltan datos necesarios para sostener la recomendación',
  modelo_degradado: 'la validación de esta familia no respalda publicar',
  sin_consenso: 'no hay casas suficientes para construir un precio de referencia',
  tesis_repetida: 'ya hay una selección publicada con la misma tesis',
  liquidez_dudosa: 'el mercado no parece ejecutable a ese precio',
};

// ---- EVALUACIÓN DE UN CANDIDATO --------------------------------------------------------------------------
// `cand` esperado:
//   { family, selection, game_id, price:{...priceRow}, books, uncertainty_pp, staleness, layers,
//     availability_open, data:{...}, thesis }
function evaluate(cand, { published = [], validation = null, minBooks = 3 } = {}) {
  const F = familyOf(cand.family);
  const blocks = [];
  const P = cand.price || {};

  // 1) consenso: sin varias casas no hay precio de referencia, solo el precio de una casa
  if ((cand.books || 0) < minBooks) blocks.push({ code: 'sin_consenso', detail: `${cand.books || 0} casas (mínimo ${minBooks})` });

  // 2) ventaja y valor esperado contra el listón de la familia
  if (!(Math.abs(P.edge_pp || 0) >= F.min_edge_pp)) blocks.push({ code: 'edge_insuficiente', detail: `${r2(P.edge_pp)} pp < ${F.min_edge_pp} pp` });
  if (!((P.ev_pct || 0) / 100 >= F.min_ev)) blocks.push({ code: 'ev_insuficiente', detail: `${r2(P.ev_pct)}% < ${r2(100 * F.min_ev)}%` });

  // 3) LA COMPUERTA CLAVE: la ventaja tiene que ser más grande que lo que no sabemos.
  // Se exige un margen de 1,3× sobre la incertidumbre epistémica, no un empate: si son iguales, el signo
  // de la ventaja es una moneda al aire con formato de recomendación.
  if (cand.uncertainty_pp != null && Math.abs(P.edge_pp || 0) < 1.3 * cand.uncertainty_pp) {
    blocks.push({ code: 'incertidumbre_alta', detail: `ventaja ${r2(P.edge_pp)} pp vs incertidumbre ${r2(cand.uncertainty_pp)} pp` });
  }

  // 4) el precio: ni rancio ni por debajo del mínimo jugable
  if (cand.staleness && cand.staleness.block) blocks.push({ code: 'precio_rancio', detail: `${r2(cand.staleness.age_min)} min` });
  if (P.playable === false) blocks.push({ code: 'precio_no_jugable', detail: `${P.odds} < mínimo ${P.min_playable}` });

  // 5) alineación sin resolver que mueve más que la propia ventaja
  if (cand.availability_open && cand.availability_open.max_delta_pp != null
    && Math.abs(cand.availability_open.max_delta_pp) > Math.abs(P.edge_pp || 0)) {
    blocks.push({ code: 'alineacion_sin_resolver', detail: `${cand.availability_open.name} mueve ${r2(cand.availability_open.max_delta_pp)} pp` });
  }

  // 6) salud del modelo en esa familia: si la validación no la respalda, no se publica
  const health = familyHealth(validation, cand.family);
  if (health && health.status === 'no_publica') blocks.push({ code: 'modelo_degradado', detail: health.reason });

  // 7) datos incompletos declarados por quien construyó el candidato
  for (const d of (cand.missing_data || [])) blocks.push({ code: 'dato_incompleto', detail: d });

  // 8) tesis repetida: dos selecciones que ganan o pierden juntas no son dos apuestas, son una más grande
  const dup = (published || []).find((p) => sameThesis(p, cand));
  if (dup) blocks.push({ code: 'tesis_repetida', detail: `ya publicado: ${dup.selection}` });

  const ok = blocks.length === 0;
  return {
    pick: ok,
    family: cand.family, family_label: F.label, selection: cand.selection,
    thresholds: { min_edge_pp: F.min_edge_pp, min_ev_pct: r2(100 * F.min_ev) },
    price: P,
    blocks: blocks.map((b) => ({ ...b, reason: REASONS[b.code] || b.code })),
    // el motivo PRINCIPAL, que es el que se enseña en la tarjeta de NO PICK
    reason_code: ok ? null : blocks[0].code,
    reason: ok ? null : REASONS[blocks[0].code],
    // qué tendría que pasar para que esto sí fuera pick: el contrafactual del blueprint
    counterfactual: ok ? null : counterfactual(blocks[0], cand, F),
    expiry: ok ? expiry(cand, P) : null,
  };
}

// ---- MISMA TESIS -----------------------------------------------------------------------------------------
// Dos selecciones son la misma tesis si apuestan al mismo lado del mismo partido, aunque el mercado se
// llame distinto: "local −4,5" y "local gana" son la misma creencia con distinto disfraz.
function sameThesis(a, b) {
  if (String(a.game_id || '') !== String(b.game_id || '')) return false;
  if (a.thesis && b.thesis) return a.thesis === b.thesis;
  return a.family === b.family && a.selection === b.selection;
}

// ---- CONTRAFACTUAL ---------------------------------------------------------------------------------------
function counterfactual(block, cand, F) {
  const P = cand.price || {};
  switch (block.code) {
    case 'edge_insuficiente': return `sería pick si la ventaja llegara a ${F.min_edge_pp} pp (hoy ${r2(P.edge_pp)})`;
    case 'ev_insuficiente':
    case 'precio_no_jugable': return `sería pick a partir de una cuota de ${P.min_playable}`;
    case 'incertidumbre_alta': return `sería pick si la incertidumbre bajara de ${r2(Math.abs(P.edge_pp || 0) / 1.3)} pp, normalmente al confirmarse la alineación`;
    case 'alineacion_sin_resolver': return `sería pick cuando se resuelva el estado de ${cand.availability_open && cand.availability_open.name}`;
    case 'precio_rancio': return 'sería pick con una cuota fresca al mismo precio';
    case 'sin_consenso': return 'sería pick con más casas cotizando el mercado';
    case 'tesis_repetida': return 'no se publica por exposición: ya hay una selección con la misma tesis';
    case 'modelo_degradado': return 'sería pick cuando la validación de esa familia vuelva a respaldarla';
    default: return null;
  }
}

// ---- EXPIRACIÓN ------------------------------------------------------------------------------------------
// Una pick no vale para siempre. Se declaran las condiciones que la invalidan, y el mínimo jugable es la
// primera: por debajo de ese precio la recomendación deja de existir, no se "sigue manteniendo".
function expiry(cand, P) {
  return {
    min_odds: P.min_playable,
    conditions: [
      `la cuota cae por debajo de ${P.min_playable}`,
      'cambia la alineación titular anunciada',
      'aparece una baja nueva en la rotación',
      cand.family === 'spread' || cand.family === 'total' ? 'la línea se mueve medio punto o más' : null,
    ].filter(Boolean),
  };
}

// ---- SALUD DEL MODELO POR FAMILIA ------------------------------------------------------------------------
// Traduce el veredicto de validación a un estado de ciclo de vida, que es el vocabulario del blueprint.
// El estado por defecto NO es "producción": es "investigación". Una familia se gana el derecho a publicar.
const LIFECYCLE = ['research', 'shadow', 'candidate', 'production', 'degraded', 'retired'];
// RECOGER MUESTRA NO ES PUBLICAR (19-ago). Hasta hoy una familia sin validación quedaba bloqueada del todo:
// ni pick, ni registro, ni cierre guardado. El efecto secundario es que NUNCA podía ganarse el derecho a
// publicar, porque para validarse hace falta muestra y la muestra solo llega registrando. Un círculo
// cerrado que se parece a la prudencia y no lo es.
//
// Ahora una familia sin validación entra en MONITOR: se registra en el track privado, se guarda su cierre
// y se mide su CLV, con la etiqueta puesta. La tarjeta lleva el distintivo MONITOR y solo la ve el admin,
// así que nadie de fuera confunde "estamos midiendo esto" con "esto es una recomendación".
//
// El interruptor existe por si algún día hay que volver a cerrarlo: `GP_HOOPS_MONITOR_ALL=0`.
const MONITOR_ALL = String(process.env.GP_HOOPS_MONITOR_ALL || '1') !== '0';
function familyHealth(validation, family) {
  const monitor = (stage, reason, extra) => (MONITOR_ALL
    ? { status: 'publica', stage: 'shadow', regime: 'monitor', monitor: true, reason: reason + ' — se registra en monitor para acumular muestra y CLV, no es recomendación', ...(extra || {}) }
    : { status: 'no_publica', stage, reason, ...(extra || {}) });
  if (!validation) return monitor('research', 'sin validación para esta liga');
  const sk = validation.skill || {};
  const best = sk.blended != null ? sk.blended : sk.base;
  // moneyline es la única familia medida contra el cierre; el resto todavía no. Eso se dice, pero ya no
  // impide recoger muestra.
  if (family === 'moneyline') {
    if (best == null) return monitor('research', 'sin medición');
    if (best < 0) return monitor('shadow', `por detrás del cierre (skill ${r2(best)})`, { skill: best });
    return { status: 'publica', stage: 'candidate', reason: `skill ${r2(best)} sobre el cierre`, skill: best };
  }
  return monitor('research', 'familia sin validación fuera de muestra todavía');
}

// ---- RESUMEN DE UNA NOCHE --------------------------------------------------------------------------------
// El panel necesita poder decir "18 candidatos, 0 picks, y estas son las razones". Un cero explicado
// construye más confianza que doce picks sin justificar.
function summarize(decisions) {
  const by = {};
  let picks = 0;
  for (const d of decisions) {
    if (d.pick) { picks++; continue; }
    by[d.reason_code] = (by[d.reason_code] || 0) + 1;
  }
  return {
    candidates: decisions.length, picks, no_picks: decisions.length - picks,
    reasons: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, n, reason: REASONS[code] || code })),
  };
}

module.exports = { FAMILY, REASONS, LIFECYCLE, familyOf, evaluate, familyHealth, summarize, sameThesis };
