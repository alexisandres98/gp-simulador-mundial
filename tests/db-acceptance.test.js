// tests/db-acceptance.test.js — aceptación de la plataforma de datos (Sprint 0.1, Bloque C1).
// Requiere DATABASE_URL apuntando a un PostgreSQL VACÍO (de prueba). Ejecuta:
//   DATABASE_URL=... DB_SSL=false node tests/db-acceptance.test.js
// (En local se envuelve con un Postgres embebido temporal; ver scripts de verificación.)
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const client = require(R + '/database/client');
const migrate = require(R + '/database/migrate');
const health = require(R + '/database/health');
const repos = require(R + '/database/repositories');
const { computeChecksum } = require(R + '/database/checksum');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  try {
    // C1.10 — HEALTH NO MIGRA: en DB vacía, status()/health no deben crear schema_migrations.
    console.log('Health no modifica el esquema (DB vacía)');
    const before = await client.query("SELECT to_regclass('public.schema_migrations') t");
    ok('schema_migrations no existe al inicio', before.rows[0].t === null);
    await health.snapshot();              // no debe crear nada
    await migrate.status();               // read-only
    const after = await client.query("SELECT to_regclass('public.schema_migrations') t");
    ok('health/status NO crearon schema_migrations', after.rows[0].t === null);

    // C1.2 / C1.4 — migrar + idempotencia
    console.log('Migraciones');
    const up1 = await migrate.up();
    ok('migraciones aplicadas (8)', up1.applied === 8, `applied=${up1.applied}`);
    const tbls = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const names = tbls.rows.map(r => r.table_name);
    for (const t of ['providers', 'ingestion_runs', 'raw_market_snapshots', 'normalized_market_snapshots', 'canonical_events', 'canonical_markets', 'canonical_outcomes', 'provider_outcome_mappings', 'canonical_event_participants', 'model_analysis_runs', 'signals', 'schema_migrations'])
      ok(`tabla ${t}`, names.includes(t));
    const up2 = await migrate.up();
    ok('idempotente (2ª pasada = 0)', up2.applied === 0);

    // C1.6 — 4 observaciones idénticas en momentos distintos → 4 filas (no se pierde ninguna)
    console.log('Observaciones idénticas (no dedup destructivo)');
    const prov = await repos.providers.upsertByCode({ code: 'kalshi', name: 'Kalshi', supportsOrderbook: true });
    const payload = { orderbook: { bids: [[0.41, 100]], asks: [[0.43, 120]] }, market: 'X' };
    const cs = computeChecksum(payload);
    for (let i = 0; i < 4; i++) {
      await repos.rawSnapshots.insert({ providerId: prov.id, externalMarketId: 'mkt-1', payload, providerTimestamp: new Date(Date.UTC(2026, 5, 21, 17, 42, i * 10)).toISOString() });
    }
    const cnt = await client.query('SELECT count(*)::int n FROM raw_market_snapshots WHERE provider_id=$1 AND checksum=$2', [prov.id, cs]);
    ok('las 4 observaciones persisten (mismo checksum)', cnt.rows[0].n === 4, `n=${cnt.rows[0].n}`);
    ok('checksum determinístico estable', computeChecksum(payload) === cs);
    ok('checksum ignora received_at', computeChecksum({ ...payload, received_at: 'zzz' }) === cs);

    // C1.7 — CRUD de outcomes
    console.log('CRUD canonical outcomes + mapping');
    const ev = await repos.canonicalEvents.insert({ sport: 'football', homeParticipant: 'España', awayParticipant: 'Uruguay' });
    const mkt = await repos.canonicalMarkets.insert({ canonicalEventId: ev.id, marketType: '1x2', drawPossible: true });
    const outHome = await repos.canonicalOutcomes.insert({ canonicalMarketId: mkt.id, outcomeCode: 'home', outcomeName: 'España gana', displayOrder: 0 });
    await repos.canonicalOutcomes.insert({ canonicalMarketId: mkt.id, outcomeCode: 'draw', displayOrder: 1 });
    const outs = await repos.canonicalOutcomes.byMarket(mkt.id);
    ok('outcomes creados y listados', outs.length === 2);
    let dupErr = null; try { await repos.canonicalOutcomes.insert({ canonicalMarketId: mkt.id, outcomeCode: 'home' }); } catch (e) { dupErr = e; }
    ok('outcome duplicado en el mismo mercado rechazado', !!dupErr);
    const map = await repos.mappings.upsertOutcomeMapping({ providerId: prov.id, externalMarketId: 'kx-1', externalOutcomeId: 'yes', canonicalOutcomeId: outHome.id, mappingStatus: 'matched', mappingMethod: 'manual' });
    ok('outcome mapping matched creado', map.mapping_status === 'matched');
    let orphanErr = null; try { await repos.mappings.upsertOutcomeMapping({ providerId: prov.id, externalMarketId: 'kx-2', externalOutcomeId: 'yes2', mappingStatus: 'matched', mappingVersion: 'vx' }); } catch (e) { orphanErr = e; }
    ok('mapping matched sin outcome canónico rechazado (CHECK)', !!orphanErr);

    // C1.8 — CRUD de participantes (genéricos)
    console.log('CRUD event participants (genéricos)');
    await repos.eventParticipants.insert({ canonicalEventId: ev.id, participantName: 'España', role: 'home', participantType: 'team', displayOrder: 0 });
    await repos.eventParticipants.insert({ canonicalEventId: ev.id, participantName: 'Uruguay', role: 'away', participantType: 'team', displayOrder: 1 });
    // evento no deportivo: cripto
    const ev2 = await repos.canonicalEvents.insert({ event_type: 'outright', sport: 'crypto', eventType: 'outright' });
    await repos.eventParticipants.insert({ canonicalEventId: ev2.id, participantName: 'Bitcoin', role: 'asset', participantType: 'asset' });
    const parts = await repos.eventParticipants.byEvent(ev.id);
    ok('participantes de fútbol (home/away)', parts.length === 2 && parts.some(p => p.role === 'home') && parts.some(p => p.role === 'away'));
    const parts2 = await repos.eventParticipants.byEvent(ev2.id);
    ok('participante genérico (asset) admitido', parts2.length === 1 && parts2[0].role === 'asset');

    // model_analysis_runs CRUD
    console.log('model_analysis_runs');
    const run = await repos.modelAnalysisRuns.insert({ analysisType: 'h2h_sandbox', controlModelVersion: 'gp-core-1.4.0', challengerModelVersion: 'gp-intelligence-0.2.0', inputHash: 'sha256:abc', randomSeed: 123456, simulationCount: 10000, teamAReference: 'ESP', teamBReference: 'URU', controlOutput: { aWin: 0.6 }, challengerOutput: { aWin: 0.65 } });
    ok('run experimental insertado', !!run.id);

    // NUMERIC como string (sin float)
    const norm = await repos.normalizedSnapshots.insert({ providerId: prov.id, externalMarketId: 'mkt-1', side: 'yes', bestBid: '0.41', bestAsk: '0.43', midpoint: '0.42' });
    ok('NUMERIC se preserva como string', typeof norm.best_bid === 'string' && norm.best_bid === '0.41000000');

    // C1.5 — rollback + re-up
    console.log('Rollback + re-up');
    const rb = await migrate.rollback();
    ok('rollback de la última (008)', rb.rolledBack === '008');
    const hasRuns = await client.query("SELECT to_regclass('public.model_analysis_runs') t");
    ok('model_analysis_runs eliminada por rollback', hasRuns.rows[0].t === null);
    const reup = await migrate.up();
    ok('re-up aplica 1', reup.applied === 1);

    // health con DB arriba
    const h = await health.snapshot();
    ok('health connected + up_to_date', h.database.connected && h.database.migrationStatus === 'up_to_date', JSON.stringify(h.database));

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} DB acceptance: ${pass} pasaron, ${fail} fallaron`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    process.exit(1);
  }
})();
