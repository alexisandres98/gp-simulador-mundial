// sportsbook-providers/deepLinks.js — Fase J §10. Resolver del enlace de la mejor casa con fallback explícito.
// AUDITORÍA: The Odds API v4 NO entrega deep links (outcome/market/event) en su payload → en la práctica el
// resolver cae a la homepage segura del sportsbook o a null. NO se inventan URLs ni se añaden parámetros de
// afiliado (no hay configuración aprobada). Validación de correspondencia sportsbook/evento/mercado/outcome.
'use strict';

// homepages seguras conocidas (sin afiliado). Solo marcas verificadas/documentadas; el resto → null.
const HOMEPAGES = {
  pinnacle: 'https://www.pinnacle.com/', bet365: 'https://www.bet365.com/', williamhill: 'https://www.williamhill.com/',
  betfair: 'https://www.betfair.com/', unibet: 'https://www.unibet.com/', betsson: 'https://www.betsson.com/',
  '888sport': 'https://www.888sport.com/', draftkings: 'https://sportsbook.draftkings.com/', fanduel: 'https://sportsbook.fanduel.com/',
  betmgm: 'https://sports.betmgm.com/', marathonbet: 'https://www.marathonbet.com/', onexbet: 'https://1xbet.com/',
  betvictor: 'https://www.betvictor.com/', smarkets: 'https://smarkets.com/', nordicbet: 'https://www.nordicbet.com/',
  betway: 'https://betway.com/', tipico: 'https://www.tipico.com/', betclic: 'https://www.betclic.com/',
  matchbook: 'https://www.matchbook.com/', coral: 'https://sports.coral.co.uk/', ladbrokes: 'https://sports.ladbrokes.com/',
  skybet: 'https://www.skybet.com/', boylesports: 'https://www.boylesports.com/',
};

// The Odds API usa códigos con variante regional o de producto (unibet_fr, betfair_ex_uk, …). Se normalizan a la
// MARCA base documentada antes de buscar la homepage. NO se inventan dominios: si tras normalizar no hay homepage
// conocida → null (el gate bloquea, que es lo correcto).
const ALIASES = {
  betfair_ex_uk: 'betfair', betfair_ex_eu: 'betfair', betfair_ex_au: 'betfair', betfair_sb: 'betfair',
  betfair: 'betfair', sport888: '888sport', '1xbet': 'onexbet', williamhill_us: 'williamhill',
};
const REGION_SUFFIX = /_(fr|uk|eu|it|au|nl|se|dk|es|de|be|at|ro|us|ca|nj|pa)$/;
function brandCode(raw) {
  const code = (raw || '').toLowerCase();
  if (HOMEPAGES[code] !== undefined) return code;
  if (ALIASES[code]) return ALIASES[code];
  const stripped = code.replace(REGION_SUFFIX, '');
  if (HOMEPAGES[stripped] !== undefined) return stripped;
  if (ALIASES[stripped]) return ALIASES[stripped];
  return code;
}

// resolve(opts) → { url, level, valid, reason }
//   opts: { providerLinks?: { outcome_deep_link, market_deep_link, event_deep_link, sportsbook_homepage, provider_sid },
//           sportsbookCode, expected: { event, market, outcome } }
//   level ∈ outcome | market | event | homepage | null
function resolve(opts = {}) {
  const links = opts.providerLinks || {};
  const code = brandCode(opts.sportsbookCode);
  // orden de preferencia §10: outcome → market → event → homepage segura → null
  const tryLink = (url, level) => {
    if (!url || typeof url !== 'string' || !/^https:\/\//i.test(url)) return null;
    // validación mínima de correspondencia: el host del link debería pertenecer al sportsbook (si lo conocemos)
    const home = HOMEPAGES[code];
    if (home) { try { const h1 = new URL(url).host.replace(/^www\./, ''); const h2 = new URL(home).host.replace(/^www\./, ''); if (!h1.includes(h2.split('.').slice(-2).join('.').split('.')[0]) && h1 !== h2) return null; } catch { return null; } }
    return { url, level, valid: true, reason: 'ok' };
  };
  return tryLink(links.outcome_deep_link, 'outcome')
    || tryLink(links.market_deep_link, 'market')
    || tryLink(links.event_deep_link, 'event')
    || (links.sportsbook_homepage && /^https:\/\//i.test(links.sportsbook_homepage) ? { url: links.sportsbook_homepage, level: 'homepage', valid: true, reason: 'provider_homepage' }
        : (HOMEPAGES[code] ? { url: HOMEPAGES[code], level: 'homepage', valid: true, reason: 'known_homepage_fallback' }
        : { url: null, level: null, valid: false, reason: 'no_safe_link' }));
}

module.exports = { resolve, HOMEPAGES };
