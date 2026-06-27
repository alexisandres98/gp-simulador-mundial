// tests/post-shadow-n1-lifecycle-db.test.js — Fase N.1 (DB). Migración 035 + shadow closing/settlement/metrics +
// NB overdispersion + jobs/locks. No toca tablas oficiales.
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const lc = require(R + '/shadow-ops/lifecycle');
const nb = require(R + '/goal-engine/negativeBinomial');
const ge = require(R + '/goal-engine/distribution');
const EV = require('crypto').randomUUID();
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  console.log('\n§N.7 OVERDISPERSION (NB vs Poisson+DC)');
  const lh = 1.55, la = 0.95;
  const poi = ge.buildMatrix(lh, la).matrix, nbm = nb.buildMatrixNB(lh, la, { r: 8 }).matrix;
  ok('NB matriz suma ≈1', Math.abs(nbm.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0) - 1) < 1e-6);
  ok('NB tiene MÁS varianza en colas que Poisson (P(total≥4) mayor)', nb.overProb(nbm, 3.5) >= nb.overProb(poi, 3.5) - 1e-9);
  ok('familyDisagreement >= 0 y finito', (d => d >= 0 && isFinite(d))(nb.familyDisagreement(poi, nbm)));

  console.log('\n§N.10/N.11 SETTLE + METRICS (puro)');
  const r = lc.settleEvent({ canonicalEventId: EV, v1Vector: { home: 0.7, draw: 0.2, away: 0.1 }, v2Snapshot: { final_probability_vector: { home: 0.56, draw: 0.27, away: 0.17 } }, goalValueRows: [{ market_id: 'TOTAL_GOALS_OVER_2_5', market_family: 'match_total', gp_probability: 0.52 }], result: { homeGoals: 2, awayGoals: 1, observedAt: '2026-07-01T20:00:00Z' } });
  ok('outcome 2-1 → home', r.outcome === 'home');
  ok('genera facts V1, V2 y GOAL', r.facts.some(f => f.model_label === 'V1') && r.facts.some(f => f.model_label === 'V2') && r.facts.some(f => f.model_label === 'GOAL'));
  ok('Over 2.5 con total 3 → won + brier del lado GP', (g => g && g.result_outcome === 'won' && g.brier_score != null)(r.facts.find(f => f.model_label === 'GOAL')));
  const agg = lc.aggregate(r.facts);
  ok('aggregate por modelo:subject', agg['V1:1x2'] && agg['V2:1x2'] && agg['V1:1x2'].sample === 1);

  console.log('\n§N.1 DB: migración 035 + persistencia + idempotencia');
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/shadow-ops/repository');
  const tbl = async () => (await client.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('shadow_job_runs','shadow_job_locks','shadow_closing_snapshots','shadow_settlements','shadow_metric_facts')`)).rows[0].n;
  try {
    await migrate.up();
    ok('UP: 5 tablas N.1 creadas', (await tbl()) === 5);
    let rolls = 0; while ((await tbl()) > 0 && rolls < 5) { await migrate.rollback(); rolls++; }
    ok('DOWN: 5 tablas N.1 desaparecen', (await tbl()) === 0);
    await migrate.up();
    ok('RE-UP: vuelven', (await tbl()) === 5);

    // jobs: lock anti-solape
    const l1 = await repo.acquireLock('v2_eval', 60000);
    const l2 = await repo.acquireLock('v2_eval', 60000);
    ok('lock anti-solape: 2º acquire falla', l1 === true && l2 === false);
    await repo.releaseLock('v2_eval');
    ok('release permite re-adquirir', (await repo.acquireLock('v2_eval', 60000)) === true);
    const rid = await repo.startRun('v2_eval', { quotaBefore: 19000 });
    await repo.heartbeat(rid); await repo.finishRun(rid, { status: 'success', rows: 6, quotaAfter: 19000 });
    ok('job run registrado success', (await client.query(`SELECT status FROM shadow_job_runs WHERE run_id=$1`, [rid])).rows[0].status === 'success');

    // persistencia idempotente
    for (const f of r.facts) await repo.recordMetricFact(f);
    const dup = await repo.recordMetricFact(r.facts[0]);
    ok('shadow_metric_facts idempotente por input_hash', dup.idempotent === true);
    const cl = await repo.recordClosing({ canonical_event_id: EV, subject_type: 'goal_total', market_id: 'TOTAL_GOALS_OVER_2_5', outcome: 'over', publication_probability: 0.52, closing_probability: 0.50, closing_status: 'AVAILABLE', input_hash: 'cl1' });
    ok('shadow closing persistido', !!cl.row.closing_id && cl.idempotent === false);
    const st = await repo.recordSettlement({ canonical_event_id: EV, subject_type: 'goal_total', market_id: 'TOTAL_GOALS_OVER_2_5', outcome: 'over', result_outcome: 'won', regulation_home_goals: 2, regulation_away_goals: 1, input_hash: 'st1' });
    ok('shadow settlement persistido (no oficial)', !!st.row.settlement_id);

    console.log('\n§N.1 INVARIANTES');
    const inv = (await client.query(`SELECT (SELECT count(*) FROM signals)::int s,(SELECT count(*) FROM internal_picks)::int p,(SELECT count(*) FROM signal_closing_snapshots)::int oc,(SELECT count(*) FROM signal_settlements)::int os,(SELECT count(*) FROM metric_facts)::int mf`)).rows[0];
    ok('NO escribe en tablas oficiales (closing/settlement/metric_facts) ni Signals/Picks', inv.s === 0 && inv.p === 0 && inv.oc === 0 && inv.os === 0 && inv.mf === 0);

    console.log(`\n[post-shadow-n1-lifecycle-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
