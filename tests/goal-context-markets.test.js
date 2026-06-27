// tests/goal-context-markets.test.js — Anexo M-G G.3 (contextual lambdas/portero) + G.4 (settlement) + M.7
// (shadow compare V1 vs V2). PURO. No toca pipeline.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const cl = require(R + '/goal-engine/contextualLambdas');
const st = require(R + '/goal-engine/settlement');
const sc = require(R + '/context-engine/shadowCompare');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  console.log('\n§G.3 CONTEXTUAL LAMBDAS / PORTERO');
  const base = { baseLambdaHome: 1.6, baseLambdaAway: 1.1 };
  const defAway = cl.adjustLambdas({ ...base, factors: [{ affects: 'away_defense', log_delta: -0.2, confidence: 1 }] });
  ok('defensa rival fuerte → baja la lambda del local', defAway.lambda_home < base.baseLambdaHome);
  const noData = cl.goalkeeperFactor({ teamSide: 'away', savesAboveExpected: null, shotsFaced: 0 });
  ok('portero sin datos → impacto 0', noData.log_delta === 0 && noData.confidence === 0);
  const small = cl.goalkeeperFactor({ teamSide: 'away', savesAboveExpected: 2, shotsFaced: 8 });
  const big = cl.goalkeeperFactor({ teamSide: 'away', savesAboveExpected: 8, shotsFaced: 40 });
  ok('muestra pequeña → confianza menor que muestra grande (regresión)', small.confidence < big.confidence);
  ok('portero que evita goles → log_delta negativo (reduce lambda rival)', big.log_delta < 0);
  // CASO CABO VERDE (capacidad general): con datos del portero, la lambda rival baja → sube Under
  const cv = cl.adjustLambdas({ baseLambdaHome: 1.2, baseLambdaAway: 1.5, factors: [cl.goalkeeperFactor({ teamSide: 'home', savesAboveExpected: 6, shotsFaced: 30 })] });
  ok('Cabo Verde: portero del local baja la lambda del rival (away)', cv.lambda_away < 1.5);
  const caps = cl.adjustLambdas({ ...base, factors: [{ affects: 'home_attack', log_delta: 9, confidence: 1 }] });
  ok('caps: un factor extremo no dispara la lambda', caps.adjustments.home_log <= 0.45 + 1e-9);

  console.log('\n§G.4 SETTLEMENT DE MERCADOS DE GOLES (90\' reglamentario)');
  ok('Over 2.5 con 2-1 (total 3) → won', st.settle('TOTAL_GOALS_OVER_2_5', { homeGoals: 2, awayGoals: 1 }) === 'won');
  ok('Under 2.5 con 2-1 → lost', st.settle('TOTAL_GOALS_UNDER_2_5', { homeGoals: 2, awayGoals: 1 }) === 'lost');
  ok('Over 2.5 con 1-1 (total 2) → lost', st.settle('TOTAL_GOALS_OVER_2_5', { homeGoals: 1, awayGoals: 1 }) === 'lost');
  ok('BTTS_YES con 2-1 → won', st.settle('BTTS_YES', { homeGoals: 2, awayGoals: 1 }) === 'won');
  ok('BTTS_YES con 2-0 → lost', st.settle('BTTS_YES', { homeGoals: 2, awayGoals: 0 }) === 'lost');
  ok('HOME_TEAM_TOTAL_OVER_1_5 con 2-0 → won', st.settle('HOME_TEAM_TOTAL_OVER_1_5', { homeGoals: 2, awayGoals: 0 }) === 'won');
  ok('sin marcador → void', st.settle('TOTAL_GOALS_OVER_2_5', {}) === 'void');
  ok('market desconocido → unknown', st.settle('FOO_BAR', { homeGoals: 1, awayGoals: 1 }) === 'unknown');
  ok('metadata correcta de TOTAL_GOALS_OVER_2_5', (m => m && m.scope === 'match_total' && m.side === 'over' && m.line === 2.5 && m.period === 'REGULATION')(st.marketMeta('TOTAL_GOALS_OVER_2_5')));

  console.log('\n§M.7 SHADOW COMPARE V1 vs V2 (números reales del análisis previo)');
  // Datos reales (jun-27): V1 oficial vs V2 (contexto) calculados localmente para los 3 cruces.
  const rows = [
    { label: 'Croacia-Ghana', outcome: 'home', v1Prob: 0.712, v2Prob: 0.556, odds: 1.98, consensus: 0.507, sourceCount: 6 },
    { label: 'Argelia-Austria', outcome: 'away', v1Prob: 0.477, v2Prob: 0.462, odds: 3.40, consensus: 0.298, sourceCount: 6 },
    { label: 'RDCongo-Uzbekistan', outcome: 'away', v1Prob: 0.368, v2Prob: 0.250, odds: 5.70, consensus: 0.182, sourceCount: 6 },
  ];
  const cmp = sc.compareV1vsV2(rows);
  console.log('   resumen:', JSON.stringify(cmp.summary));
  cmp.items.forEach(i => console.log(`   ${i.label} ${i.outcome}: V1 ${i.v1.classification}(edge ${i.v1.adjusted_edge}) → V2 ${i.v2.classification}(edge ${i.v2.adjusted_edge}) shift ${i.shift_pp}pp`));
  ok('V1 marca STRONG a Croacia (edge ≥ 3.5pp)', cmp.items[0].v1.classification === 'strong');
  ok('V2 elimina el STRONG de Croacia (contexto la acerca al mercado)', cmp.items[0].v2.classification !== 'strong');
  ok('resumen reporta removed_by_v2 ≥ 1', cmp.summary.removed_by_v2.length >= 1 && cmp.summary.strong_v2 <= cmp.summary.strong_v1);

  console.log(`\n[goal-context-markets] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
