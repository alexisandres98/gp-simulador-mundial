// arb-engine/cli.js — operación del motor de arbitraje (Sprint 3).
//   node arb-engine/cli.js once [--strategy=binary]
//   node arb-engine/cli.js status | verify | replay | inspect --evaluation=<id>
'use strict';
const cfg = require('./config');
const engine = require('./index');
const persist = require('./persist');
const client = require('../database/client');

function arg(name, def) { const m = process.argv.find(a => a.startsWith(`--${name}=`)); return m ? m.split('=')[1] : def; }

async function once() {
  const candidates = await require('./candidateGenerator').generateFromDB();
  const res = await engine.runShadow({ candidates });
  console.log(`Candidatos: ${res.counts.candidates} · clasificación:`, JSON.stringify(res.counts));
  if (res.persisted) console.log('Persistencia:', JSON.stringify(res.persisted)); else console.log('Dry-run (write off): no se persistió.');
}

async function status() {
  console.log('flags:', JSON.stringify({ engine: cfg.flags.engineEnabled, write: cfg.flags.writeEnabled, scheduler: cfg.flags.schedulerEnabled, autoPublication: cfg.flags.allowAutoPublication }));
  if (cfg.platform.db.configured) { try { console.log('counts:', JSON.stringify(await persist.counts())); } catch (e) { console.log('counts: n/a'); } }
}

async function verify() {
  if (!cfg.platform.db.configured) { console.log('DATABASE_URL no configurada.'); return; }
  const checks = [
    ['pure_arb con mapping no matched', `SELECT count(*)::int n FROM arb_evaluations WHERE classification='pure_arb' AND (rejection_reasons @> '["mapping_not_matched"]'::jsonb)`],
    ['evaluaciones sin engine_version', `SELECT count(*)::int n FROM arb_evaluations WHERE engine_version IS NULL`],
    ['legs sin evaluación (huérfanos)', `SELECT count(*)::int n FROM arb_evaluation_legs l LEFT JOIN arb_evaluations e ON e.id=l.evaluation_id WHERE e.id IS NULL`],
    ['net_roi fuera de rango (<-1 o >5)', `SELECT count(*)::int n FROM arb_evaluations WHERE net_roi < -1 OR net_roi > 5`],
    ['oportunidades sin observaciones', `SELECT count(*)::int n FROM arb_opportunities WHERE observation_count < 1`],
    ['runs abandonadas', `SELECT count(*)::int n FROM arb_engine_runs WHERE status='running' AND started_at < now() - interval '15 minutes'`],
  ];
  let problems = 0;
  for (const [label, sql] of checks) { try { const r = await client.query(sql); const n = r.rows[0].n; if (n) { problems += n; console.log(`  ⚠️  ${label}: ${n}`); } else console.log(`  ✓ ${label}: 0`); } catch (e) { console.log(`  ? ${label}: ${e.message}`); } }
  console.log(problems === 0 ? '\n✅ verify OK' : `\n⚠️ verify: ${problems} problema(s)`);
  process.exitCode = problems ? 1 : 0;
}

async function inspect() {
  const id = arg('evaluation', null);
  if (!id || !cfg.platform.db.configured) { console.log('Uso: --evaluation=<uuid> (con DATABASE_URL)'); return; }
  const e = await client.query('SELECT * FROM arb_evaluations WHERE id=$1', [id]);
  if (!e.rows.length) { console.log('No encontrada'); return; }
  const legs = await client.query('SELECT * FROM arb_evaluation_legs WHERE evaluation_id=$1 ORDER BY leg_index', [id]);
  console.log(JSON.stringify({ evaluation: e.rows[0], legs: legs.rows }, null, 2));
}

(async () => {
  const cmd = (process.argv[2] || 'status').toLowerCase();
  try {
    if (cmd === 'once') await once();
    else if (cmd === 'status') await status();
    else if (cmd === 'verify') await verify();
    else if (cmd === 'replay') console.log('replay: usar arb-engine/replay.js con histórico (requiere datos de Sprint 1).');
    else if (cmd === 'inspect') await inspect();
    else console.error('Comandos: once | status | verify | replay | inspect');
  } catch (e) { console.error('Error:', e.message); process.exitCode = 1; }
  finally { await client.close().catch(() => {}); }
})();
