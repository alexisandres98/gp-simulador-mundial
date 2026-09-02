'use strict';
// H1 — FATIGA Y CALENDARIO como término aditivo en el logit del ensamble congelado.
//   z = logit(ens) + β·(f_X − f_Y)     β ajustado por logística en DESARROLLO (2018→2024-12-31), evaluado en HOLDOUT (2025→)
// Rasgos por jugador antes del partido: días desde el último partido (estimado por ronda; real en la cola ESPN),
// minutos del partido anterior, partidos en los últimos 7 días, si el anterior fue a la distancia, si se retiró en el anterior.
const fs = require('fs');
const U = require('./util.js');
const DEV_END = 20250101;
const out = {};
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(`/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis/preds-${label}.json`, 'utf8'));
  const u = P.cfg.u;
  const rows = P.preds.filter((p) => !p.ret);
  const ens = (p) => U.sig((1 - u) * U.lg(p.mix) + u * U.lg(p.comp.V0_prod));
  const f1 = (f, p) => {
    // días ≥ 0: con fechas estimadas por ronda, el partido anterior puede quedar "después" (solape espina/cola ESPN, Copa Davis)
    const days = f.hasPrev ? Math.min(Math.max(0, f.days), 60) : 30;
    return {
      days_log: Math.log1p(days),
      layoff30: f.hasPrev && f.days >= 30 ? 1 : 0,
      b2b: f.hasPrev && f.days <= 1 ? 1 : 0,
      min_prev: f.minLast != null ? (f.minLast - p.meanMin) / 60 : 0,
      n7: f.n7,
      prev_dist: f.dist,
      ret_prev: f.retLast,
    };
  };
  const NAMES = ['days_log', 'layoff30', 'b2b', 'min_prev', 'n7', 'prev_dist', 'ret_prev'];
  const X = (p, names) => { const a = f1(p.fX, p), b = f1(p.fY, p); return names.map((k) => a[k] - b[k]); };
  const dev = rows.filter((p) => p.date < DEV_END), ho = rows.filter((p) => p.date >= DEV_END);
  const base = (set) => U.metrics(set.map((p) => ({ p: ens(p), y: p.y })));
  const res = { n_dev: dev.length, n_holdout: ho.length, base_dev: base(dev), base_holdout: base(ho), fits: {} };
  // cobertura de los rasgos
  const cov = { minutos_prev_disponibles_holdout: ho.filter((p) => p.fX.minLast != null && p.fY.minLast != null).length, sin_partido_previo_holdout: ho.filter((p) => !p.fX.hasPrev || !p.fY.hasPrev).length };
  res.cobertura = cov;
  // descriptivo: medias de los rasgos (X) en holdout
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  res.descriptivo_holdout = Object.fromEntries(NAMES.map((k) => [k, U.r(mean(ho.map((p) => f1(p.fX, p)[k])), 3)]));
  const evalFit = (names, tag) => {
    const Xd = dev.map((p) => X(p, names)), yd = dev.map((p) => p.y), od = dev.map((p) => U.lg(ens(p)));
    const fit = U.logisticFit(Xd, yd, od, { intercept: true, ridge: 1e-3 });
    const mh = U.metrics(ho.map((p) => ({ p: fit.predict(X(p, names), U.lg(ens(p))), y: p.y })));
    const md = U.metrics(dev.map((p, i) => ({ p: fit.predict(Xd[i], od[i]), y: p.y })));
    // bootstrap pareado en holdout de Δlogloss (base − variante; >0 = mejora)
    const dLL = ho.map((p) => { const pb = U.clamp(ens(p), 1e-6, 1 - 1e-6), pv = U.clamp(fit.predict(X(p, names), U.lg(ens(p))), 1e-6, 1 - 1e-6); const l = (q) => (p.y ? -Math.log(q) : -Math.log(1 - q)); return l(pb) - l(pv); });
    const dBr = ho.map((p) => { const pb = ens(p), pv = fit.predict(X(p, names), U.lg(ens(p))); return (pb - p.y) ** 2 - (pv - p.y) ** 2; });
    res.fits[tag] = {
      features: names, coef: Object.fromEntries(['intercept', ...names].map((k, i) => [k, U.r(fit.coef[i], 4)])), t: Object.fromEntries(['intercept', ...names].map((k, i) => [k, U.r(fit.t[i], 2)])),
      dev: { logloss: U.r(md.logloss), brier: U.r(md.brier), skill_pct: U.r(md.skill_pct, 2) },
      holdout: { logloss: U.r(mh.logloss), brier: U.r(mh.brier), skill_pct: U.r(mh.skill_pct, 2), auc: U.r(mh.auc) },
      holdout_delta_logloss_base_minus_var: (() => { const b = U.pairedBootstrap(dLL); return { mean: U.r(b.mean, 5), se: U.r(b.se, 5), t: U.r(b.t, 2), lo95: U.r(b.lo95, 5), hi95: U.r(b.hi95, 5) }; })(),
      holdout_delta_brier_base_minus_var: (() => { const b = U.pairedBootstrap(dBr); return { mean: U.r(b.mean, 5), se: U.r(b.se, 5), t: U.r(b.t, 2) }; })(),
    };
  };
  evalFit(NAMES, 'todos');
  for (const k of NAMES) evalFit([k], 'solo_' + k);
  evalFit(['days_log', 'layoff30', 'min_prev', 'prev_dist'], 'nucleo_4');
  evalFit(['days_log', 'n7'], 'minimo_days_n7');
  // EDAD (control, no es fatiga): el intercepto en orientación "id menor" sale muy negativo y en la numeración de
  // Sackmann el id menor es el jugador MÁS VETERANO → se prueba la diferencia de edad como término aparte
  const AGE = (f) => (f.age != null ? f.age : 26);
  const XA = (p, names) => [...X(p, names), (AGE(p.fX) - AGE(p.fY)) / 5, ((AGE(p.fX) - 27) ** 2 - (AGE(p.fY) - 27) ** 2) / 50];
  for (const [names, tag] of [[[], 'solo_edad'], [NAMES, 'todos_mas_edad'], [['days_log', 'n7'], 'days_n7_mas_edad']]) {
    const Xd = dev.map((p) => XA(p, names)), yd = dev.map((p) => p.y), od = dev.map((p) => U.lg(ens(p)));
    const fit = U.logisticFit(Xd, yd, od, { intercept: true, ridge: 1e-3 });
    const mh = U.metrics(ho.map((p) => ({ p: fit.predict(XA(p, names), U.lg(ens(p))), y: p.y })));
    const dLL = ho.map((p) => { const pb = U.clamp(ens(p), 1e-6, 1 - 1e-6), pv = U.clamp(fit.predict(XA(p, names), U.lg(ens(p))), 1e-6, 1 - 1e-6); const l = (q) => (p.y ? -Math.log(q) : -Math.log(1 - q)); return l(pb) - l(pv); });
    const b = U.pairedBootstrap(dLL);
    const labels = ['intercept', ...names, 'edad_dif_5a', 'edad_cuad_dif'];
    res.fits[tag] = { features: [...names, 'edad_dif_5a', 'edad_cuad_dif'], coef: Object.fromEntries(labels.map((k, i) => [k, U.r(fit.coef[i], 4)])), t: Object.fromEntries(labels.map((k, i) => [k, U.r(fit.t[i], 2)])), holdout: { logloss: U.r(mh.logloss), brier: U.r(mh.brier), skill_pct: U.r(mh.skill_pct, 2), auc: U.r(mh.auc) }, holdout_delta_logloss_base_minus_var: { mean: U.r(b.mean, 5), se: U.r(b.se, 5), t: U.r(b.t, 2), lo95: U.r(b.lo95, 5), hi95: U.r(b.hi95, 5) } };
  }
  // estabilidad dentro del desarrollo: ajustar 2018-2021, evaluar 2022-2024 (sin tocar el holdout)
  {
    const d1 = rows.filter((p) => p.date < 20220101), d2 = rows.filter((p) => p.date >= 20220101 && p.date < DEV_END);
    const fit = U.logisticFit(d1.map((p) => X(p, NAMES)), d1.map((p) => p.y), d1.map((p) => U.lg(ens(p))), { intercept: true, ridge: 1e-3 });
    const mb = U.metrics(d2.map((p) => ({ p: ens(p), y: p.y }))), mv = U.metrics(d2.map((p) => ({ p: fit.predict(X(p, NAMES), U.lg(ens(p))), y: p.y })));
    res.estabilidad_dev = { fit_hasta: 20211231, eval: '2022-2024', n: d2.length, base_logloss: U.r(mb.logloss), var_logloss: U.r(mv.logloss), base_skill: U.r(mb.skill_pct, 2), var_skill: U.r(mv.skill_pct, 2), coef_t: Object.fromEntries(['intercept', ...NAMES].map((k, i) => [k, U.r(fit.t[i], 2)])) };
  }
  // holdout por sub-ventana: espina Sackmann (fechas estimadas) vs cola ESPN (fechas reales, sin minutos)
  {
    const fit = U.logisticFit(dev.map((p) => X(p, NAMES)), dev.map((p) => p.y), dev.map((p) => U.lg(ens(p))), { intercept: true, ridge: 1e-3 });
    for (const [tag, sel] of [['holdout_espina_2025_a_20260525', (p) => p.date < 20260526], ['holdout_cola_espn_20260526_en_adelante', (p) => p.date >= 20260526]]) {
      const s = ho.filter(sel); if (!s.length) continue;
      const mb = U.metrics(s.map((p) => ({ p: ens(p), y: p.y }))), mv = U.metrics(s.map((p) => ({ p: fit.predict(X(p, NAMES), U.lg(ens(p))), y: p.y })));
      res[tag] = { n: s.length, base_logloss: U.r(mb.logloss), var_logloss: U.r(mv.logloss), base_skill: U.r(mb.skill_pct, 2), var_skill: U.r(mv.skill_pct, 2) };
    }
  }
  out[label] = res;
  console.log(`\n═══ H1 ${label.toUpperCase()} ═══ dev n=${res.n_dev} holdout n=${res.n_holdout}`);
  console.log(`base holdout: LL ${res.base_holdout.logloss.toFixed(4)} Brier ${res.base_holdout.brier.toFixed(4)} skill ${res.base_holdout.skill_pct.toFixed(2)}%`);
  for (const [k, f] of Object.entries(res.fits)) console.log(`${k.padEnd(16)} holdout LL ${f.holdout.logloss} Brier ${f.holdout.brier} skill ${f.holdout.skill_pct}% · ΔLL ${f.holdout_delta_logloss_base_minus_var.mean} (t ${f.holdout_delta_logloss_base_minus_var.t}) · t coef: ${JSON.stringify(f.t)}`);
  console.log('estabilidad dev:', JSON.stringify(res.estabilidad_dev));
}
fs.writeFileSync('/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis-skeptic/author-rerun/rerun-h1-out.json', JSON.stringify(out, null, 1));
