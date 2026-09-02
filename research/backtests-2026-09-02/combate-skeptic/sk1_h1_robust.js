#!/usr/bin/env node
// ESCÉPTICO H1: ¿la mejora Elo puro → ACTUAL sobrevive a (a) t pareado real, (b) cambiar LR y warm (hiperparámetros
// elegidos sobre la misma muestra), (c) evaluar solo 2022+ (era del fit de producción)? Misma pasada que h2_features.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/combate/common.js');
const CE = require(C.REPO + '/combat-engine/ratings');
const { sigm, logit } = C;
const BASE = CE.ALL_FEATS.slice();
const missReal = (over) => Math.min(+over || 0, 5) / 2;

function pass(org, { warm = 0.35, lr = 0.01 } = {}) {
  const { fights, fighters } = C.loadFights(org);
  const { perFight } = C.fineJoin(fights);
  const { idx: WI } = C.weighIndex(org, fights);
  const w0 = Math.floor(fights.length * warm);
  const model = CE.newModel(null, {});
  const W = { elo: 1 }; for (const k of BASE) W[k] = 0;
  const rows = [];
  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
    const wi = WI[f.comp_id]; const o1 = wi && wi.f1 ? wi.f1.over : null, o2 = wi && wi.f2 ? wi.f2.over : null;
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, { sched: f.rounds_sched || 3 }); fd.misswt = missReal(o1) - missReal(o2);
    let z = W.elo * logit(pElo); for (const k of BASE) z += W[k] * fd[k];
    const p = sigm(z);
    if (i >= w0) rows.push({ d: f.date.slice(0, 10), bE: (pElo - y) ** 2, bA: (p - y) ** 2, hitE: (pElo >= 0.5) === (y === 1) ? 1 : 0, hitA: (p >= 0.5) === (y === 1) ? 1 : 0 });
    const g = p - y; W.elo -= lr * g * logit(pElo); for (const k of BASE) W[k] -= lr * g * fd[k];
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });
  return rows;
}
const summ = (rows, seed) => {
  const d = rows.map(r => r.bA - r.bE);
  const ps = C.pairedStats(d, seed, 2000);
  const m = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  return { n: rows.length, brier_elo: +m('bE').toFixed(5), brier_actual: +m('bA').toFixed(5), acc_elo: +m('hitE').toFixed(4), acc_actual: +m('hitA').toFixed(4), paired: ps };
};
const out = {};
for (const org of ['ufc', 'mma']) {
  out[org] = {};
  const base = pass(org);
  out[org]['warm0.35_lr0.01 (ACTUAL del agente)'] = summ(base, 1);
  out[org]['  solo 2022+'] = summ(base.filter(r => r.d >= '2022'), 2);
  out[org]['  solo 2024+'] = summ(base.filter(r => r.d >= '2024'), 3);
  for (const lr of [0.003, 0.03]) out[org][`warm0.35_lr${lr}`] = summ(pass(org, { lr }), 4);
  for (const warm of [0.5, 0.65]) out[org][`warm${warm}_lr0.01`] = summ(pass(org, { warm }), 5);
  // bloque temporal: t sobre medias por trimestre (peleas no independientes: mismos peleadores, misma cartelera)
  const q = {}; for (const r of base) { const k = r.d.slice(0, 4) + 'Q' + (Math.floor(+r.d.slice(5, 7) / 3.01) + 1); (q[k] = q[k] || []).push(r.bA - r.bE); }
  const qm = Object.values(q).filter(a => a.length >= 20).map(a => a.reduce((s, x) => s + x, 0) / a.length);
  const mu = qm.reduce((s, x) => s + x, 0) / qm.length; const sd = Math.sqrt(qm.reduce((s, x) => s + (x - mu) ** 2, 0) / (qm.length - 1));
  out[org]['t por bloques trimestrales (ΔBrier medio por trimestre)'] = { n_trimestres: qm.length, mean: +mu.toFixed(6), se: +(sd / Math.sqrt(qm.length)).toFixed(6), t: +(mu / (sd / Math.sqrt(qm.length))).toFixed(2), trimestres_con_mejora: qm.filter(x => x < 0).length };
  console.log(org, JSON.stringify(out[org], null, 1));
}
fs.writeFileSync(path.join(__dirname, 'sk1_h1_robust.json'), JSON.stringify(out, null, 1));
