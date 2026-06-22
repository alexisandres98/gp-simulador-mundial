// tests/metrics-engine-db.test.js — Sprint 6. Motor de métricas contra PostgreSQL real (embedded-postgres).
// Facts/agregados §24, idempotencia, correcciones §45, snapshot inmutable §26, exclusiones §43,
// volumen 10k §50 + verificación de cadena Sprint 5 (10k) §50.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00Z';
process.env.METRICS_ENGINE_ENABLED = 'true';
process.env.METRICS_ENGINE_WRITE_ENABLED = 'true';
process.env.METRICS_PUBLIC_ENABLED = 'true';
process.env.METRICS_BOOTSTRAP_ITERATIONS = '300';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const registry = require(R + '/signal-registry');
  const hashing = require(R + '/signal-registry/hashing');
  const sigCfg = require(R + '/signal-registry/config');
  const me = require(R + '/metrics-engine');
  const repo = require(R + '/metrics-engine/repositories');

  const NOW = Date.now();
  function pred(i, probs, evMinAfterNow = 3 * 1440) {
    return { signal_type: 'model_prediction_v1', model_version: 'gp-core-1.4.0', canonical_event_id: null,
      event_start_at: new Date(NOW + evMinAfterNow * 60000).toISOString(), input_cutoff_at: new Date(NOW - 3600000).toISOString(),
      signal_payload: { market_type: '1x2', probabilities: probs } };
  }
  const OUT = ['home', 'draw', 'away'];

  try {
    await migrate.up();
    ok('migración 014 (signal_metric_facts existe)', (await client.query("SELECT to_regclass('public.signal_metric_facts') t")).rows[0].t != null);
    await me.seedDefinitions();
    ok('diccionario de métricas sembrado', (await client.query('SELECT count(*)::int n FROM metric_definitions')).rows[0].n >= 8);

    console.log('\nFACTS + AGREGADOS');
    // 40 predicciones verificadas, calibradas (p=0.5 home; gana home 50%)
    const created = [];
    for (let i = 0; i < 40; i++) {
      const r = await registry.publishModelPrediction(pred(i, { home: 0.5, draw: 0.3, away: 0.2 }), { sourceRefs: [{ source_type: 'model_output', source_id: 'm' + i }] });
      created.push(r.signal);
      // gana home en la mitad (calibración: p=0.5 → 50% ocurre)
      await registry.settle(r.signal.id, { status: 'final', winningOutcomeId: i % 2 === 0 ? 'home' : 'away', source: 'espn', sourceReference: 'r' + i });
    }
    ok('40 señales verificadas + settled', created.length === 40 && created[0].verification_status === 'verified' && created[0].score_eligible === true);

    const run1 = await me.fullRebuild({ verifiedEpoch: '2026-06-01T00:00:00Z' });
    ok('rebuild crea facts (40) + agregados', run1.counts.created === 40 && run1.counts.aggregates >= 3, JSON.stringify(run1.counts));
    const brierAgg = (await repo.aggregates.list({ metricCode: 'brier_multiclass' }))[0];
    ok('Brier agregado con valor + CI + n=40', brierAgg && brierAgg.value != null && brierAgg.confidence_interval && brierAgg.sample_size === 40);
    ok('sample_status early (40)', brierAgg.sample_status === 'early');
    const accAgg = (await repo.aggregates.list({ metricCode: 'accuracy_top1' }))[0];
    ok('accuracy ≈ 0.5 (home gana mitad)', Math.abs(Number(accAgg.value) - 0.5) < 0.01);
    const eceAgg = (await repo.aggregates.list({ metricCode: 'ece_equal_width' }))[0];
    const bins = await repo.calibrationBins.forAggregate(eceAgg.id);
    ok('calibración: bins persistidos', bins.length >= 1);

    console.log('\nIDEMPOTENCIA');
    const before = (await client.query('SELECT count(*)::int n FROM metric_aggregates')).rows[0].n;
    await me.fullRebuild({ verifiedEpoch: '2026-06-01T00:00:00Z' });
    const after = (await client.query('SELECT count(*)::int n FROM metric_aggregates')).rows[0].n;
    ok('re-run no duplica agregados (idempotency_key)', before === after);

    console.log('\nCORRECCIONES (§45)');
    const snapBefore = await me.publishSnapshot();
    const brierBefore = Number(brierAgg.value);
    // corrige el resultado de una señal (settlement v2) → debe recalcular fact y agregado
    await registry.addCorrection(created[0].id, { correctionReason: 'fuente corrigió', status: 'final', winningOutcomeId: 'draw', source: 'espn', sourceReference: 'corr0' });
    await me.fullRebuild({ verifiedEpoch: '2026-06-01T00:00:00Z' });
    const brierAfter = Number((await repo.aggregates.list({ metricCode: 'brier_multiclass' }))[0].value);
    ok('1/2. corrección recalcula fact + agregado', brierAfter !== brierBefore);
    ok('3. snapshot público anterior permanece intacto', (await repo.snapshots.byPublicId(snapBefore.public_id)) != null);
    ok('5. señal original intacta (content_hash)', (await registry.repo.signals.byId(created[0].id)).content_hash === created[0].content_hash);

    console.log('\nSNAPSHOT INMUTABLE (§26)');
    let immBlocked = false;
    try { await client.query('UPDATE public_metric_snapshots SET content_hash=$1 WHERE public_id=$2', ['x', snapBefore.public_id]); } catch (e) { immBlocked = /append-only/.test(e.message); }
    ok('snapshot público no se puede modificar', immBlocked);

    console.log('\nEXCLUSIONES (§43)');
    const exp = await registry.captureExperiment({ modelAnalysisRunId: '33333333-3333-3333-3333-333333333333', control: { p: 0.5 }, challenger: { p: 0.6 } });
    await registry.settle(exp.signal.id, { status: 'final', winningOutcomeId: 'home', source: 'espn', sourceReference: 'rexp' });
    await me.fullRebuild({ verifiedEpoch: '2026-06-01T00:00:00Z' });
    const expFact = (await client.query("SELECT * FROM signal_metric_facts WHERE signal_id=$1", [exp.signal.id])).rows[0];
    ok('experimental → fact excluido (no entra a oficial)', expFact && (expFact.experimental === true || expFact.eligibility_status === 'excluded'));
    const verifyR = await me.verify();
    ok('verify: 0 experimental/legacy en oficial, 0 ROI arb realizado', verifyR.valid, JSON.stringify(verifyR.issues));

    console.log('\nVOLUMEN 10k (§50) — bulk insert con cadena válida + facts');
    // continuar la cadena desde la cabeza actual
    let head = (await client.query('SELECT chain_position, registry_hash FROM signals ORDER BY chain_position DESC LIMIT 1')).rows[0];
    let pos = Number(head.chain_position), prev = head.registry_hash;
    const N = 10000, t0 = Date.now();
    const evStart = new Date(NOW + 3600000).toISOString(), pubAt = new Date(NOW - 86400000).toISOString(), inCut = new Date(NOW - 90000000).toISOString();
    for (let batch = 0; batch < N; batch += 500) {
      const params = [];
      for (let k = 0; k < 500 && (batch + k) < N; k++) {
        pos++;
        const sigObj = { signal_type: 'model_prediction_v1', signal_schema_version: 'model_prediction_v1-1', model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0', published_at: pubAt, event_start_at: evStart, input_cutoff_at: inCut, signal_payload: { market_type: '1x2', probabilities: { home: 0.5, draw: 0.3, away: 0.2 } }, source_references: [] };
        const oldPrev = prev;
        const ch = hashing.contentHash(sigObj);
        const rh = hashing.registryHash(oldPrev, ch, pos);
        prev = rh;
        // orden EXACTO de columnas del INSERT (21):
        params.push('model_prediction_v1', 'model_prediction_v1-1', 'sig_v' + pos, 'public', 'published', 'verified', true, false, false, pubAt, pubAt, evStart, inCut, 'gp-core-1.4.0', 'gp-core-1.4.0', JSON.stringify(sigObj.signal_payload), ch, oldPrev, rh, pos, 'published');
      }
      const cols = 21; const rowsN = params.length / cols;
      const ph = [];
      for (let r2 = 0; r2 < rowsN; r2++) { const base = r2 * cols; ph.push('(' + Array.from({ length: cols }, (_, c) => '$' + (base + c + 1)).join(',') + ')'); }
      await client.query(
        `INSERT INTO signals (signal_type, signal_schema_version, public_id, visibility, registry_status, verification_status, score_eligible, experimental, legacy, published_at, locked_at, event_start_at, input_cutoff_at, model_version, methodology_version, signal_payload, content_hash, previous_registry_hash, registry_hash, chain_position, status) VALUES ${ph.join(',')}`,
        params
      );
    }
    const insMs = Date.now() - t0;
    // settle masivo (un settlement final por señal de volumen) — directo
    const tS = Date.now();
    await client.query(`INSERT INTO signal_settlements (signal_id, settlement_version, settlement_status, winning_outcome_id, result_type, is_final, settled_at)
      SELECT id, 1, 'final', (CASE WHEN (chain_position % 2)=0 THEN 'home' ELSE 'away' END), 'model_prediction', true, now() FROM signals WHERE public_id LIKE 'sig_v%'`);
    const setMs = Date.now() - tS;
    const tR = Date.now();
    const runBig = await me.fullRebuild({ verifiedEpoch: '2026-06-01T00:00:00Z' });
    const rebMs = Date.now() - tR;
    const factCount = (await client.query('SELECT count(*)::int n FROM signal_metric_facts')).rows[0].n;
    ok('10k+ facts construidos', factCount >= 10000, 'facts=' + factCount);
    const bigBrier = (await repo.aggregates.list({ metricCode: 'brier_multiclass' }))[0];
    ok('agregado sobre 10k+ con sample_status established', bigBrier.sample_status === 'established' && bigBrier.sample_size >= 10000);
    // verificación de cadena Sprint 5 a 10k
    const tV = Date.now();
    const vc = await registry.verifyChain();
    const verMs = Date.now() - tV;
    ok('cadena Sprint 5 válida a ' + vc.checked + ' señales', vc.valid && vc.checked >= 10000, JSON.stringify(vc.errors.slice(0, 2)));
    console.log(`  · insert 10k: ${insMs}ms · settle: ${setMs}ms · rebuild métricas (${factCount} facts): ${rebMs}ms · verify cadena (${vc.checked}): ${verMs}ms`);

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} Metrics Engine DB: ${pass} pasaron, ${fail} fallaron`);
    await h.stop();
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    try { await h.stop(); } catch {}
    process.exit(1);
  }
})();
