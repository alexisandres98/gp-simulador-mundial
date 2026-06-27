// tests/post-shadow-model-promotion-db.test.js — Fase M.8. Máquina de promoción/cutover V1→V2 (INERTE).
// Verifica: config oficial default V1, kill switch, fallback gating, y el ciclo propose→approve→activate→rollback
// auditado en model_promotion_policies/model_cutover_events. NO promueve nada real (flags OFF).
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const prom = require(R + '/model-registry/promotion');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  console.log('\n§M.8 CONFIG OFICIAL + KILL SWITCH + FALLBACK (puro)');
  delete process.env.GP_OFFICIAL_MODEL; delete process.env.GP_V2_KILL_SWITCH; delete process.env.GP_ALLOW_CUTOVER;
  ok('default: modelo oficial efectivo = v1', prom.effectiveOfficialModel() === 'v1');
  process.env.GP_OFFICIAL_MODEL = 'v2';
  ok('GP_OFFICIAL_MODEL=v2 → efectivo v2', prom.effectiveOfficialModel() === 'v2');
  process.env.GP_V2_KILL_SWITCH = 'true';
  ok('kill switch ON fuerza v1 aunque oficial=v2', prom.effectiveOfficialModel() === 'v1');
  delete process.env.GP_OFFICIAL_MODEL; delete process.env.GP_V2_KILL_SWITCH;
  ok('FULL_CONTEXT → elegible candidate', prom.fallbackGate({ contextState: 'FULL_CONTEXT' }).eligibleForCandidate === true);
  ok('PARTIAL + missingCritical → NO elegible', prom.fallbackGate({ contextState: 'PARTIAL_CONTEXT', missingCritical: true }).eligibleForCandidate === false);
  ok('BASE_ONLY_FALLBACK → NO crea STRONG', prom.fallbackGate({ contextState: 'BASE_ONLY_FALLBACK' }).eligibleForCandidate === false);
  ok('BLOCKED → NO evalúa', prom.fallbackGate({ contextState: 'BLOCKED' }).eligibleForCandidate === false);

  console.log('\n§M.8 CICLO DE PROMOCIÓN (DB, auditado)');
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/model-registry/repository');
  try {
    await migrate.up();
    const p = await prom.propose({ previous_official_model: 'V1', new_official_model: 'V2', model_version: 'gp-intelligence-v2-0.1.0', reason: 'cutover readiness', approved_by: 'admin@test' }, { repo });
    ok('propose crea policy status=proposed', p.status === 'proposed' && !!p.policy_id);
    const hist0 = await repo.cutoverHistory(p.policy_id);
    ok('evento "proposed" auditado', hist0.length === 1 && hist0[0].event_type === 'proposed');
    await prom.approve(p.policy_id, { actorId: 'admin@test', reason: 'ok', repo });
    // activar SIN flag → bloqueado
    delete process.env.GP_ALLOW_CUTOVER;
    const blocked = await prom.activate(p.policy_id, { actorId: 'admin@test', repo });
    ok('activate sin GP_ALLOW_CUTOVER → bloqueado (no cutover)', blocked.ok === false && blocked.reason === 'cutover_disabled');
    let act = (await client.query(`SELECT status FROM model_promotion_policies WHERE policy_id=$1`, [p.policy_id])).rows[0].status;
    ok('policy sigue sin estar activa', act !== 'active');
    // activar CON flag
    process.env.GP_ALLOW_CUTOVER = 'true';
    const r = await prom.activate(p.policy_id, { actorId: 'admin@test', reason: 'GO', repo });
    ok('activate con flag → status active', r.ok === true && r.policy.status === 'active');
    const active = await repo.activePolicy();
    ok('hay una policy activa', active && active.policy_id === p.policy_id);
    // rollback
    await prom.rollback(p.policy_id, { actorId: 'admin@test', reason: 'revert', repo });
    act = (await client.query(`SELECT status FROM model_promotion_policies WHERE policy_id=$1`, [p.policy_id])).rows[0].status;
    ok('rollback → status rolled_back', act === 'rolled_back');
    const hist = await repo.cutoverHistory(p.policy_id);
    ok('auditoría completa: proposed→approved→activated→rolled_back', hist.map(e => e.event_type).join(',') === 'proposed,approved,activated,rolled_back');
    delete process.env.GP_ALLOW_CUTOVER;

    console.log('\n§M.8 INVARIANTES');
    const inv = (await client.query(`SELECT (SELECT count(*) FROM signals)::int s,(SELECT count(*) FROM internal_picks)::int p`)).rows[0];
    ok('no se creó Signal/Pick', inv.s === 0 && inv.p === 0);

    console.log(`\n[post-shadow-model-promotion-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
