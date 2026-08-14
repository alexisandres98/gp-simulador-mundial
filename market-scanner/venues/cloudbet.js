// market-scanner/venues/cloudbet.js — COLLECTOR de Cloudbet (crypto sportsbook con API pública oficial).
// Cloudbet Feed API (https://sports-api.cloudbet.com), auth header X-API-Key (key gratis del perfil). Es UNA
// CASA MÁS: normalizamos su fútbol a nuestro shape (1X2 + totals) y el sweep del server escribe las cuotas a
// sportsbook_goal_quote_current con sportsbook_code='cloudbet' y el MISMO canonical_event_id → value/arbitraje/
// picks/best-odds la ven sin tocar nada.
// FLUJO REAL (verificado 18-jul contra la API): (1) /pub/v2/odds/sports/soccer → competiciones; (2) por liga
// /pub/v2/odds/competitions/{key}?from&to → eventos-partido (el listado NO trae mercados); (3) por partido
// /pub/v2/odds/events/{id} → mercados. total_goals: params 'total=2.5' vive en CADA selection.
// PURO en red (sin DB). Fallback graceful TOTAL: sin key o ante cualquier fallo devuelve [] y NUNCA rompe.
'use strict';

const HOST = process.env.CLOUDBET_API_HOST || 'https://sports-api.cloudbet.com';
// Ligas que nos importan, por KEY EXACTO (los keys de las grandes son estables; Liga MX lleva hash → 'liga-mx').
// Matchear por key evita capturar homónimos ("Queensland Premier League 2"). Ampliable por env
// CLOUDBET_COMPETITIONS (regex extra, coma-separado).
const KEY_INCLUDE = [
  /^soccer-international(-fifa)?-world-cup$/, /^soccer-brazil-brasileiro-serie-a$/, /^soccer-usa-major-league-soccer$/,
  /liga-mx-apertura$/, /^soccer-mexico-.*liga-mx$/, /^soccer-south-korea-k-league-1$/, /^soccer-england-premier-league$/,
  /^soccer-spain-laliga$/, /^soccer-germany-bundesliga$/, /^soccer-italy-serie-a$/, /^soccer-france-ligue-1$/,
  /^soccer-argentina-(primera-division|liga-profesional)/, /^soccer-colombia-primera-a$/, /^soccer-japan-j1-league$/,
  /^soccer-china-super-league$/,
];
const LEAGUE_EXCLUDE = /u1[6789]|u2[0-3]|women|-srl|simulated|reserve|next-pro|regional|youth|amateur/i;
function wantedLeague(key) {
  if (!key || LEAGUE_EXCLUDE.test(key)) return false;
  if (KEY_INCLUDE.some(re => re.test(key))) return true;
  const extra = String(process.env.CLOUDBET_COMPETITIONS || '').trim();
  return extra ? extra.split(',').some(p => { try { return new RegExp(p.trim()).test(key); } catch { return false; } }) : false;
}

let _cache = { at: 0, data: [] };

async function cbGet(path, apiKey, timeoutMs) {
  const ctrl = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const r = await fetch(`${HOST}${path}`, ctrl ? { headers: { 'X-API-Key': apiKey, accept: 'application/json' }, signal: ctrl } : { headers: { 'X-API-Key': apiKey, accept: 'application/json' } });
  if (!r.ok) throw new Error('http_' + r.status);
  return r.json();
}

// competiciones de fútbol que nos importan → [{ key, name }]
async function soccerCompetitions(apiKey, timeoutMs) {
  const j = await cbGet('/pub/v2/odds/sports/soccer', apiKey, timeoutMs);
  const out = [];
  for (const cat of (j.categories || [])) {
    for (const c of (cat.competitions || [])) {
      if ((c.eventCount || 0) > 0 && wantedLeague(c.key || '')) out.push({ key: c.key, name: c.name || '' });
    }
  }
  return out;
}

const bestPrice = (sels, pred) => { let b = null; for (const s of (sels || [])) { if (!pred(s)) continue; const p = Number(s.price); if (p > 1 && (b == null || p > b)) b = p; } return b; };

// evento individual (con mercados) → { home, away, kickoff, markets:{h2h, totals[]} } | null
function normalizeEvent(e) {
  const home = e.home && e.home.name, away = e.away && e.away.name;
  if (!home || !away || e.type !== 'EVENT_TYPE_EVENT') return null;
  const M = e.markets || {}, out = { home, away, kickoff: e.cutoffTime || null, markets: { h2h: null, totals: [] } };
  const mo = M['soccer.match_odds'];
  if (mo && mo.submarkets) {
    const sm = mo.submarkets['period=ft'] || Object.values(mo.submarkets)[0] || {};
    const h = bestPrice(sm.selections, s => s.outcome === 'home'), d = bestPrice(sm.selections, s => s.outcome === 'draw'), a = bestPrice(sm.selections, s => s.outcome === 'away');
    if (h > 1 && a > 1) out.markets.h2h = { home: h, draw: d || null, away: a };
  }
  // parser común de mercados over/under por línea (goles, córners, tarjetas — mismo shape de Cloudbet)
  const parseTotals = (mk) => {
    if (!mk || !mk.submarkets) return [];
    const sm = mk.submarkets['period=ft'] || Object.values(mk.submarkets)[0] || {};
    const byLine = {};
    for (const s of (sm.selections || [])) {
      const line = Number(String(s.params || '').match(/total=([\d.]+)/)?.[1]);
      const p = Number(s.price);
      if (!(line > 0) || !(p > 1)) continue;
      (byLine[line] = byLine[line] || {})[s.outcome] = p;
    }
    const rows = [];
    for (const line of Object.keys(byLine)) { const o = byLine[line]; if (o.over > 1 && o.under > 1) rows.push({ line: Number(line), over: o.over, under: o.under }); }
    return rows;
  };
  out.markets.totals = parseTotals(M['soccer.total_goals']);
  // 13-ago (ejecutor en la sombra a precio EJECUTABLE): córners y tarjetas de Cloudbet — son los mercados
  // donde vive el segmento en verificación (cards-under). Claves ausentes → arrays vacíos, cero ruido.
  out.markets.corners = parseTotals(M['soccer.total_corners']);
  out.markets.cards = parseTotals(M['soccer.total_bookings'] || M['soccer.total_cards']);
  return (out.markets.h2h || out.markets.totals.length || out.markets.corners.length || out.markets.cards.length) ? out : null;
}

// fetchCloudbetSoccer() → [ eventos normalizados con precios ]. Sin key → []. Cachea 60s. Nunca lanza.
// maxEvents acota el nº de requests por ciclo (1 por partido). Solo partidos dentro de la ventana horas.
async function fetchCloudbetSoccer({ apiKey = process.env.CLOUDBET_API_KEY, timeoutMs = 9000, ttlMs = 60000, now = Date.now(), windowH = 72, maxEvents = 60 } = {}) {
  if (!apiKey) return [];
  if (_cache.data.length && (now - _cache.at) < ttlMs) return _cache.data;
  const out = [];
  try {
    const comps = await soccerCompetitions(apiKey, timeoutMs);
    const fromS = Math.floor(now / 1000), toS = fromS + windowH * 3600;
    const ids = [];
    for (const c of comps) {
      if (ids.length >= maxEvents) break;
      try {
        const j = await cbGet(`/pub/v2/odds/competitions/${encodeURIComponent(c.key)}?limit=60&from=${fromS}&to=${toS}`, apiKey, timeoutMs);
        for (const e of (j.events || [])) {
          if (e.type === 'EVENT_TYPE_EVENT' && e.home && e.away && e.id) { ids.push({ id: e.id, comp: c.key }); if (ids.length >= maxEvents) break; }
        }
      } catch { /* liga sin cobertura este ciclo */ }
    }
    // detalle de cada partido en LOTES paralelos (mucho más rápido que secuencial)
    for (let i = 0; i < ids.length; i += 6) {
      const batch = ids.slice(i, i + 6);
      const res = await Promise.all(batch.map(({ id, comp }) =>
        cbGet(`/pub/v2/odds/events/${id}`, apiKey, timeoutMs).then(ev => { const n = normalizeEvent(ev); if (n) n.competition = comp; return n; }).catch(() => null)));
      for (const n of res) if (n) out.push(n);
    }
  } catch { return _cache.data; } // fallo en el listado de deportes → último bueno
  if (out.length) _cache = { at: now, data: out };
  return out.length ? out : _cache.data;
}

module.exports = { fetchCloudbetSoccer, normalizeEvent, soccerCompetitions, HOST };
