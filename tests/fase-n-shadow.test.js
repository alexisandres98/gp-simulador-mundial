// tests/fase-n-shadow.test.js — Fase N (PURO): timestamps hierarchy, no-vig de goles, goal value shadow,
// validación de calibración. No toca pipeline.
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const ts = require(R + '/context-engine/timestamps');
const nv = require(R + '/goal-engine/noVig');
const gv = require(R + '/goal-engine/goalValue');
const val = require(R + '/calibration/validation');
const { pointInTimeReplay } = require(R + '/calibration/replay');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const CUT = '2026-07-01T15:00:00Z', BEFORE = '2026-07-01T12:00:00Z', AFTER = '2026-07-01T16:00:00Z';

(async () => {
  console.log('\n§N.2 JERARQUÍA DE TIMESTAMPS');
  ok('SOURCE_PUBLISHED clasificado y usable pre-cutoff', ts.usableAt({ published_at: BEFORE }, CUT).quality === 'SOURCE_PUBLISHED' && ts.usableAt({ published_at: BEFORE }, CUT).usable);
  ok('PROVIDER_UPDATED clasificado', ts.usableAt({ provider_updated_at: BEFORE }, CUT).quality === 'PROVIDER_UPDATED');
  ok('INGESTION_OBSERVED solo hacia adelante (first_seen anterior → usable)', ts.usableAt({ first_seen_at: BEFORE }, CUT).usable === true && ts.usableAt({ first_seen_at: BEFORE }, CUT).quality === 'INGESTION_OBSERVED');
  ok('INGESTION_OBSERVED con first_seen POSTERIOR al cutoff → NO usable (no retroactivo)', ts.usableAt({ first_seen_at: AFTER }, CUT).usable === false);
  ok('manual SIN evidencia no se trata como MANUAL_VERIFIED (cae a INGESTION)', ts.classifyTimestamp({ manual_verified: true, observed_at: BEFORE }) === 'INGESTION_OBSERVED');
  ok('MANUAL_VERIFIED con evidencia (source_reference) → usable', (r => r.quality === 'MANUAL_VERIFIED' && r.usable === true)(ts.usableAt({ manual_verified: true, source_reference: 'http://x', first_seen_at: BEFORE }, CUT)));
  ok('manual con published_at real → SOURCE_PUBLISHED usable', ts.usableAt({ manual_verified: true, source_reference: 'http://x', published_at: BEFORE }, CUT).usable === true);
  ok('UNKNOWN (sin nada) → no usable, confidence 0', (r => !r.usable && r.confidence === 0)(ts.usableAt({}, CUT)));
  ok('confianza penaliza INGESTION vs SOURCE_PUBLISHED', ts.QUALITY_CONFIDENCE.INGESTION_OBSERVED < ts.QUALITY_CONFIDENCE.SOURCE_PUBLISHED);
  ok('first_seen_at nunca se backdatea', ts.reconcileFirstSeen(BEFORE, AFTER) === BEFORE && ts.reconcileFirstSeen(AFTER, BEFORE) === BEFORE);

  console.log('\n§N.11 NO-VIG DE GOLES');
  const quotes = [
    { sportsbook_code: 'pinnacle', independence_group: 'g1', side: 'over', odds_decimal: 1.95, quote_status: 'open', is_live: false },
    { sportsbook_code: 'pinnacle', independence_group: 'g1', side: 'under', odds_decimal: 1.95, quote_status: 'open', is_live: false },
    { sportsbook_code: 'bet365', independence_group: 'g2', side: 'over', odds_decimal: 2.00, quote_status: 'open', is_live: false },
    { sportsbook_code: 'bet365', independence_group: 'g2', side: 'under', odds_decimal: 1.90, quote_status: 'open', is_live: false },
    { sportsbook_code: 'dk', independence_group: 'g3', side: 'over', odds_decimal: 1.98, quote_status: 'open', is_live: false },
    { sportsbook_code: 'dk', independence_group: 'g3', side: 'under', odds_decimal: 1.92, quote_status: 'open', is_live: false },
  ];
  const c = nv.consensus(quotes, 'over', 'under', { minGroups: 3 });
  ok('no-vig consenso ok con 3 grupos', c.ok && c.groups === 3);
  ok('par 1.95/1.95 → ~0.5 sin vig', close(nv.twoWayNoVig({ odds_decimal: 1.95, quote_status: 'open' }, { odds_decimal: 1.95, quote_status: 'open' }).a, 0.5));
  ok('set incompleto (falta under) → bloqueado', nv.consensus(quotes.filter(q => q.side === 'over'), 'over', 'under').ok === false);
  ok('quote suspended no entra', nv.twoWayNoVig({ odds_decimal: 1.95, quote_status: 'suspended' }, { odds_decimal: 1.95, quote_status: 'open' }) === null);
  ok('grupos insuficientes → bloqueado', nv.consensus(quotes.slice(0, 4), 'over', 'under', { minGroups: 3 }).ok === false);

  console.log('\n§N.12/N.13 GOAL VALUE SHADOW');
  // Croacia-Ghana λ ~1.55/0.82: P(Over2.5)≈42%. Mercado 51% (cuota over alta) → sin valor; mercado bajo → valor.
  const e1 = gv.evaluate({ lambdaHome: 1.55, lambdaAway: 0.82, marketId: 'TOTAL_GOALS_OVER_2_5', marketFamily: 'match_total', consensusProb: 0.42, bestOdds: 2.6, groups: 4 });
  ok('goal value usa policy propia (no 1X2)', e1.policy_version === 'goal-value-policy-shadow-1');
  ok('expone gp/edge/ev/sensibilidad', e1.gp_probability != null && e1.adjusted_edge_pp != null && e1.line_probability_sensitivity);
  ok('shadow_only (no registry/pick/public)', e1.registry_eligible === false && e1.pick_candidate_eligible === false && e1.public_eligible === false);
  // clasificación inestable degrada de strong
  const e2 = gv.evaluate({ lambdaHome: 1.55, lambdaAway: 0.82, marketId: 'BTTS_YES', marketFamily: 'btts', consensusProb: 0.40, bestOdds: 2.5, groups: 4 });
  ok('BTTS evaluado con clasificación válida', ['pass', 'watch', 'lean', 'strong'].includes(e2.classification));
  ok('grupos insuficientes → no strong', gv.evaluate({ lambdaHome: 2.6, lambdaAway: 2.2, marketId: 'TOTAL_GOALS_OVER_2_5', marketFamily: 'match_total', consensusProb: 0.3, bestOdds: 3.0, groups: 1 }).classification !== 'strong');

  console.log('\n§N.6 VALIDACIÓN DE CALIBRACIÓN');
  let db; try { db = JSON.parse(fs.readFileSync(path.join(R, 'db.json'), 'utf8')); } catch { db = { results: {} }; }
  const records = pointInTimeReplay({ results: db.results || {} });
  if (records.length >= 10) {
    const rec = val.recommend(records);
    console.log('   ' + JSON.stringify({ current_lambda: rec.current_lambda, fitted: rec.fitted_lambda, recommended: rec.recommended_parameter, rolling_oos: rec.rolling_oos.oos_log_loss, note: rec.note }));
    console.log('   sensitivity:', JSON.stringify(rec.sensitivity));
    ok('recomienda un λ con shrinkage hacia el prior (no salto agresivo)', Math.abs(rec.recommended_parameter - rec.current_lambda) <= Math.abs(rec.fitted_lambda - rec.current_lambda));
    ok('rolling OOS produce un log loss válido', rec.rolling_oos.oos_log_loss > 0 && isFinite(rec.rolling_oos.oos_log_loss));
    ok('marca muestra insuficiente (<60) → mantener en shadow', /shadow|INSUFICIENTE/i.test(rec.note));
  } else { console.log('   (muestra < 10: omitido)'); }

  console.log(`\n[fase-n-shadow] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
