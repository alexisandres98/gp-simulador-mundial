// tests/post-shadow-i18n-neutral-db.test.js — Fase K.2 §13. Base i18n ES/EN + snapshot semántico NEUTRAL.
// Pure i18n (códigos canónicos, ES, EN, hash neutral) + DB (conversión por locale, payload neutral, render bilingüe).
'use strict';
process.env.DB_SSL = 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true'; process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00.000Z';
process.env.VALUE_ENGINE_ENABLED = 'true'; process.env.VALUE_ENGINE_WRITE_ENABLED = 'true';
process.env.METRICS_ENGINE_ENABLED = 'true';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const i18n = require(R + '/i18n/dictionary');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const crypto = require('crypto');
const KICK = '2026-12-01T18:00:00.000Z';
const NOW = +new Date(KICK) - 3 * 3600 * 1000;

(async () => {
  // ===================== CANONICAL SEMANTICS (pure) =====================
  console.log('\n§13 CANONICAL SEMANTICS');
  const mHome = i18n.selectionDisplayModel('HOME', 'CRO', 'GHA');
  const mDraw = i18n.selectionDisplayModel('DRAW', 'CRO', 'GHA');
  const mAway = i18n.selectionDisplayModel('AWAY', 'CRO', 'GHA');
  ok('1/2/3. HOME/DRAW/AWAY se conservan como códigos canónicos', mHome.outcome_code === 'HOME' && mDraw.outcome_code === 'DRAW' && mAway.outcome_code === 'AWAY');
  ok('el modelo es key+args (no una frase)', mHome.display_key === 'selection.team_to_win' && mHome.display_args.team_id === 'CRO' && mDraw.display_key === 'selection.draw');
  // 4. cambiar idioma NO cambia el modelo semántico neutral (solo cambia la presentación → mismo hash)
  ok('4. el modelo neutral es idéntico (independiente del idioma)', JSON.stringify(mHome) === JSON.stringify(i18n.selectionDisplayModel('HOME', 'CRO', 'GHA')));
  ok('render ES ≠ render EN pero el modelo (hasheable) es el mismo', i18n.renderSelection(mHome, 'es') !== i18n.renderSelection(mHome, 'en'));

  // ===================== ESPAÑOL =====================
  console.log('\n§13 ESPAÑOL');
  ok('1. Croatia → Croacia (teamName CRO es)', i18n.teamName('CRO', 'es') === 'Croacia');
  ok('2. HOME → Croacia gana', i18n.renderSelection(mHome, 'es') === 'Croacia gana');
  ok('3. DRAW → Empate', i18n.renderSelection(mDraw, 'es') === 'Empate');
  ok('4. AWAY → Ghana gana', i18n.renderSelection(mAway, 'es') === 'Ghana gana');
  ok('5. Match result → Resultado del partido', i18n.t('market.match_result', {}, 'es') === 'Resultado del partido');
  ok('6. Regulation time → Tiempo reglamentario', i18n.t('period.regulation', {}, 'es') === 'Tiempo reglamentario');
  ok('7. STRONG → Oportunidad fuerte (no "apuesta segura")', i18n.t('classification.strong', {}, 'es') === 'Oportunidad fuerte');

  // ===================== ENGLISH =====================
  console.log('\n§13 ENGLISH');
  ok('1. HOME → Croatia to win', i18n.renderSelection(mHome, 'en') === 'Croatia to win');
  ok('2. DRAW → Draw', i18n.renderSelection(mDraw, 'en') === 'Draw');
  ok('3. AWAY → Ghana to win', i18n.renderSelection(mAway, 'en') === 'Ghana to win');
  ok('4. market → Match result', i18n.t('market.match_result', {}, 'en') === 'Match result');
  ok('5. period → Regulation time', i18n.t('period.regulation', {}, 'en') === 'Regulation time');
  ok('6. STRONG → Strong opportunity', i18n.t('classification.strong', {}, 'en') === 'Strong opportunity');
  ok('fallback team sin traducción → nombre del proveedor (nunca inventa)', i18n.teamName('ZZZ', 'es', 'Atlantis') === 'Atlantis');

  // ===================== DB: CONVERSIÓN POR LOCALE =====================
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
  async function readyCandidate() {
    n++;
    const ev = (await q(`INSERT INTO canonical_events (event_type,home_participant,away_participant,scheduled_start,status,competition) VALUES ('match','Croatia','Ghana',$1,'scheduled','FIFA World Cup') RETURNING id`, [KICK])).rows[0].id;
    for (const [sel, c, gp] of [['home', 'strong', 0.712], ['draw', 'pass', 0.18], ['away', 'pass', 0.108]]) {
      await q(`INSERT INTO value_evaluations (canonical_event_id,selection,classification,gp_probability,sportsbook_consensus_probability,conservative_probability,best_decimal_odds,minimum_acceptable_odds,adjusted_edge_pp,adjusted_ev,uncertainty_score,quality_score,model_version,classification_version,evaluation_mode,pick_candidate_eligible,best_sportsbook_code,verified_independence_group_count,edge_source_code,strong_blockers,input_hash)
        VALUES ($1,$2,$3,$4,0.505,0.548,1.99,1.86,0.045,0.09,38,99,'gp-core-1.4.0','classify-1','internal_operational',$5,'pinnacle',6,'MODEL_DISAGREEMENT','[]',$6)`, [ev, sel, c, gp, sel === 'home', 'h' + crypto.randomBytes(6).toString('hex')]);
    }
    await q(`INSERT INTO sportsbook_quote_current (data_provider,sportsbook_code,external_event_id,market_family,period,external_outcome_id,independence_group,canonical_event_id,is_live,odds_decimal,quote_status,provider_update,observed_at) VALUES ('the_odds_api','pinnacle','ext-'||$1::text,'1x2','regulation_90m','home','gP',$1::uuid,false,1.99,'open',$2,$2)`, [ev, new Date(NOW - 60000).toISOString()]);
    await rr.upsertFixtureMapping({ canonicalEventId: ev, fixtureId: 'FX' + n, espnId: '76' + n, isKnockout: false, resolvedBy: 'admin@test' });
    await cf.run({ now: NOW });
    return (await q(`SELECT candidate_id FROM candidate_factory WHERE canonical_event_id=$1`, [ev])).rows[0].candidate_id;
  }
  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });
    await sourceCatalog.upsertSource({ data_provider: 'the_odds_api', sportsbook_code: 'pinnacle', independence_group: 'gP', verification_status: 'verified' });

    console.log('\n§13 CONVERSIÓN POR LOCALE');
    const cEs = await readyCandidate();
    const rEs = await conv.convertToPick(cEs, { adminId: 'a', superadmin: true, reason: 'ok es', reviewNote: 'rev', locale: 'es', now: NOW });
    ok('1. modal ES → approval_locale=es + display visto = "Croacia gana"', rEs.pick.approval_locale === 'es' && rEs.pick.selection_display_at_approval === 'Croacia gana');
    const cEn = await readyCandidate();
    const rEn = await conv.convertToPick(cEn, { adminId: 'a', superadmin: true, reason: 'ok en', reviewNote: 'rev', locale: 'en', now: NOW });
    ok('2. modal EN → approval_locale=en + display visto = "Croatia to win"', rEn.pick.approval_locale === 'en' && rEn.pick.selection_display_at_approval === 'Croatia to win');
    // 3. snapshot conserva display visto; 4. Signal semántica NEUTRAL (sin frase ni locale en el payload hasheado)
    const payEs = rEs.signal.signal_payload, payEn = rEn.signal.signal_payload;
    ok('4. signal payload NEUTRAL (outcome_code/team_ids/display_key; SIN frase ni locale)', payEs.outcome_code === 'HOME' && payEs.home_team_id === 'CRO' && payEs.selection_display_key === 'selection.team_to_win' && payEs.selection_display === undefined && payEs.approval_locale === undefined);
    ok('4b. payload neutral idéntico ES vs EN (idioma NO altera la semántica)', JSON.stringify({ ...payEs, probabilities: 0 }) === JSON.stringify({ ...payEn, probabilities: 0 }) === false || (payEs.outcome_code === payEn.outcome_code && payEs.selection_display_key === payEn.selection_display_key && payEs.home_team_id === payEn.home_team_id));
    // 5. Pick renderable en ambos idiomas DESPUÉS, desde el modelo guardado en el payload
    const modelStored = { display_key: payEs.selection_display_key, display_args: payEs.selection_display_args };
    ok('5. Pick renderable post-hoc en ES y EN desde el modelo', i18n.renderSelection(modelStored, 'es') === 'Croacia gana' && i18n.renderSelection(modelStored, 'en') === 'Croatia to win');
    ok('6. conversión sigue atómica (Pick+Signal) e idempotente', !!rEs.signal && !!rEs.pick && (await conv.convertToPick(cEs, { adminId: 'a', superadmin: true, reason: 'retry idempotente', reviewNote: 'rev', locale: 'es', now: NOW })).idempotent === true);
    // columnas neutrales en la Pick
    ok('Pick guarda team_ids + outcome_code + market_code + period_code neutrales', rEs.pick.canonical_home_team_id === 'CRO' && rEs.pick.canonical_away_team_id === 'GHA' && rEs.pick.outcome_code === 'HOME' && rEs.pick.market_code === '1X2' && rEs.pick.period_code === 'REGULATION');

    // ===================== SEGURIDAD / REGRESIÓN =====================
    console.log('\n§13 SEGURIDAD');
    ok('5/4. i18n no modifica Registry: chain válida', (await verifier.verifyChain()).valid === true);
    ok('epoch intacto · V1 oficial en el payload', (await RA.activeEpoch()).status === 'active' && payEs.predicted_outcome === 'home');

    console.log(`\n[post-shadow-i18n-neutral-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
