// kalshiCollector.js — adapter persistente de Kalshi (Sprint 1). Independiente del flujo legacy.
// Contrato: collectMarkets(), fetchOrderBook(market), health(). NO coloca órdenes, NO auth.

'use strict';
const { fetchJson } = require('../http');
const N = require('../normalizers/kalshiNormalizer');
const cfg = require('../config');

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const SERIES = 'KXMENWORLDCUP-26';

function opts() { const r = cfg.resilience('kalshi'); return { timeoutMs: r.requestTimeoutMs, maxRetries: r.maxRetries, backoffMs: r.backoffMs }; }

// collectMarkets({ eventTicker?, maxPages?, fetcher? }) → { markets:[{raw, normalized, externalMarketId}], stats }
async function collectMarkets({ eventTicker = SERIES, maxPages = 5, fetcher = fetchJson } = {}) {
  const stats = { requestCount: 0, retryCount: 0, rateLimited: 0, errors: [], latencies: [] };
  const out = [];
  let cursor = '', pages = 0;
  while (pages++ < maxPages) {
    const url = `${BASE}/markets?event_ticker=${encodeURIComponent(eventTicker)}&limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
    const r = await fetcher(url, opts());
    stats.requestCount++; stats.retryCount += r.retryCount || 0; stats.rateLimited += r.rateLimited || 0;
    if (r.latencyMs != null) stats.latencies.push(r.latencyMs);
    if (!r.ok || !r.json) { stats.errors.push(`markets p${pages}: ${r.error || 'sin datos'}`); break; }
    for (const m of r.json.markets || []) {
      const normalized = N.normalizeMarket(m, { externalEventId: eventTicker, isLive: false });
      out.push({ raw: m, normalized, externalMarketId: normalized.snapshot.externalMarketId });
    }
    cursor = r.json.cursor;
    if (!cursor) break;
  }
  return { markets: out, stats };
}

// fetchOrderBook(market, { fetcher? }) → { raw, normalized:{levels,...}, stats } | null
async function fetchOrderBook(market, { fetcher = fetchJson } = {}) {
  const stats = { requestCount: 0, retryCount: 0, rateLimited: 0, errors: [], latencies: [] };
  const ticker = market.externalMarketId || (market.raw && market.raw.ticker);
  if (!ticker) return null;
  const r = await fetcher(`${BASE}/markets/${encodeURIComponent(ticker)}/orderbook`, opts());
  stats.requestCount++; stats.retryCount += r.retryCount || 0; stats.rateLimited += r.rateLimited || 0;
  if (r.latencyMs != null) stats.latencies.push(r.latencyMs);
  if (!r.ok || !r.json) { stats.errors.push(`book ${ticker}: ${r.error || 'sin book'}`); return { raw: null, normalized: null, stats }; }
  const ob = r.json.orderbook || r.json;
  const normalized = N.normalizeOrderBook(ob, { maxLevels: cfg.orderbookMaxLevels });
  return { raw: r.json, normalized, stats };
}

async function health({ fetcher = fetchJson } = {}) {
  const r = await fetcher(`${BASE}/markets?event_ticker=${SERIES}&limit=1`, { ...opts(), maxRetries: 0 });
  return { provider: 'kalshi', reachable: !!r.ok, status: r.status, latencyMs: r.latencyMs };
}

module.exports = { name: 'kalshi', normalizerVersion: N.VERSION, collectMarkets, fetchOrderBook, health, SERIES };
