// propfirm/polyshadow.js — EL EJECUTOR EN LA SOMBRA DE POLYMARKET (1-sep, orden de Alexis)
//
// QUÉ ES. Un banco simulado de $2.000 "en Polymarket" donde se colocan TODAS las señales operables de la
// prop firm — las mismas que salen por correo para FundingPredicts — como si se ejecutaran por la API
// real del CLOB. La pregunta que responde en 2-3 semanas de lunes: ¿es rentable ejecutar esto DIRECTO en
// Polymarket con dinero propio? Si la respuesta es sí, se cablea la API de ejecución (órdenes firmadas
// EIP-712 con wallet propia — sin aprobación de nadie, a diferencia de Cloudbet) y se le mete dinero real.
//
// POR QUÉ ES MÁS HONESTA QUE UNA SOMBRA DE PRECIOS. La sombra de senales.json anota la tesis AL PRECIO DEL
// AVISO. Esta anota LO QUE DE VERDAD SE HABRÍA COMPRADO: una orden límite (el límite de la señal) que
// camina los asks del libro real del CLOB en el momento de la señal. El deslizamiento, la profundidad
// insuficiente y el "no había libro" quedan medidos — que es exactamente lo que separa una tesis rentable
// de una ejecución rentable (la lección del backtest al cierre de NBA: −7,27% donde el papel prometía).
//
// LIQUIDACIÓN POR EL PROPIO VENUE. Cada posición se resuelve con la resolución del MERCADO en gamma
// (outcomePrices → 1/0 al resolverse), no con nuestro liquidador: si ejecutáramos de verdad, Polymarket
// pagaría según SU resolución. Además esto cubre uniformemente fútbol y NFL, cuyas tesis hoy no liquidan
// en senales.json.
//
// DOCTRINA: separado por completo del ledger de la firm y de las sombras de las casas. Ningún dinero real.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_PROPFIRM_DIR || (fs.existsSync('/data') ? '/data/propfirm' : path.join(__dirname, '..', 'data', 'propfirm'));
const F = path.join(DIR, 'poly-sombra.json');
const SENALES = path.join(DIR, 'senales.json');
const BANCO = () => +(process.env.GP_POLYSOMBRA_BANCO || 2000);
// EL TAMAÑO NO ES EL DE LA FIRM (1-sep, corrección de Alexis): la firm tiene $10.000 y REGLAS (pérdida
// diaria, tope de posiciones, $100 planos); este banco es de $2.000 y Polymarket no tiene reglas. Se usa
// la MISMA estructura del ejecutor de Cloudbet: Kelly/4 con tope del 1,5% del banco VIVO (compone con el
// P&L realizado), suelo $5 y tope duro $45 — sin máximo de exposición ni de número de apuestas.
const STAKE_PCT = () => +(process.env.GP_POLYSOMBRA_STAKE_PCT || 1.5) / 100;
const STAKE_MIN = () => +(process.env.GP_POLYSOMBRA_STAKE_MIN || 5);
const STAKE_MAX = () => +(process.env.GP_POLYSOMBRA_STAKE_MAX || 45);
function kellyDe(prob, odds) {
  if (!(prob > 0 && prob < 1 && odds > 1)) return 0;
  const b = odds - 1;
  return Math.max(0, (b * prob - (1 - prob)) / b) / 4;   // Kelly/4, como en Cloudbet
}
function bancoVivo(st) {
  const pnl = Object.values(st.posiciones || {}).reduce((a, p) => a + (p.pnl || 0), 0);
  return +((st.banco_inicial || BANCO()) + pnl).toFixed(2);
}
function stakeDe(st, s) {
  const banco = bancoVivo(st);
  const odds = s.precio_pm > 0 ? 1 / s.precio_pm : 0;    // comprar a p paga 1/p por share
  const f = kellyDe(s.consenso, odds);
  // `f || STAKE_PCT()` es la fórmula EXACTA del sombra de Cloudbet, conservada a propósito
  const stk = Math.min(STAKE_PCT(), f || STAKE_PCT()) * banco;
  return Math.min(STAKE_MAX(), Math.max(STAKE_MIN(), Math.round(stk * 100) / 100));
}
const CLOB = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

// Lectura/escritura a prueba de pérdida (4-sep-2026): una lectura FALLIDA no puede guardarse como
// almacén vacío encima del bueno, que es como desapareció el track de esports. Ver lib/jsonstore.js.
const JS = require('../lib/jsonstore');
const FNAME = 'poly-sombra.json';
function rd() { return JS.readJson(DIR, FNAME, 'polyshadow') || { banco_inicial: BANCO(), efectivo: BANCO(), posiciones: {}, at: null }; }
function wr(st) { return JS.writeJson(DIR, FNAME, st, 'polyshadow'); }
function senales() { try { return JSON.parse(fs.readFileSync(SENALES, 'utf8')).senales || {}; } catch { return {}; } }
const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function jfetch(url, timeoutMs = 12000) {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
}

// el libro del token: asks ordenados de barato a caro. El CLOB devuelve {bids, asks} con {price, size}.
async function libro(token) {
  const j = await jfetch(`${CLOB}/book?token_id=${encodeURIComponent(token)}`);
  if (!j || !Array.isArray(j.asks)) return null;
  return j.asks.map((a) => ({ price: +a.price, size: +a.size }))
    .filter((a) => a.price > 0 && a.size > 0)
    .sort((a, b) => a.price - b.price);
}

// una orden LÍMITE simulada: compra asks con precio ≤ limite hasta agotar el presupuesto.
// Devuelve lo comprado y el mejor ask que había — el dato de capacidad cuando no se pudo comprar.
function simulaFill(asks, limite, presupuesto) {
  let costo = 0, shares = 0;
  for (const a of asks || []) {
    if (limite != null && a.price > limite) break;   // orden límite: jamás por encima
    const resto = presupuesto - costo;
    if (resto < a.price) break;                      // ni una share más
    const take = Math.min(a.size, resto / a.price);
    shares += take; costo += take * a.price;
  }
  const mejorAsk = asks && asks.length ? asks[0].price : null;
  const sh = Math.floor(shares);
  if (sh < 1) return { shares: 0, costo: 0, precio_medio: null, mejor_ask: mejorAsk };
  const pm = costo / shares;                         // precio medio del fill real
  return { shares: sh, costo: +(sh * pm).toFixed(2), precio_medio: +pm.toFixed(4), mejor_ask: mejorAsk };
}

// rescate del token para señales que nacieron sin él (las anteriores al 1-sep): el id de la señal empieza
// por el id del mercado de gamma; sus outcomes casan contra `equipo` (que ES el nombre del outcome).
async function rescate(s) {
  const mid = s.pm_mid || String(s.id || '').split('|')[0];
  if (!/^\d+$/.test(mid)) return null;
  const m = await mercadoDe(mid); // recurso individual: también devuelve mercados ya cerrados
  if (!m) return null;
  const outs = (() => { try { return JSON.parse(m.outcomes || '[]'); } catch { return []; } })();
  const tks = (() => { try { return JSON.parse(m.clobTokenIds || '[]'); } catch { return []; } })();
  const eq = nrm(String(s.equipo || '').split('—')[0]);
  let idx = outs.findIndex((o) => nrm(o) === eq);
  if (idx < 0) idx = outs.findIndex((o) => eq.startsWith(nrm(o)) || nrm(o).startsWith(eq));
  if (idx < 0) return null;
  return { token: tks[idx] || null, outcome_idx: idx, pm_mid: mid };
}

// ── ABRIR: colocar en la sombra lo que la firm está avisando ─────────────────────────────────────────────
async function sincronizar() {
  const st = rd();
  const sen = senales();
  const ahora = Date.now();
  const out = { abiertas: 0, sin_fill: 0, sin_token: 0, revisadas: 0 };
  let toques = 0;                                            // máx llamadas al CLOB por pasada: educados
  for (const s of Object.values(sen)) {
    if (s.estado !== 'ABIERTA' || s.tipo === 'modelo_sombra') continue;   // solo lo operable de la firm
    const ko = Date.parse(s.ko || 0);
    const pos = st.posiciones[s.id];
    if (pos && pos.estado !== 'SIN_FILL') continue;          // ya está resuelta su entrada
    if (!(ko > ahora)) {
      // sin fill y el partido empezó: la ventana se cerró — eso también es una medición
      if (pos && pos.estado === 'SIN_FILL') { pos.estado = 'NO_ENTRO'; pos.cerrado_at = new Date().toISOString(); }
      continue;
    }
    if (toques >= 12) continue;
    out.revisadas++;
    let token = s.token, idx = s.outcome_idx, mid = s.pm_mid;
    if (!token) {
      toques++;
      const r = await rescate(s);
      if (r && r.token) { token = r.token; idx = r.outcome_idx; mid = r.pm_mid; }
      else {
        st.posiciones[s.id] = { ...(pos || {}), senal_id: s.id, estado: 'SIN_TOKEN', evento: s.evento, mercado: s.mercado, at: new Date().toISOString() };
        out.sin_token++;
        continue;
      }
    }
    toques++;
    const asks = await libro(token);
    // límite: el de la señal; el experimento modelo_sombra no llega aquí, y una señal sin límite (no
    // debería existir en operables) usa su propio precio de aviso como tope
    const lim = s.limite != null ? s.limite : s.precio_pm;
    const stakeObj = stakeDe(st, s);
    const presupuesto = Math.min(stakeObj, st.efectivo);
    const fill = asks ? simulaFill(asks, lim, presupuesto) : null;
    if (fill && fill.shares >= 1 && fill.costo > 0) {
      st.posiciones[s.id] = {
        senal_id: s.id, token, outcome_idx: idx, pm_mid: mid,
        deporte: s.deporte || s.game, evento: s.evento, mercado: s.mercado, lado: s.lado, equipo: s.equipo,
        ko: s.ko, precio_senal: s.precio_pm, limite: lim, consenso: s.consenso, edge_pp: s.edge_pp,
        stake_objetivo: stakeObj, shares: fill.shares, costo: fill.costo, precio_fill: fill.precio_medio,
        slippage_pp: +((fill.precio_medio - s.precio_pm) * 100).toFixed(2),
        estado: 'ABIERTA', at: new Date().toISOString(),
      };
      st.efectivo = +(st.efectivo - fill.costo).toFixed(2);
      out.abiertas++;
    } else {
      st.posiciones[s.id] = { ...(pos || {}), senal_id: s.id, token, outcome_idx: idx, pm_mid: mid,
        deporte: s.deporte || s.game, evento: s.evento, mercado: s.mercado, lado: s.lado, ko: s.ko,
        precio_senal: s.precio_pm, limite: lim, estado: 'SIN_FILL',
        mejor_ask: fill ? fill.mejor_ask : null, intentos: ((pos && pos.intentos) || 0) + 1,
        at: (pos && pos.at) || new Date().toISOString(), ultimo_intento: new Date().toISOString() };
      out.sin_fill++;
    }
  }
  st.at = new Date().toISOString();
  wr(st);
  return out;
}

// ── LIQUIDAR: con la resolución del propio Polymarket ────────────────────────────────────────────────────
// BUG DEL 1-3 SEP (encontrado por Alexis: "esas partidas se liquidan al terminar"): la lista de gamma
// `/markets?id=<id>` EXCLUYE los mercados cerrados por defecto (filtro closed=false implícito) → devolvía
// `[]` para todo mercado ya resuelto y las 61 posiciones pasadas quedaban en "esperando" para siempre.
// El recurso individual `/markets/<id>` sí devuelve el mercado cerrado con outcomePrices 1/0. Polymarket
// cierra los mercados de esports 1-3 h después del partido (comprobado el 3-sep con 3DMAX-Heroic, DEPO-LVG,
// FlyQuest-Kaleido). Se usa el recurso individual aquí y en `rescate`, y la salida dice por qué espera cada una.
async function mercadoDe(mid) {
  const j = await jfetch(`${GAMMA}/markets/${encodeURIComponent(mid)}`);
  if (j && !Array.isArray(j) && j.id) return j;
  const l = await jfetch(`${GAMMA}/markets?id=${encodeURIComponent(mid)}&closed=true`); // respaldo
  if (Array.isArray(l) && l[0]) return l[0];
  const l2 = await jfetch(`${GAMMA}/markets?id=${encodeURIComponent(mid)}`);
  return Array.isArray(l2) ? (l2[0] || null) : null;
}
const midDe = (p) => p.pm_mid || (/^\d+$/.test(String(p.senal_id || '').split('|')[0]) ? String(p.senal_id).split('|')[0] : null);
async function liquidarPoly() {
  const st = rd();
  const ahora = Date.now();
  const pend = Object.values(st.posiciones).filter((p) => p.estado === 'ABIERTA'
    && midDe(p) && Date.parse(p.ko || 0) < ahora - 30 * 60e3);
  const out = { settled: 0, esperando: 0, sin_cupo: 0, sin_mercado: 0, abierto_en_gamma: 0, sin_ganador: 0, pendientes: pend.length };
  let toques = 0;
  for (const p of pend) {
    if (toques >= 25) { out.esperando++; out.sin_cupo++; continue; }
    toques++;
    const m = await mercadoDe(midDe(p));
    if (!m) { out.esperando++; out.sin_mercado++; continue; }
    const precios = (() => { try { return JSON.parse(m.outcomePrices || '[]').map(Number); } catch { return []; } })();
    // resuelto = el mercado cerró y un outcome vale ~1. Antes de eso, la posición sigue viva.
    const winIdx = precios.findIndex((x) => x >= 0.99);
    if (!m.closed || winIdx < 0) { out.esperando++; if (!m.closed) out.abierto_en_gamma++; else out.sin_ganador++; continue; }
    const gana = winIdx === p.outcome_idx;
    p.estado = gana ? 'WIN' : 'LOSS';
    p.resuelto_at = new Date().toISOString();
    p.pnl = gana ? +(p.shares - p.costo).toFixed(2) : -p.costo;   // cada share ganadora paga $1
    if (gana) st.efectivo = +(st.efectivo + p.shares).toFixed(2);
    out.settled++;
  }
  if (out.settled) { st.at = new Date().toISOString(); wr(st); }
  return out;
}

// ── ESTADO: lo que se revisa cada lunes ──────────────────────────────────────────────────────────────────
function estado() {
  const st = rd();
  const pos = Object.values(st.posiciones);
  const abiertas = pos.filter((p) => p.estado === 'ABIERTA');
  const cerradas = pos.filter((p) => p.estado === 'WIN' || p.estado === 'LOSS');
  const conFill = pos.filter((p) => p.slippage_pp != null);
  const pnl = +cerradas.reduce((a, p) => a + (p.pnl || 0), 0).toFixed(2);
  const expuesto = +abiertas.reduce((a, p) => a + (p.costo || 0), 0).toFixed(2);
  return {
    at: st.at, banco_inicial: st.banco_inicial, banco_vivo: bancoVivo(st), efectivo: st.efectivo,
    expuesto, equity: +(st.efectivo + expuesto).toFixed(2),
    abiertas: abiertas.length,
    w: cerradas.filter((p) => p.estado === 'WIN').length,
    l: cerradas.filter((p) => p.estado === 'LOSS').length,
    pnl_usd: pnl,
    roi_pct: cerradas.length ? +(100 * pnl / cerradas.reduce((a, p) => a + p.costo, 0)).toFixed(2) : null,
    slippage_medio_pp: conFill.length ? +(conFill.reduce((a, p) => a + p.slippage_pp, 0) / conFill.length).toFixed(2) : null,
    sin_fill: pos.filter((p) => p.estado === 'SIN_FILL').length,
    no_entro: pos.filter((p) => p.estado === 'NO_ENTRO').length,
    sin_token: pos.filter((p) => p.estado === 'SIN_TOKEN').length,
    ultimas: pos.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15)
      .map((p) => ({ evento: p.evento, mercado: (p.mercado || '').slice(0, 60), lado: p.lado, estado: p.estado,
        senal: p.precio_senal, fill: p.precio_fill || null, shares: p.shares || null, pnl: p.pnl != null ? p.pnl : null })),
  };
}

// borrón y cuenta nueva (solo por orden humana): el experimento nace de cero con las reglas vigentes
function reset() {
  const st = { banco_inicial: BANCO(), efectivo: BANCO(), posiciones: {}, at: new Date().toISOString(), reset_at: new Date().toISOString() };
  wr(st);
  return { ok: true, banco: st.banco_inicial };
}

// exportación completa de posiciones (3-sep, solo lectura): para el desglose por familia/mercado
function posiciones() { const st = rd(); return { banco_inicial: st.banco_inicial, efectivo: st.efectivo, at: st.at, posiciones: Object.values(st.posiciones || {}) }; }
module.exports = { sincronizar, liquidarPoly, estado, reset, posiciones, DIR };
