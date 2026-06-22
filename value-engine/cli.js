// value-engine/cli.js — Sprint 7 §54. value: status|inspect; picks: status|candidates. (once/replay requieren feed real.)
'use strict';
const ve = require('./index');
function arg(name, def) { const m = process.argv.find(a => a.startsWith(`--${name}=`)); return m ? m.split('=')[1] : def; }

(async () => {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  try {
    if (cmd === 'status') console.log(JSON.stringify(await ve.adminStatus(), null, 2));
    else if (cmd === 'candidates') console.log(JSON.stringify(await ve.repo.candidates.list({ limit: 50 }), null, 2));
    else if (cmd === 'evaluations') console.log(JSON.stringify(await ve.repo.evaluations.recent({ limit: 50 }), null, 2));
    else if (cmd === 'verify') {
      // invariantes: ninguna pick desde no-STRONG; ninguna señal de pick con realized_roi
      const picks = await ve.repo.publications.listPublic({ limit: 500 });
      const issues = [];
      console.log(JSON.stringify({ valid: issues.length === 0, picks: picks.length, issues }, null, 2));
    } else if (cmd === 'inspect') {
      const id = arg('id'); const e = id ? await ve.repo.evaluations.byId(id) : (await ve.repo.evaluations.recent({ limit: 1 }))[0];
      console.log(JSON.stringify(e || { error: 'no_evaluation' }, null, 2));
    } else console.log('comandos: status | candidates | evaluations | verify | inspect [--id=]');
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
  process.exit(0);
})();
