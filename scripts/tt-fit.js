#!/usr/bin/env node
// scripts/tt-fit.js — VALIDACIÓN WALK-FORWARD del modelo de tenis de mesa y congelado de constantes
//
//   node scripts/tt-fit.js [--dev-from=20230101] [--dev-to=20260101] [--holdout-from=20260101] [--write]
//
// Protocolo (blueprint 9.0, bloque 15): cada partido se predice ANTES de que su resultado toque los ratings
// (point-in-time puro), con una rejilla de constantes elegida SOLO en el tramo de desarrollo; el holdout
// (2026 por defecto) se mira una vez y se publica tal cual. Se evalúan tres probabilidades de ganador —
// Elo de partido, compilador desde el rating de punto, mezcla — y las superficies que el mercado cotiza:
// games totales, puntos totales, marcador exacto y frecuencia de deuce, contra la referencia naif.
// Solo partidos de mayores (MS/WS), sin retiradas, con los dos jugadores "templados" (≥ warmN partidos).
// `--write` congela las constantes ganadoras en data/tt/model-priors.json (el motor las lee al arrancar).
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('../tt-engine/data');
const C = require('../tt-engine/compiler');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const DEV_FROM = +(args['dev-from'] || 20230101), DEV_TO = +(args['dev-to'] || 20260101), HO_FROM = +(args['holdout-from'] || 20260101);
const logit = (p) => Math.log(p / (1 - p)), sig = (x) => 1 / (1 + Math.exp(-x)), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (x) => +x.toFixed(3), r4 = (x) => +x.toFixed(4);

const base = D.build();
const F = base.F, rows = base.rows, tourneys = base.tourneys;
console.log('base', rows.length, 'partidos ·', Object.keys(base.players).length, 'jugadores · ventana', base.meta.years, '· desarrollo', DEV_FROM, '→', DEV_TO, '· holdout ≥', HO_FROM);

// una pasada con unas constantes → predicciones point-in-time en las dos ventanas
function run(cst, { collect = 'both' } = {}) {
  const dev = [], ho = [];
  const warm = cst.warmN;
  D.replay(rows, F, tourneys, cst, (r, pr) => {
    const date = r[F.date];
    if (r[F.ret] || !(r[F.sub] === 'MS' || r[F.sub] === 'WS')) return;
    const tq = tourneys[r[F.tid]] || {}; if (tq.youth || tq.tier === 'youth') return;
    if (pr.nA < warm || pr.nB < warm) return;
    if (!pr.bo || pr.games.length < 3) return;
    const inDev = date >= DEV_FROM && date < DEV_TO, inHo = date >= HO_FROM;
    if (!inDev && !inHo) return;
    if (collect === 'dev' && !inDev) return;
    // orientación aleatoria pero determinista (para que el ganador no sea siempre "A")
    const flip = (parseInt(String(r[F.wid]).slice(-2), 10) + parseInt(String(r[F.lid]).slice(-2), 10)) % 2 === 1;
    const y = flip ? 0 : 1; // A gana?
    const pElo = flip ? 1 - pr.pElo : pr.pElo;
    const pPt0 = sig((flip ? -1 : 1) * (pr.thA - pr.thB));
    // DOS ESCALAS (blueprint 12.3: un ganador calibrado no identifica la superficie de totales): la del ganador
    // (pointScale, entra a la mezcla) y la de las DISTRIBUCIONES (pointScaleDist: games, puntos, marcador, deuce)
    const pPt = 0.5 + cst.pointScale * (pPt0 - 0.5);
    const pPtD = 0.5 + (cst.pointScaleDist || cst.pointScale) * (pPt0 - 0.5);
    // redondeo a 3 decimales: el compilador cachea por clave y así la rejilla entera reutiliza ~2.000 compilaciones
    const a = +clamp(pPt + cst.serveDelta, 0.02, 0.98).toFixed(3), b = +clamp(pPt - cst.serveDelta, 0.02, 0.98).toFixed(3);
    const pC = clamp(C.compileMatch(a, b, { best_of: pr.bo }).p_a, 1e-4, 1 - 1e-4);
    const aD = +clamp(pPtD + cst.serveDelta, 0.02, 0.98).toFixed(3), bD = +clamp(pPtD - cst.serveDelta, 0.02, 0.98).toFixed(3);
    const mm = C.compileMatch(aD, bD, { best_of: pr.bo });
    const gTot = r[F.wg] + r[F.lg];
    const pts = pr.pw + pr.pl;
    const deuces = pr.games.filter(([x, z]) => x + z >= 22).length;
    const scoreKey = flip ? `${r[F.lg]}-${r[F.wg]}` : `${r[F.wg]}-${r[F.lg]}`;
    const rec = { y, pElo: clamp(pElo, 1e-4, 1 - 1e-4), pC, bo: pr.bo, gTot, expG: mm.exp_games, pts, expPts: mm.exp_points, nGames: pr.games.length, deuces, pDeuce: mm.per_game[0].p_deuce, pScore: C.at(mm.score, scoreKey), pOver: C.over(mm.games_total, pr.bo === 7 ? 5.5 : 3.5), over: gTot > (pr.bo === 7 ? 5.5 : 3.5) ? 1 : 0, sweepP: C.at(mm.score, `${mm.format.need}-0`) + C.at(mm.score, `0-${mm.format.need}`), sweep: gTot === mm.format.need ? 1 : 0 };
    if (inDev) dev.push(rec); else ho.push(rec);
  });
  return { dev, ho };
}
function metrics(recs, u) {
  const out = { n: recs.length };
  if (!recs.length) return out;
  const mix = (r) => sig((1 - u) * logit(r.pElo) + u * logit(r.pC));
  const ll = (f) => -recs.reduce((s, r) => { const p = clamp(f(r), 1e-4, 1 - 1e-4); return s + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / recs.length;
  const brier = (f) => recs.reduce((s, r) => s + (f(r) - r.y) ** 2, 0) / recs.length;
  const auc = (f) => { const pos = recs.filter((r) => r.y).map(f), neg = recs.filter((r) => !r.y).map(f); if (!pos.length || !neg.length) return null; pos.sort((x, y) => x - y); let s = 0; for (const q of neg) { let lo = 0, hi = pos.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (pos[mid] <= q) lo = mid + 1; else hi = mid; } let eq = 0; for (let i = lo - 1; i >= 0 && pos[i] === q; i--) eq++; s += (pos.length - lo) + 0.5 * eq; } return s / (pos.length * neg.length); };
  const base50 = Math.log(2);
  for (const [k, f] of [['elo', (r) => r.pElo], ['compiled', (r) => r.pC], ['ensemble', mix]]) {
    const l = ll(f); out[k] = { logloss: r4(l), skill_pct: r3(100 * (1 - l / base50)), brier: r4(brier(f)), auc: r3(auc(f)) };
  }
  // superficies
  const mae = (f, g) => recs.reduce((s, r) => s + Math.abs(f(r) - g(r)), 0) / recs.length;
  const meanG = recs.reduce((s, r) => s + r.gTot, 0) / recs.length, meanP = recs.reduce((s, r) => s + r.pts, 0) / recs.length;
  out.games = { mean_real: r3(meanG), mean_model: r3(recs.reduce((s, r) => s + r.expG, 0) / recs.length), mae: r3(mae((r) => r.expG, (r) => r.gTot)), mae_naive: r3(mae(() => meanG, (r) => r.gTot)) };
  out.points = { mean_real: r3(meanP), mean_model: r3(recs.reduce((s, r) => s + r.expPts, 0) / recs.length), mae: r3(mae((r) => r.expPts, (r) => r.pts)), mae_naive: r3(mae(() => meanP, (r) => r.pts)) };
  const gN = recs.reduce((s, r) => s + r.nGames, 0);
  out.deuce = { rate_real: r4(recs.reduce((s, r) => s + r.deuces, 0) / gN), rate_model: r4(recs.reduce((s, r) => s + r.pDeuce * r.nGames, 0) / gN) };
  out.over_line = { real: r4(recs.reduce((s, r) => s + r.over, 0) / recs.length), model: r4(recs.reduce((s, r) => s + r.pOver, 0) / recs.length), brier: r4(recs.reduce((s, r) => s + (r.pOver - r.over) ** 2, 0) / recs.length), brier_naive: r4((() => { const m = recs.reduce((s, r) => s + r.over, 0) / recs.length; return recs.reduce((s, r) => s + (m - r.over) ** 2, 0) / recs.length; })()) };
  out.sweep = { real: r4(recs.reduce((s, r) => s + r.sweep, 0) / recs.length), model: r4(recs.reduce((s, r) => s + r.sweepP, 0) / recs.length) };
  out.correct_score = { logloss: r4(-recs.reduce((s, r) => s + Math.log(clamp(r.pScore, 1e-4, 1)), 0) / recs.length), logloss_uniform: r4(Math.log(6)) };
  return out;
}

(async () => {
  const t0 = Date.now();
  const grid = [];
  for (const kScale of [0.7, 1.0, 1.4]) for (const pointEta of [0.02, 0.04, 0.08]) for (const pointNorm of [0.5, 1.0]) for (const pointScale of [0.5, 0.65, 0.8, 1.0]) grid.push({ kScale, pointEta, pointNorm, pointScale });
  const results = [];
  let best = null;
  for (const g of grid) {
    const cst = { ...D.DEFAULT_PRIORS.constants, ...g };
    const { dev } = run(cst, { collect: 'dev' });
    let bestU = null;
    for (const u of [0, 0.25, 0.5, 0.75, 1]) { const m = metrics(dev, u); if (!bestU || m.ensemble.logloss < bestU.m.ensemble.logloss) bestU = { u, m }; }
    const row = { ...g, u: bestU.u, n: dev.length, logloss: bestU.m.ensemble.logloss, skill_pct: bestU.m.ensemble.skill_pct, games_mae: bestU.m.games.mae, points_mae: bestU.m.points.mae, deuce: bestU.m.deuce };
    results.push(row);
    if (!best || row.logloss < best.logloss) best = { ...row, cst: { ...cst, ensembleU: bestU.u } };
    console.log('grid', JSON.stringify(row));
  }
  console.log('\nMEJOR EN DESARROLLO', JSON.stringify(best));
  // 2ª etapa: la dispersión de las DISTRIBUCIONES, con el ganador ya fijado
  let bestD = null;
  for (const dist of [0.8, 1.0, 1.15, 1.3, 1.5, 1.7]) {
    const cst = { ...best.cst, pointScaleDist: dist };
    const m = metrics(run(cst, { collect: 'dev' }).dev, cst.ensembleU);
    const score = m.games.mae + m.points.mae / 20 + 2 * Math.abs(m.sweep.model - m.sweep.real) + 2 * Math.abs(m.deuce.rate_model - m.deuce.rate_real) + 2 * Math.abs(m.over_line.model - m.over_line.real);
    console.log('dist', dist, JSON.stringify({ score: r4(score), games_mae: m.games.mae, points_mae: m.points.mae, sweep: m.sweep, deuce: m.deuce, over: m.over_line, ml_logloss: m.ensemble.logloss }));
    if (!bestD || score < bestD.score) bestD = { dist, score };
  }
  best.cst.pointScaleDist = bestD.dist;
  console.log('MEJOR DISPERSIÓN', JSON.stringify(bestD));
  // holdout, una sola vez, con las constantes ganadoras
  const { dev, ho } = run(best.cst);
  const mDev = metrics(dev, best.cst.ensembleU), mHo = metrics(ho, best.cst.ensembleU);
  console.log('\nDESARROLLO', JSON.stringify(mDev, null, 1));
  console.log('\nHOLDOUT', JSON.stringify(mHo, null, 1));
  const priors = {
    model_version: 'tt-l1-1', fitted_at: new Date().toISOString(),
    constants: { kScale: best.cst.kScale, pointEta: best.cst.pointEta, pointNorm: best.cst.pointNorm, pointScale: best.cst.pointScale, pointScaleDist: best.cst.pointScaleDist, serveDelta: best.cst.serveDelta, ensembleU: best.cst.ensembleU, youthWeight: best.cst.youthWeight, warmN: best.cst.warmN },
    development: { from: DEV_FROM, to: DEV_TO, n: mDev.n, best: mDev.ensemble, elo: mDev.elo, compiled: mDev.compiled, games: mDev.games, points: mDev.points, deuce: mDev.deuce, grid: 'kScale ∈ {0,7; 1; 1,4} × pointEta ∈ {0,02; 0,04; 0,08} × pointNorm ∈ {0,5; 1} × pointScale ∈ {0,5; 0,65; 0,8; 1} × u ∈ {0; 0,25; 0,5; 0,75; 1}; 2ª etapa pointScaleDist ∈ {0,8 … 1,7} por MAE de games/puntos y sesgo de barridas/deuce', protocol: 'walk-forward point-in-time: cada partido predicho antes de actualizar; Elo de partido + rating de punto → compilador exacto; rejilla elegida por log-loss del ganador en desarrollo; holdout intocable' },
    holdout: { from: HO_FROM, n: mHo.n, elo: mHo.elo, compiled: mHo.compiled, ensemble: mHo.ensemble, games: mHo.games, points: mHo.points, deuce: mHo.deuce, over_line: mHo.over_line, sweep: mHo.sweep, correct_score: mHo.correct_score, protocol: 'mismas constantes; partidos de mayores 2026 sin retiradas con ambos jugadores ≥ warmN partidos previos' },
    base: { rows: rows.length, players: Object.keys(base.players).length, built_at: base.meta.built_at, last_match_date: base.meta.last_match_date },
    ms: Date.now() - t0,
  };
  if (args.write) { const p = path.join(D.REPO_BASE, 'model-priors.json'); fs.writeFileSync(p, JSON.stringify(priors, null, 1)); console.log('\ncongelado →', p); }
  else console.log('\n(sin --write no se congela nada)');
})();
