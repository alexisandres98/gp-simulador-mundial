// tests/post-shadow-v2-evaluator-db.test.js — Fase M.6 (shadow). V2 Evaluator de extremo a extremo:
// base V1 → Context Engine → Goal Engine → Knockout → snapshot V2 persistido (idempotente). No toca V1/Registry/Picks.
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const v2 = require(R + '/context-engine/v2Evaluator');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sum = v => v.home + v.draw + v.away;
const BASE = { home: 0.55, draw: 0.24, away: 0.21 };
const FACTORS = [{ factor_code: 'GK_FORM', category: 'player', home_logit_delta: -0.18, away_logit_delta: 0.12, confidence: 0.8 }];

(async () => {
  console.log('\n§M.6 EVALUACIÓN V2 (puro)');
  const e1 = v2.evaluate({ canonicalEventId: null, base1x2: BASE, factors: FACTORS, contextUncertainty: 0.3, lambdas: { home: 1.55, away: 0.95 } });
  ok('final V2 suma 1', close(sum(e1.final_probability_vector), 1));
  ok('contexto movió la probabilidad respecto a la base', !close(e1.final_probability_vector.home, BASE.home, 1e-3));
  ok('expone base + ajustes + pre-uncertainty + final (lineage §11)', !!e1.base_probability_vector && !!e1.context_adjustments && !!e1.pre_uncertainty_vector);
  ok('goles: incluye over_under + btts + markets', !!e1.goals && e1.goals.over_under.length === 5 && !!e1.goals.btts && e1.goals.markets.length > 0);
  ok('input_hash determinístico', e1.input_hash === v2.evaluate({ base1x2: BASE, factors: FACTORS, contextUncertainty: 0.3, lambdas: { home: 1.55, away: 0.95 } }).input_hash);

  console.log('\n§M.6 ELIMINATORIA');
  const ko = v2.evaluate({ base1x2: BASE, factors: [], contextUncertainty: 0, knockout: true });
  ok('mercado QUALIFY (no 1X2) y suma 1 entre equipos', ko.market_code === 'QUALIFY' && close(ko.qualify.team_a_qualifies + ko.qualify.team_b_qualifies, 1));

  console.log('\n§M.6 PERSISTENCIA (data layer M.2, idempotente)');
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/context-engine/repository');
  try {
    await migrate.up();
    const ev = (await client.query(`INSERT INTO canonical_events (event_type,home_participant,away_participant,scheduled_start,status,competition) VALUES ('match','Croatia','Ghana','2026-07-01T18:00:00Z','scheduled','FIFA World Cup') RETURNING id`)).rows[0].id;
    const e = v2.evaluate({ canonicalEventId: ev, base1x2: BASE, factors: FACTORS, contextUncertainty: 0.3, cutoffAt: '2026-07-01T15:00:00Z', lambdas: { home: 1.55, away: 0.95 } });
    const p1 = await v2.persist(e, { repo });
    ok('persist crea run + snapshot', !!p1.run.run_id && !!p1.snapshot.snapshot_id && p1.idempotent === false);
    const p2 = await v2.persist(e, { repo });
    ok('re-persist con mismo input_hash → idempotente (no duplica)', p2.idempotent === true && p2.snapshot.snapshot_id === p1.snapshot.snapshot_id);
    const cnt = (await client.query(`SELECT count(*)::int n FROM v2_probability_snapshots WHERE canonical_event_id=$1`, [ev])).rows[0].n;
    ok('una sola fila de snapshot para ese evento', cnt === 1);
    const stored = (await client.query(`SELECT final_probability_vector, context_state FROM v2_probability_snapshots WHERE snapshot_id=$1`, [p1.snapshot.snapshot_id])).rows[0];
    ok('snapshot guarda el vector final V2', stored.final_probability_vector && close(Number(stored.final_probability_vector.home) + Number(stored.final_probability_vector.draw) + Number(stored.final_probability_vector.away), 1, 1e-3));

    console.log('\n§M.6 INVARIANTES (no toca V1/Registry/Picks)');
    const inv = (await client.query(`SELECT (SELECT count(*) FROM signals)::int s,(SELECT count(*) FROM internal_picks)::int p,(SELECT count(*) FROM value_evaluations)::int v`)).rows[0];
    ok('no se creó Signal/Pick/value_evaluation', inv.s === 0 && inv.p === 0 && inv.v === 0);

    console.log(`\n[post-shadow-v2-evaluator-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
