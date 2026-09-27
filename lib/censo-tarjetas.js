'use strict';
// lib/censo-tarjetas.js — EL CENSO DE COBERTURA DEL MERCADO DE TARJETAS (27-sep-2026, orden de Alexis).
//
// POR QUÉ EXISTE. Tarjetas under es la única familia con signo positivo en todo el sistema, y la pregunta de
// negocio es cuánto volumen cabe. Hasta hoy lo deducíamos de las picks que nacían, y eso mezcla tres cosas:
// si la casa publica el mercado, si nuestro modelo tiene datos de esa liga y si la señal pasó la regla. Este
// módulo mide SOLO la primera, que es la que no controlamos: ¿qué competiciones tienen mercado de tarjetas
// en Cloudbet y en Pinnacle, y con qué máximo?
//
// CÓMO MIDE. Cada hora mira los partidos cuyo saque cae entre 35 y 95 minutos después de ahora —a esa
// distancia el mercado de tarjetas ya está abierto en todas las ligas donde existe (medido: Liga MX lo
// abre ~90 min antes; las grandes, días antes)— y anota, por competición y por casa, cuántos partidos vio y
// en cuántos había mercado. Un partido visto sin mercado a 35-95 min del saque ES un partido sin mercado.
// Cloudbet: fixtures del día (sin filtro de liga: aquí entran también femenino, juvenil y divisiones bajas, que
// es justo lo que queremos saber) + un GET por evento en ventana, tope 60 por pasada.
// Pinnacle: un solo GET del catálogo de fútbol (guest API); los hijos con `units: 'Bookings'` son el mercado
// de tarjetas del padre. Para los que tienen, un GET de mercados para leer líneas, precios y el límite que
// la casa publica (`limits.maxRiskStake`), tope 40 por pasada.
//
// QUÉ NO HACE. No genera picks, no toca la sombra ni el ejecutor. Es un instrumento de medida y su salida
// es la sonda `/api/internal/censo-tarjetas`. Se apaga con GP_CENSO_TARJETAS=0.

const fs = require('fs');
const path = require('path');

const CB_HOST = 'https://sports-api.cloudbet.com';
const PIN_HOST = 'https://guest.api.arcadia.pinnacle.com/0.1';
const PIN_SPORT_SOCCER = 29;
const PIN_GUEST_KEY = () => process.env.PINNACLE_GUEST_KEY || 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R';
const VENTANA_MIN = 35, VENTANA_MAX = 95;   // minutos hasta el saque
const TOPE_CB = 60, TOPE_PIN = 40;
const MAX_EJEMPLOS = 20;

const amToDec = (am) => (am == null ? null : am > 0 ? 1 + am / 100 : 1 + 100 / Math.abs(am));
const FEMENINO = /women|femen|frauen|feminin|ladies|\bwsl\b|nwsl/i;
const JUVENIL = /u1[6789]\b|u2[0-3]\b|youth|juvenil|primavera|reserve|-ii\b|\bii\b|amateur|regional|sub-?2/i;

function archivo(dir) { return path.join(dir, 'censo-tarjetas.json'); }
function cargar(dir) {
  try { return JSON.parse(fs.readFileSync(archivo(dir), 'utf8')); } catch { return { started: new Date().toISOString(), runs: 0, cloudbet: {}, pinnacle: {}, ultimo: null }; }
}
function guardar(dir, d) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ya existe */ }
  const tmp = archivo(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, archivo(dir));
}

async function getJson(url, headers, timeoutMs = 20000) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function anotar(bucket, key, { name, cat, con, max, ej, evento }) {
  const b = bucket[key] || (bucket[key] = { name: name || key, cat: cat || null, vistos: 0, con_tarjetas: 0, maximos: [], ejemplos: [], primero: new Date().toISOString(), ultimo: null, femenino: FEMENINO.test(key + ' ' + (name || '')), juvenil: JUVENIL.test(key + ' ' + (name || '')) });
  b.vistos++;
  if (con) {
    b.con_tarjetas++;
    if (Number.isFinite(max)) { b.maximos.push(Math.round(max)); if (b.maximos.length > MAX_EJEMPLOS) b.maximos.shift(); }
    if (ej) { b.ejemplos.push({ evento, ej, at: new Date().toISOString().slice(0, 16) }); if (b.ejemplos.length > 5) b.ejemplos.shift(); }
  }
  b.ultimo = new Date().toISOString();
}

// ── Cloudbet ─────────────────────────────────────────────────────────────────────────────────────────────
async function censarCloudbet(d, { apiKey, ahora }) {
  if (!apiKey) return { skipped: 'sin_api_key' };
  const H = { 'X-API-Key': apiKey };
  const lo = ahora + VENTANA_MIN * 60e3, hi = ahora + VENTANA_MAX * 60e3;
  const dias = new Set([new Date(lo).toISOString().slice(0, 10), new Date(hi).toISOString().slice(0, 10)]);
  const enVentana = [];
  for (const dia of dias) {
    const j = await getJson(`${CB_HOST}/pub/v2/odds/fixtures?sport=soccer&date=${dia}&limit=3000`, H).catch(() => null);
    for (const c of (j && j.competitions) || []) {
      for (const e of c.events || []) {
        const t = Date.parse(e.cutoffTime || '');
        if (!(t >= lo && t <= hi)) continue;
        if (e.status && !/TRADING/.test(e.status)) continue;
        enVentana.push({ id: e.id, name: e.name, key: c.key, comp: c.name, cat: (c.category && c.category.name) || null });
      }
    }
  }
  let vistos = 0, con = 0;
  for (const e of enVentana.slice(0, TOPE_CB)) {
    const j = await getJson(`${CB_HOST}/pub/v2/odds/events/${e.id}`, H).catch(() => null);
    if (!j) continue;
    const m = j.markets && j.markets['soccer.total_bookings'];
    let max = null, ej = null;
    if (m) {
      for (const sm of Object.values(m.submarkets || {})) for (const s of sm.selections || []) {
        if (s.outcome !== 'under') continue;
        if (max == null || Number(s.maxStake) > max) { max = Number(s.maxStake); ej = `under ${String(s.params || '').replace('total=', '')} @ ${s.price}`; }
      }
    }
    anotar(d.cloudbet, e.key, { name: e.comp, cat: e.cat, con: !!m, max, ej, evento: e.name });
    vistos++; if (m) con++;
  }
  return { en_ventana: enVentana.length, vistos, con_tarjetas: con, recortados: Math.max(0, enVentana.length - TOPE_CB) };
}

// ── Pinnacle (guest API) ─────────────────────────────────────────────────────────────────────────────────
async function censarPinnacle(d, { ahora }) {
  const H = { 'x-api-key': PIN_GUEST_KEY(), accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
  const mus = await getJson(`${PIN_HOST}/sports/${PIN_SPORT_SOCCER}/matchups`, H, 30000).catch(() => null);
  if (!Array.isArray(mus)) return { skipped: 'pinnacle_no_contesta' };
  const lo = ahora + VENTANA_MIN * 60e3, hi = ahora + VENTANA_MAX * 60e3;
  const padres = mus.filter((m) => m.type === 'matchup' && !m.parentId && m.units === 'Regular' && m.startTime && Date.parse(m.startTime) >= lo && Date.parse(m.startTime) <= hi && !m.isLive);
  const bookingsDe = new Map();
  for (const m of mus) if (m.parentId && m.units === 'Bookings' && m.type === 'matchup') bookingsDe.set(String(m.parentId), m);
  let vistos = 0, con = 0, leidos = 0;
  for (const p of padres) {
    const liga = (p.league && p.league.name) || '?';
    const home = (p.participants || []).find((x) => x.alignment === 'home'), away = (p.participants || []).find((x) => x.alignment === 'away');
    const evento = `${home ? home.name : '?'} v ${away ? away.name : '?'}`;
    const hijo = bookingsDe.get(String(p.id));
    let max = null, ej = null;
    if (hijo && leidos < TOPE_PIN) {
      leidos++;
      const mk = await getJson(`${PIN_HOST}/matchups/${hijo.id}/markets/straight`, H).catch(() => null);
      for (const m of Array.isArray(mk) ? mk : []) {
        if (m.type !== 'total' || m.period !== 0) continue;
        const u = (m.prices || []).find((x) => x.designation === 'under');
        const lim = (m.limits || []).find((l) => l.type === 'maxRiskStake');
        if (u && u.points != null && (max == null || (lim && lim.amount > max))) { max = lim ? Number(lim.amount) : max; ej = `under ${u.points} @ ${amToDec(u.price) != null ? amToDec(u.price).toFixed(2) : '?'}`; }
      }
    }
    anotar(d.pinnacle, liga, { name: liga, cat: null, con: !!hijo, max, ej, evento });
    vistos++; if (hijo) con++;
  }
  return { en_ventana: padres.length, vistos, con_tarjetas: con, catalogo: mus.length };
}

async function correr({ dir, apiKey }) {
  const d = cargar(dir);
  const ahora = Date.now();
  const out = { at: new Date(ahora).toISOString(), cloudbet: null, pinnacle: null };
  try { out.cloudbet = await censarCloudbet(d, { apiKey, ahora }); } catch (e) { out.cloudbet = { error: String(e.message || e).slice(0, 120) }; }
  try { out.pinnacle = await censarPinnacle(d, { ahora }); } catch (e) { out.pinnacle = { error: String(e.message || e).slice(0, 120) }; }
  d.runs = (d.runs || 0) + 1;
  d.ultimo = out;
  guardar(dir, d);
  return out;
}

const mediana = (a) => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// la sonda: por casa, competiciones ordenadas por partidos vistos, con cobertura y mediana del máximo
function resumen({ dir }) {
  const d = cargar(dir);
  const tabla = (bucket, casa) => Object.entries(bucket).map(([key, b]) => ({
    casa, key, nombre: b.name, vistos: b.vistos, con_tarjetas: b.con_tarjetas,
    cobertura_pct: b.vistos ? +(100 * b.con_tarjetas / b.vistos).toFixed(0) : null,
    max_mediana: mediana(b.maximos), femenino: !!b.femenino, juvenil: !!b.juvenil,
    ultimo: b.ultimo, ejemplo: (b.ejemplos || []).slice(-1)[0] || null,
  })).sort((a, b) => b.vistos - a.vistos);
  const cb = tabla(d.cloudbet, 'cloudbet'), pin = tabla(d.pinnacle, 'pinnacle');
  const agg = (rows) => ({ competiciones: rows.length, con_mercado: rows.filter((r) => r.con_tarjetas > 0).length,
    partidos_vistos: rows.reduce((a, r) => a + r.vistos, 0), partidos_con_tarjetas: rows.reduce((a, r) => a + r.con_tarjetas, 0),
    femenino: { competiciones: rows.filter((r) => r.femenino).length, con_mercado: rows.filter((r) => r.femenino && r.con_tarjetas > 0).length } });
  return { started: d.started, runs: d.runs, ultimo: d.ultimo, cloudbet: { ...agg(cb), competiciones_tabla: cb }, pinnacle: { ...agg(pin), competiciones_tabla: pin },
    lectura: 'Cada fila: partidos con saque a 35-95 min vistos por el censo y en cuántos había mercado de tarjetas. Cobertura < 100 % en una competición grande suele ser mercado abierto tarde; 0 % con muchos vistos es que la casa no lo publica.' };
}

module.exports = { correr, resumen, censarCloudbet, censarPinnacle, VENTANA_MIN, VENTANA_MAX };
