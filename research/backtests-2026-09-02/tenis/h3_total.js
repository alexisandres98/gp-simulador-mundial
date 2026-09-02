// H3 — TOTAL de juegos: (a) calibración de la distribución del compilado en holdout; (b) alternativas al
// desplazamiento (store.js:169) ajustadas en dev; (c) libro real de picks TOTAL, split temporal 60/40.
'use strict';
const P = require('./pass.js'); const fs = require('fs');
const C = P.C;
const DEV0 = 20180101, DEV1 = 20250101, SPINE_END = 20260526;
const r3 = (x) => Math.round(x * 1e3) / 1e3, r4 = (x) => Math.round(x * 1e4) / 1e4;

// distribución completa de juegos totales del partido (misma matemática que matchLite, guardando la dist)
const TD_CACHE = new Map();
function totalDist(pa, pb, bo, shock) {
  const ka = Math.round(pa * 500), kb = Math.round(pb * 500);
  const key = `${ka},${kb},${bo},${shock}`; const hit = TD_CACHE.get(key); if (hit) return hit;
  pa = ka / 500; pb = kb / 500;
  const s1 = C.setDist(pa, pb, shock), s2raw = C.setDist(pb, pa, shock);
  const pSet = (s1.pA + (1 - s2raw.pA)) / 2;
  const W = new Map(), L = new Map(); let zW = 0, zL = 0;
  for (const src of [s1.dist, s2raw.dist.map((d) => ({ games: d.games, a: d.b, b: d.a }))]) for (const d of src) { W.set(d.games, (W.get(d.games) || 0) + d.a / 2); L.set(d.games, (L.get(d.games) || 0) + d.b / 2); zW += d.a / 2; zL += d.b / 2; }
  const w = [...W.entries()].map(([g, p]) => [g, p / zW]), l = [...L.entries()].map(([g, p]) => [g, p / zL]);
  const need = Math.ceil(bo / 2); const tot = new Map();
  const conv = (acc, d) => { const m = new Map(); for (const [g, p] of acc) for (const [h, q] of d) m.set(g + h, (m.get(g + h) || 0) + p * q); return [...m.entries()]; };
  (function f(sA, sB, pr) {
    if (sA === need || sB === need) { let acc = [[0, 1]]; for (let i = 0; i < sA; i++) acc = conv(acc, w); for (let i = 0; i < sB; i++) acc = conv(acc, l); for (const [g, p] of acc) tot.set(g, (tot.get(g) || 0) + pr * p); return; }
    f(sA + 1, sB, pr * pSet); f(sA, sB + 1, pr * (1 - pSet));
  })(0, 0, 1);
  const dist = [...tot.entries()].sort((a, b) => a[0] - b[0]);
  let E = 0; for (const [g, p] of dist) E += g * p;
  const out = { dist, E };
  TD_CACHE.set(key, out); return out;
}
// utilidades sobre una dist [[g,p]] con soporte real (puede ser no entero tras desplazar/reescalar)
const meanOf = (d) => d.reduce((s, [g, p]) => s + g * p, 0);
const sdOf = (d) => { const m = meanOf(d); return Math.sqrt(d.reduce((s, [g, p]) => s + p * (g - m) ** 2, 0)); };
const medianOf = (d) => { let c = 0; for (const [g, p] of d) { c += p; if (c >= 0.5) return g; } return d[d.length - 1][0]; };
const pOver = (d, line) => d.reduce((s, [g, p]) => s + (g > line + 1e-9 ? p : 0), 0);
const cdfAt = (d, x) => d.reduce((s, [g, p]) => s + (g <= x + 1e-9 ? p : 0), 0);
// densidad en un entero: para soportes desplazados se atribuye cada punto al entero más cercano (redondeo)
const pmfInt = (d) => { const m = new Map(); for (const [g, p] of d) { const k = Math.round(g); m.set(k, (m.get(k) || 0) + p); } return m; };
const logScore = (d, act) => -Math.log(Math.max(1e-4, pmfInt(d).get(act) || 0));
const crps = (d, act) => { // suma sobre enteros de (F(k) − 1{act ≤ k})²
  const pm = pmfInt(d); const ks = [...pm.keys()].sort((a, b) => a - b); const lo = Math.min(ks[0], act) - 1, hi = Math.max(ks[ks.length - 1], act) + 1; let F = 0, s = 0; for (let k = lo; k <= hi; k++) { F += pm.get(k) || 0; s += (F - (act <= k ? 1 : 0)) ** 2; } return s; };
const pit = (d, act, rnd) => { const pm = pmfInt(d); let below = 0; for (const [k, p] of pm) if (k < act) below += p; const at = pm.get(act) || 0; return below + rnd * at; }; // PIT aleatorizado
let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const OUT = {};
for (const tour of [0, 1]) {
  const lbl = tour === 0 ? 'atp' : 'wta'; const fz = P.frozen(tour);
  const all = JSON.parse(fs.readFileSync(__dirname + `/preds_${lbl}.json`, 'utf8')).filter((p) => !p.isRet && p.actGames > 5);
  const dev = all.filter((p) => p.date >= DEV0 && p.date < DEV1), ho = all.filter((p) => p.date >= DEV1);
  console.log(`\n══════ ${lbl.toUpperCase()} ══════ dev n=${dev.length} holdout n=${ho.length}`);
  const t0 = Date.now();
  for (const p of [...dev, ...ho]) { const td = totalDist(p.paSrv, p.pbSrv, p.bo, fz.shock || 0); p.td = td.dist; p.E = td.E; }
  console.log(`  distribuciones calculadas en ${((Date.now() - t0) / 1000).toFixed(0)}s (cache ${TD_CACHE.size})`);
  const res = { n_dev: dev.length, n_ho: ho.length };
  // ── calibraciones ajustadas EN DEV ──────────────────────────────────────────────────────────────────
  // producción: a + b·E por formato (mínimos cuadrados) — misma fórmula que tennis-fit.js
  const calFit = (bo) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0; for (const p of dev) if (p.bo === bo) { sx += p.E; sy += p.actGames; sxx += p.E ** 2; sxy += p.E * p.actGames; n++; } if (n < 50) return [0, 1]; const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); return [(sy - b * sx) / n, b]; };
  const cal = { 3: calFit(3), 5: calFit(5) };
  res.cal_dev = cal; res.cal_repo = fz.gamesCal;
  console.log(`  calibración lineal dev: bo3 a=${cal[3][0].toFixed(3)} b=${cal[3][1].toFixed(3)} · bo5 a=${cal[5][0].toFixed(3)} b=${cal[5][1].toFixed(3)} (repo: ${JSON.stringify(fz.gamesCal)})`);
  const shiftDist = (p) => { const c = cal[p.bo]; const sh = c[0] + c[1] * p.E - p.E; return p.td.map(([g, q]) => [g + sh, q]); };            // V0 producción
  const rescaleDist = (p) => { const c = cal[p.bo]; return p.td.map(([g, q]) => [c[0] + c[1] * g, q]); };                                     // V1 reescalado afín del soporte
  const locScale = (p, s) => { const c = cal[p.bo]; const M = c[0] + c[1] * p.E; return p.td.map(([g, q]) => [M + s * (g - p.E), q]); };      // V3 media calibrada + dispersión s
  // empírica por formato×superficie en dev (V2 mezcla)
  const emp = {}; for (const p of dev) { const k = `${p.bo}_${p.surf}`; emp[k] = emp[k] || new Map(); emp[k].set(p.actGames, (emp[k].get(p.actGames) || 0) + 1); }
  for (const k of Object.keys(emp)) { const n = [...emp[k].values()].reduce((a, b) => a + b, 0); emp[k] = [...emp[k].entries()].map(([g, c]) => [g, c / n]).sort((a, b) => a[0] - b[0]); }
  const mixDist = (p, lam) => { const e = emp[`${p.bo}_${p.surf}`] || emp[`${p.bo}_0`]; const m = new Map(); for (const [g, q] of shiftDist(p)) m.set(g, (m.get(g) || 0) + (1 - lam) * q); for (const [g, q] of e) m.set(g, (m.get(g) || 0) + lam * q); return [...m.entries()].sort((a, b) => a[0] - b[0]); };
  // V4: residuos empíricos de dev alrededor de la media calibrada, por formato (convolución = media + residuo)
  const resid = {}; for (const p of dev) { const c = cal[p.bo]; const r = Math.round(p.actGames - (c[0] + c[1] * p.E)); resid[p.bo] = resid[p.bo] || new Map(); resid[p.bo].set(r, (resid[p.bo].get(r) || 0) + 1); }
  for (const k of Object.keys(resid)) { const n = [...resid[k].values()].reduce((a, b) => a + b, 0); resid[k] = [...resid[k].entries()].map(([g, c]) => [g, c / n]).sort((a, b) => a[0] - b[0]); }
  const residDist = (p) => { const c = cal[p.bo]; const M = c[0] + c[1] * p.E; return resid[p.bo].map(([r, q]) => [M + r, q]); };
  // selección en dev de s (V3) y λ (V2) por log score
  const devScore = (fn) => { let s = 0; for (const p of dev) s += logScore(fn(p), p.actGames); return s / dev.length; };
  let bestS = null; for (const s of [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8]) { const v = devScore((p) => locScale(p, s)); if (!bestS || v < bestS.v) bestS = { s, v }; }
  let bestL = null; for (const lam of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7]) { const v = devScore((p) => mixDist(p, lam)); if (!bestL || v < bestL.v) bestL = { lam, v }; }
  res.dev_choice = { s: bestS, lam: bestL };
  console.log(`  dev: s*=${bestS.s} (logscore ${bestS.v.toFixed(4)}) · λ*=${bestL.lam} (logscore ${bestL.v.toFixed(4)})`);
  // V5 — RECOMPILADO COHERENTE CON EL ENSAMBLE: se busca δ tal que el compilado con (pa+δ, pb−δ) dé exactamente
  // la probabilidad de ganador del ensamble (mejor calibrada que la del compilado), manteniendo el nivel medio de
  // saque. La distribución de juegos hereda así la separación real entre jugadores (menos terceros sets espurios).
  const t1 = Date.now();
  for (const p of [...dev, ...ho]) {
    const pe = P.clamp(P.ens(p, fz.u), 0.02, 0.98); let lo = -0.2, hi = 0.2;
    for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; const pa = P.clamp(p.paSrv + mid, 0.4, 0.85), pb = P.clamp(p.pbSrv - mid, 0.4, 0.85); const q = C.matchLite(pa, pb, p.bo, fz.shock || 0).pA; if (q < pe) lo = mid; else hi = mid; }
    const d = (lo + hi) / 2; const td = totalDist(P.clamp(p.paSrv + d, 0.4, 0.85), P.clamp(p.pbSrv - d, 0.4, 0.85), p.bo, fz.shock || 0); p.td5 = td.dist; p.E5 = td.E; p.delta5 = d;
  }
  console.log(`  V5 recompilado en ${((Date.now() - t1) / 1000).toFixed(0)}s · |δ| medio ${(dev.reduce((s, p) => s + Math.abs(p.delta5), 0) / dev.length).toFixed(4)}`);
  const calFit5 = (bo) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0; for (const p of dev) if (p.bo === bo) { sx += p.E5; sy += p.actGames; sxx += p.E5 ** 2; sxy += p.E5 * p.actGames; n++; } if (n < 50) return [0, 1]; const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); return [(sy - b * sx) / n, b]; };
  const cal5 = { 3: calFit5(3), 5: calFit5(5) }; res.cal5_dev = cal5;
  console.log(`  calibración lineal dev del V5: bo3 a=${cal5[3][0].toFixed(3)} b=${cal5[3][1].toFixed(3)} · bo5 a=${cal5[5][0].toFixed(3)} b=${cal5[5][1].toFixed(3)}`);
  const ensShift = (p) => { const c = cal5[p.bo]; const sh = c[0] + c[1] * p.E5 - p.E5; return p.td5.map(([g, q]) => [g + sh, q]); };
  const resid5 = {}; for (const p of dev) { const c = cal5[p.bo]; const r = Math.round(p.actGames - (c[0] + c[1] * p.E5)); resid5[p.bo] = resid5[p.bo] || new Map(); resid5[p.bo].set(r, (resid5[p.bo].get(r) || 0) + 1); }
  for (const k of Object.keys(resid5)) { const n = [...resid5[k].values()].reduce((a, b) => a + b, 0); resid5[k] = [...resid5[k].entries()].map(([g, c]) => [g, c / n]).sort((a, b) => a[0] - b[0]); }
  const ensResid = (p) => { const c = cal5[p.bo]; const M = c[0] + c[1] * p.E5; return resid5[p.bo].map(([r, q]) => [M + r, q]); };
  let bestL5 = null; for (const lam of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7]) { const v = devScore((p) => { const e = emp[`${p.bo}_${p.surf}`] || emp[`${p.bo}_0`]; const m = new Map(); for (const [g, q] of ensShift(p)) m.set(g, (m.get(g) || 0) + (1 - lam) * q); for (const [g, q] of e) m.set(g, (m.get(g) || 0) + lam * q); return [...m.entries()].sort((a, b) => a[0] - b[0]); }); if (!bestL5 || v < bestL5.v) bestL5 = { lam, v }; }
  res.dev_choice.lam5 = bestL5; console.log(`  dev: λ5*=${bestL5.lam} (logscore ${bestL5.v.toFixed(4)})`);
  const ensMix = (p) => { const e = emp[`${p.bo}_${p.surf}`] || emp[`${p.bo}_0`]; const m = new Map(); for (const [g, q] of ensShift(p)) m.set(g, (m.get(g) || 0) + (1 - bestL5.lam) * q); for (const [g, q] of e) m.set(g, (m.get(g) || 0) + bestL5.lam * q); return [...m.entries()].sort((a, b) => a[0] - b[0]); };
  const V = { shift_prod: shiftDist, rescale: rescaleDist, locscale: (p) => locScale(p, bestS.s), mix_emp: (p) => mixDist(p, bestL.lam), resid_emp: residDist, ens_shift: ensShift, ens_mix: ensMix, ens_resid: ensResid };
  // calibración de "sets jugados": P(set decisivo) predicha por el compilado crudo vs real (bo3: 3 sets; bo5: 4-5 sets)
  const p3 = (pa, pb, bo) => { const q = C.matchLite(pa, pb, bo, fz.shock || 0).pSetA; if (bo === 3) return 2 * q * (1 - q); const a = q, b = 1 - q; return 1 - (a ** 3 + b ** 3); };
  res.sets_calib = {}; for (const bo of [3, 5]) { const arr = ho.filter((p) => p.bo === bo); if (arr.length < 100) continue; let pp = 0, pp5 = 0, act = 0; for (const p of arr) { pp += p3(p.paSrv, p.pbSrv, bo); pp5 += p3(P.clamp(p.paSrv + p.delta5, 0.4, 0.85), P.clamp(p.pbSrv - p.delta5, 0.4, 0.85), bo); act += (bo === 3 ? p.actSets === 3 : p.actSets >= 4) ? 1 : 0; } res.sets_calib[`bo${bo}`] = { n: arr.length, p_decisivo_prod: r3(pp / arr.length), p_decisivo_v5: r3(pp5 / arr.length), real: r3(act / arr.length) }; }
  console.log('  calibración de sets (holdout):', JSON.stringify(res.sets_calib));
  // ── (a) calibración de la distribución en holdout (producción) ──────────────────────────────────────
  const calib = (fn, arr, tag) => {
    let n = 0, sMean = 0, sAct = 0, sPredSd = 0, ssAct = 0, ssErrMean = 0, aboveMed = 0, c50 = 0, c80 = 0, c90 = 0; const pits = [];
    for (const p of arr) { const d = fn(p); const m = meanOf(d), sd = sdOf(d), med = medianOf(d); n++; sMean += m; sAct += p.actGames; sPredSd += sd; ssErrMean += (p.actGames - m) ** 2; if (p.actGames > med) aboveMed++; const u = pit(d, p.actGames, rnd()); pits.push(u); if (u > 0.25 && u < 0.75) c50++; if (u > 0.1 && u < 0.9) c80++; if (u > 0.05 && u < 0.95) c90++; }
    const mAct = sAct / n; for (const p of arr) ssAct += (p.actGames - mAct) ** 2;
    const hist = new Array(10).fill(0); for (const u of pits) hist[Math.min(9, Math.floor(u * 10))]++;
    return { n, pred_mean: r3(sMean / n), act_mean: r3(mAct), pred_sd_avg: r3(sPredSd / n), act_sd: r3(Math.sqrt(ssAct / n)), rmse_mean: r3(Math.sqrt(ssErrMean / n)), p_act_gt_median: r3(aboveMed / n), cov50: r3(c50 / n), cov80: r3(c80 / n), cov90: r3(c90 / n), pit_hist_pct: hist.map((h) => r3(100 * h / n)) };
  };
  res.calib_ho = {}; for (const bo of [3, 5]) { const arr = ho.filter((p) => p.bo === bo); if (arr.length < 100) continue; res.calib_ho[`bo${bo}_shift_prod`] = calib(V.shift_prod, arr); res.calib_ho[`bo${bo}_raw`] = calib((p) => p.td, arr); }
  for (const [k, v] of Object.entries(res.calib_ho)) console.log(`  (a) holdout ${k}: ${JSON.stringify(v)}`);
  // fiabilidad de P(over mediana) del modelo de producción: por decil de p_over → tasa real
  const rel = {}; for (const p of ho) { const d = V.shift_prod(p); const med = medianOf(p.td); const line = med + 0.5; const po = pOver(d, line); const k = Math.min(9, Math.floor(po * 10)); rel[k] = rel[k] || { n: 0, po: 0, hit: 0 }; rel[k].n++; rel[k].po += po; rel[k].hit += p.actGames > line ? 1 : 0; }
  res.reliab_over_med = Object.fromEntries(Object.entries(rel).map(([k, v]) => [k, { n: v.n, p_pred: r3(v.po / v.n), hit: r3(v.hit / v.n) }]));
  console.log('  (a) fiabilidad P(over mediana_raw+0.5) producción:', JSON.stringify(res.reliab_over_med));
  // ── (b) comparación de variantes en holdout, línea sintética común = mediana del compilado crudo + 0.5 ──
  const evalV = (fn, arr) => {
    // línea sintética común para TODAS las variantes: mediana del compilado crudo de producción + 0.5
    const rows = arr.map((p) => { const d = fn(p); const line = medianOf(p.td) + 0.5; const po = pOver(d, line); const y = p.actGames > line ? 1 : 0; return { maeMean: Math.abs(meanOf(d) - p.actGames), maeMed: Math.abs(medianOf(d) - p.actGames), ls: logScore(d, p.actGames), crps: crps(d, p.actGames), br: (po - y) ** 2, brL2: (pOver(d, line + 2) - (p.actGames > line + 2 ? 1 : 0)) ** 2, brL_2: (pOver(d, line - 2) - (p.actGames > line - 2 ? 1 : 0)) ** 2 }; });
    const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
    return { rows, n: rows.length, mae_mean: r4(avg('maeMean')), mae_median: r4(avg('maeMed')), logscore: r4(avg('ls')), crps: r4(avg('crps')), brier_over_med: r4(avg('br')), brier_over_med_p2: r4(avg('brL2')), brier_over_med_m2: r4(avg('brL_2')) };
  };
  res.variants_ho = {}; const baseRows = evalV(V.shift_prod, ho).rows;
  const naive = { 3: dev.filter((p) => p.bo === 3).reduce((s, p) => s + p.actGames, 0) / Math.max(1, dev.filter((p) => p.bo === 3).length), 5: dev.filter((p) => p.bo === 5).reduce((s, p) => s + p.actGames, 0) / Math.max(1, dev.filter((p) => p.bo === 5).length) };
  res.naive_mae_ho = r4(ho.reduce((s, p) => s + Math.abs(naive[p.bo] - p.actGames), 0) / ho.length);
  for (const [name, fn] of Object.entries(V)) {
    const e = evalV(fn, ho); const boot = {}; for (const k of ['maeMean', 'ls', 'crps', 'br']) boot[k] = P.pairedBoot(e.rows.map((r, i) => r[k] - baseRows[i][k]));
    delete e.rows; res.variants_ho[name] = { ...e, d_vs_prod: Object.fromEntries(Object.entries(boot).map(([k, b]) => [k, { mean: r4(b.mean), t: r3(b.t), lo: r4(b.lo), hi: r4(b.hi) }])) };
    console.log(`  (b) ${name}: MAE media ${e.mae_mean} mediana ${e.mae_median} · logscore ${e.logscore} · CRPS ${e.crps} · Brier over@med ${e.brier_over_med} (@+2 ${e.brier_over_med_p2}, @−2 ${e.brier_over_med_m2}) · Δ vs prod: MAE ${boot.maeMean.mean.toFixed(4)} (t ${boot.maeMean.t.toFixed(2)}) logscore ${boot.ls.mean.toFixed(4)} (t ${boot.ls.t.toFixed(2)}) CRPS ${boot.crps.mean.toFixed(4)} (t ${boot.crps.t.toFixed(2)}) Brier ${boot.br.mean.toFixed(5)} (t ${boot.br.t.toFixed(2)})`);
  }
  console.log(`  (b) MAE ingenuo (media dev por formato) en holdout: ${res.naive_mae_ho}`);
  // por formato y superficie: MAE y sesgo del modelo de producción y del locscale
  res.by_bo_surf = {}; for (const p of ho) { const k = `bo${p.bo}_s${p.surf}`; const o = res.by_bo_surf[k] = res.by_bo_surf[k] || { n: 0, bias: 0, mae: 0, sdPred: 0, sdAct: [], }; const d = V.shift_prod(p); o.n++; o.bias += meanOf(d) - p.actGames; o.mae += Math.abs(meanOf(d) - p.actGames); o.sdPred += sdOf(d); o.sdAct.push(p.actGames); }
  for (const [k, o] of Object.entries(res.by_bo_surf)) { const m = o.sdAct.reduce((a, b) => a + b, 0) / o.n; o.sd_act = r3(Math.sqrt(o.sdAct.reduce((a, x) => a + (x - m) ** 2, 0) / o.n)); delete o.sdAct; o.bias = r3(o.bias / o.n); o.mae = r3(o.mae / o.n); o.sd_pred = r3(o.sdPred / o.n); delete o.sdPred; }
  console.log('  por formato×superficie (prod): ', JSON.stringify(res.by_bo_surf));
  OUT[lbl] = res;
}
// ── (c) libro real de picks TOTAL: split temporal 60/40 del blend p* ─────────────────────────────────────
const book = JSON.parse(fs.readFileSync('/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/tennis_full2.json', 'utf8')).recent;
const T = book.filter((p) => p.family === 'TOTAL' && /WIN|LOSS/.test(p.result)).sort((a, b) => Date.parse(a.commence) - Date.parse(b.commence) || Date.parse(a.created_at) - Date.parse(b.created_at));
const lg = (p) => Math.log(P.clamp(p, 0.005, 0.995) / (1 - P.clamp(p, 0.005, 0.995)));
const fit3 = (rows) => P.logreg(rows.map((r) => [1, lg(r.p_implied), lg(r.p_model) - lg(r.p_implied)]), rows.map((r) => (r.result === 'WIN' ? 1 : 0)), 1e-3);
const nTr = Math.round(0.6 * T.length); const tr = T.slice(0, nTr), te = T.slice(nTr);
const f = fit3(tr); const fAll = fit3(T);
const pStar = (r, b) => P.sig(b[0] + b[1] * lg(r.p_implied) + b[2] * (lg(r.p_model) - lg(r.p_implied)));
const roi = (rows) => { const u = rows.reduce((s, r) => s + r.units, 0); return { n: rows.length, units: r3(u), roi_pct: rows.length ? r3(100 * u / rows.length) : null, hit: rows.length ? r3(rows.filter((r) => r.result === 'WIN').length / rows.length) : null }; };
const brierOf = (rows, fn) => r4(rows.reduce((s, r) => s + (fn(r) - (r.result === 'WIN' ? 1 : 0)) ** 2, 0) / rows.length);
const seRoi = (rows) => { const n = rows.length; const m = rows.reduce((s, r) => s + r.units, 0) / n; const sd = Math.sqrt(rows.reduce((s, r) => s + (r.units - m) ** 2, 0) / (n - 1)); return { se_pct: r3(100 * sd / Math.sqrt(n)), t: r3(m / (sd / Math.sqrt(n))) }; };
const c = {
  n_total: T.length, n_train: tr.length, n_test: te.length, train_span: [tr[0].commence, tr[tr.length - 1].commence], test_span: [te[0].commence, te[te.length - 1].commence],
  fit_train: { a: r3(f.b[0]), b_mkt: r3(f.b[1]), c_model: r3(f.b[2]), se_c: r3(f.se[2]), t_c: r3(f.b[2] / f.se[2]) },
  fit_all: { a: r3(fAll.b[0]), b_mkt: r3(fAll.b[1]), c_model: r3(fAll.b[2]), se_c: r3(fAll.se[2]), t_c: r3(fAll.b[2] / fAll.se[2]) },
  test_all_picks: { ...roi(te), ...seRoi(te), brier_pmodel: brierOf(te, (r) => r.p_model), brier_pimplied: brierOf(te, (r) => r.p_implied), brier_pstar: brierOf(te, (r) => pStar(r, f.b)) },
  train_all_picks: { ...roi(tr), ...seRoi(tr) },
};
// regla de decisión en test: apostar solo si p* − p_implied ≥ umbral (umbral fijado a priori: 0 y 3 pp)
for (const th of [0, 0.03]) { const sub = te.filter((r) => pStar(r, f.b) - r.p_implied >= th); c[`test_rule_pstar_ge_${th}`] = { ...roi(sub), ...(sub.length > 2 ? seRoi(sub) : {}) }; }
// walk-forward expansivo: desde el pick 30, ajustar con todo lo anterior y decidir el siguiente
const wf = []; for (let i = 30; i < T.length; i++) { const b = fit3(T.slice(0, i)).b; const r = T[i]; wf.push({ ...r, pstar: pStar(r, b) }); }
c.walkforward_from30 = { n: wf.length, all: { ...roi(wf), ...seRoi(wf) }, rule_pstar_ge_0: roi(wf.filter((r) => r.pstar - r.p_implied >= 0)), rule_pstar_ge_3pp: roi(wf.filter((r) => r.pstar - r.p_implied >= 0.03)), brier_pstar: brierOf(wf, (r) => r.pstar), brier_pmodel: brierOf(wf, (r) => r.p_model), brier_pimplied: brierOf(wf, (r) => r.p_implied) };
// cierre: solo donde existe
const wc = T.filter((r) => r.close_price); c.close = { n: wc.length, clv_avg_pct: wc.length ? r3(wc.reduce((s, r) => s + r.clv_pct, 0) / wc.length) : null, roi_at_close_pct: wc.length ? r3(100 * wc.reduce((s, r) => s + (r.result === 'WIN' ? r.close_price - 1 : -1), 0) / wc.length) : null };
// composición
c.by_tour_bo = {}; for (const r of T) { const k = `${r.tour === 0 ? 'atp' : 'wta'}_bo${r.best_of}_${r.side}`; c.by_tour_bo[k] = c.by_tour_bo[k] || { n: 0, w: 0, u: 0 }; c.by_tour_bo[k].n++; if (r.result === 'WIN') c.by_tour_bo[k].w++; c.by_tour_bo[k].u += r.units; }
c.by_book = {}; for (const r of T) { c.by_book[r.book] = c.by_book[r.book] || { n: 0, u: 0 }; c.by_book[r.book].n++; c.by_book[r.book].u += r.units; }
OUT.book_total = c;
console.log('\n══════ (c) LIBRO TOTAL ══════'); console.log(JSON.stringify(c, null, 1));
fs.writeFileSync(__dirname + '/h3_out.json', JSON.stringify(OUT, null, 1));
