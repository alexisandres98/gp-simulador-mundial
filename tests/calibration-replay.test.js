// tests/calibration-replay.test.js — Fase M.3/M.7/G.6. Replay point-in-time + métricas V1/goles + ajuste de
// calibración. Verifica ANTI-LEAKAGE (Elos pre-partido cronológicos) e imprime el reporte de calibración.
'use strict';
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const { pointInTimeReplay, baseElos } = require(R + '/calibration/replay');
const M = require(R + '/calibration/metrics');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  let db; try { db = JSON.parse(fs.readFileSync(process.env.DB_FILE || path.join(R, 'db.json'), 'utf8')); } catch { db = { results: {} }; }
  const records = pointInTimeReplay({ results: db.results || {} });
  console.log(`\n§M.3 REPLAY POINT-IN-TIME (${records.length} partidos finales)`);
  ok('hay registros de replay (>0)', records.length > 0);
  const base = baseElos();
  // anti-leakage: el primer partido usa EXACTAMENTE los Elos base (ningún resultado previo aplicado)
  if (records.length) {
    const f0 = records[0];
    ok('1er partido: pre_elo == base (sin información previa)', f0.pre_elo_home === base[f0.home] && f0.pre_elo_away === base[f0.away]);
  }
  // anti-leakage: algún equipo con ≥2 partidos tiene pre_elo distinto del base en el 2º (Elo evolucionó cronológicamente)
  const seen = {}; let evolved = false;
  for (const r of records) { if (seen[r.home] && r.pre_elo_home !== base[r.home]) evolved = true; seen[r.home] = true; seen[r.away] = true; }
  ok('Elos evolucionan cronológicamente (no se usan Elos finales)', evolved || records.length < 2);

  if (records.length >= 5) {
    console.log('\n§M.3 MÉTRICAS V1 (1X2, point-in-time)');
    const v1 = M.v1Metrics(records);
    console.log('   ' + JSON.stringify({ sample: v1.sample, brier: v1.brier, log_loss: v1.log_loss, ece: v1.ece, draw_bias: v1.draw_bias, favorite_hit_rate: v1.favorite_hit_rate }));
    console.log('   base rates obs:', JSON.stringify(v1.observed_base_rates), 'pred:', JSON.stringify(v1.predicted_avg));
    console.log('   por |elo_diff|:', JSON.stringify(v1.by_elo_diff));
    ok('Brier V1 válido (0..2)', v1.brier > 0 && v1.brier < 2);
    ok('log loss V1 válido', v1.log_loss > 0 && isFinite(v1.log_loss));

    console.log('\n§M.3 AJUSTE DE CALIBRACIÓN (búsqueda de λ que minimiza log loss)');
    const fit = M.fitCalibration(records);
    const current = M.v1Metrics(records).log_loss; // con calib actual (λ=0.15)
    console.log('   λ óptimo:', fit.lambda, '· log loss con λ óptimo:', fit.log_loss, '· log loss actual (λ=0.15):', current);
    ok('fit produce un λ en [0,0.5]', fit.lambda >= 0 && fit.lambda <= 0.5);

    console.log('\n§G.6 MÉTRICAS DE GOLES (point-in-time)');
    const g = M.goalMetrics(records);
    console.log('   total esperado pred:', g.expected_total_predicted, 'real:', g.expected_total_actual, '· var pred(dist):', g.variance_predicted_distribution, 'real:', g.variance_actual);
    console.log('   RPS:', g.rps, '· exact-score hit:', g.exact_score_hit_rate, '· top3 hit:', g.top3_score_hit_rate, '· avg modal conc:', g.avg_top1_concentration);
    console.log('   O/U 2.5:', JSON.stringify(g.over_under.over_2_5), '· BTTS:', JSON.stringify(g.btts));
    console.log('   modal scores:', JSON.stringify(g.modal_distribution));
    ok('RPS válido (>0)', g.rps > 0 && isFinite(g.rps));
    ok('marcador modal concentra poco (avg top1 < 0.2) → mostrar solo el modal engaña', g.avg_top1_concentration < 0.2);
    ok('O/U 2.5 calibración razonable (|pred-real| < 0.25)', Math.abs(g.over_under.over_2_5.predicted_over - g.over_under.over_2_5.actual_over) < 0.25);
  } else {
    console.log('   (muestra < 5: se omiten métricas detalladas)');
  }

  console.log(`\n[calibration-replay] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
