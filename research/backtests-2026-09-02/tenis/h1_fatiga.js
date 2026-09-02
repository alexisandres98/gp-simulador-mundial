// H1 — fatiga y calendario como término aditivo en el logit del ensamble.
// z = b1·logit(p_ens) + Σ b_k·(f_k(X) − f_k(Y))   (sin intercepto: simetría por construcción)
// Ajuste en desarrollo (2018-01-01 → 2024-12-31), evaluación en holdout (2025-01-01 →), ATP y WTA aparte.
// Ojo: en la espina de Sackmann `date` es la fecha de INICIO del torneo, así que "días de descanso" es
// grueso (torneo a torneo) y el orden dentro del torneo lo da la ronda. Minutos: −1 = desconocido (cola ESPN).
'use strict';
const P = require('./pass.js'); const fs = require('fs');
const DEV0 = 20180101, DEV1 = 20250101, SPINE_END = 20260526;
const r4 = (x) => Math.round(x * 1e4) / 1e4, r3 = (x) => Math.round(x * 1e3) / 1e3;

function feats(p, meanMin) {
  const one = (f) => {
    const pm = f.prevMin > 0 ? f.prevMin : meanMin;
    return {
      n7: f.n7, n14: f.n14, tMatches: f.tMatches, tMinH: f.tMin / 60, prevMinH: pm / 60, prevMiss: f.prevMin > 0 ? 0 : 1,
      prevDec: f.prevDec, restL: Math.log1p(Math.min(30, f.rest)), newP: f.newP, sameT: f.sameT,
      ageD: ((f.age != null ? f.age : 26) - 26) / 5, ageOld: Math.max(0, (f.age != null ? f.age : 26) - 30) / 5, ageYoung: Math.max(0, 22 - (f.age != null ? f.age : 26)) / 5,
    };
  };
  const a = one(p.fX), b = one(p.fY);
  const d = {}; for (const k of Object.keys(a)) d[k] = a[k] - b[k];
  return d;
}
const SETS = {
  recal: [],
  fatiga: ['n7', 'tMatches', 'tMinH', 'prevMinH', 'prevMiss', 'prevDec', 'restL'],
  fatiga_min: ['n7', 'prevDec', 'restL'], // sin minutos: robusto a la cola ESPN
  fatiga_new: ['n7', 'tMatches', 'tMinH', 'prevMinH', 'prevMiss', 'prevDec', 'restL', 'newP'],
  edad: ['ageD', 'ageOld', 'ageYoung'], // extra (no pedido): edad como término del logit
  fatiga_min_edad: ['n7', 'prevDec', 'restL', 'ageD', 'ageOld', 'ageYoung'],
};

function fitEval(dev, ho, keys, u, meanMin) {
  const X = (arr) => arr.map((p) => { const d = feats(p, meanMin); return [P.logit(P.clamp(P.ens(p, u), 1e-4, 1 - 1e-4)), ...keys.map((k) => d[k])]; });
  const Xd = X(dev), yd = dev.map((p) => p.y);
  const { b, se } = P.logreg(Xd, yd, 1e-3);
  const Xh = X(ho);
  const ph = Xh.map((row) => P.sig(row.reduce((s, v, j) => s + v * b[j], 0)));
  return { b, se, ph };
}

const OUT = {};
for (const tour of [0, 1]) {
  const lbl = tour === 0 ? 'atp' : 'wta';
  const all = JSON.parse(fs.readFileSync(__dirname + `/preds_${lbl}.json`, 'utf8')).filter((p) => !p.isRet);
  const u = P.frozen(tour).u;
  const dev = all.filter((p) => p.date >= DEV0 && p.date < DEV1);
  const hoAll = all.filter((p) => p.date >= DEV1);
  const hoSpine = hoAll.filter((p) => p.date < SPINE_END);
  const mm = dev.filter((p) => p.minutes > 0).map((p) => p.minutes); const meanMin = mm.reduce((a, b) => a + b, 0) / mm.length;
  console.log(`\n══════ ${lbl.toUpperCase()} ══════ dev n=${dev.length} · holdout n=${hoAll.length} (espina ${hoSpine.length}) · minutos medios dev ${meanMin.toFixed(1)}`);
  // descriptivo de los rasgos (dev): media y sd de la diferencia
  const D = dev.map((p) => feats(p, meanMin));
  for (const k of [...SETS.fatiga_new, ...SETS.edad]) { const v = D.map((d) => d[k]); const m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length); console.log(`  rasgo ${k}: media dif ${m.toFixed(3)} sd ${sd.toFixed(3)}`); }
  OUT[lbl] = { n_dev: dev.length, n_ho: hoAll.length, n_ho_spine: hoSpine.length, variants: {} };
  const base = { all: hoAll.map((p) => P.ens(p, u)), spine: hoSpine.map((p) => P.ens(p, u)) };
  const mBase = { all: P.metrics(hoAll.map((p, i) => ({ p: base.all[i], y: p.y }))), spine: P.metrics(hoSpine.map((p, i) => ({ p: base.spine[i], y: p.y }))) };
  console.log(`  BASE ensamble u=${u}: holdout LL ${mBase.all.logloss.toFixed(4)} Brier ${mBase.all.brier.toFixed(4)} skill ${mBase.all.skill_pct.toFixed(2)}% · espina LL ${mBase.spine.logloss.toFixed(4)} Brier ${mBase.spine.brier.toFixed(4)} skill ${mBase.spine.skill_pct.toFixed(2)}%`);
  OUT[lbl].base = mBase;
  let recalP = null;
  for (const [name, keys] of Object.entries(SETS)) {
    const fe = fitEval(dev, hoAll, keys, u, meanMin);
    const feS = { ph: fe.ph.filter((_, i) => hoAll[i].date < SPINE_END) };
    const m = P.metrics(hoAll.map((p, i) => ({ p: fe.ph[i], y: p.y })));
    const mS = P.metrics(hoSpine.map((p, i) => ({ p: feS.ph[i], y: p.y })));
    const ll = (ps, arr) => arr.map((p, i) => { const pc = P.clamp(ps[i], 1e-6, 1 - 1e-6); return p.y ? -Math.log(pc) : -Math.log(1 - pc); });
    const br = (ps, arr) => arr.map((p, i) => (ps[i] - p.y) ** 2);
    const dLLb = P.pairedBoot(ll(fe.ph, hoAll).map((v, i) => v - ll(base.all, hoAll)[i]));
    const dBRb = P.pairedBoot(br(fe.ph, hoAll).map((v, i) => v - br(base.all, hoAll)[i]));
    const dLLs = P.pairedBoot(ll(feS.ph, hoSpine).map((v, i) => v - ll(base.spine, hoSpine)[i]));
    let dLLr = null;
    if (recalP) dLLr = P.pairedBoot(ll(fe.ph, hoAll).map((v, i) => v - ll(recalP, hoAll)[i]));
    if (name === 'recal') recalP = fe.ph;
    const coef = ['logit_ens', ...keys].map((k, j) => `${k}=${fe.b[j].toFixed(3)}(t ${(fe.b[j] / fe.se[j]).toFixed(1)})`).join(' ');
    console.log(`  [${name}] coef: ${coef}`);
    console.log(`     holdout LL ${m.logloss.toFixed(4)} Brier ${m.brier.toFixed(4)} skill ${m.skill_pct.toFixed(2)}% AUC ${m.auc.toFixed(4)} · ΔLL vs base ${dLLb.mean.toFixed(5)} (t ${dLLb.t.toFixed(2)}, IC95 [${dLLb.lo.toFixed(5)}, ${dLLb.hi.toFixed(5)}]) · ΔBrier ${dBRb.mean.toFixed(5)} (t ${dBRb.t.toFixed(2)})${dLLr ? ` · ΔLL vs recal ${dLLr.mean.toFixed(5)} (t ${dLLr.t.toFixed(2)})` : ''}`);
    console.log(`     espina  LL ${mS.logloss.toFixed(4)} Brier ${mS.brier.toFixed(4)} skill ${mS.skill_pct.toFixed(2)}% · ΔLL vs base ${dLLs.mean.toFixed(5)} (t ${dLLs.t.toFixed(2)})`);
    OUT[lbl].variants[name] = { coef: Object.fromEntries(['logit_ens', ...keys].map((k, j) => [k, { b: r4(fe.b[j]), se: r4(fe.se[j]), t: r3(fe.b[j] / fe.se[j]) }])), holdout: m, spine: mS, dLL_vs_base: dLLb, dBrier_vs_base: dBRb, dLL_spine_vs_base: dLLs, dLL_vs_recal: dLLr };
  }
  // segunda ventana walk-forward: ajustar 2018→2022, evaluar 2023→2024 (robustez)
  const dev2 = all.filter((p) => p.date >= DEV0 && p.date < 20230101), ho2 = all.filter((p) => p.date >= 20230101 && p.date < DEV1);
  const b2 = ho2.map((p) => P.ens(p, u)); const mB2 = P.metrics(ho2.map((p, i) => ({ p: b2[i], y: p.y })));
  const fr2 = fitEval(dev2, ho2, SETS.recal, u, meanMin), ff2 = fitEval(dev2, ho2, SETS.fatiga, u, meanMin);
  const ll2 = (ps) => ho2.map((p, i) => { const pc = P.clamp(ps[i], 1e-6, 1 - 1e-6); return p.y ? -Math.log(pc) : -Math.log(1 - pc); });
  const d2 = P.pairedBoot(ll2(ff2.ph).map((v, i) => v - ll2(fr2.ph)[i]));
  const mF2 = P.metrics(ho2.map((p, i) => ({ p: ff2.ph[i], y: p.y }))), mR2 = P.metrics(ho2.map((p, i) => ({ p: fr2.ph[i], y: p.y })));
  console.log(`  [fold 2023-24, n=${ho2.length}] base skill ${mB2.skill_pct.toFixed(2)}% · recal ${mR2.skill_pct.toFixed(2)}% · fatiga ${mF2.skill_pct.toFixed(2)}% · ΔLL fatiga−recal ${d2.mean.toFixed(5)} (t ${d2.t.toFixed(2)})`);
  OUT[lbl].fold2 = { n: ho2.length, base: mB2, recal: mR2, fatiga: mF2, dLL_fatiga_recal: d2, coef: Object.fromEntries(['logit_ens', ...SETS.fatiga].map((k, j) => [k, { b: r4(ff2.b[j]), t: r3(ff2.b[j] / ff2.se[j]) }])) };
  // efecto univariante en holdout (sin ajuste): tasa de victoria de X según diferencia de n7 y prevDec
  const buck = (arr, fn) => { const o = {}; for (const p of arr) { const k = fn(p); o[k] = o[k] || { n: 0, w: 0, pe: 0 }; o[k].n++; o[k].w += p.y; o[k].pe += P.ens(p, u); } return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { n: v.n, win_X: r3(v.w / v.n), ens_X: r3(v.pe / v.n) }])); };
  OUT[lbl].univ = { dn7: buck(hoAll, (p) => Math.max(-3, Math.min(3, p.fX.n7 - p.fY.n7))), dPrevDec: buck(hoAll, (p) => p.fX.prevDec - p.fY.prevDec) };
  console.log('  univariante holdout Δn7:', JSON.stringify(OUT[lbl].univ.dn7));
  console.log('  univariante holdout ΔprevDec:', JSON.stringify(OUT[lbl].univ.dPrevDec));
}
fs.writeFileSync(__dirname + '/h1_out.json', JSON.stringify(OUT, null, 1));
