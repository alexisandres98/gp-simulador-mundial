'use strict';
// H3 (a)(b) — TOTAL DE JUEGOS: calibración de la distribución del compilado y alternativas al desplazamiento.
// Distribución base = matchDist con constantes congeladas (rejilla 0,004 en p de punto). Todo parámetro se ajusta
// en DESARROLLO (2018→2024) y se evalúa en HOLDOUT (2025→), partidos completos con >5 juegos, por circuito.
// Candidatos:
//   C0 cruda · C1 desplazar por calG − expGames (producción, store.js:169) · C2 desplazar + reescalar s (elegido en dev por CRPS)
//   C3 mezcla C1 con la empírica de dev por (formato, superficie), peso m elegido en dev · C4 punto calibrado + residuo empírico de dev
//   C5 = C2 + mezcla
// Métricas: MAE de la mediana, CRPS, log-score de la PMF, Brier de over contra la MEDIANA de C1 + 0,5 como línea sintética (misma
// línea para todos), y calibración (media, sd, PIT, cobertura, tabla de fiabilidad de P(over)).
const fs = require('fs');
const U = require('./util.js');
const DEV_END = 20250101;
const out = {};
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(`/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis/preds-${label}.json`, 'utf8'));
  const D = P.dists;
  const rows = P.preds.filter((p) => !p.ret && p.actGames > 5);
  const dev = rows.filter((p) => p.date < DEV_END), ho = rows.filter((p) => p.date >= DEV_END);
  const exp = (p) => D[p.dist].expGames;
  const calFit = (set, bo) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0; for (const p of set) if (p.bo === bo) { const x = exp(p); sx += x; sy += p.actGames; sxx += x * x; sxy += x * p.actGames; n++; } if (n < 50) return [0, 1]; const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); return [(sy - b * sx) / n, b]; };
  const cal = { 3: calFit(dev, 3), 5: calFit(dev, 5) };
  const calG = (p) => cal[p.bo][0] + cal[p.bo][1] * exp(p);
  // empíricas de dev por (bo, surf) y residuos por bo
  const emp = {}, resid = {};
  for (const p of dev) {
    const k = p.bo + '|' + (p.surf >= 0 ? (p.surf === 3 ? 0 : p.surf) : 0); (emp[k] = emp[k] || []).push(p.actGames);
    (resid[p.bo] = resid[p.bo] || []).push(Math.round(p.actGames - calG(p)));
  }
  const toDist = (arr) => { const lo = Math.min(...arr), hi = Math.max(...arr); const pr = new Array(hi - lo + 1).fill(0); for (const v of arr) pr[v - lo] += 1 / arr.length; return { min: lo, p: pr }; };
  const EMP = Object.fromEntries(Object.entries(emp).map(([k, v]) => [k, toDist(v)]));
  const RES = Object.fromEntries(Object.entries(resid).map(([k, v]) => [k, toDist(v)]));
  const empOf = (p) => EMP[p.bo + '|' + (p.surf >= 0 ? (p.surf === 3 ? 0 : p.surf) : 0)] || EMP[p.bo + '|0'] || EMP['3|0'];
  for (const bo of [3, 5]) if (!RES[bo]) RES[bo] = RES[3] || RES[5];
  // constructores de candidatos
  const C = {
    C0_cruda: (p) => D[p.dist],
    C1_desplazar_prod: (p) => U.distAffine(D[p.dist], calG(p) - exp(p), 1),
    C2_reescalar: (p, s) => U.distAffine(D[p.dist], calG(p) - s * exp(p), s),
    C3_mezcla_emp: (p, m) => U.distMix(U.distAffine(D[p.dist], calG(p) - exp(p), 1), empOf(p), m),
    C4_residuo_emp: (p) => U.distAffine(RES[p.bo], calG(p), 1),
    C5_reescalar_mezcla: (p, s, m) => U.distMix(U.distAffine(D[p.dist], calG(p) - s * exp(p), s), empOf(p), m),
  };
  const score = (set, fn) => { let mae = 0, maeMean = 0, crps = 0, ls = 0, n = 0; const per = []; for (const p of set) { const d = fn(p); const med = U.distMedian(d), mu = U.distMean(d); const c = U.crps(d, p.actGames); const pm = Math.max(1e-6, U.distPmf(d, p.actGames)); mae += Math.abs(med - p.actGames); maeMean += Math.abs(mu - p.actGames); crps += c; ls += -Math.log(pm); n++; per.push(c); } return { n, mae_mediana: mae / n, mae_media: maeMean / n, crps: crps / n, logscore: ls / n, per }; };
  // elección de s y m en DEV por CRPS
  const sGrid = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.6], mGrid = [0, 0.1, 0.2, 0.3, 0.5];
  const devSel = dev.filter((_, i) => i % 3 === 0); // submuestra de dev para acelerar la selección (sin tocar holdout)
  let bestS = { s: 1, crps: Infinity }; for (const s of sGrid) { const sc = score(devSel, (p) => C.C2_reescalar(p, s)); if (sc.crps < bestS.crps) bestS = { s, crps: sc.crps }; }
  let bestM = { m: 0, crps: Infinity }; for (const m of mGrid) { const sc = score(devSel, (p) => C.C3_mezcla_emp(p, m)); if (sc.crps < bestM.crps) bestM = { m, crps: sc.crps }; }
  let bestSM = { s: bestS.s, m: 0, crps: Infinity }; for (const m of mGrid) { const sc = score(devSel, (p) => C.C5_reescalar_mezcla(p, bestS.s, m)); if (sc.crps < bestSM.crps) bestSM = { s: bestS.s, m, crps: sc.crps }; }
  // C6: residuo empírico CONDICIONAL al tercil de juegos esperados (por formato) — conserva parte de la forma
  const terc = {}; for (const bo of [3, 5]) { const xs = dev.filter((p) => p.bo === bo).map(exp).sort((a, b) => a - b); terc[bo] = xs.length ? [xs[Math.floor(xs.length / 3)], xs[Math.floor(2 * xs.length / 3)]] : [0, 0]; }
  const tercOf = (p) => (exp(p) < terc[p.bo][0] ? 0 : exp(p) < terc[p.bo][1] ? 1 : 2);
  const residT = {}; for (const p of dev) { const k = p.bo + '|' + tercOf(p); (residT[k] = residT[k] || []).push(Math.round(p.actGames - calG(p))); }
  const REST = Object.fromEntries(Object.entries(residT).map(([k, v]) => [k, toDist(v)]));
  C.C6_residuo_emp_tercil = (p) => U.distAffine(REST[p.bo + '|' + tercOf(p)] || RES[p.bo], calG(p), 1);
  const cands = {
    C0_cruda: (p) => C.C0_cruda(p), C1_desplazar_prod: (p) => C.C1_desplazar_prod(p), [`C2_reescalar_s${bestS.s}`]: (p) => C.C2_reescalar(p, bestS.s),
    [`C3_mezcla_emp_m${bestM.m}`]: (p) => C.C3_mezcla_emp(p, bestM.m), C4_residuo_emp: (p) => C.C4_residuo_emp(p), [`C5_reescalar_s${bestSM.s}_mezcla_m${bestSM.m}`]: (p) => C.C5_reescalar_mezcla(p, bestSM.s, bestSM.m),
    C6_residuo_emp_tercil: (p) => C.C6_residuo_emp_tercil(p),
  };
  // fiabilidad de P(over) de C4 en holdout, mismas líneas sintéticas que la tabla de C1
  const relC4 = (() => { const rel = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 })); let gt = 0; for (const p of ho) { const d = C.C4_residuo_emp(p); const med = U.distMedian(C.C1_desplazar_prod(p)); if (p.actGames > U.distMedian(d)) gt++; for (const off of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) { const L = med + off; const po = U.distPover(d, L); const b = Math.min(9, Math.floor(po * 10)); rel[b].n++; rel[b].p += po; rel[b].y += p.actGames > L ? 1 : 0; } } return { p_real_mayor_que_mediana_C4: U.r(gt / ho.length, 4), fiabilidad: rel.map((b, i) => (b.n ? { bin: `${i / 10}-${(i + 1) / 10}`, n: b.n, p_media: U.r(b.p / b.n, 3), frec_real: U.r(b.y / b.n, 3) } : null)).filter(Boolean) }; })();
  // línea sintética común: mediana de C1 + 0,5
  const lineOf = (p) => U.distMedian(C.C1_desplazar_prod(p)) + 0.5;
  const res = { n_dev: dev.length, n_holdout: ho.length, gamesCal_dev: { bo3: cal[3].map((x) => U.r(x, 3)), bo5: cal[5].map((x) => U.r(x, 3)) }, seleccion_dev: { s: bestS.s, m_C3: bestM.m, m_C5: bestSM.m, n_dev_seleccion: devSel.length }, candidatos: {} };
  let baseCrps = null, baseBr = null;
  for (const [name, fn] of Object.entries(cands)) {
    const sc = score(ho, fn);
    const brs = ho.map((p) => { const L = lineOf(p); const po = U.distPover(fn(p), L); return (po - (p.actGames > L ? 1 : 0)) ** 2; });
    const br = brs.reduce((a, b) => a + b, 0) / brs.length;
    if (name === 'C1_desplazar_prod') { baseCrps = sc.per; baseBr = brs; }
    res.candidatos[name] = { mae_mediana: U.r(sc.mae_mediana, 3), mae_media: U.r(sc.mae_media, 3), crps: U.r(sc.crps, 4), logscore: U.r(sc.logscore, 4), brier_over_linea_sintetica: U.r(br, 4), _per: sc.per, _brs: brs };
  }
  for (const [name, x] of Object.entries(res.candidatos)) {
    const bc = U.pairedBootstrap(x._per.map((c, i) => baseCrps[i] - c), 1000), bb = U.pairedBootstrap(x._brs.map((b, i) => baseBr[i] - b), 1000);
    x.delta_vs_C1 = { crps: { mean: U.r(bc.mean, 4), t: U.r(bc.t, 2) }, brier: { mean: U.r(bb.mean, 5), t: U.r(bb.t, 2) } };
    delete x._per; delete x._brs;
  }
  // ── (a) calibración de C1 en holdout ──
  const calib = (set, tag) => {
    let n = 0, sMu = 0, sAct = 0, sSd = 0, sq = 0, gtMed = 0, cov50 = 0, cov80 = 0, cov90 = 0; const pit = new Array(10).fill(0); let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const rel = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
    for (const p of set) {
      const d = C.C1_desplazar_prod(p); const mu = U.distMean(d), sd = U.distSd(d), med = U.distMedian(d);
      n++; sMu += mu; sAct += p.actGames; sSd += sd; sq += (p.actGames - mu) ** 2; if (p.actGames > med) gtMed++;
      const lo = (q) => { let c = 0; for (let i = 0; i < d.p.length; i++) { c += d.p[i]; if (c >= q) return d.min + i; } return d.min + d.p.length - 1; };
      if (p.actGames >= lo(0.25) && p.actGames <= lo(0.75)) cov50++; if (p.actGames >= lo(0.1) && p.actGames <= lo(0.9)) cov80++; if (p.actGames >= lo(0.05) && p.actGames <= lo(0.95)) cov90++;
      const u = U.distCdf(d, p.actGames - 1) + rnd() * U.distPmf(d, p.actGames); pit[Math.min(9, Math.floor(u * 10))]++;
      // fiabilidad de P(over) en líneas sintéticas alrededor de la mediana (−2.5..+2.5), para poblar todo el rango
      for (const off of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) { const L = med + off; const po = U.distPover(d, L); const b = Math.min(9, Math.floor(po * 10)); rel[b].n++; rel[b].p += po; rel[b].y += p.actGames > L ? 1 : 0; }
    }
    return { tag, n, media_pred: U.r(sMu / n, 3), media_real: U.r(sAct / n, 3), sd_pred_media: U.r(sSd / n, 3), sd_real_residuo: U.r(Math.sqrt(sq / n), 3), p_real_mayor_que_mediana: U.r(gtMed / n, 4), cobertura_50: U.r(cov50 / n, 3), cobertura_80: U.r(cov80 / n, 3), cobertura_90: U.r(cov90 / n, 3), pit_deciles: pit.map((v) => U.r(v / n, 3)), fiabilidad_p_over: rel.map((b, i) => (b.n ? { bin: `${i / 10}-${(i + 1) / 10}`, n: b.n, p_media: U.r(b.p / b.n, 3), frec_real: U.r(b.y / b.n, 3) } : null)).filter(Boolean) };
  };
  res.fiabilidad_C4_holdout = relC4;
  res.calibracion_C1_holdout = calib(ho, 'todo');
  res.calibracion_C1_holdout_bo3 = calib(ho.filter((p) => p.bo === 3), 'bo3');
  if (ho.some((p) => p.bo === 5)) res.calibracion_C1_holdout_bo5 = calib(ho.filter((p) => p.bo === 5), 'bo5');
  res.calibracion_C0_cruda_holdout = (() => { let n = 0, sMu = 0, sAct = 0, sSd = 0, sq = 0; for (const p of ho) { const d = D[p.dist]; n++; sMu += U.distMean(d); sAct += p.actGames; sSd += U.distSd(d); sq += (p.actGames - U.distMean(d)) ** 2; } return { n, media_pred: U.r(sMu / n, 3), media_real: U.r(sAct / n, 3), sd_pred_media: U.r(sSd / n, 3), sd_real_residuo: U.r(Math.sqrt(sq / n), 3) }; })();
  // por superficie: sesgo de la media de C1
  res.sesgo_C1_por_superficie_holdout = {};
  for (const s of [0, 1, 2]) { const sel = ho.filter((p) => p.surf === s); if (sel.length < 50) continue; let sMu = 0, sAct = 0; for (const p of sel) { sMu += U.distMean(C.C1_desplazar_prod(p)); sAct += p.actGames; } res.sesgo_C1_por_superficie_holdout[['dura', 'arcilla', 'hierba'][s]] = { n: sel.length, media_pred: U.r(sMu / sel.length, 2), media_real: U.r(sAct / sel.length, 2) }; }
  // ingenuo por formato (dev) como referencia de MAE
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const nv = { 3: mean(dev.filter((p) => p.bo === 3).map((p) => p.actGames)), 5: dev.some((p) => p.bo === 5) ? mean(dev.filter((p) => p.bo === 5).map((p) => p.actGames)) : 0 };
  res.mae_ingenuo_holdout = U.r(mean(ho.map((p) => Math.abs(p.actGames - nv[p.bo]))), 3);
  out[label] = res;
  console.log(`\n═══ H3 ${label.toUpperCase()} ═══ dev n=${res.n_dev} holdout n=${res.n_holdout} · cal dev ${JSON.stringify(res.gamesCal_dev)} · selección dev ${JSON.stringify(res.seleccion_dev)}`);
  for (const [k, x] of Object.entries(res.candidatos)) console.log(`${k.padEnd(30)} MAE med ${x.mae_mediana} · CRPS ${x.crps} · LS ${x.logscore} · Brier O/U ${x.brier_over_linea_sintetica} · Δ vs C1: CRPS t ${x.delta_vs_C1.crps.t}, Brier t ${x.delta_vs_C1.brier.t}`);
  console.log('MAE ingenuo', res.mae_ingenuo_holdout, '· calibración C1:', JSON.stringify(res.calibracion_C1_holdout));
  console.log('cruda:', JSON.stringify(res.calibracion_C0_cruda_holdout), '· sesgo por superficie:', JSON.stringify(res.sesgo_C1_por_superficie_holdout));
}
fs.writeFileSync('/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis-skeptic/author-rerun/rerun-h3-out.json', JSON.stringify(out, null, 1));
