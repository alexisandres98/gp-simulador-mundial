// tests/goal-gates.test.js — Goles G4. Calibración por familia + gate de publicación. PURO.
// Verifica: familyCalibration acumula bien (Brier/log-loss/calibración) por familia desde records con lambdas +
// marcador real; applyGates decide approved/shadow/informational por thresholds; report() arma la estructura.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const gg = require(R + '/calibration/goalGates');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  console.log('\n§G4 CALIBRACIÓN POR FAMILIA (desde records sintéticos)');
  // 60 records: lambdas fijas (1.7/1.1) y marcadores variados pero plausibles.
  const scores = [[1, 1], [2, 1], [2, 0], [1, 0], [0, 0], [3, 1], [2, 2], [1, 2], [3, 0], [0, 1]];
  const records = [];
  for (let i = 0; i < 60; i++) { const s = scores[i % scores.length]; records.push({ lambdas: { home: 1.7, away: 1.1 }, hg: s[0], ag: s[1], total: s[0] + s[1] }); }
  const fam = gg.familyCalibration(records);
  ok('familias presentes (TOTALS/BTTS/TEAM_TOTALS/WINNING_MARGIN)', ['TOTALS', 'BTTS', 'TEAM_TOTALS', 'WINNING_MARGIN'].every(f => fam[f]));
  ok('cada familia con sample > 0 y brier ∈ [0,1]', Object.values(fam).every(m => m.sample > 0 && m.brier >= 0 && m.brier <= 1));
  ok('calibration_error >= 0 y observed ∈ [0,1]', Object.values(fam).every(m => m.calibration_error >= 0 && m.observed >= 0 && m.observed <= 1));
  ok('TOTALS samplea 3 mercados × 60 = 180', fam.TOTALS.sample === 180);
  ok('BTTS samplea 60', fam.BTTS.sample === 60);

  console.log('\n§G4 SANITY: mercado que SIEMPRE gana → observed = 1, Brier bajo si pred alto');
  // Over 0.5 con marcadores siempre >=1 gol: usamos un mercado de la familia y un set con muchos goles.
  const hi = []; for (let i = 0; i < 50; i++) hi.push({ lambdas: { home: 2.2, away: 1.6 }, hg: 2, ag: 1, total: 3 }); // total 3 → Over 1.5/2.5 ganan
  const famHi = gg.familyCalibration(hi);
  ok('con total 3 fijo, TOTALS observed alto (>0.6)', famHi.TOTALS.observed > 0.6);

  console.log('\n§G4 GATE (approved / shadow / informational)');
  const th = { minSample: 40, maxBrier: 0.25, maxCalErr: 0.06 };
  const g1 = gg.applyGates({ TOTALS: { sample: 180, brier: 0.20, calibration_error: 0.03, avg_pred: 0.5, observed: 0.5, log_loss: 0.6 } }, th);
  ok('familia buena (muestra+brier+calib ok) → approved', g1.TOTALS.status === 'approved' && g1.TOTALS.blockers.length === 0);
  const g2 = gg.applyGates({ X: { sample: 10, brier: 0.20, calibration_error: 0.03 } }, th);
  ok('muestra insuficiente → shadow', g2.X.status === 'shadow' && g2.X.blockers.includes('insufficient_sample'));
  const g3 = gg.applyGates({ X: { sample: 100, brier: 0.31, calibration_error: 0.02 } }, th);
  ok('Brier alto → shadow (brier_too_high)', g3.X.status === 'shadow' && g3.X.blockers.includes('brier_too_high'));
  const g4 = gg.applyGates({ X: { sample: 100, brier: 0.20, calibration_error: 0.12 } }, th);
  ok('mal calibrada → shadow (miscalibrated)', g4.X.status === 'shadow' && g4.X.blockers.includes('miscalibrated'));
  ok('EXACT_SCORE siempre informational', g1.EXACT_SCORE.status === 'informational');

  console.log('\n§G4 REPORT (replay + gate end-to-end, sin DB)');
  const rep = gg.report({ results: {} }); // sin resultados → replay vacío, estructura válida
  ok('report tiene families + approved_families + policy_version', rep.families && Array.isArray(rep.approved_families) && rep.policy_version === 'goal-gate-1');
  ok('replay_sample = 0 con results vacío', rep.replay_sample === 0);

  console.log(`\n[goal-gates] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
