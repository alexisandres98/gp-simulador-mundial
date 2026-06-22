// polymarketNormalizer.js — versión 'polymarket-normalizer-1' (Sprint 1).
// Convierte respuestas crudas de Polymarket (gamma market + CLOB book) a la forma interna consistente.
// Reglas: NUMERIC como string (no float); spread/midpoint marcados como gp_derived; open interest no
// aplica (null, no 0); no asumir que last == ask ni que midpoint es ejecutable. Determinístico, puro.

'use strict';
const VERSION = 'polymarket-normalizer-1';

const s = v => (v === undefined || v === null || v === '') ? null : String(v);
function der(a, b, op) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const r = op === 'mid' ? (x + y) / 2 : x - y;
  return r.toFixed(8);
}
function statusOf(m) {
  if (m.archived) return 'closed';
  if (m.closed) return 'settled';
  if (m.active === false) return 'suspended';
  if (m.acceptingOrders === false) return 'closed';
  return 'open';
}

// normalizeMarket(market, ctx) → { snapshot, catalog }  (un outcome/market binario de Polymarket)
// ctx: { externalEventId, side }  (side: 'yes' | 'home' | 'draw' | 'away' según el tipo de evento)
function normalizeMarket(market, ctx = {}) {
  let lastTrade = null;
  try { lastTrade = s(JSON.parse(market.outcomePrices)[0]); } catch { lastTrade = null; }
  const bestBid = market.bestBid != null ? s(market.bestBid) : null;
  const bestAsk = market.bestAsk != null ? s(market.bestAsk) : null;
  const externalMarketId = s(market.conditionId || market.id || market.slug);
  const snapshot = {
    externalEventId: ctx.externalEventId || null,
    externalMarketId,
    externalOutcomeId: tokenId(market, 0),
    side: ctx.side || 'yes',
    marketStatus: statusOf(market),
    bestBid, bestAsk,
    midpoint: (bestBid && bestAsk) ? der(bestBid, bestAsk, 'mid') : null,
    lastTrade,
    spread: (bestBid && bestAsk) ? der(bestAsk, bestBid, 'sub') : null,
    volume: s(market.volumeNum != null ? market.volumeNum : market.volume),
    openInterest: null,                 // Polymarket no reporta OI → null (no 0)
    availableDepth: s(market.liquidityNum != null ? market.liquidityNum : market.liquidity),
    currency: 'USD',
    isLive: !!ctx.isLive,
    providerTimestamp: null,            // gamma no da ts de cotización; el book CLOB sí (ver normalizeOrderBook)
    normalizerVersion: VERSION,
    metadata: {
      provenance: { lastTrade: 'provider_reported', bestBid: bestBid ? 'provider_reported' : 'unavailable',
        bestAsk: bestAsk ? 'provider_reported' : 'unavailable', midpoint: 'gp_derived', spread: 'gp_derived',
        openInterest: 'unavailable' },
      question: market.groupItemTitle || market.question || null,
      clobTokenIds: clobTokens(market),
    },
  };
  const catalog = {
    externalEventId: ctx.externalEventId || null,
    externalMarketId,
    title: market.groupItemTitle || market.question || null,
    // texto de reglas para el Canonical Graph (gamma lo da en `description`); sin esto el matcher marca rules_missing
    description: market.description || null,
    marketTypeRaw: market.outcomes ? 'binary' : null,
    status: statusOf(market),
    closeTime: market.endDate || market.endDateIso || null,
    resolutionSource: market.resolutionSource || null,
    rawMetadata: { slug: market.slug || null },
  };
  return { snapshot, catalog };
}

function clobTokens(market) {
  try { return JSON.parse(market.clobTokenIds); } catch { return Array.isArray(market.clobTokenIds) ? market.clobTokenIds : null; }
}
function tokenId(market, idx) { const t = clobTokens(market); return t && t[idx] != null ? String(t[idx]) : null; }

// normalizeOrderBook(book, ctx) → { levels:[{side,price,size,levelIndex}], providerTimestamp }
// book CLOB: { bids:[{price,size}], asks:[{price,size}], timestamp }. Ordena determinísticamente:
// bids descendente por precio (mejor primero), asks ascendente. Rechaza negativos. Limita maxLevels.
function normalizeOrderBook(book, ctx = {}) {
  const maxLevels = ctx.maxLevels || 20;
  const clean = (arr, side) => (Array.isArray(arr) ? arr : [])
    .map(l => ({ price: Number(l.price), size: Number(l.size) }))
    .filter(l => Number.isFinite(l.price) && Number.isFinite(l.size) && l.price >= 0 && l.size >= 0)
    .sort((a, b) => side === 'bid' ? b.price - a.price : a.price - b.price)
    .slice(0, maxLevels)
    .map((l, i) => ({ side, price: l.price.toFixed(8), size: l.size.toFixed(8), levelIndex: i }));
  const levels = [...clean(book.bids, 'bid'), ...clean(book.asks, 'ask')];
  const providerTimestamp = book.timestamp ? new Date(Number(book.timestamp) * (String(book.timestamp).length <= 10 ? 1000 : 1)).toISOString() : null;
  return { levels, providerTimestamp };
}

module.exports = { VERSION, normalizeMarket, normalizeOrderBook };
