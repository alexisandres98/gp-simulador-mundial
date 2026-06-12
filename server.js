// Simulador Mundial 2026 — servidor sin dependencias (Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TEAMS, GROUPS, GROUP_FIXTURES, KNOCKOUT } = require('./data/tournament');
const { simulateTournament, matchProbs, liveMatchProbs, eloUpdate, explainTeam, effElo, assignThirds, cmpRows } = require('./engine');
const mailer = require('./mailer');

const PORT = process.env.PORT || 3000;
const N_SIMS = Number(process.env.SIMS || 10000);
// DB_FILE puede apuntar a un disco persistente montado (p.ej. /data/db.json en Render Starter)
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');
const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));

// ---------- persistencia ----------
let db = { users: {}, sessions: {}, codes: {}, results: {}, elos: {}, history: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* primera ejecución */ }
TEAMS.forEach(t => { if (db.elos[t.id] == null) db.elos[t.id] = t.elo; });
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)), 200);
}

// Recalcula los Elo desde la base replicando todos los resultados finales (permite editar/borrar sin corromper ratings)
function recomputeElos() {
  TEAMS.forEach(t => { db.elos[t.id] = t.elo; });
  const apply = (hId, aId, r) => {
    const [nh, na] = eloUpdate(db.elos[hId], db.elos[aId], r.hg, r.ag, teamById[hId].host, teamById[aId].host);
    db.elos[hId] = nh; db.elos[aId] = na;
  };
  for (const f of GROUP_FIXTURES) {
    const r = db.results[f.id];
    if (r && r.status === 'final') apply(f.home, f.away, r);
  }
  for (const k of KNOCKOUT) {
    const r = db.results[String(k.m)];
    if (r && r.status === 'final' && r.home && r.away) apply(r.home, r.away, r);
  }
}

// ---------- simulación (cacheada) ----------
let simCache = null;
function runSims() {
  const t0 = Date.now();
  simCache = simulateTournament(db.elos, db.results, N_SIMS);
  const top = TEAMS.map(t => t.id).sort((a, b) => simCache[b].champion - simCache[a].champion)[0];
  console.log(`[sim] ${N_SIMS} torneos en ${Date.now() - t0}ms — favorito: ${top} ${(simCache[top].champion * 100).toFixed(1)}%`);
  db.history.push({ ts: Date.now(), probs: Object.fromEntries(TEAMS.map(t => [t.id, +(simCache[t.id].champion).toFixed(4)])) });
  if (db.history.length > 1000) db.history = db.history.slice(-1000);
  save();
}
recomputeElos();
runSims();

// ---------- SSE (tiempo real) ----------
const sseClients = new Set();
// heartbeat cada 25s: mantiene vivas las conexiones a través de proxies/túneles
setInterval(() => { for (const res of sseClients) res.write(':hb\n\n'); }, 25000);
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

// ---------- tabla de posiciones real (solo resultados finales) ----------
function realStandings() {
  const tables = {};
  GROUPS.forEach(g => {
    tables[g] = {};
    TEAMS.filter(t => t.group === g).forEach(t =>
      tables[g][t.id] = { id: t.id, pj: 0, pts: 0, gf: 0, ga: 0 });
  });
  for (const f of GROUP_FIXTURES) {
    const r = db.results[f.id];
    if (!r || r.status !== 'final') continue;
    const H = tables[f.group][f.home], A = tables[f.group][f.away];
    H.pj++; A.pj++; H.gf += r.hg; H.ga += r.ag; A.gf += r.ag; A.ga += r.hg;
    if (r.hg > r.ag) H.pts += 3; else if (r.hg < r.ag) A.pts += 3; else { H.pts++; A.pts++; }
  }
  const out = {};
  GROUPS.forEach(g => {
    out[g] = Object.values(tables[g]).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.id.localeCompare(b.id));
  });
  return out;
}

// ---------- bracket real (equipos confirmados en eliminatorias) ----------
// Resuelve qué equipos reales ocupan cada llave a partir de resultados FINALES.
function resolveRealBracket() {
  const standings = realStandings();
  const groupDone = {};
  GROUPS.forEach(g => {
    groupDone[g] = GROUP_FIXTURES.filter(f => f.group === g)
      .every(f => db.results[f.id] && db.results[f.id].status === 'final');
  });
  const firsts = {}, seconds = {}, thirdRows = [];
  GROUPS.forEach(g => {
    if (!groupDone[g]) return;
    firsts[g] = standings[g][0].id;
    seconds[g] = standings[g][1].id;
    const t = standings[g][2];
    thirdRows.push({ id: t.id, pts: t.pts, gf: t.gf, ga: t.ga, _rnd: 0 });
  });
  let t3byMatch = {};
  if (GROUPS.every(g => groupDone[g])) {
    thirdRows.sort(cmpRows);
    const qual = thirdRows.slice(0, 8).map(r => r.id);
    const slots = KNOCKOUT.filter(k => k.away.t === 'T3').map(k => k.away);
    const assign = assignThirds(qual, slots);
    KNOCKOUT.filter(k => k.away.t === 'T3').forEach((k, i) => t3byMatch[k.m] = assign[i]);
  }
  const resolved = {}; // m -> {home, away} (solo lados conocidos)
  const winnerOf = m => {
    const r = db.results[String(m)];
    if (!r || r.status !== 'final') return null;
    return r.hg > r.ag ? r.home : r.hg < r.ag ? r.away : (r.pensHome ? r.home : r.away);
  };
  const loserOf = m => {
    const r = db.results[String(m)];
    if (!r || r.status !== 'final') return null;
    return r.hg > r.ag ? r.away : r.hg < r.ag ? r.home : (r.pensHome ? r.away : r.home);
  };
  const side = (s, m) => {
    if (s.t === 'W') return firsts[s.g] || null;
    if (s.t === 'R') return seconds[s.g] || null;
    if (s.t === 'T3') return t3byMatch[m] || null;
    if (s.t === 'M') return winnerOf(s.m);
    if (s.t === 'L') return loserOf(s.m);
  };
  for (const k of KNOCKOUT) {
    resolved[k.m] = { home: side(k.home, k.m), away: side(k.away, k.m) };
  }
  return resolved;
}

// ---------- sincronización automática de resultados (API pública de ESPN) ----------
const espnTeamId = {};
TEAMS.forEach(t => [t.en, t.name, ...t.aliases].forEach(a => espnTeamId[normName(a)] = t.id));
let lastSync = { ts: 0, ok: null, applied: 0, error: null };

function dstr(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
}

async function syncFromESPN(depth = 0) {
  try {
    // Rango completo del torneo: si el servidor se reinicia (disco efímero en Render free),
    // reingesta todos los resultados desde el inicio y se auto-repara.
    const url = process.env.ESPN_TEST_URL ||
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-${dstr(0)}&limit=250`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const bracket = resolveRealBracket();
    let changed = 0;
    for (const ev of j.events || []) {
      const c = ev.competitions && ev.competitions[0];
      if (!c) continue;
      const state = ev.status && ev.status.type && ev.status.type.state; // pre | in | post
      if (state !== 'in' && state !== 'post') continue;
      const H = c.competitors.find(x => x.homeAway === 'home');
      const A = c.competitors.find(x => x.homeAway === 'away');
      const hId = espnTeamId[normName(H.team.displayName)] || espnTeamId[normName(H.team.name)];
      const aId = espnTeamId[normName(A.team.displayName)] || espnTeamId[normName(A.team.name)];
      if (!hId || !aId) continue;
      const hg = Number(H.score) || 0, ag = Number(A.score) || 0;
      const minute = parseInt(ev.status.displayClock) || 0;
      const hPen = H.shootoutScore != null ? Number(H.shootoutScore) : null;
      const aPen = A.shootoutScore != null ? Number(A.shootoutScore) : null;

      // ¿partido de grupos? — el match por espnId debe coincidir también en equipos (blindaje)
      const sameTeams = f => (f.home === hId && f.away === aId) || (f.home === aId && f.away === hId);
      const byId = GROUP_FIXTURES.find(f => f.espnId === ev.id);
      const gf = (byId && sameTeams(byId)) ? byId : GROUP_FIXTURES.find(sameTeams);
      let matchId = null, payload = null;
      if (gf) {
        const flip = gf.home !== hId; // orientación del fixture oficial
        payload = {
          hg: flip ? ag : hg, ag: flip ? hg : ag,
          status: state === 'post' ? 'final' : 'live', minute,
        };
        matchId = gf.id;
      } else {
        // eliminatoria: localizar la llave cuyos equipos reales coinciden
        const m = Object.keys(bracket).find(m =>
          (bracket[m].home === hId && bracket[m].away === aId) ||
          (bracket[m].home === aId && bracket[m].away === hId));
        if (!m) continue;
        const flip = bracket[m].home !== hId;
        payload = {
          home: bracket[m].home, away: bracket[m].away,
          hg: flip ? ag : hg, ag: flip ? hg : ag,
          status: state === 'post' ? 'final' : 'live', minute,
        };
        if (hPen != null && aPen != null) {
          payload.pensHome = flip ? aPen > hPen : hPen > aPen;
        }
        matchId = String(m);
      }
      const prev = db.results[matchId];
      const same = prev && prev.status === payload.status && prev.hg === payload.hg &&
        prev.ag === payload.ag && prev.minute === payload.minute && prev.pensHome === payload.pensHome;
      if (!same) {
        db.results[matchId] = { ...(prev || {}), ...payload, source: 'espn' };
        changed++;
        console.log(`[sync] ${matchId}: ${payload.hg}-${payload.ag} ${payload.status}${payload.status === 'live' ? ` ${payload.minute}'` : ''}`);
      }
    }
    lastSync = { ts: Date.now(), ok: true, applied: changed, error: null };
    if (changed) {
      // segunda pasada: con los grupos ya ingresados, el bracket real se resuelve y
      // los resultados de eliminatorias del mismo lote encuentran su llave
      if (depth === 0) await syncFromESPN(1);
      recomputeElos();
      runSims();
      broadcast('update', { reason: 'resultados en vivo (ESPN)', ts: Date.now() });
    }
  } catch (e) {
    lastSync = { ts: Date.now(), ok: false, applied: 0, error: e.message };
    console.error('[sync] error:', e.message);
  }
}

// ---------- mercados (Polymarket + Kalshi) ----------
let marketCache = { ts: 0, polymarket: {}, kalshi: {}, errors: [] };
function normName(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
const aliasToId = {};
TEAMS.forEach(t => [t.en, t.name, ...t.aliases].forEach(a => aliasToId[normName(a)] = t.id));

async function fetchMarkets(force = false) {
  if (!force && Date.now() - marketCache.ts < 5 * 60 * 1000) return marketCache;
  const next = { ts: Date.now(), polymarket: {}, kalshi: {}, errors: [] };
  // Polymarket — Gamma API (precio + volumen + liquidez + cambio 24h + link directo al mercado)
  try {
    const r = await fetch('https://gamma-api.polymarket.com/events?slug=world-cup-winner', { signal: AbortSignal.timeout(15000) });
    const ev = (await r.json())[0];
    for (const m of ev.markets || []) {
      const id = aliasToId[normName(m.groupItemTitle || m.question)];
      if (!id) continue;
      let price = null;
      try { price = Number(JSON.parse(m.outcomePrices)[0]); } catch { }
      const bid = m.bestBid != null ? Number(m.bestBid) : price;
      const ask = m.bestAsk != null ? Number(m.bestAsk) : price;
      if (price != null && !Number.isNaN(price)) next.polymarket[id] = {
        price, bid, ask,
        volume: Number(m.volumeNum || m.volume) || 0,
        volume24h: Number(m.volume24hr) || 0,
        liquidity: Number(m.liquidityNum || m.liquidity) || 0,
        change24h: Number(m.oneDayPriceChange) || 0,
        url: m.slug ? `https://polymarket.com/event/${ev.slug}/${m.slug}` : `https://polymarket.com/event/${ev.slug}`,
      };
    }
  } catch (e) { next.errors.push('Polymarket: ' + e.message); }
  // Kalshi — API pública (precio + volumen + interés abierto + cambio vs cierre anterior + link al evento)
  try {
    let cursor = '', pages = 0;
    while (pages++ < 5) {
      const url = `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=KXMENWORLDCUP-26&limit=100${cursor ? '&cursor=' + cursor : ''}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      for (const m of j.markets || []) {
        const id = aliasToId[normName(m.no_sub_title || m.yes_sub_title)];
        if (!id) continue;
        const yesBid = m.yes_bid_dollars != null ? Number(m.yes_bid_dollars) : 1 - Number(m.no_ask_dollars);
        const yesAsk = m.yes_ask_dollars != null ? Number(m.yes_ask_dollars) : 1 - Number(m.no_bid_dollars);
        const last = Number(m.last_price_dollars) || 0;
        next.kalshi[id] = {
          price: last, bid: +yesBid.toFixed(4), ask: +yesAsk.toFixed(4),
          volume: Number(m.volume_fp) || 0,
          volume24h: Number(m.volume_24h_fp) || 0,
          openInterest: Number(m.open_interest_fp) || 0,
          change24h: +(last - (Number(m.previous_price_dollars) || last)).toFixed(4),
          ticker: m.ticker,
          url: 'https://kalshi.com/markets/kxmenworldcup/mens-world-cup-winner/kxmenworldcup-26',
        };
      }
      cursor = j.cursor;
      if (!cursor) break;
    }
  } catch (e) { next.errors.push('Kalshi: ' + e.message); }
  if (Object.keys(next.polymarket).length || Object.keys(next.kalshi).length) marketCache = next;
  else marketCache.errors = next.errors;
  return marketCache;
}

function arbitrage() {
  const rows = [];
  for (const t of TEAMS) {
    const p = simCache[t.id].champion;
    const pm = marketCache.polymarket[t.id], ks = marketCache.kalshi[t.id];
    const row = { id: t.id, model: p, polymarket: pm || null, kalshi: ks || null, edges: [] };
    if (pm && pm.ask > 0.001 && p - pm.ask > 0.015) row.edges.push({
      type: 'valor', venue: 'Polymarket', side: 'COMPRAR SÍ', price: pm.ask, edge: p - pm.ask,
      note: `Modelo ${(p * 100).toFixed(1)}% vs precio ${(pm.ask * 100).toFixed(1)}%`,
    });
    if (pm && pm.bid > 0.001 && pm.bid - p > 0.015) row.edges.push({
      type: 'valor', venue: 'Polymarket', side: 'COMPRAR NO', price: 1 - pm.bid, edge: pm.bid - p,
      note: `Mercado sobrevalora: ${(pm.bid * 100).toFixed(1)}% vs modelo ${(p * 100).toFixed(1)}%`,
    });
    if (ks && ks.ask > 0.001 && p - ks.ask > 0.015) row.edges.push({
      type: 'valor', venue: 'Kalshi', side: 'COMPRAR SÍ', price: ks.ask, edge: p - ks.ask,
      note: `Modelo ${(p * 100).toFixed(1)}% vs precio ${(ks.ask * 100).toFixed(1)}%`,
    });
    if (ks && ks.bid > 0.001 && ks.bid - p > 0.015) row.edges.push({
      type: 'valor', venue: 'Kalshi', side: 'COMPRAR NO', price: 1 - ks.bid, edge: ks.bid - p,
      note: `Mercado sobrevalora: ${(ks.bid * 100).toFixed(1)}% vs modelo ${(p * 100).toFixed(1)}%`,
    });
    // Arbitraje puro entre plataformas (sin riesgo de modelo)
    if (pm && ks && pm.ask > 0.001 && ks.bid - pm.ask > 0.01) row.edges.push({
      type: 'arbitraje', venue: 'Poly→Kalshi', side: 'SÍ en Polymarket + NO en Kalshi',
      price: pm.ask, edge: ks.bid - pm.ask,
      note: `Compra SÍ a ${(pm.ask * 100).toFixed(1)}¢ en Poly y NO a ${((1 - ks.bid) * 100).toFixed(1)}¢ en Kalshi → ganancia fija ${((ks.bid - pm.ask) * 100).toFixed(1)}¢`,
    });
    if (pm && ks && ks.ask > 0.001 && pm.bid - ks.ask > 0.01) row.edges.push({
      type: 'arbitraje', venue: 'Kalshi→Poly', side: 'SÍ en Kalshi + NO en Polymarket',
      price: ks.ask, edge: pm.bid - ks.ask,
      note: `Compra SÍ a ${(ks.ask * 100).toFixed(1)}¢ en Kalshi y NO a ${((1 - pm.bid) * 100).toFixed(1)}¢ en Poly → ganancia fija ${((pm.bid - ks.ask) * 100).toFixed(1)}¢`,
    });
    // Kelly sugerido para apuestas de valor (fracción conservadora 1/4)
    row.edges.forEach(e => {
      if (e.type === 'valor' && e.side.includes('SÍ')) {
        const b = (1 - e.price) / e.price;
        e.kelly = Math.max(0, +(((p * b - (1 - p)) / b) / 4).toFixed(3));
      }
    });
    rows.push(row);
  }
  return rows.sort((a, b) => Math.max(0, ...b.edges.map(e => e.edge)) - Math.max(0, ...a.edges.map(e => e.edge)));
}

// ---------- estado para el cliente ----------
function buildState() {
  const standings = realStandings();
  const fixtures = GROUP_FIXTURES.map(f => {
    const r = db.results[f.id] || null;
    const probs = (r && r.status === 'live')
      ? liveMatchProbs(effElo(db.elos, f.home), effElo(db.elos, f.away), r.hg, r.ag, r.minute)
      : matchProbs(effElo(db.elos, f.home), effElo(db.elos, f.away));
    return { ...f, result: r, probs };
  });
  const bracket = resolveRealBracket();
  const knockout = KNOCKOUT.map(k => {
    const r = db.results[String(k.m)] || null;
    const resolved = bracket[k.m] || { home: null, away: null };
    const h = (r && r.home) || resolved.home, a = (r && r.away) || resolved.away;
    let probs = null;
    if (h && a) probs = (r && r.status === 'live')
      ? liveMatchProbs(effElo(db.elos, h), effElo(db.elos, a), r.hg, r.ag, r.minute)
      : matchProbs(effElo(db.elos, h), effElo(db.elos, a));
    return { ...k, result: r, resolved, probs };
  });
  return {
    sync: lastSync,
    teams: TEAMS.map(t => ({
      ...t, currentElo: Math.round(db.elos[t.id] * 10) / 10, eloDelta: Math.round((db.elos[t.id] - t.elo) * 10) / 10,
      sim: simCache[t.id],
    })),
    groups: GROUPS, standings, fixtures, knockout,
    history: db.history.slice(-200),
    sims: N_SIMS, lastSim: db.history.length ? db.history[db.history.length - 1].ts : null,
  };
}

// ---------- auth por email ----------
function getUser(req) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  const email = db.sessions[tok];
  return email ? { email, ...db.users[email], isAdmin: isAdmin(email) } : null;
}
function isAdmin(email) {
  const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (envAdmins.includes(email)) return true;
  const firstUser = Object.keys(db.users).sort((a, b) => db.users[a].createdAt - db.users[b].createdAt)[0];
  return email === firstUser; // el primer usuario registrado es admin
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // --- SSE ---
    if (p === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      // padding de 2KB para atravesar proxies/túneles que bufferean (Cloudflare, nginx)
      res.write(':' + ' '.repeat(2048) + '\n\n');
      res.write('event: hello\ndata: {}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    // --- auth ---
    if (p === '/api/auth/request' && req.method === 'POST') {
      const { email } = await readBody(req);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Email inválido' });
      const e = email.toLowerCase();
      // anti-abuso: máximo 3 códigos por email cada 10 minutos
      const prev = db.codes[e];
      if (prev && prev.count >= 3 && prev.exp > Date.now()) {
        return json(res, 429, { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' });
      }
      // ahorro de cuota: si hay un código vigente enviado hace <90s, no reenviar otro correo
      if (prev && prev.exp > Date.now() && prev.ts && Date.now() - prev.ts < 90 * 1000 && prev.sent) {
        return json(res, 200, { ok: true, sent: true, resent: true });
      }
      const code = String(crypto.randomInt(100000, 999999));
      db.codes[e] = {
        code, exp: Date.now() + 10 * 60 * 1000, ts: Date.now(), sent: false,
        count: (prev && prev.exp > Date.now() ? prev.count : 0) + 1,
      };
      save();
      if (mailer.isConfigured()) {
        try {
          await mailer.sendMail({
            to: e,
            subject: `${code} es tu código · GP Simulador del Mundial`,
            text: `¡Bienvenido al GP Simulador del Mundial 2026! ⚽\n\nTu código de acceso es: ${code}\n\nEscríbelo en la página para entrar. Vence en 10 minutos.\n\nCon tu cuenta puedes seguir en tiempo real las probabilidades de los 48 equipos, los marcadores en vivo partido a partido, y las oportunidades que nuestro modelo detecta frente a los mercados de predicción.\n\n— GP Simulador del Mundial`,
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
<h2 style="margin-bottom:4px">⚽ GP Simulador del Mundial</h2>
<p>¡Bienvenido! Tu código de acceso es:</p>
<p style="font-size:34px;font-weight:bold;letter-spacing:6px;background:#f4f4f4;padding:14px 20px;border-radius:8px;text-align:center">${code}</p>
<p>Escríbelo en la página para entrar. Vence en 10 minutos.</p>
<p style="color:#555;font-size:13px">Con tu cuenta puedes seguir en tiempo real las probabilidades de los 48 equipos del Mundial 2026, los marcadores en vivo partido a partido, y las oportunidades que nuestro modelo detecta frente a los mercados de predicción.</p>
<p style="color:#999;font-size:12px">Si no pediste este código, ignora este correo.</p>
</div>`,
          });
          db.codes[e].sent = true;
          save();
          console.log(`[auth] código enviado por email a ${e}`);
          return json(res, 200, { ok: true, sent: true });
        } catch (err) {
          console.error('[mail] error:', err.message);
          return json(res, 502, { error: 'No pudimos enviar el correo. Revisa que el email esté bien escrito e intenta de nuevo.' });
        }
      }
      console.log(`[auth] código para ${e}: ${code} (modo demo, SMTP no configurado)`);
      return json(res, 200, { ok: true, demo: true, demoCode: code });
    }
    if (p === '/api/auth/verify' && req.method === 'POST') {
      const { email, code } = await readBody(req);
      const e = String(email || '').toLowerCase();
      const c = db.codes[e];
      if (!c || c.exp < Date.now() || c.code !== String(code)) return json(res, 401, { error: 'Código incorrecto o expirado' });
      delete db.codes[e];
      if (!db.users[e]) db.users[e] = { createdAt: Date.now(), favorites: [] };
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = e;
      save();
      return json(res, 200, { token, email: e, isAdmin: isAdmin(e), favorites: db.users[e].favorites });
    }
    if (p === '/api/me') {
      const u = getUser(req);
      return u ? json(res, 200, u) : json(res, 401, { error: 'No autenticado' });
    }
    if (p === '/api/favorite' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { teamId } = await readBody(req);
      const favs = db.users[u.email].favorites;
      const i = favs.indexOf(teamId);
      i >= 0 ? favs.splice(i, 1) : favs.push(teamId);
      save();
      return json(res, 200, { favorites: favs });
    }
    if (p === '/api/admin/users') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const users = Object.entries(db.users).map(([email, x]) => ({
        email, createdAt: x.createdAt, lastSeen: x.lastSeen || x.createdAt,
        favorites: (x.favorites || []).length,
      })).sort((a, b) => b.createdAt - a.createdAt);
      return json(res, 200, { total: users.length, users });
    }
    // --- datos ---
    if (p === '/api/version') {
      // endpoint ligero para el fallback de polling (cuando el SSE no atraviesa el proxy/túnel)
      return json(res, 200, {
        sim: db.history.length ? db.history[db.history.length - 1].ts : 0,
        markets: marketCache.ts,
        users: Object.keys(db.users).length,
      });
    }
    if (p === '/api/state') {
      const u = getUser(req);
      if (!u) {
        // sin registro: vista previa limitada (gancho para crear cuenta)
        const top = TEAMS.map(t => ({
          id: t.id, name: t.name, flag: t.flag, group: t.group,
          champion: simCache[t.id].champion,
        })).sort((a, b) => b.champion - a.champion).slice(0, 6);
        return json(res, 200, { teaser: true, top, sims: N_SIMS, totalTeams: TEAMS.length });
      }
      db.users[u.email].lastSeen = Date.now();
      save();
      return json(res, 200, buildState());
    }
    if (p.startsWith('/api/team/')) {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const id = p.split('/')[3];
      if (!teamById[id]) return json(res, 404, { error: 'Equipo no encontrado' });
      return json(res, 200, {
        team: teamById[id], elo: db.elos[id], sim: simCache[id],
        explanation: explainTeam(id, db.elos, simCache[id], simCache),
      });
    }
    if (p === '/api/arbitrage') {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      await fetchMarkets(url.searchParams.get('force') === '1');
      return json(res, 200, {
        ts: marketCache.ts, errors: marketCache.errors, rows: arbitrage(),
        disclaimer: 'Estimaciones del modelo, no consejo financiero. Kalshi cobra comisiones (~7% de p·(1−p) por contrato) y Polymarket tiene spread/gas; un edge < 2-3% puede no ser rentable tras costos.',
      });
    }
    // --- admin: registrar resultados ---
    if (p === '/api/admin/result' && req.method === 'POST') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador puede registrar resultados' });
      const body = await readBody(req);
      const { matchId, hg, ag, status, minute, home, away, pensHome, remove } = body;
      const isGroup = /^G[A-L][1-6]$/.test(matchId);
      const isKO = /^(7[3-9]|8\d|9\d|10[0-4])$/.test(String(matchId));
      if (!isGroup && !isKO) return json(res, 400, { error: 'matchId inválido' });
      if (remove) {
        delete db.results[matchId];
      } else {
        if (!['live', 'final'].includes(status)) return json(res, 400, { error: 'status debe ser live o final' });
        const r = { hg: Number(hg) || 0, ag: Number(ag) || 0, status, minute: Number(minute) || 0 };
        if (isKO) { r.home = home; r.away = away; r.pensHome = !!pensHome; }
        db.results[matchId] = r;
      }
      recomputeElos();
      runSims();
      broadcast('update', { reason: remove ? 'resultado eliminado' : `resultado ${matchId}`, ts: Date.now() });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/refresh-markets' && req.method === 'POST') {
      await fetchMarkets(true);
      broadcast('markets', { ts: marketCache.ts });
      return json(res, 200, { ok: true, ts: marketCache.ts });
    }
    // --- estáticos ---
    let file = p === '/' ? '/index.html' : p;
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      return fs.createReadStream(full).pipe(res);
    }
    json(res, 404, { error: 'No encontrado' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`⚽ Simulador Mundial 2026 → http://localhost:${PORT}`);
  fetchMarkets().catch(() => { });
  setInterval(() => fetchMarkets(true).then(() => broadcast('markets', { ts: marketCache.ts })).catch(() => { }), 5 * 60 * 1000);
  // Sincronización automática de resultados desde ESPN cada 2 minutos
  syncFromESPN();
  setInterval(syncFromESPN, 2 * 60 * 1000);
  // En Render free el servicio duerme tras 15 min sin tráfico: auto-ping cada 10 min para mantenerlo 24/7
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL + '/api/version').catch(() => { }), 10 * 60 * 1000);
  }
});
