// data-providers/kalshi.js — KALSHI COMO SEGUNDO PROVEEDOR DE PRECIO (19-ago).
//
// POR QUÉ EXISTE. Hasta hoy todo el precio de la casa venía de The Odds API, que sirve las casas grandes:
// el extremo EFICIENTE del mercado, que es justo donde el edge no vive. Kalshi es otra cosa — un exchange
// regulado, con libro de órdenes visible, API pública sin clave para leer, y 3.442 series deportivas.
// Dos consecuencias directas:
//   1. F1 deja de ser el único deporte sin mercado: KXF1RACEPODIUM y KXF1TOP10 cotizan exactamente las dos
//      familias donde el gemelo bate al baseline en pre-clasificación (Brier 0,086 vs 0,124 y 0,191 vs 0,250).
//   2. Donde The Odds API no llega, aquí puede haber precio. Y donde llegan los dos, hay dos opiniones que
//      comparar, que es la materia prima del arbitraje y de la detección de líneas atrasadas.
//
// LO QUE UN EXCHANGE NO ES. No es una casa: el precio es de otro participante, no de un creador de mercado,
// así que la profundidad puede ser cero aunque haya "precio". Por eso este módulo devuelve SIEMPRE el
// tamaño disponible junto al precio, y quien decide tiene que mirarlo. Un contrato a 12¢ sin nadie
// enfrente no es una cuota de 8,33: es un número en una pantalla.
//
// PRECIOS. Kalshi cotiza en centavos por contrato que paga 100¢. Comprar SÍ a `a` centavos equivale a una
// cuota decimal de 100/a. El lado NO cuesta (100 − b) centavos, con `b` el bid del SÍ.
//
// PURO salvo la red: sin disco, sin db.
'use strict';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com)';

async function get(path, { timeout = 20000 } = {}) {
  const r = await fetch(BASE + path, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`kalshi ${r.status} en ${path.slice(0, 60)}`);
  return r.json();
}

// PRECIO → CUOTA DECIMAL. Kalshi sirve los precios como CADENAS EN DÓLARES (`yes_ask_dollars: "0.3900"`)
// en la API nueva y como enteros en centavos (`yes_ask`) en la vieja. Leer solo la vieja hacía que 44
// contratos abiertos y líquidos —7.274 de interés abierto en el podio de Zandvoort— salieran "sin precio".
// Se aceptan las dos y se normaliza a probabilidad (0-1).
function toProb(m, side, face) {
  const d = m[`${side}_${face}_dollars`];
  if (d != null && d !== '') { const v = Number(d); if (Number.isFinite(v) && v > 0 && v < 1) return +v.toFixed(4); }
  const c = m[`${side}_${face}`];
  if (Number.isFinite(c) && c > 0 && c < 100) return +(c / 100).toFixed(4);
  return null;
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// 0 o null significan "sin nadie enfrente", no "gratis".
const toDecimal = (p) => (p > 0 && p < 1 ? +(1 / p).toFixed(3) : null);
// UTILIZABLE PARA PRECIAR: las dos caras presentes y horquilla ≤ 8 puntos. Sin esto, los contratos de
// relleno —compra vacía, venta a 1¢— entran como si fueran precio y contaminan cualquier ventaja.
const MAX_SPREAD = 0.08;
const usable = (r) => r.yes.bid != null && r.yes.ask != null && (r.yes.ask - r.yes.bid) <= MAX_SPREAD;

// ── CATÁLOGO ────────────────────────────────────────────────────────────────────────────────────────────
// `series` son las plantillas (F1 Race Podium Finisher); `markets` son los contratos concretos de cada
// carrera o partido. Se cachea el catálogo porque cambia de semana en semana, no de minuto en minuto.
let _series = null, _seriesAt = 0;
async function series({ ttlMs = 6 * 3600e3 } = {}) {
  if (_series && Date.now() - _seriesAt < ttlMs) return _series;
  const j = await get('/series?limit=1000');
  _series = (j.series || []).map((s) => ({ ticker: s.ticker, title: s.title, category: s.category }));
  _seriesAt = Date.now();
  return _series;
}

async function findSeries(rx) {
  const all = await series();
  const re = rx instanceof RegExp ? rx : new RegExp(rx, 'i');
  return all.filter((s) => re.test(s.ticker) || re.test(s.title));
}

// ── MERCADOS DE UNA SERIE ───────────────────────────────────────────────────────────────────────────────
// Devuelve una fila por contrato, con las dos caras y el tamaño. `sub` es el sujeto (el piloto, el equipo).
async function markets(seriesTicker, { status = 'open', limit = 200 } = {}) {
  const j = await get(`/markets?series_ticker=${encodeURIComponent(seriesTicker)}&status=${status}&limit=${limit}`);
  return (j.markets || []).map((m) => ({
    ticker: m.ticker, series: seriesTicker,
    sub: m.yes_sub_title || m.subtitle || m.title || '',
    title: m.title || '',
    close_time: m.close_time || null,
    // el SÍ se compra al ask y se vende al bid; para apostar A FAVOR la cuota relevante es la del ask
    yes: { bid: toProb(m, 'yes', 'bid'), ask: toProb(m, 'yes', 'ask'), odds: toDecimal(toProb(m, 'yes', 'ask')) },
    no: { bid: toProb(m, 'no', 'bid'), ask: toProb(m, 'no', 'ask'), odds: toDecimal(toProb(m, 'no', 'ask')) },
    // profundidad: sin esto el precio no significa nada en un exchange
    liquidity: num(m.liquidity_dollars) ?? m.liquidity ?? null,
    volume: num(m.volume_dollars) ?? m.volume ?? null,
    open_interest: num(m.open_interest_fp) ?? m.open_interest ?? null,
    last: num(m.last_price_dollars) ?? (Number.isFinite(m.last_price) ? m.last_price / 100 : null),
  }));
}

// ── F1: las dos familias que nos importan ───────────────────────────────────────────────────────────────
// PODIO y TOP-10 son justo donde el gemelo gana al baseline antes de la clasificación. Se devuelven
// normalizadas por piloto para que el motor las cruce con su propia probabilidad sin saber de Kalshi.
const F1_SERIES = { PODIO: 'KXF1RACEPODIUM', PUNTOS: 'KXF1TOP10' };

async function f1Markets() {
  const out = { at: new Date().toISOString(), families: {}, errors: [] };
  for (const [family, ticker] of Object.entries(F1_SERIES)) {
    try {
      const rows = await markets(ticker);
      out.families[family] = rows.map((r) => ({
        driver_name: r.sub || r.title, ticker: r.ticker, close_time: r.close_time,
        odds_yes: r.yes.odds, odds_no: r.no.odds,
        p_market: r.yes.ask,
        // el punto medio entre compra y venta es la lectura menos sesgada del consenso del libro. Cuando el
        // lado SÍ no tiene ask pero el NO sí, se deduce: son las dos caras del mismo contrato.
        // EL PUNTO MEDIO SOLO VALE CON LAS DOS CARAS Y LA HORQUILLA ESTRECHA. Un contrato con compra vacía y
        // venta a 1¢ tiene "punto medio" 50 % si uno se descuida, y eso no es la opinión de nadie: es la
        // ausencia de opinión. Se exige compra y venta presentes y una horquilla de 8 puntos como máximo.
        p_mid: usable(r) ? +(((r.yes.bid + r.yes.ask) / 2)).toFixed(4) : null,
        spread: (r.yes.bid != null && r.yes.ask != null) ? +((r.yes.ask - r.yes.bid).toFixed(4)) : null,
        usable: usable(r),
        last: r.last,
        liquidity: r.liquidity, volume: r.volume, open_interest: r.open_interest,
      }));
    } catch (e) { out.errors.push(`${family}: ${e.message}`); out.families[family] = []; }
  }
  const n = Object.values(out.families).reduce((a, x) => a + x.length, 0);
  const conPrecio = Object.values(out.families).reduce((a, x) => a + x.filter((y) => y.usable).length, 0);
  out.summary = { contratos: n, utilizables: conPrecio,
    nota: conPrecio === 0 && n > 0 ? 'hay contratos abiertos pero sin horquilla utilizable: no hay precio contra el que medirse' : null };
  return out;
}

module.exports = { get, series, findSeries, markets, f1Markets, toDecimal, usable, MAX_SPREAD, F1_SERIES };
