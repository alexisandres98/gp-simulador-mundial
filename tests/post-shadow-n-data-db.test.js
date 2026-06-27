// tests/post-shadow-n-data-db.test.js — Fase N (DB). Migración 034 up/down/re-up + persistencia shadow
// (goal snapshots, goal value, v2 shadow candidates, goal quotes) + forward-only en DB. No toca V1/Registry/Picks.
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const goalEngine = require(R + '/goal-engine/distribution');
const goalValue = require(R + '/goal-engine/goalValue');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const grepo = require(R + '/goal-engine/repository');
  const crepo = require(R + '/context-engine/repository');
  const q = (s, p = []) => client.query(s, p);
  const tablesN = async () => (await q(`SELECT table_name FROM information_schema.tables WHERE table_name IN
    ('v2_shadow_candidates','goal_model_snapshots','goal_value_shadow','sportsbook_goal_quote_current','sportsbook_goal_quote_history','goal_market_review_queue')`)).rows.length;
  try {
    await migrate.up();
    console.log('\n§N MIGRACIÓN 034');
    ok('UP: 6 tablas N creadas', (await tablesN()) === 6);
    ok('context_observations tiene columnas de timestamp hierarchy', (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='context_observations' AND column_name IN ('timestamp_quality','first_seen_at','provider_updated_at','last_seen_at','timestamp_confidence')`)).rows[0].n === 5);
    let rolls = 0; while ((await tablesN()) > 0 && rolls < 5) { await migrate.rollback(); rolls++; }
    ok('DOWN: 6 tablas N desaparecen', (await tablesN()) === 0);
    ok('DOWN: columnas timestamp revertidas', (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='context_observations' AND column_name='timestamp_quality'`)).rows[0].n === 0);
    await migrate.up();
    ok('RE-UP: 6 tablas N vuelven', (await tablesN()) === 6);

    console.log('\n§N FORWARD-ONLY EN DB (timestamp hierarchy)');
    const ev = (await q(`INSERT INTO canonical_events (event_type,home_participant,away_participant,scheduled_start,status,competition) VALUES ('match','Croatia','Ghana','2026-07-01T18:00:00Z','scheduled','FIFA World Cup') RETURNING id`)).rows[0].id;
    const CUT = '2026-07-01T15:00:00Z';
    // INGESTION_OBSERVED con first_seen ahora (posterior al cutoff pasado) → NO aplica (forward-only)
    const obsFut = await crepo.recordObservation({ factor_code: 'LINEUP', subject_type: 'team', subject_id: 'CRO', canonical_event_id: ev, source_name: 'api_football', observed_at: '2026-07-01T10:00:00Z', fact_or_inference: 'FACT', proposed_impact: 0.3 }, { cutoff: CUT, now: '2026-07-01T16:00:00Z' });
    ok('INGESTION con first_seen POSTERIOR al cutoff → applied_impact 0 (no retroactivo)', obsFut.applied_impact === 0 && obsFut.timestamp_quality === 'INGESTION_OBSERVED');
    // SOURCE_PUBLISHED pre-cutoff → aplica
    const obsOk = await crepo.recordObservation({ factor_code: 'GK_OUT', subject_type: 'player', subject_id: 'GHA_GK', canonical_event_id: ev, source_name: 'api_football', published_at: '2026-07-01T09:00:00Z', confidence: 1, fact_or_inference: 'FACT', proposed_impact: 0.2 }, { cutoff: CUT, policy: { max_logit_delta: 0.3 }, now: '2026-07-01T09:30:00Z' });
    ok('SOURCE_PUBLISHED pre-cutoff → aplica + quality correcta', obsOk.applied_impact > 0 && obsOk.timestamp_quality === 'SOURCE_PUBLISHED');

    console.log('\n§N PERSISTENCIA SHADOW DE GOLES');
    const g = goalEngine.goalModelOutput(1.55, 0.82);
    const gs = await grepo.recordGoalSnapshot({ canonical_event_id: ev, model_version: 'goal-engine-1.0.0', final_lambda_home: 1.55, final_lambda_away: 0.82, expected_total_goals: g.expected_total_goals, total_goals_distribution: g.total_goals_distribution, over_under: g.over_under, btts: g.btts, team_totals: g.team_totals, top_scorelines: g.top_scorelines, uncertainty: g.uncertainty, cutoff_at: CUT });
    ok('goal snapshot persistido', !!gs.row.goal_snapshot_id && gs.idempotent === false);
    const gs2 = await grepo.recordGoalSnapshot({ canonical_event_id: ev, model_version: 'goal-engine-1.0.0', final_lambda_home: 1.55, final_lambda_away: 0.82, cutoff_at: CUT });
    ok('goal snapshot idempotente por input_hash', gs2.idempotent === true && gs2.row.goal_snapshot_id === gs.row.goal_snapshot_id);
    const gvEval = goalValue.evaluate({ lambdaHome: 1.55, lambdaAway: 0.82, marketId: 'TOTAL_GOALS_OVER_2_5', marketFamily: 'match_total', consensusProb: 0.40, bestOdds: 2.6, groups: 4 });
    const gvRow = await grepo.recordGoalValue({ goal_snapshot_id: gs.row.goal_snapshot_id, canonical_event_id: ev, ...gvEval, cutoff_at: CUT });
    ok('goal value shadow persistido (shadow_only, no oficial)', gvRow.row.evaluation_mode === 'shadow_goal_value' && gvRow.row.registry_eligible === false && gvRow.row.pick_candidate_eligible === false);

    console.log('\n§N GOAL QUOTES + SHADOW CANDIDATE');
    const qrow = await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: 'pinnacle', external_event_id: 'ext-x', canonical_event_id: ev, market_family: 'match_total', line: 2.5, side: 'over', market_id: 'TOTAL_GOALS_OVER_2_5', odds_decimal: 1.95 });
    ok('goal quote upsert', !!qrow.id && Number(qrow.odds_decimal) === 1.95);
    const sc = await crepo.recordShadowCandidate({ canonical_event_id: ev, outcome: 'home', gp_probability: 0.56, classification: 'lean', context_state: 'PARTIAL_CONTEXT', cutoff_at: CUT });
    ok('v2 shadow candidate persistido (shadow_only)', !!sc.shadow_candidate_id && sc.shadow_only === true && sc.registry_eligible === false);

    console.log('\n§N INVARIANTES');
    const inv = (await q(`SELECT (SELECT count(*) FROM signals)::int s,(SELECT count(*) FROM internal_picks)::int p,(SELECT count(*) FROM value_evaluations)::int v`)).rows[0];
    ok('no se creó Signal/Pick/value_evaluation oficial', inv.s === 0 && inv.p === 0 && inv.v === 0);

    console.log(`\n[post-shadow-n-data-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
