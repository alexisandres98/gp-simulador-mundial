'use strict';
// H5 — PAQUETE COMBINADO sobre el ensamble congelado: z = logit(ens) + β1·Δdays_log + β2·Δn7 + β3·Δedad + β4·Δedad² + γ·Δlogit(riesgo_retiro)
// Todo ajustado en desarrollo (2018→2024), evaluado UNA vez en holdout (2025→). Mide si los términos aceptados
// por separado (H1 fatiga/calendario, edad, H4 riesgo) se solapan o se suman.
const fs = require('fs');
const U = require('./util.js');
const DEV_END = 20250101;
const out = {};
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(__dirname + `/preds-${label}.json`, 'utf8'));
  const u = P.cfg.u;
  const all = P.preds;
  const ens = (p) => U.sig((1 - u) * U.lg(p.mix) + u * U.lg(p.comp.V0_prod));
  const AGE = (f) => (f.age != null ? f.age : 26);
  // riesgo de retiro por jugador (mismo modelo que H4, ajustado en dev con retiros incluidos)
  const pf = (f, p) => [f.age != null ? f.age - 27 : 0, f.age != null && f.age >= 30 ? 1 : 0, Math.log(f.rank || 150) - Math.log(50), f.ret365, f.retLast, (f.nRet + 0.03 * 20) / (f.nM + 20) * 100 - 3, Math.log1p(f.hasPrev ? Math.min(Math.max(0, f.days), 60) : 30) - Math.log1p(7), f.hasPrev && f.days >= 30 ? 1 : 0, f.minLast != null ? (f.minLast - p.meanMin) / 60 : 0, f.n7, p.bo === 5 || p.lvl === 'G' ? 1 : 0, p.surf === 1 ? 1 : 0, p.surf === 2 ? 1 : 0, p.rd <= 5 ? 1 : 0];
  const devAll = all.filter((p) => p.date < DEV_END);
  const rowsPl = []; for (const p of devAll) { rowsPl.push({ x: pf(p.fX, p), y: p.ret && p.y === 0 ? 1 : 0 }); rowsPl.push({ x: pf(p.fY, p), y: p.ret && p.y === 1 ? 1 : 0 }); }
  const fitP = U.logisticFit(rowsPl.map((r) => r.x), rowsPl.map((r) => r.y), null, { intercept: true, ridge: 1e-2 });
  const risk = (f, p) => fitP.predict(pf(f, p));
  const rows = all.filter((p) => !p.ret);
  const dev = rows.filter((p) => p.date < DEV_END), ho = rows.filter((p) => p.date >= DEV_END);
  const dl = (f) => Math.log1p(f.hasPrev ? Math.min(Math.max(0, f.days), 60) : 30);
  const FE = {
    days_log: (p) => dl(p.fX) - dl(p.fY), n7: (p) => p.fX.n7 - p.fY.n7,
    edad_dif_5a: (p) => (AGE(p.fX) - AGE(p.fY)) / 5, edad_cuad_dif: (p) => ((AGE(p.fX) - 27) ** 2 - (AGE(p.fY) - 27) ** 2) / 50,
    riesgo_logit_dif: (p) => U.lg(risk(p.fX, p)) - U.lg(risk(p.fY, p)),
  };
  const base = U.metrics(ho.map((p) => ({ p: ens(p), y: p.y })));
  const res = { n_dev: dev.length, n_holdout: ho.length, base_holdout: { logloss: U.r(base.logloss), brier: U.r(base.brier), skill_pct: U.r(base.skill_pct, 2), auc: U.r(base.auc) }, paquetes: {} };
  const run = (names, tag) => {
    const X = (p) => names.map((k) => FE[k](p));
    const fit = U.logisticFit(dev.map(X), dev.map((p) => p.y), dev.map((p) => U.lg(ens(p))), { intercept: true, ridge: 1e-3 });
    const pred = (p) => fit.predict(X(p), U.lg(ens(p)));
    const mh = U.metrics(ho.map((p) => ({ p: pred(p), y: p.y })));
    const dLL = ho.map((p) => { const l = (q) => (p.y ? -Math.log(U.clamp(q, 1e-6, 1 - 1e-6)) : -Math.log(1 - U.clamp(q, 1e-6, 1 - 1e-6))); return l(ens(p)) - l(pred(p)); });
    const dBr = ho.map((p) => (ens(p) - p.y) ** 2 - (pred(p) - p.y) ** 2);
    const b = U.pairedBootstrap(dLL), bb = U.pairedBootstrap(dBr);
    const sub = (sel, t) => { const s = ho.filter(sel); if (!s.length) return null; const m0 = U.metrics(s.map((p) => ({ p: ens(p), y: p.y }))), m1 = U.metrics(s.map((p) => ({ p: pred(p), y: p.y }))); return { n: s.length, base_skill: U.r(m0.skill_pct, 2), var_skill: U.r(m1.skill_pct, 2), base_logloss: U.r(m0.logloss), var_logloss: U.r(m1.logloss) }; };
    res.paquetes[tag] = {
      features: names, coef: Object.fromEntries(['intercept', ...names].map((k, i) => [k, U.r(fit.coef[i], 4)])), t_dev: Object.fromEntries(['intercept', ...names].map((k, i) => [k, U.r(fit.t[i], 2)])),
      holdout: { logloss: U.r(mh.logloss), brier: U.r(mh.brier), skill_pct: U.r(mh.skill_pct, 2), auc: U.r(mh.auc) },
      delta_logloss: { mean: U.r(b.mean, 5), se: U.r(b.se, 5), t: U.r(b.t, 2), lo95: U.r(b.lo95, 5), hi95: U.r(b.hi95, 5) }, delta_brier: { mean: U.r(bb.mean, 5), t: U.r(bb.t, 2) },
      holdout_espina: sub((p) => p.date < 20260526), holdout_cola_espn: sub((p) => p.date >= 20260526),
      holdout_2025: sub((p) => p.date < 20260101), holdout_2026: sub((p) => p.date >= 20260101),
    };
  };
  run(['days_log', 'n7'], 'fatiga');
  run(['days_log', 'n7', 'edad_dif_5a', 'edad_cuad_dif'], 'fatiga_edad');
  run(['riesgo_logit_dif'], 'riesgo');
  run(['days_log', 'n7', 'riesgo_logit_dif'], 'fatiga_riesgo');
  run(['days_log', 'n7', 'edad_dif_5a', 'edad_cuad_dif', 'riesgo_logit_dif'], 'fatiga_edad_riesgo');
  out[label] = res;
  console.log(`\n═══ H5 ${label.toUpperCase()} ═══ holdout n=${res.n_holdout} base skill ${res.base_holdout.skill_pct}% LL ${res.base_holdout.logloss}`);
  for (const [k, x] of Object.entries(res.paquetes)) console.log(`${k.padEnd(20)} skill ${x.holdout.skill_pct}% LL ${x.holdout.logloss} Brier ${x.holdout.brier} · ΔLL ${x.delta_logloss.mean} [${x.delta_logloss.lo95}, ${x.delta_logloss.hi95}] t ${x.delta_logloss.t} · 2025: ${x.holdout_2025.base_skill}→${x.holdout_2025.var_skill} · 2026: ${x.holdout_2026.base_skill}→${x.holdout_2026.var_skill} · cola ESPN: ${x.holdout_cola_espn ? x.holdout_cola_espn.base_skill + '→' + x.holdout_cola_espn.var_skill : '-'} · t_dev ${JSON.stringify(x.t_dev)}`);
}
fs.writeFileSync(__dirname + '/h5-out.json', JSON.stringify(out, null, 1));
