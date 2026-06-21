// Simulador Mundial 2026 — servidor sin dependencias (Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Carga variables desde un .env local SI existe (zero-dep, sin dotenv). En Render no hay .env:
// las variables vienen del dashboard. No sobreescribe variables ya definidas en el entorno.
// Debe correr ANTES de requerir data-providers (que lee process.env al cargar).
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch { /* nunca debe impedir el arranque */ }
})();
const { TEAMS, GROUPS, GROUP_FIXTURES, KNOCKOUT } = require('./data/tournament');
const { simulateTournament, matchProbs, probsFromLambdas, lambdas, liveMatchProbs, simulateH2H, makeRng, eloUpdate, explainTeam, effElo, assignThirds, cmpRows } = require('./engine');
const mailer = require('./mailer');
// Fase 4: capa de datos contextuales (API-Football principal → ESPN → manual). La UI nunca
// llama a estos providers ni ve la API key: solo recibe data normalizada vía /api/match y /api/teamdetail.
const providers = require('./data-providers');
const { generateGPTake } = require('./data-providers/gpTake');
// v2 piloto (solo sandbox): capa de contexto + análisis integral del cruce.
const { contextSignals, buildH2HAnalysis, adjustedLambdas, goalsMarkets, hashInputs, deriveSeed, mathSanity, VERSIONS } = require('./data-providers/gpIntelligence');
// v2 logging experimental (best-effort, tras feature flag).
const gpExperiment = require('./data-providers/gpExperimentLog');
const telegram = require('./telegram');
// Sprint 0 — plataforma de datos v2 (aislada tras feature flags). Requerirla NO abre conexión:
// el pool de pg se crea de forma perezosa solo si hay DATABASE_URL y alguien consulta la capa.
const platformHealth = require('./database/health');

const PORT = process.env.PORT || 3000;
const N_SIMS = Number(process.env.SIMS || 10000);
// DB_FILE puede apuntar a un disco persistente montado (p.ej. /data/db.json en Render Starter)
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');
const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));

// ---------- persistencia ----------
let db = { users: {}, sessions: {}, codes: {}, results: {}, elos: {}, history: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* primera ejecución */ }
TEAMS.forEach(t => { if (db.elos[t.id] == null) db.elos[t.id] = t.elo; });
db.sentAlerts = db.sentAlerts || {}; // inicializado temprano: markExistingFinalsSeen() lo usa al arrancar
db.sentTg = db.sentTg || {};         // inicializado temprano: markExistingTgSeen() lo usa al arrancar
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
markExistingFinalsSeen(); // no reenviar alertas de partidos ya finalizados antes de activar la feature
markExistingTgSeen();     // tampoco publicar en Telegram los finales ya ocurridos

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
    const liveAlerts = []; // {matchId,hId,aId,hg,ag,kind:'start'|'goal'}
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
        // detectar transiciones para alertas en vivo (inicio de partido / gol)
        try {
          const hId = gf ? gf.home : payload.home, aId = gf ? gf.away : payload.away;
          if (hId && aId && payload.status === 'live') {
            const wasLive = prev && (prev.status === 'live' || prev.status === 'final');
            const total = (payload.hg || 0) + (payload.ag || 0), ptotal = ((prev && prev.hg) || 0) + ((prev && prev.ag) || 0);
            if (!wasLive) liveAlerts.push({ matchId, hId, aId, hg: payload.hg, ag: payload.ag, kind: 'start' });
            else if (prev && total > ptotal) liveAlerts.push({ matchId, hId, aId, hg: payload.hg, ag: payload.ag, kind: 'goal' });
          }
        } catch { /* nunca romper el sync */ }
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
      // alertas de equipos seguidos (nunca debe romper el sync)
      if (depth === 0) dispatchPendingAlerts().catch(e => console.error('[alert] dispatch:', e.message));
      // alertas en vivo de inicio/gol (deduplicadas; el dedup evita dobles entre pasadas)
      if (liveAlerts.length) dispatchLiveAlerts(liveAlerts).catch(e => console.error('[alert] live:', e.message));
      // publicar resultados finales en el canal de Telegram (deduplicado)
      if (depth === 0) tgDispatchFinals().catch(e => console.error('[telegram] finals:', e.message));
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
  if (!force && Date.now() - marketCache.ts < 60 * 1000) return marketCache;
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

// ---------- mercados por partido (Polymarket: fifwc-*) ----------
// Los slugs usan códigos arbitrarios (kr, hai, rsa, che...) → descubrimiento por búsqueda
// de nombres, cacheado permanentemente en db.matchSlugs.
let matchMktCache = { ts: 0, matches: [] };
db.matchSlugs = db.matchSlugs || {};
db.marketSnapshots = db.marketSnapshots || {}; // probs implícitas del mercado capturadas antes del partido (closing line)
db.sentAlerts = db.sentAlerts || {};           // alertas ya enviadas por partido (evita reenvíos/spam)
db.refCodes = db.refCodes || {};               // referidos: code → email (lookup de quién refirió)

// Genera (si falta) un código de referido único para un usuario. Link: gpsimulador.com/?ref=<code>
function ensureRefCode(email) {
  const u = db.users[email];
  if (!u) return null;
  if (!u.refCode) {
    const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase() || 'gp';
    let code;
    do { code = base + crypto.randomBytes(2).toString('hex'); } while (db.refCodes[code]);
    u.refCode = code; db.refCodes[code] = email; save();
  }
  return u.refCode;
}

function teamTokens(id) {
  const t = teamById[id];
  return [t.en, ...t.aliases].map(normName);
}

async function discoverMatchSlug(f) {
  if (db.matchSlugs[f.id]) return db.matchSlugs[f.id];
  const h = teamById[f.home], a = teamById[f.away];
  const queries = [`${h.en} ${a.en}`, `${h.aliases[0] || h.en} ${a.aliases[0] || a.en}`];
  const fDate = new Date(f.datetime).getTime();
  for (const q of queries) {
    try {
      const r = await fetch(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=6`,
        { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      for (const ev of j.events || []) {
        if (!/^fifwc-/.test(ev.slug)) continue;
        const m = ev.slug.match(/(\d{4}-\d{2}-\d{2})$/);
        if (!m) continue;
        const dDiff = Math.abs(new Date(m[1] + 'T12:00Z').getTime() - fDate);
        if (dDiff > 2 * 86400000) continue; // otro partido de los mismos equipos
        const title = normName(ev.title || '');
        const hOk = teamTokens(f.home).some(t => title.includes(t));
        const aOk = teamTokens(f.away).some(t => title.includes(t));
        if (hOk && aOk) {
          db.matchSlugs[f.id] = ev.slug;
          save();
          console.log(`[matches] slug descubierto ${f.id} → ${ev.slug}`);
          return ev.slug;
        }
      }
    } catch { /* siguiente query */ }
  }
  return null;
}

async function fetchMatchMarkets(force = false) {
  if (!force && Date.now() - matchMktCache.ts < 60 * 1000) return matchMktCache;
  const now = Date.now();
  // grupos con horario + eliminatorias con equipos ya resueltos
  const bracket = resolveRealBracket();
  const upcoming = [
    ...GROUP_FIXTURES.map(f => ({ ...f, _h: f.home, _a: f.away })),
    ...KNOCKOUT.filter(k => bracket[k.m] && bracket[k.m].home && bracket[k.m].away)
      .map(k => ({ id: String(k.m), datetime: k.datetime || k.date + 'T18:00Z', _h: bracket[k.m].home, _a: bracket[k.m].away })),
  ].filter(f => {
    const t = new Date(f.datetime).getTime();
    return t > now - 5 * 3600000 && t < now + 60 * 3600000; // en vivo + próximas ~2.5 jornadas
  }).sort((x, y) => x.datetime.localeCompare(y.datetime));

  const out = [];
  let discoveries = 0;
  for (const f of upcoming) {
    let slug = db.matchSlugs[f.id];
    if (!slug && discoveries < 5) { discoveries++; slug = await discoverMatchSlug({ ...f, home: f._h, away: f._a }); }
    if (!slug) continue;
    try {
      const r = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`, { signal: AbortSignal.timeout(10000) });
      const ev = (await r.json())[0];
      if (!ev || !ev.markets) continue;
      const outcomes = {};
      for (const m of ev.markets) {
        let side = null;
        const gt = normName(m.groupItemTitle || m.question || '');
        if (/draw|empate/.test(gt)) side = 'draw';
        else if (teamTokens(f._h).some(t => gt.includes(t))) side = 'home';
        else if (teamTokens(f._a).some(t => gt.includes(t))) side = 'away';
        if (!side) continue;
        let price = null;
        try { price = Number(JSON.parse(m.outcomePrices)[0]); } catch { }
        outcomes[side] = {
          price, bid: m.bestBid != null ? Number(m.bestBid) : price,
          ask: m.bestAsk != null ? Number(m.bestAsk) : price,
          volume: Number(m.volumeNum || m.volume) || 0,
          url: `https://polymarket.com/event/${slug}/${m.slug}`,
        };
      }
      if (!outcomes.home || !outcomes.away) continue;
      // probabilidades del modelo (condicionadas al marcador si está en vivo)
      const res = db.results[f.id];
      const probs = (res && res.status === 'live')
        ? liveMatchProbs(effElo(db.elos, f._h), effElo(db.elos, f._a), res.hg, res.ag, res.minute)
        : matchProbs(effElo(db.elos, f._h), effElo(db.elos, f._a));
      // Reglas de recomendación:
      // - COMPRAR SÍ: respaldar un resultado infravalorado por el mercado, con prob. real ≥30% (nunca longshot).
      // - COMPRAR NO: ir contra un resultado SOBREVALORADO, pero NUNCA contra el favorito del modelo
      //   (apostar contra tu propio pronóstico no tiene sentido).
      const MIN_BACK = 0.30;
      const top = ['home', 'draw', 'away'].reduce((a, b) => probs[a] >= probs[b] ? a : b); // pick del modelo
      const edges = [];
      for (const side of ['home', 'draw', 'away']) {
        const o = outcomes[side]; if (!o) continue;
        const p = probs[side];
        if (o.ask > 0.001 && p - o.ask > 0.04 && p >= MIN_BACK) edges.push({ side, type: 'COMPRAR SÍ', edge: +(p - o.ask).toFixed(4) });
        else if (o.bid > 0.001 && o.bid - p > 0.04 && (1 - p) >= MIN_BACK && side !== top) edges.push({ side, type: 'COMPRAR NO', edge: +(o.bid - p).toFixed(4) });
      }
      // Snapshot del mercado ANTES del kickoff (probs implícitas sin vig) para el marcador modelo-vs-mercado.
      // Se sobreescribe hasta que arranca el partido → queda la "closing line".
      const sumP = (outcomes.home ? outcomes.home.price : 0) + (outcomes.draw ? outcomes.draw.price : 0) + (outcomes.away ? outcomes.away.price : 0);
      if (sumP > 0.5 && Date.now() < new Date(f.datetime).getTime()) {
        db.marketSnapshots[f.id] = {
          home: +((outcomes.home ? outcomes.home.price : 0) / sumP).toFixed(4),
          draw: +((outcomes.draw ? outcomes.draw.price : 0) / sumP).toFixed(4),
          away: +((outcomes.away ? outcomes.away.price : 0) / sumP).toFixed(4),
          ts: Date.now(),
        };
        save();
      }
      out.push({
        fixtureId: f.id, home: f._h, away: f._a, datetime: f.datetime,
        live: !!(res && res.status === 'live'), result: res || null,
        outcomes, model: { home: probs.home, draw: probs.draw, away: probs.away }, edges,
        eventUrl: `https://polymarket.com/event/${slug}`,
      });
    } catch { /* partido sin mercado accesible */ }
  }
  matchMktCache = { ts: Date.now(), matches: out };
  return matchMktCache;
}

// ---------- track record público del modelo ----------
function trackRecord() {
  const elos = {};
  TEAMS.forEach(t => { elos[t.id] = t.elo; });
  const finished = [];
  const koFin = KNOCKOUT.filter(k => {
    const r = db.results[String(k.m)];
    return r && r.status === 'final' && r.home && r.away;
  }).map(k => ({ id: String(k.m), datetime: k.datetime || k.date, ko: true }));
  const all = [
    ...GROUP_FIXTURES.filter(f => db.results[f.id] && db.results[f.id].status === 'final')
      .map(f => ({ id: f.id, datetime: f.datetime, home: f.home, away: f.away })),
    ...koFin,
  ].sort((x, y) => String(x.datetime).localeCompare(String(y.datetime)));
  for (const f of all) {
    const r = db.results[f.id];
    const h = f.home || r.home, a = f.away || r.away;
    // predicción con los Elo PREVIOS a ese partido (lo que el modelo decía antes del pitazo)
    const probs = matchProbs(effElo(elos, h), effElo(elos, a));
    const picks = [['home', probs.home], ['draw', probs.draw], ['away', probs.away]].sort((x, y) => y[1] - x[1]);
    const predicted = picks[0][0];
    const actual = r.hg > r.ag ? 'home' : r.hg < r.ag ? 'away' : 'draw';
    finished.push({
      id: f.id, datetime: f.datetime, home: h, away: a, hg: r.hg, ag: r.ag,
      predicted, predictedProb: +picks[0][1].toFixed(4),
      probs: { home: +probs.home.toFixed(4), draw: +probs.draw.toFixed(4), away: +probs.away.toFixed(4) },
      likelyScore: probs.likelyScore,
      correct: predicted === actual,
      exact: probs.likelyScore === `${r.hg}-${r.ag}`,
    });
    const [nh, na] = eloUpdate(elos[h], elos[a], r.hg, r.ag, teamById[h].host, teamById[a].host);
    elos[h] = nh; elos[a] = na;
  }
  // calibración: Brier multiclase (0=perfecto, 0.66=azar 3-vías) y prob. media al resultado real
  let brier = 0, sumActual = 0;
  for (const m of finished) {
    const act = m.hg > m.ag ? 'home' : m.hg < m.ag ? 'away' : 'draw';
    ['home', 'draw', 'away'].forEach(k => { const o = k === act ? 1 : 0; brier += (m.probs[k] - o) ** 2; });
    sumActual += m.probs[act];
  }
  const n = finished.length || 1;
  return {
    total: finished.length,
    winners: finished.filter(x => x.correct).length,
    exact: finished.filter(x => x.exact).length,
    brier: +(brier / n).toFixed(3),
    avgProbActual: +(sumActual / n).toFixed(3),
    vsMarket: scoreboard(finished),
    matches: finished.reverse(),
  };
}

// Marcador objetivo: ¿le ganamos al mercado? Compara Brier del modelo vs Brier del mercado
// en los partidos donde capturamos la línea de cierre (snapshot pre-partido).
function scoreboard(finished) {
  let mb = 0, kb = 0, nn = 0, modelWins = 0;
  const rows = [];
  for (const m of finished) {
    const snap = db.marketSnapshots[m.id];
    if (!snap) continue;
    const act = m.hg > m.ag ? 'home' : m.hg < m.ag ? 'away' : 'draw';
    let bm = 0, bk = 0;
    ['home', 'draw', 'away'].forEach(k => {
      const o = k === act ? 1 : 0;
      bm += (m.probs[k] - o) ** 2;
      bk += ((snap[k] || 0) - o) ** 2;
    });
    mb += bm; kb += bk; nn++;
    if (bm < bk) modelWins++;
    rows.push({ id: m.id, home: m.home, away: m.away, modelBrier: +bm.toFixed(3), marketBrier: +bk.toFixed(3), modelWon: bm < bk });
  }
  return {
    n: nn,
    modelBrier: nn ? +(mb / nn).toFixed(3) : null,
    marketBrier: nn ? +(kb / nn).toFixed(3) : null,
    modelWins, rows: rows.reverse(),
  };
}

// ---------- alertas por email de equipos seguidos ----------
function matchTeams(matchId) {
  const r = db.results[matchId];
  if (!r || r.status !== 'final') return null;
  if (/^G/.test(matchId)) {
    const f = GROUP_FIXTURES.find(x => x.id === matchId);
    return f ? { home: f.home, away: f.away, hg: r.hg, ag: r.ag } : null;
  }
  return (r.home && r.away) ? { home: r.home, away: r.away, hg: r.hg, ag: r.ag } : null;
}

function alertEmail(followedNames, info, champLine) {
  const h = teamById[info.home], a = teamById[info.away];
  const won = info.hg > info.ag ? h.name : info.hg < info.ag ? a.name : null;
  const resLine = won ? `Ganó ${won}` : 'Terminó en empate';
  const subject = `⚽ ${h.name} ${info.hg}-${info.ag} ${a.name}`;
  const text = `Actualización de ${followedNames.join(' y ')}:\n\n${h.flag} ${h.name} ${info.hg} - ${info.ag} ${a.name} ${a.flag}\n${resLine}.\n\n${champLine}\n\nMira las probabilidades actualizadas: https://gpsimulador.com\n\n— GP Simulador del Mundial\n(Para dejar de recibir estas alertas, entra y desactívalas en la pestaña Seguidos.)`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#14201A">
<h2 style="margin-bottom:4px">⚽ GP Simulador del Mundial</h2>
<p style="color:#555">Actualización de <b>${followedNames.join(' y ')}</b></p>
<div style="background:#0E2A1E;color:#fff;border-radius:12px;padding:18px 20px;text-align:center;margin:14px 0">
  <div style="font-size:26px;font-weight:800">${h.flag} ${info.hg} - ${info.ag} ${a.flag}</div>
  <div style="font-size:14px;color:#9FD9BE;margin-top:4px">${h.name} vs ${a.name} · ${resLine}</div>
</div>
<p style="font-size:14px">${champLine}</p>
<p><a href="https://gpsimulador.com" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:99px">Ver probabilidades actualizadas →</a></p>
<p style="color:#999;font-size:11px">Para dejar de recibir alertas, entra y desactívalas en la pestaña Seguidos.</p>
</div>`;
  return { subject, text, html };
}

// Envía alertas de un partido finalizado a quienes siguen alguno de los dos equipos
async function sendTeamAlerts(matchIds) {
  if (!mailer.isConfigured()) return;
  for (const matchId of matchIds) {
    if (db.sentAlerts[matchId]) continue;
    const info = matchTeams(matchId);
    if (!info) continue;
    let sent = 0;
    for (const [email, u] of Object.entries(db.users)) {
      if (u.alerts === false) continue;
      const prefs = u.alertPrefs || {};
      const ev = prefs.events || {}, ch = prefs.channels || {};
      if (ev.result === false) continue;        // evento "resultado final" desactivado
      if (ch.email === false) continue;          // canal email desactivado
      const muted = prefs.mutedTeams || [];
      const favs = u.favorites || [];
      const followed = [info.home, info.away].filter(t => favs.includes(t) && !muted.includes(t));
      if (!followed.length) continue;
      const names = followed.map(t => teamById[t].name);
      // línea de campeonato del primer equipo seguido
      const ft = followed[0];
      const champ = simCache[ft] ? (simCache[ft].champion * 100).toFixed(1) : null;
      const champLine = champ ? `Probabilidad de ${teamById[ft].name} de ser campeón ahora: ${champ}%.` : '';
      try {
        await mailer.sendMail({ to: email, ...alertEmail(names, info, champLine) });
        sent++;
      } catch (e) { console.error('[alert]', email, e.message); }
    }
    db.sentAlerts[matchId] = Date.now();
    save();
    if (sent) console.log(`[alert] ${matchId}: ${sent} correos enviados`);
  }
}

// Email de alerta en vivo (inicio de partido / gol)
// Email masivo de novedades (re-engancha a usuarios que entraron antes de las nuevas features)
function broadcastEmail(refLink) {
  const subject = '⚽ Tu GP Simulador del Mundial ahora tiene MUCHO más';
  const text = `Hola 👋\n\nDesde que entraste, le agregamos un montón de cosas al GP Simulador del Mundial:\n\n• Página de cada partido con alineaciones confirmadas, eventos en vivo, stats (posesión, tiros, xG) y nuestro GP Take.\n• Página de cada selección: plantilla, jugadores clave, forma, cruces probables y mercados.\n• Alertas por email cuando empieza el partido y cuando hay GOL de tus equipos seguidos.\n• Probabilidades que se mueven en vivo con cada gol + escáner de oportunidades modelo vs mercado (Polymarket/Kalshi).\n• Track record público y honesto del modelo (Brier).\n\nEntra y míralo: https://gpsimulador.com\n\n✈️ Únete a nuestro canal de Telegram para recibir oportunidades y resultados en vivo: https://t.me/gpsimulador\n\n¿Te gusta? Invita a tus amigos con tu link personal y conviértete en Embajador del GP Simulador 🏅:\n${refLink}\n\n— GP Simulador del Mundial`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#14201A">
  <h2 style="margin:0 0 6px">⚽ GP Simulador del Mundial</h2>
  <p style="color:#555;margin:0 0 16px">Desde que entraste, le agregamos <b>muchísimo</b>:</p>
  <div style="background:#0E2A1E;color:#fff;border-radius:14px;padding:20px 22px;margin:0 0 18px">
    <ul style="margin:0;padding-left:18px;line-height:1.7;font-size:14px">
      <li><b>Página de cada partido</b>: alineaciones confirmadas, eventos en vivo, stats (posesión, tiros, xG) y GP Take.</li>
      <li><b>Página de cada selección</b>: plantilla, jugadores clave, forma, cruces probables y mercados.</li>
      <li><b>Alertas</b> por email al iniciar el partido y en cada <b>gol</b> de tus equipos seguidos.</li>
      <li><b>Oportunidades</b> modelo vs mercado (Polymarket/Kalshi) que se mueven en vivo.</li>
      <li><b>Track record</b> público y honesto del modelo.</li>
    </ul>
  </div>
  <p style="text-align:center;margin:0 0 18px"><a href="https://gpsimulador.com" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:800;padding:14px 28px;border-radius:99px;font-size:15px">Ver las novedades →</a></p>
  <div style="background:#EAF6FF;border:1px solid #cfe6fb;border-radius:12px;padding:14px 16px;margin:0 0 18px;text-align:center">
    <p style="font-size:14px;margin:0 0 8px;color:#14201A"><b>✈️ Únete a nuestro canal de Telegram</b></p>
    <p style="font-size:13px;color:#555;margin:0 0 10px">Oportunidades, resultados y novedades en vivo, directo a tu teléfono.</p>
    <a href="https://t.me/gpsimulador" style="display:inline-block;background:#229ED9;color:#fff;text-decoration:none;font-weight:700;padding:10px 22px;border-radius:99px;font-size:14px">Unirme al canal →</a>
  </div>
  <div style="border-top:1px solid #e3e8e6;padding-top:16px">
    <p style="font-size:14px;margin:0 0 8px"><b>🎁 Invita y sube de nivel</b></p>
    <p style="font-size:13px;color:#555;margin:0 0 10px">Comparte tu link personal. Cada amigo que se una te sube como <b>Embajador</b> del GP Simulador — los Embajadores tendrán beneficios exclusivos más adelante.</p>
    <p style="font-size:13px;margin:0"><a href="${refLink}" style="color:#0E9F6E;font-weight:700">${refLink}</a></p>
  </div>
  <p style="color:#999;font-size:11px;margin-top:20px">Recibes esto porque tienes cuenta en GP Simulador del Mundial.</p>
</div>`;
  return { subject, text, html };
}

function liveAlertEmail(h, aw, a) {
  const isGoal = a.kind === 'goal';
  const subject = isGoal ? `⚽ GOL · ${h.name} ${a.hg}-${a.ag} ${aw.name}` : `▶ Empezó · ${h.name} vs ${aw.name}`;
  const head = isGoal ? '⚽ ¡Gol!' : '▶ ¡Arrancó el partido!';
  const line = isGoal ? `${h.flag} ${h.name} ${a.hg} - ${a.ag} ${aw.name} ${aw.flag}` : `${h.flag} ${h.name} vs ${aw.name} ${aw.flag}`;
  const text = `${head}\n\n${line}\n\nSigue las probabilidades EN VIVO: https://gpsimulador.com\n\n— GP Simulador del Mundial\n(Gestiona tus alertas en la pestaña Alertas.)`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#14201A">
<h2 style="margin-bottom:4px">${head}</h2>
<div style="background:#0E2A1E;color:#fff;border-radius:12px;padding:18px 20px;text-align:center;margin:14px 0">
  <div style="font-size:26px;font-weight:800">${isGoal ? `${h.flag} ${a.hg} - ${a.ag} ${aw.flag}` : `${h.flag} vs ${aw.flag}`}</div>
  <div style="font-size:14px;color:#9FD9BE;margin-top:4px">${h.name} ${isGoal ? 'vs' : 'vs'} ${aw.name}</div>
</div>
<p><a href="https://gpsimulador.com" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:99px">Ver probabilidades EN VIVO →</a></p>
<p style="color:#999;font-size:11px">Gestiona o desactiva tus alertas en la pestaña Alertas.</p>
</div>`;
  return { subject, text, html };
}

// Despacha alertas en vivo (inicio/gol) a quienes siguen alguno de los dos equipos. Deduplicado por clave.
async function dispatchLiveAlerts(list) {
  if (!mailer.isConfigured()) return;
  for (const a of list) {
    const key = a.kind === 'start' ? `${a.matchId}:start` : `${a.matchId}:g${a.hg}-${a.ag}`;
    if (db.sentAlerts[key]) continue;
    const h = teamById[a.hId], aw = teamById[a.aId];
    if (!h || !aw) continue;
    let sent = 0;
    for (const [email, u] of Object.entries(db.users)) {
      if (u.alerts === false) continue;
      const prefs = u.alertPrefs || {};
      const ev = prefs.events || {}, ch = prefs.channels || {};
      if (ch.email === false) continue;
      if (a.kind === 'start' && ev.matchStart === false) continue;
      if (a.kind === 'goal' && ev.goal === false) continue;
      const muted = prefs.mutedTeams || [];
      const favs = u.favorites || [];
      if (![a.hId, a.aId].some(t => favs.includes(t) && !muted.includes(t))) continue;
      try { await mailer.sendMail({ to: email, ...liveAlertEmail(h, aw, a) }); sent++; }
      catch (e) { console.error('[alert]', email, e.message); }
    }
    db.sentAlerts[key] = Date.now();
    save();
    if (sent) console.log(`[alert] ${a.kind} ${a.matchId}: ${sent} correos enviados`);
  }
}

// Revisa todos los partidos finalizados y alerta los que aún no se han notificado
async function dispatchPendingAlerts() {
  const finals = [];
  for (const f of GROUP_FIXTURES) {
    const r = db.results[f.id];
    if (r && r.status === 'final' && !db.sentAlerts[f.id]) finals.push(f.id);
  }
  for (const k of KNOCKOUT) {
    const id = String(k.m), r = db.results[id];
    if (r && r.status === 'final' && r.home && !db.sentAlerts[id]) finals.push(id);
  }
  if (finals.length) await sendTeamAlerts(finals);
}

// Al arrancar: marca como "ya vistos" los partidos finalizados existentes (no reenviar histórico)
function markExistingFinalsSeen() {
  let n = 0;
  const mark = id => { if (db.results[id] && db.results[id].status === 'final' && !db.sentAlerts[id]) { db.sentAlerts[id] = Date.now(); n++; } };
  GROUP_FIXTURES.forEach(f => mark(f.id));
  KNOCKOUT.forEach(k => mark(String(k.m)));
  if (n) { save(); console.log(`[alert] ${n} partidos finalizados marcados como vistos (sin reenviar)`); }
}

// ---------- Telegram: auto-publicación al canal ----------
db.sentTg = db.sentTg || {}; // dedup de lo ya publicado en Telegram
const tgPct = v => (v * 100).toFixed(0) + '%';

// "Lo que dice el modelo para hoy" — próximos partidos del día con 1X2 del modelo
function tgDailyText() {
  const today = new Date().toISOString().slice(0, 10);
  const ups = GROUP_FIXTURES
    .filter(f => f.datetime.slice(0, 10) === today && !(db.results[f.id] && db.results[f.id].status === 'final'))
    .sort((a, b) => a.datetime.localeCompare(b.datetime)).slice(0, 6);
  if (!ups.length) return null;
  const lines = ups.map(f => {
    const p = matchProbs(effElo(db.elos, f.home), effElo(db.elos, f.away));
    const h = teamById[f.home], a = teamById[f.away];
    return `${h.flag} <b>${h.name}</b> vs <b>${a.name}</b> ${a.flag}\n   ${tgPct(p.home)} · empate ${tgPct(p.draw)} · ${tgPct(p.away)}`;
  });
  return `📊 <b>Lo que dice el modelo para hoy</b>\n\n${lines.join('\n')}\n\n⚡ Se mueven en vivo con cada gol:\n👉 <a href="https://gpsimulador.com/?ref=tg">gpsimulador.com</a>`;
}
function tgFinalText(id) {
  const info = matchTeams(id); if (!info) return null;
  const h = teamById[info.home], a = teamById[info.away];
  const won = info.hg > info.ag ? h.name : info.hg < info.ag ? a.name : null;
  return `⚽ <b>FINAL</b>\n${h.flag} <b>${h.name} ${info.hg} - ${info.ag} ${a.name}</b> ${a.flag}\n${won ? 'Ganó ' + won : 'Terminó en empate'}\n\n👉 <a href="https://gpsimulador.com/?ref=tg">Probabilidades actualizadas</a>`;
}
function tgOppText(row, e) {
  const t = teamById[row.id], pc = v => (v * 100).toFixed(1);
  if (e.type === 'arbitraje') return `🔺 <b>Arbitraje puro</b> · ${t.flag} ${t.name}\n${e.note}\n\n👉 <a href="https://gpsimulador.com/?ref=tg">Ver en gpsimulador.com</a>`;
  return `🟢 <b>Oportunidad de valor</b>\n${t.flag} <b>${t.name}</b> · campeón · ${e.venue}\nPrecio ${pc(e.price)}¢ · Modelo ${pc(row.model)}% · Edge +${pc(e.edge)}%\n\n👉 <a href="https://gpsimulador.com/?ref=tg">gpsimulador.com</a>`;
}
// Publica finales nuevos al canal (no reenvía)
async function tgDispatchFinals() {
  if (!telegram.configured()) return;
  const ids = [];
  GROUP_FIXTURES.forEach(f => { const r = db.results[f.id]; if (r && r.status === 'final' && !db.sentTg['final:' + f.id]) ids.push(f.id); });
  KNOCKOUT.forEach(k => { const id = String(k.m), r = db.results[id]; if (r && r.status === 'final' && r.home && !db.sentTg['final:' + id]) ids.push(id); });
  for (const id of ids) { const t = tgFinalText(id); if (t && await telegram.post(t)) { db.sentTg['final:' + id] = Date.now(); save(); } }
}
// Tick periódico: resumen diario (ventana mañana América) + 1 oportunidad fuerte nueva
async function tgTick() {
  if (!telegram.configured()) return;
  try {
    const now = new Date(), day = now.toISOString().slice(0, 10), h = now.getUTCHours();
    if (h >= 13 && h < 16 && !db.sentTg['daily:' + day]) {
      const t = tgDailyText();
      if (t && await telegram.post(t)) { db.sentTg['daily:' + day] = Date.now(); save(); }
    }
    let best = null;
    for (const row of arbitrage()) for (const e of row.edges) {
      const strong = (e.type === 'valor' && e.edge >= 0.06) || (e.type === 'arbitraje' && e.edge >= 0.02);
      if (!strong) continue;
      const key = `opp:${day}:${row.id}:${e.type}:${e.venue}:${e.side}`;
      if (db.sentTg[key]) continue;
      if (!best || e.edge > best.e.edge) best = { row, e, key };
    }
    if (best) { const t = tgOppText(best.row, best.e); if (t && await telegram.post(t)) { db.sentTg[best.key] = Date.now(); save(); } }
  } catch (e) { console.error('[telegram] tick:', e.message); }
}
// Al arrancar: marca finales existentes como ya publicados (no backfillear el canal)
function markExistingTgSeen() {
  let n = 0;
  const mark = id => { if (db.results[id] && db.results[id].status === 'final' && !db.sentTg['final:' + id]) { db.sentTg['final:' + id] = Date.now(); n++; } };
  GROUP_FIXTURES.forEach(f => mark(f.id));
  KNOCKOUT.forEach(k => mark(String(k.m)));
  if (n) save();
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

// ---------- Fase 4: detalle profundo de PARTIDO y EQUIPO ----------
// Reutiliza el modelo y los mercados existentes (no los modifica) y los fusiona con la
// data contextual de la capa de providers. Devuelve objetos Normalized* listos para la UI.
const STAGE_LABEL = { R32: '16avos', R16: 'Octavos', QF: 'Cuartos', SF: 'Semifinal', '3RD': '3er puesto', FINAL: 'Final', group: 'Grupos' };

function findFixtureMeta(id) {
  if (/^G/.test(id)) {
    const f = GROUP_FIXTURES.find(x => x.id === id);
    if (!f) return null;
    return { id, kind: 'group', home: f.home, away: f.away, datetime: f.datetime, group: f.group, espnId: f.espnId, stage: 'group' };
  }
  const k = KNOCKOUT.find(x => String(x.m) === String(id));
  if (!k) return null;
  const bracket = resolveRealBracket();
  const r = db.results[String(k.m)];
  const home = (r && r.home) || (bracket[k.m] && bracket[k.m].home) || null;
  const away = (r && r.away) || (bracket[k.m] && bracket[k.m].away) || null;
  return { id: String(id), kind: 'ko', m: k.m, home, away, datetime: k.datetime || (k.date + 'T18:00Z'), group: null, espnId: null, stage: k.stage };
}

function modelProbsFor(home, away, result) {
  if (!home || !away) return null;
  return (result && result.status === 'live')
    ? liveMatchProbs(effElo(db.elos, home), effElo(db.elos, away), result.hg, result.ag, result.minute)
    : matchProbs(effElo(db.elos, home), effElo(db.elos, away));
}

// Mercados de goles aproximados desde las tasas Poisson (para "ángulos" sin mercado externo)
function goalsAngles(lh, la) {
  const pmf = (l, k) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
  const tot = lh + la;
  const over25 = 1 - (pmf(tot, 0) + pmf(tot, 1) + pmf(tot, 2));
  const btts = (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
  return { over25: Math.max(0, Math.min(1, over25)), btts: Math.max(0, Math.min(1, btts)) };
}
function gradeLabel(edge) {
  if (edge >= 0.10) return 'STRONG';
  if (edge >= 0.04) return 'LEAN';
  if (edge >= 0.02) return 'WATCH';
  return 'PASS';
}
const basicTeam = id => { const t = id && teamById[id]; return t ? { id: t.id, name: t.name, flag: t.flag, group: t.group } : { id: null, name: 'Por definir', flag: '', group: null }; };

async function buildMatchDetail(id) {
  const meta = findFixtureMeta(id);
  if (!meta) return null;
  await fetchMatchMarkets(false).catch(() => { });
  const result = db.results[meta.id] || null;
  const status = result && result.status === 'live' ? 'live' : result && result.status === 'final' ? 'final' : 'scheduled';
  const th = meta.home && teamById[meta.home], ta = meta.away && teamById[meta.away];
  const probs = modelProbsFor(meta.home, meta.away, result);
  const mkt = (matchMktCache.matches || []).find(m => m.fixtureId === meta.id) || null;
  const outcomes = mkt ? mkt.outcomes : null;
  const names = { home: th ? th.name : 'Local', away: ta ? ta.name : 'Visitante', draw: 'el empate' };

  const marketPrices = [];
  if (outcomes) for (const side of ['home', 'draw', 'away']) {
    const o = outcomes[side]; if (!o) continue;
    marketPrices.push({ venue: 'Polymarket', side, price: o.price, bid: o.bid, ask: o.ask, volume: o.volume, url: o.url });
  }

  // Contexto externo (lineups, eventos, stats, forma, lesiones, noticias, odds) — se obtiene
  // ANTES del GP Take para que las bajas confirmadas puedan informar la lectura (Opción C).
  const namesOf = t => t ? [t.en, t.name, ...(t.aliases || [])] : [];
  const ctx = await providers.getMatchContext({
    homeCode: meta.home, awayCode: meta.away,
    homeName: th ? th.en : '', awayName: ta ? ta.en : '',
    homeNames: namesOf(th), awayNames: namesOf(ta),
    isoDate: meta.datetime, espnId: meta.espnId,
    isLive: status === 'live', isFinal: status === 'final',
  }).catch(() => null);

  // Bajas confirmadas por lado: SOLO informan el GP Take (driver + confianza). NO tocan el modelo.
  const injBySide = { home: { team: names.home, players: [] }, away: { team: names.away, players: [] } };
  ((ctx && ctx.injuries) || []).forEach(i => {
    if ((i.side === 'home' || i.side === 'away') && ['injured', 'suspended', 'doubt'].includes(i.status)) injBySide[i.side].players.push(i.player);
  });

  // GP Take determinístico
  let gpTake = null;
  if (probs) {
    const liq = outcomes ? ['home', 'draw', 'away'].reduce((s, k) => s + (outcomes[k] ? outcomes[k].volume || 0 : 0), 0) : 0;
    gpTake = generateGPTake({ home: probs.home, draw: probs.draw, away: probs.away }, outcomes, names, { liquidityUsd: liq, injuries: injBySide });
  }

  // Ángulos de mercado
  const marketAngles = [];
  if (probs) {
    if (outcomes && mkt) {
      const top = ['home', 'draw', 'away'].reduce((a, b) => probs[a] >= probs[b] ? a : b);
      const e = (mkt.edges || []).slice().sort((x, y) => y.edge - x.edge)[0];
      const pickSide = e ? e.side : top;
      marketAngles.push({
        market: 'Resultado (1X2)', pick: names[pickSide] + (e ? ` · ${e.type}` : ''),
        modelProb: probs[pickSide], marketPrice: outcomes[pickSide] ? outcomes[pickSide].price : null,
        edge: e ? e.edge : 0, grade: gradeLabel(e ? e.edge : 0), venue: 'Polymarket',
        note: e ? 'El modelo difiere del precio del mercado.' : 'Modelo y mercado prácticamente alineados.',
      });
    }
    const gm = goalsAngles(probs.xgHome, probs.xgAway);
    marketAngles.push({ market: 'Más de 2.5 goles', pick: 'Over 2.5', modelProb: gm.over25, marketPrice: null, edge: 0, grade: 'WATCH', venue: null, note: 'Estimación del modelo por ritmo de goles proyectado. Sin mercado comparable cargado.' });
    marketAngles.push({ market: 'Ambos anotan', pick: 'BTTS Sí', modelProb: gm.btts, marketPrice: null, edge: 0, grade: 'WATCH', venue: null, note: 'Estimación del modelo. Sin mercado comparable cargado.' });
  }

  return {
    id: meta.id, date: meta.datetime, status,
    minute: result ? result.minute : undefined,
    group: meta.group, stage: meta.stage, stageLabel: STAGE_LABEL[meta.stage] || null,
    homeTeam: basicTeam(meta.home), awayTeam: basicTeam(meta.away),
    score: result ? { home: result.hg, away: result.ag } : undefined,
    modelProbabilities: probs ? {
      homeWin: probs.home, draw: probs.draw, awayWin: probs.away,
      xgHome: probs.xgHome, xgAway: probs.xgAway, likelyScore: probs.likelyScore, live: !!probs.live,
    } : undefined,
    marketPrices, eventUrl: mkt ? mkt.eventUrl : null,
    odds: ctx ? ctx.odds : [],
    events: ctx ? ctx.events : [],
    statistics: ctx ? ctx.statistics : null,
    lineups: ctx ? ctx.lineups : { home: null, away: null },
    injuries: ctx ? ctx.injuries : [],
    recentForm: ctx ? ctx.recentForm : { home: null, away: null },
    gpTake, marketAngles,
    news: ctx ? ctx.news : [],
    providerStatus: ctx ? ctx.providerStatus : null,
    updatedAt: new Date().toISOString(),
  };
}

// ---------- v2 piloto: cruce profundo del sandbox "GP Intelligence" ----------
const h2hDeepCache = new Map(); // `${a}_${b}` -> { ts, data }
const H2H_DEEP_TTL = 10 * 60 * 1000;
const namesOfTeam = t => t ? [t.en, t.name, ...(t.aliases || [])].filter(Boolean) : [];

function formSummary(f) {
  if (!f || !f.played) return null;
  return {
    played: f.played, results: f.results || [], points: f.points,
    goalsFor: f.goalsFor, goalsAgainst: f.goalsAgainst, cleanSheets: f.cleanSheets,
    avgFor: f.avgFor, avgAgainst: f.avgAgainst, streak: f.streak || '',
    last: (f.last || []).slice(0, 5),
  };
}

function restDaysFromResults(results) {
  if (!results || !results.length) return null;
  const now = Date.now();
  const past = results.map(r => new Date(r.date).getTime()).filter(t => !isNaN(t) && t <= now);
  if (!past.length) return null;
  return Math.round((now - Math.max(...past)) / (24 * 3600 * 1000));
}

// Logging experimental de una ejecución de GP Intelligence (best-effort; flag + DB). NO incluye secretos.
async function logGpIntelligenceRun({ a, b, base, v2, csA, csB, inputHash, randomSeed, SIMS, analysis }) {
  return gpExperiment.logRun({
    analysisType: 'h2h_sandbox', status: analysis.headline ? 'completed' : 'partial',
    completedAt: new Date().toISOString(),
    controlModelVersion: VERSIONS.control, challengerModelVersion: VERSIONS.challenger, factorPolicyVersion: VERSIONS.factorPolicy,
    inputHash, randomSeed, simulationCount: SIMS,
    teamAReference: a, teamBReference: b, eventReference: a + '_' + b,
    inputPayload: { a, b, eloA: Math.round(db.elos[a]), eloB: Math.round(db.elos[b]) },
    contextPayload: { factorsA: csA.factors, factorsB: csB.factors, groupsA: csA.groupCapped, groupsB: csB.groupCapped },
    controlOutput: base, challengerOutput: v2,
    dataQualityPayload: { a: csA.dataQuality, b: csB.dataQuality, modelConfidence: analysis.headline && analysis.headline.modelConfidence },
    metadata: { verdictLabel: analysis.headline && analysis.headline.verdictLabel },
  });
}

async function buildH2HDeep(a, b) {
  const key = a + '_' + b;
  const hit = h2hDeepCache.get(key);
  if (hit && Date.now() - hit.ts < H2H_DEEP_TTL) return hit.data;

  const ta = teamById[a], tb = teamById[b];
  // 1) PRIOR: modelo base neutral (sin bono local)
  const base = matchProbs(db.elos[a], db.elos[b]);
  const baseLine = { aWin: base.home, draw: base.draw, bWin: base.away, xgA: base.xgHome, xgB: base.xgAway, likely: base.likelyScore };

  // 2) CONTEXTO total de ambos + calidad de plantilla (ratings reales). Nunca lanza.
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };
  const [ctxA, ctxB, sqA, sqB] = await Promise.all([
    safe(() => providers.getTeamContext({ code: a, name: ta.en, names: namesOfTeam(ta) })),
    safe(() => providers.getTeamContext({ code: b, name: tb.en, names: namesOfTeam(tb) })),
    safe(() => providers.getSquadRating({ code: a, name: ta.en, names: namesOfTeam(ta) })),
    safe(() => providers.getSquadRating({ code: b, name: tb.en, names: namesOfTeam(tb) })),
  ]);

  // 3) Descanso/carga desde fechas de resultados recientes
  const restA = restDaysFromResults(ctxA && ctxA.results), restB = restDaysFromResults(ctxB && ctxB.results);

  // 4) Señales → breakdown completo por factor + ajuste de Elo (con caps por grupo + safety cap global).
  //    Frescura: marcamos fetched_at = ahora por fuente (source_updated_at desconocido en API-Football).
  const now = Date.now(), nowIso = new Date(now).toISOString();
  const fetchedAt = { form: nowIso, injuries: nowIso, squad: nowIso, rest: nowIso };
  const csA = contextSignals(ctxA, ta.name, { squadRating: sqA, restDays: restA, oppRestDays: restB, now, fetchedAt, baseElo: Math.round(db.elos[a]) });
  const csB = contextSignals(ctxB, tb.name, { squadRating: sqB, restDays: restB, oppRestDays: restA, now, fetchedAt, baseElo: Math.round(db.elos[b]) });
  const eloA2 = db.elos[a] + csA.finalCappedTotal, eloB2 = db.elos[b] + csB.finalCappedTotal;

  // 5) xG ESPECÍFICO POR EQUIPO (eje xG, separado del eje Elo)
  const [lAelo, lBelo] = lambdas(eloA2, eloB2);
  const [lA, lB, beta] = adjustedLambdas(lAelo, lBelo, csA.goalProfile, csB.goalProfile);

  // 6) Reproducibilidad: seed determinístico desde el hash de los inputs (misma entrada → misma seed).
  const inputHash = hashInputs({ a, b, eloA: db.elos[a], eloB: db.elos[b], dA: csA.finalCappedTotal, dB: csB.finalCappedTotal, lA: +lA.toFixed(6), lB: +lB.toFixed(6), v: VERSIONS.challenger });
  const randomSeed = deriveSeed(inputHash);
  const SIMS = 10000;

  // 7) v2: 1X2 desde tasas ajustadas + Monte Carlo 10k REPRODUCIBLE (seed fija)
  const v2 = probsFromLambdas(lA, lB);
  const v2Line = { aWin: v2.home, draw: v2.draw, bWin: v2.away, xgA: lA, xgB: lB, likely: v2.likelyScore };
  const mc = simulateH2H(0, 0, SIMS, makeRng(randomSeed), [lA, lB]);
  const goals = goalsMarkets(mc, lA, lB);

  // 8) Sanity matemático + análisis integral (V1 control vs V2 challenger)
  const sanity = mathSanity({ v2: v2Line, goals, mc, deltaA: csA.finalCappedTotal, deltaB: csB.finalCappedTotal });
  const aMeta = { code: a, name: ta.name, flag: ta.flag }, bMeta = { code: b, name: tb.name, flag: tb.flag };
  const analysis = buildH2HAnalysis({ a: aMeta, b: bMeta, base: baseLine, v2: v2Line, ctxA: csA, ctxB: csB, mc, goals, beta });

  const usedApi = !!((ctxA && ctxA.providerStatus && ctxA.providerStatus.usedApiFootball) || (ctxB && ctxB.providerStatus && ctxB.providerStatus.usedApiFootball));
  const data = {
    a: { ...basicTeam(a), elo: Math.round(db.elos[a]) },
    b: { ...basicTeam(b), elo: Math.round(db.elos[b]) },
    control: baseLine,                 // V1 CONTROL (modelo global, no se promueve)
    base: baseLine,                    // alias back-compat
    probs: v2Line,                     // V2 CHALLENGER — headline del sandbox
    delta: analysis.decomposition.deltaPp, // V2 vs V1 en puntos porcentuales por resultado
    versions: VERSIONS,
    run: { inputHash, randomSeed, simulationCount: SIMS, sanity },
    context: {
      deltaA: Math.round(csA.finalCappedTotal), deltaB: Math.round(csB.finalCappedTotal),
      signalsA: csA.signals, signalsB: csB.signals,
      factorsA: csA.factors, factorsB: csB.factors,
      groupsA: csA.groupCapped, groupsB: csB.groupCapped,
      dataQualityA: csA.dataQuality, dataQualityB: csB.dataQuality,
      hasData: csA.hasData || csB.hasData,
      goalModel: beta > 0 ? 'xG específico por equipo (forma + Elo)' : 'xG por Elo (forma insuficiente)',
    },
    goals,
    form: { a: formSummary(ctxA && ctxA.recentForm), b: formSummary(ctxB && ctxB.recentForm) },
    injuries: {
      a: ((ctxA && ctxA.injuries) || []).filter(i => ['injured', 'suspended', 'doubt'].includes(i.status)).slice(0, 6),
      b: ((ctxB && ctxB.injuries) || []).filter(i => ['injured', 'suspended', 'doubt'].includes(i.status)).slice(0, 6),
    },
    tactical: { a: (ctxA && ctxA.tactical) || null, b: (ctxB && ctxB.tactical) || null },
    monteCarlo: mc,
    analysis,
    dataSource: usedApi ? 'API-Football + modelo' : 'modelo + datos editoriales',
    updatedAt: nowIso,
  };
  // Logging experimental (best-effort, no rompe la simulación si falla). B2.
  logGpIntelligenceRun({ a, b, aMeta, bMeta, base: baseLine, v2: v2Line, csA, csB, inputHash, randomSeed, SIMS, analysis }).catch(() => {});
  h2hDeepCache.set(key, { ts: Date.now(), data });
  return data;
}

function nextMatchForTeam(code) {
  const bracket = resolveRealBracket();
  const cands = [];
  GROUP_FIXTURES.forEach(f => {
    if (f.home === code || f.away === code) {
      const r = db.results[f.id];
      if (!r || r.status !== 'final') cands.push({ id: f.id, datetime: f.datetime, home: f.home, away: f.away });
    }
  });
  KNOCKOUT.forEach(k => {
    const res = bracket[k.m];
    if (res && (res.home === code || res.away === code)) {
      const r = db.results[String(k.m)];
      if (!r || r.status !== 'final') cands.push({ id: String(k.m), datetime: k.datetime || (k.date + 'T18:00Z'), home: res.home, away: res.away });
    }
  });
  cands.sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''));
  return cands[0] || null;
}

function wcResultsForTeam(code) {
  const out = [];
  GROUP_FIXTURES.filter(f => (f.home === code || f.away === code) && db.results[f.id] && db.results[f.id].status === 'final')
    .forEach(f => { const r = db.results[f.id]; out.push({ id: f.id, datetime: f.datetime, home: f.home, away: f.away, hg: r.hg, ag: r.ag, stage: 'group' }); });
  KNOCKOUT.forEach(k => {
    const r = db.results[String(k.m)];
    if (r && r.status === 'final' && (r.home === code || r.away === code)) out.push({ id: String(k.m), datetime: k.datetime || k.date, home: r.home, away: r.away, hg: r.hg, ag: r.ag, stage: k.stage });
  });
  return out.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
}

async function buildTeamDetail(code) {
  const t = teamById[code];
  if (!t) return null;
  await fetchMarkets(false).catch(() => { });
  const sim = simCache[code];
  const elo = db.elos[code];
  const rank = TEAMS.map(x => x.id).sort((a, b) => db.elos[b] - db.elos[a]).indexOf(code) + 1;
  const fmt = p => (p * 100).toFixed(1) + '%';

  const pm = marketCache.polymarket[code] || null, ks = marketCache.kalshi[code] || null;
  const marketPrices = [];
  if (pm) marketPrices.push({ venue: 'Polymarket', side: 'campeón', price: pm.price, bid: pm.bid, ask: pm.ask, volume: pm.volume, liquidity: pm.liquidity, change24h: pm.change24h, url: pm.url, edge: +(sim.champion - pm.ask).toFixed(4) });
  if (ks) marketPrices.push({ venue: 'Kalshi', side: 'campeón', price: ks.price, bid: ks.bid, ask: ks.ask, volume: ks.volume, openInterest: ks.openInterest, change24h: ks.change24h, url: ks.url, edge: +(sim.champion - ks.ask).toFixed(4) });

  const nm = nextMatchForTeam(code);
  const nextMatch = nm ? {
    id: nm.id, datetime: nm.datetime,
    opponent: basicTeam(nm.home === code ? nm.away : nm.home),
    home: nm.home === code,
  } : null;

  const wcResults = wcResultsForTeam(code).map(r => ({
    id: r.id, datetime: r.datetime, stageLabel: STAGE_LABEL[r.stage] || 'Grupos',
    opponent: basicTeam(r.home === code ? r.away : r.home),
    score: r.home === code ? `${r.hg}-${r.ag}` : `${r.ag}-${r.hg}`,
    result: (r.home === code ? r.hg - r.ag : r.ag - r.hg) > 0 ? 'W' : (r.hg === r.ag ? 'D' : 'L'),
  }));

  const ctx = await providers.getTeamContext({ code, name: t.en, names: [t.en, t.name, ...(t.aliases || [])] }).catch(() => null);

  // Model Read: manual editorial primero; si no, derivado del modelo
  let modelRead, keyDrivers;
  if (ctx && ctx.notes && ctx.notes.modelRead) { modelRead = ctx.notes.modelRead; keyDrivers = ctx.notes.keyDrivers || []; }
  else {
    modelRead = `${t.name} tiene ${fmt(sim.champion)} de ser campeón (Elo ${Math.round(elo)}, #${rank} del torneo). Avanza de grupos el ${fmt(sim.reachR32)} y gana su grupo el ${fmt(sim.groupWin)}.`;
    keyDrivers = [`Gana el grupo ${fmt(sim.groupWin)}`, `Avanza a 16avos ${fmt(sim.reachR32)}`, `Eliminado en grupos ${fmt(sim.outInGroups)}`];
    if (sim.likelyR32Opponents && sim.likelyR32Opponents[0]) {
      const o = teamById[sim.likelyR32Opponents[0].id];
      if (o) keyDrivers.push(`Cruce más probable: ${o.name}`);
    }
  }

  return {
    id: code, code: t.id, name: t.name, flag: t.flag, group: t.group,
    elo: Math.round(elo * 10) / 10, eloDelta: Math.round((elo - t.elo) * 10) / 10, rank, host: !!t.host,
    championProbability: sim.champion, ciLow: sim.ciLow, ciHigh: sim.ciHigh,
    finalProbability: sim.reachFinal, semifinalsProbability: sim.reachSF, quarterfinalsProbability: sim.reachQF,
    advanceProbability: sim.reachR32, groupWinProbability: sim.groupWin, groupSecondProbability: sim.groupSecond,
    outInGroupsProbability: sim.outInGroups,
    counts: sim.counts, samples: sim.samples, sims: sim.sims,
    explanation: explainTeam(code, db.elos, sim, simCache),
    likelyOpponents: (sim.likelyR32Opponents || []).map(o => ({ ...basicTeam(o.id), pct: o.pct })),
    marketPrices,
    modelRead, keyDrivers, notes: keyDrivers, tactical: ctx ? ctx.tactical : null,
    nextMatch,
    squad: ctx ? ctx.squad : [], keyPlayers: ctx ? ctx.keyPlayers : [],
    injuries: ctx ? ctx.injuries : [], sidelined: ctx ? ctx.sidelined : [],
    projectedLineup: ctx ? ctx.projectedLineup : null,
    recentForm: ctx ? ctx.recentForm : null,
    results: wcResults.length ? wcResults : (ctx ? ctx.results : []),
    schedule: ctx ? ctx.schedule : [],
    news: ctx ? ctx.news : [],
    providerStatus: ctx ? ctx.providerStatus : null,
    updatedAt: new Date().toISOString(),
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
      const { email, code, ref } = await readBody(req);
      const e = String(email || '').toLowerCase();
      const c = db.codes[e];
      if (!c || c.exp < Date.now() || c.code !== String(code)) return json(res, 401, { error: 'Código incorrecto o expirado' });
      delete db.codes[e];
      if (!db.users[e]) {
        db.users[e] = { createdAt: Date.now(), favorites: [] };
        // atribución de fuente (?ref=x / ig / wa / share...) — solo en el primer registro
        if (ref) {
          const r = String(ref).slice(0, 24).replace(/[^\w-]/g, '');
          db.users[e].ref = r;
          // si el ref es un código de referido de otro usuario, acredítalo
          const referrer = db.refCodes[r];
          if (referrer && referrer !== e && db.users[referrer]) {
            const ru = db.users[referrer];
            ru.referrals = ru.referrals || [];
            if (!ru.referrals.includes(e)) ru.referrals.push(e);
          }
        }
      }
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = e;
      save();
      return json(res, 200, { token, email: e, isAdmin: isAdmin(e), favorites: db.users[e].favorites, alerts: db.users[e].alerts !== false });
    }
    if (p === '/api/me') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'No autenticado' });
      const code = ensureRefCode(u.email);
      return json(res, 200, { ...u, refCode: code, referrals: (db.users[u.email].referrals || []).length });
    }
    if (p === '/api/favorite' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { teamId } = await readBody(req);
      const favs = db.users[u.email].favorites;
      const i = favs.indexOf(teamId);
      i >= 0 ? favs.splice(i, 1) : favs.push(teamId);
      // al seguir el primer equipo, activa alertas por defecto (opt-in al seguir)
      if (i < 0 && db.users[u.email].alerts === undefined) db.users[u.email].alerts = true;
      save();
      return json(res, 200, { favorites: favs, alerts: db.users[u.email].alerts !== false });
    }
    if (p === '/api/alerts' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { enabled } = await readBody(req);
      db.users[u.email].alerts = !!enabled;
      save();
      return json(res, 200, { alerts: db.users[u.email].alerts });
    }
    // preferencias de alertas (eventos + canales)
    if (p === '/api/alertprefs' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { events, channels } = await readBody(req);
      const usr = db.users[u.email];
      usr.alertPrefs = usr.alertPrefs || {};
      if (events && typeof events === 'object') usr.alertPrefs.events = { ...(usr.alertPrefs.events || {}), ...events };
      if (channels && typeof channels === 'object') usr.alertPrefs.channels = { ...(usr.alertPrefs.channels || {}), ...channels };
      save();
      return json(res, 200, { alertPrefs: usr.alertPrefs });
    }
    // silenciar / reactivar alertas de un equipo (campana por equipo)
    if (p === '/api/mute' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { teamId } = await readBody(req);
      const usr = db.users[u.email];
      usr.alertPrefs = usr.alertPrefs || {};
      const muted = usr.alertPrefs.mutedTeams = usr.alertPrefs.mutedTeams || [];
      const i = muted.indexOf(teamId);
      i >= 0 ? muted.splice(i, 1) : muted.push(teamId);
      save();
      return json(res, 200, { mutedTeams: muted });
    }
    if (p === '/api/admin/users') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const users = Object.entries(db.users).map(([email, x]) => ({
        email, createdAt: x.createdAt, lastSeen: x.lastSeen || x.createdAt,
        favorites: (x.favorites || []).length, ref: x.ref || 'directo',
      })).sort((a, b) => b.createdAt - a.createdAt);
      const bySource = {};
      users.forEach(u => bySource[u.ref] = (bySource[u.ref] || 0) + 1);
      return json(res, 200, { total: users.length, users, bySource });
    }
    // ticker público de mercados en vivo (Polymarket) — para la cabecera, también sin registro
    if (p === '/api/ticker') {
      await fetchMarkets(false);
      const rows = TEAMS.map(t => {
        const pm = marketCache.polymarket[t.id];
        if (!pm) return null;
        return { id: t.id, flag: t.flag, name: t.name, price: pm.price, change24h: pm.change24h || 0 };
      }).filter(Boolean).sort((a, b) => b.price - a.price).slice(0, 14);
      return json(res, 200, { ts: marketCache.ts, rows });
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
    // Fase 4: detalle profundo de partido (requiere sesión, como el resto de la app)
    if (p.startsWith('/api/match/')) {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const id = decodeURIComponent(p.split('/')[3] || '');
      const detail = await buildMatchDetail(id);
      return detail ? json(res, 200, detail) : json(res, 404, { error: 'Partido no encontrado' });
    }
    // Fase 4: detalle profundo de equipo
    if (p.startsWith('/api/teamdetail/')) {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const id = (p.split('/')[3] || '').toUpperCase();
      if (!teamById[id]) return json(res, 404, { error: 'Equipo no encontrado' });
      const detail = await buildTeamDetail(id);
      return json(res, 200, detail);
    }
    // Sandbox "simula cualquier cruce" — par de selecciones en cancha neutral (sin bono de local)
    if (p === '/api/h2h') {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const a = (url.searchParams.get('a') || '').toUpperCase(), b = (url.searchParams.get('b') || '').toUpperCase();
      if (!teamById[a] || !teamById[b] || a === b) return json(res, 400, { error: 'Equipos inválidos' });
      const pr = matchProbs(db.elos[a], db.elos[b]); // neutral: elos crudos, sin HOME_BONUS
      return json(res, 200, {
        a: basicTeam(a), b: basicTeam(b),
        aElo: Math.round(db.elos[a]), bElo: Math.round(db.elos[b]),
        probs: { aWin: pr.home, draw: pr.draw, bWin: pr.away, xgA: pr.xgHome, xgB: pr.xgAway, likely: pr.likelyScore },
      });
    }
    // Sandbox v2 "GP Intelligence": modelo base (Elo+Poisson+DC+calibración) + Monte Carlo dedicado
    // del cruce + capa de CONTEXTO (forma/bajas/racha/solidez) → ajuste de Elo acotado → análisis integral.
    if (p === '/api/h2h/deep') {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const a = (url.searchParams.get('a') || '').toUpperCase(), b = (url.searchParams.get('b') || '').toUpperCase();
      if (!teamById[a] || !teamById[b] || a === b) return json(res, 400, { error: 'Equipos inválidos' });
      const out = await buildH2HDeep(a, b);
      return json(res, 200, out);
    }
    if (p === '/api/aciertos') {
      // público a propósito: el track record es la credibilidad de la marca
      return json(res, 200, trackRecord());
    }
    if (p === '/api/arbitrage') {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const force = url.searchParams.get('force') === '1';
      await fetchMarkets(force);
      await fetchMatchMarkets(force);
      return json(res, 200, {
        ts: marketCache.ts, errors: marketCache.errors, rows: arbitrage(),
        matches: matchMktCache.matches,
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
      if (!remove && status === 'final') dispatchPendingAlerts().catch(e => console.error('[alert] dispatch:', e.message));
      return json(res, 200, { ok: true });
    }
    // --- admin: probar conexión con Telegram ---
    if (p === '/api/admin/telegram-test' && req.method === 'POST') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (!telegram.configured()) return json(res, 400, { error: 'Telegram no configurado (faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHANNEL en Render)' });
      const ok = await telegram.post(
        '✅ <b>GP Simulador del Mundial</b> conectado a Telegram.\n\nA partir de ahora publicaremos aquí oportunidades y novedades del Mundial 2026.\n\n👉 <a href="https://gpsimulador.com">gpsimulador.com</a>');
      return json(res, 200, { ok, posted: ok });
    }
    // --- admin: publicar el resumen del día en el canal (a demanda) ---
    if (p === '/api/admin/telegram-daily' && req.method === 'POST') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (!telegram.configured()) return json(res, 400, { error: 'Telegram no configurado' });
      const t = tgDailyText();
      if (!t) return json(res, 200, { ok: false, error: 'No hay partidos por jugar hoy' });
      const ok = await telegram.post(t);
      return json(res, 200, { ok, posted: ok });
    }
    if (p === '/api/admin/refresh-markets' && req.method === 'POST') {
      await fetchMarkets(true);
      broadcast('markets', { ts: marketCache.ts });
      return json(res, 200, { ok: true, ts: marketCache.ts });
    }
    // --- Sprint 0: health interno de la plataforma de datos v2 (admin-only, sin secretos) ---
    if (p === '/api/internal/platform-health') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await platformHealth.snapshot()); }
      catch (e) { return json(res, 200, { status: 'unavailable', error: 'health snapshot failed', timestamp: new Date().toISOString() }); }
    }
    // --- admin: email masivo de novedades a todos los usuarios ---
    if (p === '/api/admin/broadcast' && req.method === 'POST') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (!mailer.isConfigured()) return json(res, 400, { error: 'Email no configurado (modo demo)' });
      const { test } = await readBody(req);
      const targets = test ? [u.email] : Object.keys(db.users); // test → solo al admin
      let sent = 0, failed = 0;
      for (const email of targets) {
        try {
          const link = `https://gpsimulador.com/?ref=${ensureRefCode(email)}`;
          await mailer.sendMail({ to: email, ...broadcastEmail(link) });
          sent++;
          await new Promise(r => setTimeout(r, 120)); // throttle suave para no quemar cuota
        } catch (e) { failed++; console.error('[broadcast]', email, e.message); }
      }
      console.log(`[broadcast] enviados ${sent}/${targets.length} (fallos ${failed})`);
      return json(res, 200, { ok: true, sent, failed, total: targets.length, test: !!test });
    }
    // --- estáticos ---
    let file = p === '/' ? '/index.html' : p;
    const full = path.join(__dirname, 'public', path.normalize(file));
    // index.html: inyecta una versión (mtime) a app.js/style.css → cache-busting automático.
    // Garantiza que cualquier navegador (también desktop con caché agresiva) cargue el código nuevo
    // tras cada deploy, sin tener que hacer hard-refresh.
    if (full === path.join(__dirname, 'public', 'index.html')) {
      try {
        const vjs = Math.floor(fs.statSync(path.join(__dirname, 'public', 'app.js')).mtimeMs);
        const vcss = Math.floor(fs.statSync(path.join(__dirname, 'public', 'style.css')).mtimeMs);
        let html = fs.readFileSync(full, 'utf8')
          .replace('src="app.js"', `src="app.js?v=${vjs}"`)
          .replace('href="style.css"', `href="style.css?v=${vcss}"`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(html);
      } catch { /* si falla, cae al servido normal */ }
    }
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      // html/js/css siempre revalidan (si no, los usuarios quedan con código viejo tras cada deploy);
      // imágenes sí se cachean
      const cache = ['.html', '.js', '.css'].includes(ext)
        ? 'no-cache, must-revalidate'
        : 'public, max-age=86400';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cache,
        'Last-Modified': fs.statSync(full).mtime.toUTCString(),
      });
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
  // Mercados/oportunidades: refresco cada 1 min (antes 5 min)
  setInterval(() => Promise.all([fetchMarkets(true), fetchMatchMarkets(true)])
    .then(() => { broadcast('markets', { ts: marketCache.ts }); return tgTick(); }).catch(() => { }), 60 * 1000);
  // Resultados desde ESPN cada 30 s (antes 2 min) → marcador en vivo más fresco
  syncFromESPN();
  setInterval(syncFromESPN, 30 * 1000);
  // En Render free el servicio duerme tras 15 min sin tráfico: auto-ping cada 10 min para mantenerlo 24/7
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL + '/api/version').catch(() => { }), 10 * 60 * 1000);
  }
});
