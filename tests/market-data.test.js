// tests/market-data.test.js — tests PUROS de la capa de ingesta (Sprint 1, sin DB).
// Ejecutar: node tests/market-data.test.js
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const fx = f => JSON.parse(fs.readFileSync(path.join(R, 'market-data/fixtures', f), 'utf8'));

const polyN = require(R + '/market-data/normalizers/polymarketNormalizer');
const kalN = require(R + '/market-data/normalizers/kalshiNormalizer');
const freshness = require(R + '/market-data/freshness');
const http = require(R + '/market-data/http');

console.log('Market-data — tests puros Sprint 1\n');

// ---- Normalizer Polymarket ----
console.log('Normalizer Polymarket');
{
  const ev = fx('polymarket-champion.json')[0];
  const m = ev.markets[0];
  const { snapshot, catalog } = polyN.normalizeMarket(m, { externalEventId: ev.slug, side: 'yes' });
  ok('bestBid/bestAsk como string', snapshot.bestBid === '0.21' && snapshot.bestAsk === '0.23');
  ok('midpoint derivado (gp_derived)', snapshot.midpoint === '0.22000000' && snapshot.metadata.provenance.midpoint === 'gp_derived');
  ok('spread derivado', snapshot.spread === '0.02000000');
  ok('lastTrade = outcomePrices[0]', snapshot.lastTrade === '0.22');
  ok('openInterest null (no 0) en Polymarket', snapshot.openInterest === null);
  ok('externalMarketId = conditionId estable', snapshot.externalMarketId === '0xCONDITION_BRA');
  ok('normalizerVersion versionada por proveedor', snapshot.normalizerVersion === 'polymarket-normalizer-1');
  ok('status normalizado open', snapshot.marketStatus === 'open' && catalog.status === 'open');
}

// ---- Order book Polymarket ----
console.log('Order book Polymarket');
{
  const book = fx('polymarket-book.json');
  const { levels, providerTimestamp } = polyN.normalizeOrderBook(book, { maxLevels: 20 });
  const bids = levels.filter(l => l.side === 'bid'), asks = levels.filter(l => l.side === 'ask');
  ok('bids descendente (mejor primero)', bids[0].price === '0.21000000' && bids[1].price === '0.20000000');
  ok('asks ascendente (mejor primero)', asks[0].price === '0.23000000' && asks[1].price === '0.24000000');
  ok('level 0 = mejor nivel', bids[0].levelIndex === 0 && asks[0].levelIndex === 0);
  ok('size como string (NUMERIC)', bids[0].size === '1500.00000000' && typeof bids[0].size === 'string');
  ok('provider_timestamp del book (epoch→ISO)', /^2026-/.test(providerTimestamp));
  const limited = polyN.normalizeOrderBook(book, { maxLevels: 2 });
  ok('maxLevels respetado', limited.levels.filter(l => l.side === 'bid').length === 2);
  const neg = polyN.normalizeOrderBook({ bids: [{ price: '-0.1', size: '10' }, { price: '0.2', size: '5' }], asks: [] }, {});
  ok('precios negativos rechazados', neg.levels.length === 1 && neg.levels[0].price === '0.20000000');
}

// ---- Normalizer + order book Kalshi (derivación ask = 1 - no) ----
console.log('Normalizer Kalshi');
{
  const mk = fx('kalshi-markets.json').markets[0];
  const { snapshot } = kalN.normalizeMarket(mk, { externalEventId: 'KXMENWORLDCUP-26' });
  ok('open interest reportado (no inventado)', snapshot.openInterest === '120000.00' && snapshot.metadata.provenance.openInterest === 'provider_reported');
  ok('volume fixed-point como string', snapshot.volume === '45000.00');
  ok('ticker como externalMarketId', snapshot.externalMarketId === 'KXMENWORLDCUP-26-BRA');
  ok('availableDepth null en Kalshi (no 0)', snapshot.availableDepth === null);
  const ob = kalN.normalizeOrderBook(fx('kalshi-orderbook.json').orderbook, { maxLevels: 20 });
  const bids = ob.levels.filter(l => l.side === 'bid'), asks = ob.levels.filter(l => l.side === 'ask');
  ok('yes bids del yes_dollars', bids[0].price === '0.21000000');
  ok('yes ask DERIVADO = 1 - no (0.77→0.23)', asks[0].price === '0.23000000');
  ok('asks derivados ascendentes', asks[0].price < asks[1].price);
}

// ---- Precisión (NUMERIC string, no float, null no es 0) ----
console.log('Precisión numérica');
{
  const m = { outcomePrices: '["0.123456789", "x"]', bestBid: '0.10000001', bestAsk: '0.30000009' };
  const { snapshot } = polyN.normalizeMarket(m, {});
  ok('no se pierde precisión (string crudo)', snapshot.lastTrade === '0.123456789');
  ok('null cuando falta dato (no 0)', snapshot.volume === null);
}

// ---- Freshness ----
console.log('Freshness');
{
  const now = Date.UTC(2026, 5, 21, 12, 0, 0);
  const iso = ms => new Date(now - ms).toISOString();
  ok('fresh (≤2×intervalo)', freshness.classify({ providerTimestamp: iso(40000), expectedIntervalMs: 30000, now }).state === 'fresh');
  ok('aging (>2× y ≤5×)', freshness.classify({ providerTimestamp: iso(90000), expectedIntervalMs: 30000, now }).state === 'aging');
  ok('stale (>5×)', freshness.classify({ providerTimestamp: iso(200000), expectedIntervalMs: 30000, now }).state === 'stale');
  ok('unknown sin timestamps', freshness.classify({ expectedIntervalMs: 30000, now }).state === 'unknown');
  const b = freshness.classify({ receivedAt: iso(10000), expectedIntervalMs: 30000, now });
  ok('basis received_at cuando no hay provider ts', b.basis === 'received_at' && b.state === 'fresh');
}

// ---- HTTP resiliencia (stub de global.fetch) ----
console.log('HTTP resiliencia');
(async () => {
  const realFetch = global.fetch;
  const mkRes = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: k => headers[k] || null } });
  // 429 then 200, respeta Retry-After=0
  let seq = [() => mkRes(429, null, { 'retry-after': '0' }), () => mkRes(200, { ok: true })]; let i = 0;
  global.fetch = async () => seq[i++]();
  let r = await http.fetchJson('http://x', { maxRetries: 2, backoffMs: 1, rand: () => 0 });
  ok('reintenta tras 429 y respeta Retry-After', r.ok && r.retryCount === 1 && r.rateLimited === 1);
  // 500 then 200
  seq = [() => mkRes(500), () => mkRes(200, { ok: true })]; i = 0;
  r = await http.fetchJson('http://x', { maxRetries: 2, backoffMs: 1, rand: () => 0 });
  ok('reintenta tras 500', r.ok && r.retryCount === 1);
  // 400 no retry
  seq = [() => mkRes(400)]; i = 0;
  r = await http.fetchJson('http://x', { maxRetries: 2, backoffMs: 1, rand: () => 0 });
  ok('NO reintenta 400', !r.ok && r.retryCount === 0 && r.status === 400);
  // timeout (AbortError) then 200
  seq = [() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, () => mkRes(200, { ok: true })]; i = 0;
  r = await http.fetchJson('http://x', { maxRetries: 2, backoffMs: 1, rand: () => 0 });
  ok('reintenta tras timeout', r.ok && r.retryCount === 1);
  global.fetch = realFetch;

  // ---- Collector con mock fetcher (collector + normalizer end-to-end, sin red) ----
  console.log('Collector (mock fetcher)');
  const poly = require(R + '/market-data/providers/polymarketCollector');
  const champion = fx('polymarket-champion.json');
  const fetcher = async (url) => ({ ok: true, status: 200, json: champion, latencyMs: 5, retryCount: 0, rateLimited: 0, error: null });
  const cm = await poly.collectMarkets({ fetcher });
  ok('collector devuelve 2 mercados normalizados', cm.markets.length === 2 && cm.markets[0].normalized.snapshot.side === 'yes');
  const bookFetcher = async () => ({ ok: true, status: 200, json: fx('polymarket-book.json'), latencyMs: 4, retryCount: 0, rateLimited: 0 });
  const ob = await poly.fetchOrderBook(cm.markets[0], { fetcher: bookFetcher });
  ok('collector order book normalizado', ob.normalized.levels.length === 6);

  // ---- Scheduler anti-solape (monkeypatch pipeline) ----
  console.log('Scheduler anti-solape');
  const pipeline = require(R + '/market-data/pipeline');
  const orig = pipeline.runProviderCycle;
  let active = 0, maxConcurrent = 0;
  pipeline.runProviderCycle = async () => { active++; maxConcurrent = Math.max(maxConcurrent, active); await new Promise(r => setTimeout(r, 30)); active--; return { ok: true }; };
  const scheduler = require(R + '/market-data/scheduler');
  await Promise.all([scheduler.runOnce('polymarket'), scheduler.runOnce('polymarket'), scheduler.runOnce('polymarket')]);
  ok('no hay ciclos solapados (máx concurrencia 1)', maxConcurrent === 1, `max=${maxConcurrent}`);
  pipeline.runProviderCycle = orig;

  // ---- Flags ----
  console.log('Flags por proveedor');
  const reload = (env) => { Object.assign(process.env, env); delete require.cache[require.resolve(R + '/database/config')]; delete require.cache[require.resolve(R + '/market-data/config')]; return require(R + '/market-data/config'); };
  let c = reload({ MARKET_DATA_PLATFORM_V2: 'false', MARKET_DATA_WRITE_ENABLED: 'false', MARKET_DATA_POLYMARKET_ENABLED: 'true' });
  ok('V2 off → providerEnabled false', c.providerEnabled('polymarket') === false);
  c = reload({ MARKET_DATA_PLATFORM_V2: 'true', MARKET_DATA_WRITE_ENABLED: 'false', MARKET_DATA_POLYMARKET_ENABLED: 'true' });
  ok('write off → providerEnabled false', c.providerEnabled('polymarket') === false);
  c = reload({ MARKET_DATA_PLATFORM_V2: 'true', MARKET_DATA_WRITE_ENABLED: 'true', MARKET_DATA_POLYMARKET_ENABLED: 'true' });
  ok('todo on → providerEnabled true', c.providerEnabled('polymarket') === true);
  c = reload({ MARKET_DATA_PLATFORM_V2: 'true', MARKET_DATA_WRITE_ENABLED: 'true', MARKET_DATA_POLYMARKET_ENABLED: 'false' });
  ok('flag de proveedor off → false', c.providerEnabled('polymarket') === false);

  console.log(`\n${fail === 0 ? '✅' : '❌'} Market-data puros: ${pass} pasaron, ${fail} fallaron`);
  process.exit(fail === 0 ? 0 : 1);
})();
