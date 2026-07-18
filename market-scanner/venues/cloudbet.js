// market-scanner/venues/cloudbet.js — COLLECTOR de Cloudbet (crypto sportsbook con API pública oficial).
// Cloudbet Feed API: https://sports-api.cloudbet.com/pub/v2/odds/* — auth por header X-API-Key (key GRATIS del
// perfil de usuario). Es UNA CASA MÁS: normalizamos su fútbol a nuestro shape (1X2 + totals) y el sweep del
// server escribe las cuotas a sportsbook_goal_quote_current con sportsbook_code='cloudbet' → value/arbitraje/
// picks/best-odds la ven automáticamente sin tocar esos motores.
// PURO en cuanto a red: sin DB. Fallback graceful TOTAL: sin key o ante cualquier fallo devuelve [] y NUNCA
// rompe el scan (mismo contrato que venues/myriad.js).
'use strict';

const HOST = process.env.CLOUDBET_API_HOST || 'https://sports-api.cloudbet.com';
// Competiciones de fútbol que nos importan (mismas ligas del producto). key de competición de Cloudbet =
// 'soccer-<país>-<liga>'. Ampliable sin tocar código: CLOUDBET_COMPETITIONS="k1,k2" (coma-separado).
const DEFAULT_COMPETITIONS = [
  'soccer-international-fifa-world-cup',
  'soccer-brazil-brasileiro-serie-a', 'soccer-usa-major-league-soccer', 'soccer-mexico-liga-mx',
  'soccer-argentina-primera-division', 'soccer-colombia-primera-a', 'soccer-japan-j1-league',
  'soccer-south-korea-k-league-1', 'soccer-china-super-league', 'soccer-paraguay-primera-division',
  'soccer-england-premier-league', 'soccer-spain-laliga', 'soccer-germany-bundesliga',
  'soccer-italy-serie-a', 'soccer-france-ligue-1',
];

let _cache = { at: 0, data: [] };

function competitions() {
  const env = String(process.env.CLOUDBET_COMPETITIONS || '').trim();
  return env ? env.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_COMPETITIONS;
}

// Nombre → precio decimal de un outcome dentro de un mercado de Cloudbet.
// Cloudbet: market.submarkets[key].selections[] con { outcome, price, params }. price ya es decimal.
function bestPrice(selections, pred) {
  let best = null;
  for (const s of (selections || [])) {
    if (!pred(s)) continue;
    const p = Number(s.price);
    if (p > 1 && (best == null || p > best)) best = p;
  }
  return best;
}

// Normaliza UN evento de Cloudbet → { home, away, kickoff, markets:{ h2h, totals[] } } o null si no cotiza.
function normalizeEvent(ev) {
  const home = (ev.home && ev.home.name) || null, away = (ev.away && ev.away.name) || null;
  if (!home || !away) return null;
  const markets = ev.markets || {};
  const out = { home, away, kickoff: ev.cutoffTime || ev.startTime || null, markets: { h2h: null, totals: [] } };
  // 1X2 — mercado 'soccer.match_odds' (a veces con periodo). selections outcome: 'home'|'draw'|'away'.
  const mo = markets['soccer.match_odds'] || markets['soccer.match_odds/period=ft'];
  if (mo && mo.submarkets) {
    const sel = (Object.values(mo.submarkets)[0] || {}).selections || [];
    const h = bestPrice(sel, s => /home|1/i.test(s.outcome)), d = bestPrice(sel, s => /draw|x/i.test(s.outcome)), a = bestPrice(sel, s => /away|2/i.test(s.outcome));
    if (h > 1 && a > 1) out.markets.h2h = { home: h, draw: d || null, away: a };
  }
  // Total de goles — 'soccer.total_goals'. Cada submarket = una línea (params total=2.5); selections over/under.
  const tg = markets['soccer.total_goals'];
  if (tg && tg.submarkets) {
    for (const sm of Object.values(tg.submarkets)) {
      const line = Number((sm.params || '').match(/total=([\d.]+)/)?.[1]);
      if (!(line > 0)) continue;
      const over = bestPrice(sm.selections, s => /over/i.test(s.outcome)), under = bestPrice(sm.selections, s => /under/i.test(s.outcome));
      if (over > 1 && under > 1) out.markets.totals.push({ line, over, under });
    }
  }
  return (out.markets.h2h || out.markets.totals.length) ? out : null;
}

// fetchCloudbetSoccer() → [ eventos normalizados ]. Sin key → []. Cachea 60s. Nunca lanza.
async function fetchCloudbetSoccer({ apiKey = process.env.CLOUDBET_API_KEY, timeoutMs = 8000, ttlMs = 60000, now = Date.now() } = {}) {
  if (!apiKey) return [];
  if (_cache.data.length && (now - _cache.at) < ttlMs) return _cache.data;
  const headers = { 'X-API-Key': apiKey, accept: 'application/json' };
  const out = [];
  for (const comp of competitions()) {
    try {
      const ctrl = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
      const r = await fetch(`${HOST}/pub/v2/odds/competitions/${comp}?markets=soccer.match_odds&markets=soccer.total_goals&limit=50`, ctrl ? { headers, signal: ctrl } : { headers });
      if (!r.ok) continue; // liga sin cobertura este ciclo → siguiente
      const j = await r.json().catch(() => null);
      const evs = (j && (j.events || (j.categories || []).flatMap(c => (c.competitions || []).flatMap(k => k.events || [])))) || [];
      for (const ev of evs) {
        const n = normalizeEvent(ev);
        if (n) { n.competition = comp; out.push(n); }
      }
    } catch { /* liga/ciclo con fallo → se ignora, nunca rompe */ }
  }
  if (out.length) _cache = { at: now, data: out };
  return out.length ? out : _cache.data;
}

module.exports = { fetchCloudbetSoccer, normalizeEvent, competitions, HOST };
