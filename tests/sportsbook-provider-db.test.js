// tests/sportsbook-provider-db.test.js — Sprint 8A. Ingesta del proveedor contra PostgreSQL real
// (embedded-postgres) con provider INYECTADO (sin red/key). Migración 017, persistencia de cuotas 1X2,
// idempotencia, estado de cuota/circuit, catálogo de fuentes, quota crítica detiene, circuit open salta.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.SPORTSBOOK_PROVIDER_ENABLED = 'true';
process.env.SPORTSBOOK_PROVIDER_WRITE_ENABLED = 'true';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const now = Date.now();
const future = new Date(now + 3 * 3600 * 1000).toISOString();
const fresh = new Date(now - 30 * 1000).toISOString();
const mk = (book, lu = fresh) => ({ key: book, title: book, last_update: lu, markets: [{ key: 'h2h', last_update: lu, outcomes: [{ name: 'Argentina', price: 1.5 }, { name: 'Draw', price: 4.0 }, { name: 'Austria', price: 7.0 }] }] });
const event = (books) => ({ id: 'evt1', sport_key: 'soccer_fifa_world_cup', commence_time: future, home_team: 'Argentina', away_team: 'Austria', bookmakers: books });
function fakeProvider({ comps = [{ key: 'soccer_fifa_world_cup', active: true }], events, quota }) {
  return { discoverCompetitions: async () => comps, fetchQuotes: async () => ({ events, quota }), normalizeEvent: (e) => e, _redactKey: (s) => s };
}

(async () => {
  const h = await boot();
  const db = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/sportsbook-providers/repositories');
  const ingestion = require(R + '/sportsbook-providers/ingestion');

  try {
    await migrate.up();
    const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='sportsbook_quotes' AND column_name IN ('data_provider','jurisdiction','stake_limit_status','raw_implied_probability','ingestion_run_id')`);
    ok('migración 017: columnas nuevas en sportsbook_quotes', cols.rowCount === 5);
    const tbls = await db.query(`SELECT to_regclass('sportsbook_source_metadata') a, to_regclass('sportsbook_provider_state') b`);
    ok('migración 017: tablas catálogo + estado', tbls.rows[0].a && tbls.rows[0].b);

    // catálogo de fuentes
    await repo.upsertSource({ data_provider: 'the_odds_api', sportsbook_code: 'pinnacle', sportsbook_name: 'Pinnacle', operator_group: 'pinnacle', independence_group: 'g_pinnacle', source_role: 'sharp_reference' }, 'admin');
    const cat = await repo.loadSourceCatalog('the_odds_api');
    ok('catálogo: upsert + load source metadata', cat.pinnacle && cat.pinnacle.independence_group === 'g_pinnacle');

    // ingesta con write → persiste 3 cuotas (home/draw/away) de pinnacle
    const r1 = await ingestion.runOnce({ provider: fakeProvider({ events: [event([mk('pinnacle')])], quota: { remaining: 480, used: 20, lastCost: 2 } }), now });
    ok('ingesta: status ok + 3 cuotas persistidas', r1.status === 'ok' && r1.quotes === 3 && r1.books_complete === 1);
    const cnt = await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE metadata->>'outcome_slot'='draw')::int d FROM sportsbook_quotes WHERE external_event_id='evt1'`);
    ok('ingesta: cuotas en DB con outcome_slot draw', cnt.rows[0].n === 3 && cnt.rows[0].d === 1);
    const indep = await db.query(`SELECT independence_group FROM sportsbook_quotes WHERE sportsbook_code='pinnacle' LIMIT 1`);
    ok('ingesta: independence_group del catálogo aplicado', indep.rows[0].independence_group === 'g_pinnacle');

    // estado de cuota persistido
    const st = await repo.getState('the_odds_api');
    ok('ingesta: estado de cuota actualizado', st && st.requests_remaining === 480 && st.provider_status === 'ok' && st.circuit_state === 'closed');

    // idempotencia: re-insertar las MISMAS filas con el mismo run no duplica
    const FIXED_RUN = '00000000-0000-0000-0000-000000000001';
    const rows = require(R + '/sportsbook-providers/normalizer').setsToQuoteRows(
      require(R + '/sportsbook-providers/normalizer').buildSetsForEvent(event([mk('pinnacle')]), { now, catalog: cat }).sets, FIXED_RUN);
    const i1 = await repo.insertQuotes(rows); const i2 = await repo.insertQuotes(rows);
    ok('idempotencia: segunda inserción del mismo run no duplica', i1 === 3 && i2 === 0);

    // quota crítica detiene la ingesta (2 competiciones, cuota crítica tras la 1ª)
    const r2 = await ingestion.runOnce({ provider: fakeProvider({ comps: [{ key: 'a', active: true }, { key: 'b', active: true }], events: [event([mk('pinnacle')])], quota: { remaining: 2, used: 998, lastCost: 2 } }), now });
    ok('quota crítica: ingesta parcial y se detiene', r2.status === 'partial' && r2.reason === 'quota_reserve');

    // circuit open → salta sin llamar
    await repo.upsertState('the_odds_api', { provider_status: 'down', circuit_state: 'open', circuit_opened_at: new Date(now).toISOString(), consecutive_failures: 5 });
    const r3 = await ingestion.runOnce({ provider: fakeProvider({ events: [event([mk('pinnacle')])], quota: { remaining: 400 } }), now });
    ok('circuit open: ingesta saltada', r3.status === 'skipped' && r3.reason === 'circuit_open');

    // disabled → inerte
    process.env.SPORTSBOOK_PROVIDER_ENABLED = 'false';
    const r4 = await ingestion.runOnce({ provider: fakeProvider({ events: [], quota: {} }), now });
    ok('inerte: SPORTSBOOK_PROVIDER_ENABLED off → disabled', r4.status === 'disabled');
    process.env.SPORTSBOOK_PROVIDER_ENABLED = 'true';
  } catch (e) {
    fail++; console.log('  ✗ excepción', e && e.stack || e);
  } finally {
    try { await db.close(); } catch { /* noop */ }
    await h.stop();
  }
  console.log(`\nsportsbook-provider-db: ${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
})();
