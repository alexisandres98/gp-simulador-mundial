'use strict';
// H2 — SAQUE/RESTO POR SUPERFICIE. Variantes calculadas en pass.js con las constantes congeladas:
//   V0_prod        tourSpw global + dev global (producción)
//   V1_tourSpwSurf media del tour POR SUPERFICIE + dev global
//   V2/V3/V4       dev por superficie encogido hacia el dev global del jugador: devS = (v_s + K2·devG)/(w_s + K2), K2 = 5/15/40
//   V5_both_K15    V1 + V3
// Se mide en HOLDOUT (2025→): Brier/LL del compilado solo, del ensamble con u congelado, y del ensamble con u
// re-elegido en desarrollo para esa variante; MAE de juegos con calibración lineal ajustada en desarrollo.
const fs = require('fs');
const U = require('./util.js');
const DEV_END = 20250101;
const out = {};
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(__dirname + `/preds-${label}.json`, 'utf8'));
  const u0 = P.cfg.u;
  const rows = P.preds.filter((p) => !p.ret);
  const dev = rows.filter((p) => p.date < DEV_END), ho = rows.filter((p) => p.date >= DEV_END);
  const ensOf = (p, v, u) => U.sig((1 - u) * U.lg(p.mix) + u * U.lg(p.comp[v]));
  const res = { n_dev: dev.length, n_holdout: ho.length, u_prod: u0, variants: {} };
  const calFit = (set, v, bo) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0; for (const p of set) { if (p.actGames > 5 && p.bo === bo) { const x = p.expG[v]; sx += x; sy += p.actGames; sxx += x * x; sxy += x * p.actGames; n++; } } if (n < 50) return [0, 1]; const b = (n * sxy - sx * sy) / (n * sxx - sx * sx); return [(sy - b * sx) / n, b]; };
  const base = { comp: ho.map((p) => U.clamp(p.comp.V0_prod, 1e-6, 1 - 1e-6)), ens: ho.map((p) => ensOf(p, 'V0_prod', u0)) };
  let baseMae = null;
  for (const v of P.variants) {
    const mComp = U.metrics(ho.map((p) => ({ p: p.comp[v], y: p.y })));
    const mEns = U.metrics(ho.map((p) => ({ p: ensOf(p, v, u0), y: p.y })));
    // u re-elegido en dev para la variante (misma rejilla que tennis-fit.js)
    let bestU = { u: 0, ll: Infinity };
    for (const u of [0, 0.15, 0.3, 0.45, 0.6]) { const m = U.metrics(dev.map((p) => ({ p: ensOf(p, v, u), y: p.y }))); if (m.logloss < bestU.ll) bestU = { u, ll: m.logloss }; }
    const mEnsU = U.metrics(ho.map((p) => ({ p: ensOf(p, v, bestU.u), y: p.y })));
    const mCompDev = U.metrics(dev.map((p) => ({ p: p.comp[v], y: p.y })));
    // juegos: calibración lineal en dev, MAE en holdout
    const cal3 = calFit(dev, v, 3), cal5 = calFit(dev, v, 5);
    const gh = ho.filter((p) => p.actGames > 5);
    const errs = gh.map((p) => { const c = p.bo === 5 ? cal5 : cal3; return Math.abs(c[0] + c[1] * p.expG[v] - p.actGames); });
    const mae = errs.reduce((a, b) => a + b, 0) / errs.length;
    if (v === 'V0_prod') baseMae = errs;
    // bootstrap pareado vs V0 (base − variante; >0 mejora)
    const dLLc = ho.map((p, i) => { const l = (q) => (p.y ? -Math.log(q) : -Math.log(1 - q)); return l(base.comp[i]) - l(U.clamp(p.comp[v], 1e-6, 1 - 1e-6)); });
    const dLLe = ho.map((p, i) => { const l = (q) => (p.y ? -Math.log(q) : -Math.log(1 - q)); return l(U.clamp(base.ens[i], 1e-6, 1 - 1e-6)) - l(U.clamp(ensOf(p, v, u0), 1e-6, 1 - 1e-6)); });
    const dMae = errs.map((e, i) => baseMae[i] - e);
    const bc = U.pairedBootstrap(dLLc), be = U.pairedBootstrap(dLLe), bm = U.pairedBootstrap(dMae, 1000);
    res.variants[v] = {
      dev_comp: { logloss: U.r(mCompDev.logloss), skill_pct: U.r(mCompDev.skill_pct, 2) },
      holdout_comp: { logloss: U.r(mComp.logloss), brier: U.r(mComp.brier), skill_pct: U.r(mComp.skill_pct, 2), auc: U.r(mComp.auc) },
      holdout_ens_u_prod: { logloss: U.r(mEns.logloss), brier: U.r(mEns.brier), skill_pct: U.r(mEns.skill_pct, 2) },
      u_refit_dev: bestU.u, holdout_ens_u_refit: { logloss: U.r(mEnsU.logloss), brier: U.r(mEnsU.brier), skill_pct: U.r(mEnsU.skill_pct, 2) },
      games_cal_dev: { bo3: cal3.map((x) => U.r(x, 3)), bo5: cal5.map((x) => U.r(x, 3)) }, holdout_games_mae: U.r(mae, 3), games_n: gh.length,
      delta_vs_V0: { comp_logloss: { mean: U.r(bc.mean, 5), t: U.r(bc.t, 2) }, ens_logloss: { mean: U.r(be.mean, 5), t: U.r(be.t, 2) }, games_mae: { mean: U.r(bm.mean, 4), t: U.r(bm.t, 2) } },
    };
  }
  // corte por superficie del holdout para V0 vs mejor variante de dev (compilado)
  const bestDev = P.variants.slice(1).reduce((b, v) => (res.variants[v].dev_comp.logloss < res.variants[b].dev_comp.logloss ? v : b), P.variants[1]);
  res.mejor_variante_por_dev_comp = bestDev;
  res.holdout_por_superficie = {};
  for (const s of [0, 1, 2]) {
    const sel = ho.filter((p) => p.surf === s); if (sel.length < 50) continue;
    const m0 = U.metrics(sel.map((p) => ({ p: p.comp.V0_prod, y: p.y }))), m1 = U.metrics(sel.map((p) => ({ p: p.comp[bestDev], y: p.y })));
    const e0 = U.metrics(sel.map((p) => ({ p: ensOf(p, 'V0_prod', u0), y: p.y }))), e1 = U.metrics(sel.map((p) => ({ p: ensOf(p, bestDev, u0), y: p.y })));
    res.holdout_por_superficie[['dura', 'arcilla', 'hierba'][s]] = { n: sel.length, comp_V0_logloss: U.r(m0.logloss), comp_best_logloss: U.r(m1.logloss), ens_V0_logloss: U.r(e0.logloss), ens_best_logloss: U.r(e1.logloss) };
  }
  out[label] = res;
  console.log(`\n═══ H2 ${label.toUpperCase()} ═══ dev n=${res.n_dev} holdout n=${res.n_holdout} (u prod ${u0})`);
  for (const [v, x] of Object.entries(res.variants)) console.log(`${v.padEnd(16)} comp LL ${x.holdout_comp.logloss} skill ${x.holdout_comp.skill_pct}% · ens(u prod) LL ${x.holdout_ens_u_prod.logloss} skill ${x.holdout_ens_u_prod.skill_pct}% · ens(u=${x.u_refit_dev}) skill ${x.holdout_ens_u_refit.skill_pct}% · MAE ${x.holdout_games_mae} · Δ vs V0: comp t ${x.delta_vs_V0.comp_logloss.t}, ens t ${x.delta_vs_V0.ens_logloss.t}, mae t ${x.delta_vs_V0.games_mae.t}`);
  console.log('por superficie:', JSON.stringify(res.holdout_por_superficie));
}
fs.writeFileSync(__dirname + '/h2-out.json', JSON.stringify(out, null, 1));
