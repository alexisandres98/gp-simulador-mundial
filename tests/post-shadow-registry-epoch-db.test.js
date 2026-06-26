// tests/post-shadow-registry-epoch-db.test.js — Fase G. Verified Epoch persistente + controles admin + audit.
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
  const RA = require(R + '/signal-registry/registryAdmin');
  const q = (s, p = []) => client.query(s, p);
  try {
    await migrate.up();
    ok('migración 026 aplicada (≥26 total)', (await q(`SELECT count(*)::int n FROM schema_migrations`)).rows[0].n >= 26);
    ok('signal_registry_epochs existe', (await q(`SELECT to_regclass('public.signal_registry_epochs') x`)).rows[0].x != null);
    ok('registry_controls sembrado', (await q(`SELECT count(*)::int n FROM registry_controls`)).rows[0].n === 3);

    // epoch
    const e1 = await RA.createEpoch({ adminId: 'admin@test', reason: 'test' });
    ok('createEpoch: crea era activa', e1.epoch && e1.already === false);
    ok('epoch_started_at ~ now (sin backdate)', Math.abs(Date.now() - +new Date(e1.epoch.epoch_started_at_utc)) < 60000);
    const e2 = await RA.createEpoch({ adminId: 'admin@test' });
    ok('createEpoch idempotente (no crea 2ª)', e2.already === true && e2.epoch.epoch_id === e1.epoch.epoch_id);
    ok('una sola era activa', (await q(`SELECT count(*)::int n FROM signal_registry_epochs WHERE status='active'`)).rows[0].n === 1);
    // inmutable: no se puede mover el timestamp hacia atrás
    let moved = null;
    try { await q(`UPDATE signal_registry_epochs SET epoch_started_at_utc=now()-interval '1 day' WHERE epoch_id=$1`, [e1.epoch.epoch_id]); } catch (er) { moved = er; }
    ok('epoch inmutable: no se puede backdatear', !!moved);
    let del = null;
    try { await q(`DELETE FROM signal_registry_epochs WHERE epoch_id=$1`, [e1.epoch.epoch_id]); } catch (er) { del = er; }
    ok('epoch no se puede borrar', !!del);

    // controles
    await RA.setControl('registry_writes_paused', true, { adminId: 'admin@test', reasonText: 'emergencia' });
    ok('pause writes', (await RA.writesPaused()) === true);
    await RA.setControl('registry_writes_paused', false, { adminId: 'admin@test' });
    ok('resume writes', (await RA.writesPaused()) === false);
    ok('public oculto por defecto', (await RA.controls()).registry_public_hidden === true);

    // audit append-only
    const na = (await q(`SELECT count(*)::int n FROM signal_admin_actions`)).rows[0].n;
    ok('audit registró acciones (epoch + pause/resume)', na >= 3);
    let auditMut = null;
    try { await q(`UPDATE signal_admin_actions SET action='x'`); } catch (er) { auditMut = er; }
    ok('audit log append-only (no UPDATE)', !!auditMut);

    // health
    const hh = await RA.health();
    ok('health: epoch configurado + chain vacía', hh.verified_epoch_configured === true && hh.chain_status === 'valid_empty');
    ok('health: 0 señales', hh.last_signal_at == null);

    console.log(`\n[post-shadow-registry-epoch-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
