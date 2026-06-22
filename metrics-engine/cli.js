// metrics-engine/cli.js — Sprint 6 §37. status | once | rebuild | verify | publish | exclusions.
'use strict';
const me = require('./index');
function arg(name, def) { const m = process.argv.find(a => a.startsWith(`--${name}=`)); return m ? m.split('=')[1] : def; }

(async () => {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  try {
    if (cmd === 'status') console.log(JSON.stringify(await me.adminStatus(), null, 2));
    else if (cmd === 'once') console.log(JSON.stringify((await me.runOnce()).counts || await me.runOnce(), null, 2));
    else if (cmd === 'rebuild') console.log(JSON.stringify(await me.fullRebuild({ verifiedEpoch: arg('epoch') }), null, 2));
    else if (cmd === 'verify') { const r = await me.verify(); console.log(JSON.stringify(r, null, 2)); process.exit(r.valid ? 0 : 1); }
    else if (cmd === 'publish') console.log(JSON.stringify(await me.publishSnapshot(), null, 2));
    else if (cmd === 'exclusions') console.log(JSON.stringify(await me.repo.facts.exclusions({ limit: 50 }), null, 2));
    else console.log('comandos: status | once | rebuild [--epoch=] | verify | publish | exclusions');
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
  process.exit(0);
})();
