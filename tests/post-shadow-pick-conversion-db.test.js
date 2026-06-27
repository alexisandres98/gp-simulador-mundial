// tests/post-shadow-pick-conversion-db.test.js — Fase K.1 §10. Conversión MANUAL/ATÓMICA Candidate→Pick+Signal.
// DB efímera + servicios/repos reales. Revalidación, atomicidad, rollback, idempotencia, labels español, no-publish.
'use strict';
process.env.DB_SSL = 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true'; process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00.000Z';
process.env.VALUE_ENGINE_ENABLED = 'true'; process.env.VALUE_ENGINE_WRITE_ENABLED = 'true';
process.env.METRICS_ENGINE_ENABLED = 'true';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const crypto = require('crypto');

const KICK = '2026-12-01T18:00:00.000Z';
const NOW = +new Date(KICK) - 3 * 3600 * 1000;

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const RA = require(R + '/signal-registry/registryAdmin');
  const rr = require(R + '/signal-registry/resultResolver');
  const cf = require(R + '/value-engine/candidateFactory');
  const conv = require(R + '/value-engine/pickConversion');
  const verifier = require(R + '/signal-registry/verifier');
  const sourceCatalog = require(R + '/sportsbook-providers/sourceCatalog');
  const q = (s, p = []) => client.query(s, p);

  let n = 0;
  async function mkEvent(home = 'Croatia', away = 'Ghana', kickoff = KICK) {
    n++; return (await q(`INSERT INTO canonical_events (event_type,home_participant,away_participant,scheduled_start,status,competition) VALUES ('match',$1,$2,$3,'scheduled','FIFA World Cup') RETURNING id`, [home, away, kickoff])).rows[0].id;
  }
  // 3 evaluaciones (home strong + cand-eligible, draw/away pass) con gp_probability para el vector
  async function mkEvals(ev, { minOdds = 1.86, bestOdds = 1.99, cls = 'strong', candElig = true, model = 'gp-core-1.4.0' } = {}) {
    const mk = (sel, c, gp, ce) => q(`INSERT INTO value_evaluations (canonical_event_id, selection, classification, gp_probability, sportsbook_consensus_probability, conservative_probability, best_decimal_odds, minimum_acceptable_odds, adjusted_edge_pp, adjusted_ev, uncertainty_score, quality_score, model_version, classification_version, evaluation_mode, pick_candidate_eligible, best_sportsbook_code, verified_independence_group_count, edge_source_code, strong_blockers, input_hash)
      VALUES ($1,$2,$3,$4,0.505,0.548,$5,$6,0.045,0.09,38,99,$7,'classify-1','internal_operational',$8,'pinnacle',6,'MODEL_DISAGREEMENT','[]',$9)`,
      [ev, sel, c, gp, bestOdds, minOdds, model, ce, 'h' + crypto.randomBytes(6).toString('hex')]);
    await mk('home', cls, 0.712, candElig); await mk('draw', 'pass', 0.18, false); await mk('away', 'pass', 0.108, false);
  }
  async function mkQuote(ev, outcome, odds, book = 'pinnacle', upd = new Date(NOW - 60000).toISOString()) {
    await q(`INSERT INTO sportsbook_quote_current (data_provider,sportsbook_code,external_event_id,market_family,period,external_outcome_id,independence_group,canonical_event_id,is_live,odds_decimal,quote_status,provider_update,observed_at) VALUES ('the_odds_api',$1,$2,'1x2','regulation_90m',$3,$4,$5,false,$6,'open',$7,$7)`, [book, 'ext-' + ev, outcome, 'g-' + book, ev, odds, upd]);
  }
  const candOf = async (ev) => (await q(`SELECT candidate_id, candidate_lifecycle FROM candidate_factory WHERE canonical_event_id=$1`, [ev])).rows[0];
  // construye un candidate READY completo
  async function readyCandidate(opts = {}) {
    const ev = await mkEvent(opts.home, opts.away, opts.kickoff);
    await mkEvals(ev, opts);
    await mkQuote(ev, 'home', opts.bestOdds || 1.99, 'pinnacle', opts.quoteUpd);
    if (opts.espn !== false) await rr.upsertFixtureMapping({ canonicalEventId: ev, fixtureId: 'FX' + n, espnId: '7604' + n, isKnockout: false, resolvedBy: 'admin@test' });
    await cf.run({ now: opts.now || NOW });
    return { ev, cand: await candOf(ev) };
  }
  const SUP = { adminId: 'admin@test', superadmin: true, reason: 'revisión humana ok', reviewNote: 'auditado', now: NOW };

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });
    for (const [code, grp] of [['pinnacle', 'gP']]) await sourceCatalog.upsertSource({ data_provider: 'the_odds_api', sportsbook_code: code, independence_group: grp, verification_status: 'verified' });

    // ===================== §10.16-19 LABELS (puro) =====================
    console.log('\n§10 LABELS español');
    ok('16. HOME → "Gana Croatia"', conv.displayLabel('home', 'Croatia', 'Ghana') === 'Gana Croatia');
    ok('17. AWAY → "Gana Ghana"', conv.displayLabel('away', 'Croatia', 'Ghana') === 'Gana Ghana');
    ok('18. DRAW → "Empate"', conv.displayLabel('draw', 'Croatia', 'Ghana') === 'Empate');

    // ===================== §10.1 conversión atómica =====================
    console.log('\n§10 CONVERSIÓN ATÓMICA');
    const A = await readyCandidate();
    ok('candidate READY pre-conversión', A.cand.candidate_lifecycle === 'READY_FOR_REVIEW');
    const r1 = await conv.convertToPick(A.cand.candidate_id, SUP);
    ok('1. → Pick + Signal + CONVERTED atómicamente', !!r1.pick && !!r1.signal && (await candOf(A.ev)).candidate_lifecycle === 'CONVERTED_TO_PICK');
    ok('1b. Pick enlaza Signal + snapshot congelado + executed_by_gp=false + flat_1_unit', r1.pick.signal_id === r1.signal.id && r1.pick.executed_by_gp === false && r1.pick.theoretical_stake_model === 'flat_1_unit');
    ok('1c. Signal oficial post-epoch en Registry (model_prediction_v1, score_eligible)', r1.signal.signal_type === 'model_prediction_v1' && r1.signal.score_eligible === true);
    ok('19. period display = tiempo reglamentario sin prórroga/penales', /reglamentario/.test(r1.pick.period) && /penales/.test(r1.pick.period) && r1.pick.selection_display === 'Gana Croatia');
    ok('15. probabilidad congelada en la Pick = vector V1 (home 0.712)', r1.pick.gp_probability_vector.home === 0.712);

    // ===================== §10.2 idempotencia / concurrencia =====================
    console.log('\n§10 IDEMPOTENCIA');
    const dup = await conv.convertToPick(A.cand.candidate_id, SUP);
    ok('2a. re-conversión → idempotente (misma Pick)', dup.idempotent === true && dup.pick.pick_id === r1.pick.pick_id);
    ok('2b. una sola Pick y una sola Signal para el candidate', (await q(`SELECT count(*)::int n FROM internal_picks WHERE candidate_id=$1`, [A.cand.candidate_id])).rows[0].n === 1 && (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === 1);
    // concurrencia: dos conversiones en paralelo sobre un nuevo READY → una Pick
    const B = await readyCandidate();
    const [x, y] = await Promise.allSettled([conv.convertToPick(B.cand.candidate_id, { ...SUP, idempotencyKey: 'k-' + B.cand.candidate_id }), conv.convertToPick(B.cand.candidate_id, { ...SUP, idempotencyKey: 'k2-' + B.cand.candidate_id })]);
    ok('2c. concurrencia → exactamente una Pick (UNIQUE candidate_id)', (await q(`SELECT count(*)::int n FROM internal_picks WHERE candidate_id=$1`, [B.cand.candidate_id])).rows[0].n === 1);

    // ===================== §10.3-11 GATES (no convierte) =====================
    console.log('\n§10 GATES (no convierte)');
    // 11. PASS/WATCH/LEAN → no candidate elegible → revalidación falla
    const L = await mkEvent(); await mkEvals(L, { cls: 'lean', candElig: false }); await mkQuote(L, 'home', 1.99); await rr.upsertFixtureMapping({ canonicalEventId: L, fixtureId: 'FXL', isKnockout: false }); await cf.run({ now: NOW });
    ok('11. LEAN → no hay candidate (factory solo STRONG)', !(await candOf(L)));
    // 5. precio bajo mínima
    const P = await readyCandidate({ bestOdds: 1.50, minOdds: 1.86 });
    let e5 = null; try { await conv.convertToPick(P.cand.candidate_id, SUP); } catch (e) { e5 = e; }
    ok('5. precio < mínima → no convierte (revalidation_failed)', e5 && e5.code === 'revalidation_failed' && (await candOf(P.ev)).candidate_lifecycle !== 'CONVERTED_TO_PICK');
    // 6. evento iniciado
    const EV = await readyCandidate(); let e6 = null; try { await conv.convertToPick(EV.cand.candidate_id, { ...SUP, now: +new Date(KICK) + 3600000 }); } catch (e) { e6 = e; }
    ok('6. evento iniciado → no convierte', e6 && e6.code === 'revalidation_failed');
    // 7. ESPN mapping ausente → BLOCKED, no convierte
    const NOESPN = await readyCandidate({ espn: false });
    let e7 = null; try { await conv.convertToPick(NOESPN.cand.candidate_id, SUP); } catch (e) { e7 = e; }
    ok('7. ESPN mapping ausente → BLOCKED, no convierte', e7 && e7.code === 'revalidation_failed' && e7.details.includes('BLOCKED_MISSING_ESPN_MAPPING'));
    // 9. Metrics unhealthy
    const MH = await readyCandidate();
    process.env.METRICS_ENGINE_ENABLED = 'false';
    await cf.run({ now: NOW }); // refresca → BLOCKED por metrics
    let e9 = null; try { await conv.convertToPick(MH.cand.candidate_id, SUP); } catch (e) { e9 = e; }
    ok('9. Metrics unhealthy → no convierte', e9 && e9.code === 'revalidation_failed');
    process.env.METRICS_ENGINE_ENABLED = 'true';
    // superadmin required
    let eSup = null; try { await conv.convertToPick(A.cand.candidate_id, { adminId: 'x', reason: 'x', reviewNote: 'x' }); } catch (e) { eSup = e; }
    ok('superadmin requerido', eSup && eSup.code === 'superadmin_required');

    // ===================== §10.12-13 ROLLBACK =====================
    console.log('\n§10 ROLLBACK');
    // canonical_event_id inválido en el candidate → la creación de la Signal (FK) falla → rollback total
    const bad = (await q(`INSERT INTO candidate_factory (dedup_key, canonical_event_id, outcome, selection, market, period, model_version, value_policy_version, classification, candidate_lifecycle, current_best_odds, minimum_odds, best_sportsbook, deep_link, kickoff_at, verified_independence_group_count, evaluation_mode, gp_probability, consensus_probability, conservative_probability)
      VALUES ('bad|k','00000000-0000-0000-0000-000000000000','home','home','1x2','regulation_90m','gp-core-1.4.0','value-1','strong','READY_FOR_REVIEW',1.99,1.86,'pinnacle','https://x',$1,6,'internal_operational',0.712,0.505,0.548) RETURNING candidate_id`, [KICK])).rows[0].candidate_id;
    const sigBefore = (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n;
    const pickBefore = (await q(`SELECT count(*)::int n FROM internal_picks`)).rows[0].n;
    let e12 = null; try { await conv.convertToPick(bad, SUP); } catch (e) { e12 = e; }
    ok('12/13. fallo al crear Signal → rollback (no Pick, no Signal, no conversión)', e12 && (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === sigBefore && (await q(`SELECT count(*)::int n FROM internal_picks`)).rows[0].n === pickBefore && (await q(`SELECT candidate_lifecycle FROM candidate_factory WHERE candidate_id=$1`, [bad])).rows[0].candidate_lifecycle === 'READY_FOR_REVIEW');

    // ===================== §10.14-15, 20 REGRESIÓN =====================
    console.log('\n§10 REGRESIÓN');
    const vc14 = await verifier.verifyChain();
    if (!vc14.valid) console.error('  [debug] chain errors:', JSON.stringify(vc14.errors && vc14.errors.slice(0, 4)));
    ok('14. Registry chain válida tras conversiones', vc14.valid === true);
    ok('15. snapshot de probabilidad de la Pick inmutable (UPDATE bloqueado)', await (async () => { try { await q(`UPDATE internal_picks SET gp_probability=9 WHERE pick_id=$1`, [r1.pick.pick_id]); return false; } catch { return true; } })());
    ok('20. conversión no publicó ni envió alertas (Pick interna, registry_status published pero público off)', r1.signal.visibility === 'internal');
    ok('epoch intacto', (await RA.activeEpoch()).status === 'active');

    console.log(`\n[post-shadow-pick-conversion-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
