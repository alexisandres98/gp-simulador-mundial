// operations/cli.js — CLI de operaciones (Sprint 8A). Solo lectura + runOnce manual. No imprime secretos.
// Uso: node operations/cli.js <status|jobs|run <job>|dead-letters|recover|boot-report>
'use strict';
const orchestrator = require('./orchestrator');
const health = require('./health');
const heartbeats = require('./heartbeats');
const deadLetters = require('./repositories/deadLetterRepository');

function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'status' || !cmd) out(await orchestrator.status());
    else if (cmd === 'jobs') out((await orchestrator.status()).jobs);
    else if (cmd === 'run') { if (!arg) throw new Error('falta <job>'); out(await orchestrator.runOnce(arg, { runType: 'manual' })); }
    else if (cmd === 'dead-letters') out(await deadLetters.list({ limit: 100 }));
    else if (cmd === 'recover') out(await heartbeats.recoverStale());
    else if (cmd === 'health') out(await health.health());
    else if (cmd === 'boot-report') out(await orchestrator.bootReport());
    else throw new Error('comando desconocido: ' + cmd);
  } catch (e) { out({ error: String(e && e.message) }); process.exitCode = 1; }
  try { await require('../database/client').close(); } catch { /* noop */ }
}
main();
