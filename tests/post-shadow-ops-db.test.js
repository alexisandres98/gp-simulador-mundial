// tests/post-shadow-ops-db.test.js — Post-shadow Bloques D (orphan reconciliation), E (capabilities),
// B (retención) contra PostgreSQL real (embedded-postgres).
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/sportsbook-providers/repositories');
  const q = (s, p = []) => client.query(s, p);
  try {
    await migrate.up();

    // ===== Bloque D: reconciliación de runs huérfanos =====
    // run viejo sin heartbeat reciente (proceso muerto)
    const orphan = (await q(`INSERT INTO sportsbook_ingestion_runs (status, run_type, started_at, heartbeat_at)
      VALUES ('running','scheduled', now() - interval '30 min', now() - interval '20 min') RETURNING id`)).rows[0].id;
    // run vivo (heartbeat fresco)
    const alive = (await q(`INSERT INTO sportsbook_ingestion_runs (status, run_type, started_at, heartbeat_at)
      VALUES ('running','scheduled', now() - interval '2 min', now()) RETURNING id`)).rows[0].id;
    const rec = await repo.reconcileOrphanRuns({ staleMs: 10 * 60 * 1000 });
    ok('reconcile: 1 huérfano → abandoned', rec.reconciled === 1 && rec.ids[0] === orphan, JSON.stringify(rec));
    ok('reconcile: huérfano queda abandoned', (await q(`SELECT status FROM sportsbook_ingestion_runs WHERE id=$1`, [orphan])).rows[0].status === 'abandoned');
    ok('reconcile: registra reconciled_at + nota', (await q(`SELECT reconciled_at IS NOT NULL AND reconcile_note IS NOT NULL x FROM sportsbook_ingestion_runs WHERE id=$1`, [orphan])).rows[0].x);
    ok('reconcile: run vivo NO se toca', (await q(`SELECT status FROM sportsbook_ingestion_runs WHERE id=$1`, [alive])).rows[0].status === 'running');
    // heartbeat mantiene vivo
    await repo.heartbeatRun(alive);
    ok('heartbeat: actualiza heartbeat_at', (await q(`SELECT heartbeat_at > now() - interval '5 s' x FROM sportsbook_ingestion_runs WHERE id=$1`, [alive])).rows[0].x);
    ok('listRunningRuns: solo el vivo', (await repo.listRunningRuns()).length === 1);

    // ===== Bloque E: capabilities =====
    await repo.recordCapability('the_odds_api', 'soccer_world_cup_winner', { ok: false, status: 'no_h2h', errorCode: 'bad_request', reason: 'sport key sin mercado h2h', disable: true });
    let caps = await repo.loadCapabilities('the_odds_api');
    ok('capability: key sin h2h → is_active=false', caps['soccer_world_cup_winner'].is_active === false);
    ok('capability: supports_h2h=false + razón', caps['soccer_world_cup_winner'].supports_h2h === false && /h2h/.test(caps['soccer_world_cup_winner'].reason));
    // key buena
    await repo.recordCapability('the_odds_api', 'soccer_fifa_world_cup', { ok: true, status: 'ok', sportTitle: 'FIFA World Cup' });
    caps = await repo.loadCapabilities('the_odds_api');
    ok('capability: key buena activa + supports_h2h', caps['soccer_fifa_world_cup'].is_active === true && caps['soccer_fifa_world_cup'].supports_h2h === true);
    // ok posterior NO reactiva una key desactivada (sigue excluida hasta reactivación manual)
    await repo.recordCapability('the_odds_api', 'soccer_world_cup_winner', { ok: true, status: 'ok' });
    caps = await repo.loadCapabilities('the_odds_api');
    ok('capability: ok NO reactiva una key desactivada', caps['soccer_world_cup_winner'].is_active === false);

    // ===== Bloque B: retención (dry-run por defecto, execute guarded, scope inválido) =====
    const retention = require(R + '/sportsbook-providers/retention');
    // semilla: filas viejas y nuevas en raw legacy
    for (let i = 0; i < 30; i++) await q(`INSERT INTO sportsbook_quotes (sportsbook_code, external_event_id, market_family, external_outcome_id, received_at)
      VALUES ('bk','ev','1x2',$1, now() - interval '40 days')`, ['o' + i]);
    for (let i = 0; i < 10; i++) await q(`INSERT INTO sportsbook_quotes (sportsbook_code, external_event_id, market_family, external_outcome_id, received_at)
      VALUES ('bk','ev','1x2',$1, now())`, ['n' + i]);

    delete process.env.SPORTSBOOK_RETENTION_ENABLED; delete process.env.SPORTSBOOK_RETENTION_DRY_RUN;  // defaults: pausado
    let res = await retention.run('redundant_raw', { days: 14 });
    ok('retención: por defecto es dry_run', res.status === 'dry_run' && res.reason === 'disabled', JSON.stringify(res));
    ok('retención dry-run: cuenta 30 candidatas', res.rows_considered === 30, JSON.stringify(res));
    ok('retención dry-run: NO borra', res.rows_deleted === 0 && (await q(`SELECT count(*)::int n FROM sportsbook_quotes`)).rows[0].n === 40);
    ok('retención dry-run: audita mode=dry_run', (await q(`SELECT count(*)::int n FROM sportsbook_retention_audit WHERE mode='dry_run'`)).rows[0].n >= 1);

    // execute guarded: requiere AMBOS flags
    process.env.SPORTSBOOK_RETENTION_ENABLED = 'true'; process.env.SPORTSBOOK_RETENTION_DRY_RUN = 'false';
    res = await retention.run('redundant_raw', { days: 14 });
    ok('retención execute: borra las 30 viejas', res.status === 'executed' && res.rows_deleted === 30, JSON.stringify(res));
    ok('retención execute: conserva las 10 nuevas', (await q(`SELECT count(*)::int n FROM sportsbook_quotes`)).rows[0].n === 10);
    ok('retención execute: audita mode=execute', (await q(`SELECT count(*)::int n FROM sportsbook_retention_audit WHERE mode='execute'`)).rows[0].n === 1);
    // scope inválido → error (no puede tocar tablas fuera del allowlist)
    let bad = null; try { await retention.run('signals'); } catch (e) { bad = e; }
    ok('retención: scope inválido rechazado (allowlist)', bad && bad.code === 'invalid_retention_scope');

    console.log(`\n[post-shadow-ops-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
