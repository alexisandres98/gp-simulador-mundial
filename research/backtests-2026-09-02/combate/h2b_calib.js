#!/usr/bin/env node
/**
 * H2b — Hipótesis surgidas del diagnóstico de calibración del ACTUAL (tabla OOS: real > pred en TODOS los
 * tramos para f1 → el orden f1/f2 de ESPN lleva información (esquina roja = favorito) que la logística
 * antisimétrica SIN intercepto descarta por diseño) y de la sobreconfianza (cal_err ACTUAL 0.050 > Elo 0.040).
 *
 *   f_corner   = ACTUAL + intercepto (constante 1 = "soy f1"); aprendido online igual que el resto
 *   g_temp     = ACTUAL con temperatura τ walk-forward: p' = σ(τ·logit p); τ refiteada cada 250 peleas con
 *                todas las predicciones OOS PASADAS (grid 0.5..1.5) — nunca mira el futuro
 *   g_tempN    = τ por tramo de min(N) {<3, 3-5, 6-10, >10} (¿hay que encoger más a los de poca muestra?)
 *   f+g        = corner + temperatura
 *   e_spread   = grid de SPREAD por división sobre Elo PURO (predicción con S, update con 280 → ratings idénticos)
 *
 * Todo pareado contra ACTUAL en la misma pasada. Uso: node h2b_calib.js [--org=ufc|mma|both]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./common');
const CE = require(C.REPO + '/combat-engine/ratings');
const { sigm, logit, divGroup } = C;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const ORGS = args.org && args.org !== 'both' ? [args.org] : ['ufc', 'mma'];
const WARM = 0.35, FEAT_LR = 0.01, REFIT_EVERY = 250;
const BASE = CE.ALL_FEATS.slice();
const missReal = (over) => Math.min(+over || 0, 5) / 2;
const SPREADS = [200, 240, 280, 320, 360, 400, 460];
const nBucket = (n) => (n < 3 ? 'lt3' : n <= 5 ? '3-5' : n <= 10 ? '6-10' : 'gt10');
const NB = ['lt3', '3-5', '6-10', 'gt10'];

const fitTau = (rows) => { // rows: [{z, y}] → τ que minimiza logloss (grid fino)
  if (rows.length < 200) return 1;
  let best = 1, bl = Infinity;
  for (let t = 0.5; t <= 1.6001; t += 0.02) {
    let ll = 0; for (const r of rows) { const p = Math.min(0.999, Math.max(0.001, sigm(t * r.z))); ll -= r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p); }
    if (ll < bl) { bl = ll; best = t; }
  }
  return +best.toFixed(2);
};
const acc0 = () => ({ n: 0, hit: 0, brier: 0, logl: 0, calP: Array(10).fill(0), calY: Array(10).fill(0), calN: Array(10).fill(0) });
function push(A, p, y) { A.n++; if ((p >= 0.5) === (y === 1)) A.hit++; A.brier += (p - y) ** 2; A.logl += -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p))); const b = Math.min(9, Math.floor(p * 10)); A.calP[b] += p; A.calY[b] += y; A.calN[b]++; }
const calErr = (A) => { let e = 0, w = 0; for (let i = 0; i < 10; i++) { if (A.calN[i] < 30) continue; e += A.calN[i] * Math.abs(A.calP[i] / A.calN[i] - A.calY[i] / A.calN[i]); w += A.calN[i]; } return w ? e / w : null; };
const rep = (A) => A.n ? { n: A.n, acc: +(A.hit / A.n).toFixed(4), brier: +(A.brier / A.n).toFixed(5), skill: +((0.25 * A.n - A.brier) / A.n).toFixed(5), logloss: +(A.logl / A.n).toFixed(5), cal_err: calErr(A) != null ? +calErr(A).toFixed(4) : null } : null;
const calTable = (A) => Array.from({ length: 10 }, (_, i) => A.calN[i] >= 30 ? { bucket: `${i * 10}-${i * 10 + 10}`, pred: +(A.calP[i] / A.calN[i]).toFixed(3), real: +(A.calY[i] / A.calN[i]).toFixed(3), n: A.calN[i] } : null).filter(Boolean);

function run(org) {
  const { fights, fighters } = C.loadFights(org);
  const { perFight } = C.fineJoin(fights);
  const { idx: WI } = C.weighIndex(org, fights);
  const warm = Math.floor(fights.length * WARM);
  console.log(`\n${'='.repeat(100)}\nORG ${org.toUpperCase()} — ${fights.length} peleas · warm ${warm}`);
  const model = CE.newModel(null, {});
  const VAR = ['ACTUAL', 'f_corner', 'g_temp', 'g_tempN', 'f+g'];
  const W = { ACTUAL: { elo: 1 }, f_corner: { elo: 1, one: 0 } };
  for (const k of BASE) { W.ACTUAL[k] = 0; W.f_corner[k] = 0; }
  const A = {}; VAR.forEach(v => { A[v] = acc0(); }); A.elo = acc0();
  const AS = {}; for (const g of ['women', 'hw', 'lhw_mw', 'ww_lw', 'fw_bw_flw', 'other']) { AS[g] = {}; for (const s of SPREADS) AS[g][s] = acc0(); }
  const pairs = [], meta = [];
  let tau = 1, tauN = Object.fromEntries(NB.map(b => [b, 1])), tauC = 1; const hist = [], histC = [], histN = Object.fromEntries(NB.map(b => [b, []]));
  const tauTrace = [];
  let f1IsEloFav = 0, f1Wins = 0, nEval = 0;
  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const pr = CE.fightProb(model, f.f1.id, f.f2.id, f.date); const pElo = pr.p1;
    const wi = WI[f.comp_id]; const o1 = wi && wi.f1 ? wi.f1.over : null, o2 = wi && wi.f2 ? wi.f2.over : null;
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, { sched: f.rounds_sched || 3 }); fd.misswt = missReal(o1) - missReal(o2); fd.one = 1;
    const zA = W.ACTUAL.elo * logit(pElo) + BASE.reduce((s, k) => s + W.ACTUAL[k] * fd[k], 0);
    const zC = W.f_corner.elo * logit(pElo) + W.f_corner.one + BASE.reduce((s, k) => s + W.f_corner[k] * fd[k], 0);
    const nmin = Math.min(model.N[f.f1.id] || 0, model.N[f.f2.id] || 0); const nb = nBucket(nmin);
    const ps = { ACTUAL: sigm(zA), f_corner: sigm(zC), g_temp: sigm(tau * zA), g_tempN: sigm(tauN[nb] * zA), 'f+g': sigm(tauC * zC) };
    if (i >= warm) {
      nEval++; if (pElo >= 0.5) f1IsEloFav++; if (y) f1Wins++;
      push(A.elo, pElo, y); for (const v of VAR) push(A[v], ps[v], y);
      pairs.push(VAR.map(v => (ps[v] - y) ** 2)); meta.push({ era: f.date < '2020' ? 'pre' : '2020-26', n3: nmin >= 3, nb, g: divGroup(f.weight) });
      // grid de SPREAD por división sobre Elo puro (ratings idénticos; solo cambia la pendiente de predicción)
      const g = divGroup(f.weight); const r1 = pr.r1, r2 = pr.r2;
      for (const s of SPREADS) push(AS[g][s], 1 / (1 + Math.pow(10, (r2 - r1) / s)), y);
      hist.push({ z: zA, y }); histC.push({ z: zC, y }); histN[nb].push({ z: zA, y });
      if (hist.length % REFIT_EVERY === 0) { tau = fitTau(hist); tauC = fitTau(histC); for (const b of NB) tauN[b] = fitTau(histN[b]); tauTrace.push({ at: f.date.slice(0, 10), n: hist.length, tau, tauC, tauN: Object.assign({}, tauN) }); }
    }
    // SGD online (tras evaluar)
    const gA = ps.ACTUAL - y; W.ACTUAL.elo -= FEAT_LR * gA * logit(pElo); for (const k of BASE) W.ACTUAL[k] -= FEAT_LR * gA * fd[k];
    const gC = ps.f_corner - y; W.f_corner.elo -= FEAT_LR * gC * logit(pElo); W.f_corner.one -= FEAT_LR * gC; for (const k of BASE) W.f_corner[k] -= FEAT_LR * gC * fd[k];
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });
  const out = { org, n_oos: pairs.length, f1_share_elo_fav: +(f1IsEloFav / nEval).toFixed(3), f1_win_share: +(f1Wins / nEval).toFixed(3), variants: {}, paired: {}, paired_2020: {}, paired_n3: {}, cal: {}, tau_final: { tau, tauC, tauN }, tau_trace: tauTrace, w_corner: Object.fromEntries(Object.entries(W.f_corner).map(([k, v]) => [k, +v.toFixed(4)])), spread_grid: {} };
  console.log(`f1 es favorito por Elo en ${(100 * f1IsEloFav / nEval).toFixed(1)}% · f1 gana ${(100 * f1Wins / nEval).toFixed(1)}% (OOS n=${nEval})`);
  console.log('  Elo puro   ', JSON.stringify(rep(A.elo)));
  for (const v of VAR) { out.variants[v] = rep(A[v]); out.cal[v] = calTable(A[v]); console.log(`  ${v.padEnd(10)}`, JSON.stringify(rep(A[v]))); }
  console.log('\nPAREADO vs ACTUAL:');
  VAR.forEach((v, vi) => {
    if (!vi) return;
    const d = pairs.map(r => r[vi] - r[0]);
    out.paired[v] = C.pairedStats(d, 11 + vi); out.paired_2020[v] = C.pairedStats(d.filter((_, j) => meta[j].era === '2020-26'), 21 + vi); out.paired_n3[v] = C.pairedStats(d.filter((_, j) => meta[j].n3), 31 + vi);
    console.log(`  ${v.padEnd(10)} todo ${JSON.stringify(out.paired[v])}\n             2020-26 ${JSON.stringify(out.paired_2020[v])}\n             ambos≥3 ${JSON.stringify(out.paired_n3[v])}`);
  });
  console.log('\nτ final:', JSON.stringify(out.tau_final), '\nτ trace:', JSON.stringify(tauTrace.filter((_, i) => i % 4 === 0)));
  console.log('peso corner (one) final:', W.f_corner.one.toFixed(4), '| elo', W.f_corner.elo.toFixed(4));
  console.log('\nCALIBRACIÓN f_corner:', JSON.stringify(out.cal.f_corner));
  console.log('CALIBRACIÓN f+g:', JSON.stringify(out.cal['f+g']));
  // calibración por min(N) del ACTUAL
  out.by_nbucket = {}; for (const b of NB) { const rows = pairs.filter((_, j) => meta[j].nb === b); out.by_nbucket[b] = { n: rows.length, brier_actual: rows.length ? +(rows.reduce((s, r) => s + r[0], 0) / rows.length).toFixed(5) : null, tau: tauN[b] }; }
  console.log('por min(N):', JSON.stringify(out.by_nbucket));
  console.log('\nSPREAD por división (Elo puro, Brier OOS):');
  for (const g of Object.keys(AS)) { const row = {}; for (const s of SPREADS) row[s] = AS[g][s].n ? +(AS[g][s].brier / AS[g][s].n).toFixed(5) : null; const best = SPREADS.reduce((b, s) => (row[s] != null && (b == null || row[s] < row[b]) ? s : b), null); out.spread_grid[g] = { n: AS[g][280].n, brier_by_spread: row, best }; console.log(`  ${g.padEnd(10)} n=${String(AS[g][280].n).padStart(5)} ${JSON.stringify(row)} → mejor ${best}`); }
  return out;
}
const res = ORGS.map(run);
fs.writeFileSync(path.join(__dirname, `h2b_results_${ORGS.join('_')}.json`), JSON.stringify(res, null, 1));
console.log('\nescrito h2b_results');
