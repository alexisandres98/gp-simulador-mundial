// tests/post-shadow-registry-admin-http.test.js — Fase G.1. E2E HTTP: levanta server.js como proceso hijo
// contra PG embebida + db.json TEMPORAL (nunca el real). Verifica 401/403/200, doble confirmación, controles,
// y que las superficies públicas sigan en 404. No crea señales en prod.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { boot } = require('./_pg-harness');

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } };

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(d); } catch { return d; } })() })); });
    r.on('error', reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
async function waitUp(port) { for (let i = 0; i < 60; i++) { try { await req({ host: 'localhost', port, path: '/api/version', method: 'GET' }); return true; } catch { await new Promise(r => setTimeout(r, 200)); } } return false; }

(async () => {
  const h = await boot();
  const DBURL = process.env.DATABASE_URL;
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const RA = require(R + '/signal-registry/registryAdmin');
  let child, stderr = '';
  const dbfile = path.join(os.tmpdir(), 'gpsim-http-db-' + process.pid + '.json');
  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });
    const sig = (await client.query(`INSERT INTO signals (signal_type, published_at, event_start_at, content_hash, registry_hash, chain_position, signal_payload) VALUES ('model_prediction_v1','2026-05-15T10:00:00Z','2026-12-01T00:00:00Z','ch1','rh1',1,'{}') RETURNING id`)).rows[0];
    const now = Date.now();
    fs.writeFileSync(dbfile, JSON.stringify({ users: { 'admin@test': { createdAt: now, verified: true }, 'user@test': { createdAt: now + 1, verified: true } }, sessions: { tokadmin: 'admin@test', tokuser: 'user@test' } }));
    await client.close(); // liberar el pool de test; el server abre el suyo a la misma PG

    const port = 3997;
    child = spawn(process.execPath, [R + '/server.js'], {
      env: { ...process.env, PORT: String(port), DATABASE_URL: DBURL, DB_SSL: 'false', DB_FILE: dbfile,
        SIGNAL_REGISTRY_ENABLED: 'true', SIGNAL_REGISTRY_WRITE_ENABLED: 'true', SIGNAL_REGISTRY_PUBLIC_ENABLED: 'false',
        ADMIN_EMAILS: 'admin@test', REGISTRY_SUPERADMIN_EMAILS: 'admin@test', OPERATIONS_ORCHESTRATOR_ENABLED: 'false' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', d => { stderr += d.toString(); });

    ok('server arriba', await waitUp(port));
    const H = (tok) => ({ host: 'localhost', port, headers: tok ? { authorization: 'Bearer ' + tok, 'content-type': 'application/json' } : { 'content-type': 'application/json' } });

    ok('overview sin token → 401', (await req({ ...H(null), path: '/api/internal/registry/overview', method: 'GET' })).status === 401);
    ok('overview usuario normal → 403', (await req({ ...H('tokuser'), path: '/api/internal/registry/overview', method: 'GET' })).status === 403);
    const ov = await req({ ...H('tokadmin'), path: '/api/internal/registry/overview', method: 'GET' });
    // (este test inserta 1 señal sintética → chain_status='has_entries'; la "chain vacía" es invariante de PROD)
    ok('overview admin → 200 + epoch + health', ov.status === 200 && !!ov.json.epoch && ['valid_empty', 'has_entries'].includes(ov.json.health.chain_status) && ov.json.health.verified_epoch_configured === true);
    ok('overview lista acciones disponibles', ov.status === 200 && Array.isArray(ov.json.actions_available) && ov.json.actions_available.includes('quarantine'));

    const sl = await req({ ...H('tokadmin'), path: '/api/internal/registry/signals', method: 'GET' });
    ok('signals list admin → 200', sl.status === 200 && Array.isArray(sl.json.items));

    const q1 = await req({ ...H('tokadmin'), path: `/api/internal/registry/signals/${sig.id}/quarantine`, method: 'POST' }, { reason_code: 'DATA_UNDER_REVIEW', reason_text: 'x' });
    ok('quarantine sin confirm signal id → 422', q1.status === 422 && q1.json.details.includes('signal_id_mismatch'));
    const q2 = await req({ ...H('tokadmin'), path: `/api/internal/registry/signals/${sig.id}/quarantine`, method: 'POST' }, { reason_code: 'DATA_UNDER_REVIEW', reason_text: 'rev', confirm_signal_id: sig.id });
    ok('quarantine admin con confirm → 200 QUARANTINED', q2.status === 200 && q2.json.status === 'QUARANTINED');

    // retract (crítica) sin frase reforzada → 422
    const r1 = await req({ ...H('tokadmin'), path: `/api/internal/registry/signals/${sig.id}/retract`, method: 'POST' }, { reason_code: 'OPERATIONAL_ERROR', reason_text: 'x', confirm_signal_id: sig.id });
    ok('retract sin frase reforzada → 422', r1.status === 422 && r1.json.details.includes('reinforced_confirmation_required'));

    // usuario normal NO puede actuar
    const uAct = await req({ ...H('tokuser'), path: `/api/internal/registry/signals/${sig.id}/retract`, method: 'POST' }, { reason_code: 'OPERATIONAL_ERROR', reason_text: 'x', confirm_signal_id: sig.id, confirmation_phrase: 'CONFIRM ' + sig.id });
    ok('usuario normal acción → 403', uAct.status === 403);

    // controles globales
    const c1 = await req({ ...H('tokadmin'), path: '/api/internal/registry/controls', method: 'POST' }, { control: 'pause_writes', reason: 'test' });
    ok('pause writes → 200', c1.status === 200 && c1.json.enabled === true);
    const c2 = await req({ ...H('tokadmin'), path: '/api/internal/registry/controls', method: 'POST' }, { control: 'resume_writes' });
    ok('resume writes → 200', c2.status === 200 && c2.json.enabled === false);
    const c3 = await req({ ...H('tokuser'), path: '/api/internal/registry/controls', method: 'POST' }, { control: 'kill_switch_on' });
    ok('control por usuario normal → 403', c3.status === 403);

    // superficies públicas siguen apagadas
    ok('/api/signals público → 404', (await req({ ...H(null), path: '/api/signals', method: 'GET' })).status === 404);
    ok('/api/value/signals público → 404', [404].includes((await req({ ...H(null), path: '/api/value/signals', method: 'GET' })).status));

    // audit log refleja las acciones
    const au = await req({ ...H('tokadmin'), path: '/api/internal/registry/audit', method: 'GET' });
    ok('audit log admin → 200 con eventos + chain ok', au.status === 200 && au.json.items.length > 0 && au.json.chain.ok === true);

    console.log(`\n[post-shadow-registry-admin-http] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERR', e.message, e.stack); }
  finally {
    if (fail && stderr) console.error('--- server stderr ---\n' + stderr.slice(-2000));
    if (child) { try { child.kill('SIGKILL'); } catch {} }
    try { fs.unlinkSync(dbfile); } catch {}
    await h.stop(); process.exit(fail ? 1 : 0);
  }
})();
