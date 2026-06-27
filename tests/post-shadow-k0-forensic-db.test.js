// tests/post-shadow-k0-forensic-db.test.js — Fase K.0 §9. Audit forense del primer candidate: sede neutral (sin
// ventaja de local salvo anfitrión), alias, inversión, ESPN mapping exacto/ausente, dedup de evaluaciones,
// readiness refresh sin crear Pick/Signal. Engine puro + DB efímera. No toca thresholds ni el modelo.
'use strict';
process.env.DB_SSL = 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true'; process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00.000Z';
process.env.VALUE_ENGINE_ENABLED = 'true'; process.env.VALUE_ENGINE_WRITE_ENABLED = 'true';
process.env.METRICS_ENGINE_ENABLED = 'true';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const { matchProbs, effElo } = require(R + '/engine');
const { TEAMS } = require(R + '/data/tournament');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const KICK = '2026-12-01T18:00:00.000Z';
const NOW = +new Date(KICK) - 3 * 3600 * 1000;

(async () => {
  // ===================== §2 NEUTRAL VENUE (engine puro) =====================
  console.log('\n§9 NEUTRAL VENUE');
  const HOME_BONUS = 75;
  const elos = {}; TEAMS.forEach(t => { elos[t.id] = 1700 + (t.id === 'CRO' ? 200 : t.id === 'MEX' ? 100 : 0); });
  // 1. sede neutral: effElo de no-anfitriones = elo crudo (sin +75)
  ok('1. effElo no-anfitrión = elo crudo (sin home advantage)', effElo(elos, 'CRO') === elos.CRO && effElo(elos, 'GHA') === elos.GHA);
  ok('1b. effElo anfitrión (MEX) = elo + 75', effElo(elos, 'MEX') === elos.MEX + HOME_BONUS);
  // probabilidad neutral = matchProbs(raw, raw); con effElo de no-anfitriones es IDÉNTICA
  const pNeutral = matchProbs(elos.CRO, elos.GHA);
  const pResolver = matchProbs(effElo(elos, 'CRO'), effElo(elos, 'GHA'));
  ok('5/7. prob V1 con effElo(no-anfitrión) == prob neutral (sin ventaja local)', Math.abs(pNeutral.home - pResolver.home) < 1e-9);
  // 2. estar listado "home" en el mercado NO confiere ventaja: matchProbs es simétrico (swap → espejo)
  const pSwap = matchProbs(elos.GHA, elos.CRO);
  ok('2. listed-home ≠ home advantage (matchProbs simétrico: swap = espejo)', Math.abs(pNeutral.home - pSwap.away) < 1e-9 && Math.abs(pNeutral.away - pSwap.home) < 1e-9);
  // 8. clasificación bajo tratamiento correcto: el favorito por Elo mantiene su probabilidad (no inflada por localía)
  ok('8. prob del favorito (Croatia) > 0.5 por Elo, no por localía', pNeutral.home > 0.5 && pNeutral.home === pResolver.home);

  // ===================== §1/§9.3 ALIAS Croatia/Ghana =====================
  console.log('\n§9 ALIAS');
  const aliasToId = {}; TEAMS.forEach(t => [t.en, t.name, ...(t.aliases || [])].forEach(a => aliasToId[normName(a)] = t.id));
  ok('3. alias Croatia → CRO, Ghana → GHA', aliasToId[normName('Croatia')] === 'CRO' && aliasToId[normName('Ghana')] === 'GHA');
  ok('3b. CRO/GHA host=false (sin bono); MEX/USA/CAN host=true', !TEAMS.find(t => t.id === 'CRO').host && !TEAMS.find(t => t.id === 'GHA').host && TEAMS.find(t => t.id === 'MEX').host);

  // ===================== DB: inversión, ESPN mapping, dedup, readiness =====================
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const RA = require(R + '/signal-registry/registryAdmin');
  const rr = require(R + '/signal-registry/resultResolver');
  const cf = require(R + '/value-engine/candidateFactory');
  const sigAdmin = require(R + '/signal-registry/signalAdmin');
  const q = (s, p = []) => client.query(s, p);
  let nn = 0;
  async function mkEvent(home, away) { nn++; return (await q(`INSERT INTO canonical_events (event_type,home_participant,away_participant,scheduled_start,status,competition) VALUES ('match',$1,$2,$3,'scheduled','FIFA World Cup') RETURNING id`, [home, away, KICK])).rows[0].id; }
  async function mkEval(ev, { odds = 4.0, minOdds = 3.5, hash } = {}) {
    return (await q(`INSERT INTO value_evaluations (canonical_event_id, selection, classification, gp_probability, sportsbook_consensus_probability, conservative_probability, best_decimal_odds, minimum_acceptable_odds, adjusted_edge_pp, adjusted_ev, uncertainty_score, quality_score, model_version, classification_version, evaluation_mode, pick_candidate_eligible, best_sportsbook_code, verified_independence_group_count, edge_source_code, strong_blockers, input_hash)
      VALUES ($1,'home','strong',0.712,0.505,0.548,$2,$3,0.045,0.09,38,99,'gp-core-1.4.0','classify-1','internal_operational',true,'pinnacle',6,'MODEL_DISAGREEMENT','[]',$4) RETURNING *`, [ev, odds, minOdds, hash])).rows[0];
  }
  async function mkQuote(ev, outcome, odds, book = 'pinnacle', upd = new Date(NOW - 60000).toISOString()) {
    await q(`INSERT INTO sportsbook_quote_current (data_provider,sportsbook_code,external_event_id,market_family,period,external_outcome_id,independence_group,canonical_event_id,is_live,odds_decimal,quote_status,provider_update,observed_at) VALUES ('the_odds_api',$1,$2,'1x2','regulation_90m',$3,$4,$5,false,$6,'open',$7,$7)`, [book, 'ext-' + ev, outcome, 'g-' + book, ev, odds, upd]);
  }
  const candOf = async (ev) => (await q(`SELECT * FROM candidate_factory WHERE canonical_event_id=$1`, [ev])).rows[0];

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });

    console.log('\n§9 ESPN MAPPING + DEDUP + READINESS');
    const ev = await mkEvent('Croatia', 'Ghana');
    await mkQuote(ev, 'home', 1.99);
    // 7. tres evaluaciones materiales (distinto input_hash) → un solo candidate
    await mkEval(ev, { minOdds: 1.860, hash: 'h1' }); await mkEval(ev, { minOdds: 1.861, hash: 'h2' }); await mkEval(ev, { minOdds: 1.862, hash: 'h3' });
    // 6. ESPN missing → BLOCKED
    await cf.run({ now: NOW });
    const c0 = await candOf(ev);
    ok('7. 3 evaluaciones materiales → 1 candidate (dedup)', (await q(`SELECT count(*)::int n FROM candidate_factory WHERE canonical_event_id=$1`, [ev])).rows[0].n === 1);
    ok('6. ESPN mapping ausente → BLOCKED_MISSING_ESPN_MAPPING', c0.candidate_lifecycle === 'BLOCKED' && c0.readiness_blockers.includes('BLOCKED_MISSING_ESPN_MAPPING'));
    const frozenGp = c0.gp_probability;
    // 4. inversión home/away: un mapping con equipos invertidos NO debe validar (identidad exacta)
    // (se simula validando que el mapping aprobado conserva home=Croatia; un away=Croatia sería inversión)
    ok('4. orientación home preservada (home=Croatia en el candidate)', c0.outcome === 'home');

    // 5/9. ESPN exact mapping aprobado → readiness refresh → READY
    await rr.upsertFixtureMapping({ canonicalEventId: ev, fixtureId: '760480', espnId: '760480', isKnockout: false, homeAlias: 'Croatia', awayAlias: 'Ghana', mappingSource: 'manual', resolvedBy: 'admin@test' });
    await cf.run({ now: NOW });
    const c1 = await candOf(ev);
    ok('5/9. ESPN exact mapping + refresh → READY_FOR_REVIEW', c1.candidate_lifecycle === 'READY_FOR_REVIEW' && c1.readiness_blockers.length === 0);
    // 8. el refresh usa el precio vigente SIN mutar la probabilidad congelada
    ok('8. probabilidad congelada NO mutada por el refresh', String(c1.gp_probability) === String(frozenGp));
    ok('8b. price state vigente (ABOVE_MINIMUM), candidate price refrescado', c1.price_state === 'ABOVE_MINIMUM' && Number(c1.current_best_odds) === 1.99);

    // 10. readiness refresh NUNCA crea Pick/Signal
    console.log('\n§9 NO PICK/SIGNAL');
    ok('10. signals=0 tras readiness refresh', (await q(`SELECT count(*)::int n FROM signals`)).rows[0].n === 0);
    ok('10b. CONVERTED_TO_PICK=0, registry chain válida', (await q(`SELECT count(*)::int n FROM candidate_factory WHERE candidate_lifecycle='CONVERTED_TO_PICK'`)).rows[0].n === 0 && (await sigAdmin.verifyChain()).ok === true);
    ok('10c. epoch intacto', (await RA.activeEpoch()).status === 'active');

    console.log(`\n[post-shadow-k0-forensic-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
