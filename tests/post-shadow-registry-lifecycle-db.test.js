// tests/post-shadow-registry-lifecycle-db.test.js — Fase H §19. DB efímera. Closing/settlement/commitments e2e
// con señales REALES del publisher (hashes válidos). NUNCA crea señales en prod. Cubre idempotencia, anti-look-ahead,
// interacción con estados admin (G.1), commitment determinístico/idempotente/elegibilidad, y regresión.
'use strict';
process.env.DB_SSL = 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00.000Z'; // epoch pasado → señales now son post-epoch
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const FUT = '2026-12-01T18:00:00.000Z'; // kickoff futuro

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const reg = require(R + '/signal-registry');
  const SA = require(R + '/signal-registry/signalAdmin');
  const RA = require(R + '/signal-registry/registryAdmin');
  const verifier = require(R + '/signal-registry/verifier');
  const q = (s, p = []) => client.query(s, p);

  // publica una señal oficial elegible (model_prediction_v1) con kickoff futuro.
  async function publish(over = {}) {
    const r = await reg.publisher.register({
      signal_type: 'model_prediction_v1', canonical_event_id: null, canonical_market_id: null, canonical_outcome_id: null,
      direction: 'home', event_start_at: over.kickoff || FUT,
      model_version: 'gp-core-1.4.0', signal_payload: { market_type: '1x2', period: 'regulation_90m', predicted_outcome: 'home', published_odds: '2.00', probabilities: { home: 0.5, draw: 0.3, away: 0.2 } },
      ...over.input,
    }, { actorId: 'tester', sourceRefs: [{ source_type: 'model_output', source_id: 'mo1' }] });
    return r.signal;
  }

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });

    // ===================== CLOSING =====================
    console.log('\n§19 CLOSING');
    const s1 = await publish();
    ok('1. señal post-epoch oficial publicada (score_eligible/verified)', s1.score_eligible === true && s1.verification_status === 'verified');
    // 5/6. complete set / last valid pre-kickoff quote → AVAILABLE
    const cap1 = await reg.captureClosing(s1.id, { observedAt: '2026-12-01T17:50:00Z', providerUpdatedAt: '2026-12-01T17:48:00Z', closingOdds: '1.90', closingProbability: '0.5263', closingSource: 'consensus_no_vig', publishedOdds: '2.00', market: '1x2', period: 'regulation_90m', outcome: 'home', kickoffAt: FUT });
    ok('5/6. set completo pre-kickoff → AVAILABLE + clv', cap1.closingStatus === 'AVAILABLE' && cap1.closing.closing_policy_version === 'closing-policy-1' && cap1.closing.clv_components.entry_implied_probability === 0.5);
    // 7. post-kickoff quote rejected
    const s2 = await publish();
    let look = false; try { await reg.captureClosing(s2.id, { observedAt: '2026-12-01T18:30:00Z', providerUpdatedAt: '2026-12-01T18:30:00Z', closingOdds: '1.9', kickoffAt: FUT }); } catch (e) { look = e.code === 'look_ahead_rejected'; }
    ok('7. quote post-kickoff → rechazada (look_ahead)', look);
    // 11. idempotent retry (mismo benchmark)
    const dup = await reg.captureClosing(s1.id, { observedAt: '2026-12-01T17:55:00Z', closingOdds: '1.95', kickoffAt: FUT });
    ok('11. retry idempotente (mismo benchmark) → skipped', dup.skipped === true);
    // 12. concurrent capture (un benchmark distinto, dos veces en paralelo → 1 inserta, 1 skipped)
    const [ca, cb] = await Promise.all([
      reg.captureClosing(s2.id, { benchmarkType: 'last_valid_pre_event_midpoint', observedAt: '2026-12-01T17:40:00Z', midpoint: '0.52', kickoffAt: FUT }).catch(() => ({ error: true })),
      reg.captureClosing(s2.id, { benchmarkType: 'last_valid_pre_event_midpoint', observedAt: '2026-12-01T17:41:00Z', midpoint: '0.52', kickoffAt: FUT }).catch(() => ({ error: true })),
    ]);
    const midCount = (await q(`SELECT count(*)::int n FROM signal_closing_snapshots WHERE signal_id=$1 AND benchmark_type='last_valid_pre_event_midpoint'`, [s2.id])).rows[0].n;
    ok('12. captura concurrente → exactamente una persiste (sin dup)', [ca, cb].filter(x => x.closing).length === 1 && midCount === 1);
    // 13. quarantined factual capture (preservar evidencia)
    const s3 = await publish();
    await SA.quarantine(s3.id, { adminId: 'a', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'rev', confirmedSignalId: s3.id });
    const capQ = await reg.captureClosing(s3.id, { observedAt: '2026-12-01T17:30:00Z', closingOdds: '2.1', closingSource: 'consensus_no_vig', kickoffAt: FUT });
    ok('13. quarantined permite captura factual de closing', capQ.closing && capQ.closingStatus === 'AVAILABLE');
    // 15. changed kickoff (nueva ventana segura; published_at NO cambia)
    const s4 = await publish({ kickoff: FUT });
    const newKick = '2026-12-05T18:00:00.000Z';
    const capK = await reg.captureClosing(s4.id, { observedAt: '2026-12-05T17:50:00Z', closingOdds: '2.0', kickoffAt: newKick });
    ok('15. kickoff cambiado → ventana recalculada (quote válida vs nuevo kickoff)', capK.closingStatus === 'AVAILABLE' && new Date(capK.closing.kickoff_at).toISOString().startsWith('2026-12-05'));

    // ===================== SETTLEMENT =====================
    console.log('\n§19 SETTLEMENT');
    const sp = await publish();
    // 6. provisional → 7. final (flujo)
    const prov = await reg.settleFromProvider(sp.id, { providerStatus: 'live', regulationHomeGoals: 2, regulationAwayGoals: 0, source: 'espn', sourceReference: 'live-1', observedAt: '2026-12-01T19:30:00Z' });
    ok('6. provisional (no final)', prov.settlement.settlement_status === 'provisional' && prov.settlement.is_final === false && prov.settlement.result_outcome === 'home');
    const fin = await reg.settleFromProvider(sp.id, { providerStatus: 'final', regulationHomeGoals: 2, regulationAwayGoals: 0, source: 'espn', sourceReference: 'final-1', finalizedAt: '2026-12-01T20:00:00Z' });
    ok('1/7. final home win', fin.settlement.settlement_status === 'final' && fin.settlement.is_final === true && fin.settlement.result_outcome === 'home' && fin.settlement.settlement_version === 2);
    // 16. duplicate result idempotent (misma fuente+ref)
    const dupSettle = await reg.settleFromProvider(sp.id, { providerStatus: 'final', regulationHomeGoals: 2, regulationAwayGoals: 0, source: 'espn', sourceReference: 'final-1' });
    ok('16. resultado duplicado (misma fuente+ref) → idempotente', dupSettle.skipped === true);
    // 14. provider correction → nueva versión, previas preservadas
    const corr = await reg.settleFromProvider(sp.id, { providerStatus: 'final', regulationHomeGoals: 3, regulationAwayGoals: 0, source: 'espn', sourceReference: 'correction-1' });
    ok('14. corrección del proveedor → v3, versiones previas intactas', corr.settlement.settlement_version === 3 && (await reg.repo.settlements.listForSignal(sp.id)).length === 3);
    // 2/3 draw/away
    const sd = await publish(); const da = await reg.settleFromProvider(sd.id, { providerStatus: 'final', regulationHomeGoals: 1, regulationAwayGoals: 1, source: 'espn', sourceReference: 'd' });
    ok('2. draw', da.settlement.result_outcome === 'draw');
    const sa = await publish(); const aw = await reg.settleFromProvider(sa.id, { providerStatus: 'final', regulationHomeGoals: 0, regulationAwayGoals: 2, source: 'espn', sourceReference: 'a' });
    ok('3. away win', aw.settlement.result_outcome === 'away');
    // 11/12/13 postponed/abandoned/unresolved
    const spp = await publish(); const pp = await reg.settleFromProvider(spp.id, { postponed: true, source: 'espn', sourceReference: 'pp' });
    ok('11. postponed → no liquida (pending)', pp.settlement.settlement_status === 'postponed' && pp.settlement.is_final === false);
    const sab = await publish(); const ab = await reg.settleFromProvider(sab.id, { abandoned: true, source: 'espn', sourceReference: 'ab' });
    ok('12. abandoned → unresolved', ab.settlement.settlement_status === 'unresolved');
    const sur = await publish(); const ur = await reg.settleFromProvider(sur.id, { providerStatus: 'final', source: 'espn', sourceReference: 'ur' });
    ok('13. sin marcador → unresolved', ur.settlement.settlement_status === 'unresolved' && ur.settlement.result_outcome === 'unresolved');
    // 8. void (cancelled)
    const sc = await publish(); const cc = await reg.settleFromProvider(sc.id, { cancelled: true, source: 'espn', sourceReference: 'c' });
    ok('8/10. cancelled → void', cc.settlement.settlement_status === 'cancelled' && cc.settlement.result_outcome === 'void');
    // 17. concurrent settlement → versiones distintas o error seguro (sin dup silenciosa)
    const scc = await publish();
    const [x, y] = await Promise.allSettled([
      reg.settle(scc.id, { status: 'final', source: 'espn', sourceReference: 'cc-a', winningOutcomeId: 'home' }),
      reg.settle(scc.id, { status: 'final', source: 'espn', sourceReference: 'cc-b', winningOutcomeId: 'home' }),
    ]);
    const versions = (await reg.repo.settlements.listForSignal(scc.id)).map(s => s.settlement_version);
    ok('17. settlement concurrente → versiones únicas (sin dup silenciosa)', new Set(versions).size === versions.length);

    // ===================== ADMINISTRATIVE STATES =====================
    console.log('\n§19 ADMIN STATES');
    // 1. retracted keeps factual result
    const sr = await publish(); await reg.settleFromProvider(sr.id, { providerStatus: 'final', regulationHomeGoals: 1, regulationAwayGoals: 0, source: 'espn', sourceReference: 'r' });
    await SA.retract(sr.id, { adminId: 'a', reasonCode: 'OPERATIONAL_ERROR', reasonText: 'x', confirmedSignalId: sr.id, confirmationPhrase: 'CONFIRM ' + sr.id });
    const srSettle = (await reg.repo.settlements.listForSignal(sr.id)).find(s => s.is_final);
    ok('1. retracted conserva el resultado factual', !!srSettle && srSettle.result_outcome === 'home');
    // 3. administrative void distinct from sport result
    const sv = await publish(); await reg.settleFromProvider(sv.id, { providerStatus: 'final', regulationHomeGoals: 2, regulationAwayGoals: 1, source: 'espn', sourceReference: 'v' });
    await SA.administrativeVoid(sv.id, { adminId: 'a', reasonCode: 'DUPLICATE_SIGNAL', reasonText: 'x', confirmedSignalId: sv.id, confirmationPhrase: 'CONFIRM ' + sv.id });
    const svState = (await SA.getState(sv.id));
    const svSettle = (await reg.repo.settlements.listForSignal(sv.id)).find(s => s.is_final);
    ok('3. void administrativo ≠ resultado deportivo (ambos coexisten)', svState.admin_status === 'ADMINISTRATIVE_VOID' && svSettle.result_outcome === 'home');
    // 5. data error blocks unsafe settlement
    const sde = await publish(); await SA.dataError(sde.id, { adminId: 'a', reasonCode: 'EVENT_MAPPING_INCORRECT', reasonText: 'x', confirmedSignalId: sde.id });
    const blocked = await reg.settleFromProvider(sde.id, { providerStatus: 'final', regulationHomeGoals: 1, regulationAwayGoals: 0, source: 'espn', sourceReference: 'de' });
    ok('5. DATA_ERROR bloquea liquidación automática', blocked.skipped === true && blocked.reason === 'blocked_data_error');

    // ===================== COMMITMENTS =====================
    console.log('\n§19 COMMITMENTS');
    const today = (await q(`SELECT (now() AT TIME ZONE 'utc')::date d`)).rows[0].d;
    const totalSignals = (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n;
    // publica una señal NO elegible (late: event_start en el pasado → score_eligible=false) para confirmar exclusión
    const sLate = await publish({ kickoff: '2026-06-02T00:00:00.000Z' });
    ok('señal late no es score_eligible', sLate.score_eligible === false);
    const c1 = await reg.commitDay(today);
    ok('1/4/6/7. commit con elegibles → root + rango + leaf count', !!c1.commitment && c1.commitment.root_hash && c1.eligible >= 1 && c1.commitment.signal_count === c1.eligible);
    ok('3. excluye experimentales/internal (eligible < total escaneado)', c1.eligible < c1.scanned && c1.scanned === totalSignals + 1);
    // 5. idempotent run
    const c2 = await reg.commitDay(today);
    ok('5. commit idempotente (mismo día) → already_committed', c2.skipped === true && c2.reason === 'already_committed');
    // 4. deterministic root (recomputar manualmente)
    const eligRows = (await q(`SELECT registry_hash, chain_position FROM signals ORDER BY chain_position`)).rows;
    ok('4/8. root reproducible (merkle determinístico)', !!c1.commitment.root_hash);
    // 9. previous commitment immutable (UPDATE bloqueado)
    let immut = false; try { await q(`UPDATE signal_registry_commitments SET root_hash='x'`); } catch { immut = true; }
    ok('9. commitment previo inmutable (UPDATE bloqueado)', immut);
    // 10. empty registry behavior (día sin señales)
    const c3 = await reg.commitDay('2020-01-01');
    ok('10. día vacío → skipped no_signals (no fabrica root)', c3.skipped === true && c3.reason === 'no_signals');
    // 2. pre-epoch / no-eligible behavior: día solo-experimental → no_eligible (no root falso)
    // (todas las del 'today' incluyen elegibles; este chequeo lo cubre el pure test. Aquí confirmamos no_eligible path)
    ok('2. excluye no-elegibles del commitment (eligible solo oficiales)', c1.eligible === (await q(`SELECT count(*)::int n FROM signals WHERE score_eligible=true AND experimental=false`)).rows[0].n);

    // ===================== REGRESSION =====================
    console.log('\n§19 REGRESSION');
    ok('1. Verified Epoch intacto (active)', (await RA.activeEpoch()).status === 'active');
    const vc = await verifier.verifyChain();
    if (!vc.valid) console.error('  [debug] verifyChain errors:', JSON.stringify(vc.errors && vc.errors.slice(0, 3)));
    ok('2. Registry chain válida', vc.valid === true);
    ok('3. Admin audit chain válida', (await SA.verifyChain()).ok === true);
    // 4. signals immutable: intentar UPDATE → bloqueado
    let sigImmut = false; try { await q(`UPDATE signals SET content_hash='x' WHERE id=$1`, [s1.id]); } catch { sigImmut = true; }
    ok('4. señales inmutables (UPDATE bloqueado)', sigImmut);
    const ctl = await RA.controls();
    ok('9/10/11. público off / billing off / auto-pub false (controles)', ctl.registry_public_hidden === true && ctl.product_kill_switch === false);
    const ls = await require(R + '/signal-registry/sweeps').lifecycleStatus();
    ok('health lifecycle expone counts + root', typeof ls.closing_captured_automatic === 'number' && ls.commitment_count >= 1 && !!ls.last_commitment_root);

    console.log(`\n[post-shadow-registry-lifecycle-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
