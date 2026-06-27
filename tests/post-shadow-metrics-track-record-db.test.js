// tests/post-shadow-metrics-track-record-db.test.js — Fase I §18-19. E2E con repos/servicios REALES:
// señal oficial → closing oficial → settlement final → METRIC FACT inmutable/versionado → aggregate → snapshot
// → preview. Reusa Brier/logloss de Sprint 6. Empty → N/A (nunca ceros). Nunca crea señal oficial en prod.
'use strict';
process.env.DB_SSL = 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00.000Z';
process.env.METRICS_ENGINE_ENABLED = 'true';
process.env.METRICS_ENGINE_WRITE_ENABLED = 'true';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const near = (a, b, t = 1e-6) => a != null && Math.abs(Number(a) - b) < t;
const KICK = '2026-12-01T18:00:00.000Z';

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const reg = require(R + '/signal-registry');
  const SA = require(R + '/signal-registry/signalAdmin');
  const RA = require(R + '/signal-registry/registryAdmin');
  const tr = require(R + '/metrics-engine/trackRecord');
  const verifier = require(R + '/signal-registry/verifier');
  const q = (s, p = []) => client.query(s, p);

  let n = 0;
  async function seed({ outcome = 'home', probs = { home: 0.5, draw: 0.3, away: 0.2 }, odds = '2.00', closing = { status: 'AVAILABLE', prob: 0.52, odds: 1.92 }, result = 'home', settleStatus = 'final', admin = null, kickoff = KICK } = {}) {
    n++;
    const ev = (await q(`INSERT INTO canonical_events (event_type, home_participant, away_participant, scheduled_start, status, competition) VALUES ('match',$1,$2,$3,'final','FIFA World Cup') RETURNING id`, ['H' + n, 'A' + n, kickoff])).rows[0].id;
    const sig = (await reg.publisher.register({
      signal_type: 'model_prediction_v1', canonical_event_id: ev, direction: outcome, event_start_at: kickoff, model_version: 'gp-core-1.4.0',
      signal_payload: { market_type: '1x2', period: 'regulation_90m', predicted_outcome: outcome, published_odds: odds, probabilities: probs },
    }, { actorId: 't', sourceRefs: [{ source_type: 'model_output', source_id: 'm' + n }] })).signal;
    if (closing) await q(`INSERT INTO signal_closing_snapshots (signal_id, benchmark_type, capture_status, closing_status, closing_probability, closing_odds, closing_policy_version, capture_source, kickoff_at, canonical_event_id, market, period, outcome) VALUES ($1,'last_valid_pre_event_executable','captured',$2,$3,$4,'closing-policy-1','automatic',$5,$6,'1x2','regulation_90m',$7)`, [sig.id, closing.status, closing.prob, closing.odds, kickoff, ev, outcome]);
    if (result) await reg.settle(sig.id, { status: settleStatus, resultOutcome: result, source: 'espn', sourceReference: 'r' + n, settlementPolicyVersion: 'settlement-policy-1' });
    if (admin) {
      const conf = { confirmedSignalId: sig.id, confirmationPhrase: 'CONFIRM ' + sig.id };
      if (admin === 'QUARANTINED') await SA.quarantine(sig.id, { adminId: 'a', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'x', ...conf });
      if (admin === 'RETRACTED') await SA.retract(sig.id, { adminId: 'a', reasonCode: 'OPERATIONAL_ERROR', reasonText: 'x', ...conf });
      if (admin === 'DATA_ERROR') await SA.dataError(sig.id, { adminId: 'a', reasonCode: 'EVENT_MAPPING_INCORRECT', reasonText: 'x', ...conf });
      if (admin === 'ADMINISTRATIVE_VOID') await SA.administrativeVoid(sig.id, { adminId: 'a', reasonCode: 'DUPLICATE_SIGNAL', reasonText: 'x', ...conf });
    }
    return { sig, ev };
  }
  const factOf = async (sigId) => (await q(`SELECT * FROM metric_facts WHERE signal_id=$1 AND effective=true`, [sigId])).rows[0];

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });

    // ===================== FACT + BRIER/LOGLOSS/CLV/ROI =====================
    console.log('\n§19 FACTS + BRIER/LOGLOSS/CLV/ROI');
    const { sig: s1 } = await seed({ outcome: 'home', result: 'home' });
    await tr.rebuild();
    const f1 = await factOf(s1.id);
    ok('1/2/4/5. fact elegible con prob congelada + closing + settlement', f1 && f1.metrics_eligibility === 'eligible' && near(f1.published_probability_home, 0.5) && f1.settlement_status === 'final');
    ok('Brier 1X2 = Σ(p-y)² = 0.38', near(f1.brier_score, 0.38));
    ok('log loss = -ln(0.5) ≈ 0.6931', near(f1.log_loss, 0.6931472, 1e-4));
    ok('CLV prob = closing(0.52) - break_even(0.5) = 0.02', near(f1.clv_probability, 0.02));
    ok('ROI flat-1u WON: profit=odds-1=1, return=2', near(f1.flat_unit_profit, 1) && near(f1.flat_unit_return, 2));
    // lost
    const { sig: sL } = await seed({ outcome: 'home', result: 'away' });
    await tr.rebuild(); const fL = await factOf(sL.id);
    ok('ROI flat-1u LOST: profit=-1, return=0', near(fL.flat_unit_profit, -1) && near(fL.flat_unit_return, 0));
    // draw + away outcomes
    const { sig: sD } = await seed({ outcome: 'draw', result: 'draw', odds: '3.30' });
    const { sig: sA } = await seed({ outcome: 'away', result: 'away', odds: '4.00' });
    await tr.rebuild();
    ok('outcomes draw/away elegibles', (await factOf(sD.id)).metrics_eligibility === 'eligible' && (await factOf(sA.id)).result_outcome === 'away');

    // ===================== CLV N/A =====================
    console.log('\n§19 CLV N/A');
    const { sig: sNoClose } = await seed({ closing: { status: 'UNAVAILABLE', prob: null, odds: null }, result: 'home' });
    await tr.rebuild(); const fNo = await factOf(sNoClose.id);
    ok('closing unavailable → CLV = N/A (null, no 0)', fNo.clv_probability === null && fNo.metrics_eligibility === 'eligible');

    // ===================== HELD / EXCLUDED =====================
    console.log('\n§19 ELIGIBILITY');
    const { sig: sProv } = await seed({ result: 'home', settleStatus: 'provisional' });
    await tr.rebuild();
    ok('6. provisional → held (settlement_not_final)', (await factOf(sProv.id)).metrics_eligibility === 'held');
    // pre-epoch
    const { sig: sPre } = await seed({ kickoff: '2026-06-02T00:00:00Z', result: 'home' });
    await tr.rebuild();
    ok('2. pre-epoch (late→no score_eligible) excluida', ['pre_epoch', 'not_registry_eligible'].includes((await factOf(sPre.id)).exclusion_reason));

    // ===================== ESTADOS ADMIN =====================
    console.log('\n§19 ADMIN STATES');
    const { sig: sQ } = await seed({ result: 'home', admin: 'QUARANTINED' });
    const { sig: sR } = await seed({ result: 'home', admin: 'RETRACTED' });
    const { sig: sDE } = await seed({ result: 'home', admin: 'DATA_ERROR' });
    const { sig: sV } = await seed({ result: 'home', admin: 'ADMINISTRATIVE_VOID' });
    await tr.rebuild();
    ok('1. quarantined → held (visible, fuera de primaria)', (await factOf(sQ.id)).metrics_eligibility === 'held');
    ok('2. retracted → visible excluido (no desaparece)', (await factOf(sR.id)).metrics_eligibility === 'excluded' && (await factOf(sR.id)).administrative_status === 'RETRACTED');
    ok('4. data_error → excluido pero contado', (await factOf(sDE.id)).metrics_eligibility === 'excluded' && (await factOf(sDE.id)).exclusion_reason === 'data_error');
    ok('5/6. administrative_void visible, no desaparece; resultado factual preservado', (await factOf(sV.id)).metrics_eligibility === 'excluded' && (await factOf(sV.id)).result_outcome === 'home');

    // ===================== VERSIONADO / IDEMPOTENCIA =====================
    console.log('\n§19 FACTS versioning');
    const before = (await q(`SELECT count(*)::int n FROM metric_facts`)).rows[0].n;
    await tr.rebuild();
    ok('6. fact idempotente (re-run no crea nuevos)', (await q(`SELECT count(*)::int n FROM metric_facts`)).rows[0].n === before);
    // corrección: nueva versión de settlement → nuevo fact, previo superseded
    await reg.settle(s1.id, { status: 'final', resultOutcome: 'home', source: 'espn', sourceReference: 'correction-x', settlementPolicyVersion: 'settlement-policy-1' });
    await tr.rebuild();
    const versions = (await q(`SELECT count(*)::int n FROM metric_facts WHERE signal_id=$1`, [s1.id])).rows[0].n;
    const effCount = (await q(`SELECT count(*)::int n FROM metric_facts WHERE signal_id=$1 AND effective=true`, [s1.id])).rows[0].n;
    ok('7/8. corrección → nueva versión, anterior preservada (1 efectiva)', versions === 2 && effCount === 1);
    // immutabilidad: no se puede borrar ni reescribir brier
    let immut = false; try { await q(`UPDATE metric_facts SET brier_score=9 WHERE signal_id=$1`, [s1.id]); } catch { immut = true; }
    ok('fact append-only (UPDATE de brier bloqueado)', immut);

    // ===================== AGGREGATES / SNAPSHOTS =====================
    console.log('\n§19 AGGREGATES/SNAPSHOTS');
    const facts = await tr.effectiveFacts();
    const eligible = facts.filter(f => f.metrics_eligibility === 'eligible');
    const agg = tr.computeAggregate(eligible);
    ok('1. agregado global con sample_size', agg.sample_size === eligible.length && agg.sample_size >= 4);
    ok('ROI/yield + sample size etiquetado theoretical/flat_1_unit/executed_by_gp=false', agg.economic_label.includes('executed_by_gp=false') && agg.theoretical_roi != null);
    ok('cohortes §11 presentes', (() => { const c = tr.cohortCounts(facts); return c.ALL_OFFICIAL_SIGNALS > 0 && 'RETRACTED' in c && 'CLV_UNAVAILABLE' in c; })());
    const sn = await tr.snapshot();
    ok('snapshot creado (versionado)', sn.created === 1 && sn.snapshot_id);
    let snImmut = false; try { await q(`UPDATE metric_track_snapshots SET sample_size=999`); } catch { snImmut = true; }
    ok('6. snapshot inmutable (UPDATE bloqueado)', snImmut);

    // ===================== EMPTY STATE (N/A) =====================
    console.log('\n§19 EMPTY STATE');
    const emptyAgg = tr.computeAggregate([]);
    ok('7/8. empty → sample_size=0 + insufficient + N/A (sin ceros)', emptyAgg.sample_size === 0 && emptyAgg.status === 'insufficient_sample' && emptyAgg.theoretical_roi === undefined);

    // ===================== READINESS GATE =====================
    console.log('\n§19 READINESS GATE');
    const { ev: evRdy } = await seed({ result: null, closing: null });
    const rdy = await tr.readiness({ canonicalEventId: evRdy });
    ok('17. gate bloquea por MISSING_RESULT_PROVIDER_MAPPING (default)', rdy.ready === false && rdy.block_reason === 'MISSING_RESULT_PROVIDER_MAPPING');

    // ===================== SECURITY / REGRESSION =====================
    console.log('\n§19 REGRESIÓN');
    ok('3. epoch intacto', (await RA.activeEpoch()).status === 'active');
    ok('4. registry chain válida', (await verifier.verifyChain()).valid === true);
    ok('5. admin chain válida', (await SA.verifyChain()).ok === true);
    const ctl = await RA.controls();
    ok('Picks/público off (controles)', ctl.registry_public_hidden === true);
    const stat = await tr.status();
    ok('status preview: N/A cuando aplica + verified epoch', stat.verified_epoch && typeof stat.cards.brier !== 'undefined');

    console.log(`\n[post-shadow-metrics-track-record-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
