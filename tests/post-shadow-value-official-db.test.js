// tests/post-shadow-value-official-db.test.js — Fase E. Write OFICIAL interno (value_evaluations) vía
// runOfficial: idempotencia, sin candidates (picks off), sin signals. PostgreSQL real (embedded).
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.VALUE_ENGINE_ENABLED = 'true';
process.env.VALUE_ENGINE_WRITE_ENABLED = 'true';
process.env.PICKS_ENABLED = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const NOW = '2026-06-25T12:00:00Z';

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const sc = require(R + '/sportsbook-providers/sourceCatalog');
  const dr = require(R + '/sportsbook-providers/valueDryRun');
  const q = (s, p = []) => client.query(s, p);
  async function linkedEvent(cei, ext, home, away, books) {
    for (const [book, ig, qh, qd, qa] of books) for (const [slot, odd] of [['home', qh], ['draw', qd], ['away', qa]]) {
      await q(`INSERT INTO sportsbook_quote_current
        (data_provider, sportsbook_code, external_event_id, canonical_event_id, market_family, period, external_outcome_id, is_live, odds_decimal, quote_status, provider_update, independence_group, metadata)
        VALUES ('the_odds_api',$1,$2,$3,'1x2','regulation',$4,false,$5,'open',$6,$7,$8)`,
        [book, ext, cei, `${book}:${ext}:${slot}`, odd, NOW, ig, JSON.stringify({ outcome_slot: slot, home_team: home, away_team: away, commence_time: '2026-07-10T18:00:00Z' })]);
    }
  }
  try {
    await migrate.up();
    await sc.seedAll('the_odds_api');
    const cei = (await q(`INSERT INTO canonical_events (event_type,sport,home_participant,away_participant) VALUES ('match','football','Spain','Brazil') RETURNING id`)).rows[0].id;
    await linkedEvent(cei, 'evx', 'Spain', 'Brazil', [['bet365', null, 2.10, 3.6, 3.9], ['pinnacle', null, 2.08, 3.7, 4.0], ['draftkings', null, 2.12, 3.55, 3.85]]);
    const gpResolver = () => ({ probabilities: { home: 0.55, draw: 0.24, away: 0.21 }, model_version: 'gp-core-1.4.0', sampleStatus: 'established', calibrationStatus: 'identity', data_quality: 0.7 });

    const r1 = await dr.runOfficial({ provider: 'the_odds_api', now: NOW, gpResolver });
    ok('write_enabled true', r1.write_enabled === true && r1.picks_enabled === false, JSON.stringify({ w: r1.write_enabled, p: r1.picks_enabled }));
    ok('evaluó 3 outcomes', r1.evaluated === 3, JSON.stringify(r1.by_class));
    const c1 = (await q(`SELECT count(*)::int n FROM value_evaluations`)).rows[0].n;
    ok('value_evaluations oficiales creadas', c1 === 3, `n=${c1}`);
    ok('0 pick_candidates (picks off)', (await q(`SELECT count(*)::int n FROM pick_candidates`)).rows[0].n === 0);
    ok('0 signals', (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === 0);

    // IDEMPOTENCIA: re-correr no duplica (input_hash)
    await dr.runOfficial({ provider: 'the_odds_api', now: NOW, gpResolver });
    const c2 = (await q(`SELECT count(*)::int n FROM value_evaluations`)).rows[0].n;
    ok('idempotente: re-run no duplica', c2 === c1, `${c1}->${c2}`);

    console.log(`\n[post-shadow-value-official-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
