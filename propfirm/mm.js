// propfirm/mm.js — MARKET MAKING EN SOMBRA SOBRE POLYMARKET (7-oct-2026, orden de Alexis: «procede, vamos a hacerlo»)
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────────────
// Dos meses de medición dicen que el modelo no le gana al precio en ningún deporte salvo tarjetas under, y que
// cruzar la horquilla cuesta 3-5 % por lado en las casas y 0,8-2,7 pp de deslizamiento en Polymarket. Todo el
// sistema ha jugado de TAKER. Esta sombra juega del otro lado: pone una orden de compra y una de venta a cada
// lado del precio justo (el consenso sharp sin margen que ya calculamos) y cobra la horquilla a quien cruza.
// No necesita saber quién gana; necesita un precio de referencia bueno, reponer cuando se mueve y no cargarse
// de inventario. Es la primera hipótesis del proyecto que no depende de batir al mercado.
//
// ── CÓMO SE SIMULA UN FILL DE MAKER, Y POR QUÉ ASÍ ──────────────────────────────────────────────────────
// Polymarket publica cada cruce real (data-api `/trades`: lado del taker, outcome, precio, tamaño, segundo).
// Una orden nuestra de COMPRA a `bid` se habría llenado cuando un taker VENDIÓ a un precio ≤ bid: por prioridad
// de precio, nuestra orden (mejor) se llena antes que la que recibió el cruce. Si el cruce fue EXACTAMENTE a
// nuestro precio, estábamos en cola con otros y se cuenta solo la MITAD del tamaño. Lo mismo, espejado, para la
// venta. Un cruce en el outcome 1 es el mismo cruce visto desde el otro lado (comprar NO a q = vender YES a
// 1−q), así que todo se traduce a coordenadas del outcome 0 antes de mirar.
// Se llena contra la cotización que estaba VIGENTE durante el intervalo (la de la pasada anterior), nunca
// contra la recién calculada: eso es lo que hace que el reprecio lento se pague como se pagaría de verdad.
//
// ── LO QUE MIDE Y LO QUE NO ─────────────────────────────────────────────────────────────────────────────
// Mide: fills, nocional cruzado, inventario, P&L realizado a la resolución del mercado (gamma), P&L marcado al
// justo, el MARKOUT a 30 min de cada fill (si el justo se movió en nuestra contra después de llenarnos, nos
// eligieron: selección adversa, el riesgo real del maker) y cuántos minutos estuvimos dentro del perímetro
// de las recompensas de liquidez. NO suma al P&L ni las recompensas ni el rebate de comisión del maker: ambos
// dependen de cuánta otra liquidez hubiera, que no se puede saber desde fuera. Se publican como TOPE aparte.
// La ingenuidad del simulador va en nuestra contra, no a favor: reprecia cada pocos minutos con un consenso
// que se refresca cada 10, así que mide a un maker lento. Un maker rápido haría mejor que esto, no peor.
//
// DOCTRINA. Ningún dinero real. Regla escrita en docs/PREREGISTRO_POLY_MM_2026-10-07.md antes de arrancar:
// cuatro semanas, se lee por deporte, y la puerta es la de siempre (muestra y t ≥ 2) sobre el P&L realizado
// SIN recompensas. Separado por completo de las señales y de los dos libros de sombra.
'use strict';
const fs = require('fs');
const path = require('path');
const JS = require('../lib/jsonstore');
const COM = require('../lib/comisiones');
const COT = require('./cotizables');

const DIR = process.env.GP_PROPFIRM_DIR || (fs.existsSync('/data') ? '/data/propfirm' : path.join(__dirname, '..', 'data', 'propfirm'));
const FNAME = 'poly-mm.json';
const REGLA = 'mm_v1';
const CLOB = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';
const DATA = 'https://data-api.polymarket.com';

const CFG = () => ({
  banco: +(process.env.GP_POLYMM_BANCO || 2000),
  spread_pp: +(process.env.GP_POLYMM_SPREAD_PP || 2),          // medio spread, en pp, a cada lado del justo
  size: +(process.env.GP_POLYMM_SIZE || 50),                   // shares por lado y por intervalo
  inv_max: +(process.env.GP_POLYMM_INV_MAX || 200),            // |inventario neto| máximo por mercado (shares)
  h_min: +(process.env.GP_POLYMM_H_MIN || 0.25),               // se retira la cotización a 15 min del saque
  h_max: +(process.env.GP_POLYMM_H_MAX || 36),                 // no se cotiza a más de 36 h
  precio_min: +(process.env.GP_POLYMM_PRECIO_MIN || 0.08),
  precio_max: +(process.env.GP_POLYMM_PRECIO_MAX || 0.92),
  liq_min: +(process.env.GP_POLYMM_LIQ_MIN || 500),            // liquidez de gamma, para no cotizar libros vacíos
  frescura_min: +(process.env.GP_POLYMM_FRESCURA_MIN || 75),   // consenso más viejo que esto: no se cotiza
  mercados_max: +(process.env.GP_POLYMM_MERCADOS_MAX || 40),   // mercados cotizados por pasada (trades + libro, dos llamadas cada uno)
  peso_libro: +(process.env.GP_POLYMM_PESO_LIBRO || 0.5),     // el justo mezcla consenso y medio del libro: 0 = solo consenso, 1 = solo libro
  discrepancia_pp: +(process.env.GP_POLYMM_DISCREPANCIA_PP || 8), // consenso y medio del libro a más de esto: uno de los dos está mal, no se cotiza
  deportes_fuera: new Set(String(process.env.GP_POLYMM_SIN_DEPORTES || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)),
});

function rd() { return JS.readJson(DIR, FNAME, 'polymm') || { regla: REGLA, desde: null, banco_inicial: CFG().banco, mercados: {}, cerrados: [], pasadas: 0, at: null }; }
function wr(st) { return JS.writeJson(DIR, FNAME, st, 'polymm'); }

async function jfetch(url, timeoutMs = 12000) {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const r4 = (x) => +Number(x).toFixed(4);
const r2 = (x) => +Number(x).toFixed(2);

// ── EL LIBRO DE CAJA DE UN MERCADO ──────────────────────────────────────────────────────────────────────
// Dos contadores de shares, nunca negativos: `s0` (outcome 0) y `s1` (outcome 1). Comprar el 0 a `bid` es
// s0 += q, caja −= q·bid. "Vender el 0 a `ask`" sin tenerlo es comprar el 1 a 1−ask: s1 += q, caja −= q·(1−ask).
// Un par (una de cada) vale exactamente 1 y se funde: caja += 1 por par. Así la caja nunca miente sobre el
// colateral comprometido y el P&L final es caja + lo que pague el outcome ganador. Es como lo liquida la casa.
function aplicaFill(m, lado, q, precio) {
  if (lado === 'compra') { m.s0 = r4((m.s0 || 0) + q); m.caja = r4((m.caja || 0) - q * precio); }
  else { m.s1 = r4((m.s1 || 0) + q); m.caja = r4((m.caja || 0) - q * (1 - precio)); }
  const par = Math.min(m.s0 || 0, m.s1 || 0);
  if (par > 0) { m.s0 = r4(m.s0 - par); m.s1 = r4(m.s1 - par); m.caja = r4(m.caja + par); }
  m.inv0 = r4((m.s0 || 0) - (m.s1 || 0));
}
// la caja viva de los mercados sin resolver más el P&L de los resueltos (que siguen 3 días en `mercados` y no se cuentan dos veces)
const efectivoDe = (st) => r2((st.banco_inicial || CFG().banco) + Object.values(st.mercados || {}).filter((m) => m.estado !== 'RESUELTO').reduce((a, m) => a + (m.caja || 0), 0)
  + (st.cerrados || []).reduce((a, c) => a + (c.pnl || 0), 0));

// ── LA COTIZACIÓN ───────────────────────────────────────────────────────────────────────────────────────
// bid = justo − h − sesgo · ask = justo + h − sesgo, con sesgo = (inv0 / inv_max) · h: cargado de un lado, las
// dos órdenes bajan para que el mercado nos descargue. Un lado se apaga cuando toca su tope de inventario,
// cuando se sale de la banda de precio o cuando no hay colateral en caja para sostenerlo.
// Y NUNCA SE CRUZA EL LIBRO: una orden de venta por debajo del mejor bid no reposa, se ejecuta como taker (y paga
// comisión). El bid se recorta a mejor ask − tick y el ask a mejor bid + tick: como mucho, mejoramos el libro un tick.
function cotiza(m, justo, efectivo, cfg, ahora = Date.now(), libro = null) {
  const h = cfg.spread_pp / 100;
  const tick = m.tick > 0 ? m.tick : 0.01;
  const sesgo = ((m.inv0 || 0) / cfg.inv_max) * h;
  const abajo = (x) => Math.floor(x / tick + 1e-9) * tick;
  const arriba = (x) => Math.ceil(x / tick - 1e-9) * tick;
  let bid = r4(abajo(justo - h - sesgo)), ask = r4(arriba(justo + h - sesgo));
  if (libro && libro.ba != null) bid = r4(Math.min(bid, abajo(libro.ba - tick)));
  if (libro && libro.bb != null) ask = r4(Math.max(ask, arriba(libro.bb + tick)));
  if (ask - bid < tick - 1e-9) ask = r4(bid + tick);
  const q = cfg.size;
  const bidOk = bid >= cfg.precio_min && (m.inv0 || 0) < cfg.inv_max && efectivo >= q * bid;
  const askOk = ask <= cfg.precio_max && (m.inv0 || 0) > -cfg.inv_max && efectivo >= q * (1 - ask);
  if (!bidOk && !askOk) return null;
  return { bid: bidOk ? bid : null, ask: askOk ? ask : null, size: q, justo: r4(justo), bb: libro ? libro.bb : null, ba: libro ? libro.ba : null, desde: new Date(ahora).toISOString() };
}

// ── LOS CRUCES DEL INTERVALO, EN COORDENADAS DEL OUTCOME 0 ──────────────────────────────────────────────
async function trades(cond, limit = 200) {
  const j = await jfetch(`${DATA}/trades?market=${encodeURIComponent(cond)}&limit=${limit}`);
  if (!Array.isArray(j)) return null;
  return j.filter((t) => !t.conditionId || t.conditionId === cond).map((t) => {
    const idx = Number(t.outcomeIndex);
    const p = Number(t.price), s = Number(t.size);
    if (!(idx === 0 || idx === 1) || !(p > 0 && p < 1) || !(s > 0)) return null;
    const lado = String(t.side || '').toUpperCase();
    return { ts: Number(t.timestamp) * 1000, precio0: idx === 0 ? p : 1 - p, lado0: idx === 0 ? lado : (lado === 'BUY' ? 'SELL' : 'BUY'), size: s, precio_bruto: p, idx };
  }).filter(Boolean).sort((a, b) => a.ts - b.ts);
}

// El mejor bid y el mejor ask del token del outcome 0, tal como están en el CLOB ahora mismo.
async function libroDe(token) {
  const j = await jfetch(`${CLOB}/book?token_id=${encodeURIComponent(token)}`);
  if (!j || !Array.isArray(j.bids) || !Array.isArray(j.asks)) return null;
  const bb = j.bids.map((x) => +x.price).filter((x) => x > 0 && x < 1).sort((a, b) => b - a)[0];
  const ba = j.asks.map((x) => +x.price).filter((x) => x > 0 && x < 1).sort((a, b) => a - b)[0];
  return { bb: bb != null ? r4(bb) : null, ba: ba != null ? r4(ba) : null, mid: bb != null && ba != null ? r4((bb + ba) / 2) : null };
}
// EL JUSTO: el consenso sharp mezclado con el medio del propio libro (peso_libro). El precio de Polymarket lleva
// información (medido: fútbol·No del consenso contra PM rinde +0,2 % en 129, o sea, PM acierta tanto como las
// casas), y un maker que ignora su propio libro cotiza de lado cada vez que los dos discrepan. Si discrepan de
// más, uno de los dos está rancio o roto y no se cotiza: ese es el riesgo del maker, no su negocio.
function justoDe(consenso, libro, cfg) {
  if (!libro || libro.mid == null) return { justo: consenso, discrepancia_pp: null };
  const d = Math.abs(consenso - libro.mid) * 100;
  if (d > cfg.discrepancia_pp) return { justo: null, discrepancia_pp: r2(d) };
  return { justo: r4((1 - cfg.peso_libro) * consenso + cfg.peso_libro * libro.mid), discrepancia_pp: r2(d) };
}

// Llena la cotización VIGENTE con los cruces del intervalo. Devuelve lo llenado; muta el mercado.
function llena(m, q, lista, cfg, ahoraMs) {
  const out = { compras: 0, ventas: 0, q_compra: 0, q_venta: 0 };
  if (!q) return out;
  let remBid = q.bid != null ? q.size : 0, remAsk = q.ask != null ? q.size : 0;
  const desde = Date.parse(q.desde || 0);
  for (const t of lista) {
    if (!(t.ts > desde) || !(t.ts > (m.ultimo_ts || 0)) || t.ts > ahoraMs + 60e3) continue;
    if (t.lado0 === 'SELL' && remBid > 0 && t.precio0 <= q.bid + 1e-9) {
      const exacto = Math.abs(t.precio0 - q.bid) < 1e-9;
      const qty = Math.min(remBid, t.size * (exacto ? 0.5 : 1));
      if (qty >= 1) { registra(m, 'compra', qty, q.bid, q.justo, t, cfg); remBid -= qty; out.compras++; out.q_compra += qty; }
    } else if (t.lado0 === 'BUY' && remAsk > 0 && t.precio0 >= q.ask - 1e-9) {
      const exacto = Math.abs(t.precio0 - q.ask) < 1e-9;
      const qty = Math.min(remAsk, t.size * (exacto ? 0.5 : 1));
      if (qty >= 1) { registra(m, 'venta', qty, q.ask, q.justo, t, cfg); remAsk -= qty; out.ventas++; out.q_venta += qty; }
    }
  }
  if (lista.length) m.ultimo_ts = Math.max(m.ultimo_ts || 0, lista[lista.length - 1].ts);
  return out;
}
function registra(m, lado, qty, precio, justo, t, cfg) {
  const q = Math.floor(qty * 100) / 100;
  aplicaFill(m, lado, q, precio);
  m.n_fills = (m.n_fills || 0) + 1;
  m.nocional = r2((m.nocional || 0) + q * precio);
  m[lado === 'compra' ? 'q_compras' : 'q_ventas'] = r2((m[lado === 'compra' ? 'q_compras' : 'q_ventas'] || 0) + q);
  // la horquilla cobrada frente al justo en el momento de cotizar: lo que un maker gana ANTES de que el precio se mueva
  m.horquilla_usd = r4((m.horquilla_usd || 0) + q * (lado === 'compra' ? (justo - precio) : (precio - justo)));
  // el rebate que la casa paga al maker sobre la comisión del taker: potencial, no P&L (depende del reparto)
  const comTaker = COM.comisionPolymarket({ shares: q, precio: t.precio_bruto, tasa: m.fee_rate, exponente: m.fee_exp });
  m.rebate_potencial = r4((m.rebate_potencial || 0) + comTaker * (m.fee_rebate || 0));
  m.fills = m.fills || [];
  m.fills.push({ at: new Date(t.ts).toISOString(), lado, q, precio, justo, cruce: r4(t.precio0), markout_30: null });
  if (m.fills.length > 100) m.fills = m.fills.slice(-100);
}

// El markout: ¿dónde está el justo 30 minutos después de cada fill? Compra a 0,48 con el justo en 0,50 y 30 min
// después el justo está en 0,45: nos llenaron porque alguien sabía algo (−0,03 por share). Es la selección
// adversa medida en dinero, y es el número que decide si esto vale.
function markouts(m, justo, ahoraMs) {
  for (const f of m.fills || []) {
    if (f.markout_30 != null) continue;
    if (ahoraMs - Date.parse(f.at) < 30 * 60e3) continue;
    f.markout_30 = r4((f.lado === 'compra' ? (justo - f.precio) : (f.precio - justo)) * f.q);
    m.markout_usd = r4((m.markout_usd || 0) + f.markout_30);
    m.markout_n = (m.markout_n || 0) + 1;
  }
}

async function recompensasDe(cond) {
  const j = await jfetch(`${CLOB}/markets/${encodeURIComponent(cond)}`);
  const rw = j && j.rewards ? j.rewards : null;
  const tasa = rw && Array.isArray(rw.rates) ? rw.rates.reduce((a, r) => a + (Number(r.rewards_daily_rate) || 0), 0) : 0;
  return { tasa_diaria: r2(tasa), min_size: rw ? Number(rw.min_size) || null : null, max_spread: rw ? Number(rw.max_spread) || null : null,
    maker_fee: j ? j.maker_base_fee : null, taker_fee: j ? j.taker_base_fee : null, leido_at: new Date().toISOString() };
}

// el consenso base de un cotizable: Shin cuando existe y es una probabilidad; si no, el consenso del escáner
const justoBase = (c) => (c.shin0 > 0 && c.shin0 < 1 ? c.shin0 : c.consenso0);
// Por qué un mercado del universo no entra en la cotización (null = entra). El orden es el de la regla.
function porQueNo(c, cfg = CFG(), ahora = Date.now()) {
  if (cfg.deportes_fuera.has(String(c.deporte || '').toLowerCase())) return 'deporte_fuera';
  const h = (Date.parse(c.ko || 0) - ahora) / 3600e3;
  if (!(h > cfg.h_min)) return 'saque_pasado_o_inminente';
  if (h > cfg.h_max) return 'saque_lejano';
  const justo = justoBase(c);
  if (!(justo >= cfg.precio_min && justo <= cfg.precio_max)) return 'precio_fuera_de_banda';
  if (c.liquidez != null && c.liquidez < cfg.liq_min) return 'liquidez_baja';
  if ((ahora - Date.parse(c.at || 0)) > cfg.frescura_min * 60e3) return 'consenso_rancio';
  return null;
}

// ── LA PASADA ───────────────────────────────────────────────────────────────────────────────────────────
async function barrer({ ahora = Date.now() } = {}) {
  const cfg = CFG();
  const st = rd();
  if (!st.desde) st.desde = new Date(ahora).toISOString();
  const out = { at: new Date(ahora).toISOString(), elegibles: 0, cotizando: 0, nuevos: 0, retirados: 0, fills: 0, compras: 0, ventas: 0, sin_trades: 0, rancios: 0, sin_cupo: 0 };
  const cot = {};
  for (const c of COT.todos()) cot[c.cond] = c;
  const efectivo0 = efectivoDe(st);

  // 1) los mercados elegibles hoy: ventana de saque, banda de precio, liquidez, consenso fresco, deporte dentro
  const elegibles = Object.values(cot).filter((c) => !porQueNo(c, cfg, ahora)).sort((a, b) => Date.parse(a.ko) - Date.parse(b.ko));
  out.elegibles = elegibles.length;
  // por qué NO entra el resto: es la diferencia entre "no hay mercados" y "los hay pero no caben en la regla"
  out.no_elegibles = {};
  for (const c of Object.values(cot)) { const q = porQueNo(c, cfg, ahora); if (q) out.no_elegibles[q] = (out.no_elegibles[q] || 0) + 1; }

  // 2) primero lo que ya estaba cotizando: se llena la cotización vigente con los cruces del intervalo
  let toques = 0;
  for (const m of Object.values(st.mercados)) {
    if (m.estado !== 'COTIZANDO') continue;
    const c = cot[m.cond];
    const ko = Date.parse(m.ko || 0);
    const hRestantes = (ko - ahora) / 3600e3;
    const justoNuevo = c ? (justoBase(c)) : m.justo;
    // sin cupo de llamadas en esta pasada: la cotización sigue reposando tal cual y se mira en la siguiente
    if (m.cotizacion && toques >= cfg.mercados_max) { out.sin_cupo++; continue; }
    let lista = null;
    if (m.cotizacion) {
      toques++;
      lista = await trades(m.cond);
      if (lista == null) out.sin_trades++;
      else {
        const f = llena(m, m.cotizacion, lista, cfg, ahora);
        out.fills += f.compras + f.ventas; out.compras += f.compras; out.ventas += f.ventas;
      }
      await dormir(60);
      // minutos cotizados y minutos dentro del perímetro de recompensas, con la cotización que acaba de vencer
      const mins = Math.min(60, Math.max(0, (ahora - Date.parse(m.cotizacion.desde)) / 60e3));
      m.minutos_cotizados = r2((m.minutos_cotizados || 0) + mins);
      const rw = m.rewards || {};
      const dosLados = m.cotizacion.bid != null && m.cotizacion.ask != null;
      const dentro = rw.max_spread != null && dosLados && (m.cotizacion.ask - m.cotizacion.bid) * 100 / 2 <= rw.max_spread + 1e-9
        && (rw.min_size == null || m.cotizacion.size >= rw.min_size);
      if (dentro) m.minutos_elegibles = r2((m.minutos_elegibles || 0) + mins);
    }
    // 3) ¿se sigue cotizando? retirada a h_min del saque o si el mercado salió del universo; pausa si el consenso es rancio
    if (!(hRestantes > cfg.h_min) || (!c && !(hRestantes > 0))) {
      m.estado = 'RETIRADA'; m.cotizacion = null; m.retirada_at = new Date(ahora).toISOString(); out.retirados++;
      continue;
    }
    const rancio = !c || (ahora - Date.parse(c.at || 0)) > cfg.frescura_min * 60e3;
    if (rancio) { m.cotizacion = null; m.motivo = 'consenso_rancio'; out.rancios++; continue; }
    // el justo de AHORA (consenso fresco mezclado con el libro de ahora): contra él se mide el markout de los
    // fills de hace 30 min, y sobre él se pone la cotización nueva
    const lb = await libroDe(m.tokens[0]);
    const jz = justoDe(justoNuevo, lb, cfg);
    m.discrepancia_pp = jz.discrepancia_pp;
    const justoAhora = jz.justo != null ? jz.justo : justoNuevo;
    markouts(m, justoAhora, ahora);
    m.justo = r4(justoAhora);
    if (jz.justo == null) { m.cotizacion = null; m.motivo = 'discrepancia'; out.discrepantes = (out.discrepantes || 0) + 1; continue; }
    m.cotizacion = cotiza(m, jz.justo, efectivoDe(st), cfg, ahora, lb);
    m.motivo = m.cotizacion ? null : 'sin_lado_cotizable';
    if (m.cotizacion) out.cotizando++;
  }

  // 4) los nuevos: nacen con su cotización; se llenan a partir de la pasada siguiente
  for (const c of elegibles) {
    if (st.mercados[c.cond]) continue;
    if (toques >= cfg.mercados_max) { out.sin_cupo++; continue; }
    const justo = justoBase(c);
    const m = { cond: c.cond, mid: c.mid, deporte: c.deporte, familia: c.familia, evento: c.evento, competicion: c.competicion || null,
      pregunta: c.pregunta, outs: c.outs, tokens: c.tokens, lado0: c.lado0 || null, ko: c.ko, tick: c.tick || 0.01,
      fee_rate: c.fee_rate, fee_exp: c.fee_exp, fee_rebate: c.fee_rebate,
      rewards: { tasa_diaria: 0, min_size: c.rewards_min_size, max_spread: c.rewards_max_spread, leido_at: null },
      s0: 0, s1: 0, inv0: 0, caja: 0, n_fills: 0, nocional: 0, q_compras: 0, q_ventas: 0, horquilla_usd: 0, markout_usd: 0, markout_n: 0,
      rebate_potencial: 0, minutos_cotizados: 0, minutos_elegibles: 0, fills: [], ultimo_ts: ahora,
      justo: r4(justo), estado: 'COTIZANDO', nacido_at: new Date(ahora).toISOString() };
    toques++;
    try { m.rewards = { ...m.rewards, ...(await recompensasDe(c.cond)) }; } catch { /* sin recompensas leídas: tope 0 */ }
    await dormir(60);
    const lb = await libroDe(c.tokens[0]);
    const jz = justoDe(justo, lb, cfg);
    m.discrepancia_pp = jz.discrepancia_pp;
    if (jz.justo == null) { m.cotizacion = null; m.motivo = 'discrepancia'; out.discrepantes = (out.discrepantes || 0) + 1; }
    else { m.justo = r4(jz.justo); m.cotizacion = cotiza(m, jz.justo, efectivoDe(st), cfg, ahora, lb); m.motivo = m.cotizacion ? null : 'sin_lado_cotizable'; }
    st.mercados[c.cond] = m;
    out.nuevos++;
    if (m.cotizacion) out.cotizando++;
  }

  st.pasadas = (st.pasadas || 0) + 1;
  st.efectivo = efectivoDe(st);
  st.efectivo_antes = efectivo0;
  st.at = new Date(ahora).toISOString();
  st.ultima = out;
  wr(st);
  return out;
}

// ── LA LIQUIDACIÓN: con la resolución del propio Polymarket ─────────────────────────────────────────────
async function mercadoDe(mid) {
  const j = await jfetch(`${GAMMA}/markets/${encodeURIComponent(mid)}`);
  if (j && !Array.isArray(j) && j.id) return j;
  const l = await jfetch(`${GAMMA}/markets?id=${encodeURIComponent(mid)}&closed=true`);
  return Array.isArray(l) ? (l[0] || null) : null;
}
async function liquidar({ ahora = Date.now() } = {}) {
  const st = rd();
  const out = { resueltos: 0, esperando: 0, sin_mercado: 0, anulados: 0, podados: 0 };
  let toques = 0;
  for (const m of Object.values(st.mercados)) {
    if (m.estado !== 'RETIRADA') continue;
    if (!(Date.parse(m.ko || 0) < ahora - 30 * 60e3)) { out.esperando++; continue; }
    if (toques >= 25) { out.esperando++; continue; }
    toques++;
    const g = m.mid ? await mercadoDe(m.mid) : null;
    if (!g) { out.sin_mercado++; continue; }
    const precios = (() => { try { return JSON.parse(g.outcomePrices || '[]').map(Number); } catch { return []; } })();
    const winIdx = precios.findIndex((x) => x >= 0.99);
    if (!g.closed || winIdx < 0) {
      // un mercado cerrado sin ganador 7 días después del saque se da por anulado: cada share vale 0,5
      if (g.closed && Date.parse(m.ko) < ahora - 7 * 864e5) { cierra(st, m, null, ahora); out.anulados++; }
      else out.esperando++;
      continue;
    }
    cierra(st, m, winIdx, ahora);
    out.resueltos++;
  }
  // poda: los resueltos viven 3 días más en `mercados` (para verlos con sus fills) y después solo en `cerrados`
  for (const [k, m] of Object.entries(st.mercados)) {
    if (m.estado === 'RESUELTO' && Date.parse(m.resuelto_at || 0) < ahora - 3 * 864e5) { delete st.mercados[k]; out.podados++; }
  }
  if (st.cerrados.length > 5000) st.cerrados = st.cerrados.slice(-5000);
  if (out.resueltos || out.anulados || out.podados) { st.efectivo = efectivoDe(st); st.at = new Date(ahora).toISOString(); wr(st); }
  return out;
}
function cierra(st, m, winIdx, ahora) {
  const pago = winIdx == null ? 0.5 * ((m.s0 || 0) + (m.s1 || 0)) : (winIdx === 0 ? (m.s0 || 0) : (m.s1 || 0));
  m.pnl = r2((m.caja || 0) + pago);
  m.ganador_idx = winIdx;
  m.estado = 'RESUELTO';
  m.resuelto_at = new Date(ahora).toISOString();
  st.cerrados.push({ cond: m.cond, deporte: m.deporte, familia: m.familia, evento: m.evento, competicion: m.competicion || null, ko: m.ko,
    n_fills: m.n_fills || 0, nocional: m.nocional || 0, q_compras: m.q_compras || 0, q_ventas: m.q_ventas || 0, inv0_final: m.inv0 || 0,
    horquilla_usd: m.horquilla_usd || 0, markout_usd: m.markout_usd || 0, markout_n: m.markout_n || 0, pnl: m.pnl, ganador_idx: winIdx,
    minutos_cotizados: m.minutos_cotizados || 0, minutos_elegibles: m.minutos_elegibles || 0,
    tope_recompensa_usd: r2(((m.rewards && m.rewards.tasa_diaria) || 0) * (m.minutos_elegibles || 0) / 1440),
    rebate_potencial: m.rebate_potencial || 0, resuelto_at: m.resuelto_at });
}

// ── EL ESTADO: lo que se revisa cada lunes ──────────────────────────────────────────────────────────────
function agrupa(lista, clave) {
  const g = {};
  for (const c of lista) { const k = clave(c); if (k == null) continue; (g[k] = g[k] || []).push(c); }
  return Object.entries(g).map(([k, v]) => {
    const pnl = v.reduce((a, c) => a + (c.pnl || 0), 0), noc = v.reduce((a, c) => a + (c.nocional || 0), 0);
    const conFill = v.filter((c) => (c.nocional || 0) > 0);
    const r = conFill.map((c) => c.pnl / c.nocional);
    const me = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
    const sd = r.length > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - me) ** 2, 0) / (r.length - 1)) : null;
    return { k, mercados: v.length, con_fills: conFill.length, fills: v.reduce((a, c) => a + (c.n_fills || 0), 0),
      nocional: r2(noc), pnl: r2(pnl), roi_pct: noc > 0 ? r2(100 * pnl / noc) : null,
      t: sd && r.length > 1 ? r2(me / (sd / Math.sqrt(r.length))) : null,
      horquilla_usd: r2(v.reduce((a, c) => a + (c.horquilla_usd || 0), 0)), markout_usd: r2(v.reduce((a, c) => a + (c.markout_usd || 0), 0)),
      tope_recompensa_usd: r2(v.reduce((a, c) => a + (c.tope_recompensa_usd || 0), 0)), rebate_potencial: r2(v.reduce((a, c) => a + (c.rebate_potencial || 0), 0)) };
  }).sort((a, b) => b.mercados - a.mercados);
}
function estado() {
  const st = rd();
  const cfg = CFG();
  const ms = Object.values(st.mercados || {});
  const vivos = ms.filter((m) => m.estado !== 'RESUELTO');
  const marcado = r2(vivos.reduce((a, m) => a + (m.caja || 0) + (m.s0 || 0) * (m.justo || 0) + (m.s1 || 0) * (1 - (m.justo || 0)), 0));
  const cerr = st.cerrados || [];
  const tot = agrupa(cerr, () => 'total')[0] || null;
  return {
    regla: REGLA, desde: st.desde, at: st.at, pasadas: st.pasadas || 0, banco_inicial: st.banco_inicial, efectivo: st.efectivo,
    reglas: { medio_spread_pp: cfg.spread_pp, size_por_lado: cfg.size, inventario_max: cfg.inv_max, ventana_h: `${cfg.h_min}-${cfg.h_max}`,
      precio: `${cfg.precio_min}-${cfg.precio_max}`, liquidez_min: cfg.liq_min, frescura_min: cfg.frescura_min, mercados_max_por_pasada: cfg.mercados_max,
      peso_libro: cfg.peso_libro, discrepancia_max_pp: cfg.discrepancia_pp, nunca_cruza_el_libro: true, deportes_fuera: [...cfg.deportes_fuera], fill: 'cruce real por debajo del bid (o por encima del ask) llena entero; al precio exacto, la mitad; contra la cotización vigente del intervalo anterior',
      no_cuenta: 'ni recompensas de liquidez ni rebate del maker: se publican como tope aparte' },
    universo: COT.estado(),
    vivos: { mercados: vivos.length, cotizando: vivos.filter((m) => m.estado === 'COTIZANDO' && m.cotizacion).length,
      pausados: vivos.filter((m) => m.estado === 'COTIZANDO' && !m.cotizacion).length, retirados_sin_resolver: vivos.filter((m) => m.estado === 'RETIRADA').length,
      fills: vivos.reduce((a, m) => a + (m.n_fills || 0), 0), nocional: r2(vivos.reduce((a, m) => a + (m.nocional || 0), 0)),
      inventario_abs: r2(vivos.reduce((a, m) => a + Math.abs(m.inv0 || 0), 0)), pnl_marcado_al_justo: marcado,
      horquilla_usd: r2(vivos.reduce((a, m) => a + (m.horquilla_usd || 0), 0)), markout_usd: r2(vivos.reduce((a, m) => a + (m.markout_usd || 0), 0)) },
    cerrados: tot ? { ...tot, k: undefined } : { mercados: 0, fills: 0, pnl: 0 },
    por_deporte: agrupa(cerr, (c) => c.deporte || '?'),
    por_familia: agrupa(cerr, (c) => `${c.deporte || '?'} · ${c.familia || '?'}`),
    ultima_pasada: st.ultima || null,
    ultimos: ms.sort((a, b) => String(b.nacido_at).localeCompare(String(a.nacido_at))).slice(0, 15)
      .map((m) => ({ deporte: m.deporte, evento: m.evento, pregunta: (m.pregunta || '').slice(0, 60), ko: m.ko, estado: m.estado, motivo: m.motivo || null,
        justo: m.justo, bid: m.cotizacion ? m.cotizacion.bid : null, ask: m.cotizacion ? m.cotizacion.ask : null, inv0: m.inv0, fills: m.n_fills,
        nocional: m.nocional, caja: m.caja, markout: m.markout_usd, pnl: m.pnl != null ? m.pnl : null })),
  };
}
function reset() {
  const st = { regla: REGLA, desde: new Date().toISOString(), reset_at: new Date().toISOString(), banco_inicial: CFG().banco, mercados: {}, cerrados: [], pasadas: 0, at: new Date().toISOString() };
  wr(st);
  return { ok: true, banco: st.banco_inicial };
}
// el universo cotizable con el motivo por el que cada mercado entra o no (para la revisión del lunes)
function universo() {
  const cfg = CFG(), ahora = Date.now();
  return COT.todos().map((c) => ({ deporte: c.deporte, familia: c.familia, evento: c.evento, pregunta: (c.pregunta || '').slice(0, 70), ko: c.ko,
    consenso0: c.consenso0, shin0: c.shin0, liquidez: c.liquidez, fee_rate: c.fee_rate, fee_rebate: c.fee_rebate, rewards_min_size: c.rewards_min_size,
    rewards_max_spread: c.rewards_max_spread, at: c.at, motivo: porQueNo(c, cfg, ahora) || 'elegible' }))
    .sort((a, b) => String(a.ko).localeCompare(String(b.ko)));
}
function libro() { const st = rd(); return { regla: REGLA, desde: st.desde, at: st.at, banco_inicial: st.banco_inicial, efectivo: st.efectivo, mercados: Object.values(st.mercados || {}), cerrados: st.cerrados || [] }; }

module.exports = { barrer, liquidar, estado, reset, libro, universo, porQueNo, cotiza, llena, aplicaFill, justoDe, CFG, DIR, FNAME, REGLA };
