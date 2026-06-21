// kalshiNormalizer.js — versión 'kalshi-normalizer-1' (Sprint 1).
// Convierte respuestas crudas de Kalshi (market + orderbook) a la forma interna consistente.
// Kalshi da precios en DÓLARES (_dollars) y cantidades fixed-point (_fp). NUMERIC como string.
// El order book solo trae BIDS (yes y no); el lado ASK del YES se DERIVA: no_bid a X = yes_ask a (1−X).

'use strict';
const VERSION = 'kalshi-normalizer-1';

const s = v => (v === undefined || v === null || v === '') ? null : String(v);
function der(a, b, op) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const r = op === 'mid' ? (x + y) / 2 : x - y;
  return r.toFixed(8);
}
function statusOf(m) {
  const st = String(m.status || '').toLowerCase();
  if (st === 'settled' || st === 'finalized') return 'settled';
  if (st === 'closed') return 'closed';
  if (st === 'active' || st === 'open') return 'open';
  if (st === 'paused' || st === 'suspended') return 'suspended';
  return 'unknown';
}

// normalizeMarket(market, ctx) → { snapshot, catalog }
function normalizeMarket(market, ctx = {}) {
  const bestBid = market.yes_bid_dollars != null ? s(market.yes_bid_dollars) : null;
  const bestAsk = market.yes_ask_dollars != null ? s(market.yes_ask_dollars) : null;
  const lastTrade = market.last_price_dollars != null ? s(market.last_price_dollars) : null;
  const snapshot = {
    externalEventId: ctx.externalEventId || s(market.event_ticker) || null,
    externalMarketId: s(market.ticker),
    externalOutcomeId: 'yes',
    side: 'yes',
    marketStatus: statusOf(market),
    bestBid, bestAsk,
    midpoint: (bestBid && bestAsk) ? der(bestBid, bestAsk, 'mid') : null,
    lastTrade,
    spread: (bestBid && bestAsk) ? der(bestAsk, bestBid, 'sub') : null,
    volume: market.volume_fp != null ? s(market.volume_fp) : null,
    openInterest: market.open_interest_fp != null ? s(market.open_interest_fp) : null,
    availableDepth: null,               // Kalshi no reporta liquidez agregada → null (no 0)
    currency: 'USD',
    isLive: !!ctx.isLive,
    providerTimestamp: null,            // el market no trae ts fiable de cotización (ver freshness basis)
    normalizerVersion: VERSION,
    metadata: {
      provenance: { lastTrade: lastTrade ? 'provider_reported' : 'unavailable',
        bestBid: bestBid ? 'provider_reported' : 'unavailable', bestAsk: bestAsk ? 'provider_reported' : 'unavailable',
        midpoint: 'gp_derived', spread: 'gp_derived', openInterest: market.open_interest_fp != null ? 'provider_reported' : 'unavailable' },
      subtitle: market.yes_sub_title || market.no_sub_title || null,
      statusRaw: market.status || null,
    },
  };
  const catalog = {
    externalEventId: snapshot.externalEventId,
    externalMarketId: snapshot.externalMarketId,
    title: market.title || market.yes_sub_title || null,
    marketTypeRaw: 'binary',
    status: statusOf(market),
    closeTime: market.close_time || null,
    settlementTime: market.settlement_time || market.expiration_time || null,
    rawMetadata: { series: market.event_ticker || null },
  };
  return { snapshot, catalog };
}

// normalizeOrderBook(ob, ctx) → { levels, providerTimestamp }
// ob: { yes_dollars:[[price, count]], no_dollars:[[price, count]] }  (ambos son BIDS).
// yes bids = yes_dollars; yes asks = no_dollars con precio (1 − price_no). Determinístico, limita maxLevels.
function normalizeOrderBook(ob, ctx = {}) {
  const maxLevels = ctx.maxLevels || 20;
  const fp = ob && (ob.orderbook_fp || ob.orderbook || ob);
  const yes = (fp && (fp.yes_dollars || fp.yes)) || [];
  const no = (fp && (fp.no_dollars || fp.no)) || [];
  const toLevel = (price, size) => ({ price: Number(price), size: Number(size) });
  const yesBids = yes.map(l => toLevel(l[0], l[1]))
    .filter(l => Number.isFinite(l.price) && Number.isFinite(l.size) && l.price >= 0 && l.size >= 0)
    .sort((a, b) => b.price - a.price).slice(0, maxLevels)
    .map((l, i) => ({ side: 'bid', price: l.price.toFixed(8), size: l.size.toFixed(8), levelIndex: i }));
  // yes ask derivado del no bid: precio = 1 - precio_no (acotado a [0,1])
  const yesAsks = no.map(l => toLevel(l[0], l[1]))
    .filter(l => Number.isFinite(l.price) && Number.isFinite(l.size) && l.price >= 0 && l.size >= 0)
    .map(l => ({ price: Math.max(0, Math.min(1, 1 - l.price)), size: l.size }))
    .sort((a, b) => a.price - b.price).slice(0, maxLevels)
    .map((l, i) => ({ side: 'ask', price: l.price.toFixed(8), size: l.size.toFixed(8), levelIndex: i }));
  return { levels: [...yesBids, ...yesAsks], providerTimestamp: null };
}

module.exports = { VERSION, normalizeMarket, normalizeOrderBook };
