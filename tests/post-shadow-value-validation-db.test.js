// tests/post-shadow-value-validation-db.test.js — Checkpoint 2.2. runValidation: poblado de metadata
// (best sportsbook, counts verificados, edge decomposition, quality raw/max + diagnostic V2), aislamiento.
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
  const VM = require(R + '/sportsbook-providers/valueMetadata');
  const q = (s, p = []) => client.query(s, p);
  // ---- pure: bestBookForOutcome tie-break + edgeSourceCode ----
  {
    const sets = [
      { sportsbook: 'bookU', quotes: { home: { odds: 2.10 } }, provider_update: '2026-06-25T11:00:00Z' },
      { sportsbook: 'pinnacle', quotes: { home: { odds: 2.10 } }, provider_update: '2026-06-25T10:00:00Z' },
    ];
    const cat = { pinnacle: { verification_status: 'verified', sportsbook_name: 'Pinnacle' }, bookU: { verification_status: 'unverified' } };
    const b = VM.bestBookForOutcome(sets, 'home', cat);
    ok('best book: empate → verificada gana (pinnacle)', b.best_sportsbook_code === 'pinnacle' && b.odds === 2.10);
    ok('edge source MODEL', VM.edgeSourceCode(0.30, 0.25, 0.24) === 'MODEL_DISAGREEMENT');
    ok('edge source BEST_PRICE', VM.edgeSourceCode(0.252, 0.25, 0.22) === 'BEST_PRICE_DISPERSION');
    ok('edge source NO_ACTIONABLE', VM.edgeSourceCode(0.23, 0.25, 0.24) === 'NO_ACTIONABLE_EDGE');
  }
  async function linkedEvent(cei, ext, home, away, books) {
    for (const [book, qh, qd, qa] of books) for (const [slot, odd] of [['home', qh], ['draw', qd], ['away', qa]]) {
      await q(`INSERT INTO sportsbook_quote_current (data_provider,sportsbook_code,external_event_id,canonical_event_id,market_family,period,external_outcome_id,is_live,odds_decimal,quote_status,provider_update,observed_at,independence_group,metadata)
        VALUES ('the_odds_api',$1,$2,$3,'1x2','regulation',$4,false,$5,'open',$6,$6,$1,$7)`,
        [book, ext, cei, `${book}:${ext}:${slot}`, odd, NOW, JSON.stringify({ outcome_slot: slot, home_team: home, away_team: away, commence_time: '2026-07-10T18:00:00Z' })]);
    }
  }
  try {
    await migrate.up();
    await sc.seedAll('the_odds_api');
    const cei = (await q(`INSERT INTO canonical_events (event_type,sport,home_participant,away_participant) VALUES ('match','football','Spain','Brazil') RETURNING id`)).rows[0].id;
    // bet365 ofrece la mejor cuota home (2.20); pinnacle/draftkings verified
    await linkedEvent(cei, 'evv', 'Spain', 'Brazil', [['bet365', 2.20, 3.6, 3.9], ['pinnacle', 2.08, 3.7, 4.0], ['draftkings', 2.12, 3.55, 3.85]]);
    const gpResolver = () => ({ probabilities: { home: 0.55, draw: 0.24, away: 0.21 }, model_version: 'gp-core-1.4.0', sampleStatus: 'established', calibrationStatus: 'identity', data_quality: 0.7 });

    const res = await dr.runValidation({ provider: 'the_odds_api', now: NOW, gpResolver, evaluationMode: 'internal_validation' });
    ok('runValidation: evaluó 3 + metadata escrita', res.evaluated === 3 && res.metadata_written === 3, JSON.stringify(res.by_class));
    const home = (await q(`SELECT * FROM value_evaluations WHERE selection='home'`)).rows[0];
    ok('evaluation_mode = internal_validation', home.evaluation_mode === 'internal_validation');
    ok('registry/pick/public_eligible = false', home.registry_eligible === false && home.pick_candidate_eligible === false && home.public_eligible === false);
    ok('validation_run_id presente', !!home.validation_run_id);
    ok('best_sportsbook_code = bet365 (mejor cuota home 2.20)', home.best_sportsbook_code === 'bet365');
    ok('best_price coincide con best_decimal_odds', Number(home.best_decimal_odds) === 2.20);
    ok('verified_independence_group_count = 3 (no crudo)', home.verified_independence_group_count === 3);
    ok('raw/usable sportsbook counts', home.raw_sportsbook_count === 3 && home.usable_sportsbook_count === 3);
    ok('verified_sportsbook_count = 3', home.verified_sportsbook_count === 3);
    ok('edge_source_code presente', ['MODEL_DISAGREEMENT', 'BEST_PRICE_DISPERSION', 'HYBRID', 'NO_ACTIONABLE_EDGE'].includes(home.edge_source_code));
    ok('gp_vs_consensus_pp poblado', home.gp_vs_consensus_pp != null);
    ok('quality_raw/max/normalized poblados', home.quality_raw_points != null && Number(home.quality_max_points) === 110 && home.quality_normalized_percent != null);
    ok('quality_score legacy SIN CAMBIO (100)', home.quality_score === 100);
    const det = home.detail || {};
    ok('quality_diagnostic_v2 en detail', det.quality_diagnostic_v2_score != null && det.quality_diagnostic_v2_score < 100, 'v2=' + det.quality_diagnostic_v2_score);
    ok('best_price_comparables en detail', Array.isArray(det.best_price_comparables) && det.best_price_comparables.length === 3);
    // aislamiento
    ok('0 pick_candidates', (await q(`SELECT count(*)::int n FROM pick_candidates`)).rows[0].n === 0);
    ok('0 signals', (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === 0);
    ok('opportunities tagueadas internal_validation', (await q(`SELECT count(*)::int n FROM value_opportunities WHERE evaluation_mode='internal_validation' AND registry_eligible=false`)).rows[0].n >= 1);

    console.log(`\n[post-shadow-value-validation-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
