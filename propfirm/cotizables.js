// propfirm/cotizables.js — EL UNIVERSO COTIZABLE DE POLYMARKET (7-oct-2026, orden de Alexis: «procede, vamos a hacerlo»)
//
// QUÉ ES. Cada mercado binario de Polymarket que el escáner de la prop firm consigue EMPAREJAR con un consenso
// sharp (fútbol: Shin por casa sobre las ~30 casas; tenis: pares desvigados; esports: crossBook) queda anotado
// aquí ENTERO, tenga o no ventaja. El escáner de señales solo guarda lo que cruza un listón; el market making
// no necesita ventaja, necesita un precio justo y un libro donde reposar órdenes, y eso es exactamente lo que
// este fichero reúne: tokens del CLOB, outcomes, probabilidad justa del outcome 0, tarifa (incluido el rebate
// al maker), configuración de recompensas de liquidez y tick.
//
// DOCTRINA. Esto NO toca las señales ni los dos libros de sombra (v1/v2): es una salida lateral del mismo
// escaneo. Un mercado desaparece de aquí cuando lleva 48 h sin refrescarse. Solo lectura para la sombra de
// market making (`propfirm/mm.js`); nadie más lo consume. Las anotaciones se acumulan en memoria y se vuelcan
// al disco una vez por pasada (1,5 s después de la última), no en cada llamada.
'use strict';
const fs = require('fs');
const path = require('path');
const JS = require('../lib/jsonstore');

const DIR = process.env.GP_PROPFIRM_DIR || (fs.existsSync('/data') ? '/data/propfirm' : path.join(__dirname, '..', 'data', 'propfirm'));
const FNAME = 'cotizables.json';
const CADUCIDAD_H = 48;

let cache = null;
let flushTimer = null;
function st() {
  if (!cache) cache = JS.readJson(DIR, FNAME, 'cotizables') || { mercados: {}, at: null };
  return cache;
}
function guardar() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!cache) return false;
  cache.at = new Date().toISOString();
  return JS.writeJson(DIR, FNAME, cache, 'cotizables');
}
function programaGuardado() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; guardar(); }, 1500);
  if (flushTimer.unref) flushTimer.unref();
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const jarr = (x) => { if (Array.isArray(x)) return x; try { const j = JSON.parse(x); return Array.isArray(j) ? j : []; } catch { return []; } };

// Anota (o refresca) un mercado cotizable. `consenso0` es la probabilidad JUSTA del outcome 0 del mercado
// (el primero de `outcomes`), sin margen; `shin0` la misma con Shin cuando existe (fútbol). Devuelve false si
// falta cualquier coordenada de ejecución: sin tokens, sin condition id o sin consenso no hay nada que cotizar.
function anota({ m, deporte, familia, evento, ko, consenso0, shin0 = null, books = 0, competicion = null, lado0 = null } = {}) {
  if (!m || !m.conditionId) return false;
  const tks = jarr(m.clobTokenIds), outs = jarr(m.outcomes);
  if (tks.length !== 2 || outs.length !== 2) return false;
  const c0 = num(consenso0);
  if (!(c0 > 0 && c0 < 1)) return false;
  const fs0 = m.feeSchedule && typeof m.feeSchedule === 'object' ? m.feeSchedule : null;
  const s = st();
  const prev = s.mercados[m.conditionId] || {};
  s.mercados[m.conditionId] = {
    cond: m.conditionId, mid: m.id != null ? String(m.id) : (prev.mid || null), slug: m.slug || prev.slug || null,
    deporte, familia, evento, competicion, pregunta: String(m.question || ''), outs, tokens: tks, lado0,
    ko: ko ? new Date(ko).toISOString() : (prev.ko || null),
    consenso0: +c0.toFixed(4), shin0: num(shin0) != null ? +num(shin0).toFixed(4) : null, books,
    precio0_gamma: num(jarr(m.outcomePrices)[0]), liquidez: num(m.liquidityNum != null ? m.liquidityNum : m.liquidity),
    fee_rate: fs0 ? num(fs0.rate) : null, fee_exp: fs0 ? num(fs0.exponent) : null, fee_rebate: fs0 ? num(fs0.rebateRate) : null,
    rewards_min_size: num(m.rewardsMinSize), rewards_max_spread: num(m.rewardsMaxSpread),
    tick: num(m.orderPriceMinTickSize) || 0.01, min_size: num(m.orderMinSize) || 5, neg_risk: !!m.negRisk,
    primera_vez: prev.primera_vez || new Date().toISOString(), at: new Date().toISOString(),
  };
  // poda: lo que lleva CADUCIDAD_H sin refrescarse ya no está en el calendario del escáner
  const corte = Date.now() - CADUCIDAD_H * 3600e3;
  for (const [k, v] of Object.entries(s.mercados)) if (Date.parse(v.at || 0) < corte) delete s.mercados[k];
  programaGuardado();
  return true;
}

function todos() { return Object.values(st().mercados || {}); }
function estado() {
  const l = todos();
  const porDep = {};
  for (const m of l) porDep[m.deporte] = (porDep[m.deporte] || 0) + 1;
  return { n: l.length, por_deporte: porDep, at: st().at };
}
// para tests y para releer el disco tras un cambio externo
function recargar() { cache = null; return st(); }

module.exports = { anota, todos, estado, guardar, recargar, DIR, FNAME };
