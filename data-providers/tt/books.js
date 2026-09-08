// data-providers/tt/books.js — LAS CASAS DE TENIS DE MESA, en la gramática de GP
//
// Tres puertas, comprobadas el 8-sep-2026:
//   · Pinnacle (invitado, deporte 32): ganador, hándicap y total del partido; por game (period 1..7) ganador,
//     hándicap de puntos y total de puntos. 133 ligas (WTT + ligas privadas). Referencia afilada, no venue.
//   · Bovada (cupón público `table-tennis`): Moneyline · Game Spread (games) · Point Spread - Points ·
//     Total Points · Correct Score · 1st Game (ML, spread de puntos, total) · To Go To Extra Points (deuce) ·
//     y una capa en vivo por game. Es la casa con la superficie más rica para el compilador.
//   · Cloudbet (con clave): venue ejecutable. Claves reales: table_tennis.winner · table_tennis.totals ·
//     table_tennis.correct_score · table_tennis.game_point_handicap.v2 · table_tennis.game_total_points.v2 ·
//     table_tennis.game_winner.v2 (+ hándicap de games/puntos si aparecen; se mapean por patrón).
// Filas normalizadas {book, family, side, line, odds, participant, game, live}. Familias:
//   ML (a|b) · GAMES_TOTAL (over|under) · GAMES_HCP (a|b, línea A) · POINTS_TOTAL · POINTS_HCP ·
//   CORRECT_SCORE ("3-1") · GAME_ML (game k) · GAME_POINTS_TOTAL · GAME_POINTS_HCP · GAME_DEUCE (yes|no).
// Puntos frente a games se distinguen por MAGNITUD de la línea: un total ≥ 15 o un hándicap con |línea| ≥ 4
// es de puntos; lo demás es de games. La competición viaja en cada evento para el mapa de integridad.
'use strict';

const PIN_HOST = 'https://guest.api.arcadia.pinnacle.com/0.1';
const PIN_KEY = process.env.PINNACLE_GUEST_KEY || 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R';
const PIN_SPORT_TT = 32;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) GP-Simulador/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}, { timeoutMs = 15000, tries = 2 } = {}) {
  // sandbox de desarrollo: el fetch de Node no atraviesa el proxy; la puerta de la WTT ya sabe usar curl
  if (process.env.GP_FETCH_VIA_CURL === '1') return require('./wtt').getJson(url, { timeoutMs, tries, headers: { 'user-agent': UA, accept: 'application/json', ...headers } });
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(700 * (i + 1)); }
  }
  return null;
}
const amToDec = (am) => (am == null ? null : am > 0 ? 1 + am / 100 : 1 + 100 / Math.abs(am));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const isPointsTotal = (line) => Math.abs(+line) >= 15;
const isPointsHcp = (line) => Math.abs(+line) >= 4;

// ── PINNACLE ─────────────────────────────────────────────────────────────────────────────────────────────
async function pinnacle() {
  const mus = await getJson(`${PIN_HOST}/sports/${PIN_SPORT_TT}/matchups`, { 'X-API-Key': PIN_KEY });
  if (!Array.isArray(mus)) return { book: 'pinnacle', events: [], available: false };
  const mk = await getJson(`${PIN_HOST}/sports/${PIN_SPORT_TT}/markets/straight`, { 'X-API-Key': PIN_KEY });
  const byMu = new Map();
  for (const m of Array.isArray(mk) ? mk : []) { const a = byMu.get(m.matchupId) || []; a.push(m); byMu.set(m.matchupId, a); }
  const events = [];
  for (const mu of mus) {
    if (mu.type !== 'matchup' || mu.parentId) continue;
    const home = (mu.participants || []).find((p) => p.alignment === 'home'), away = (mu.participants || []).find((p) => p.alignment === 'away');
    if (!home || !away) continue;
    const rows = [];
    for (const m of byMu.get(mu.id) || []) {
      if (m.status !== 'open') continue;
      const per = +m.period || 0, game = per > 0 ? per : null;
      const h = (m.prices || []).find((p) => p.designation === 'home'), a = (m.prices || []).find((p) => p.designation === 'away');
      const o = (m.prices || []).find((p) => p.designation === 'over'), u = (m.prices || []).find((p) => p.designation === 'under');
      if (m.type === 'moneyline' && h && a) rows.push({ family: game ? 'GAME_ML' : 'ML', side: 'a', odds: amToDec(h.price), game }, { family: game ? 'GAME_ML' : 'ML', side: 'b', odds: amToDec(a.price), game });
      if (m.type === 'total' && o && u && o.points != null) { const fam = game ? 'GAME_POINTS_TOTAL' : isPointsTotal(o.points) ? 'POINTS_TOTAL' : 'GAMES_TOTAL'; rows.push({ family: fam, side: 'over', line: o.points, odds: amToDec(o.price), alt: !!m.isAlternate, game }, { family: fam, side: 'under', line: u.points, odds: amToDec(u.price), alt: !!m.isAlternate, game }); }
      if (m.type === 'spread' && h && a && h.points != null) { const fam = game ? 'GAME_POINTS_HCP' : isPointsHcp(h.points) ? 'POINTS_HCP' : 'GAMES_HCP'; rows.push({ family: fam, side: 'a', line: h.points, odds: amToDec(h.price), alt: !!m.isAlternate, game }, { family: fam, side: 'b', line: -h.points, odds: amToDec(a.price), alt: !!m.isAlternate, game }); }
    }
    events.push({ book: 'pinnacle', provider_id: String(mu.id), start_at: mu.startTime, competition: (mu.league || {}).name || null, a: home.name, b: away.name, live: !!mu.isLive, rows: rows.filter((r) => r.odds > 1).map((r) => ({ book: 'pinnacle', ...r })) });
  }
  return { book: 'pinnacle', events, available: true, at: new Date().toISOString() };
}

// ── BOVADA ───────────────────────────────────────────────────────────────────────────────────────────────
const stripG = (s) => String(s || '').replace(/\s*-\s*L?G\d+\s*$/i, '').trim();
async function bovada() {
  const j = await getJson('https://www.bovada.lv/services/sports/event/coupon/events/A/description/table-tennis?lang=en', { accept: 'application/json, text/plain, */*' });
  if (!Array.isArray(j)) return { book: 'bovada', events: [], available: false };
  const events = [];
  for (const g of j) {
    const comp = ((g.path || []).find((p) => p.description && p.description !== 'Table Tennis') || {}).description || null;
    for (const e of g.events || []) {
      const comps = e.competitors || [];
      if (comps.length < 2) continue;
      const a = comps.find((c) => c.home) || comps[0], b = comps.find((c) => !c.home && c !== a) || comps[1];
      const aName = a ? a.name : null, bName = b ? b.name : null;
      const sideOf = (nm) => { const x = norm(stripG(nm)); return aName && x === norm(aName) ? 'a' : bName && x === norm(bName) ? 'b' : null; };
      const rows = [];
      for (const dg of e.displayGroups || []) for (const mk of dg.markets || []) {
        const desc = String(mk.description || ''), per = String((mk.period || {}).description || '');
        const live = /live/i.test(per);
        const gm = per.match(/(\d)(?:st|nd|rd|th) game/i); const game = gm ? +gm[1] : null;
        const outs = mk.outcomes || [];
        const dec = (o) => { const v = o.price && o.price.decimal != null ? parseFloat(o.price.decimal) : null; return v > 1 ? v : null; };
        const hcp = (o) => (o.price && o.price.handicap != null ? parseFloat(o.price.handicap) : null);
        const ou = (o) => (/^over/i.test(o.description) ? 'over' : /^under/i.test(o.description) ? 'under' : null);
        if (/^moneyline$/i.test(desc)) for (const o of outs) { const s = sideOf(o.description); if (s && dec(o)) rows.push({ family: game ? 'GAME_ML' : 'ML', side: s, odds: dec(o), game, live }); }
        else if (/^game spread$/i.test(desc)) for (const o of outs) { const s = sideOf(o.description); if (s && dec(o) && hcp(o) != null) rows.push({ family: 'GAMES_HCP', side: s, line: hcp(o), odds: dec(o), live }); }
        else if (/^point spread/i.test(desc)) for (const o of outs) { const s = sideOf(o.description); if (s && dec(o) && hcp(o) != null) rows.push({ family: game ? 'GAME_POINTS_HCP' : 'POINTS_HCP', side: s, line: hcp(o), odds: dec(o), game, live }); }
        else if (/^total points$/i.test(desc)) for (const o of outs) { const s = ou(o); if (s && dec(o) && hcp(o) != null) rows.push({ family: game ? 'GAME_POINTS_TOTAL' : 'POINTS_TOTAL', side: s, line: hcp(o), odds: dec(o), game, live }); }
        else if (/^correct score$/i.test(desc)) for (const o of outs) { const m = String(o.description).match(/(\d+)\s*-\s*(\d+)/); if (m && dec(o)) rows.push({ family: 'CORRECT_SCORE', side: `${m[1]}-${m[2]}`, odds: dec(o), live }); }
        else if (/extra points/i.test(desc) && game) for (const o of outs) { const s = /^yes/i.test(o.description) ? 'yes' : /^no/i.test(o.description) ? 'no' : null; if (s && dec(o)) rows.push({ family: 'GAME_DEUCE', side: s, odds: dec(o), game, live }); }
      }
      events.push({ book: 'bovada', provider_id: String(e.id), start_at: e.startTime ? new Date(e.startTime).toISOString() : null, competition: comp, a: aName, b: bName, live: !!e.live, rows: rows.map((r) => ({ book: 'bovada', ...r })) });
    }
  }
  return { book: 'bovada', events, available: true, at: new Date().toISOString() };
}

// ── CLOUDBET (la venue ejecutable; clave en Render) ──────────────────────────────────────────────────────
const CB_BASE = 'https://sports-api.cloudbet.com/pub/v2/odds';
async function cloudbetFixtures({ days = 6, key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  if (!key) return { book: 'cloudbet', events: [], available: false };
  const seen = new Set(), events = [];
  const t0 = Date.now();
  for (let k = 0; k < days; k++) {
    const d = new Date(t0 + k * 864e5).toISOString().slice(0, 10);
    const j = await getJson(`${CB_BASE}/fixtures?sport=table-tennis&date=${d}`, { 'X-API-Key': key });
    for (const c of (j && j.competitions) || []) for (const e of c.events || []) {
      if (!e.home || !e.away || seen.has(e.id)) continue;
      seen.add(e.id);
      events.push({ book: 'cloudbet', provider_id: String(e.id), start_at: e.cutoffTime || null, competition: c.name || null, competition_key: c.key || null, a: (e.home || {}).name, b: (e.away || {}).name, status: e.status || null });
    }
    await sleep(200);
  }
  return { book: 'cloudbet', events, available: true, at: new Date().toISOString() };
}
// el orden importa: lo específico (por game) antes que lo genérico
const CB_FAMILY = [
  [/game_point_handicap|game_handicap_points/, 'GAME_POINTS_HCP'],
  [/game_total_points|game_totals?/, 'GAME_POINTS_TOTAL'],
  [/game_winner|game_odds/, 'GAME_ML'],
  [/^table_tennis\.winner$|match_odds|moneyline/, 'ML'],
  [/correct_score/, 'CORRECT_SCORE'],
  [/point_handicap|points_handicap/, 'POINTS_HCP'],
  [/set_handicap|games?_handicap|^table_tennis\.handicap/, 'GAMES_HCP'],
  [/total_points|points_total/, 'POINTS_TOTAL'],
  [/total_games|games?_total|^table_tennis\.totals$|totals?$/, 'TOTALS_AUTO'],
];
async function cloudbetMarkets(providerId, { key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  if (!key) return { rows: [], raw_keys: [] };
  const j = await getJson(`${CB_BASE}/events/${encodeURIComponent(providerId)}`, { 'X-API-Key': key });
  if (!j) return { rows: [], raw_keys: [] };
  const rows = [], rawKeys = [];
  for (const [mkey, mk] of Object.entries(j.markets || {})) {
    rawKeys.push(mkey);
    let fam = (CB_FAMILY.find(([re]) => re.test(mkey)) || [])[1];
    if (!fam) continue;
    for (const sub of mk.submarkets ? Object.values(mk.submarkets) : []) {
      for (const sel of sub.selections || []) {
        if (sel.status && sel.status !== 'SELECTION_ENABLED') continue;
        const price = +sel.price; if (!(price > 1)) continue;
        const out = String(sel.outcome || '').toLowerCase();
        const params = String(sel.params || '');
        const lm = params.match(/(?:handicap|total|line)=(-?[\d.]+)/i);
        let line = lm ? +lm[1] : null;
        const gmm = params.match(/game=(\d+)/i); const game = gmm ? +gmm[1] : null;
        let famRow = fam;
        if (fam === 'TOTALS_AUTO') famRow = line != null && isPointsTotal(line) ? 'POINTS_TOTAL' : 'GAMES_TOTAL';
        if (famRow === 'GAMES_HCP' && line != null && isPointsHcp(line)) famRow = 'POINTS_HCP';
        let side = null;
        if (out === 'home') side = 'a'; else if (out === 'away') side = 'b'; else if (/^(over|under)$/.test(out)) side = out; else if (/^(yes|no)$/.test(out)) side = out;
        else if (/^\d+[-:]\d+$/.test(out)) side = out.replace(':', '-');
        // los hándicaps de Cloudbet llevan UN parámetro (el del local): la visita cubre el opuesto
        if (/HCP$/.test(famRow) && side === 'b' && line != null) line = -line;
        if (!side) continue;
        rows.push({ book: 'cloudbet', family: famRow, side, line, odds: price, game, market_key: mkey, params, event_id: String(providerId), max_stake: sel.maxStake != null ? +sel.maxStake : null });
      }
    }
  }
  return { rows, raw_keys: rawKeys, home: norm((j.home || {}).name), away: norm((j.away || {}).name) };
}

module.exports = { pinnacle, bovada, cloudbetFixtures, cloudbetMarkets, norm, amToDec, PIN_SPORT_TT, isPointsTotal, isPointsHcp };
