// data-providers/amfoot/cloudbet.js — CLOUDBET COMO CASA EJECUTABLE EN FÚTBOL AMERICANO (7-sep-2026).
//
// POR QUÉ EXISTE. Los totales de College son la familia con mejor CLV de la casa (+4,8 %, t 24,8), pero ese
// CLV está medido contra las casas de The Odds API (lowvig, Pinnacle…), ninguna de las cuales podemos
// operar. La única casa conectada es Cloudbet, y Alexis preguntó lo único que importa: ¿esa ventaja
// sobrevive al precio de Cloudbet? Sin registrar ese precio en el momento de la pick y en el cierre, la
// respuesta sería una conjetura. Este adaptador trae los tres mercados principales de NCAAF/NFL/CFL de
// Cloudbet en la MISMA forma que devuelve The Odds API (un `bookmaker` más en cada evento), así que el
// resto de la sombra —mejor precio, consenso, cierres— los ve sin saber de dónde salieron; y además deja
// la escalera de líneas alternativas para poder valorar la pick en la línea EXACTA que Cloudbet cotiza.
//
// Comprobado en prod el 7-sep (sonda `cloudbet-probe?sport=american_football`): NCAAF trae
// `american_football.moneyline`, `american_football.handicap`, `american_football.totals` (además de
// mitades, cuartos y totales por equipo); NFL solo outrights hasta cerca del kickoff; CFL 2 eventos.
'use strict';

const BASE = 'https://sports-api.cloudbet.com/pub/v2/odds';
const COMP = { ncaaf: 'american-football-usa-ncaa', nfl: 'american-football-usa-nfl', cfl: 'american-football-international-cfl' };
const PREFIX = 'american_football';
const TTL = 25 * 60e3;
const G = global._amfootCb = global._amfootCb || {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cbFetch(url, key, { tries = 3, timeoutMs = 15000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'X-API-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(800 * (i + 1)); }
  }
  return null;
}
function parseParams(s) {
  const o = {};
  for (const part of String(s || '').split('&')) {
    const [k, v] = part.split('=');
    if (!k) continue;
    const n = Number(v);
    o[k] = Number.isFinite(n) && v !== '' && v != null ? n : v;
  }
  return o;
}
const enabled = () => !/^(0|false|no|off)$/i.test(String(process.env.GP_AMFOOT_CLOUDBET == null ? 'true' : process.env.GP_AMFOOT_CLOUDBET).trim());

// ---- 1) partidos de la competición en los próximos días (solo EVENT_TYPE_EVENT; los outrights no sirven) --
async function events(lg, { days = 8, key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  const comp = COMP[lg];
  if (!comp || !key) return [];
  const fromS = Math.floor(Date.now() / 1000);
  const j = await cbFetch(`${BASE}/competitions/${encodeURIComponent(comp)}?limit=200&from=${fromS - 3600}&to=${fromS + days * 86400}`, key);
  return ((j && j.events) || [])
    .filter((e) => e.type === 'EVENT_TYPE_EVENT' && e.id && e.home && e.away)
    .map((e) => ({ id: String(e.id), home: e.home.name, away: e.away.name, cutoff: e.cutoffTime || null, status: e.status || null }));
}

// ---- 2) mercados de un partido → forma de The Odds API ----------------------------------------------------
// `main` es la línea principal (la más equilibrada entre los dos lados, que es lo que The Odds API devuelve
// por casa); `alts` es la escalera completa para casar la línea exacta de una pick.
async function markets(ev, { key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  if (!key || !ev || !ev.id) return null;
  const j = await cbFetch(`${BASE}/events/${ev.id}`, key);
  if (!j || !j.markets) return null;
  const rows = { ml: null, spreads: [], totals: [] };
  let maxStake = null;
  for (const [mk, m] of Object.entries(j.markets)) {
    const bare = mk.replace(new RegExp('^' + PREFIX + '\\.'), '').replace(/\.v\d+$/, '');
    if (!['moneyline', 'handicap', 'totals'].includes(bare)) continue;
    for (const [subKey, sub] of Object.entries(m.submarkets || {})) {
      const subP = parseParams(subKey);
      // solo el partido entero (con prórroga); mitades y cuartos llevan su propio mercado y no entran aquí
      if (subP.period && !/^(ot|default|full|regular)$/i.test(String(subP.period))) continue;
      const sels = (sub.selections || []).filter((s) => s.price > 1 && String(s.status || 'SELECTION_ENABLED') === 'SELECTION_ENABLED');
      const side = (s) => String(s.outcome || '').toLowerCase().replace(/^.*=/, '');
      if (bare === 'moneyline') {
        const h = sels.find((s) => side(s) === 'home'), a = sels.find((s) => side(s) === 'away');
        if (h && a) rows.ml = { home: +h.price, away: +a.price };
      }
      if (bare === 'handicap') {
        // la línea viene en `params` de cada selección (handicap=-3.5 en el lado que la lleva)
        const byLine = {};
        for (const s of sels) {
          const p = { ...subP, ...parseParams(s.params) };
          if (p.handicap == null || !Number.isFinite(Number(p.handicap))) continue;
          const sd = side(s);
          // la clave de la escalera es el hándicap del LOCAL (perspectiva de The Odds API: `-h.point` = línea)
          const hcpHome = sd === 'home' ? Number(p.handicap) : -Number(p.handicap);
          const k = String(hcpHome);
          byLine[k] = byLine[k] || { hcp_home: hcpHome };
          byLine[k][sd] = +s.price;
          if (s.maxStake != null) maxStake = Math.max(maxStake || 0, +s.maxStake);
        }
        rows.spreads = Object.values(byLine).filter((x) => x.home && x.away);
      }
      if (bare === 'totals') {
        const byLine = {};
        for (const s of sels) {
          const p = { ...subP, ...parseParams(s.params) };
          if (p.total == null || !Number.isFinite(Number(p.total))) continue;
          const k = String(Number(p.total));
          byLine[k] = byLine[k] || { line: Number(p.total) };
          byLine[k][side(s)] = +s.price;
          if (s.maxStake != null) maxStake = Math.max(maxStake || 0, +s.maxStake);
        }
        rows.totals = Object.values(byLine).filter((x) => x.over && x.under);
      }
    }
  }
  const balanced = (arr, a, b) => arr.slice().sort((x, y) => Math.abs(x[a] - x[b]) - Math.abs(y[a] - y[b]))[0] || null;
  return { event_id: ev.id, home: ev.home, away: ev.away, cutoff: ev.cutoff, max_stake: maxStake,
    ml: rows.ml, spread_main: balanced(rows.spreads, 'home', 'away'), total_main: balanced(rows.totals, 'over', 'under'),
    alts: { spreads: rows.spreads, totals: rows.totals }, at: new Date().toISOString() };
}

// ---- 3) fundir con las filas de The Odds API ---------------------------------------------------------------
// `resolve(nombre)` es el resolutor de la liga (el mismo que casa The Odds API con el catálogo propio); si
// los dos nombres resuelven al mismo equipo y el saque está a menos de 12 h, es el mismo partido. Se añade
// un `bookmaker` con clave `cloudbet` y las tres claves de mercado que el resto del motor ya entiende, y en
// `_cb` la escalera y el tope de stake, que The Odds API no tiene y aquí sí importan.
async function merge(lg, rows, resolve, { key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  const out = { enabled: enabled() && !!key, events: 0, merged: 0, sin_par: [], at: new Date().toISOString() };
  if (!out.enabled || !Array.isArray(rows) || !rows.length) return out;
  const c = G[lg];
  let quotes = c && Date.now() - c.at < TTL ? c.quotes : null;
  if (!quotes) {
    const evs = await events(lg, { key });
    quotes = [];
    for (const ev of evs) {
      const q = await markets(ev, { key }).catch(() => null);
      if (q && (q.ml || q.spread_main || q.total_main)) quotes.push(q);
      await sleep(150);
    }
    G[lg] = { at: Date.now(), quotes };
  }
  out.events = quotes.length;
  const R = (n) => { try { return resolve(n) || null; } catch { return null; } };
  for (const ev of rows) {
    const h = R(ev.home_team), a = R(ev.away_team);
    if (!h || !a) continue;
    const t = Date.parse(ev.commence_time || 0);
    const q = quotes.find((x) => R(x.home) === h && R(x.away) === a && Math.abs(Date.parse(x.cutoff || 0) - t) < 12 * 3600e3);
    if (!q) continue;
    ev.bookmakers = (ev.bookmakers || []).filter((b) => b.key !== 'cloudbet');
    const mkts = [];
    if (q.ml) mkts.push({ key: 'h2h', last_update: q.at, outcomes: [{ name: ev.home_team, price: q.ml.home }, { name: ev.away_team, price: q.ml.away }] });
    if (q.spread_main) mkts.push({ key: 'spreads', last_update: q.at, outcomes: [
      { name: ev.home_team, point: q.spread_main.hcp_home, price: q.spread_main.home },
      { name: ev.away_team, point: -q.spread_main.hcp_home, price: q.spread_main.away }] });
    if (q.total_main) mkts.push({ key: 'totals', last_update: q.at, outcomes: [
      { name: 'Over', point: q.total_main.line, price: q.total_main.over }, { name: 'Under', point: q.total_main.line, price: q.total_main.under }] });
    if (!mkts.length) continue;
    ev.bookmakers.push({ key: 'cloudbet', title: 'Cloudbet', last_update: q.at, markets: mkts,
      _cb: { event_id: q.event_id, max_stake: q.max_stake, alts: q.alts } });
    out.merged++;
  }
  for (const q of quotes) {
    if (out.sin_par.length >= 6) break;
    const hit = rows.some((ev) => (ev.bookmakers || []).some((b) => b.key === 'cloudbet' && b._cb && b._cb.event_id === q.event_id));
    if (!hit) out.sin_par.push(`${q.home} v ${q.away}`);
  }
  return out;
}

// La cotización de Cloudbet para UNA tesis (familia, lado, línea) sobre un mercado ya fundido: la línea
// exacta si está en la escalera, si no la principal (marcada como distinta). Es lo que se guarda en la pick.
function quoteFor(mk, c) {
  const bk = ((mk && mk.books) || []).find((b) => b.book === 'cloudbet');
  const cb = mk && mk._cb;
  if (!bk && !cb) return null;
  const alts = (cb && cb.alts) || { spreads: [], totals: [] };
  const out = { book: 'cloudbet', max_stake: cb ? cb.max_stake : null, misma_linea: false, line: null, price: null };
  if (c.family === 'TOTAL') {
    const ex = alts.totals.find((x) => x.line === c.line);
    const main = bk && bk.total;
    const row = ex || (main ? { line: main.line, over: main.over, under: main.under } : null);
    if (!row) return null;
    out.line = row.line; out.price = row[c.side]; out.misma_linea = row.line === c.line;
  } else if (c.family === 'SPREAD') {
    const ex = alts.spreads.find((x) => x.hcp_home === c.line);
    const main = bk && bk.spread;
    const row = ex ? { line: ex.hcp_home, home: ex.home, away: ex.away } : main;
    if (!row) return null;
    out.line = row.line; out.price = row[c.side]; out.misma_linea = row.line === c.line;
  } else if (c.family === 'MONEYLINE') {
    const main = bk && bk.ml;
    if (!main) return null;
    out.line = 0; out.price = main[c.side]; out.misma_linea = true;
  } else return null;
  return out.price > 1 ? out : null;
}

module.exports = { COMP, enabled, events, markets, merge, quoteFor };
