// market-scanner/venues/myriad.js — collector del prediction market MYRIAD (API pública gratis, sin key).
// A diferencia de Polymarket/Kalshi (solo campeón), Myriad cotiza PARTIDOS con 1X2 completo (home/draw/away),
// precio peer-to-peer SIN vig (suma 1.0) y liquidez real → una referencia limpia extra para el consenso y un
// venue "tradeable" (se puede vender la posición). On-chain (Abstract/BNB) → operar requiere wallet, como Polymarket.
//
// Salida: matches normalizados que quotes.js FUSIONA al mercado 1X2 de la casa por par de equipos.
// Cache interno (evita martillar la API en cada scan) + timeout (nunca bloquea el scan si Myriad no responde).

'use strict';

const HOST = process.env.MYRIAD_API_HOST || 'https://api-v2.myriadprotocol.com';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').trim();
// alias de nombres de Myriad → forma que usa the_odds_api (para casar por par de equipos)
const NAME_ALIASES = {
  unitedstates: 'usa', usa: 'usa', drcongo: 'drcongo', congodr: 'drcongo', republicofkorea: 'southkorea',
  bosnia: 'bosniaherzegovina', bosniaandherzegovina: 'bosniaherzegovina', ivorycoast: 'ivorycoast', cotedivoire: 'ivorycoast',
};
const canon = (s) => { const n = norm(s); return NAME_ALIASES[n] || n; };

let _cache = { at: 0, data: [] };

// fetchMyriadMatches(opts) → [{ home, away, kickoff, outcomes:{home,draw,away}(precio 0-1), liquidity, volume24h, url }]
async function fetchMyriadMatches({ timeoutMs = 6000, ttlMs = 60000, now = Date.now() } = {}) {
  if (_cache.data.length && (now - _cache.at) < ttlMs) return _cache.data;
  let rows = [];
  try {
    const ctrl = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    // "vs" captura los mercados de partido "X vs. Y: Who wins?"; ordenamos por volumen para traer los relevantes.
    const r = await fetch(`${HOST}/markets?keyword=vs&page=1&limit=60&sort=volume_24h`, ctrl ? { signal: ctrl } : {});
    if (!r.ok) throw new Error('http_' + r.status);
    const j = await r.json();
    rows = Array.isArray(j) ? j : (j.data || j.markets || []);
  } catch (e) {
    return _cache.data; // ante fallo, devolvemos lo último bueno (posiblemente vacío) — nunca rompe el scan
  }
  const out = [];
  for (const m of rows) {
    if ((m.state || m.status) !== 'open') continue;
    if (!/who\s*wins/i.test(m.title || '')) continue;               // solo mercados de resultado de partido
    const mt = String(m.title || '').match(/^(.+?)\s+vs\.?\s+(.+?)\s*:/i);
    if (!mt) continue;
    const homeName = mt[1].trim(), awayName = mt[2].trim();
    const outs = m.outcomes || m.options || [];
    const priceOf = (pred) => { const o = outs.find(pred); return o && Number(o.price) > 0 ? Number(o.price) : null; };
    const homeP = priceOf(o => canon(o.title || o.name) === canon(homeName));
    const awayP = priceOf(o => canon(o.title || o.name) === canon(awayName));
    const drawP = priceOf(o => /draw|tie/i.test(o.title || o.name || ''));
    if (!(homeP > 0) || !(awayP > 0)) continue;                     // necesitamos al menos home y away
    out.push({
      home: homeName, away: awayName, home_key: canon(homeName), away_key: canon(awayName),
      kickoff: m.expiresAt || m.inPlayStartsAt || null,
      outcomes: { home: homeP, draw: drawP, away: awayP },
      liquidity: Number(m.liquidity) || 0, volume24h: Number(m.volume24h) || 0,
      url: m.slug ? `https://myriad.markets/market/${m.slug}` : 'https://myriad.markets',
    });
  }
  _cache = { at: now, data: out };
  return out;
}

module.exports = { fetchMyriadMatches, canon, HOST };
