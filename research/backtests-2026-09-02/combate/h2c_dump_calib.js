#!/usr/bin/env node
/**
 * H2c — Calibración del ACTUAL en un marco SIMÉTRICO (favorito del modelo), inmune al orden f1/f2 de ESPN
 * (que en el histórico es POST-HOC: 15 de 48 picks tienen el orden invertido respecto al archivo completado).
 * Una pasada walk-forward del ACTUAL (pesaje real), dump por pelea OOS y tablas: calibración del favorito
 * por tramo de p, por min(N), por era, y sobreconfianza = (p_fav medio − tasa real del favorito).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./common');
const CE = require(C.REPO + '/combat-engine/ratings');
const { sigm, logit, divGroup } = C;
const WARM = 0.35, FEAT_LR = 0.01;
const BASE = CE.ALL_FEATS.slice();
const missReal = (over) => Math.min(+over || 0, 5) / 2;
const out = {};
for (const org of ['ufc', 'mma']) {
  const { fights, fighters } = C.loadFights(org);
  const { perFight } = C.fineJoin(fights);
  const { idx: WI } = C.weighIndex(org, fights);
  const warm = Math.floor(fights.length * WARM);
  const model = CE.newModel(null, {});
  const W = { elo: 1 }; for (const k of BASE) W[k] = 0;
  const rows = [];
  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const pr = CE.fightProb(model, f.f1.id, f.f2.id, f.date); const pElo = pr.p1;
    const wi = WI[f.comp_id]; const o1 = wi && wi.f1 ? wi.f1.over : null, o2 = wi && wi.f2 ? wi.f2.over : null;
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, { sched: f.rounds_sched || 3 }); fd.misswt = missReal(o1) - missReal(o2);
    let z = W.elo * logit(pElo); for (const k of BASE) z += W[k] * fd[k];
    const p = sigm(z);
    if (i >= warm) rows.push({ d: f.date.slice(0, 10), p: +p.toFixed(4), pe: +pElo.toFixed(4), y, nmin: Math.min(model.N[f.f1.id] || 0, model.N[f.f2.id] || 0), g: divGroup(f.weight), sched: f.rounds_sched || 3 });
    const gA = p - y; W.elo -= FEAT_LR * gA * logit(pElo); for (const k of BASE) W[k] -= FEAT_LR * gA * fd[k];
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });
  fs.writeFileSync(path.join(__dirname, `h2c_oos_${org}.json`), JSON.stringify(rows));
  // marco del favorito del modelo
  const fav = rows.map(r => ({ pf: Math.max(r.p, 1 - r.p), yf: (r.p >= 0.5) === (r.y === 1) ? 1 : 0, pfe: Math.max(r.pe, 1 - r.pe), yfe: (r.pe >= 0.5) === (r.y === 1) ? 1 : 0, ...r }));
  const table = (arr, key = 'pf', yk = 'yf') => {
    const B = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 0.8], [0.8, 0.9], [0.9, 1.01]];
    return B.map(([a, b]) => { const s = arr.filter(r => r[key] >= a && r[key] < b); return s.length >= 30 ? { bucket: `${a}-${b > 1 ? 1 : b}`, n: s.length, pred: +(s.reduce((q, r) => q + r[key], 0) / s.length).toFixed(3), real: +(s.reduce((q, r) => q + r[yk], 0) / s.length).toFixed(3) } : null; }).filter(Boolean);
  };
  const over = (arr, key = 'pf', yk = 'yf') => arr.length ? { n: arr.length, pred_fav: +(arr.reduce((q, r) => q + r[key], 0) / arr.length).toFixed(4), real_fav: +(arr.reduce((q, r) => q + r[yk], 0) / arr.length).toFixed(4), gap_pp: +((arr.reduce((q, r) => q + r[key], 0) - arr.reduce((q, r) => q + r[yk], 0)) / arr.length * 100).toFixed(2) } : null;
  const nb = (n) => (n < 3 ? 'lt3' : n <= 5 ? '3-5' : n <= 10 ? '6-10' : 'gt10');
  out[org] = {
    n: rows.length,
    overall_actual: over(fav), overall_elo: over(fav, 'pfe', 'yfe'),
    era_2020_actual: over(fav.filter(r => r.d >= '2020')), era_2020_elo: over(fav.filter(r => r.d >= '2020'), 'pfe', 'yfe'),
    n3_actual: over(fav.filter(r => r.nmin >= 3)), n3_2020_actual: over(fav.filter(r => r.nmin >= 3 && r.d >= '2020')),
    cal_fav_actual: table(fav), cal_fav_elo: table(fav, 'pfe', 'yfe'), cal_fav_actual_2020: table(fav.filter(r => r.d >= '2020')),
    by_nmin: Object.fromEntries(['lt3', '3-5', '6-10', 'gt10'].map(b => [b, over(fav.filter(r => nb(r.nmin) === b))])),
    by_div: Object.fromEntries(['women', 'hw', 'lhw_mw', 'ww_lw', 'fw_bw_flw', 'other'].map(g => [g, over(fav.filter(r => r.g === g))])),
    // cuando el modelo con features se separa MUCHO del Elo puro (|p − pElo| ≥ 0.10): ¿acierta la separación?
    bold: (() => { const s = fav.filter(r => Math.abs(r.p - r.pe) >= 0.10); const agree = s.filter(r => (r.p >= 0.5) === (r.pe >= 0.5)); const flip = s.filter(r => (r.p >= 0.5) !== (r.pe >= 0.5)); return { n: s.length, brier_actual: +(s.reduce((q, r) => q + (r.p - r.y) ** 2, 0) / s.length).toFixed(4), brier_elo: +(s.reduce((q, r) => q + (r.pe - r.y) ** 2, 0) / s.length).toFixed(4), flips: { n: flip.length, model_right: flip.filter(r => (r.p >= 0.5) === (r.y === 1)).length }, agree_overconf: over(agree) }; })(),
  };
  console.log(org, JSON.stringify(out[org], null, 1));
}
fs.writeFileSync(path.join(__dirname, 'h2c_results.json'), JSON.stringify(out, null, 1));
