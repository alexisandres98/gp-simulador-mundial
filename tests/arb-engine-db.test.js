// tests/arb-engine-db.test.js — integración del motor de arbitraje contra PostgreSQL (Sprint 3).
// Requiere DATABASE_URL + ARB_ENGINE_ENABLED=true + ARB_ENGINE_WRITE_ENABLED=true. Embedded PG en local.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const client = require(R + '/database/client');
const migrate = require(R + '/database/migrate');
const dbRepos = require(R + '/database/repositories');
const engine = require(R + '/arb-engine');
const { leg, deep } = require(R + '/arb-engine/fixtures/golden');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

function cand(snapId) {
  return { strategy: 'binary', canonicalMarketId: 'm1', mappingStatus: 'matched', mappingVersion: 'v1', rulesFingerprint: 'fp1',
    legs: [leg('polymarket', 'yes', deep('0.44', '5000'), { snapshotId: 'pm-' + snapId }), leg('polymarket', 'no', deep('0.50', '5000'), { snapshotId: 'ks-' + snapId })] };
}

(async () => {
  try {
    await migrate.up();
    await dbRepos.providers.upsertByCode({ code: 'polymarket', name: 'Polymarket' });
    await dbRepos.providers.upsertByCode({ code: 'kalshi', name: 'Kalshi' });

    console.log('Persistencia shadow (write on)');
    const r1 = await engine.runShadow({ candidates: [cand('s1')], now: Date.parse('2026-06-21T16:00:01Z') });
    ok('clasificación pure_arb', r1.counts.pure_arb === 1, JSON.stringify(r1.counts));
    ok('persistido (write on)', r1.persisted && r1.persisted.written === 1, JSON.stringify(r1.persisted));
    const ev = await client.query('SELECT count(*)::int n FROM arb_evaluations');
    ok('arb_evaluations escrita', ev.rows[0].n === 1);
    const legs = await client.query('SELECT count(*)::int n FROM arb_evaluation_legs');
    ok('arb_evaluation_legs escritas (2)', legs.rows[0].n === 2);
    const opp = await client.query('SELECT * FROM arb_opportunities');
    ok('arb_opportunity creada (lifecycle)', opp.rows.length === 1 && opp.rows[0].observation_count === 1);
    ok('net_roi y best_net_profit persistidos', opp.rows[0].best_net_roi != null && opp.rows[0].best_net_profit != null);
    const run = await client.query("SELECT * FROM arb_engine_runs WHERE status='success'");
    ok('engine run success con conteos', run.rows.length === 1 && run.rows[0].pure_arb_count === 1);

    console.log('Idempotencia');
    const r2 = await engine.runShadow({ candidates: [cand('s1')], now: Date.parse('2026-06-21T16:00:02Z') }); // mismos snapshots
    ok('mismos snapshots → no duplica evaluación', r2.persisted.written === 0 && r2.persisted.duplicate === 1);
    const ev2 = await client.query('SELECT count(*)::int n FROM arb_evaluations');
    ok('sigue habiendo 1 evaluación', ev2.rows[0].n === 1);
    const r3 = await engine.runShadow({ candidates: [cand('s2')], now: Date.parse('2026-06-21T16:00:03Z') }); // snapshots nuevos
    ok('snapshots nuevos → nueva evaluación', r3.persisted.written === 1);
    const opp2 = await client.query('SELECT observation_count FROM arb_opportunities');
    ok('observation_count incrementa (2)', opp2.rows[0].observation_count === 2, JSON.stringify(opp2.rows[0]));

    console.log('Verify de integridad');
    const badPure = await client.query(`SELECT count(*)::int n FROM arb_evaluations WHERE classification='pure_arb' AND rejection_reasons @> '["mapping_not_matched"]'::jsonb`);
    ok('ningún pure_arb con mapping no matched', badPure.rows[0].n === 0);
    const noVer = await client.query('SELECT count(*)::int n FROM arb_evaluations WHERE engine_version IS NULL');
    ok('ninguna evaluación sin versión', noVer.rows[0].n === 0);
    const orphan = await client.query('SELECT count(*)::int n FROM arb_evaluation_legs l LEFT JOIN arb_evaluations e ON e.id=l.evaluation_id WHERE e.id IS NULL');
    ok('ningún leg huérfano', orphan.rows[0].n === 0);

    console.log('Rechazado NO crea oportunidad activa');
    const rejCand = { ...cand('s3'), mappingStatus: 'matched', legs: [leg('polymarket', 'yes', deep('0.44', '5000'), { snapshotId: 'x1', freshness: 'stale' }), leg('polymarket', 'no', deep('0.50', '5000'), { snapshotId: 'x2' })] };
    await engine.runShadow({ candidates: [rejCand], now: Date.parse('2026-06-21T16:00:04Z') });
    const rejOpp = await client.query("SELECT status FROM arb_opportunities ORDER BY created_at DESC LIMIT 1");
    ok('oportunidad rechazada con status rejected', rejOpp.rows[0].status === 'rejected');

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} Arb Engine DB: ${pass} pasaron, ${fail} fallaron`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    process.exit(1);
  }
})();
