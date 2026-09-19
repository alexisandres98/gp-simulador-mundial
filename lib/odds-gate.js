// lib/odds-gate.js — LA PUERTA ÚNICA DE THE ODDS API (19-sep, «plan de reserva»)
//
// ── POR QUÉ ────────────────────────────────────────────────────────────────────────────────────────────
// The Odds API se consume desde OCHO archivos y más de veinte sitios (server.js, nfl, amfoot, tenis, F1,
// combate, baloncesto, ops). Solo dos de esos sitios preguntaban al presupuesto antes de gastar; el resto
// gastaba a ciegas. Con el plan de 100k daba igual. El 19-sep la suscripción cayó (clave DESACTIVADA) y el
// plan al que se baja es el gratis: **500 créditos al mes**. Una sola pasada del barrido de baloncesto
// (5 regiones × 3 mercados × 3 deportes = 45 créditos cada 12 min) se comería el mes en una tarde.
//
// Arreglar veinte sitios uno a uno es la clase de cambio que deja alguno sin tocar. Aquí se hace en UN sitio:
// se envuelve `fetch` y toda llamada a `api.the-odds-api.com` pasa por esta puerta, esté donde esté.
//
// ── QUÉ HACE ───────────────────────────────────────────────────────────────────────────────────────────
//   1. CONTABILIDAD REAL: lee `x-requests-remaining` / `x-requests-used` / `x-requests-last` de CADA
//      respuesta (antes solo las leían algunos sitios) y las publica en `global._oddsCredits`, que es lo que
//      los guards viejos ya consultaban. Un solo contador para todos.
//   2. TOPE DIARIO (`SPORTSBOOK_DAILY_CREDITS`, 0 = sin tope): con 500 al mes tocan ~16 al día. Cuando el día
//      lleva gastado el tope, las llamadas que cuestan se contestan con un 429 sintético SIN salir a la red.
//      Los endpoints gratis (catálogo `/sports`, pre-check `/events`) pasan siempre: no cuestan.
//   3. RESERVA (`SPORTSBOOK_QUOTA_RESERVE`, la misma variable de siempre): por debajo del remanente de
//      reserva se bloquea todo lo que cuesta, no solo los dos sitios que ya lo hacían.
//   4. CLAVE MUERTA: un 401 con `DEACTIVATED_KEY` / `INVALID_KEY` apaga la puerta seis horas. Sin esto, veinte
//      sitios siguen llamando cada 12-30 min a una clave que la casa ya dijo que no existe.
//
// Lo bloqueado devuelve un `Response` de verdad (status 429, `ok: false`, cabecera `x-odds-gate: <motivo>`)
// porque todos los llamadores ya tratan un `!r.ok` como «este ciclo sin datos» — es exactamente lo que
// llevan haciendo con el 401 desde que cayó la clave.
//
// `SPORTSBOOK_GATE=off` desactiva la envoltura (queda el comportamiento anterior). Estado: `estado()`.
'use strict';

const HOST = 'api.the-odds-api.com';
const MUERTA_MS = 6 * 3600e3;

const S = {
  instalada: false, remaining: null, used: null, last: null, at: null,
  dia: null, gastado_hoy: 0, permitidas_hoy: 0, bloqueadas_hoy: 0, gratis_hoy: 0,
  por_motivo: {}, ultimo_bloqueo: null,
  clave_muerta_hasta: 0, clave_muerta_motivo: null,
};

const hoy = () => new Date().toISOString().slice(0, 10);
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const topeDiario = () => num(process.env.SPORTSBOOK_DAILY_CREDITS, 0);
const reserva = () => num(process.env.SPORTSBOOK_QUOTA_RESERVE, 2000);
const apagada = () => /^(0|false|no|off)$/i.test(String(process.env.SPORTSBOOK_GATE || '').trim());

function rotaDia() {
  const d = hoy();
  if (S.dia !== d) { S.dia = d; S.gastado_hoy = 0; S.permitidas_hoy = 0; S.bloqueadas_hoy = 0; S.gratis_hoy = 0; S.por_motivo = {}; }
}

// Lo que NO cuesta créditos según la documentación: el catálogo `/v4/sports/` y el pre-check `/v4/sports/{k}/events`.
// Todo lo demás (`/odds`, `/scores`, `/events/{id}/odds`) cuesta.
function esGratis(url) {
  const p = String(url).split('?')[0];
  if (/\/v4\/sports\/?$/.test(p)) return true;
  if (/\/v4\/sports\/[^/]+\/events\/?$/.test(p)) return true;
  return false;
}

// Coste estimado cuando la cabecera no llega (solo para el tope diario; la casa manda la cifra real después).
function costeEstimado(url) {
  try {
    const u = new URL(String(url));
    const regiones = (u.searchParams.get('regions') || 'us').split(',').filter(Boolean).length;
    const mercados = (u.searchParams.get('markets') || 'h2h').split(',').filter(Boolean).length;
    return Math.max(1, regiones * mercados);
  } catch { return 1; }
}

function bloquear(motivo, extra = {}) {
  rotaDia();
  S.bloqueadas_hoy++; S.por_motivo[motivo] = (S.por_motivo[motivo] || 0) + 1;
  S.ultimo_bloqueo = { at: new Date().toISOString(), motivo, ...extra };
  const body = JSON.stringify({ error: 'odds_gate', motivo, ...extra, remaining: S.remaining, gastado_hoy: S.gastado_hoy, tope_diario: topeDiario() });
  return new Response(body, { status: 429, headers: { 'content-type': 'application/json', 'x-odds-gate': motivo } });
}

function anotaCabeceras(r, url) {
  try {
    const rem = Number(r.headers.get('x-requests-remaining'));
    const used = Number(r.headers.get('x-requests-used'));
    const last = Number(r.headers.get('x-requests-last'));
    if (Number.isFinite(rem)) { S.remaining = rem; S.at = Date.now(); }
    if (Number.isFinite(used)) S.used = used;
    const coste = Number.isFinite(last) ? last : (esGratis(url) ? 0 : costeEstimado(url));
    S.last = coste;
    if (!esGratis(url)) S.gastado_hoy += coste;
    // el contador viejo que ya consultan los guards de server.js
    if (global._oddsCredits && Number.isFinite(rem)) { global._oddsCredits.remaining = rem; global._oddsCredits.at = Date.now(); }
  } catch { /* cabeceras ausentes */ }
}

async function marcaClaveMuerta(r) {
  if (r.status !== 401) return;
  let code = null;
  try { const j = await r.clone().json(); code = j && j.error_code; } catch { /* sin cuerpo */ }
  if (code === 'DEACTIVATED_KEY' || code === 'INVALID_KEY') {
    S.clave_muerta_hasta = Date.now() + MUERTA_MS; S.clave_muerta_motivo = code;
  }
}

function instalar({ fetchBase } = {}) {
  if (S.instalada) return S;
  const base = fetchBase || globalThis.fetch;
  if (typeof base !== 'function') return S;
  const envuelto = async function oddsGateFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (apagada() || !url.includes(HOST)) return base(input, init);
    rotaDia();
    const gratis = esGratis(url);
    if (!gratis) {
      if (S.clave_muerta_hasta > Date.now()) return bloquear('clave_desactivada', { hasta: new Date(S.clave_muerta_hasta).toISOString(), codigo: S.clave_muerta_motivo });
      const tope = topeDiario();
      if (tope > 0 && S.gastado_hoy >= tope) return bloquear('tope_diario', { gastado: S.gastado_hoy, tope });
      if (S.remaining != null && S.remaining < reserva()) return bloquear('reserva', { remaining: S.remaining, reserva: reserva() });
    }
    const r = await base(input, init);
    if (gratis) S.gratis_hoy++; else S.permitidas_hoy++;
    anotaCabeceras(r, url);
    await marcaClaveMuerta(r);
    return r;
  };
  globalThis.fetch = envuelto;
  S.instalada = true;
  return S;
}

function estado() {
  rotaDia();
  return { ...S, tope_diario: topeDiario(), reserva: reserva(), apagada: apagada(),
    clave_muerta: S.clave_muerta_hasta > Date.now() ? { hasta: new Date(S.clave_muerta_hasta).toISOString(), codigo: S.clave_muerta_motivo } : null,
    lectura: apagada() ? 'SPORTSBOOK_GATE=off: la puerta no bloquea nada.'
      : (S.clave_muerta_hasta > Date.now() ? `la clave está ${S.clave_muerta_motivo}: nada sale a la red hasta ${new Date(S.clave_muerta_hasta).toISOString()}.`
        : (topeDiario() > 0 ? `tope ${topeDiario()} créditos/día (${S.gastado_hoy} gastados hoy) y reserva ${reserva()}.` : `sin tope diario; reserva ${reserva()}.`)) };
}

// solo para pruebas
function _reset() { Object.assign(S, { instalada: false, remaining: null, used: null, last: null, at: null, dia: null, gastado_hoy: 0, permitidas_hoy: 0, bloqueadas_hoy: 0, gratis_hoy: 0, por_motivo: {}, ultimo_bloqueo: null, clave_muerta_hasta: 0, clave_muerta_motivo: null }); }

module.exports = { instalar, estado, esGratis, costeEstimado, HOST, _reset };
