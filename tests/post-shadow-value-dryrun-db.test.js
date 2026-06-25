// tests/post-shadow-value-dryrun-db.test.js — Post-shadow Bloques H (sets), I (outliers), J (verified
// independence), K (Value dry-run desacoplado de write, sin escrituras oficiales).
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.VALUE_ENGINE_ENABLED = 'true';
process.env.VALUE_ENGINE_WRITE_ENABLED = 'false';   // DRY-RUN
process.env.VALUE_SHADOW_RUNS_ENABLED = 'true';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const NOW = '2026-06-25T12:00:00Z';

(async () => {
  // ===== H (puro): sets sincronizados =====
  const setAssembly = require(R + '/sportsbook-providers/setAssembly');
  const mk = (book, slot, odds, over = {}) => ({ sportsbook_code: book, external_outcome_id: `${book}:ev:${slot}`, odds_decimal: odds, quote_status: over.status || 'open', is_live: over.live || false, provider_update: over.pu || NOW, period: 'regulation', independence_group: over.ig || book });
  let a = setAssembly.assembleSets([mk('A', 'home', 2.0), mk('A', 'draw', 3.5), mk('A', 'away', 4.0)], { now: NOW });
  ok('H: set 1X2 completo', a.sets.length === 1 && a.rejected.length === 0);
  a = setAssembly.assembleSets([mk('A', 'home', 2.0), mk('A', 'away', 4.0)], { now: NOW });
  ok('H: draw ausente → rejected missing_draw', a.sets.length === 0 && a.rejected[0].reason === 'missing_draw');
  a = setAssembly.assembleSets([mk('A', 'home', 2.0), mk('A', 'draw', 3.5), mk('A', 'away', 4.0, { status: 'suspended' })], { now: NOW });
  ok('H: outcome suspended → rejected', a.rejected[0].reason === 'suspended');
  a = setAssembly.assembleSets([mk('A', 'home', 2.0, { live: true }), mk('A', 'draw', 3.5), mk('A', 'away', 4.0)], { now: NOW });
  ok('H: live → rejected', a.rejected[0].reason === 'live');
  a = setAssembly.assembleSets([mk('A', 'home', 2.0, { pu: '2026-06-25T12:00:00Z' }), mk('A', 'draw', 3.5, { pu: '2026-06-25T12:05:00Z' }), mk('A', 'away', 4.0, { pu: NOW })], { now: NOW, maxSkewMs: 60000 });
  ok('H: skew excesivo → rejected', a.rejected[0].reason === 'excessive_skew');
  a = setAssembly.assembleSets([mk('A', 'home', 2.0, { pu: '2026-06-25T10:00:00Z' }), mk('A', 'draw', 3.5, { pu: '2026-06-25T10:00:00Z' }), mk('A', 'away', 4.0, { pu: '2026-06-25T10:00:00Z' })], { now: NOW, maxAgeMs: 600000 });
  ok('H: stale → rejected', a.rejected[0].reason === 'stale');

  // ===== I (puro): outliers semánticos (caso Bosnia) =====
  const outliers = require(R + '/sportsbook-providers/outliers');
  const set = (book, h, d, aw) => ({ sportsbook: book, quotes: { home: { odds: h }, draw: { odds: d }, away: { odds: aw } } });
  // 2 books normales (favorito local) + 1 invertido (home↔away)
  let od = outliers.detectOutliers([set('A', 1.25, 6.0, 11.0), set('B', 1.27, 5.8, 10.5), set('C', 11.0, 6.0, 1.25)]);
  ok('I: detecta inversión Bosnia', od.outliers.length === 1 && od.outliers[0].sportsbook === 'C' && od.outliers[0].reason === 'home_away_inversion', JSON.stringify(od.outliers));
  ok('I: outlier sin resolver → hasUnresolved', od.hasUnresolved === true);
  ok('I: limpia conserva los 2 buenos', od.clean.length === 2);
  od = outliers.detectOutliers([set('A', 1.95, 3.6, 4.0), set('B', 1.97, 3.5, 3.9), set('C', 1.93, 3.7, 4.1)]);
  ok('I: sin outliers cuando concuerdan', od.outliers.length === 0 && od.clean.length === 3);

  // ===== K (DB): Value dry-run sin escrituras oficiales =====
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const sourceCatalog = require(R + '/sportsbook-providers/sourceCatalog');
  const dryRun = require(R + '/sportsbook-providers/valueDryRun');
  const q = (s, p = []) => client.query(s, p);
  // inserta current state YA enlazado a canonical (simula mapping aprobado)
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
    await sourceCatalog.seedAll('the_odds_api');  // bet365/pinnacle/draftkings = verified, grupos distintos
    const cei1 = (await q(`INSERT INTO canonical_events (event_type, sport, home_participant, away_participant) VALUES ('match','football','Spain','Brazil') RETURNING id`)).rows[0].id;
    // 3 grupos verificados; home con value vs consenso
    await linkedEvent(cei1, 'ev1', 'Spain', 'Brazil', [
      ['bet365', null, 2.10, 3.6, 3.9], ['pinnacle', null, 2.08, 3.7, 4.0], ['draftkings', null, 2.12, 3.55, 3.85],
    ]);
    // evento con outlier (inversión) → STRONG bloqueado
    const cei2 = (await q(`INSERT INTO canonical_events (event_type, sport, home_participant, away_participant) VALUES ('match','football','France','Argentina') RETURNING id`)).rows[0].id;
    await linkedEvent(cei2, 'ev2', 'France', 'Argentina', [
      ['bet365', null, 1.25, 6.0, 11.0], ['pinnacle', null, 1.27, 5.8, 10.5], ['draftkings', null, 11.0, 6.0, 1.25],
    ]);

    const gpResolver = (e) => e.canonicalEventId === cei1
      ? { probabilities: { home: 0.62, draw: 0.22, away: 0.16 }, model_version: 'gp-core-1.4.0', sampleStatus: 'established', calibrationStatus: 'identity', data_quality: 0.7 }
      : null;

    const res = await dryRun.runDryRun({ provider: 'the_odds_api', now: NOW, gpResolver });
    ok('K: dry-run evaluó outcomes', res.evaluated >= 6, JSON.stringify({ evaluated: res.evaluated }));
    ok('K: produjo clasificaciones', (res.pass + res.watch + res.lean + res.strong) >= 1, JSON.stringify(res));
    // GARANTÍA: cero escrituras oficiales
    ok('K: 0 value_evaluations oficiales', (await q(`SELECT count(*)::int n FROM value_evaluations`)).rows[0].n === 0);
    ok('K: 0 value_opportunities', (await q(`SELECT count(*)::int n FROM value_opportunities`)).rows[0].n === 0);
    ok('K: 0 pick_candidates', (await q(`SELECT count(*)::int n FROM pick_candidates`)).rows[0].n === 0);
    ok('K: 0 señales', (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === 0);
    // SÍ escribió shadow
    ok('K: shadow run escrito', (await q(`SELECT count(*)::int n FROM sportsbook_value_shadow_runs`)).rows[0].n === 1);
    ok('K: shadow evaluations escritas', (await q(`SELECT count(*)::int n FROM sportsbook_value_shadow_evaluations`)).rows[0].n === res.evaluated);
    // I integrado: evento con inversión → ese evento no produce STRONG (criticalContradiction)
    const ev2strong = (await q(`SELECT count(*)::int n FROM sportsbook_value_shadow_evaluations WHERE external_event_id='ev2' AND classification='strong'`)).rows[0].n;
    ok('I+K: evento con outlier → 0 STRONG', ev2strong === 0);
    // J integrado: verified groups reportados
    ok('J: verified independence groups reportados (3)', (await q(`SELECT max(verified_independence_groups)::int n FROM sportsbook_value_shadow_evaluations WHERE external_event_id='ev1'`)).rows[0].n === 3);

    console.log(`\n[post-shadow-value-dryrun-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
