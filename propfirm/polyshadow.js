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
const RIESGO = () => +(process.env.GP_POLYSOMBRA_RIESGO || 100);   // el mismo $100/posición de la firm
const CLOB = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

function rd() {
  try { return JSON.parse(fs.readFileSync(F, 'utf8')); }
  catch { return { banco_inicial: BANCO(), efectivo: BANCO(), posiciones: {}, at: null }; }
}
function wr(st) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(F, JSON.stringify(st)); }
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
  const j = await jfetch(`${GAMMA}/markets?id=${mid}`);
  const m = Array.isArray(j) ? j[0] : null;
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
    const presupuesto = Math.min(RIESGO(), st.efectivo);
    const fill = asks ? simulaFill(asks, lim, presupuesto) : null;
    if (fill && fill.shares >= 1 && fill.costo > 0) {
      st.posiciones[s.id] = {
        senal_id: s.id, token, outcome_idx: idx, pm_mid: mid,
        deporte: s.deporte || s.game, evento: s.evento, mercado: s.mercado, lado: s.lado, equipo: s.equipo,
        ko: s.ko, precio_senal: s.precio_pm, limite: lim, consenso: s.consenso, edge_pp: s.edge_pp,
        shares: fill.shares, costo: fill.costo, precio_fill: fill.precio_medio,
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
async function liquidarPoly() {
  const st = rd();
  const ahora = Date.now();
  const pend = Object.values(st.posiciones).filter((p) => p.estado === 'ABIERTA'
    && p.pm_mid && Date.parse(p.ko || 0) < ahora - 30 * 60e3);
  const out = { settled: 0, esperando: 0 };
  let toques = 0;
  for (const p of pend) {
    if (toques >= 15) { out.esperando++; continue; }
    toques++;
    const j = await jfetch(`${GAMMA}/markets?id=${p.pm_mid}`);
    const m = Array.isArray(j) ? j[0] : null;
    if (!m) { out.esperando++; continue; }
    const precios = (() => { try { return JSON.parse(m.outcomePrices || '[]').map(Number); } catch { return []; } })();
    // resuelto = el mercado cerró y un outcome vale ~1. Antes de eso, la posición sigue viva.
    const winIdx = precios.findIndex((x) => x >= 0.99);
    if (!m.closed || winIdx < 0) { out.esperando++; continue; }
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
    at: st.at, banco_inicial: st.banco_inicial, efectivo: st.efectivo,
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

module.exports = { sincronizar, liquidarPoly, estado, DIR };
