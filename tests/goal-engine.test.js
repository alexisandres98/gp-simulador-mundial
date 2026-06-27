// tests/goal-engine.test.js — Anexo M-G (G.1/G.2). Goal Distribution Engine (PURO, sin DB).
// Verifica consistencia de la distribución, semántica de mercados, equivalencia EXACTA con el engine oficial
// (no divergencia) y determinismo. No toca nada del pipeline.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const ge = require(R + '/goal-engine/distribution');
const engine = require(R + '/engine');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sumMatrix = m => m.reduce((s, row) => s + row.reduce((x, p) => x + p, 0), 0);

// lambdas de prueba: Croacia(1.55) vs Ghana(0.82) aprox + un partido parejo y uno goleador
const CASES = [[1.55, 0.82], [1.30, 1.30], [2.60, 1.90], [0.60, 0.55]];

(async () => {
  console.log('\n§G DISTRIBUCIÓN');
  for (const [lh, la] of CASES) {
    const { matrix, mass } = ge.buildMatrix(lh, la);
    ok(`matriz suma ≈ 1 (λ ${lh}/${la})`, close(sumMatrix(matrix), 1, 1e-9));
    ok(`sin probabilidades negativas (λ ${lh}/${la})`, matrix.every(row => row.every(p => p >= 0)));
    ok(`truncamiento preserva ≥ 99.99% masa (λ ${lh}/${la})`, mass >= 0.9999);
  }

  console.log('\n§G SEMÁNTICA DE MERCADOS');
  const { matrix } = ge.buildMatrix(1.55, 0.82);
  const dist = ge.totalGoalsDist(matrix);
  // Over 2.5 == P(total >= 3); Under 2.5 == P(total <= 2)
  const pGe3 = Object.entries(dist).reduce((s, [t, p]) => s + (Number(t) >= 3 ? p : 0), 0);
  const pLe2 = Object.entries(dist).reduce((s, [t, p]) => s + (Number(t) <= 2 ? p : 0), 0);
  const ou25 = ge.overUnder(matrix, 2.5);
  ok('Over 2.5 == P(total ≥ 3)', close(ou25.over, pGe3, 1e-6));
  ok('Under 2.5 == P(total ≤ 2)', close(ou25.under, pLe2, 1e-6));
  ok('Over + Under (2.5) == 1', close(ou25.over + ou25.under, 1, 1e-6));
  // BTTS Yes == P(home>=1 y away>=1)
  let bttsManual = 0; for (let h = 1; h < matrix.length; h++) for (let a = 1; a < matrix[h].length; a++) bttsManual += matrix[h][a];
  const bt = ge.btts(matrix);
  ok('BTTS Yes == P(home≥1 ∧ away≥1)', close(bt.yes, bttsManual, 1e-6));
  ok('BTTS Yes + No == 1', close(bt.yes + bt.no, 1, 1e-6));
  // team total home over 0.5 == 1 - P(home=0)
  const homeDist = ge.teamGoalsDist(matrix, 'home');
  ok('Home over 0.5 == 1 − P(home=0)', close(ge.teamOverUnder(matrix, 'home', 0.5).over, 1 - homeDist[0], 1e-6));
  // total goals distribution consistente con la matriz (suma 1)
  ok('total_goals_distribution suma 1', close(Object.values(dist).reduce((a, b) => a + b, 0), 1, 1e-9));

  console.log('\n§G EQUIVALENCIA CON EL MOTOR OFICIAL (no divergencia)');
  for (const [lh, la] of CASES) {
    const out = ge.goalModelOutput(lh, la);
    const ref = engine.probsFromLambdas(lh, la); // 1X2 oficial (con calibración)
    ok(`1X2 calibrado del Goal Engine == engine.probsFromLambdas (λ ${lh}/${la})`,
      close(out.one_x2_calibrated.home, ref.home, 1e-4) && close(out.one_x2_calibrated.draw, ref.draw, 1e-4) && close(out.one_x2_calibrated.away, ref.away, 1e-4));
  }

  console.log('\n§G MATEMÁTICA');
  const lowG = ge.goalModelOutput(1.0, 0.9), highG = ge.goalModelOutput(2.6, 2.2);
  ok('más lambda → mayor P(Over 2.5)', highG.over_under.find(x => x.line === 2.5).over > lowG.over_under.find(x => x.line === 2.5).over);
  ok('expected_total_goals = λh + λa', close(highG.expected_total_goals, 2.6 + 2.2, 1e-4));
  // determinismo
  const a1 = JSON.stringify(ge.goalModelOutput(1.55, 0.82).markets), a2 = JSON.stringify(ge.goalModelOutput(1.55, 0.82).markets);
  ok('determinista (misma λ → mismos mercados)', a1 === a2);

  console.log('\n§G DIAGNÓSTICO "2-0/1-1" (el modal NO es el pronóstico)');
  const cro = ge.goalModelOutput(1.55, 0.82);
  const modal = cro.top_scorelines[0];
  ok('el marcador modal concentra < 20% de la masa (mostrar solo el modal engaña)', cro.uncertainty.top1_concentration < 0.2);
  ok('top-3 marcadores concentran < 45% (distribución dispersa, no determinista)', cro.uncertainty.top3_concentration < 0.45);
  console.log(`     modal=${modal.score} (${(modal.probability*100).toFixed(1)}%) · top3=${(cro.uncertainty.top3_concentration*100).toFixed(1)}% · O2.5=${(cro.over_under.find(x=>x.line===2.5).over*100).toFixed(1)}% · BTTS=${(cro.btts.yes*100).toFixed(1)}%`);

  console.log(`\n[goal-engine] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
