'use strict';
// ESCÉPTICO H3a/H3b — ¿la ganancia de C4/C6 es FORMA o solo LOCALIZACIÓN (mediana desplazada)? ¿aguanta por año y en
// líneas alejadas de la mediana? ¿depende la métrica de que la línea sintética sea la mediana de C1?
const fs = require('fs');
const U = require('./util.js');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis';
const DEV_END = 20250101;
const out = {};
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(`${SRC}/preds-${label}.json`, 'utf8'));
  const D = P.dists;
  const rows = P.preds.filter((p) => !p.ret && p.actGames > 5);
  const dev = rows.filter((p) => p.date < DEV_END), ho = rows.filter((p) => p.date >= DEV_END);
  const exp = (p) => D[p.dist].expGames;
  const calFit = (set, bo) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0; for (const p of set) if (p.bo === bo) { const x = exp(p); sx += x; sy += p.actGames; sxx += x * x; sxy += x * p.actGames; n++; } if (n < 50) return [0, 1]; const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); return [(sy - b * sx) / n, b]; };
  const cal = { 3: calFit(dev, 3), 5: calFit(dev, 5) };
  const calG = (p) => cal[p.bo][0] + cal[p.bo][1] * exp(p);
  const toDist = (arr) => { const lo = Math.min(...arr), hi = Math.max(...arr); const pr = new Array(hi - lo + 1).fill(0); for (const v of arr) pr[v - lo] += 1 / arr.length; return { min: lo, p: pr }; };
  const resid = {}; for (const p of dev) (resid[p.bo] = resid[p.bo] || []).push(Math.round(p.actGames - calG(p)));
  const RES = Object.fromEntries(Object.entries(resid).map(([k, v]) => [k, toDist(v)])); for (const bo of [3, 5]) if (!RES[bo]) RES[bo] = RES[3] || RES[5];
  const terc = {}; for (const bo of [3, 5]) { const xs = dev.filter((p) => p.bo === bo).map(exp).sort((a, b) => a - b); terc[bo] = xs.length ? [xs[Math.floor(xs.length / 3)], xs[Math.floor(2 * xs.length / 3)]] : [0, 0]; }
  const tercOf = (p) => (exp(p) < terc[p.bo][0] ? 0 : exp(p) < terc[p.bo][1] ? 1 : 2);
  const residT = {}; for (const p of dev) { const k = p.bo + '|' + tercOf(p); (residT[k] = residT[k] || []).push(Math.round(p.actGames - calG(p))); }
  const REST = Object.fromEntries(Object.entries(residT).map(([k, v]) => [k, toDist(v)]));
  const C1 = (p) => U.distAffine(D[p.dist], calG(p) - exp(p), 1);
  const C4 = (p) => U.distAffine(RES[p.bo], calG(p), 1);
  const C6 = (p) => U.distAffine(REST[p.bo + '|' + tercOf(p)] || RES[p.bo], calG(p), 1);
  // C1δ: SOLO localización — desplazar C1 por una constante δ por formato elegida en DEV para que P(real>mediana) case con la propia P(>mediana) del modelo
  const delta = {};
  for (const bo of [3, 5]) {
    const s = dev.filter((p) => p.bo === bo); if (s.length < 50) { delta[bo] = 0; continue; }
    let best = { d: 0, gap: Infinity };
    for (let d = -2; d <= 1; d += 0.25) { let gt = 0, pm = 0; for (const p of s) { const dd = U.distAffine(D[p.dist], calG(p) - exp(p) + d, 1); const med = U.distMedian(dd); gt += p.actGames > med ? 1 : 0; pm += U.distPover(dd, med); } const gap = Math.abs(gt - pm) / s.length; if (gap < best.gap) best = { d, gap }; }
    delta[bo] = best.d;
  }
  const C1d = (p) => U.distAffine(D[p.dist], calG(p) - exp(p) + delta[p.bo], 1);
  const cands = { C1_prod: C1, C1_delta_solo_localizacion: C1d, C4_residuo: C4, C6_residuo_tercil: C6 };
  const res = { n_dev: dev.length, n_holdout: ho.length, delta_dev: delta, terciles_dev: terc, candidatos: {} };
  // métricas por candidato en holdout: CRPS; Brier a la mediana de C1 + 0,5 (línea del autor); Brier a un ABANICO de líneas (mediana C1 + {−2.5…+2.5});
  // Brier a línea FIJA por formato (mediana empírica de dev); fiabilidad P(over) global; P(real>med) vs P_modelo(>med)
  const fixedLine = {}; for (const bo of [3, 5]) { const xs = dev.filter((p) => p.bo === bo).map((p) => p.actGames).sort((a, b) => a - b); fixedLine[bo] = xs.length ? xs[Math.floor(xs.length / 2)] + 0.5 : 0; }
  res.linea_fija_dev = fixedLine;
  const per = {};
  for (const [name, fn] of Object.entries(cands)) {
    const o = { crps: [], br_med: [], br_fan: [], br_fix: [], gt: 0, pgt: 0, relN: new Array(10).fill(0), relP: new Array(10).fill(0), relY: new Array(10).fill(0) };
    for (const p of ho) {
      const d = fn(p); const medC1 = U.distMedian(C1(p));
      o.crps.push(U.crps(d, p.actGames));
      const L = medC1 + 0.5; const po = U.distPover(d, L); o.br_med.push((po - (p.actGames > L ? 1 : 0)) ** 2);
      let s = 0; for (const off of [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]) { const LL = medC1 + off; const q = U.distPover(d, LL); s += (q - (p.actGames > LL ? 1 : 0)) ** 2; const b = Math.min(9, Math.floor(q * 10)); o.relN[b]++; o.relP[b] += q; o.relY[b] += p.actGames > LL ? 1 : 0; } o.br_fan.push(s / 6);
      const LF = fixedLine[p.bo]; const qf = U.distPover(d, LF); o.br_fix.push((qf - (p.actGames > LF ? 1 : 0)) ** 2);
      const med = U.distMedian(d); o.gt += p.actGames > med ? 1 : 0; o.pgt += U.distPover(d, med);
    }
    per[name] = o;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    res.candidatos[name] = { crps: U.r(mean(o.crps), 4), brier_linea_medianaC1: U.r(mean(o.br_med), 4), brier_abanico_6_lineas: U.r(mean(o.br_fan), 4), brier_linea_fija_dev: U.r(mean(o.br_fix), 4), p_real_gt_mediana: U.r(o.gt / ho.length, 4), p_modelo_gt_mediana: U.r(o.pgt / ho.length, 4), fiabilidad: o.relN.map((n, i) => (n ? { bin: `${i / 10}-${(i + 1) / 10}`, n, pred: U.r(o.relP[i] / n, 3), real: U.r(o.relY[i] / n, 3) } : null)).filter(Boolean) };
  }
  // deltas pareados vs C1 y vs C1δ, global y por periodo
  const idx = { todo: ho.map((_, i) => i), y2025: ho.map((p, i) => (p.date < 20260101 ? i : -1)).filter((i) => i >= 0), y2026: ho.map((p, i) => (p.date >= 20260101 ? i : -1)).filter((i) => i >= 0), bo3: ho.map((p, i) => (p.bo === 3 ? i : -1)).filter((i) => i >= 0), bo5: ho.map((p, i) => (p.bo === 5 ? i : -1)).filter((i) => i >= 0) };
  res.deltas = {};
  for (const [name, o] of Object.entries(per)) {
    if (name === 'C1_prod') continue;
    res.deltas[name] = {};
    for (const [ref, ro] of [['vs_C1', per.C1_prod], ['vs_C1delta', per.C1_delta_solo_localizacion]]) {
      if (ro === o) continue;
      res.deltas[name][ref] = {};
      for (const [tag, ii] of Object.entries(idx)) {
        if (ii.length < 100) continue;
        const bc = U.pairedBootstrap(ii.map((i) => ro.crps[i] - o.crps[i]), 1000), bm = U.pairedBootstrap(ii.map((i) => ro.br_med[i] - o.br_med[i]), 1000), bf = U.pairedBootstrap(ii.map((i) => ro.br_fan[i] - o.br_fan[i]), 1000), bx = U.pairedBootstrap(ii.map((i) => ro.br_fix[i] - o.br_fix[i]), 1000);
        res.deltas[name][ref][tag] = { n: ii.length, dCRPS: U.r(bc.mean, 4), t_crps: U.r(bc.t, 2), dBrier_medC1: U.r(bm.mean, 5), t_medC1: U.r(bm.t, 2), dBrier_abanico: U.r(bf.mean, 5), t_abanico: U.r(bf.t, 2), dBrier_fija: U.r(bx.mean, 5), t_fija: U.r(bx.t, 2) };
      }
    }
  }
  out[label] = res;
  console.log(`\n═══ SK-H3 ${label.toUpperCase()} ═══ holdout n=${ho.length} · δ dev ${JSON.stringify(delta)} · línea fija dev ${JSON.stringify(fixedLine)}`);
  for (const [k, v] of Object.entries(res.candidatos)) console.log(`${k.padEnd(28)} CRPS ${v.crps} · Brier medC1 ${v.brier_linea_medianaC1} · abanico ${v.brier_abanico_6_lineas} · fija ${v.brier_linea_fija_dev} · P(real>med) ${v.p_real_gt_mediana} vs modelo ${v.p_modelo_gt_mediana}`);
  for (const [k, v] of Object.entries(res.deltas)) for (const [ref, vv] of Object.entries(v)) console.log(`  ${k} ${ref}: ${JSON.stringify(vv)}`);
  console.log('  fiabilidad C6:', JSON.stringify(res.candidatos.C6_residuo_tercil.fiabilidad));
  console.log('  fiabilidad C1δ:', JSON.stringify(res.candidatos.C1_delta_solo_localizacion.fiabilidad));
}
fs.writeFileSync(__dirname + '/sk-h3-out.json', JSON.stringify(out, null, 1));
