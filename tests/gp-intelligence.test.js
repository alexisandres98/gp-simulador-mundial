// tests/gp-intelligence.test.js — harness reproducible de GP Intelligence (Sprint 0.1, B13).
// Ejecutar: node tests/gp-intelligence.test.js   (sin dependencias; usa engine + gpIntelligence).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const { matchProbs, probsFromLambdas, lambdas, simulateH2H, makeRng } = require(R + '/engine');
const G = require(R + '/data-providers/gpIntelligence');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const approx = (a, b, t = 0.02) => Math.abs(a - b) <= t;

const NOW = Date.UTC(2026, 5, 21, 12, 0, 0);
const FRESH = { form: new Date(NOW).toISOString(), injuries: new Date(NOW).toISOString(), squad: new Date(NOW).toISOString(), rest: new Date(NOW).toISOString() };

function form(played, results, gf, ga, cs, streak) {
  const pts = results.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  return { played, results, points: pts, goalsFor: gf, goalsAgainst: ga, cleanSheets: cs, avgFor: gf / played, avgAgainst: ga / played, streak };
}
function ctx(o = {}) { return { recentForm: o.form || null, injuries: o.injuries || [], keyPlayers: o.keyPlayers || [], providerStatus: { usedApiFootball: true }, tactical: o.tactical || null, ...o }; }

function runV2(eloA, eloB, ctxA, ctxB, exA = {}, exB = {}) {
  const csA = G.contextSignals(ctxA, 'A', { now: NOW, fetchedAt: FRESH, baseElo: eloA, ...exA });
  const csB = G.contextSignals(ctxB, 'B', { now: NOW, fetchedAt: FRESH, baseElo: eloB, ...exB });
  const [lAe, lBe] = lambdas(eloA + csA.finalCappedTotal, eloB + csB.finalCappedTotal);
  const [lA, lB, beta] = G.adjustedLambdas(lAe, lBe, csA.goalProfile, csB.goalProfile);
  const inputHash = G.hashInputs({ eloA, eloB, dA: csA.finalCappedTotal, dB: csB.finalCappedTotal, lA: +lA.toFixed(6), lB: +lB.toFixed(6), v: G.VERSIONS.challenger });
  const seed = G.deriveSeed(inputHash);
  const v2 = probsFromLambdas(lA, lB);
  const v2Line = { aWin: v2.home, draw: v2.draw, bWin: v2.away, xgA: lA, xgB: lB, likely: v2.likelyScore };
  const mc = simulateH2H(0, 0, 10000, makeRng(seed), [lA, lB]);
  const goals = G.goalsMarkets(mc, lA, lB);
  const base = matchProbs(eloA, eloB);
  const baseLine = { aWin: base.home, draw: base.draw, bWin: base.away, xgA: base.xgHome, xgB: base.xgAway };
  const sanity = G.mathSanity({ v2: v2Line, goals, mc, deltaA: csA.finalCappedTotal, deltaB: csB.finalCappedTotal });
  const analysis = G.buildH2HAnalysis({ a: { name: 'A', flag: '' }, b: { name: 'B', flag: '' }, base: baseLine, v2: v2Line, ctxA: csA, ctxB: csB, mc, goals, beta });
  return { csA, csB, lA, lB, beta, seed, inputHash, v2Line, mc, goals, baseLine, sanity, analysis };
}

console.log('GP Intelligence — harness Sprint 0.1\n');

// Caso 1 — equipos idénticos, cancha neutral → simetría
console.log('Caso 1 — equipos idénticos (simetría)');
{
  const f = form(5, ['W', 'D', 'W', 'L', 'D'], 7, 6, 1, '1D');
  const r = runV2(1800, 1800, ctx({ form: f }), ctx({ form: f }));
  ok('1X2 ~ simétrico', approx(r.v2Line.aWin, r.v2Line.bWin, 0.03), `(${r.v2Line.aWin.toFixed(3)} vs ${r.v2Line.bWin.toFixed(3)})`);
  ok('deltas iguales', r.csA.finalCappedTotal === r.csB.finalCappedTotal);
}

// Caso 2 — favorito muy fuerte → permite 3-0/4-0
console.log('Caso 2 — favorito fuerte (marcadores altos posibles)');
{
  const r = runV2(2050, 1450, ctx({ form: form(5, ['W', 'W', 'W', 'W', 'D'], 14, 3, 3, '1D') }), ctx({ form: form(5, ['L', 'L', 'D', 'L', 'D'], 3, 11, 0, '1D') }), { squadRating: { avg: 7.3, n: 13 } }, { squadRating: { avg: 6.6, n: 13 } });
  const highScores = r.mc.topScores.filter(s => s.score.split('-').reduce((a, x) => a + (+x), 0) >= 3);
  ok('aparecen marcadores de 3+ goles', highScores.length > 0, `top: ${r.mc.topScores.map(s => s.score).join(',')}`);
  ok('equipo fuerte puede meter 3+', r.goals.teamA.g3 > 0.1, `g3+=${(r.goals.teamA.g3 * 100).toFixed(0)}%`);
  ok('no se topa en 2-0 (over1.5 alto)', r.goals.over15 > 0.5);
}

// Caso 3 — contexto faltante
console.log('Caso 3 — datos faltantes (sin crash, ajuste 0, calidad baja)');
{
  const r = runV2(1800, 1750, null, null);
  ok('no crash y delta 0', r.csA.finalCappedTotal === 0 && r.csB.finalCappedTotal === 0);
  ok('data quality insuficiente', r.csA.dataQuality.level === 'Insuficiente', r.csA.dataQuality.level);
  ok('V2 ≈ V1 sin contexto', approx(r.v2Line.aWin, r.baseLine.aWin, 0.001));
}

// Caso 4 — lesión jugador clave vs suplente marginal
console.log('Caso 4 — lesión clave pesa más que suplente');
{
  const fA = form(5, ['W', 'W', 'D', 'W', 'D'], 9, 4, 2, '1D');
  const key = runV2(1800, 1800, ctx({ form: fA, injuries: [{ player: 'Estrella', status: 'injured' }], keyPlayers: [{ name: 'Estrella' }] }), ctx({ form: fA }));
  const sub = runV2(1800, 1800, ctx({ form: fA, injuries: [{ player: 'Suplente', status: 'injured' }], keyPlayers: [{ name: 'Otro' }] }), ctx({ form: fA }));
  const availKey = key.csA.factors.find(f => f.factorCode === 'AVAILABILITY').uncappedContribution;
  const availSub = sub.csA.factors.find(f => f.factorCode === 'AVAILABILITY').uncappedContribution;
  ok('clave penaliza más que suplente', availKey < availSub, `key=${availKey} sub=${availSub}`);
}

// Caso 5 — lesión stale se excluye
console.log('Caso 5 — info de lesión stale se excluye');
{
  const fA = form(5, ['W', 'W', 'D', 'W', 'D'], 9, 4, 2, '1D');
  const stale = { ...FRESH, injuries: new Date(NOW - 10 * 60 * 1000).toISOString() }; // 10 min → > STALE 5min
  const csStale = G.contextSignals(ctx({ form: fA, injuries: [{ player: 'X', status: 'injured' }], keyPlayers: [{ name: 'X' }] }), 'A', { now: NOW, fetchedAt: stale, baseElo: 1800 });
  const avail = csStale.factors.find(f => f.factorCode === 'AVAILABILITY');
  ok('lesión stale excluida', avail.included === false && avail.exclusionReason === 'stale', JSON.stringify({ inc: avail.included, r: avail.exclusionReason }));
  ok('stale no contribuye al Elo', avail.cappedContribution === 0);
}

// Caso 6 — ventaja de descanso acotada
console.log('Caso 6 — descanso acotado');
{
  const fA = form(5, ['W', 'D', 'W', 'L', 'D'], 7, 6, 1, '1D');
  const r = runV2(1800, 1800, ctx({ form: fA }), ctx({ form: fA }), { restDays: 9, oppRestDays: 2 }, { restDays: 2, oppRestDays: 9 });
  const rest = r.csA.factors.find(f => f.factorCode === 'REST');
  ok('descanso ≤ 10 Elo', Math.abs(rest.uncappedContribution) <= 10, `=${rest.uncappedContribution}`);
}

// Caso 7 — double counting limitado por cap de grupo
console.log('Caso 7 — anti double-counting (cap por grupo PERFORMANCE)');
{
  // forma pésima + racha de derrotas + fragilidad: todas PERFORMANCE, suma uncapped < -40
  const bad = ctx({ form: form(5, ['L', 'L', 'L', 'L', 'L'], 1, 14, 0, '5L') });
  const csBad = G.contextSignals(bad, 'A', { now: NOW, fetchedAt: FRESH, baseElo: 1800 });
  const perfUncapped = csBad.groupUncapped.PERFORMANCE;
  const perfCapped = csBad.groupCapped.PERFORMANCE;
  ok('uncapped PERFORMANCE más negativo que el cap', perfUncapped < -40, `uncapped=${perfUncapped}`);
  ok('capped PERFORMANCE = -40 (cap)', perfCapped === -40, `capped=${perfCapped}`);
  ok('total final dentro del safety cap', Math.abs(csBad.finalCappedTotal) <= G.CONFIG.maxEloAdjustment);
}

// Caso 8 — reproducibilidad
console.log('Caso 8 — reproducibilidad (misma seed → mismo output)');
{
  const f1 = form(5, ['W', 'W', 'D', 'L', 'W'], 10, 5, 2, '1W');
  const a = runV2(1900, 1700, ctx({ form: f1 }), ctx({ form: form(5, ['D', 'L', 'W', 'D', 'L'], 6, 8, 1, '1L') }));
  const b = runV2(1900, 1700, ctx({ form: f1 }), ctx({ form: form(5, ['D', 'L', 'W', 'D', 'L'], 6, 8, 1, '1L') }));
  ok('mismo inputHash', a.inputHash === b.inputHash);
  ok('misma seed', a.seed === b.seed);
  ok('mismo Monte Carlo (avgTotal idéntico)', a.mc.avgTotal === b.mc.avgTotal, `${a.mc.avgTotal} vs ${b.mc.avgTotal}`);
  ok('mismos topScores', JSON.stringify(a.mc.topScores) === JSON.stringify(b.mc.topScores));
}

// Caso 9 — sanity de totales (monotonicidad)
console.log('Caso 9 — sanity totales monotónicos + 1X2');
{
  const r = runV2(1950, 1500, ctx({ form: form(5, ['W', 'W', 'W', 'D', 'W'], 12, 4, 3, '1W') }), ctx({ form: form(5, ['L', 'D', 'L', 'D', 'L'], 4, 9, 0, '1L') }));
  ok('sanity.ok', r.sanity.ok, JSON.stringify(r.sanity.errors));
  ok('O1.5≥O2.5≥O3.5', r.goals.over15 >= r.goals.over25 && r.goals.over25 >= r.goals.over35);
  ok('1X2 suma ~1', approx(r.v2Line.aWin + r.v2Line.draw + r.v2Line.bWin, 1));
  ok('BTTS en [0,1]', r.goals.btts >= 0 && r.goals.btts <= 1);
}

// Caso 10 — V1 vs V2 + delta
console.log('Caso 10 — comparación V1 control vs V2 challenger');
{
  const r = runV2(1850, 1780, ctx({ form: form(5, ['W', 'W', 'W', 'W', 'D'], 11, 3, 3, '1D') }), ctx({ form: form(5, ['L', 'D', 'L', 'L', 'D'], 3, 8, 0, '1D') }));
  ok('V1 presente', r.baseLine.aWin > 0);
  ok('V2 presente', r.v2Line.aWin > 0);
  const dec = r.analysis.decomposition;
  ok('delta pp presente y coherente', approx(dec.deltaPp.aWin / 100, r.v2Line.aWin - r.baseLine.aWin, 0.005), JSON.stringify(dec.deltaPp));
  ok('contexto mueve V2 (forma A buena)', r.v2Line.aWin > r.baseLine.aWin);
  ok('modelConfidence separada de dataQuality', !!r.analysis.headline.modelConfidence && !!r.analysis.headline.dataQuality);
}

// Caso 11 — no regresión del modelo global (V1 determinístico congelado)
console.log('Caso 11 — no regresión global (V1 congelado)');
{
  const p1 = matchProbs(2125, 1438);
  const p2 = matchProbs(2125, 1438);
  ok('matchProbs determinístico', JSON.stringify(p1) === JSON.stringify(p2));
  // snapshot congelado del modelo global V1 (neutral, con calibración λ=0.15). Detecta drift accidental.
  ok('V1 home dentro de snapshot esperado', approx(p1.home, 0.7481, 0.005), `home=${p1.home.toFixed(4)}`);
  ok('likelyScore favorece al fuerte', /^[2-9]-0$/.test(p1.likelyScore) || p1.home > 0.6, p1.likelyScore);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} GP Intelligence: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
