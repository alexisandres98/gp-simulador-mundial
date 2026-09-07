// data-providers/darts/books.js — LAS CASAS Y LOS MERCADOS DE PREDICCIÓN DE DARDOS, en la taxonomía de GP
//
// Cinco puertas, comprobadas el 6-sep-2026 desde el sandbox salvo Cloudbet (su clave vive en Render):
//   · Pinnacle (invitado, deporte 10): ganador + total de legs. Referencia AFILADA, jamás venue ejecutable.
//   · Bovada (cupón público): ganador, marcador exacto, MOST 180s (con empate), TOTAL 180s (+ líneas alternas),
//     180s por jugador. Es la casa que da precio a la familia de 180s; no ejecutable desde la cuenta de la casa.
//   · Polymarket (gamma, serie pdcdarts 12754): ganador del partido en el Euro Tour/majors; liquidez fina.
//   · Kalshi: campeón del Mundial (KXPDCDARTS); MODUS en KXDARTSMATCH.
//   · Cloudbet (con clave): la venue ejecutable de la casa; claves de mercado a confirmar con la sonda.
// Todo se normaliza a filas {book, family, side, line, odds, participant} con la MISMA gramática que el resto
// de los deportes: ML (a|b), LEGS_TOTAL (over|under, línea), LEGS_HCP (a|b, línea A), CORRECT_SCORE ("6-3"),
// X180_TOTAL (over|under), X180_MOST (a|b|tie), X180_PLAYER (a|b + over|under), HIGHEST_CHECKOUT (over|under).
'use strict';

const PIN_HOST = 'https://guest.api.arcadia.pinnacle.com/0.1';
const PIN_KEY = process.env.PINNACLE_GUEST_KEY || 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R';
const PIN_SPORT_DARTS = 10;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) GP-Simulador/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}, { timeoutMs = 15000, tries = 2 } = {}) {
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
const lastName = (s) => { const p = norm(s).split(' '); return p[p.length - 1] || ''; };

// ── PINNACLE ─────────────────────────────────────────────────────────────────────────────────────────────
async function pinnacle() {
  const mus = await getJson(`${PIN_HOST}/sports/${PIN_SPORT_DARTS}/matchups`, { 'X-API-Key': PIN_KEY });
  if (!Array.isArray(mus)) return { book: 'pinnacle', events: [], available: false };
  const mk = await getJson(`${PIN_HOST}/sports/${PIN_SPORT_DARTS}/markets/straight`, { 'X-API-Key': PIN_KEY });
  const byMu = new Map();
  for (const m of Array.isArray(mk) ? mk : []) { const a = byMu.get(m.matchupId) || []; a.push(m); byMu.set(m.matchupId, a); }
  const events = [];
  for (const mu of mus) {
    if (mu.type !== 'matchup' || mu.parentId) continue;
    const home = (mu.participants || []).find((p) => p.alignment === 'home'), away = (mu.participants || []).find((p) => p.alignment === 'away');
    if (!home || !away) continue;
    const rows = [];
    for (const m of byMu.get(mu.id) || []) {
      if (m.period !== 0 || m.status !== 'open') continue;
      if (m.type === 'moneyline') {
        const h = (m.prices || []).find((p) => p.designation === 'home'), a = (m.prices || []).find((p) => p.designation === 'away');
        if (h && a) rows.push({ family: 'ML', side: 'a', odds: amToDec(h.price) }, { family: 'ML', side: 'b', odds: amToDec(a.price) });
      }
      if (m.type === 'total') {
        const o = (m.prices || []).find((p) => p.designation === 'over'), u = (m.prices || []).find((p) => p.designation === 'under');
        if (o && u && o.points != null) rows.push({ family: 'LEGS_TOTAL', side: 'over', line: o.points, odds: amToDec(o.price), alt: !!m.isAlternate }, { family: 'LEGS_TOTAL', side: 'under', line: u.points, odds: amToDec(u.price), alt: !!m.isAlternate });
      }
      if (m.type === 'spread') {
        const h = (m.prices || []).find((p) => p.designation === 'home'), a = (m.prices || []).find((p) => p.designation === 'away');
        if (h && a && h.points != null) rows.push({ family: 'LEGS_HCP', side: 'a', line: h.points, odds: amToDec(h.price), alt: !!m.isAlternate }, { family: 'LEGS_HCP', side: 'b', line: -h.points, odds: amToDec(a.price), alt: !!m.isAlternate });
      }
    }
    events.push({ book: 'pinnacle', provider_id: String(mu.id), start_at: mu.startTime, competition: (mu.league || {}).name || null, a: home.name, b: away.name, live: !!mu.isLive, rows: rows.map((r) => ({ book: 'pinnacle', ...r })) });
  }
  return { book: 'pinnacle', events, available: true, at: new Date().toISOString() };
}

// ── BOVADA ───────────────────────────────────────────────────────────────────────────────────────────────
async function bovada() {
  const j = await getJson('https://www.bovada.lv/services/sports/event/coupon/events/A/description/darts?lang=en', { accept: 'application/json, text/plain, */*' });
  if (!Array.isArray(j)) return { book: 'bovada', events: [], outrights: [], available: false };
  const events = [], outrights = [];
  for (const g of j) {
    const comp = ((g.path || []).find((p) => p.description && p.description !== 'Darts') || {}).description || null;
    for (const e of g.events || []) {
      const comps = e.competitors || [];
      const isOutright = comps.length < 2;
      const a = comps.find((c) => c.home) || comps[0], b = comps.find((c) => !c.home && c !== a) || comps[1];
      const aName = a ? a.name : null, bName = b ? b.name : null;
      const rows = [];
      for (const dg of e.displayGroups || []) for (const mk of dg.markets || []) {
        const desc = String(mk.description || ''), per = ((mk.period || {}).description || '');
        const live = /live/i.test(per);
        const outs = mk.outcomes || [];
        const dec = (o) => { const v = o.price && o.price.decimal != null ? parseFloat(o.price.decimal) : null; return v > 1 ? v : null; };
        const hcp = (o) => (o.price && o.price.handicap != null ? parseFloat(o.price.handicap) : null);
        const sideOf = (nm) => (aName && norm(nm) === norm(aName) ? 'a' : bName && norm(nm) === norm(bName) ? 'b' : /tie|draw/i.test(nm) ? 'tie' : null);
        if (isOutright && /outright/i.test(desc)) { for (const o of outs) outrights.push({ book: 'bovada', event: e.description, competition: comp, participant: o.description, odds: dec(o), start_at: e.startTime ? new Date(e.startTime).toISOString() : null }); continue; }
        if (/^moneyline$/i.test(desc)) for (const o of outs) { const s = sideOf(o.description); if (s && dec(o)) rows.push({ family: 'ML', side: s, odds: dec(o), live }); }
        else if (/^correct score$/i.test(desc)) for (const o of outs) { const m = String(o.description).match(/(\d+)\s*-\s*(\d+)/); if (m && dec(o)) rows.push({ family: 'CORRECT_SCORE', side: `${m[1]}-${m[2]}`, odds: dec(o), live }); }
        else if (/^most 180s$/i.test(desc)) for (const o of outs) { const s = sideOf(o.description); if (s && dec(o)) rows.push({ family: 'X180_MOST', side: s, odds: dec(o), live }); }
        else if (/^total 180s( o\/u)?$/i.test(desc)) for (const o of outs) { const s = /over/i.test(o.description) ? 'over' : /under/i.test(o.description) ? 'under' : null; if (s && dec(o) && hcp(o) != null) rows.push({ family: 'X180_TOTAL', side: s, line: hcp(o), odds: dec(o), alt: /o\/u/i.test(desc), live }); }
        else if (/^total 180s o\/u - /i.test(desc)) { const who = desc.replace(/^total 180s o\/u - /i, ''); const ps = sideOf(who) || (lastName(who) === lastName(aName) ? 'a' : lastName(who) === lastName(bName) ? 'b' : null); if (ps) for (const o of outs) { const s = /over/i.test(o.description) ? 'over' : /under/i.test(o.description) ? 'under' : null; if (s && dec(o) && hcp(o) != null) rows.push({ family: 'X180_PLAYER', participant: ps, side: s, line: hcp(o), odds: dec(o), live }); } }
        else if (/highest checkout/i.test(desc)) for (const o of outs) { const s = /over/i.test(o.description) ? 'over' : /under/i.test(o.description) ? 'under' : null; if (s && dec(o) && hcp(o) != null) rows.push({ family: 'HIGHEST_CHECKOUT', side: s, line: hcp(o), odds: dec(o), live }); }
        else if (/^total legs/i.test(desc)) for (const o of outs) { const s = /over/i.test(o.description) ? 'over' : /under/i.test(o.description) ? 'under' : null; if (s && dec(o) && hcp(o) != null) rows.push({ family: 'LEGS_TOTAL', side: s, line: hcp(o), odds: dec(o), live }); }
        else if (/^(leg )?handicap/i.test(desc)) for (const o of outs) { const s = sideOf(o.description); if (s && s !== 'tie' && dec(o) && hcp(o) != null) rows.push({ family: 'LEGS_HCP', side: s, line: hcp(o), odds: dec(o), live }); }
      }
      if (isOutright) continue;
      events.push({ book: 'bovada', provider_id: String(e.id), start_at: e.startTime ? new Date(e.startTime).toISOString() : null, competition: comp, a: aName, b: bName, live: !!e.live, rows: rows.map((r) => ({ book: 'bovada', ...r })) });
    }
  }
  return { book: 'bovada', events, outrights, available: true, at: new Date().toISOString() };
}

// ── POLYMARKET (serie PDC) ───────────────────────────────────────────────────────────────────────────────
async function polymarket() {
  const j = await getJson('https://gamma-api.polymarket.com/events?series_id=12754&closed=false&limit=100');
  if (!Array.isArray(j)) return { book: 'polymarket', events: [], available: false };
  const events = [];
  for (const e of j) {
    for (const m of e.markets || []) {
      if (m.sportsMarketType && m.sportsMarketType !== 'moneyline') continue;
      let outs = [], prices = [];
      try { outs = JSON.parse(m.outcomes || '[]'); prices = JSON.parse(m.outcomePrices || '[]').map(Number); } catch { continue; }
      if (outs.length !== 2) continue;
      const rows = [];
      for (let i = 0; i < 2; i++) if (prices[i] > 0 && prices[i] < 1) rows.push({ book: 'polymarket', family: 'ML', side: i === 0 ? 'a' : 'b', odds: +(1 / prices[i]).toFixed(3), prob: prices[i] });
      events.push({ book: 'polymarket', provider_id: String(e.id), slug: e.slug, start_at: e.startDate || null, competition: (e.title || '').split(':')[0] || null, a: outs[0], b: outs[1], liquidity: +(m.liquidity || 0), spread: m.spread != null ? +m.spread : null, rows, url: e.slug ? `https://polymarket.com/event/${e.slug}` : null });
    }
  }
  return { book: 'polymarket', events, available: true, at: new Date().toISOString() };
}

// ── KALSHI (campeón del Mundial) ─────────────────────────────────────────────────────────────────────────
async function kalshi() {
  const j = await getJson('https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXPDCDARTS&status=open&limit=200');
  const ms = (j && j.markets) || [];
  const dollars = (x) => (x == null ? null : typeof x === 'string' ? parseFloat(x) : x > 1 ? x / 100 : x);
  return { book: 'kalshi', available: Array.isArray(ms), at: new Date().toISOString(), outrights: ms.map((m) => ({ book: 'kalshi', ticker: m.ticker, title: m.title, participant: (m.title || '').replace(/^Will\s+/i, '').replace(/\s+win.*$/i, ''), yes_bid: dollars(m.yes_bid_dollars != null ? m.yes_bid_dollars : m.yes_bid), yes_ask: dollars(m.yes_ask_dollars != null ? m.yes_ask_dollars : m.yes_ask), close_time: m.close_time })) };
}

// ── CLOUDBET (la venue ejecutable; clave en Render) ──────────────────────────────────────────────────────
const CB_BASE = 'https://sports-api.cloudbet.com/pub/v2/odds';
async function cloudbetFixtures({ days = 8, key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  if (!key) return { book: 'cloudbet', events: [], available: false };
  const seen = new Set(), events = [];
  const t0 = Date.now();
  for (let k = 0; k < days; k++) {
    const d = new Date(t0 + k * 864e5).toISOString().slice(0, 10);
    const j = await getJson(`${CB_BASE}/fixtures?sport=darts&date=${d}`, { 'X-API-Key': key });
    for (const c of (j && j.competitions) || []) for (const e of c.events || []) {
      if (!e.home || !e.away || seen.has(e.id)) continue;
      seen.add(e.id);
      events.push({ book: 'cloudbet', provider_id: String(e.id), start_at: e.cutoffTime || null, competition: c.name || null, competition_key: c.key || null, a: (e.home || {}).name, b: (e.away || {}).name, status: e.status || null });
    }
    await sleep(220);
  }
  return { book: 'cloudbet', events, available: true, at: new Date().toISOString() };
}
// mercados de un evento de Cloudbet: se leen TODAS las claves y se mapean por nombre (la sonda dirá cuáles)
// CLAVES REALES DE CLOUDBET (sonda en prod, 7-sep): darts.winner · darts.total_legs · darts.handicap_legs ·
// darts.most_180s · darts.total_180s · darts.180s_handicap · darts.set_correct_score_in_legs. El orden importa:
// el hándicap de 180s tiene que casar ANTES que el patrón genérico de hándicap, o entraría como legs.
const CB_FAMILY = [
  [/180s?_handicap|handicap_180/, 'X180_HCP'],
  [/match_odds|^darts\.winner$|moneyline/, 'ML'], [/total_legs|totals?$/, 'LEGS_TOTAL'], [/set_handicap|handicap_sets/, 'SETS_HCP'], [/handicap/, 'LEGS_HCP'],
  [/correct_score/, 'CORRECT_SCORE'], [/most_180|most_one_hundred_and_eighty/, 'X180_MOST'], [/total_180|180s?_total|one_hundred_and_eighties/, 'X180_TOTAL'],
  [/player.*180|180.*player/, 'X180_PLAYER'], [/highest_checkout|checkout/, 'HIGHEST_CHECKOUT'], [/total_sets/, 'SETS_TOTAL'],
];
async function cloudbetMarkets(providerId, { key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  if (!key) return { rows: [], raw_keys: [] };
  const j = await getJson(`${CB_BASE}/events/${encodeURIComponent(providerId)}`, { 'X-API-Key': key });
  if (!j) return { rows: [], raw_keys: [] };
  const rows = [], rawKeys = [];
  const hn = norm((j.home || {}).name), an = norm((j.away || {}).name);
  for (const [mkey, mk] of Object.entries(j.markets || {})) {
    rawKeys.push(mkey);
    const fam = (CB_FAMILY.find(([re]) => re.test(mkey)) || [])[1];
    if (!fam) continue;
    for (const sub of mk.submarkets ? Object.values(mk.submarkets) : []) {
      for (const sel of sub.selections || []) {
        if (sel.status && sel.status !== 'SELECTION_ENABLED') continue;
        const price = +sel.price; if (!(price > 1)) continue;
        const out = String(sel.outcome || '').toLowerCase();
        const params = String(sel.params || '');
        const lm = params.match(/(?:handicap|total|line)=(-?[\d.]+)/i);
        let line = lm ? +lm[1] : null;
        let side = null, participant = null;
        if (out === 'home') side = 'a'; else if (out === 'away') side = 'b'; else if (/^(over|under)$/.test(out)) side = out; else if (/draw|tie/.test(out)) side = 'tie';
        else if (/^\d+[-:]\d+$/.test(out)) side = out.replace(':', '-');
        // los hándicaps de Cloudbet llevan UN parámetro por mercado (el del local): la visita cubre el opuesto.
        // Comprobado en prod el 7-sep: `handicap=-2.5` venía igual en las dos selecciones.
        if (/HCP$/.test(fam) && side === 'b' && line != null) line = -line;
        const tm = params.match(/team=(home|away)/i) || params.match(/player=(home|away)/i);
        if (tm) participant = tm[1] === 'home' ? 'a' : 'b';
        if (!side) continue;
        rows.push({ book: 'cloudbet', family: fam, side, line, odds: price, participant, market_key: mkey, params, event_id: String(providerId), max_stake: sel.maxStake != null ? +sel.maxStake : null });
      }
    }
  }
  return { rows, raw_keys: rawKeys, home: hn, away: an };
}

module.exports = { pinnacle, bovada, polymarket, kalshi, cloudbetFixtures, cloudbetMarkets, norm, lastName, amToDec, PIN_SPORT_DARTS };
