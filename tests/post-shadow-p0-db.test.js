// tests/post-shadow-p0-db.test.js — Fase P.0. Operación autónoma (cadencia/aislamiento) + cutover prepare/guards
// + recomendaciones separadas V2/Goals. No toca tablas oficiales; no ejecuta cutover.
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();                    // boot ANTES de requerir módulos que tocan database/config
  const ao = require(R + '/shadow-ops/autonomousOps');
  const co = require(R + '/model-registry/cutover');
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/shadow-ops/repository');
  console.log('\n§P.0 RECOMENDACIONES SEPARADAS (puro)');
  const matrixGood = { matrix: [{ dimension: 'DATA_READY', status: 'PASS' }, { dimension: 'PIPELINE_READY', status: 'PASS' }, { dimension: 'ROLLBACK_READY', status: 'PASS' }, { dimension: 'MODEL_READY', status: 'CONDITIONAL' }] };
  const drOk = { verdict: 'DRY_RUN_OK', contract: { model_version: 'v2' } };
  ok('V2 1X2 CONDITIONAL_GO sin evidencia liquidada V2', co.recommendFrom(matrixGood, drOk, { v2_settled_sample: 0, goal_settled_sample: 0, goal_calibrated: false }).V2_1X2_CUTOVER === 'CONDITIONAL_GO');
  ok('V2 1X2 GO con evidencia liquidada V2', co.recommendFrom(matrixGood, drOk, { v2_settled_sample: 3, goal_settled_sample: 0 }).V2_1X2_CUTOVER === 'GO');
  ok('Goal markets NO_GO con muestra mínima', co.recommendFrom(matrixGood, drOk, { v2_settled_sample: 3, goal_settled_sample: 2, goal_calibrated: false }).GOAL_MARKETS_PROMOTION === 'NO_GO');
  const matrixFail = { matrix: [{ dimension: 'DATA_READY', status: 'FAIL' }, { dimension: 'PIPELINE_READY', status: 'PASS' }, { dimension: 'ROLLBACK_READY', status: 'PASS' }] };
  ok('hard FAIL → V2 NO_GO', co.recommendFrom(matrixFail, drOk, { v2_settled_sample: 3 }).V2_1X2_CUTOVER === 'NO_GO');
  ok('V2 y Goals son independientes (V2 puede ir, Goals no)', (r => r.V2_1X2_CUTOVER !== 'NO_GO' && r.GOAL_MARKETS_PROMOTION === 'NO_GO')(co.recommendFrom(matrixGood, drOk, { v2_settled_sample: 3, goal_settled_sample: 0 })));

  console.log('\n§P.0 DB: cadencia + cutover prepare + guards');
  try {
    await migrate.up();
    ok('due(): sin runs previos → toca correr', (await ao.due('news_fetch', 60000)) === true);
    const rid = await repo.startRun('news_fetch'); await repo.finishRun(rid, { status: 'success' });
    ok('due(): tras run reciente → NO toca (cadencia)', (await ao.due('news_fetch', 60000)) === false);
    ok('autonomousOps.tick skipped si refresh disabled', (() => { delete process.env.GP_V2_SHADOW_REFRESH_ENABLED; return true; })() && (await ao.tick()).skipped === 'refresh_disabled');

    // cutover prepare + guards
    const prep = await co.prepare();
    ok('prepare(): promotion_record READY_FOR_APPROVAL (no ACTIVE)', prep.promotion_record.status === 'READY_FOR_APPROVAL');
    ok('prepare(): dos recomendaciones separadas', 'V2_1X2_CUTOVER' in prep.recommendations && 'GOAL_MARKETS_PROMOTION' in prep.recommendations);
    ok('prepare(): readiness 12 dimensiones', prep.readiness.matrix.length === 12);
    delete process.env.GP_ALLOW_CUTOVER;
    ok('executeCutover bloqueado sin GP_ALLOW_CUTOVER', (await co.executeCutover({ superadmin: true, reason: 'x', confirmationPhrase: 'CUTOVER V1->V2' })).reason === 'cutover_disabled');
    process.env.GP_ALLOW_CUTOVER = 'true';
    ok('executeCutover exige doble confirmación', (await co.executeCutover({ superadmin: true, reason: 'cutover ya', confirmationPhrase: 'wrong' })).reason === 'confirmation_required');
    ok('executeCutover NO ejecuta en P.0 (bloqueado: readiness_fail/phase_p_only)', (r => r.ok !== true && ['phase_p_only', 'readiness_fail', 'dry_run_failed'].includes(r.reason))(await co.executeCutover({ superadmin: true, reason: 'cutover ya', confirmationPhrase: 'CUTOVER V1->V2' })));
    delete process.env.GP_ALLOW_CUTOVER;

    console.log('\n§P.0 INVARIANTES');
    const inv = (await client.query(`SELECT (SELECT count(*) FROM signals)::int s,(SELECT count(*) FROM internal_picks)::int p`)).rows[0];
    ok('no toca Signals/Picks', inv.s === 0 && inv.p === 0);
    console.log(`\n[post-shadow-p0-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
