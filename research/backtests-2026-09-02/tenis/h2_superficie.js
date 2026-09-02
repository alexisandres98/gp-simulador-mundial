// H2 — saque/resto por superficie (EW por superficie encogido hacia el global del jugador con K pseudo-obs)
// y, como variante aparte, la media del tour de spw por superficie como base del compilado.
// Selección de K y del peso u del ensamble en DESARROLLO (2018→2024); holdout 2025→ una sola vez.
// USO: node h2_superficie.js <tour 0|1>
'use strict';
const P = require('./pass.js'); const fs = require('fs');
const tour = +process.argv[2]; const lbl = tour === 0 ? 'atp' : 'wta';
const DEV0 = 20180101, DEV1 = 20250101, SPINE_END = 20260526;
const fz = P.frozen(tour);
const variants = {
  base: {},
  surfTour: { surfTour: true },
  surfSR_K5: { surfSR: { K: 5 } },
  surfSR_K15: { surfSR: { K: 15 } },
  surfSR_K40: { surfSR: { K: 40 } },
  surfTour_K15: { surfTour: true, surfSR: { K: 15 } },
};
const calFit = (arr, bo) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0; for (const p of arr) if (p.actGames > 5 && p.bo === bo) { sx += p.expGames; sy += p.actGames; sxx += p.expGames ** 2; sxy += p.expGames * p.actGames; n++; } if (n < 50) return [0, 1]; const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); return [(sy - b * sx) / n, b]; };
const OUT = { tour: lbl, variants: {} };
let basePreds = null;
for (const [name, extra] of Object.entries(variants)) {
  const t0 = Date.now();
  const all = P.runPass(tour, { ...fz, ...extra, needComp: true }, DEV0, 99999999);
  const dev = all.filter((p) => p.date < DEV1), ho = all.filter((p) => p.date >= DEV1), hoS = ho.filter((p) => p.date < SPINE_END);
  const mDevComp = P.metrics(dev.map((p) => ({ p: p.comp, y: p.y })));
  // u del ensamble elegido en dev
  let bestU = null; for (const u of [0, 0.15, 0.3, 0.45, 0.6, 0.75]) { const m = P.metrics(dev.map((p) => ({ p: P.ens(p, u), y: p.y }))); if (!bestU || m.logloss < bestU.m.logloss) bestU = { u, m }; }
  const mHoComp = P.metrics(ho.map((p) => ({ p: p.comp, y: p.y }))), mHoEns = P.metrics(ho.map((p) => ({ p: P.ens(p, bestU.u), y: p.y }))), mHoEnsFz = P.metrics(ho.map((p) => ({ p: P.ens(p, fz.u), y: p.y })));
  const mHoSComp = P.metrics(hoS.map((p) => ({ p: p.comp, y: p.y }))), mHoSEns = P.metrics(hoS.map((p) => ({ p: P.ens(p, bestU.u), y: p.y })));
  // forma: MAE de juegos con calibración lineal ajustada en dev, por formato; y por superficie
  const cal3 = calFit(dev, 3), cal5 = calFit(dev, 5); const calG = (p) => (p.bo === 5 ? cal5 : cal3)[0] + (p.bo === 5 ? cal5 : cal3)[1] * p.expGames;
  let mae = 0, n = 0, tb = 0; const bySurf = {};
  for (const p of ho) if (p.actGames > 5) { const e = Math.abs(calG(p) - p.actGames); mae += e; tb += (p.tbAny - p.actTb) ** 2; n++; const s = p.surf; bySurf[s] = bySurf[s] || { n: 0, mae: 0, bias: 0 }; bySurf[s].n++; bySurf[s].mae += e; bySurf[s].bias += calG(p) - p.actGames; }
  for (const s of Object.keys(bySurf)) { bySurf[s].mae /= bySurf[s].n; bySurf[s].bias /= bySurf[s].n; }
  const res = { n_dev: dev.length, n_ho: ho.length, dev_comp: mDevComp, dev_bestU: bestU.u, dev_ens: bestU.m, ho_comp: mHoComp, ho_ens: mHoEns, ho_ens_uFrozen: mHoEnsFz, hoSpine_comp: mHoSComp, hoSpine_ens: mHoSEns, games_mae: mae / n, tb_brier: tb / n, form_n: n, bySurf, cal3, cal5 };
  // bootstrap pareado vs base (comp y ens con u congelado de la base) sobre el holdout
  if (basePreds) {
    const llf = (p, y) => { const pc = P.clamp(p, 1e-6, 1 - 1e-6); return y ? -Math.log(pc) : -Math.log(1 - pc); };
    res.dLL_comp_vs_base = P.pairedBoot(ho.map((p, i) => llf(p.comp, p.y) - llf(basePreds.ho[i].comp, p.y)));
    res.dBrier_comp_vs_base = P.pairedBoot(ho.map((p, i) => (p.comp - p.y) ** 2 - (basePreds.ho[i].comp - p.y) ** 2));
    res.dLL_ens_vs_base = P.pairedBoot(ho.map((p, i) => llf(P.ens(p, bestU.u), p.y) - llf(P.ens(basePreds.ho[i], basePreds.u), p.y)));
    res.dMAE_vs_base = P.pairedBoot(ho.filter((p) => p.actGames > 5).map((p, i) => Math.abs(calG(p) - p.actGames)).map((v, i) => v - basePreds.maeVec[i]));
  } else basePreds = { ho, u: bestU.u, maeVec: ho.filter((p) => p.actGames > 5).map((p) => Math.abs(calG(p) - p.actGames)) };
  OUT.variants[name] = res;
  console.log(`[${lbl} ${name}] ${((Date.now() - t0) / 1000).toFixed(0)}s · dev comp LL ${mDevComp.logloss.toFixed(4)} · u*=${bestU.u} dev ens skill ${bestU.m.skill_pct.toFixed(2)}% · HOLDOUT comp LL ${mHoComp.logloss.toFixed(4)} Brier ${mHoComp.brier.toFixed(4)} skill ${mHoComp.skill_pct.toFixed(2)}% · ens skill ${mHoEns.skill_pct.toFixed(2)}% Brier ${mHoEns.brier.toFixed(4)} (u congelado ${mHoEnsFz.skill_pct.toFixed(2)}%) · espina comp ${mHoSComp.skill_pct.toFixed(2)}% ens ${mHoSEns.skill_pct.toFixed(2)}% · MAE juegos ${(mae / n).toFixed(3)} TB Brier ${(tb / n).toFixed(4)}`
    + (res.dLL_comp_vs_base ? ` · ΔLL comp ${res.dLL_comp_vs_base.mean.toFixed(5)} (t ${res.dLL_comp_vs_base.t.toFixed(2)}) ΔLL ens ${res.dLL_ens_vs_base.mean.toFixed(5)} (t ${res.dLL_ens_vs_base.t.toFixed(2)}) ΔMAE ${res.dMAE_vs_base.mean.toFixed(4)} (t ${res.dMAE_vs_base.t.toFixed(2)})` : ''));
  console.log('   por superficie (MAE, sesgo pred−real):', JSON.stringify(Object.fromEntries(Object.entries(bySurf).map(([s, v]) => [s, { n: v.n, mae: +v.mae.toFixed(3), bias: +v.bias.toFixed(3) }]))));
  fs.writeFileSync(__dirname + `/h2_out_${lbl}.json`, JSON.stringify(OUT, null, 1));
}
