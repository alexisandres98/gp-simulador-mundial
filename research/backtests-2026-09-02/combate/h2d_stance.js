#!/usr/bin/env node
/**
 * H2d — Datos que YA están en el repo y el modelo no usa: guardia (stance: zurdo vs ortodoxo) y estatura.
 *   +stance : 1[f1 zurdo & f2 ortodoxo] − 1[f2 zurdo & f1 ortodoxo]  (la ventaja clásica del zurdo contra diestro)
 *   +height : (h1 − h2)/5 pulgadas (el alcance ya está; la estatura es la otra mitad del "tale of the tape")
 * Misma pasada walk-forward pareada que h2_features (ACTUAL con pesaje real).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./common');
const CE = require(C.REPO + '/combat-engine/ratings');
const { sigm, logit } = C;
const WARM = 0.35, FEAT_LR = 0.01;
const BASE = CE.ALL_FEATS.slice();
const missReal = (over) => Math.min(+over || 0, 5) / 2;
const inches = (s) => { if (!s) return null; const t = String(s); const m = t.match(/(\d+)\s*'\s*(\d+)?/); if (m) return (+m[1]) * 12 + (+(m[2] || 0)); const n = t.match(/([\d.]+)/); return n ? +n[1] : null; };
const VAR = [{ name: 'ACTUAL', extra: [] }, { name: '+stance', extra: ['stance'] }, { name: '+height', extra: ['height'] }, { name: '+stance+height', extra: ['stance', 'height'] }];
const out = {};
for (const org of ['ufc', 'mma']) {
  const { fights, fighters } = C.loadFights(org);
  const { perFight } = C.fineJoin(fights);
  const { idx: WI } = C.weighIndex(org, fights);
  const warm = Math.floor(fights.length * WARM);
  const model = CE.newModel(null, {});
  const W = VAR.map(v => { const w = { elo: 1 }; for (const k of BASE.concat(v.extra)) w[k] = 0; return w; });
  const pairs = [], meta = []; let nStance = 0, nHeight = 0;
  const accs = VAR.map(() => ({ n: 0, hit: 0, brier: 0 }));
  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
    const wi = WI[f.comp_id]; const o1 = wi && wi.f1 ? wi.f1.over : null, o2 = wi && wi.f2 ? wi.f2.over : null;
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, { sched: f.rounds_sched || 3 }); fd.misswt = missReal(o1) - missReal(o2);
    const a = fighters[f.f1.id] || {}, b = fighters[f.f2.id] || {};
    const st = (p) => /southpaw/i.test(p.stance || '') ? 'L' : /orthodox/i.test(p.stance || '') ? 'R' : null;
    const s1 = st(a), s2 = st(b);
    fd.stance = (s1 && s2) ? ((s1 === 'L' && s2 === 'R' ? 1 : 0) - (s2 === 'L' && s1 === 'R' ? 1 : 0)) : 0;
    const h1 = inches(a.height_in), h2 = inches(b.height_in);
    fd.height = (h1 && h2 && h1 > 50 && h2 > 50) ? (h1 - h2) / 5 : 0;
    const ps = VAR.map((v, vi) => { let z = W[vi].elo * logit(pElo); for (const k of BASE.concat(v.extra)) z += W[vi][k] * fd[k]; return sigm(z); });
    if (i >= warm) {
      pairs.push(ps.map(p => (p - y) ** 2)); meta.push({ era: f.date >= '2020', st: fd.stance !== 0, ht: fd.height !== 0 });
      if (fd.stance !== 0) nStance++; if (fd.height !== 0) nHeight++;
      ps.forEach((p, vi) => { accs[vi].n++; if ((p >= 0.5) === (y === 1)) accs[vi].hit++; accs[vi].brier += (p - y) ** 2; });
    }
    VAR.forEach((v, vi) => { const g = ps[vi] - y; W[vi].elo -= FEAT_LR * g * logit(pElo); for (const k of BASE.concat(v.extra)) W[vi][k] -= FEAT_LR * g * fd[k]; });
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });
  out[org] = { n: pairs.length, n_stance_active: nStance, n_height_active: nHeight, variants: {}, paired: {}, paired_2020: {}, paired_active: {}, weights: {} };
  VAR.forEach((v, vi) => {
    out[org].variants[v.name] = { acc: +(accs[vi].hit / accs[vi].n).toFixed(4), brier: +(accs[vi].brier / accs[vi].n).toFixed(5) };
    out[org].weights[v.name] = Object.fromEntries(Object.entries(W[vi]).map(([k, x]) => [k, +x.toFixed(4)]));
    if (vi) {
      const d = pairs.map(r => r[vi] - r[0]);
      out[org].paired[v.name] = C.pairedStats(d, 41 + vi); out[org].paired_2020[v.name] = C.pairedStats(d.filter((_, j) => meta[j].era), 51 + vi);
      out[org].paired_active[v.name] = C.pairedStats(d.filter((_, j) => (v.extra.includes('stance') ? meta[j].st : meta[j].ht)), 61 + vi);
    }
  });
  console.log(org, JSON.stringify(out[org], null, 1));
}
fs.writeFileSync(path.join(__dirname, 'h2d_results.json'), JSON.stringify(out, null, 1));
