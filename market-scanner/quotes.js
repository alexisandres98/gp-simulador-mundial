// market-scanner/quotes.js — ADAPTADOR de venue: lee cuotas normalizadas de la DB y las agrupa en MERCADOS
// que el núcleo puro (scanner.js) sabe escanear. Hoy cubre sportsbooks (the_odds_api): 1X2 + totales O/U.
// Diseñado para que agregar prediction markets (Polymarket/Kalshi/Myriad/…) sea sumar una función que
// devuelve mercados con la misma forma → mismo consenso, misma detección. Venue-agnóstico aguas abajo.

'use strict';

// Exchanges: la cuota "back" mostrada es PRE-comisión (se netea en el arb). betfair_sb_* NO es exchange.
const EXCHANGE_BOOKS = new Set(['betfair_ex_eu', 'betfair_ex_uk', 'matchbook', 'smarkets']);
const isExchange = (code) => EXCHANGE_BOOKS.has(code) || /(?:^|_)ex(?:_|$)/.test(code || '');

const ms = (t) => { const v = t ? +new Date(t) : NaN; return Number.isFinite(v) ? v : null; };
const outcomeOf = (externalOutcomeId) => { const parts = String(externalOutcomeId || '').split(':'); return parts[parts.length - 1]; };

// Fallback de grupo de independencia cuando sportsbook_source_metadata no lo trae (muchas casas locales faltan).
// Quita el sufijo de país/locale para que las variantes de la MISMA marca (unibet_se/unibet_nl/unibet_fr = Kindred;
// winamax_de/winamax_fr; leovegas_se) colapsen a un solo grupo → consenso honesto (no sobre-cuenta casas correlacionadas).
const LOCALE_SUFFIX = /_(?:se|se2|no|dk|fi|nl|fr|de|at|es|it|pt|br|uk|us|us2|au|eu|ca|ie|be|ro|pl|nj|pa|co)$/i;
const brandGroup = (code) => String(code || '').replace(LOCALE_SUFFIX, '').replace(/_(?:sb|ex)$/i, '') || code;
// La columna independence_group suele venir AUTO-REFERENCIADA (unibet_fr→'unibet_fr') para la cola larga de casas
// → inútil para deduplicar. Solo la respetamos cuando apunta a un grupo REAL distinto del código (p.ej. betfair→'flutter',
// nordicbet→'betsson'); si es self-ref o falta, derivamos la marca (colapsa unibet_se/nl/fr → 'unibet').
const indepGroup = (row) => {
  const code = row.sportsbook_code;
  if (row.independence_group && row.independence_group !== code) return row.independence_group;
  if (row.operator_group && row.operator_group !== code) return row.operator_group;
  return brandGroup(code);
};

// ---- Sportsbooks: 1X2 (mercado principal) ----
async function loadSportsbook1x2(db, { provider = 'the_odds_api', includePast = false } = {}) {
  const r = await db.query(
    `SELECT external_event_id, sportsbook_code, sportsbook_name, independence_group, operator_group, source_role,
            external_outcome_id, odds_decimal, maximum_stake, stake_limit_status, is_live, observed_at,
            metadata->>'home_team' AS home_team, metadata->>'away_team' AS away_team,
            metadata->>'commence_time' AS commence_time
       FROM sportsbook_quote_current
      WHERE data_provider = $1 AND market_family = '1x2' AND period = 'regulation'
        AND quote_status = 'open'
        ${includePast ? '' : "AND (metadata->>'commence_time')::timestamptz > now() - interval '3 hours'"}`,
    [provider]);
  const byEvent = new Map();
  for (const row of r.rows) {
    const eid = row.external_event_id;
    if (!byEvent.has(eid)) {
      byEvent.set(eid, {
        source: 'sportsbook', venue_kind: 'sportsbook',
        event_id: eid, market_family: '1x2', period: 'regulation', line: null,
        universe: ['home', 'draw', 'away'],
        home: row.home_team, away: row.away_team, kickoff: row.commence_time,
        quotes: [],
      });
    }
    const outcome = outcomeOf(row.external_outcome_id);
    if (!['home', 'draw', 'away'].includes(outcome)) continue;
    byEvent.get(eid).quotes.push({
      venue: row.sportsbook_code, venue_label: row.sportsbook_name || row.sportsbook_code,
      independence_group: indepGroup(row),
      source_role: row.source_role, outcome,
      odds_decimal: Number(row.odds_decimal),
      observed_at: ms(row.observed_at),
      max_stake: row.maximum_stake != null ? Number(row.maximum_stake) : null,
      live: !!row.is_live, is_exchange: isExchange(row.sportsbook_code),
      venue_kind: 'sportsbook',
    });
  }
  return [...byEvent.values()];
}

// ---- Sportsbooks: TOTALES Over/Under (por línea) ----
async function loadSportsbookTotals(db, { provider = 'the_odds_api', includePast = false } = {}) {
  // el goal-quote no trae independence_group/source_role → se enriquece con sportsbook_source_metadata.
  const r = await db.query(
    `SELECT g.external_event_id, g.sportsbook_code, g.line, g.side, g.team_scope,
            g.odds_decimal, g.is_live, g.observed_at,
            m.sportsbook_name, m.independence_group, m.operator_group, m.source_role,
            c.metadata->>'home_team' AS home_team, c.metadata->>'away_team' AS away_team,
            c.metadata->>'commence_time' AS commence_time
       FROM sportsbook_goal_quote_current g
       LEFT JOIN sportsbook_source_metadata m ON m.sportsbook_code = g.sportsbook_code
       LEFT JOIN LATERAL (
         SELECT metadata FROM sportsbook_quote_current s
          WHERE s.external_event_id = g.external_event_id AND s.metadata ? 'home_team' LIMIT 1
       ) c ON true
      WHERE g.data_provider = $1 AND g.market_family = 'match_total'
        AND coalesce(g.team_scope,'match') = 'match' AND coalesce(g.quote_status,'open') = 'open'
        ${includePast ? '' : "AND (c.metadata->>'commence_time')::timestamptz > now() - interval '3 hours'"}`,
    [provider]).catch(() => ({ rows: [] }));
  const byKey = new Map();
  for (const row of r.rows) {
    const side = String(row.side || '').toLowerCase();
    if (!['over', 'under'].includes(side)) continue;
    const line = Number(row.line);
    if (!Number.isFinite(line)) continue;
    const key = row.external_event_id + '|' + line;
    if (!byKey.has(key)) {
      byKey.set(key, {
        source: 'sportsbook', venue_kind: 'sportsbook',
        event_id: row.external_event_id, market_family: 'match_total', period: 'regulation', line,
        universe: ['over', 'under'],
        home: row.home_team, away: row.away_team, kickoff: row.commence_time,
        quotes: [],
      });
    }
    byKey.get(key).quotes.push({
      venue: row.sportsbook_code, venue_label: row.sportsbook_name || row.sportsbook_code,
      independence_group: indepGroup(row),
      source_role: row.source_role || 'market_consensus', outcome: side,
      odds_decimal: Number(row.odds_decimal),
      observed_at: ms(row.observed_at), max_stake: null,
      live: !!row.is_live, is_exchange: isExchange(row.sportsbook_code),
      venue_kind: 'sportsbook',
    });
  }
  // Solo líneas con ambos lados y suficientes casas (una línea "huérfana" no sirve para arb ni consenso).
  return [...byKey.values()].filter(m => {
    const sides = new Set(m.quotes.map(q => q.outcome));
    return sides.has('over') && sides.has('under') && m.quotes.length >= 4;
  });
}

// ---- Myriad (prediction market con 1X2 por partido): fusiona sus precios al mercado 1X2 de la casa por par de
// equipos. Myriad es peer-to-peer sin vig → referencia limpia extra en el consenso, y venue tradeable (vender).
const myriad = require('./venues/myriad');
async function mergeMyriad(oneX2Markets, { now = Date.now() } = {}) {
  const matches = await myriad.fetchMyriadMatches({ now }).catch(() => []);
  if (!matches.length) return 0;
  // índice de mercados de casa por par de equipos normalizado
  const byPair = new Map();
  for (const m of oneX2Markets) byPair.set(myriad.canon(m.home) + '|' + myriad.canon(m.away), m);
  let merged = 0;
  for (const mm of matches) {
    const mk = byPair.get(mm.home_key + '|' + mm.away_key);
    if (!mk) continue; // sin partido de casa que casar → se ignora (no creamos standalone de 1 solo venue)
    for (const oc of ['home', 'draw', 'away']) {
      const price = mm.outcomes[oc];
      if (!(price > 0 && price < 1)) continue;
      mk.quotes.push({
        venue: 'myriad', venue_label: 'Myriad',
        independence_group: 'myriad', source_role: 'prediction_market', outcome: oc,
        odds_decimal: 1 / price, observed_at: now,
        max_stake: mm.liquidity || null, live: false, is_exchange: false, venue_kind: 'pm',
      });
    }
    merged++;
  }
  return merged;
}

// ---- Carga total de mercados (todos los venues habilitados) ----
async function loadMarkets(db, { includeTotals = true, includePredictionMarkets = false, includeMyriad = false, now = Date.now() } = {}) {
  const markets = [];
  const oneX2 = await loadSportsbook1x2(db, {}).catch(() => []);
  markets.push(...oneX2);
  if (includeTotals) {
    const totals = await loadSportsbookTotals(db, {}).catch(() => []);
    markets.push(...totals);
  }
  // Myriad: fusiona su 1X2 por partido al mercado de la casa (suma un venue no-vig al consenso + arb/lag).
  if (includeMyriad) await mergeMyriad(oneX2, { now }).catch(() => {});
  // Poly/Kalshi (campeón) se inyectan como extraMarkets desde server (marketCache), no acá.
  return markets;
}

module.exports = { loadMarkets, loadSportsbook1x2, loadSportsbookTotals, isExchange, EXCHANGE_BOOKS };
