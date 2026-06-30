// tests/goal-value-wiring.test.js — Goles G3. Verifica el pipeline de VALUE de goles SHADOW de extremo a extremo
// con cuotas SINTÉTICAS (sin DB, sin red): consenso no-vig por línea → goalValue.evaluate (prob GP vs consenso,
// edge, clasificación) → forma del registro persistible. Confirma que es shadow_only y que la matemática del
// no-vig y el edge son coherentes. NO toca pipeline.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const noVig = require(R + '/goal-engine/noVig');
const goalValue = require(R + '/goal-engine/goalValue');
const dist = require(R + '/goal-engine/distribution');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// Replica la lógica de agrupación/consenso de persistGoalValue (server.js) sin DB.
function valueForLine(lh, la, line, quoteRows) {
  const lineTag = String(line).replace('.', '_');
  const quotes = quoteRows.map(r => ({ sportsbook_code: r.book, independence_group: r.book, side: r.side, odds_decimal: r.odds, quote_status: 'open', is_live: false }));
  const consOver = noVig.consensus(quotes, 'over', 'under', { minGroups: 3 });
  if (!consOver.ok) return { reason: consOver.reason };
  const bestOver = Math.max(0, ...quoteRows.filter(r => r.side === 'over').map(r => r.odds));
  const bestUnder = Math.max(0, ...quoteRows.filter(r => r.side === 'under').map(r => r.odds));
  const evals = [];
  for (const [mid, consProb, best] of [[`TOTAL_GOALS_OVER_${lineTag}`, consOver.probability, bestOver], [`TOTAL_GOALS_UNDER_${lineTag}`, 1 - consOver.probability, bestUnder]]) {
    if (!(best > 1)) continue;
    evals.push(goalValue.evaluate({ lambdaHome: lh, lambdaAway: la, marketId: mid, marketFamily: 'match_total', consensusProb: consProb, bestOdds: best, groups: consOver.groups }));
  }
  return { consensusOver: consOver.probability, groups: consOver.groups, evals };
}

(async () => {
  const [lh, la] = [1.82, 1.13]; // O2.5 GP ~0.61
  const gpOver25 = goalValue.gpProbForMarket(lh, la, 'TOTAL_GOALS_OVER_2_5');

  console.log('\n§G3 CONSENSO NO-VIG (quita el margen, exige sets completos + grupos)');
  // 4 casas, par completo over/under, línea 2.5. Cuotas con ~5% de vig.
  const fair = gpOver25; // usar la prob GP como "verdad" sintética para construir cuotas con vig
  const mkOdds = (p, vig) => +(1 / (p * (1 + vig))).toFixed(3);
  const books = ['bk1', 'bk2', 'bk3', 'bk4'];
  const rows25 = [];
  books.forEach(b => { rows25.push({ book: b, side: 'over', odds: mkOdds(fair, 0.05) }); rows25.push({ book: b, side: 'under', odds: mkOdds(1 - fair, 0.05) }); });
  const r25 = valueForLine(lh, la, 2.5, rows25);
  ok('consenso ok con 4 grupos completos', r25.evals && r25.groups >= 3);
  ok('consenso no-vig ≈ prob justa sintética (quitó el margen)', close(r25.consensusOver, fair, 0.01));
  ok('insuficientes grupos (2 casas) → no consenso', valueForLine(lh, la, 2.5, rows25.slice(0, 4)).reason === 'insufficient_groups');

  console.log('\n§G3 EDGE / CLASIFICACIÓN (GP vs consenso) — SHADOW');
  // Cuota generosa en Over (best alto) → debe haber edge positivo en Over.
  const rowsEdge = [];
  books.forEach(b => { rowsEdge.push({ book: b, side: 'over', odds: mkOdds(fair, 0.04) }); rowsEdge.push({ book: b, side: 'under', odds: mkOdds(1 - fair, 0.04) }); });
  rowsEdge.push({ book: 'sharp', side: 'over', odds: +(1 / (fair * 0.92)).toFixed(3) }); // best Over muy por encima del justo
  rowsEdge.push({ book: 'sharp', side: 'under', odds: mkOdds(1 - fair, 0.04) });
  const rE = valueForLine(lh, la, 2.5, rowsEdge);
  const over = rE.evals.find(e => e.market_id === 'TOTAL_GOALS_OVER_2_5');
  ok('evalúa el Over 2.5 con prob GP del engine', over && close(over.gp_probability, gpOver25, 1e-6));
  ok('best Over generoso → raw_edge_pp > 0', over && over.raw_edge_pp > 0);
  ok('EV ajustado coherente con prob/cuota', over && close(over.adjusted_ev, Math.max(0, over.gp_probability - 0.03) * over.best_decimal_odds - 1, 1e-6));
  ok('break-even = 1/cuota', over && close(over.break_even_probability, 1 / over.best_decimal_odds, 1e-6));
  ok('clasificación ∈ {pass,watch,lean,strong}', over && ['pass', 'watch', 'lean', 'strong'].includes(over.classification));

  console.log('\n§G3 SHADOW-ONLY (nunca registry/pick/public)');
  ok('registry_eligible/pick_candidate/public_eligible = false', over && over.registry_eligible === false && over.pick_candidate_eligible === false && over.public_eligible === false);
  ok('evaluation_mode = shadow_goal_value', over && over.evaluation_mode === 'shadow_goal_value');
  ok('policy_version propia (no 1X2)', over && over.policy_version === 'goal-value-policy-shadow-1');

  console.log('\n§G3 MERCADO DESCONOCIDO (línea asiática sin prob en goalModelOutput) → skip limpio');
  ok('Over 2.0 (no en la 1ª capa) → unknown_market (no rompe)', goalValue.evaluate({ lambdaHome: lh, lambdaAway: la, marketId: 'TOTAL_GOALS_OVER_2_0', marketFamily: 'match_total', consensusProb: 0.5, bestOdds: 2, groups: 4 }).ok === false);

  console.log(`\n[goal-value-wiring] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
