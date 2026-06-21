// tests/market-data-db.test.js — integración de la ingesta contra PostgreSQL (Sprint 1, C-DB).
// Requiere DATABASE_URL (PG vacío de prueba). Se envuelve con un Postgres embebido temporal en local.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const fs = require('fs');
const client = require(R + '/database/client');
const migrate = require(R + '/database/migrate');
const repos = require(R + '/database/repositories');
const pipeline = require(R + '/market-data/pipeline');
const q = require(R + '/market-data/repositories/queryRepository');
const orderbookRepo = require(R + '/market-data/repositories/orderbookRepository');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const fx = f => JSON.parse(fs.readFileSync(path.join(R, 'market-data/fixtures', f), 'utf8'));

// mock fetcher que enruta por URL y devuelve el shape de http.fetchJson
function mockFetcher(overrides = {}) {
  return async (url) => {
    let json = null;
    if (/world-cup-winner/.test(url)) json = fx('polymarket-champion.json');
    else if (/clob\.polymarket\.com\/book/.test(url)) json = overrides.book === 'fail' ? null : fx('polymarket-book.json');
    else if (/\/markets\?event_ticker/.test(url)) json = overrides.markets === 'fail' ? null : fx('kalshi-markets.json');
    else if (/\/orderbook$/.test(url)) json = fx('kalshi-orderbook.json');
    const okk = json != null && overrides.fail !== url;
    return { ok: okk, status: okk ? 200 : 500, json, latencyMs: 5, attempts: 1, retryCount: 0, rateLimited: 0, error: okk ? null : 'HTTP 500' };
  };
}

(async () => {
  try {
    await migrate.up();
    console.log('Pipeline shadow (force) — Polymarket');
    let res = await pipeline.runProviderCycle('polymarket', { force: true, fetcher: mockFetcher() });
    ok('ciclo success', res.status === 'success', JSON.stringify(res));
    ok('2 mercados recibidos', res.received === 2);
    const counts = await q.getStorageCounts();
    ok('raw snapshots persistidos (mercado + book)', counts.rawSnapshots >= 4, `raw=${counts.rawSnapshots}`);
    ok('normalized snapshots = 2', counts.normalizedSnapshots === 2, `n=${counts.normalizedSnapshots}`);
    ok('orderbook levels = 12 (6×2 mercados)', counts.orderbookLevels === 12, `ob=${counts.orderbookLevels}`);
    ok('catálogo poblado', counts.catalogMarkets === 2);

    const prov = await repos.providers.findByCode('polymarket');
    const latest = await q.getLatestSnapshot(prov.id, '0xCONDITION_BRA', '100001');
    ok('snapshot recuperable con bid/ask string', latest && latest.best_bid === '0.21000000' && latest.best_ask === '0.23000000');
    const book = await orderbookRepo.getLatestOrderBook(latest.id);
    ok('order book recuperable (bids/asks)', book.bids.length === 3 && book.asks.length === 3);
    ok('best bid = nivel 0', book.bids[0].level === 0 && book.bids[0].price === '0.21000000');

    // 4 observaciones idénticas en momentos distintos → 4 filas con el MISMO checksum (no dedup).
    // Se cuenta por el checksum del payload del MERCADO (el book se guarda aparte con su propio checksum).
    console.log('Observaciones idénticas (no dedup)');
    const { computeChecksum } = require(R + '/database/checksum');
    const marketChecksum = computeChecksum(fx('polymarket-champion.json')[0].markets[0]);
    for (let i = 0; i < 3; i++) await pipeline.runProviderCycle('polymarket', { force: true, fetcher: mockFetcher() });
    const rawBra = await client.query('SELECT count(*)::int n FROM raw_market_snapshots WHERE checksum=$1', [marketChecksum]);
    ok('4 observaciones idénticas del mercado persisten (mismo checksum)', rawBra.rows[0].n === 4, `n=${rawBra.rows[0].n}`);
    ok('checksum determinístico estable', /^sha256:/.test(marketChecksum));

    // Ingestion runs: success / partial / failed
    console.log('Ingestion runs');
    const runsR = await q.getRecentIngestionRuns(prov.id, 10);
    ok('runs registradas con status success', runsR.some(r => r.status === 'success'));
    const partial = await pipeline.runProviderCycle('polymarket', { force: true, fetcher: mockFetcher({ book: 'fail' }) });
    ok('book fallido → run partial (snapshots ok, errores en book)', partial.status === 'partial', partial.status);
    const failed = await pipeline.runProviderCycle('kalshi', { force: true, fetcher: mockFetcher({ markets: 'fail' }) });
    ok('markets fallidos → run failed', failed.status === 'failed', failed.status);

    // Run abandonada → reaper
    console.log('Reaper de runs abandonadas');
    await client.query("INSERT INTO ingestion_runs (provider_id, job_type, status, started_at) VALUES ($1,'market-snapshot','running', now() - interval '30 minutes')", [prov.id]);
    const reaped = await pipeline.reapAbandonedRuns();
    ok('run abandonada marcada failed', reaped >= 1);
    const stillRunning = await client.query("SELECT count(*)::int n FROM ingestion_runs WHERE status='running' AND started_at < now() - interval '15 minutes'");
    ok('no quedan running viejas', stillRunning.rows[0].n === 0);

    // Locks: dos ciclos concurrentes → uno saltado
    console.log('Advisory locks (concurrencia)');
    const [a, b] = await Promise.all([
      pipeline.runProviderCycle('polymarket', { force: true, fetcher: slowFetcher(mockFetcher()) }),
      pipeline.runProviderCycle('polymarket', { force: true, fetcher: slowFetcher(mockFetcher()) }),
    ]);
    const skipped = [a, b].filter(x => x.skipped === 'skipped_due_to_lock').length;
    ok('exactamente uno saltado por lock', skipped === 1, JSON.stringify([a.skipped || a.status, b.skipped || b.status]));

    // Volumen (fixtures): inserción masiva + query de timeline usa índice
    console.log('Prueba de volumen (fixtures)');
    const t0 = Date.now();
    const VN = 400;
    for (let i = 0; i < VN; i++) {
      const norm = await repos.normalizedSnapshots.insert({ providerId: prov.id, externalMarketId: 'VOL', externalOutcomeId: 'y', side: 'yes', bestBid: '0.40', bestAsk: '0.42', midpoint: '0.41', lastTrade: '0.41', normalizerVersion: 'polymarket-normalizer-1' });
      const levels = [];
      for (let lvl = 0; lvl < 20; lvl++) { levels.push({ normalizedSnapshotId: norm.id, providerId: prov.id, externalMarketId: 'VOL', externalOutcomeId: 'y', side: 'bid', price: (0.4 - lvl * 0.001).toFixed(8), size: '100', levelIndex: lvl }); levels.push({ normalizedSnapshotId: norm.id, providerId: prov.id, externalMarketId: 'VOL', externalOutcomeId: 'y', side: 'ask', price: (0.42 + lvl * 0.001).toFixed(8), size: '100', levelIndex: lvl }); }
      await orderbookRepo.insertLevels(levels);
    }
    const elapsed = Date.now() - t0;
    const vc = await client.query("SELECT (SELECT count(*)::int FROM normalized_market_snapshots WHERE external_market_id='VOL') s, (SELECT count(*)::int FROM normalized_orderbook_levels WHERE external_market_id='VOL') l");
    ok(`volumen insertado (${VN} snaps + ${VN * 40} levels en ${elapsed}ms)`, vc.rows[0].s === VN && vc.rows[0].l === VN * 40);
    const plan = await client.query("EXPLAIN SELECT * FROM normalized_market_snapshots WHERE provider_id=$1 AND external_market_id='VOL' ORDER BY received_at DESC LIMIT 50", [prov.id]);
    const planText = plan.rows.map(r => r['QUERY PLAN']).join(' ');
    ok('query de timeline usa índice (no Seq Scan masivo)', /Index/.test(planText), planText.slice(0, 80));

    // verify de integridad (sin problemas)
    console.log('Integridad (verify)');
    const bidGtAsk = await client.query("SELECT count(*)::int n FROM normalized_market_snapshots WHERE best_bid > best_ask");
    ok('ningún bid > ask', bidGtAsk.rows[0].n === 0);
    const neg = await client.query("SELECT count(*)::int n FROM normalized_orderbook_levels WHERE price<0 OR size<0");
    ok('ningún precio/size negativo', neg.rows[0].n === 0);
    const orphan = await client.query("SELECT count(*)::int n FROM normalized_orderbook_levels l LEFT JOIN normalized_market_snapshots s ON s.id=l.normalized_snapshot_id WHERE s.id IS NULL");
    ok('ningún order book huérfano', orphan.rows[0].n === 0);

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} Market-data DB: ${pass} pasaron, ${fail} fallaron`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    process.exit(1);
  }
})();

// Envuelve un fetcher para que tarde, forzando solape en el test de locks.
function slowFetcher(f) { return async (url, opts) => { await new Promise(r => setTimeout(r, 60)); return f(url, opts); }; }
