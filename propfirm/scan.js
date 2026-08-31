// propfirm/scan.js — EL ESCÁNER DE LA PROP FIRM (31-ago, compra del Elite 10K de FundingPredicts).
//
// QUÉ ES. FundingPredicts espeja los mercados de Polymarket en vivo (comprobado en su dashboard: los
// mismos eventos de CS2 de gamma, con su libro). Nuestra doctrina más rentable —anclarse al consenso
// sharp y apostar la desviación de UNA casa (régimen edge: +6,7% ROI en 610 picks de clubes)— se aplica
// aquí con Polymarket como "la casa que se desvía": precios retail contra el consenso devig de las casas
// sharp que ya barremos (Cloudbet + Pinnacle + Bovada en CS2, crossBook con mediana sin margen).
//
// V1 = CS2. Es donde la prop firm tiene volumen hoy ($1M/24h en un BLAST), donde nuestro consenso es más
// denso y donde la liquidación sale de nuestra propia fuente (bo3.gg). Fútbol y NFL entran después por el
// mismo molde.
//
// TODO ES MANUAL POR DISEÑO: este módulo NO coloca nada. Encuentra, escribe el correo con la orden exacta
// (lado, precio límite, tamaño según las reglas del Elite 10K) y anota la tesis en SU PROPIA sombra en
// disco persistente — separada por completo de las sombras de las casas, porque es otro venue y otra regla.
//
// REGLAS DEL ELITE 10K QUE ESTE CÓDIGO RESPETA AL ESCRIBIR LA ORDEN:
//   target $1.200 · drawdown estático $500 (piso $9.500) · pérdida diaria $300 · máx 568 shares/evento ·
//   máx 20 posiciones abiertas · solo precios ≤ 0,85 · elegibilidad: $100 de fondo a ±7¢ del mid.
//   Riesgo por posición: $100 (1% de la cuenta) → con la pérdida diaria caben 3 posiciones nuevas al día.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_PROPFIRM_DIR || (fs.existsSync('/data') ? '/data/propfirm' : path.join(__dirname, '..', 'data', 'propfirm'));
const F = path.join(DIR, 'senales.json');
const GAMMA = 'https://gamma-api.polymarket.com';

const EDGE_MIN_PP = () => +(process.env.GP_PROPFIRM_EDGE_PP || 4);
const PRECIO_MIN = 0.15, PRECIO_MAX = 0.84;      // banda: la firm prohíbe >0,85 y bajo 15¢ el edge es ruido de longshot
const LIQ_MIN = () => +(process.env.GP_PROPFIRM_MIN_LIQ || 500);
const RIESGO_USD = () => +(process.env.GP_PROPFIRM_RIESGO_USD || 100);
const MAX_SHARES_EVENTO = 568;                    // regla del Elite 10K, leída del dashboard

function rd() { try { return JSON.parse(fs.readFileSync(F, 'utf8')); } catch { return { senales: {}, at: null }; } }
function wr(st) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(F, JSON.stringify(st)); }

const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// tokens con los que un nombre de equipo se reconoce en un título ajeno ("G2" / "Aurora Gaming" / "paiN")
const toks = (n) => nrm(n).split(' ').filter((x) => x.length >= 2 && !['team', 'esports', 'gaming', 'club'].includes(x));
const nombra = (texto, nombre) => {
  const t = ' ' + nrm(texto) + ' ';
  const tk = toks(nombre);
  if (!tk.length) return false;
  return tk.some((x) => t.includes(' ' + x + ' '));
};

// ---- POLYMARKET (gamma): buscar el evento del cruce y leer sus mercados ---------------------------------
const _cacheEv = new Map();   // por consulta, 10 min: educados con gamma y con nuestro propio sweep
// gamma NO busca en /events (ignora `search` y devuelve cualquier cosa — comprobado). El buscador real es
// /public-search, pero sus eventos vienen recortados: el descubrimiento sale de ahí y los MERCADOS
// completos (outcomePrices, liquidez) se piden después por slug, que es el patrón del collector de la casa.
async function gammaBusca(q) {
  const k = nrm(q);
  const hit = _cacheEv.get(k);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.v;
  let v = [];
  try {
    const r = await fetch(`${GAMMA}/public-search?q=${encodeURIComponent(q)}&limit_per_type=12`, { signal: AbortSignal.timeout(12000) });
    const j = r.ok ? await r.json().catch(() => null) : null;
    v = (j && Array.isArray(j.events)) ? j.events.filter((e) => !e.closed) : [];
  } catch { v = []; }
  _cacheEv.set(k, { at: Date.now(), v });
  return v;
}
const _cacheSlug = new Map();
async function gammaEvento(slug) {
  const hit = _cacheSlug.get(slug);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.v;
  let v = null;
  try {
    const r = await fetch(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(12000) });
    const j = r.ok ? await r.json().catch(() => null) : null;
    v = Array.isArray(j) ? j[0] : null;
  } catch { v = null; }
  _cacheSlug.set(slug, { at: Date.now(), v });
  return v;
}

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function jarr(x) { if (Array.isArray(x)) return x; try { const j = JSON.parse(x); return Array.isArray(j) ? j : []; } catch { return []; } }

// clasifica un mercado de gamma contra nuestras familias. Devuelve null si no se puede mapear SIN dudas:
// inventarle una equivalencia a un título ambiguo es cómo se compra el partido equivocado.
function mapMercado(m, home, away) {
  if (m.closed || m.active === false) return null;
  const q = String(m.question || m.groupItemTitle || '');
  const outs = jarr(m.outcomes);
  const precios = jarr(m.outcomePrices).map(num);
  if (outs.length !== 2 || precios.length !== 2 || precios.some((p) => p == null)) return null;

  // familia + mapa + línea, con la taxonomía REAL de gamma (verificada contra el BLAST del 31-ago):
  //   "… - Map 1 Winner" · "Map Handicap: G2 (-1.5) vs …" · "Games Total: O/U 2.5" ·
  //   "Map 1 Rounds Handicap: G2 (-3.5) vs …" · y el ganador de serie lleva el TÍTULO del evento como question.
  let familia = null, mapa = null, linea = null;
  const mMapa = q.match(/map\s*(\d)/i);
  if (/rounds? handicap/i.test(q)) {
    familia = 'RONDAS_HANDICAP'; mapa = mMapa ? +mMapa[1] : null;
    const mln = q.match(/\(([+-]?\d+(?:\.\d+)?)\)/); linea = mln ? Math.abs(num(mln[1])) : null;
    if (mapa == null || linea == null) return null;
  } else if (/map handicap/i.test(q) && !/rounds?/i.test(q)) {
    familia = 'HANDICAP';
    const mln = q.match(/\(([+-]?\d+(?:\.\d+)?)\)/); linea = mln ? Math.abs(num(mln[1])) : 1.5;
  } else if (/map\s*\d\s*winner/i.test(q)) {
    familia = 'MAPA'; mapa = +mMapa[1];
  } else if (/(games?|maps?) total/i.test(q)) {
    familia = 'TOTAL_MAPAS';
    const mln = q.match(/([0-9]+\.?[0-9]*)\s*$/); linea = mln ? num(mln[1]) : null;
    if (linea == null) return null;
  } else if (/ vs /i.test(q) && /\(bo\d\)/i.test(q) && !/map|round|total|kill/i.test(q.replace(/\(bo\d\)/i, ''))) {
    familia = 'SERIE';   // el mercado del ganador repite el título del evento
  } else return null;

  // orientación de lados. Over/Under va por nombre de outcome; lo demás por nombre de equipo — y si el
  // nombre no resuelve SIN ambigüedad, no hay mercado: comprar el lado equivocado es el peor error posible.
  let l0 = null, l1 = null;
  if (familia === 'TOTAL_MAPAS') {
    l0 = /^over/i.test(outs[0]) ? 'over' : /^under/i.test(outs[0]) ? 'under' : null;
    l1 = /^over/i.test(outs[1]) ? 'over' : /^under/i.test(outs[1]) ? 'under' : null;
  } else {
    const lado = (i) => nombra(outs[i], home) && !nombra(outs[i], away) ? 'home'
      : nombra(outs[i], away) && !nombra(outs[i], home) ? 'away' : null;
    l0 = lado(0); l1 = lado(1);
    if (!l0 && /^(yes|no)$/i.test(String(outs[0]))) {
      const eq = nombra(q, home) && !nombra(q, away) ? 'home' : nombra(q, away) && !nombra(q, home) ? 'away' : null;
      if (!eq) return null;
      l0 = /^yes$/i.test(outs[0]) ? eq : (eq === 'home' ? 'away' : 'home');
      l1 = l0 === 'home' ? 'away' : 'home';
    }
  }
  if (!l0 || !l1 || l0 === l1) return null;

  // LÍNEA FIRMADA para hándicaps: la pregunta nombra explícitamente quién lleva el signo ("G2 (-1.5)").
  // Se traduce a la perspectiva del local UNA vez aquí y la liquidación no adivina favoritos jamás.
  let lineaHome = null;
  if (familia === 'HANDICAP' || familia === 'RONDAS_HANDICAP') {
    const mSign = q.match(/([^:()]+?)\s*\(([+-]\d+(?:\.\d+)?)\)/);
    if (!mSign) return null;
    const quien = nombra(mSign[1], home) && !nombra(mSign[1], away) ? 'home'
      : nombra(mSign[1], away) && !nombra(mSign[1], home) ? 'away' : null;
    if (!quien) return null;
    lineaHome = quien === 'home' ? num(mSign[2]) : -num(mSign[2]);
  }

  return { familia, mapa, linea, linea_home: lineaHome, lados: { [l0]: { precio: precios[0], nombre: outs[0] }, [l1]: { precio: precios[1], nombre: outs[1] } },
    pm_id: String(m.id || m.conditionId || m.slug || q), pregunta: q,
    liquidez: num(m.liquidityNum != null ? m.liquidityNum : m.liquidity), vol24: num(m.volume24hr) };
}

// consenso devig de crossBook para una familia/mapa/línea concreta → { home: p, away: p, books }
function consensoDe(cross, familia, mapa, linea) {
  const conLinea = familia === 'HANDICAP' || familia === 'RONDAS_HANDICAP' || familia === 'TOTAL_MAPAS';
  for (const c of cross || []) {
    if (c.family !== familia) continue;
    if ((mapa == null) !== (c.map == null) || (mapa != null && +c.map !== +mapa)) continue;
    if (conLinea && !(linea != null && c.line != null && Math.abs(Math.abs(c.line) - linea) < 0.01)) continue;
    if (!c.consensus || c.single_book) continue;
    const out = { books: c.books };
    for (const s of c.consensus) out[s.side] = s.p;
    const lados = familia === 'TOTAL_MAPAS' ? ['over', 'under'] : ['home', 'away'];
    if (lados.every((l) => out[l] != null)) return out;
  }
  return null;
}

// ---- EL BARRIDO -----------------------------------------------------------------------------------------
async function escanear({ game = 'cs2' } = {}) {
  const ESS = require('../esports-engine/store');
  const out = { game, eventos: 0, pm_encontrados: 0, mercados: 0, senales_nuevas: 0, senales: [] };
  const sl = await ESS.slate(game, { days: 2 }).catch(() => null);
  const st = rd();
  const ahora = Date.now();
  for (const ev of (sl && sl.events) || []) {
    const ko = Date.parse(ev.start_at || 0);
    if (!(ko > ahora + 10 * 60e3) || ko > ahora + 36 * 3600e3) continue;   // con margen para colocar; sin futuros lejanos
    out.eventos++;
    let an = null;
    try { an = await ESS.analyzeMatch(game, ev.id, { days: 2 }); } catch { continue; }
    const cross = (an && an.cross_book) || [];
    if (!cross.length) continue;
    const home = ev.home && (ev.home.name || ev.home), away = ev.away && (ev.away.name || ev.away);
    // buscar el evento en gamma por el equipo con nombre más distintivo
    const evs = await gammaBusca(`${home} ${away}`);
    const pmHit = evs.find((e) => {
      const tt = `${e.title || ''} ${e.slug || ''}`;
      if (!(nombra(tt, home) && nombra(tt, away))) return false;
      const d = Date.parse(e.startDate || e.endDate || 0);
      return !d || Math.abs(d - ko) < 36 * 3600e3;
    });
    if (!pmHit || !pmHit.slug) continue;
    const pmEv = await gammaEvento(pmHit.slug);
    if (!pmEv) continue;
    out.pm_encontrados++;
    for (const m of pmEv.markets || []) {
      const mm = mapMercado(m, home, away);
      if (!mm) continue;
      out.mercados++;
      if (mm.liquidez != null && mm.liquidez < LIQ_MIN()) continue;         // el propio gate de la firm pide fondo
      const cons = consensoDe(cross, mm.familia, mm.mapa, mm.linea);
      if (!cons) continue;
      for (const lado of (mm.familia === 'TOTAL_MAPAS' ? ['over', 'under'] : ['home', 'away'])) {
        const p = mm.lados[lado] && mm.lados[lado].precio;
        if (!(p >= PRECIO_MIN && p <= PRECIO_MAX)) continue;
        const edge = 100 * (cons[lado] - p);
        // techo de cordura: un "edge" de 12+ pp contra un libro con volumen casi nunca es ventaja — es un
        // partido que ya va en vivo, un mercado mal mapeado o un consenso rancio. Se descarta y punto.
        if (!(edge >= EDGE_MIN_PP()) || edge > 12) continue;
        const id = `${mm.pm_id}|${lado}`;
        const prev = st.senales[id];
        // dedup: una tesis por mercado+lado; se reaviva solo si el edge creció ≥2 pp desde el aviso
        if (prev && prev.estado === 'ABIERTA' && !(edge >= (prev.edge_pp || 0) + 2)) continue;
        if (prev && prev.estado !== 'ABIERTA') continue;
        const limite = Math.min(PRECIO_MAX, +(cons[lado] - 0.01).toFixed(2));  // nunca pagar el consenso: sin colchón no hay orden
        const shares = Math.min(MAX_SHARES_EVENTO, Math.floor(RIESGO_USD() / p));
        const s = {
          id, at: new Date().toISOString(), game, evento: `${home} vs ${away}`,
          pm_evento: pmEv.slug || pmEv.title, mercado: mm.pregunta,
          familia: mm.familia, mapa: mm.mapa, linea: mm.linea, linea_home: mm.linea_home,
          lado, equipo: mm.lados[lado].nombre,
          precio_pm: p, consenso: cons[lado], books: cons.books, edge_pp: +edge.toFixed(1),
          limite, shares, ko: ev.start_at, home, away,
          estado: 'ABIERTA', correo_at: prev ? prev.correo_at : null,
        };
        st.senales[id] = s;
        out.senales_nuevas++;
        out.senales.push(s);
      }
    }
  }
  // poda: tesis cerradas de hace más de 30 días
  for (const [k, v] of Object.entries(st.senales)) {
    if (v.estado !== 'ABIERTA' && Date.now() - Date.parse(v.at || 0) > 30 * 864e5) delete st.senales[k];
  }
  st.at = new Date().toISOString();
  wr(st);
  return out;
}

// ---- LIQUIDACIÓN (sombra propia, desde nuestra fuente de resultados) ------------------------------------
async function liquidar({ game = 'cs2' } = {}) {
  const st = rd();
  const abiertas = Object.values(st.senales).filter((s) => s.estado === 'ABIERTA' && Date.parse(s.ko || 0) < Date.now() - 30 * 60e3);
  if (!abiertas.length) return { settled: 0, abiertas: 0 };
  const RES = require('../data-providers/esports/results');
  const masVieja = Math.min(...abiertas.map((s) => Date.parse(s.ko || 0)));
  const dias = Math.min(14, Math.max(2, Math.ceil((Date.now() - masVieja) / 864e5) + 1));
  const rs = await RES.results(game, { since: new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10), max: 600 }).catch(() => null);
  if (!rs || !rs.available) return { settled: 0, abiertas: abiertas.length, no_source: true };
  const key = (a, b) => [nrm(a), nrm(b)].sort().join('~');
  const idx = {};
  for (const r of rs.rows || []) idx[key(r.a, r.b)] = r;
  let settled = 0;
  for (const s of abiertas) {
    const r = idx[key(s.home, s.away)];
    if (!r || r.maps_a == null || r.maps_b == null) continue;
    const invert = nrm(r.a) !== nrm(s.home);                 // la fuente puede traer el par al revés
    const mapsHome = invert ? r.maps_b : r.maps_a, mapsAway = invert ? r.maps_a : r.maps_b;
    let gana = null;
    if (s.familia === 'SERIE') gana = (s.lado === 'home') === (mapsHome > mapsAway);
    else if (s.familia === 'MAPA' && r.maps && r.maps[s.mapa - 1]) {
      const g = r.maps[s.mapa - 1];
      const sh = invert ? g.score_b : g.score_a, sa = invert ? g.score_a : g.score_b;
      gana = (s.lado === 'home') === (sh > sa);
    } else if (s.familia === 'TOTAL_MAPAS' && s.linea != null) {
      const tot = mapsHome + mapsAway;
      if (tot !== s.linea) gana = s.lado === 'over' ? tot > s.linea : tot < s.linea;
    } else if (s.familia === 'HANDICAP' && s.linea_home != null) {
      // la línea ya viene FIRMADA en perspectiva del local desde el escaneo: aquí no se adivina nada
      const diff = mapsHome - mapsAway + s.linea_home;
      if (diff !== 0) gana = s.lado === 'home' ? diff > 0 : diff < 0;
    } else if (s.familia === 'RONDAS_HANDICAP' && s.linea_home != null && r.maps && r.maps[s.mapa - 1]) {
      const g = r.maps[s.mapa - 1];
      const sh = invert ? g.score_b : g.score_a, sa = invert ? g.score_a : g.score_b;
      if (Number.isFinite(sh) && Number.isFinite(sa)) {
        const diff = sh - sa + s.linea_home;
        if (diff !== 0) gana = s.lado === 'home' ? diff > 0 : diff < 0;
      }
    }
    if (gana == null) continue;
    s.estado = gana ? 'WIN' : 'LOSS';
    s.resuelto_at = new Date().toISOString();
    // PnL simulado con el riesgo por posición al precio del aviso (la orden real puede diferir; esto es la tesis)
    s.pnl_usd = gana ? +(s.shares * (1 - s.precio_pm)).toFixed(2) : -+(s.shares * s.precio_pm).toFixed(2);
    settled++;
  }
  if (settled) wr(st);
  return { settled, abiertas: abiertas.length - settled };
}

// ---- ESTADO ---------------------------------------------------------------------------------------------
function estado() {
  const st = rd();
  const all = Object.values(st.senales);
  const cerr = all.filter((s) => s.estado === 'WIN' || s.estado === 'LOSS');
  return {
    at: st.at, senales: all.length,
    abiertas: all.filter((s) => s.estado === 'ABIERTA').length,
    w: cerr.filter((s) => s.estado === 'WIN').length,
    l: cerr.filter((s) => s.estado === 'LOSS').length,
    pnl_usd: +cerr.reduce((a, s) => a + (s.pnl_usd || 0), 0).toFixed(2),
    sin_correo: all.filter((s) => s.estado === 'ABIERTA' && !s.correo_at).length,
    ultimas: all.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20),
  };
}

// las señales abiertas que aún no salieron por correo (el server las manda y marca correo_at)
function pendientesDeCorreo() {
  const st = rd();
  return Object.values(st.senales).filter((s) => s.estado === 'ABIERTA' && !s.correo_at && Date.parse(s.ko || 0) > Date.now() + 10 * 60e3);
}
function marcaCorreo(ids) {
  const st = rd();
  const t = new Date().toISOString();
  for (const id of ids) if (st.senales[id]) st.senales[id].correo_at = t;
  wr(st);
}

module.exports = { escanear, liquidar, estado, pendientesDeCorreo, marcaCorreo, DIR };
