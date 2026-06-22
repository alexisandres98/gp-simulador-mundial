// sportsbook-providers/cli.js — Sprint 8A. Solo lectura + ingesta manual. NUNCA imprime la API key.
// Uso: node sportsbook-providers/cli.js <status|health|once|sources>
'use strict';
const sb = require('./index');
function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
async function main() {
  const [cmd] = process.argv.slice(2);
  try {
    if (cmd === 'status' || !cmd) out(await sb.adminStatus());
    else if (cmd === 'health') out(await sb.health());
    else if (cmd === 'once') out(await sb.runOnce({}));
    else if (cmd === 'sources') out(await sb.repo.loadSourceCatalog(sb.cfg.params.providerName));
    else throw new Error('comando desconocido: ' + cmd);
  } catch (e) { out({ error: String(e && e.code || e && e.message || 'error') }); process.exitCode = 1; }
  try { await require('../database/client').close(); } catch { /* noop */ }
}
main();
