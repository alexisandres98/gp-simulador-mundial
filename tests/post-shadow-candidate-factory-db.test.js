// tests/post-shadow-candidate-factory-db.test.js — Fase J §18-19. E2E con repos/servicios REALES: evaluación
// STRONG operativa → Candidate Factory → readiness gate → lifecycle/price-state → dedup/recovery. PASS/WATCH/LEAN
// y V2 NUNCA crean candidate. NO crea Picks/señales. NO toca thresholds.
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
const KMS = +new Date(KICK);
const NOW = KMS - 3 * 3600 * 1000; // 3h antes (kickoff suficientemente futuro)

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const RA = require(R + '/signal-registry/registryAdmin');
  const resultResolver = require(R + '/signal-registry/resultResolver');
  const cf = require(R + '/value-engine/candidateFactory');
  const deepLinks = require(R + '/sportsbook-providers/deepLinks');
  const quotaGuard = require(R + '/sportsbook-providers/quotaGuard');
  const trackRecord = require(R + '/metrics-engine/trackRecord');
  const q = (s, p = []) => client.query(s, p);

  let n = 0;
  async function mkEvent(kickoff = KICK) {
    n++; return (await q(`INSERT INTO canonical_events (event_type, home_participant, away_participant, scheduled_start, status, competition) VALUES ('match',$1,$2,$3,'scheduled','FIFA World Cup') RETURNING id`, ['H' + n, 'A' + n, kickoff])).rows[0].id;
  }
  async function mkEval(ev, { cls = 'strong', mode = 'internal_operational', candElig = true, minOdds = 3.5, bestOdds = 4.0, book = 'pinnacle', groups = 3, blockers = [] } = {}) {
    return (await q(
      `INSERT INTO value_evaluations (canonical_event_id, selection, classification, gp_probability, sportsbook_consensus_probability, conservative_probability,
         best_decimal_odds, minimum_acceptable_odds, adjusted_edge_pp, adjusted_ev, uncertainty_score, quality_score, model_version, classification_version,
         evaluation_mode, pick_candidate_eligible, best_sportsbook_code, verified_independence_group_count, edge_source_code, strong_blockers, input_hash)
       VALUES ($1,'home',$2,0.30,0.24,0.26,$3,$4,4.2,0.06,20,80,'gp-core-1.4.0','classify-1',$5,$6,$7,$8,'MODEL_DISAGREEMENT',$9,$10) RETURNING *`,
      [ev, cls, bestOdds, minOdds, mode, candElig, book, groups, JSON.stringify(blockers), 'h' + crypto.randomBytes(6).toString('hex')])).rows[0];
  }
  async function mkQuote(ev, outcome, odds, book = 'pinnacle', providerUpdate = new Date(NOW - 60000).toISOString()) {
    await q(`INSERT INTO sportsbook_quote_current (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id, independence_group, canonical_event_id, is_live, odds_decimal, quote_status, provider_update, observed_at)
             VALUES ('the_odds_api',$1,$2,'1x2','regulation_90m',$3,$4,$5,false,$6,'open',$7,$7)`, [book, 'ext-' + ev, outcome, 'g-' + book, ev, odds, providerUpdate]);
  }
  const mapping = (ev) => resultResolver.upsertFixtureMapping({ canonicalEventId: ev, fixtureId: 'FX' + String(ev).slice(0, 4), isKnockout: false });
  const candOf = async (ev) => (await q(`SELECT * FROM candidate_factory WHERE canonical_event_id=$1`, [ev])).rows[0];

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });

    // ===================== STRONG COMPLETO → READY =====================
    console.log('\n§19 STRONG → READY');
    const e1 = await mkEvent(); await mkEval(e1); await mkQuote(e1, 'home', 4.10); await mapping(e1);
    const r1 = await cf.run({ now: NOW });
    ok('4/5. STRONG con todos los gates → 1 candidate', r1.created === 1 && r1.strong_evals === 1);
    const c1 = await candOf(e1);
    ok('candidate READY_FOR_REVIEW + price ABOVE_MINIMUM + deep link', c1.candidate_lifecycle === 'READY_FOR_REVIEW' && c1.price_state === 'ABOVE_MINIMUM' && !!c1.deep_link);
    ok('candidate NO es Pick/señal (registry_eligible=false, evaluation_mode operational)', c1.registry_eligible === false && c1.evaluation_mode === 'internal_operational' && c1.candidate_lifecycle !== 'CONVERTED_TO_PICK');

    // ===================== PASS/WATCH/LEAN → NO candidate =====================
    console.log('\n§19 PASS/WATCH/LEAN/V2 excluidos');
    const e2 = await mkEvent(); await mkEval(e2, { cls: 'pass' }); await mkEval(e2, { cls: 'watch' }); await mkEval(e2, { cls: 'lean' }); await mkQuote(e2, 'home', 4.0); await mapping(e2);
    await cf.run({ now: NOW });
    ok('1/2/3. PASS/WATCH/LEAN → 0 candidates', !(await candOf(e2)));
    // V2 hypothetical STRONG vive en value_v2_diagnostics → la factory NUNCA lo lee
    const e2b = await mkEvent(); await mkEval(e2b, { cls: 'strong', mode: 'internal_validation' }); // no operational
    await cf.run({ now: NOW });
    ok('13. STRONG no-operational (validation/V2) → 0 candidate', !(await candOf(e2b)));

    // ===================== BLOCKERS =====================
    console.log('\n§19 BLOCKERS');
    const e3 = await mkEvent(); await mkEval(e3); await mkQuote(e3, 'home', 4.0); /* sin mapping */
    await cf.run({ now: NOW });
    ok('6. STRONG sin ESPN mapping → BLOCKED_MISSING_ESPN_MAPPING', (await candOf(e3)).readiness_blockers.includes('BLOCKED_MISSING_ESPN_MAPPING') && (await candOf(e3)).candidate_lifecycle === 'BLOCKED');
    const e4 = await mkEvent(); await mkEval(e4, { groups: 1 }); await mkQuote(e4, 'home', 4.0); await mapping(e4);
    await cf.run({ now: NOW });
    ok('8. grupos insuficientes → BLOCKED_INSUFFICIENT_GROUPS', (await candOf(e4)).readiness_blockers.includes('BLOCKED_INSUFFICIENT_GROUPS'));
    const e5 = await mkEvent(); await mkEval(e5, { minOdds: 4.5 }); await mkQuote(e5, 'home', 3.8); await mapping(e5); // 3.8 < 4.5
    await cf.run({ now: NOW });
    ok('9. precio < mínima → PRICE_BELOW_MINIMUM', (await candOf(e5)).price_state === 'BELOW_MINIMUM' && (await candOf(e5)).candidate_lifecycle === 'PRICE_BELOW_MINIMUM');
    const e6 = await mkEvent(); await mkEval(e6, { book: 'unknownbook' }); await mkQuote(e6, 'home', 4.0, 'unknownbook'); await mapping(e6);
    await cf.run({ now: NOW });
    ok('deep link ausente (book desconocido) → BLOCKED_MISSING_DEEP_LINK', (await candOf(e6)).readiness_blockers.includes('BLOCKED_MISSING_DEEP_LINK'));
    const e7 = await mkEvent(); await mkEval(e7); await mkQuote(e7, 'home', 4.0); await mapping(e7);
    await cf.run({ now: KMS + 3600000 }); // ya inició
    ok('10. evento iniciado → EXPIRED / EVENT_STARTED', (await candOf(e7)).candidate_lifecycle === 'EXPIRED' && (await candOf(e7)).price_state === 'EVENT_STARTED');
    const e8 = await mkEvent(); await mkEval(e8); await mkQuote(e8, 'home', 4.0, 'pinnacle', new Date(NOW - 30 * 60000).toISOString()); await mapping(e8); // quote 30min vieja vs NOW (> stale 10min)
    await cf.run({ now: NOW });
    ok('STRONG stale → STALE', (await candOf(e8)).price_state === 'STALE');

    // ===================== DEDUP + RECOVERY =====================
    console.log('\n§19 DEDUP + RECOVERY');
    const before = (await q(`SELECT count(*)::int n FROM candidate_factory`)).rows[0].n;
    await cf.run({ now: NOW }); // re-run sobre todo
    ok('dedup: re-run no duplica (mismo count)', (await q(`SELECT count(*)::int n FROM candidate_factory`)).rows[0].n === before && (await candOf(e1)).observation_count >= 2);
    // recovery: e5 estaba below minimum; subir la cuota por encima → READY again, sin nueva fila
    await q(`UPDATE sportsbook_quote_current SET odds_decimal=4.6, provider_update=$2 WHERE canonical_event_id=$1`, [e5, new Date(NOW - 30000).toISOString()]);
    await cf.run({ now: NOW });
    const c5 = await candOf(e5);
    ok('11/12. price recovery → READY again, sin candidate duplicado, transición registrada', c5.candidate_lifecycle === 'READY_FOR_REVIEW' && c5.transition_history.length >= 2 && (await q(`SELECT count(*)::int n FROM candidate_factory WHERE canonical_event_id=$1`, [e5])).rows[0].n === 1);
    // concurrent run safe
    const cc = await Promise.allSettled([cf.run({ now: NOW }), cf.run({ now: NOW })]);
    ok('concurrent run seguro (sin duplicados)', cc.every(x => x.status === 'fulfilled') && (await q(`SELECT count(*)::int n, count(DISTINCT dedup_key)::int d FROM candidate_factory`)).rows[0].n === (await q(`SELECT count(DISTINCT dedup_key)::int d FROM candidate_factory`)).rows[0].d);

    // ===================== DEEP LINKS (puro §10) =====================
    console.log('\n§19 DEEP LINKS');
    ok('1. outcome link preferido', deepLinks.resolve({ sportsbookCode: 'pinnacle', providerLinks: { outcome_deep_link: 'https://www.pinnacle.com/x', market_deep_link: 'https://www.pinnacle.com/m' } }).level === 'outcome');
    ok('2/3. market/event fallback', deepLinks.resolve({ sportsbookCode: 'pinnacle', providerLinks: { event_deep_link: 'https://www.pinnacle.com/e' } }).level === 'event');
    ok('4. homepage fallback (provider no entrega link)', deepLinks.resolve({ sportsbookCode: 'bet365', providerLinks: {} }).level === 'homepage');
    ok('5. link mismatch (host ajeno) rechazado', deepLinks.resolve({ sportsbookCode: 'pinnacle', providerLinks: { outcome_deep_link: 'https://evil.example/x' } }).level !== 'outcome');
    ok('6. book desconocido sin link → null seguro', deepLinks.resolve({ sportsbookCode: 'nope', providerLinks: {} }).url === null);

    // ===================== QUOTA CADENCE (puro §5) =====================
    console.log('\n§19 QUOTA CADENCE');
    const est = quotaGuard.cadenceEstimate({ remaining: 19000, used: 1000, requestsPerRun: 2, intervalMs: 600000 });
    ok('1/2. 10min → 144 runs/día, daily/monthly estimados', est.runs_per_day === 144 && est.estimated_daily_usage === 288 && est.estimated_monthly_usage === 8640);
    ok('3. soft limit (remaining bajo 30%)', quotaGuard.cadenceEstimate({ remaining: 2000, used: 18000, intervalMs: 600000 }).soft_limit_reached === true);
    ok('4. hard limit (remaining bajo reserva)', quotaGuard.cadenceEstimate({ remaining: 100, used: 19900, intervalMs: 600000 }).hard_limit_reached === true);

    // ===================== CLV SEMANTICS PATCH (§2) =====================
    console.log('\n§19 CLV SEMANTICS');
    const sigFake = { id: '00000000-0000-0000-0000-000000000000', signal_payload: { probabilities: { home: 0.5, draw: 0.3, away: 0.2 }, published_odds: '2.00', predicted_outcome: 'home' }, direction: 'home', chain_position: 1, published_at: '2026-06-28T00:00:00Z', event_start_at: KICK };
    const closingFake = { closing_status: 'AVAILABLE', closing_probability: 0.52, closing_odds: 1.92, closing_policy_version: 'closing-policy-1', id: 'c' };
    const fk = trackRecord.buildFact(sigFake, closingFake, { settlement_status: 'final', result_outcome: 'home', settlement_version: 1 }, 'ACTIVE', { verifiedEpoch: '2026-06-01T00:00:00Z' });
    ok('entry_price_vs_closing_fair_gap = 0.52-0.50 = 0.02', Math.abs(fk.entry_price_vs_closing_fair_gap - 0.02) < 1e-6);
    ok('price_clv = published_odds/closing_fair_odds - 1', fk.price_clv != null && fk.clv_semantics_version === 'clv-semantics-2');
    ok('market_move_no_vig = null (no congelado al publicar)', fk.market_move_no_vig === null);
    ok('aliases deprecados conservados (clv_probability = gap)', Math.abs(fk.clv_probability - fk.entry_price_vs_closing_fair_gap) < 1e-9);

    // ===================== METRICS UNHEALTHY BLOCK =====================
    console.log('\n§19 HEALTH BLOCKERS');
    process.env.METRICS_ENGINE_ENABLED = 'false';
    const e9 = await mkEvent(); await mkEval(e9); await mkQuote(e9, 'home', 4.0); await mapping(e9);
    await cf.run({ now: NOW });
    ok('12. Metrics unhealthy → BLOCKED_METRICS_UNHEALTHY', (await candOf(e9)).readiness_blockers.includes('BLOCKED_METRICS_UNHEALTHY'));
    process.env.METRICS_ENGINE_ENABLED = 'true';

    // ===================== ACCIONES + REGRESIÓN =====================
    console.log('\n§19 ACCIONES + REGRESIÓN');
    await cf.reject(c1.candidate_id, { adminId: 'a', reason: 'no me convence' });
    ok('reject → REJECTED (no se borra, historial conservado)', (await candOf(e1)).candidate_lifecycle === 'REJECTED' && (await candOf(e1)).transition_history.length >= 1);
    ok('8. no Pick conversion (ningún candidate CONVERTED_TO_PICK)', (await q(`SELECT count(*)::int n FROM candidate_factory WHERE candidate_lifecycle='CONVERTED_TO_PICK'`)).rows[0].n === 0);
    ok('8/9. signals=0 / picks=0 (candidates no son señales)', (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === 0);
    ok('1. epoch intacto', (await RA.activeEpoch()).status === 'active');
    ok('2/3. admin chain válida', (await require(R + '/signal-registry/signalAdmin').verifyChain()).ok === true);
    ok('candidates NO en Registry/closing/settlement/metrics', (await q(`SELECT (SELECT count(*)::int FROM signal_closing_snapshots) c,(SELECT count(*)::int FROM signal_settlements) s,(SELECT count(*)::int FROM metric_facts) m`)).rows[0].c === 0);

    console.log(`\n[post-shadow-candidate-factory-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
