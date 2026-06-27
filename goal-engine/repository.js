// goal-engine/repository.js — Fase N. Persistencia SHADOW de goles: goal_model_snapshots, goal_value_shadow,
// sportsbook_goal_quote_current. INERTE (nada lo invoca desde el pipeline). Idempotente por input_hash.
'use strict';
const crypto = require('crypto');
const db = require('../database/client');
const hash = o => 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

async function recordGoalSnapshot(s, { client = db } = {}) {
  const input_hash = s.input_hash || hash({ ev: s.canonical_event_id, mv: s.model_version, lh: s.final_lambda_home, la: s.final_lambda_away, cut: s.cutoff_at });
  const ins = await client.query(
    `INSERT INTO goal_model_snapshots
       (canonical_event_id,model_version,period_code,base_lambda_home,base_lambda_away,context_lambda_home,
        context_lambda_away,final_lambda_home,final_lambda_away,expected_total_goals,scoreline_matrix_hash,
        total_goals_distribution,over_under,btts,team_totals,top_scorelines,uncertainty,data_completeness,
        factor_lineage,cutoff_at,input_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
    [s.canonical_event_id || null, s.model_version, s.period_code || 'REGULATION', s.base_lambda_home ?? null,
     s.base_lambda_away ?? null, s.context_lambda_home ?? null, s.context_lambda_away ?? null, s.final_lambda_home,
     s.final_lambda_away, s.expected_total_goals ?? null, s.scoreline_matrix_hash || null,
     JSON.stringify(s.total_goals_distribution || null), JSON.stringify(s.over_under || null), JSON.stringify(s.btts || null),
     JSON.stringify(s.team_totals || null), JSON.stringify(s.top_scorelines || null), JSON.stringify(s.uncertainty || null),
     s.data_completeness ?? null, JSON.stringify(s.factor_lineage || []), s.cutoff_at || null, input_hash]);
  if (ins.rows[0]) return { row: ins.rows[0], idempotent: false };
  const ex = await client.query(`SELECT * FROM goal_model_snapshots WHERE input_hash=$1`, [input_hash]);
  return { row: ex.rows[0], idempotent: true };
}

async function recordGoalValue(v, { client = db } = {}) {
  const input_hash = v.input_hash || hash({ ev: v.canonical_event_id, m: v.market_id, gp: v.gp_probability, odds: v.best_decimal_odds, cut: v.cutoff_at });
  const ins = await client.query(
    `INSERT INTO goal_value_shadow
       (goal_snapshot_id,canonical_event_id,market_id,market_family,period_code,gp_probability,
        market_consensus_probability,best_decimal_odds,break_even_probability,raw_edge_pp,conservative_probability,
        adjusted_edge_pp,adjusted_ev,uncertainty,line_probability_sensitivity,classification,evaluation_mode,
        goal_value_policy_version,cutoff_at,input_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
    [v.goal_snapshot_id || null, v.canonical_event_id || null, v.market_id, v.market_family, v.period_code || 'REGULATION',
     v.gp_probability ?? null, v.market_consensus_probability ?? null, v.best_decimal_odds ?? null, v.break_even_probability ?? null,
     v.raw_edge_pp ?? null, v.conservative_probability ?? null, v.adjusted_edge_pp ?? null, v.adjusted_ev ?? null,
     v.uncertainty ?? null, JSON.stringify(v.line_probability_sensitivity || null), v.classification || null,
     v.evaluation_mode || 'shadow_goal_value', v.goal_value_policy_version || 'goal-value-policy-shadow-1',
     v.cutoff_at || null, input_hash]);
  if (ins.rows[0]) return { row: ins.rows[0], idempotent: false };
  const ex = await client.query(`SELECT * FROM goal_value_shadow WHERE input_hash=$1`, [input_hash]);
  return { row: ex.rows[0], idempotent: true };
}

async function upsertGoalQuote(q, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO sportsbook_goal_quote_current
       (data_provider,sportsbook_code,external_event_id,canonical_event_id,market_family,period,line,side,team_scope,
        market_id,odds_decimal,implied_probability,quote_status,is_live,provider_update,observed_at,ingestion_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16)
     ON CONFLICT (data_provider,sportsbook_code,external_event_id,market_family,period,line,side,team_scope)
     DO UPDATE SET odds_decimal=EXCLUDED.odds_decimal, implied_probability=EXCLUDED.implied_probability,
       quote_status=EXCLUDED.quote_status, is_live=EXCLUDED.is_live, provider_update=EXCLUDED.provider_update,
       observed_at=now() RETURNING *`,
    [q.data_provider, q.sportsbook_code, q.external_event_id, q.canonical_event_id || null, q.market_family, q.period || 'regulation_90m',
     q.line ?? null, q.side, q.team_scope || null, q.market_id || null, q.odds_decimal ?? null, q.implied_probability ?? null,
     q.quote_status || 'open', !!q.is_live, q.provider_update || null, q.ingestion_run_id || null]);
  return r.rows[0];
}

module.exports = { recordGoalSnapshot, recordGoalValue, upsertGoalQuote };
