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
async function fetchMyriadMatches({ timeoutMs = 6000, ttlMs = 60000, now = Date.now(), limit = 100 } = {}) {
  if (_cache.data.length && (now - _cache.at) < ttlMs) return _cache.data;
  let rows = [];
  try {
    const ctrl = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    // 15-ago (BUG que tenía a Myriad aportando CERO cuotas desde siempre): pedíamos `sort=volume_24h` SIN
    // filtrar estado, y el volumen histórico lo dominan los mercados YA RESUELTOS — las 60 filas que volvían
    // eran todas 'resolved' y el filtro de abajo las tiraba todas. `state=open` devuelve los que se pueden
    // operar hoy (verificado: 7 partidos con 1X2 completo y 500k de liquidez). Se ordena por vencimiento:
    // lo que cierra antes es lo que se juega antes, que es justo lo que necesitamos cotizar.
    const r = await fetch(`${HOST}/markets?state=open&keyword=vs&page=1&limit=${Math.max(60, limit)}&sort=expires_at`, ctrl ? { signal: ctrl } : {});
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
    // los mercados "perpetuos" (política, cripto: "Macron vs Owens", vencimiento 2100) también matchean el
    // patrón "X vs Y: Who wins?" — se descartan por fecha: un partido cierra dentro de los próximos 30 días.
    const kt = Date.parse(m.expiresAt || m.inPlayStartsAt || 0);
    if (!isFinite(kt) || kt > now + 30 * 864e5) continue;
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
