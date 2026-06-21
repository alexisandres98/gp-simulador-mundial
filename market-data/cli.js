// market-data/cli.js — utilidades de operación (Sprint 1).
//   node market-data/cli.js once [--provider=polymarket|kalshi] [--force]
//   node market-data/cli.js status
//   node market-data/cli.js verify
// 'once' ejecuta UN ciclo (respeta flags salvo --force). 'status' no escribe. 'verify' audita integridad.

'use strict';
const cfg = require('./config');
const pipeline = require('./pipeline');
const metrics = require('./metrics');
const client = require('../database/client');
const repos = require('../database/repositories');
const q = require('./repositories/queryRepository');

function arg(name, def) { const m = process.argv.find(a => a.startsWith(`--${name}=`)); if (m) return m.split('=')[1]; if (process.argv.includes(`--${name}`)) return true; return def; }

async function once() {
  if (!cfg.base.db.configured) { console.error('DATABASE_URL no configurada.'); process.exit(1); }
  const force = !!arg('force', false);
  const only = arg('provider', null);
  const providers = only ? [only] : cfg.PROVIDERS;
  for (const p of providers) {
    const res = await pipeline.runProviderCycle(p, { force });
    console.log(`[${p}]`, JSON.stringify(res));
    console.log(`  métricas:`, JSON.stringify(metrics.snapshot(p)));
  }
}

async function status() {
  if (!cfg.base.db.configured) { console.log('DATABASE_URL no configurada → capa inerte.'); return; }
  const counts = await q.getStorageCounts();
  console.log('Almacenamiento:', JSON.stringify(counts, null, 2));
  for (const p of cfg.PROVIDERS) {
    const prov = await repos.providers.findByCode(p);
    if (!prov) { console.log(`[${p}] sin registros aún`); continue; }
    const runs = await q.getRecentIngestionRuns(prov.id, 3);
    const tracked = await q.getTrackedMarkets(prov.id, 5);
    console.log(`[${p}] mercados rastreados: ${tracked.length}; runs recientes:`, runs.map(r => `${r.status}(${r.records_written}w)`).join(', '));
  }
}

// verify — chequeos de integridad (no repara). Devuelve exit 1 si hay problemas.
async function verify() {
  if (!cfg.base.db.configured) { console.error('DATABASE_URL no configurada.'); process.exit(1); }
  const checks = [
    ['normalized sin provider', `SELECT count(*)::int n FROM normalized_market_snapshots WHERE provider_id IS NULL`],
    ['normalized sin normalizer_version', `SELECT count(*)::int n FROM normalized_market_snapshots WHERE normalizer_version IS NULL OR normalizer_version=''`],
    ['orderbook huérfano (sin snapshot)', `SELECT count(*)::int n FROM normalized_orderbook_levels l LEFT JOIN normalized_market_snapshots s ON s.id=l.normalized_snapshot_id WHERE s.id IS NULL`],
    ['precios negativos', `SELECT count(*)::int n FROM normalized_orderbook_levels WHERE price < 0 OR size < 0`],
    ['bid > ask (mismo snapshot)', `SELECT count(*)::int n FROM normalized_market_snapshots WHERE best_bid IS NOT NULL AND best_ask IS NOT NULL AND best_bid > best_ask`],
    ['timestamps futuros absurdos', `SELECT count(*)::int n FROM normalized_market_snapshots WHERE provider_timestamp > now() + interval '1 day'`],
    ['raw sin normalized asociado', `SELECT count(*)::int n FROM raw_market_snapshots r LEFT JOIN normalized_market_snapshots s ON s.raw_snapshot_id=r.id WHERE s.id IS NULL AND r.external_outcome_id IS NOT NULL`],
    ['ingestion_runs abandonadas', `SELECT count(*)::int n FROM ingestion_runs WHERE status='running' AND started_at < now() - interval '15 minutes'`],
  ];
  let problems = 0;
  for (const [label, sql] of checks) {
    try { const r = await client.query(sql); const n = r.rows[0].n; if (n > 0) { problems += n; console.log(`  ⚠️  ${label}: ${n}`); } else console.log(`  ✓ ${label}: 0`); }
    catch (e) { console.log(`  ? ${label}: error (${e.message})`); }
  }
  console.log(problems === 0 ? '\n✅ verify OK (sin problemas)' : `\n⚠️ verify: ${problems} problema(s)`);
  process.exitCode = problems === 0 ? 0 : 1;
}

(async () => {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  try {
    if (cmd === 'once') await once();
    else if (cmd === 'status') await status();
    else if (cmd === 'verify') await verify();
    else { console.error('Comando: once | status | verify'); process.exitCode = 1; }
  } catch (e) { console.error('Error:', e.message); process.exitCode = 1; }
  finally { await client.close().catch(() => {}); }
})();
