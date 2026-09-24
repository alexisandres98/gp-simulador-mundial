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
// LA COMISIÓN (15-sep-2026, hallazgo A09 de la auditoría externa). Hasta hoy esta sombra no descontaba lo
// que Polymarket cobra al taker, y su rendimiento estaba inflado por esa cantidad exacta. Camina asks: es
// taker SIEMPRE, en todos los fills, sin excepción. La fórmula y el porqué del defecto están en
// `lib/comisiones.js` y la verificación contra la casa en `docs/CONTRATOS_CASA.md`.
//
// DOCTRINA: separado por completo del ledger de la firm y de las sombras de las casas. Ningún dinero real.
'use strict';
const fs = require('fs');
const path = require('path');
const COM = require('../lib/comisiones');

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
  const pos = Object.values(st.posiciones || {});
  const pnl = pos.reduce((a, p) => a + (p.pnl || 0), 0);
  // La comisión de las ABIERTAS ya salió de la caja aunque su P&L todavía no exista. Si no se resta aquí,
  // Kelly dimensiona contra un banco que no está — que es la forma silenciosa de apostar de más.
  const comAbiertas = pos.filter((p) => p.estado === 'ABIERTA').reduce((a, p) => a + (p.comision || 0), 0);
  return +((st.banco_inicial || BANCO()) + pnl - comAbiertas).toFixed(2);
}
function stakeDe(st, s, consenso = null) {
  const banco = bancoVivo(st);
  // La cuota que importa para Kelly es la que se cobra DESPUÉS de la casa: comprar a p con comisión c por
  // acción cuesta p+c y sigue pagando 1. Con la cuota bruta, Kelly apuesta más de lo que la ventaja real
  // aguanta, y eso es exactamente lo que la fracción está para evitar.
  const cShare = COM.comisionPorShare(s.precio_pm, s.fee_rate, s.fee_exp);
  const coste = s.precio_pm > 0 ? s.precio_pm + cShare : 0;
  const odds = coste > 0 ? 1 / coste : 0;
  const f = kellyDe(consenso != null ? consenso : s.consenso, odds);
  // `f || STAKE_PCT()` es la fórmula EXACTA del sombra de Cloudbet, conservada a propósito
  const stk = Math.min(STAKE_PCT(), f || STAKE_PCT()) * banco;
  return Math.min(STAKE_MAX(), Math.max(STAKE_MIN(), Math.round(stk * 100) / 100));
}
const CLOB = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

// Lectura/escritura a prueba de pérdida (4-sep-2026): una lectura FALLIDA no puede guardarse como
// almacén vacío encima del bueno, que es como desapareció el track de esports. Ver lib/jsonstore.js.
const JS = require('../lib/jsonstore');
// DOS LIBROS (24-sep, orden de Alexis): `v1` es la sombra de siempre, congelada como control; `v2` es la
// regla nueva (`propfirm/v2.js`: Shin, listón neto, perímetro de precio/hora/familia y deportes nuevos).
// Cada libro tiene su archivo y su banco; comparten las señales y el código de fill y liquidación.
const V2 = require('./v2');
const LIBROS = { v1: { fname: 'poly-sombra.json', regla: 'pm_v1' }, v2: { fname: 'poly-sombra-v2.json', regla: 'pm_v2' } };
const libroDe = (l) => LIBROS[l] || LIBROS.v1;
const FNAME = LIBROS.v1.fname;
function rd(libro = 'v1') { return JS.readJson(DIR, libroDe(libro).fname, 'polyshadow') || { banco_inicial: BANCO(), efectivo: BANCO(), posiciones: {}, at: null, regla: libroDe(libro).regla }; }
function wr(st, libro = 'v1') { return JS.writeJson(DIR, libroDe(libro).fname, st, 'polyshadow'); }
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
//
// EL PRESUPUESTO INCLUYE LA COMISIÓN (15-sep). Cada acción sale del banco por su precio MÁS lo que la casa
// cobra por cruzarla; gastar el presupuesto entero en acciones y pagar la comisión aparte sería sacar del
// banco más de lo que el stake autoriza, y con el suelo de 5 USD eso se nota.
function simulaFill(asks, limite, presupuesto, tasa, exponente) {
  let costo = 0, shares = 0, comision = 0;
  for (const a of asks || []) {
    if (limite != null && a.price > limite) break;   // orden límite: jamás por encima
    const cShare = COM.comisionPorShare(a.price, tasa, exponente);
    const unit = a.price + cShare;
    const resto = presupuesto - costo - comision;
    if (resto < unit) break;                         // ni una share más
    const take = Math.min(a.size, resto / unit);
    shares += take; costo += take * a.price; comision += take * cShare;
  }
  const mejorAsk = asks && asks.length ? asks[0].price : null;
  const sh = Math.floor(shares);
  if (sh < 1) return { shares: 0, costo: 0, comision: 0, precio_medio: null, mejor_ask: mejorAsk };
  const pm = costo / shares;                         // precio medio del fill real
  return { shares: sh, costo: +(sh * pm).toFixed(2),
    comision: COM.comisionPolymarket({ shares: sh, precio: pm, tasa, exponente }),
    precio_medio: +pm.toFixed(4), mejor_ask: mejorAsk };
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
async function sincronizar(libro = 'v1') {
  const esV2 = libro === 'v2';
  const st = rd(libro);
  if (esV2 && !st.desde) { st.desde = new Date().toISOString(); st.regla = libroDe(libro).regla; }
  const sen = senales();
  const ahora = Date.now();
  const out = { libro, abiertas: 0, sin_fill: 0, sin_token: 0, revisadas: 0, ev_tras_comision: 0, comision_usd: 0, esperando: 0, fuera_de_banda: 0 };
  let toques = 0;                                            // máx llamadas al CLOB por pasada: educados
  for (const s of Object.values(sen)) {
    if (s.estado !== 'ABIERTA' || s.tipo === 'modelo_sombra') continue;   // solo lo operable de la firm
    // el reparto entre libros (24-sep): la v1 no ve lo que nació solo para la v2; la v2 no ve lo que está
    // fuera de su perímetro de familias. Lo demás lo ven las dos y cada una decide con su regla.
    if (!esV2 && s.solo_v2) continue;
    if (esV2 && !V2.familiaOk(s)) continue;
    const ko = Date.parse(s.ko || 0);
    const pos = st.posiciones[s.id];
    // una tesis frenada por la comisión se vuelve a mirar en la siguiente pasada: el libro se mueve y la
    // misma señal puede volverse rentable a un precio mejor. Solo 'SIN_FILL' y ella reintentan (y en la
    // v2, también las que esperan la ventana de 2 h o quedaron fuera de la banda de precio).
    const reintenta = new Set(['SIN_FILL', 'EV_TRAS_COMISION', ...(esV2 ? ['ESPERA', 'FUERA_DE_BANDA'] : [])]);
    if (pos && !reintenta.has(pos.estado)) continue;
    if (!(ko > ahora)) {
      // sin fill y el partido empezó: la ventana se cerró — eso también es una medición
      if (pos && (pos.estado === 'SIN_FILL' || pos.estado === 'ESPERA' || pos.estado === 'FUERA_DE_BANDA')) { pos.estado = 'NO_ENTRO'; pos.cerrado_at = new Date().toISOString(); }
      continue;
    }
    // LA VENTANA DE 2 H (v2, regla 3): a más de 2 h del saque la señal espera sin tocar el libro. Lo medido
    // en la v1: entrar a más de 2 h perdió −12 % en 175; a menos de 1 h ganó. Esperar es la regla, no un
    // fallo, y se anota como estado propio para que el "no entró" de después tenga su porqué.
    if (esV2) {
      const pre = V2.evaluar(s, { ahora, precio: s.precio_pm });
      if (pre.motivo === 'temprano') {
        if (!pos || pos.estado !== 'ESPERA') st.posiciones[s.id] = { ...(pos || {}), senal_id: s.id, deporte: s.deporte || s.game, evento: s.evento, mercado: s.mercado, lado: s.lado, ko: s.ko, familia: s.familia, nivel: s.nivel || null, estado: 'ESPERA', horas_al_saque: pre.horas, at: (pos && pos.at) || new Date().toISOString(), libro, regla: libroDe(libro).regla };
        out.esperando++;
        continue;
      }
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
    // la v2 compra contra SU consenso (Shin en fútbol) y nunca por encima de su banda de precio
    const consLibro = esV2 ? V2.consensoV2(s) : s.consenso;
    const lim = esV2 ? Math.min(V2.PRECIO_MAX(), +(consLibro - 0.01).toFixed(2)) : (s.limite != null ? s.limite : s.precio_pm);
    const stakeObj = stakeDe(st, s, consLibro);
    const presupuesto = Math.min(stakeObj, st.efectivo);
    const fill = asks ? simulaFill(asks, lim, presupuesto, s.fee_rate, s.fee_exp) : null;
    // LA PUERTA NUEVA (15-sep, A09): la ventaja se mide DESPUÉS de la casa, y contra el precio del fill —no
    // contra el del aviso—, porque caminar el libro ya se comió parte de ella. Una tesis que cruza el listón
    // en bruto y no lo cruza neto no es una oportunidad pequeña: es una pérdida esperada, y hasta hoy abría
    // posición igual. Se anota como medición, no se descarta en silencio.
    const evNeto = fill && fill.shares >= 1 && consLibro != null
      ? COM.evNetoPorShare({ prob: consLibro, precio: fill.precio_medio, tasa: s.fee_rate, exponente: s.fee_exp })
      : null;
    // EN LA v2 EL LISTÓN ES NETO Y CON SUELO (regla 2): consenso − fill − comisión ≥ 3 pp, y el fill dentro de
    // la banda 0,40-0,70. Lo que no cruza se anota con su motivo y se vuelve a mirar en la pasada siguiente.
    const ev2 = esV2 && fill && fill.shares >= 1 ? V2.evaluar(s, { ahora, precio: fill.precio_medio, esFill: true }) : null;
    const frenaV1 = !esV2 && fill && fill.shares >= 1 && evNeto != null && !(evNeto > 0);
    const frenaV2 = esV2 && ev2 && !ev2.ok;
    if (frenaV1 || frenaV2) {
      const estado = frenaV2 && ev2.motivo === 'precio' ? 'FUERA_DE_BANDA' : 'EV_TRAS_COMISION';
      st.posiciones[s.id] = { ...(pos || {}), senal_id: s.id, token, outcome_idx: idx, pm_mid: mid,
        deporte: s.deporte || s.game, evento: s.evento, mercado: s.mercado, lado: s.lado, ko: s.ko, familia: s.familia, nivel: s.nivel || null,
        precio_senal: s.precio_pm, limite: lim, consenso: consLibro, edge_pp: s.edge_pp,
        precio_fill_simulado: fill.precio_medio, ev_neto_por_share: evNeto != null ? +evNeto.toFixed(4) : null,
        ...(ev2 ? { edge_neto_pp: ev2.edge_neto_pp, motivo_v2: ev2.motivo, horas_al_saque: ev2.horas } : {}),
        estado, at: (pos && pos.at) || new Date().toISOString(),
        cerrado_at: new Date().toISOString(), libro, regla: libroDe(libro).regla };
      if (estado === 'FUERA_DE_BANDA') out.fuera_de_banda++; else out.ev_tras_comision++;
      continue;
    }
    if (fill && fill.shares >= 1 && fill.costo > 0) {
      st.posiciones[s.id] = {
        senal_id: s.id, token, outcome_idx: idx, pm_mid: mid, libro, regla: libroDe(libro).regla,
        deporte: s.deporte || s.game, evento: s.evento, mercado: s.mercado, lado: s.lado, equipo: s.equipo,
        familia: s.familia || null, nivel: s.nivel || null, competicion: s.competicion || s.torneo || s.liga || null,
        ko: s.ko, precio_senal: s.precio_pm, limite: lim, consenso: consLibro, edge_pp: s.edge_pp,
        ...(esV2 ? { consenso_v1: s.consenso, edge_neto_pp: ev2 ? ev2.edge_neto_pp : null, horas_al_saque: ev2 ? ev2.horas : null } : {}),
        stake_objetivo: stakeObj, shares: fill.shares, costo: fill.costo, precio_fill: fill.precio_medio,
        // la comisión se guarda POR POSICIÓN con la tasa que se le aplicó: sin eso, un cambio de tarifa
        // reescribe el pasado la próxima vez que alguien recalcule el track
        comision: fill.comision, tasa_comision: s.fee_rate != null ? s.fee_rate : COM.tasaPorDefecto(),
        costo_total: +(fill.costo + fill.comision).toFixed(2),
        ev_neto_por_share: evNeto != null ? +evNeto.toFixed(4) : null,
        slippage_pp: +((fill.precio_medio - s.precio_pm) * 100).toFixed(2),
        estado: 'ABIERTA', at: new Date().toISOString(),
      };
      st.efectivo = +(st.efectivo - fill.costo - fill.comision).toFixed(2);
      out.comision_usd = +(out.comision_usd + fill.comision).toFixed(2);
      out.abiertas++;
    } else {
      st.posiciones[s.id] = { ...(pos || {}), senal_id: s.id, token, outcome_idx: idx, pm_mid: mid,
        deporte: s.deporte || s.game, evento: s.evento, mercado: s.mercado, lado: s.lado, ko: s.ko, familia: s.familia, nivel: s.nivel || null,
        precio_senal: s.precio_pm, limite: lim, estado: 'SIN_FILL',
        mejor_ask: fill ? fill.mejor_ask : null, intentos: ((pos && pos.intentos) || 0) + 1,
        at: (pos && pos.at) || new Date().toISOString(), ultimo_intento: new Date().toISOString(), libro, regla: libroDe(libro).regla };
      out.sin_fill++;
    }
  }
  st.at = new Date().toISOString();
  wr(st, libro);
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
async function liquidarPoly(libro = 'v1') {
  const st = rd(libro);
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
    // Cada share ganadora paga $1. La comisión se pagó al ENTRAR (la fórmula vale 0 en p=1 y p=0, así que
    // el vencimiento no vuelve a cobrar), pero es dinero que salió: resta en los dos lados. Se guarda
    // también el bruto para poder publicar el antes y el después sin recalcular nada.
    const com = p.comision || 0;
    p.pnl_bruto = gana ? +(p.shares - p.costo).toFixed(2) : -p.costo;
    p.pnl = +(p.pnl_bruto - com).toFixed(2);
    if (gana) st.efectivo = +(st.efectivo + p.shares).toFixed(2);
    out.settled++;
  }
  if (out.settled) { st.at = new Date().toISOString(); wr(st, libro); }
  return out;
}

// ── ESTADO: lo que se revisa cada lunes ──────────────────────────────────────────────────────────────────
// ── EL DESGLOSE (13-sep) ────────────────────────────────────────────────────────────────────────────────
// `estado()` daba un ROI único de todo el banco, y ese número mezcla cosas que no se parecen: fútbol "No",
// esports, totales y NFL comparten banco pero no comparten comportamiento. Decidir el tamaño de una apuesta
// real con el ROI agregado es decidir con el promedio de familias que no vas a apostar.
//
// Además de por familia se parte por TRAMO DE VENTAJA, porque ahí está el hallazgo incómodo que ya salió una
// vez y hay que poder volver a mirar: la ventaja grande rinde PEOR que la pequeña, que es lo contrario de lo
// que debería pasar si el modelo supiera lo que dice saber.
function agrupa(cerradas, clave) {
  const g = {};
  for (const p of cerradas) {
    const k = clave(p); if (k == null) continue;
    (g[k] = g[k] || []).push(p);
  }
  return Object.entries(g).map(([k, v]) => {
    const costo = v.reduce((a, p) => a + (p.costo || 0), 0);
    const pnl = v.reduce((a, p) => a + (p.pnl || 0), 0);
    // el bruto viaja al lado del neto en cada corte: es la única forma de ver de un vistazo cuánto de lo
    // que parecía ventaja se lo llevaba la casa, familia por familia
    const com = v.reduce((a, p) => a + (p.comision || 0), 0);
    const pnlBruto = v.reduce((a, p) => a + (p.pnl_bruto != null ? p.pnl_bruto : (p.pnl || 0) + (p.comision || 0)), 0);
    const w = v.filter((p) => p.estado === 'WIN').length;
    const sl = v.filter((p) => p.slippage_pp != null).map((p) => p.slippage_pp);
    const pr = v.map((p) => p.precio_fill).filter((x) => x > 0).sort((a, b) => a - b);
    // t del ROI: el P&L de cada posición normalizado por su coste, que es el rendimiento por dólar puesto
    const r = v.filter((p) => p.costo > 0).map((p) => (p.pnl || 0) / p.costo);
    const m = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
    const sd = r.length > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)) : null;
    return { k, n: v.length, w, l: v.length - w, costo: +costo.toFixed(2), pnl: +pnl.toFixed(2),
      comision: +com.toFixed(2), pnl_bruto: +pnlBruto.toFixed(2),
      roi_pct: costo > 0 ? +(100 * pnl / costo).toFixed(2) : null,
      roi_bruto_pct: costo > 0 ? +(100 * pnlBruto / costo).toFixed(2) : null,
      t_roi: (sd && r.length > 1) ? +(m / (sd / Math.sqrt(r.length))).toFixed(2) : null,
      slippage_medio_pp: sl.length ? +(sl.reduce((a, b) => a + b, 0) / sl.length).toFixed(2) : null,
      precio_mediano: pr.length ? pr[pr.length >> 1] : null,
      stake_medio: v.length ? +(costo / v.length).toFixed(2) : null };
  }).sort((a, b) => b.n - a.n);
}
const BANDA = (e) => (e == null ? null : e < 3 ? '0-3pp' : e < 5 ? '3-5pp' : e < 8 ? '5-8pp' : '8pp+');
const esFutbolNo = (p) => (p.deporte === 'futbol' || /^Will .+ win on /i.test(String(p.mercado || ''))) && String(p.lado || '').toLowerCase() === 'no';

function estado() {
  const st = rd();
  const pos = Object.values(st.posiciones);
  const abiertas = pos.filter((p) => p.estado === 'ABIERTA');
  const cerradas = pos.filter((p) => p.estado === 'WIN' || p.estado === 'LOSS');
  const conFill = pos.filter((p) => p.slippage_pp != null);
  const pnl = +cerradas.reduce((a, p) => a + (p.pnl || 0), 0).toFixed(2);
  const pnlBruto = +cerradas.reduce((a, p) => a + (p.pnl_bruto != null ? p.pnl_bruto : (p.pnl || 0) + (p.comision || 0)), 0).toFixed(2);
  const comCerradas = +cerradas.reduce((a, p) => a + (p.comision || 0), 0).toFixed(2);
  const comTodas = +pos.reduce((a, p) => a + (p.comision || 0), 0).toFixed(2);
  const expuesto = +abiertas.reduce((a, p) => a + (p.costo || 0), 0).toFixed(2);
  const fn = cerradas.filter(esFutbolNo);
  const desglose = {
    por_deporte_y_lado: agrupa(cerradas, (p) => `${p.deporte || (/^Will .+ win on /i.test(String(p.mercado || '')) ? 'futbol' : '?')} · ${p.lado || '?'}`),
    futbol_no: agrupa(fn, () => 'futbol · No')[0] || null,
    futbol_no_por_banda: agrupa(fn, (p) => BANDA(p.edge_pp)),
    futbol_no_por_precio: agrupa(fn, (p) => { const x = p.precio_fill; return x == null ? null
      : x < 0.2 ? 'precio <0,20' : x < 0.35 ? '0,20-0,35' : x < 0.5 ? '0,35-0,50' : x < 0.65 ? '0,50-0,65' : '0,65+'; }),
    // lo que NO entró también se mide: una señal que no encuentra libro es capacidad que no existe
    no_entro_futbol_no: pos.filter((p) => p.estado === 'NO_ENTRO' && esFutbolNo(p)).length,
  };
  return {
    desglose,
    at: st.at, banco_inicial: st.banco_inicial, banco_vivo: bancoVivo(st), efectivo: st.efectivo,
    expuesto, equity: +(st.efectivo + expuesto).toFixed(2),
    abiertas: abiertas.length,
    w: cerradas.filter((p) => p.estado === 'WIN').length,
    l: cerradas.filter((p) => p.estado === 'LOSS').length,
    pnl_usd: pnl,
    roi_pct: cerradas.length ? +(100 * pnl / cerradas.reduce((a, p) => a + p.costo, 0)).toFixed(2) : null,
    // EL ANTES Y EL DESPUÉS, SIEMPRE JUNTOS (15-sep, A09): `pnl_usd` y `roi_pct` ya van netos de comisión;
    // el bruto se publica al lado para que nadie compare un número nuevo contra uno viejo sin darse cuenta.
    pnl_bruto_usd: pnlBruto,
    roi_bruto_pct: cerradas.length ? +(100 * pnlBruto / cerradas.reduce((a, p) => a + p.costo, 0)).toFixed(2) : null,
    comisiones_usd: comCerradas,
    comisiones_usd_todas: comTodas,
    tasa_comision: COM.tasaPorDefecto(),
    ev_tras_comision: pos.filter((p) => p.estado === 'EV_TRAS_COMISION').length,
    slippage_medio_pp: conFill.length ? +(conFill.reduce((a, p) => a + p.slippage_pp, 0) / conFill.length).toFixed(2) : null,
    sin_fill: pos.filter((p) => p.estado === 'SIN_FILL').length,
    no_entro: pos.filter((p) => p.estado === 'NO_ENTRO').length,
    sin_token: pos.filter((p) => p.estado === 'SIN_TOKEN').length,
    ultimas: pos.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15)
      .map((p) => ({ evento: p.evento, mercado: (p.mercado || '').slice(0, 60), lado: p.lado, estado: p.estado,
        senal: p.precio_senal, fill: p.precio_fill || null, shares: p.shares || null, pnl: p.pnl != null ? p.pnl : null })),
    // EL LIBRO v2 AL LADO, NUNCA MEZCLADO (24-sep): se lee por deporte y por familia porque es una regla
    // distinta y, en tenis/Valorant/Dota 2, un deporte que la v1 nunca vio.
    v2: estadoV2(),
  };
}

function estadoV2() {
  const st = rd('v2');
  const pos = Object.values(st.posiciones || {});
  const abiertas = pos.filter((p) => p.estado === 'ABIERTA');
  const cerradas = pos.filter((p) => p.estado === 'WIN' || p.estado === 'LOSS');
  const pnl = +cerradas.reduce((a, p) => a + (p.pnl || 0), 0).toFixed(2);
  const costo = cerradas.reduce((a, p) => a + (p.costo || 0), 0);
  const cnt = (e) => pos.filter((p) => p.estado === e).length;
  return {
    regla: 'pm_v2', desde: st.desde || null, at: st.at,
    reglas: { consenso: 'Shin por casa en fútbol; el de la señal en el resto', precio: `${V2.PRECIO_MIN()}-${V2.PRECIO_MAX()}`, horas_max_al_saque: V2.HORAS_MAX(), edge_neto_min_pp: V2.EDGE_NETO_MIN_PP(), slippage_esperado_pp: V2.SLIP_ESPERADO_PP(),
      familias: 'fútbol No (no empate) · CS2 mapa/serie tier 1-2 · Valorant y Dota 2 mapa/serie · tenis ML · NFL/NCAAF ML' },
    banco_inicial: st.banco_inicial, banco_vivo: bancoVivo(st), efectivo: st.efectivo,
    expuesto: +abiertas.reduce((a, p) => a + (p.costo || 0), 0).toFixed(2),
    abiertas: abiertas.length, w: cerradas.filter((p) => p.estado === 'WIN').length, l: cerradas.filter((p) => p.estado === 'LOSS').length,
    pnl_usd: pnl, roi_pct: costo > 0 ? +(100 * pnl / costo).toFixed(2) : null,
    esperando: cnt('ESPERA'), sin_fill: cnt('SIN_FILL'), no_entro: cnt('NO_ENTRO'), ev_tras_comision: cnt('EV_TRAS_COMISION'), fuera_de_banda: cnt('FUERA_DE_BANDA'), sin_token: cnt('SIN_TOKEN'),
    por_deporte: agrupa(cerradas, (p) => p.deporte || '?'),
    por_deporte_y_familia: agrupa(cerradas, (p) => `${p.deporte || '?'} · ${p.familia || '?'}${p.nivel ? ' · ' + p.nivel : ''}`),
    por_precio: agrupa(cerradas, (p) => { const x = p.precio_fill; return x == null ? null : x < 0.5 ? '0,40-0,50' : x < 0.6 ? '0,50-0,60' : '0,60-0,70'; }),
    ultimas: pos.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15)
      .map((p) => ({ deporte: p.deporte, evento: p.evento, mercado: (p.mercado || '').slice(0, 60), lado: p.lado, estado: p.estado, motivo: p.motivo_v2 || null,
        senal: p.precio_senal, fill: p.precio_fill || null, edge_neto_pp: p.edge_neto_pp != null ? p.edge_neto_pp : null, horas: p.horas_al_saque != null ? p.horas_al_saque : null, pnl: p.pnl != null ? p.pnl : null })),
  };
}

// ── ¿PODEMOS SIQUIERA OPERAR DESDE AQUÍ? (13-sep) ───────────────────────────────────────────────────────
// Antes de construir un ejecutor hay que saber si el servidor puede enviar una orden, y eso NO se deduce de
// que las lecturas funcionen: Polymarket bloquea el TRADING por región y deja la lectura abierta. Nuestra
// sombra lleva desde el 1-sep leyendo libros sin problema, y eso no dice absolutamente nada sobre si podría
// colocar. Render corre en Oregón (EE. UU.), que es justo la región bloqueada.
//
// La sonda manda un POST vacío y sin firma a /order: no puede colocar nada —no lleva orden, ni firma, ni
// credenciales— y lo único que se mira es el código y el mensaje. 403 con "Trading restricted" significa que
// el ejecutor no puede vivir en este servidor, por muy bien que esté escrito.
async function sondaGeo() {
  const out = { at: new Date().toISOString() };
  try {
    const r = await fetch(`${CLOB}/markets`, { signal: AbortSignal.timeout(12000) });
    out.lectura = { status: r.status, ok: r.ok };
  } catch (e) { out.lectura = { error: e.message }; }
  try {
    const r = await fetch(`${CLOB}/order`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(12000) });
    const t = await r.text().catch(() => '');
    out.trading = { status: r.status, cuerpo: t.slice(0, 300) };
    out.bloqueado_por_region = /restricted in your region|geoblock/i.test(t);
  } catch (e) { out.trading = { error: e.message }; }
  try {
    const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) });
    out.ip_de_salida = (await r.text().catch(() => '')).trim();
  } catch { out.ip_de_salida = null; }
  out.lectura_dice = out.lectura && out.lectura.ok ? 'las lecturas funcionan' : 'ni siquiera lee';
  out.veredicto = out.bloqueado_por_region
    ? 'NO se puede operar desde este servidor: el trading está bloqueado por región aunque la lectura funcione. Un ejecutor aquí no colocaría ni una orden.'
    : (out.trading && out.trading.status === 403 ? 'prohibido por otra razón (mira el cuerpo)' : 'el trading NO está bloqueado por región desde esta IP');
  return out;
}

// borrón y cuenta nueva (solo por orden humana): el experimento nace de cero con las reglas vigentes
function reset(libro = 'v1') {
  const st = { banco_inicial: BANCO(), efectivo: BANCO(), posiciones: {}, at: new Date().toISOString(), reset_at: new Date().toISOString(), regla: libroDe(libro).regla, desde: new Date().toISOString() };
  wr(st, libro);
  return { ok: true, libro, banco: st.banco_inicial };
}

// exportación completa de posiciones (3-sep, solo lectura): para el desglose por familia/mercado
function posiciones(libro = 'v1') { const st = rd(libro); return { libro, regla: st.regla || libroDe(libro).regla, banco_inicial: st.banco_inicial, efectivo: st.efectivo, at: st.at, posiciones: Object.values(st.posiciones || {}) }; }
module.exports = { sincronizar, liquidarPoly, estado, estadoV2, reset, posiciones, sondaGeo, DIR, LIBROS };
