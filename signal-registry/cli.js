// signal-registry/cli.js — Sprint 5 §35. Operación por CLI (lectura/verificación/commit). No expone secretos.
'use strict';
const cfg = require('./config');
const registry = require('./index');
const repo = require('./repositories');

function arg(name, def) { const m = process.argv.find(a => a.startsWith(`--${name}=`)); return m ? m.split('=')[1] : def; }

(async () => {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  try {
    if (cmd === 'status') {
      console.log(JSON.stringify(await registry.adminStatus(), null, 2));
    } else if (cmd === 'verify-chain') {
      const r = await registry.verifyChain();
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.valid ? 0 : 1);
    } else if (cmd === 'verify-signal') {
      const id = arg('id'); if (!id) { console.error('falta --id=<public_id>'); process.exit(2); }
      const r = await registry.verify(id);
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.valid ? 0 : 1);
    } else if (cmd === 'commit-day') {
      const date = arg('date'); if (!date) { console.error('falta --date=YYYY-MM-DD'); process.exit(2); }
      console.log(JSON.stringify(await registry.commitDay(date), null, 2));
    } else if (cmd === 'capture-closing' || cmd === 'settle') {
      console.log(`'${cmd}' se ejecuta vía scheduler/endpoints admin (requiere flags ${cmd === 'settle' ? 'SIGNAL_SETTLEMENT_ENABLED' : 'SIGNAL_CLOSING_CAPTURE_ENABLED'}). Estado:`);
      console.log(JSON.stringify(await registry.adminStatus(), null, 2));
    } else {
      console.log('comandos: status | verify-chain | verify-signal --id= | commit-day --date= | capture-closing | settle');
    }
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
  process.exit(0);
})();
