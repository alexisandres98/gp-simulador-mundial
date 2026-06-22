// value-engine/sportsbookProvider.js — Sprint 7 §6. Interfaz provider-agnostic de cuotas de sportsbooks.
// NO acopla a un proveedor. HOY no hay proveedor autorizado conectado → provider 'none' (health unavailable).
// Un agregador autorizado (p.ej. The Odds API) implementaría este contrato separando data_provider vs sportsbook.
'use strict';

// Contrato: { discoverEvents, fetchMarkets, fetchQuotes, normalizeEvent, normalizeMarket, normalizeQuote, health }
// El "manual provider" permite cargar cuotas desde un payload documentado (tests/admin), conservando origen +
// separando sportsbook / operator_group / independence_group (§7). Nunca scraping no autorizado.
function manualProvider({ dataProvider = 'manual', records = [] } = {}) {
  return {
    name: dataProvider,
    async discoverEvents() { return [...new Set(records.map(r => r.external_event_id))]; },
    async fetchMarkets() { return [...new Set(records.map(r => r.external_market_id))]; },
    async fetchQuotes() { return records; },
    normalizeQuote(r) {
      return {
        data_provider: dataProvider, sportsbook_code: r.sportsbook, operator_group: r.operator_group || r.sportsbook,
        independence_group: r.independence_group || r.operator_group || r.sportsbook, source_role: r.source_role || 'market_consensus',
        external_event_id: r.external_event_id, external_market_id: r.external_market_id, external_outcome_id: r.external_outcome_id,
        market_family: r.market_family || 'match_1x2', period: r.period || 'regulation_90m', is_live: !!r.is_live,
        odds_format: r.odds_format || 'decimal', odds_decimal: r.odds_decimal, quote_status: r.quote_status || 'open',
        quote_timestamp: r.quote_timestamp || null, currency: r.currency || null, source_url: r.source_url || null, deep_link: r.deep_link || null,
        maximum_stake: r.maximum_stake != null ? r.maximum_stake : null, // null cuando el proveedor no da límites (§23)
      };
    },
    normalizeEvent(e) { return e; },
    normalizeMarket(m) { return m; },
    async health() { return { status: records.length ? 'ok' : 'no_data', records: records.length }; },
  };
}

// noneProvider — el estado real HOY: sin proveedor autorizado de sportsbooks.
function noneProvider() {
  return {
    name: 'none',
    async discoverEvents() { return []; }, async fetchMarkets() { return []; }, async fetchQuotes() { return []; },
    normalizeQuote() { return null; }, normalizeEvent(e) { return e; }, normalizeMarket(m) { return m; },
    async health() { return { status: 'unavailable', reason: 'no_authorized_sportsbook_provider_connected' }; },
  };
}

// resolveProvider() → el provider configurado. Sin SPORTSBOOK_DATA_ENABLED → none.
function resolveProvider(opts) { if (opts && opts.records) return manualProvider(opts); return noneProvider(); }

module.exports = { manualProvider, noneProvider, resolveProvider };
