// polymarketCollector.js — adapter persistente de Polymarket (Sprint 1). Independiente del flujo legacy.
// Contrato: collectMarkets(), fetchOrderBook(market), health(). NO coloca órdenes, NO usa wallets, NO auth.

'use strict';
const { fetchJson } = require('../http');
const N = require('../normalizers/polymarketNormalizer');
const cfg = require('../config');

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const CHAMPION_SLUG = 'world-cup-winner';

function opts() { const r = cfg.resilience('polymarket'); return { timeoutMs: r.requestTimeoutMs, maxRetries: r.maxRetries, backoffMs: r.backoffMs }; }

// collectMarkets({ seedSlugs?, fetcher? }) → { markets:[{raw, normalized, externalMarketId, side}], stats }
// markets del campeón + (opcional) slugs de partido ya rastreados. Cada market trae su snapshot inline.
async function collectMarkets({ seedSlugs = [], fetcher = fetchJson } = {}) {
  const stats = { requestCount: 0, retryCount: 0, rateLimited: 0, errors: [], latencies: [] };
  const out = [];
  const slugs = [CHAMPION_SLUG, ...seedSlugs];
  for (const slug of slugs) {
    const r = await fetcher(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`, opts());
    stats.requestCount++; stats.retryCount += r.retryCount || 0; stats.rateLimited += r.rateLimited || 0;
    if (r.latencyMs != null) stats.latencies.push(r.latencyMs);
    if (!r.ok || !Array.isArray(r.json) || !r.json[0]) { stats.errors.push(`${slug}: ${r.error || 'sin evento'}`); continue; }
    const ev = r.json[0];
    const isMatch = slug !== CHAMPION_SLUG;
    for (const m of ev.markets || []) {
      const side = isMatch ? sideForMatch(m) : 'yes';
      const ctx = { externalEventId: String(ev.slug || ev.id || slug), side, isLive: false };
      const normalized = N.normalizeMarket(m, ctx);
      out.push({ raw: m, normalized, externalMarketId: normalized.snapshot.externalMarketId, side, eventSlug: ev.slug || slug });
    }
  }
  return { markets: out, stats };
}

function sideForMatch(m) {
  const t = String(m.groupItemTitle || m.question || '').toLowerCase();
  if (/draw|empate|tie/.test(t)) return 'draw';
  return 'team'; // el lado concreto (home/away) lo resuelve el catálogo/mapeo en Sprint 2
}

// fetchOrderBook(market, { fetcher? }) → { raw, normalized:{levels,providerTimestamp}, stats } | null
async function fetchOrderBook(market, { fetcher = fetchJson } = {}) {
  const stats = { requestCount: 0, retryCount: 0, rateLimited: 0, errors: [], latencies: [] };
  const tokens = clobTokens(market.raw);
  const tokenId = tokens && tokens[0];
  if (!tokenId) return null;
  const r = await fetcher(`${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`, opts());
  stats.requestCount++; stats.retryCount += r.retryCount || 0; stats.rateLimited += r.rateLimited || 0;
  if (r.latencyMs != null) stats.latencies.push(r.latencyMs);
  if (!r.ok || !r.json) { stats.errors.push(`book ${market.externalMarketId}: ${r.error || 'sin book'}`); return { raw: null, normalized: null, stats }; }
  const normalized = N.normalizeOrderBook(r.json, { maxLevels: cfg.orderbookMaxLevels });
  return { raw: r.json, normalized, stats };
}

function clobTokens(market) {
  try { return JSON.parse(market.clobTokenIds); } catch { return Array.isArray(market.clobTokenIds) ? market.clobTokenIds : null; }
}

async function health({ fetcher = fetchJson } = {}) {
  const r = await fetcher(`${GAMMA}/events?slug=${CHAMPION_SLUG}`, { ...opts(), maxRetries: 0 });
  return { provider: 'polymarket', reachable: !!r.ok, status: r.status, latencyMs: r.latencyMs };
}

module.exports = { name: 'polymarket', normalizerVersion: N.VERSION, collectMarkets, fetchOrderBook, health, CHAMPION_SLUG };
