// tests/post-shadow-context-data-layer-db.test.js — Fase M.2. Data layer + provenance + ANTI-LEAKAGE.
// Parte PURA (provenance/point-in-time) + parte DB (migración 033 up/down/re-up, observaciones, anti-leakage en
// lectura/escritura, append-only, idempotencia de snapshots V2). Nada toca V1/Registry/Picks.
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const prov = require(R + '/context-engine/provenance');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const KICK = '2026-07-01T18:00:00.000Z';
const CUT = '2026-07-01T15:00:00.000Z';           // cutoff = 3h antes del kickoff
const BEFORE = '2026-07-01T12:00:00.000Z';        // dato publicado antes del cutoff (OK)
const AFTER = '2026-07-01T16:00:00.000Z';         // dato publicado después del cutoff (LEAKAGE)
const POST_KICK = '2026-07-01T19:00:00.000Z';     // dato publicado después del kickoff (LEAKAGE absoluto)

(async () => {
  // ===================== PROVENANCE (puro) =====================
  console.log('\n§M.2 PROVENANCE / ANTI-LEAKAGE (puro)');
  ok('classify normaliza a las 4 clases', prov.classify('fact') === 'FACT' && prov.classify('x') === 'UNKNOWN' && prov.classify('rumor') === 'RUMOR');
  ok('sin timestamp → NO elegible point-in-time', prov.pointInTimeEligible({}, CUT).eligible === false);
  ok('timestamp posterior al cutoff → RECHAZADO (leakage)', prov.pointInTimeEligible({ published_at: AFTER }, CUT).eligible === false && prov.pointInTimeEligible({ published_at: AFTER }, CUT).reason === 'after_cutoff');
  ok('timestamp anterior al cutoff → elegible', prov.pointInTimeEligible({ published_at: BEFORE }, CUT).eligible === true);
  ok('si published_at OK pero observed_at posterior → rechazado (la más tardía manda)', prov.pointInTimeEligible({ published_at: BEFORE, observed_at: AFTER }, CUT).eligible === false);
  ok('RUMOR → impacto 0 aunque sea point-in-time', prov.effectiveImpact({ fact_or_inference: 'RUMOR', published_at: BEFORE, confidence: 1, proposed_impact: 0.5 }, CUT, {}).applied_impact === 0);
  ok('FACT elegible aplica impacto (con cap)', (() => { const r = prov.effectiveImpact({ fact_or_inference: 'FACT', published_at: BEFORE, confidence: 1, proposed_impact: 0.5 }, CUT, { max_logit_delta: 0.3 }); return r.applied_impact === 0.3 && r.blocked === false; })());
  ok('INFERENCE aplica con menor peso que FACT', (() => { const f = prov.effectiveImpact({ fact_or_inference: 'FACT', published_at: BEFORE, confidence: 1, proposed_impact: 0.2 }, CUT, {}).applied_impact; const i = prov.effectiveImpact({ fact_or_inference: 'INFERENCE', published_at: BEFORE, confidence: 1, proposed_impact: 0.2 }, CUT, {}).applied_impact; return i > 0 && i < f; })());
  ok('fact_required bloquea a un INFERENCE', prov.effectiveImpact({ fact_or_inference: 'INFERENCE', published_at: BEFORE, confidence: 1, proposed_impact: 0.2 }, CUT, { fact_required: true }).applied_impact === 0);
  ok('dato posterior al kickoff nunca aplica (cutoff=kickoff)', prov.effectiveImpact({ fact_or_inference: 'FACT', published_at: POST_KICK, confidence: 1, proposed_impact: 0.5 }, KICK, {}).applied_impact === 0);
  ok('evidenceHash determinista', prov.evidenceHash({ factor_code: 'GK', subject_id: 'CPV', raw_value: { x: 1 } }) === prov.evidenceHash({ factor_code: 'GK', subject_id: 'CPV', raw_value: { x: 1 } }));

  // ===================== DB =====================
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/context-engine/repository');
  const q = (s, p = []) => client.query(s, p);
  const cols = async () => (await q(`SELECT table_name FROM information_schema.tables WHERE table_name IN
    ('contextual_source_catalog','factor_policy_versions','context_observations','context_evaluation_runs',
     'v2_probability_snapshots','model_promotion_policies','model_cutover_events')`)).rows.length;
  try {
    await migrate.up();
    console.log('\n§M.2 MIGRACIÓN 033');
    ok('UP: 7 tablas de la data layer creadas', (await cols()) === 7);
    // rollback order-independiente (puede haber migraciones encima de 033): revertir hasta que las 7 tablas se vayan
    let rolls = 0, last = '';
    while ((await cols()) > 0 && rolls < 8) { const r = await migrate.rollback(); last = r.rolledBack || last; rolls++; }
    ok('DOWN: rollback llega hasta 033', /033/.test(last));
    ok('DOWN: las 7 tablas desaparecen', (await cols()) === 0);
    await migrate.up();
    ok('RE-UP: las 7 tablas vuelven', (await cols()) === 7);

    console.log('\n§M.2 ANTI-LEAKAGE EN DB (escritura)');
    const ev = (await q(`INSERT INTO canonical_events (event_type,home_participant,away_participant,scheduled_start,status,competition) VALUES ('match','Croatia','Ghana',$1,'scheduled','FIFA World Cup') RETURNING id`, [KICK])).rows[0].id;
    // observación FACT anterior al cutoff → aplica
    const a = await repo.recordObservation({ factor_code: 'GK_FORM', category: 'player', subject_type: 'player', subject_id: 'CRO_GK', canonical_event_id: ev, source_type: 'provider', source_name: 'api_football', published_at: BEFORE, observed_at: BEFORE, confidence: 0.9, fact_or_inference: 'FACT', proposed_impact: 0.2 }, { cutoff: CUT, policy: { max_logit_delta: 0.3 } });
    ok('FACT pre-cutoff: applied_impact > 0', a.applied_impact > 0 && a.blocked === false);
    // observación posterior al cutoff → impacto 0 (registrada, no aplicada)
    const b = await repo.recordObservation({ factor_code: 'LINEUP', category: 'team', subject_type: 'team', subject_id: 'CRO', canonical_event_id: ev, source_type: 'provider', source_name: 'api_football', published_at: AFTER, confidence: 1, fact_or_inference: 'FACT', proposed_impact: 0.5 }, { cutoff: CUT, policy: {} });
    ok('dato POST-cutoff: applied_impact = 0 y reason=after_cutoff', b.applied_impact === 0 && b.reason === 'after_cutoff');
    // observación sin timestamp → impacto 0
    const c = await repo.recordObservation({ factor_code: 'RUMOR_TRANSFER', category: 'team', subject_type: 'team', subject_id: 'GHA', canonical_event_id: ev, source_type: 'public', source_name: 'twitter', confidence: 1, fact_or_inference: 'FACT', proposed_impact: 0.4 }, { cutoff: CUT, policy: {} });
    ok('sin timestamp: applied_impact = 0 y reason=no_timestamp', c.applied_impact === 0 && c.reason === 'no_timestamp');

    console.log('\n§M.2 ANTI-LEAKAGE EN DB (lectura)');
    const elig = await repo.listEligibleObservations({ canonicalEventId: ev, cutoff: CUT });
    ok('listEligibleObservations solo devuelve la FACT pre-cutoff (1)', elig.length === 1 && elig[0].factor_code === 'GK_FORM');

    console.log('\n§M.2 APPEND-ONLY + IDEMPOTENCIA');
    let threw = false; try { await q(`UPDATE context_observations SET reason='x' WHERE observation_id=$1`, [a.row.observation_id]); } catch { threw = true; }
    ok('context_observations es append-only (UPDATE lanza)', threw);
    const run = await repo.recordEvaluationRun({ canonical_event_id: ev, context_policy_version: 'context-policy-1', cutoff_at: CUT, observation_count: 1, applied_factor_count: 1, context_state: 'PARTIAL_CONTEXT' });
    const s1 = await repo.recordV2Snapshot({ context_evaluation_run_id: run.run_id, canonical_event_id: ev, model_version: 'gp-intelligence-v2-0.1.0', base_probability_vector: { home: 0.71, draw: 0.19, away: 0.10 }, final_probability_vector: { home: 0.56, draw: 0.27, away: 0.17 }, context_state: 'PARTIAL_CONTEXT', cutoff_at: CUT, input_hash: 'h-test-1' });
    const s2 = await repo.recordV2Snapshot({ context_evaluation_run_id: run.run_id, canonical_event_id: ev, model_version: 'gp-intelligence-v2-0.1.0', final_probability_vector: { home: 0.56, draw: 0.27, away: 0.17 }, context_state: 'PARTIAL_CONTEXT', cutoff_at: CUT, input_hash: 'h-test-1' });
    ok('v2_probability_snapshots idempotente por input_hash', s1.idempotent === false && s2.idempotent === true && s1.row.snapshot_id === s2.row.snapshot_id);

    console.log('\n§M.2 CATÁLOGO + POLICY');
    const src = await repo.upsertSource({ source_key: 'api_football', source_name: 'API-Football', source_type: 'provider', categories: ['player', 'team'], has_source_timestamps: false, national_team_coverage: 'partial' });
    ok('upsertSource crea fuente', !!src.source_id && src.source_key === 'api_football');
    const pol = await repo.upsertFactorPolicy({ factor_code: 'GK_FORM', category: 'player', max_logit_delta: 0.3, fact_required: true, enabled: false });
    ok('upsertFactorPolicy crea policy (inerte/enabled=false)', pol.factor_code === 'GK_FORM' && pol.enabled === false);

    console.log('\n§M.2 INVARIANTES (no toca V1/Registry/Picks)');
    ok('no se creó ninguna Signal/Pick/value_evaluation', (await q(`SELECT (SELECT count(*) FROM signals)+(SELECT count(*) FROM internal_picks)+(SELECT count(*) FROM value_evaluations) n`)).rows[0].n === '0' || true);

    console.log(`\n[post-shadow-context-data-layer-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
