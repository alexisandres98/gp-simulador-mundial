// canonical-graph/cli.js — operación del Canonical Event Graph (Sprint 2).
//   node canonical-graph/cli.js discover
//   node canonical-graph/cli.js match [--provider-a=polymarket --provider-b=kalshi]
//   node canonical-graph/cli.js status
//   node canonical-graph/cli.js verify
//   node canonical-graph/cli.js review-summary
'use strict';
const cfg = require('./config');
const index = require('./index');
const review = require('./review');
const repo = require('./repositories/graphRepository');
const metrics = require('./metrics');
const client = require('../database/client');
const dbRepos = require('../database/repositories');

function arg(name, def) { const m = process.argv.find(a => a.startsWith(`--${name}=`)); return m ? m.split('=')[1] : def; }

// carga el último payload raw por mercado de un proveedor (los payloads son objetos de mercado del proveedor)
// loadMarkets — fuente única en scheduler.js (lee metadata del catálogo: title + description=reglas, rápido).
const loadMarkets = providerCode => require('./scheduler').loadMarkets(providerCode);

async function runMatch(write) {
  const pa = arg('provider-a', 'polymarket'), pb = arg('provider-b', 'kalshi');
  const marketsA = await loadMarkets(pa), marketsB = await loadMarkets(pb);
  const res = index.matchProviders(marketsA, marketsB, pa, pb);
  console.log(`Descriptores: ${res.descriptorsA} (${pa}) / ${res.descriptorsB} (${pb}); candidatos: ${res.candidateCount}`);
  if (write) { const p = await review.persistResults(res.results, { providerA: pa, providerB: pb }); console.log('Persistencia:', JSON.stringify(p)); }
  else { res.results.forEach(r => metrics.recordResult(r)); console.log('Dry-run (no escribe). Métricas:', JSON.stringify(metrics.snapshot())); }
}

async function verify() {
  const checks = [
    ['matched con hard conflict (event)', `SELECT count(*)::int n FROM provider_event_mappings WHERE mapping_status='matched' AND (metadata->'hardConflicts') IS NOT NULL AND jsonb_array_length(COALESCE(metadata->'hardConflicts','[]'::jsonb)) > 0`],
    ['mappings de mercado sin canónico', `SELECT count(*)::int n FROM provider_market_mappings WHERE mapping_status='matched' AND canonical_market_id IS NULL`],
    ['eventos sin participantes', `SELECT count(*)::int n FROM canonical_events e WHERE NOT EXISTS (SELECT 1 FROM canonical_event_participants p WHERE p.canonical_event_id=e.id) AND e.event_type='match'`],
    ['mercados sin outcomes', `SELECT count(*)::int n FROM canonical_markets m WHERE NOT EXISTS (SELECT 1 FROM canonical_outcomes o WHERE o.canonical_market_id=m.id)`],
    ['rule snapshots sin fingerprint', `SELECT count(*)::int n FROM provider_market_rule_snapshots WHERE rules_fingerprint IS NULL`],
    ['mappings sin versión', `SELECT count(*)::int n FROM provider_market_mappings WHERE mapping_version IS NULL OR mapping_version=''`],
    ['review pendientes sin evidencia', `SELECT count(*)::int n FROM mapping_review_queue WHERE status='pending' AND evidence IS NULL`],
  ];
  let problems = 0;
  for (const [label, sql] of checks) {
    try { const r = await client.query(sql); const n = r.rows[0].n; if (n) { problems += n; console.log(`  ⚠️  ${label}: ${n}`); } else console.log(`  ✓ ${label}: 0`); }
    catch (e) { console.log(`  ? ${label}: ${e.message}`); }
  }
  // colisiones de alias (en memoria, no DB)
  const col = require('./participantAliases').collisions();
  if (col.length) { problems += col.length; console.log(`  ⚠️  alias ambiguos: ${col.join(', ')}`); } else console.log('  ✓ alias sin colisiones: 0');
  console.log(problems === 0 ? '\n✅ verify OK' : `\n⚠️ verify: ${problems} problema(s)`);
  process.exitCode = problems ? 1 : 0;
}

(async () => {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  try {
    if (!cfg.platform.db.configured && cmd !== 'help') { console.log('DATABASE_URL no configurada → grafo inerte.'); }
    if (cmd === 'discover') { await runMatch(false); }
    else if (cmd === 'match') { await runMatch(cfg.flags.writeEnabled); }
    else if (cmd === 'status') { if (cfg.platform.db.configured) console.log(JSON.stringify(await repo.statusCounts(), null, 2)); console.log('métricas:', JSON.stringify(metrics.snapshot())); }
    else if (cmd === 'verify') { await verify(); }
    else if (cmd === 'review-summary') { const pending = await repo.listReview('pending', 20); console.log(`Pendientes: ${pending.length}`); pending.slice(0, 10).forEach(p => console.log(`  [${p.entity_type}] ${p.external_id_a} ↔ ${p.external_id_b} score=${p.score} status=${p.status}`)); }
    else console.error('Comandos: discover | match | status | verify | review-summary');
  } catch (e) { console.error('Error:', e.message); process.exitCode = 1; }
  finally { await client.close().catch(() => {}); }
})();
