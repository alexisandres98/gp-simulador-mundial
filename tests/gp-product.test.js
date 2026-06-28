// tests/gp-product.test.js — Fase Q §19. Tests PUROS (sin DB): flags/autorización beta, DTOs de cliente
// (códigos neutrales, 1X2=100%, qualify separado, sin secretos, blockers, picks neutrales, goal distribution),
// y paridad i18n ES/EN. La prueba post-cutover (eval V2 oficial) es runtime/DB → se cubre en el gate Q.0.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const fresh = (m) => { delete require.cache[require.resolve(R + '/' + m)]; return require(R + '/' + m); };
const FLAG_ENVS = ['GP_BETA_UI_ENABLED', 'GP_PUBLIC_PICKS_ENABLED', 'GP_PUBLIC_VALUE_ENABLED', 'GP_PUBLIC_HISTORY_ENABLED', 'GP_GOAL_INSIGHTS_UI_ENABLED', 'GP_ARBITRAGE_UI_ENABLED', 'GP_BETA_ALLOWLIST'];
const clearFlags = () => FLAG_ENVS.forEach((k) => delete process.env[k]);

console.log('\n== gp-product: flags / autorización beta ==');
clearFlags();
let F = fresh('gp-product/flags');
ok('beta off (default) → no autorizado (admin incluido)', F.resolveForUser({ email: 'a@b.com', isAdmin: true }).beta === false);
ok('beta off → flags() todo false', Object.values(F.flags()).every((v) => v === false));
process.env.GP_BETA_UI_ENABLED = 'true';
F = fresh('gp-product/flags');
ok('beta on + sin sesión → false (flag NO sustituye auth)', F.betaAccess({ email: null, isAdmin: false }) === false);
ok('beta on + admin → autorizado', F.betaAccess({ email: 'a@b.com', isAdmin: true }) === true);
ok('beta on + no-admin no-allowlist → denegado', F.betaAccess({ email: 'x@y.com', isAdmin: false }) === false);
process.env.GP_BETA_ALLOWLIST = 'qa@gp.com, Other@GP.com';
F = fresh('gp-product/flags');
ok('beta on + allowlist (case-insensitive) → autorizado', F.betaAccess({ email: 'OTHER@gp.com', isAdmin: false }) === true);
ok('goalInsights solo si beta + su flag (flag off → false)', F.resolveForUser({ email: 'qa@gp.com' }).goalInsights === false);
process.env.GP_GOAL_INSIGHTS_UI_ENABLED = 'true';
F = fresh('gp-product/flags');
ok('goalInsights on + beta autorizado → true', F.resolveForUser({ email: 'qa@gp.com' }).goalInsights === true);
ok('goalInsights on pero NO autorizado → false', F.resolveForUser({ email: 'nope@x.com' }).goalInsights === false);
ok('arbitrage default false (no flag) → false', F.resolveForUser({ email: 'qa@gp.com' }).arbitrage === false);
clearFlags();

console.log('\n== gp-product: DTOs de cliente ==');
const dto = require(R + '/gp-product/dto');
// 1X2 suma 100%
const evals = {
  home: { gp_probability: 0.7167, sportsbook_consensus_probability: 0.532, best_decimal_odds: 1.85, minimum_acceptable_odds: 1.79, adjusted_edge_pp: 0.0298, classification: 'lean', quality_score: 99, uncertainty_score: 33, strong_blockers: ['edge_below_strong'], rejection_reasons: [], warnings: ['method_disagreement'], selection: 'home', best_sportsbook_name: 'Betsson', id: 'e1', canonical_event_id: 'ev1', edge_source_code: 'MODEL_DISAGREEMENT' },
  draw: { gp_probability: 0.1921, sportsbook_consensus_probability: 0.2956, selection: 'draw', classification: 'pass', rejection_reasons: ['no_positive_edge'], strong_blockers: [], warnings: [], id: 'e2', canonical_event_id: 'ev1' },
  away: { gp_probability: 0.0912, sportsbook_consensus_probability: 0.1724, selection: 'away', classification: 'pass', rejection_reasons: ['no_positive_edge'], strong_blockers: [], warnings: [], id: 'e3', canonical_event_id: 'ev1' },
};
const pv = dto.probabilityVector(evals);
ok('probabilityVector: suma ~1 → sums_to_one true', pv.sums_to_one === true);
ok('probabilityVector: 3 outcomes con códigos neutrales HOME/DRAW/AWAY', JSON.stringify(pv.outcomes.map((o) => o.outcome_code)) === '["HOME","DRAW","AWAY"]');
ok('probabilityVector: market_code/period_code neutrales', pv.market_code === '1X2' && pv.period_code === 'REGULATION');
const pvBad = dto.probabilityVector({ home: { gp_probability: 0.5, selection: 'home' }, draw: { gp_probability: 0.2, selection: 'draw' }, away: { gp_probability: 0.1, selection: 'away' } });
ok('probabilityVector: suma 0.8 → sums_to_one false', pvBad.sums_to_one === false);

// qualify separado
ok('qualifyBlock: null sin knockout', dto.qualifyBlock(null) === null);
const qb = dto.qualifyBlock({ home_qualify: 0.62, away_qualify: 0.38 });
ok('qualifyBlock: market_code QUALIFY + semántica separada (incluye ET/penales)', qb.market_code === 'QUALIFY' && qb.semantics_code === 'ADVANCE_INCLUDES_ET_PENALTIES');

// análisis: factor impacto 0 NO se muestra como driver; sin source_name
const obs = [
  { factor_code: 'FORM', category: 'PERFORMANCE', subject_type: 'team', subject_id: 'CRO', direction: 'home', applied_impact: 0, proposed_impact: 0, fact_or_inference: 'INFERENCE', confidence: 0.6, timestamp_quality: 'INGESTION_OBSERVED', source_name: 'api_football' },
  { factor_code: 'AVAILABILITY', category: 'SQUAD', subject_type: 'team', subject_id: 'CRO', direction: 'home', applied_impact: 0, proposed_impact: 0, fact_or_inference: 'INFERENCE', confidence: 0.6, timestamp_quality: 'INGESTION_OBSERVED', source_name: 'api_football' },
];
const snap = { context_state: 'FULL_CONTEXT', base_probability_vector: { home: 0.7146, draw: 0.1936, away: 0.0918 }, final_probability_vector: { home: 0.7167, draw: 0.1921, away: 0.0912 }, context_adjustments: { home: 0.0029, draw: -0.0079, away: -0.0062 }, factor_count: 2, source_count: 1, data_freshness: 0.9, context_completeness: 0.8 };
const an = dto.analysisFactors(obs, snap);
ok('analysis: applied_factors vacío (todos impacto 0) — no inventa drivers', an.applied_factors.length === 0);
ok('analysis: evaluated_factors lista FORM y AVAILABILITY', an.evaluated_factors.map((f) => f.factor_code).sort().join(',') === 'AVAILABILITY,FORM');
ok('analysis: ajuste neto del contexto presente', an.context_adjustments && an.context_adjustments.HOME != null);
ok('analysis: NO expone source_name (identidad de fuente)', JSON.stringify(an).indexOf('api_football') === -1 && JSON.stringify(an).indexOf('source_name') === -1);

// value card: STRONG accionable; LEAN no accionable + blockers; sin secretos
const strongEval = { ...evals.home, classification: 'strong', strong_blockers: [], rejection_reasons: [] };
const vcStrong = dto.valueCard(strongEval);
ok('valueCard: STRONG sin blockers → actionable', vcStrong.actionable === true && vcStrong.blockers.length === 0);
const vcLean = dto.valueCard(evals.home); // lean con edge_below_strong
ok('valueCard: LEAN → no actionable + blocker EDGE_BELOW_STRONG', vcLean.actionable === false && vcLean.blockers.includes('EDGE_BELOW_STRONG'));
ok('valueCard: classification_code neutral en MAYÚSCULAS', vcLean.classification_code === 'LEAN');
// best_sportsbook (dónde está el mejor precio) es público; lo prohibido es exponer IDENTIDADES crudas de
// fuentes/independencia (qué casas componen cada grupo) o snapshot ids internos. El conteo sí es legítimo.
ok('valueCard: best_sportsbook público OK; sin identidades crudas de fuente/snapshot', vcLean.best_sportsbook === 'Betsson' && vcLean.sportsbooks === undefined && JSON.stringify(vcLean).indexOf('input_snapshot') === -1 && JSON.stringify(vcLean).indexOf('independence_group_members') === -1);

// pick neutral: model_label PREVIOUS para V1, sin "V1", sin stake recomendado, executed_by_gp false
const pickRow = { pick_id: 'p1', canonical_event_id: 'ev1', event_display: 'Croatia vs Ghana', canonical_home_team_id: 'CRO', canonical_away_team_id: 'GHA', outcome_code: 'HOME', selection_display_key: 'selection.team_to_win', selection_display_args: { team_id: 'CRO' }, market_code: '1X2', period_code: 'REGULATION', kickoff_at: '2026-06-27T21:00:00Z', gp_probability: 0.712, consensus_probability: 0.5045, published_break_even_probability: 0.5, published_odds: 2, minimum_odds: 1.86, sportsbook: 'onexbet', deep_link: 'https://1xbet.com/', adjusted_edge_pp: 0.045, quality_score: 100, uncertainty_score: 25, risks_displayed: ['MODEL_DISAGREEMENT'], official_model: 'V1', theoretical_stake_model: 'flat_1_unit', executed_by_gp: false };
const pd = dto.pickDto(pickRow);
ok('pickDto: model_label_code PREVIOUS para V1 (nunca "V1" al cliente)', pd.model_label_code === 'PREVIOUS' && JSON.stringify(pd).indexOf('"V1"') === -1);
ok('pickDto: executed_by_gp false + stake teórico flat_1_unit (sin stake recomendado)', pd.executed_by_gp === false && pd.theoretical_stake_model === 'flat_1_unit');
ok('pickDto: selección neutral (key + team_id), no frase localizada', pd.selection_display_key === 'selection.team_to_win' && pd.selection_display_args.team_id === 'CRO');

// goal insights: distribución (no marcador determinista), btts yes/no, informativo
const g = { lambda_home: 2.29, lambda_away: 0.45, lambda_total: 2.74, over_under: { '2.5': { over: 0.52, under: 0.48 } }, btts: { yes: 0.338, no: 0.662 }, top_scores: [{ score: '2-0', probability: 0.17 }, { score: '1-0', probability: 0.14 }, { score: '1-1', probability: 0.08 }] };
const gi = dto.goalInsights(g);
ok('goalInsights: informational true (dispara disclaimer)', gi.informational === true);
ok('goalInsights: distribución de marcadores (no un único determinista)', Array.isArray(gi.top_scores) && gi.top_scores.length >= 2);
ok('goalInsights: btts yes/no', gi.btts.yes != null && gi.btts.no != null);
ok('goalInsights: NO produce Pick/Value (solo análisis)', gi.pick === undefined && gi.value === undefined);

// risk codes
const rc = dto.riskCodes([evals.home], snap, { earlyTrackRecord: true });
ok('riskCodes: incluye EARLY_TRACK_RECORD', rc.includes('EARLY_TRACK_RECORD'));
ok('riskCodes: deriva MODEL_DISAGREEMENT de warnings', rc.includes('MODEL_DISAGREEMENT'));

console.log('\n== i18n: paridad ES/EN ==');
const d = require(R + '/i18n/dictionary');
const es = Object.keys(d.DICT.es), en = Object.keys(d.DICT.en);
ok('i18n: misma cantidad de keys ES/EN', es.length === en.length, `${es.length} vs ${en.length}`);
ok('i18n: ninguna key falta en EN', es.every((k) => k in d.DICT.en));
ok('i18n: ninguna key falta en ES', en.every((k) => k in d.DICT.es));
ok('i18n: ningún valor vacío', es.every((k) => String(d.DICT.es[k]).trim()) && en.every((k) => String(d.DICT.en[k]).trim()));
ok('i18n: version i18n-6', d.I18N_VERSION === 'i18n-6');
// interpolación + invariancia: cambiar idioma no altera la semántica (mismos args → mismo placeholder resuelto)
ok('i18n: interpolación {team} ES', d.t('selection.team_to_win', { team: 'Croacia' }, 'es') === 'Croacia gana');
ok('i18n: interpolación {team} EN', d.t('selection.team_to_win', { team: 'Croatia' }, 'en') === 'Croatia to win');
// todos los códigos de DTO tienen key en AMBOS idiomas
const codeKeys = ['classification.strong', 'classification.lean', 'classification.watch', 'classification.pass',
  'risk.EARLY_TRACK_RECORD', 'risk.MODEL_DISAGREEMENT', 'risk.LINEUP_NOT_CONFIRMED', 'blocker.EDGE_BELOW_STRONG', 'blocker.NO_POSITIVE_EDGE',
  'factor.FORM', 'factor.AVAILABILITY', 'factor.SQUAD_QUALITY', 'category.PERFORMANCE', 'context_state.FULL_CONTEXT',
  'price_state.SETTLED', 'lifecycle.EVENT_STARTED', 'result.WIN', 'model_label.PREVIOUS', 'model_label.CURRENT',
  'nav.home', 'nav.intelligence', 'value.actionable', 'goal.disclaimer', 'history.insufficient'];
ok('i18n: todos los códigos de DTO tienen key ES+EN', codeKeys.every((k) => d.DICT.es[k] && d.DICT.en[k]), codeKeys.filter((k) => !(d.DICT.es[k] && d.DICT.en[k])).join(','));

console.log(`\n${fail === 0 ? '✅' : '❌'} gp-product: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
