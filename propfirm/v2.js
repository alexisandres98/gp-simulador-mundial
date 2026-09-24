// propfirm/v2.js — LA REGLA `pm_v2` DEL EJECUTOR EN LA SOMBRA DE POLYMARKET (24-sep-2026, orden de Alexis).
//
// DE DÓNDE SALE. La sombra v1 (1-sep → 21-sep, 450 posiciones resueltas) pierde −5,5 % neto y la autopsia
// dice por qué, con números: (1) cruzar el libro cuesta ~4 pp por operación (deslizamiento 1,8 pp +
// comisión ≈ 2,3 % del nocional) y la ventaja declarada era de 4-6 pp — tras costes, ruido; (2) el consenso
// proporcional infla los longshots: banda 0,30-0,40 decía 35 % y ocurrió 22 %, y todo lo comprado por
// debajo de 0,40 perdió 925 USD en 201 posiciones; (3) entrar a más de 2 h del saque pierde (−12 % en 175)
// y a menos de 2 h gana; (4) fútbol *Yes*, empates, LoL, hándicap de mapas y CS2 de tier 3 pierden todos.
// Lo que queda de pie dentro de la MISMA muestra: precio ≥ 0,40 y menos de 2 h al saque → 103 posiciones,
// +17,1 %, t 1,87; fútbol *No* con esas dos condiciones → 60, +24,1 %, t 2,02.
//
// LAS TRES REGLAS QUE ALEXIS ORDENÓ APLICAR:
//   1. consenso de fútbol con Shin (por casa, mediana entre casas) en vez de proporcional: ataca el sesgo
//      de longshot en la causa, no en el síntoma (`lib/devig.js`, ya existía y no se usaba aquí);
//   2. listón NETO: consenso − precio − comisión − deslizamiento esperado ≥ 3 pp, contra el precio del
//      FILL cuando lo hay;
//   3. perímetro: precio 0,40-0,70, entrar a ≤ 2 h del saque, y solo las familias que se sostuvieron.
//
// DOCTRINA. Es una regla NUEVA al lado de la v1, que sigue corriendo congelada como control: nunca se edita
// un segmento vivo. Y es SOMBRA: no mueve dinero, y la puerta para moverlo es la de siempre (100 resueltas
// y t ≥ 2 con el veredicto de la vara). Los deportes nuevos (tenis, Valorant, Dota 2) entran SOLO por esta
// regla y se leen por deporte, porque un ROI agregado de familias distintas no decide nada.
//
// AVISO DE MÉTODO, escrito para que nadie lo olvide: estos filtros se encontraron MIRANDO la muestra. El
// rendimiento real será peor que el de la tabla que los justifica. Lo que vale de ellos es que cada uno
// tiene un mecanismo (coste, sesgo, consenso rancio) y que la dirección se sostuvo en las tres semanas.
'use strict';
const COM = require('../lib/comisiones');

const PRECIO_MIN = () => +(process.env.GP_PM_V2_PRECIO_MIN || 0.40);
const PRECIO_MAX = () => +(process.env.GP_PM_V2_PRECIO_MAX || 0.70);
const HORAS_MAX = () => +(process.env.GP_PM_V2_HORAS_MAX || 2);
const EDGE_NETO_MIN_PP = () => +(process.env.GP_PM_V2_EDGE_NETO_PP || 3);
const SLIP_ESPERADO_PP = () => +(process.env.GP_PM_V2_SLIP_PP || 1);   // mediana medida en v1: 1,0 pp

// Nivel del torneo en esports, por el nombre de la competición. Lo medido: CS2 de tier 1-2 +23,8 % en 28,
// tier 3 −26,1 % en 61. Se guarda el nombre y el nivel en la señal para poder rehacer el corte después.
const TIER_ALTO = [
  'blast', 'iem ', 'iem_', 'intel extreme', 'esl pro league', 'esl one', 'pgl major', 'pgl masters', 'pgl wallachia',
  'starladder', 'starseries', 'thunderpick world', 'fissure', 'betboom dacha', 'perfect world', 'major',
  'vct', 'valorant champions', 'masters', 'the international', 'dreamleague', 'riyadh', 'esports world cup',
  'worlds', 'msi', 'lck', 'lec', 'lcs', 'lpl',
];
function nivelEsports(competicion) {
  const s = String(competicion || '').toLowerCase();
  if (!s) return 'desconocido';
  if (TIER_ALTO.some((k) => s.includes(k))) return 'tier1-2';
  return 'tier3';
}

// Qué familias entran por deporte. Lo que NO está aquí no es "prohibido para siempre": es que la v1 midió
// que pierde (fútbol Yes/empate, LoL, hándicaps de mapas, CS2 tier 3) o que no hay muestra (todo lo nuevo
// entra solo por el ganador).
function familiaOk(s) {
  const d = String(s.deporte || s.game || '').toLowerCase();
  const f = String(s.familia || '').toUpperCase();
  const lado = String(s.lado || '').toLowerCase();
  if (d === 'futbol') return f === 'FUT1X2' && lado === 'no' && s.resultado !== 'draw';
  if (d === 'cs2') return (f === 'MAPA' || f === 'SERIE') && s.nivel === 'tier1-2';
  if (d === 'valorant' || d === 'dota2') return f === 'MAPA' || f === 'SERIE';
  if (d === 'tenis' || d === 'nfl') return f === 'ML';
  // college (24-sep, orden de Alexis): el ganador por consenso y, además, los TOTALES y HÁNDICAPS de la
  // sombra de NCAAF —la misma familia que el ejecutor real juega en Cloudbet— medidos en el venue hondo
  if (d === 'ncaaf') return f === 'ML' || f === 'TOTAL' || f === 'SPREAD';
  return false;
}

// El consenso que usa la v2: Shin cuando la señal lo trae (fútbol), el de la señal en el resto.
const consensoV2 = (s) => (s.consenso_shin != null && Number.isFinite(Number(s.consenso_shin)) ? Number(s.consenso_shin) : Number(s.consenso));

// Ventaja NETA por acción, en pp: consenso − precio − comisión − deslizamiento esperado. Con `precioFill`
// el deslizamiento ya está dentro del precio y no se vuelve a restar.
function edgeNetoPp({ consenso, precio, fee_rate, fee_exp, esFill = false } = {}) {
  const c = Number(consenso), p = Number(precio);
  if (!(c >= 0 && c <= 1) || !(p > 0 && p < 1)) return null;
  const com = COM.comisionPorShare(p, fee_rate, fee_exp);
  return +(100 * (c - p - com) - (esFill ? 0 : SLIP_ESPERADO_PP())).toFixed(2);
}

// La decisión completa sobre una señal, en un momento dado y a un precio dado. `esFill` distingue el
// precio de aviso (escaneo) del precio medio realmente comprado (sombra). El orden de los motivos importa:
// se devuelve el PRIMERO que falla, y `temprano` va al final para que una señal fuera de familia o de
// precio no se quede esperando a nada.
function evaluar(s, { ahora = Date.now(), precio = null, esFill = false, exigirHora = true } = {}) {
  const p = precio != null ? Number(precio) : Number(s.precio_pm);
  const cons = consensoV2(s);
  const out = { consenso: Number.isFinite(cons) ? +cons.toFixed(4) : null, precio: p, edge_neto_pp: null, horas: null, ok: false, motivo: null };
  if (!familiaOk(s)) { out.motivo = 'familia'; return out; }
  if (!(p >= PRECIO_MIN() && p <= PRECIO_MAX())) { out.motivo = 'precio'; return out; }
  out.edge_neto_pp = edgeNetoPp({ consenso: cons, precio: p, fee_rate: s.fee_rate, fee_exp: s.fee_exp, esFill });
  if (out.edge_neto_pp == null || out.edge_neto_pp < EDGE_NETO_MIN_PP()) { out.motivo = 'edge'; return out; }
  const ko = Date.parse(s.ko || 0);
  out.horas = Number.isFinite(ko) ? +((ko - ahora) / 3600e3).toFixed(2) : null;
  if (exigirHora) {
    if (out.horas == null || out.horas <= 0) { out.motivo = 'empezado'; return out; }
    if (out.horas > HORAS_MAX()) { out.motivo = 'temprano'; return out; }
  }
  out.ok = true;
  return out;
}

module.exports = { evaluar, familiaOk, consensoV2, edgeNetoPp, nivelEsports,
  PRECIO_MIN, PRECIO_MAX, HORAS_MAX, EDGE_NETO_MIN_PP, SLIP_ESPERADO_PP, TIER_ALTO };
