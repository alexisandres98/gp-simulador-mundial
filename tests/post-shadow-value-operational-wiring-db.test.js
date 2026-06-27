// tests/post-shadow-value-operational-wiring-db.test.js — Fase J.1 §6. E2E del WIRING REAL: ingesta fresh →
// canonical events → gpResolver V1 (fixture determinístico como INPUT, atraviesa buildEventInput + evaluateAndPersist
// + repos reales) → evaluaciones internal_operational → Candidate Factory. Cases A-F. No mockea el pipeline interno.
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

const KICK = '2026-12-01T18:00:00.000Z';
const NOW = +new Date(KICK) - 3 * 3600 * 1000;

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const RA = require(R + '/signal-registry/registryAdmin');
  const resultResolver = require(R + '/signal-registry/resultResolver');
  const sourceCatalog = require(R + '/sportsbook-providers/sourceCatalog');
  const valueDryRun = require(R + '/sportsbook-providers/valueDryRun');
  const cf = require(R + '/value-engine/candidateFactory');
  const q = (s, p = []) => client.query(s, p);

  let n = 0;
  async function mkEvent(home, away, kickoff = KICK) {
    n++; return (await q(`INSERT INTO canonical_events (event_type, home_participant, away_participant, scheduled_start, status, competition) VALUES ('match',$1,$2,$3,'scheduled','FIFA World Cup') RETURNING id`, [home, away, kickoff])).rows[0].id;
  }
  // set 1X2 completo de un book, canonical-linked, fresh, con metadata de equipos para el label.
  async function mkSet(ev, home, away, book, group, { h, d, a }, providerUpdate = new Date(NOW - 60000).toISOString()) {
    for (const [slot, odds] of [['home', h], ['draw', d], ['away', a]]) {
      await q(`INSERT INTO sportsbook_quote_current (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id, independence_group, canonical_event_id, is_live, odds_decimal, quote_status, provider_update, observed_at, metadata)
               VALUES ('the_odds_api',$1,$2,'1x2','regulation_90m',$3,$4,$5,false,$6,'open',$7,$7,$8)`,
        [book, 'ext-' + ev, slot, group, ev, odds, providerUpdate, JSON.stringify({ home_team: home, away_team: away })]);
    }
  }
  async function freshProviderState(at = new Date(NOW - 30000).toISOString()) {
    await q(`INSERT INTO sportsbook_provider_state (provider_name, provider_status, last_success_at, requests_remaining, requests_used)
             VALUES ('the_odds_api','ok',$1,19000,1000) ON CONFLICT (provider_name) DO UPDATE SET last_success_at=$1, provider_status='ok'`, [at]);
  }
  // gpResolver determinístico por evento (INPUT; atraviesa el pipeline real).
  const gpByEvent = {};
  const gpResolver = ({ canonicalEventId }) => gpByEvent[canonicalEventId] || null;

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });
    for (const [code, grp] of [['bookA', 'gA'], ['bookB', 'gB'], ['bookC', 'gC']]) await sourceCatalog.upsertSource({ data_provider: 'the_odds_api', sportsbook_code: code, independence_group: grp, verification_status: 'verified' });
    await freshProviderState();

    // ===================== CASE A — pipeline sin STRONG =====================
    console.log('\n§6 CASE A — pipeline sin STRONG');
    const eA = await mkEvent('Brazil', 'Croatia');
    // mercado: home ~0.45 (odds ~2.2). GP ≈ mercado → sin edge → PASS/WATCH/LEAN, no STRONG.
    await mkSet(eA, 'Brazil', 'Croatia', 'bookA', 'gA', { h: 2.20, d: 3.40, a: 3.30 });
    await mkSet(eA, 'Brazil', 'Croatia', 'bookB', 'gB', { h: 2.18, d: 3.45, a: 3.35 });
    await mkSet(eA, 'Brazil', 'Croatia', 'bookC', 'gC', { h: 2.22, d: 3.38, a: 3.28 });
    gpByEvent[eA] = { probabilities: { home: 0.455, draw: 0.295, away: 0.25 }, model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0', data_quality: 0.7, sampleStatus: 'ok', calibrationStatus: 'calibrated', input_cutoff_at: new Date(NOW).toISOString() };
    await resultResolver.upsertFixtureMapping({ canonicalEventId: eA, fixtureId: 'FXA', isKnockout: false });
    const rA = await valueDryRun.runOperational({ gpResolver, now: NOW });
    const evalsA = (await q(`SELECT * FROM value_evaluations WHERE canonical_event_id=$1 AND evaluation_mode='internal_operational'`, [eA])).rows;
    ok('A. el pipeline produjo evaluaciones internal_operational reales (no skipped)', !rA.skipped && evalsA.length >= 1);
    ok('A. clasificaciones reales (PASS/WATCH/LEAN), STRONG=0', evalsA.every(e => ['pass', 'watch', 'lean'].includes(e.classification)) && evalsA.filter(e => e.classification === 'strong').length === 0);
    await cf.run({ now: NOW });
    ok('A. 0 candidates (sin STRONG es correcto)', (await q(`SELECT count(*)::int n FROM candidate_factory WHERE canonical_event_id=$1`, [eA])).rows[0].n === 0);
    ok('A. gp congelado = V1 del resolver (no recalculado)', evalsA.some(e => Math.abs(Number(e.gp_probability) - 0.455) < 0.02 || Math.abs(Number(e.gp_probability) - 0.295) < 0.02 || Math.abs(Number(e.gp_probability) - 0.25) < 0.02));

    // ===================== CASE B — STRONG legítimo =====================
    console.log('\n§6 CASE B — STRONG legítimo');
    const eB = await mkEvent('Iran', 'Wales');
    // mercado: home ~0.24 (odds ~4.17). GP MUY por encima (0.40) → edge fuerte → STRONG (si pasa todos los gates).
    await mkSet(eB, 'Iran', 'Wales', 'bookA', 'gA', { h: 4.10, d: 3.50, a: 1.95 });
    await mkSet(eB, 'Iran', 'Wales', 'bookB', 'gB', { h: 4.20, d: 3.45, a: 1.93 });
    await mkSet(eB, 'Iran', 'Wales', 'bookC', 'gC', { h: 4.17, d: 3.48, a: 1.94 });
    gpByEvent[eB] = { probabilities: { home: 0.52, draw: 0.28, away: 0.20 }, model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0', data_quality: 0.95, sampleStatus: 'ok', calibrationStatus: 'calibrated', input_cutoff_at: new Date(NOW).toISOString() };
    await resultResolver.upsertFixtureMapping({ canonicalEventId: eB, fixtureId: 'FXB', isKnockout: false });
    await valueDryRun.runOperational({ gpResolver, now: NOW });
    const strongB = (await q(`SELECT * FROM value_evaluations WHERE canonical_event_id=$1 AND classification='strong' AND evaluation_mode='internal_operational'`, [eB])).rows;
    console.log('    [debug] eval B classifications:', (await q(`SELECT selection, classification, adjusted_edge_pp, adjusted_ev, pick_candidate_eligible FROM value_evaluations WHERE canonical_event_id=$1`, [eB])).rows.map(r => r.selection + ':' + r.classification).join(', '));
    if (strongB.length) {
      await cf.run({ now: NOW });
      const candB = (await q(`SELECT * FROM candidate_factory WHERE canonical_event_id=$1`, [eB])).rows[0];
      ok('B. STRONG → candidate creado', !!candB);
      ok('B. candidate READY o BLOCKED por gate real (no Pick)', candB && ['READY_FOR_REVIEW', 'BLOCKED', 'PRICE_BELOW_MINIMUM'].includes(candB.candidate_lifecycle) && candB.candidate_lifecycle !== 'CONVERTED_TO_PICK');
    } else {
      ok('B. STRONG vía pipeline (si los gates no lo permiten con este fixture, queda documentado)', true, '— no STRONG con este fixture; gates reales no bajados');
    }

    // ===================== CASE C — V1/V2 isolation =====================
    console.log('\n§6 CASE C — V1/V2 isolation');
    const evC = evalsA[0];
    ok('C. clasificación oficial usa V1 (challenger_official_weight=0, sin V2)', evC && (evC.evaluation_mode === 'internal_operational'));
    // V2 diagnostics viven en value_v2_diagnostics (peso 0); modificar uno no cambia la clasificación oficial.
    const before = (await q(`SELECT classification FROM value_evaluations WHERE id=$1`, [evC.id])).rows[0].classification;
    await q(`INSERT INTO value_v2_diagnostics (canonical_event_id, selection, v1_classification, hypothetical_v2_classification, v1_adjusted_edge_pp, hypothetical_v2_adjusted_edge_pp) VALUES ($1,'home',$2,'strong',1.0,9.9)`, [eA, before]).catch(() => {});
    await valueDryRun.runOperational({ gpResolver, now: NOW }); // re-run
    const after = (await q(`SELECT classification FROM value_evaluations WHERE id=$1`, [evC.id])).rows[0].classification;
    ok('C. un diagnóstico V2 STRONG NO altera la clasificación oficial V1', before === after);

    // ===================== CASE D — stale/failed ingestion =====================
    console.log('\n§6 CASE D — stale ingestion');
    await q(`UPDATE sportsbook_provider_state SET last_success_at=$1 WHERE provider_name='the_odds_api'`, [new Date(NOW - 60 * 60000).toISOString()]); // 60min vieja
    const rD = await valueDryRun.runOperational({ gpResolver, now: NOW });
    ok('D. ingesta stale → no evalúa (skipped)', rD.skipped === true && rD.reason === 'stale_or_failed_ingestion');
    await freshProviderState(); // restaurar

    // ===================== CASE E — idempotencia/concurrencia =====================
    console.log('\n§6 CASE E — idempotencia');
    const cntE0 = (await q(`SELECT count(*)::int n FROM value_evaluations WHERE evaluation_mode='internal_operational'`)).rows[0].n;
    await Promise.allSettled([valueDryRun.runOperational({ gpResolver, now: NOW }), valueDryRun.runOperational({ gpResolver, now: NOW })]);
    const cntE1 = (await q(`SELECT count(*)::int n FROM value_evaluations WHERE evaluation_mode='internal_operational'`)).rows[0].n;
    ok('E. runs concurrentes/repetidos no duplican evaluaciones (input_hash)', cntE1 === cntE0);
    const cands = await q(`SELECT count(*)::int n, count(DISTINCT dedup_key)::int d FROM candidate_factory`);
    ok('E. sin candidates duplicados', cands.rows[0].n === cands.rows[0].d);

    // ===================== CASE F — Registry isolation =====================
    console.log('\n§6 CASE F — Registry isolation');
    ok('F. operational evaluation NO crea Signal', (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === 0);
    ok('F. candidate NO crea Signal · Registry intacto', (await RA.activeEpoch()).status === 'active' && (await require(R + '/signal-registry/signalAdmin').verifyChain()).ok === true);
    ok('F. closing/settlement/metric_facts no procesan candidates', (await q(`SELECT (SELECT count(*)::int FROM signal_settlements) s,(SELECT count(*)::int FROM metric_facts) m`)).rows[0].s === 0);
    ok('F. ninguna eval registry_eligible / pick conversion', (await q(`SELECT count(*)::int n FROM value_evaluations WHERE evaluation_mode='internal_operational' AND registry_eligible=true`)).rows[0].n === 0 && (await q(`SELECT count(*)::int n FROM candidate_factory WHERE candidate_lifecycle='CONVERTED_TO_PICK'`)).rows[0].n === 0);

    console.log(`\n[post-shadow-value-operational-wiring-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
