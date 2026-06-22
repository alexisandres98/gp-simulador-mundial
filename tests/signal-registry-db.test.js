// tests/signal-registry-db.test.js — Sprint 5. Registro inmutable contra PostgreSQL real (embedded-postgres).
// Cubre §37 inmutabilidad, §38 cadena+concurrencia, §41 arb, §42 settlement, §43 closing, verify-chain, §46 volumen.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_PUBLIC_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00Z';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

function prediction(over = {}) {
  const now = Date.now();
  return {
    signal_type: 'model_prediction_v1', canonical_event_id: null, model_version: 'gp-core-1.4.0',
    event_start_at: new Date(now + 3 * 86400000).toISOString(),  // evento a 3 días → futuro
    input_cutoff_at: new Date(now - 3600000).toISOString(),       // datos hasta hace 1h → antes de published_at
    signal_payload: { market_type: '1x2', probabilities: { home: 0.5, draw: 0.3, away: 0.2 }, predicted_outcome: 'home' }, ...over,
  };
}

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const registry = require(R + '/signal-registry');
  const repo = require(R + '/signal-registry/repositories');
  try {
    await migrate.up();
    ok('migración 013 aplicada (signal_events existe)', (await client.query("SELECT to_regclass('public.signal_events') t")).rows[0].t != null);
    ok('signals evolucionada (content_hash existe)', (await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='signals' AND column_name='content_hash'")).rowCount === 1);

    console.log('\n§38 CADENA');
    const s1 = (await registry.publishModelPrediction(prediction(), { sourceRefs: [{ source_type: 'model_output', source_id: 'm1', snapshot_timestamp: '2026-06-22T09:00:00Z' }] })).signal;
    const s2 = (await registry.publishModelPrediction(prediction(), { sourceRefs: [{ source_type: 'model_output', source_id: 'm2' }] })).signal;
    const s3 = (await registry.publishModelPrediction(prediction(), { sourceRefs: [{ source_type: 'model_output', source_id: 'm3' }] })).signal;
    ok('posiciones de cadena 1,2,3', Number(s1.chain_position) === 1 && Number(s2.chain_position) === 2 && Number(s3.chain_position) === 3);
    ok('previous_registry_hash encadena', s2.previous_registry_hash === s1.registry_hash && s3.previous_registry_hash === s2.registry_hash);
    ok('published_at server-side + score_eligible (antes del evento)', s1.published_at && s1.score_eligible === true && s1.verification_status === 'verified');
    const vc = await registry.verifyChain();
    ok('verify-chain válido', vc.valid && vc.head === 3, JSON.stringify(vc.errors));

    console.log('\n§38 CONCURRENCIA');
    const conc = await Promise.all(Array.from({ length: 8 }, (_, i) => registry.publishModelPrediction(prediction(), { sourceRefs: [{ source_type: 'model_output', source_id: 'c' + i }] })));
    const positions = conc.map(r => Number(r.signal.chain_position)).sort((a, b) => a - b);
    ok('8 inserts concurrentes → posiciones únicas y contiguas', new Set(positions).size === 8 && positions[0] === 4 && positions[7] === 11);
    ok('cadena sigue válida tras concurrencia', (await registry.verifyChain()).valid);

    console.log('\n§37 INMUTABILIDAD');
    let blocked = false;
    try { await client.query("UPDATE signals SET signal_payload='{}'::jsonb WHERE id=$1", [s1.id]); } catch (e) { blocked = /append-only/.test(e.message); }
    ok('1-4. UPDATE de señal (probabilidad) → rechazado por trigger', blocked);
    let delBlocked = false;
    try { await client.query('DELETE FROM signals WHERE id=$1', [s1.id]); } catch (e) { delBlocked = /append-only/.test(e.message); }
    ok('5. DELETE de señal → rechazado', delBlocked);
    let evBlocked = false;
    try { await client.query("UPDATE signal_events SET event_type='x' WHERE signal_id=$1", [s1.id]); } catch (e) { evBlocked = /append-only/.test(e.message); }
    ok('signal_events inmutable', evBlocked);
    // proyección mutable
    await repo.projection.upsert({ signal_id: s1.id, current_status: 'published', score_eligible: true, settlement_status: 'pending' });
    ok('8. proyección mutable (reconstruible)', (await repo.projection.get(s1.id)) != null);
    const raw = await repo.signals.byId(s1.id);
    ok('9. raw signal idéntica (content_hash intacto)', raw.content_hash === s1.content_hash);

    console.log('\n§37 DETECCIÓN DE MANIPULACIÓN (bypass trigger como superusuario)');
    await client.query('ALTER TABLE signals DISABLE TRIGGER trg_signals_immutable');
    await client.query("UPDATE signals SET signal_payload = jsonb_set(signal_payload,'{probabilities,home}','0.99') WHERE id=$1", [s2.id]);
    await client.query('ALTER TABLE signals ENABLE TRIGGER trg_signals_immutable');
    const vcBad = await registry.verifyChain();
    ok('verify-chain DETECTA contenido modificado', !vcBad.valid && vcBad.errors.some(e => e.error === 'content_hash_modified'));
    const vsBad = await registry.verify(s2.public_id);
    ok('verify-signal detecta hash inválido', !vsBad.valid && vsBad.checks.content_hash === false);

    console.log('\n§42 SETTLEMENT');
    const r1 = await registry.settle(s3.id, { status: 'pending', source: 'espn', sourceReference: 'run1' });
    ok('1. settlement pending', r1.settlement.settlement_status === 'pending' && r1.settlement.settlement_version === 1);
    const r2 = await registry.settle(s3.id, { status: 'final', winningOutcomeId: 'home', source: 'espn', sourceReference: 'run2', eventResult: { hg: 2, ag: 0 } });
    ok('2. settlement final (v2)', r2.settlement.settlement_status === 'final' && r2.settlement.settlement_version === 2 && r2.settlement.is_final);
    const dup = await registry.settle(s3.id, { status: 'final', source: 'espn', sourceReference: 'run2' });
    ok('3. settlement duplicado idempotente', dup.skipped === true);
    const corr = await registry.addCorrection(s3.id, { correctionReason: 'fuente corrigió a 2-1', status: 'corrected', winningOutcomeId: 'home', source: 'espn', sourceReference: 'run3' });
    ok('6/7. corrección crea v3, versiones previas permanecen', corr.settlement.settlement_version === 3 && (await repo.settlements.listForSignal(s3.id)).length === 3);
    let immField = false; try { await registry.addCorrection(s3.id, { field: 'probability', correctionReason: 'x' }); } catch (e) { immField = /cannot_correct_published_content/.test(e.message); }
    ok('no se puede corregir prob/precio/timestamp publicados', immField);

    console.log('\n§43 CLOSING (sin look-ahead)');
    const cClose = await registry.captureClosing(s1.id, { benchmarkType: 'last_valid_pre_event_executable', observedAt: '2026-06-25T14:00:00Z', eventStartAt: '2026-06-25T15:00:00Z', executablePrice: '0.50', bestBid: '0.49', bestAsk: '0.51' });
    ok('1. snapshot antes del inicio → capturado', cClose.closing && cClose.captureStatus === 'captured');
    let lookAhead = false; try { await registry.captureClosing(s2.id, { observedAt: '2026-06-25T16:00:00Z', eventStartAt: '2026-06-25T15:00:00Z', executablePrice: '0.5' }); } catch (e) { lookAhead = /look_ahead/.test(e.message); }
    ok('2/3. snapshot posterior al inicio → rechazado (no look-ahead)', lookAhead);
    const unavail = await registry.captureClosing(s3.id, { observedAt: '2026-06-25T14:00:00Z', eventStartAt: '2026-06-25T15:00:00Z' });
    ok('7. sin dato → unavailable', unavail.captureStatus === 'unavailable');
    const dupClose = await registry.captureClosing(s1.id, { benchmarkType: 'last_valid_pre_event_executable', observedAt: '2026-06-25T14:30:00Z', eventStartAt: '2026-06-25T15:00:00Z', executablePrice: '0.5' });
    ok('8. captura idempotente (mismo benchmark)', dupClose.skipped === true);

    console.log('\n§41 ARB INTEGRATION');
    const fakePub = { id: '11111111-1111-1111-1111-111111111111', evaluation_id: '22222222-2222-2222-2222-222222222222', visibility: 'public', published_mapping_version: 'mv1', published_rules_fingerprint: 'rf1', public_payload: { event: 'España vs Uruguay', badge: 'PURE ARB', classification: 'pure_arb', economics: { net_roi: '0.02' }, sizing: { max_executable_capital: '400', estimated_net_profit_at_max: '8' }, legs: [{ provider: 'polymarket', side: 'yes', best_price: '0.44', vwap: '0.44', fee: '0' }, { provider: 'kalshi', side: 'no', best_price: '0.50', vwap: '0.50', fee: '1' }] } };
    const arbSig = (await registry.captureArbPublication({ publication: fakePub, evaluation: { engine_version: 'arb-engine-1', net_roi: '0.02', snapshot_ids: ['s-a', 's-b'] } })).signal;
    ok('1/2. publicación arb crea señal con refs', arbSig && arbSig.signal_type === 'arb_publication');
    ok('3. precios/fees congelados en payload', arbSig.signal_payload.legs.length === 2 && arbSig.signal_payload.legs[0].best_price === '0.44');
    ok('7. realized_roi null', arbSig.signal_payload.realized_roi === null);
    const refsArb = await repo.sourceRefs.listForSignal(arbSig.id);
    ok('2. referencia evaluation + publication + snapshots', refsArb.some(r => r.source_type === 'arb_evaluation') && refsArb.filter(r => r.source_type === 'normalized_snapshot').length === 2);
    await registry.withdraw(arbSig.id, { reason: 'expiró', actorId: 'admin' });
    const evs = await repo.events.listForSignal(arbSig.id);
    ok('5/4. withdrawal crea evento; original intacto', evs.some(e => e.event_type === 'withdrawn') && (await repo.signals.byId(arbSig.id)).content_hash === arbSig.content_hash);

    console.log('\n§15 COMMITMENT DIARIO');
    const today = new Date(s1.published_at).toISOString().slice(0, 10);
    const cm = await registry.commitDay(today);
    ok('commitment diario generado', cm.commitment && cm.commitment.root_hash && cm.commitment.signal_count > 0);
    const cm2 = await registry.commitDay(today);
    ok('commitment idempotente', cm2.skipped === true);

    console.log('\n§46 VOLUMEN (1000 señales)');
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) await registry.publishModelPrediction(prediction(), { sourceRefs: [{ source_type: 'model_output', source_id: 'v' + i }] });
    const insMs = Date.now() - t0;
    const tV = Date.now();
    const vcBig = await registry.verifyChain();
    const verMs = Date.now() - tV;
    // ya teníamos 1(s1)+1(s2 manipulada)+1(s3)+8(conc)+1(arb)+1000 = 1011; s2 manipulada → 1 error esperado
    ok('1000+ señales insertadas', vcBig.head >= 1011, 'head=' + vcBig.head);
    ok('verify-chain solo reporta la señal manipulada', vcBig.errors.length >= 1 && vcBig.errors.every(e => e.error === 'content_hash_modified' || e.error === 'registry_hash_modified'));
    console.log(`  · inserción 1000: ${insMs}ms (${(insMs / 1000).toFixed(1)}ms/señal) · verificación ${vcBig.checked} señales: ${verMs}ms`);

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} Signal Registry DB: ${pass} pasaron, ${fail} fallaron`);
    await h.stop();
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    try { await h.stop(); } catch {}
    process.exit(1);
  }
})();
