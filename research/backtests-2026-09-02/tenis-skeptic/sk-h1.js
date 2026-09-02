'use strict';
// ESCÉPTICO H1/H1b — descompone la mejora: ¿cuánto es el INTERCEPTO en orientación "id menor" (artefacto no
// simétrico) y cuánto son los rasgos? Un modelo simétrico con rasgos antisimétricos (X−Y) debe tener intercepto 0.
const fs = require('fs');
const U = require('./util.js');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/backtests/tenis';
const DEV_END = 20250101;
const out = {};
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(`${SRC}/preds-${label}.json`, 'utf8'));
  const u = P.cfg.u;
  const rows = P.preds.filter((p) => !p.ret);
  const ens = (p) => U.sig((1 - u) * U.lg(p.mix) + u * U.lg(p.comp.V0_prod));
  const f1 = (f, p) => { const days = f.hasPrev ? Math.min(Math.max(0, f.days), 60) : 30; return { days_log: Math.log1p(days), layoff30: f.hasPrev && f.days >= 30 ? 1 : 0, b2b: f.hasPrev && f.days <= 1 ? 1 : 0, min_prev: f.minLast != null ? (f.minLast - p.meanMin) / 60 : 0, n7: f.n7, prev_dist: f.dist, ret_prev: f.retLast }; };
  const AGE = (f) => (f.age != null ? f.age : 26);
  const FE = {
    days_log: (p) => f1(p.fX, p).days_log - f1(p.fY, p).days_log, layoff30: (p) => f1(p.fX, p).layoff30 - f1(p.fY, p).layoff30, b2b: (p) => f1(p.fX, p).b2b - f1(p.fY, p).b2b,
    min_prev: (p) => f1(p.fX, p).min_prev - f1(p.fY, p).min_prev, n7: (p) => p.fX.n7 - p.fY.n7, prev_dist: (p) => p.fX.dist - p.fY.dist, ret_prev: (p) => p.fX.retLast - p.fY.retLast,
    edad_dif_5a: (p) => (AGE(p.fX) - AGE(p.fY)) / 5, edad_cuad_dif: (p) => ((AGE(p.fX) - 27) ** 2 - (AGE(p.fY) - 27) ** 2) / 50,
  };
  const dev = rows.filter((p) => p.date < DEV_END), ho = rows.filter((p) => p.date >= DEV_END);
  const base = U.metrics(ho.map((p) => ({ p: ens(p), y: p.y })));
  const res = { n_dev: dev.length, n_holdout: ho.length, base_holdout: { logloss: U.r(base.logloss), skill_pct: U.r(base.skill_pct, 2) }, fits: {} };
  const ll = (q, y) => (y ? -Math.log(U.clamp(q, 1e-6, 1 - 1e-6)) : -Math.log(1 - U.clamp(q, 1e-6, 1 - 1e-6)));
  // ajuste genérico: names (puede ser []), intercept sí/no, conjunto de ajuste y de evaluación
  const fitEval = (names, intercept, fitSet, evalSet) => {
    const X = (p) => names.map((k) => FE[k](p));
    const fit = names.length || intercept ? U.logisticFit(fitSet.map((p) => (names.length ? X(p) : [0])), fitSet.map((p) => p.y), fitSet.map((p) => U.lg(ens(p))), { intercept, ridge: 1e-3 }) : null;
    const pred = (p) => (fit ? fit.predict(names.length ? X(p) : [0], U.lg(ens(p))) : ens(p));
    const m = U.metrics(evalSet.map((p) => ({ p: pred(p), y: p.y })));
    const d = evalSet.map((p) => ll(ens(p), p.y) - ll(pred(p), p.y));
    const b = U.pairedBootstrap(d, 2000);
    return { fit, pred, m, d, b, coef: fit ? Object.fromEntries([...(intercept ? ['intercept'] : []), ...names].map((k, i) => [k, U.r(fit.coef[i], 4)])) : {}, t_dev: fit ? Object.fromEntries([...(intercept ? ['intercept'] : []), ...names].map((k, i) => [k, U.r(fit.t[i], 2)])) : {} };
  };
  const rep = (r) => ({ skill_pct: U.r(r.m.skill_pct, 2), logloss: U.r(r.m.logloss), dLL_vs_base: U.r(r.b.mean, 5), se: U.r(r.b.se, 5), t: U.r(r.b.t, 2), lo95: U.r(r.b.lo95, 5), hi95: U.r(r.b.hi95, 5), coef: r.coef, t_dev: r.t_dev });
  // 1) SOLO INTERCEPTO (lo que el autor nunca midió)
  const io = fitEval([], true, dev, ho); res.fits.solo_intercepto = rep(io);
  // 2) cada rasgo CON intercepto (como el autor) y SIN intercepto (simétrico), más el incremento sobre solo-intercepto
  const sets = { days_log: ['days_log'], n7: ['n7'], min_prev: ['min_prev'], b2b: ['b2b'], ret_prev: ['ret_prev'], prev_dist: ['prev_dist'], layoff30: ['layoff30'], minimo_days_n7: ['days_log', 'n7'], todos7: ['days_log', 'layoff30', 'b2b', 'min_prev', 'n7', 'prev_dist', 'ret_prev'], solo_edad: ['edad_dif_5a', 'edad_cuad_dif'], solo_edad_lineal: ['edad_dif_5a'], days_n7_edad: ['days_log', 'n7', 'edad_dif_5a', 'edad_cuad_dif'], todos7_edad: ['days_log', 'layoff30', 'b2b', 'min_prev', 'n7', 'prev_dist', 'ret_prev', 'edad_dif_5a', 'edad_cuad_dif'] };
  for (const [tag, names] of Object.entries(sets)) {
    const wi = fitEval(names, true, dev, ho), no = fitEval(names, false, dev, ho);
    // incremento sobre solo-intercepto: Δ pareado (LL intercepto − LL variante con intercepto)
    const inc = U.pairedBootstrap(ho.map((p) => ll(io.pred(p), p.y) - ll(wi.pred(p), p.y)), 2000);
    res.fits[tag] = { con_intercepto: rep(wi), sin_intercepto: rep(no), incremento_sobre_solo_intercepto: { dLL: U.r(inc.mean, 5), se: U.r(inc.se, 5), t: U.r(inc.t, 2), lo95: U.r(inc.lo95, 5), hi95: U.r(inc.hi95, 5) } };
  }
  // 3) estabilidad temporal de la EDAD: ajuste 2018-21 → eval 2022-24 (dentro de dev), y holdout por año
  const d1 = rows.filter((p) => p.date < 20220101), d2 = rows.filter((p) => p.date >= 20220101 && p.date < DEV_END);
  res.estabilidad = {};
  for (const [tag, names] of [['solo_edad', sets.solo_edad], ['days_n7_edad', sets.days_n7_edad], ['minimo_days_n7', sets.minimo_days_n7], ['solo_intercepto', []]]) {
    const wf = fitEval(names, true, d1, d2), wfNo = names.length ? fitEval(names, false, d1, d2) : null;
    const full = fitEval(names, true, dev, ho), fullNo = names.length ? fitEval(names, false, dev, ho) : null;
    const byYear = {};
    for (const [yt, sel] of [['2025', (p) => p.date < 20260101], ['2026_espina', (p) => p.date >= 20260101 && p.date < 20260526], ['2026_cola_espn', (p) => p.date >= 20260526]]) {
      const s = ho.filter(sel); if (!s.length) continue;
      const m0 = U.metrics(s.map((p) => ({ p: ens(p), y: p.y }))), m1 = U.metrics(s.map((p) => ({ p: full.pred(p), y: p.y })));
      const bb = U.pairedBootstrap(s.map((p) => ll(ens(p), p.y) - ll(full.pred(p), p.y)), 1000);
      const o = { n: s.length, base_skill: U.r(m0.skill_pct, 2), var_skill_con_int: U.r(m1.skill_pct, 2), dLL_con_int: U.r(bb.mean, 5), t_con_int: U.r(bb.t, 2) };
      if (fullNo) { const m2 = U.metrics(s.map((p) => ({ p: fullNo.pred(p), y: p.y }))); const b2 = U.pairedBootstrap(s.map((p) => ll(ens(p), p.y) - ll(fullNo.pred(p), p.y)), 1000); o.var_skill_sin_int = U.r(m2.skill_pct, 2); o.dLL_sin_int = U.r(b2.mean, 5); o.t_sin_int = U.r(b2.t, 2); }
      byYear[yt] = o;
    }
    res.estabilidad[tag] = { walkforward_dev_fit2018_21_eval2022_24: { n: d2.length, con_int: { dLL: U.r(wf.b.mean, 5), t: U.r(wf.b.t, 2), coef: wf.coef, t_dev: wf.t_dev }, sin_int: wfNo ? { dLL: U.r(wfNo.b.mean, 5), t: U.r(wfNo.b.t, 2), coef: wfNo.coef } : null }, holdout_por_periodo: byYear };
  }
  // 4) coeficiente de edad estimado por AÑO de dev (¿estacionario?) — sin intercepto
  res.edad_por_anyo_dev = {};
  for (let y = 2018; y <= 2024; y++) { const s = dev.filter((p) => Math.floor(p.date / 10000) === y); const f = U.logisticFit(s.map((p) => [FE.edad_dif_5a(p)]), s.map((p) => p.y), s.map((p) => U.lg(ens(p))), { intercept: false, ridge: 1e-3 }); res.edad_por_anyo_dev[y] = { n: s.length, coef_edad_5a: U.r(f.coef[0], 4), t: U.r(f.t[0], 2) }; }
  for (const [yt, sel] of [['2025', (p) => p.date < 20260101], ['2026', (p) => p.date >= 20260101]]) { const s = ho.filter(sel); const f = U.logisticFit(s.map((p) => [FE.edad_dif_5a(p)]), s.map((p) => p.y), s.map((p) => U.lg(ens(p))), { intercept: false, ridge: 1e-3 }); res.edad_por_anyo_dev['holdout_' + yt] = { n: s.length, coef_edad_5a: U.r(f.coef[0], 4), t: U.r(f.t[0], 2) }; }
  // 5) days_log por ronda: ¿el efecto vive en la primera ronda (entrada al torneo) o también dentro del torneo?
  res.days_por_contexto = {};
  const fd = fitEval(['days_log', 'n7'], false, dev, ho);
  for (const [tag, sel] of [['primera_ronda_torneo', (p) => (p.lvl === 'G' && p.rd === 4) || (p.lvl !== 'G' && p.rd === (p.lvl === 'M' ? 4 : 6))], ['rondas_posteriores', (p) => !((p.lvl === 'G' && p.rd === 4) || (p.lvl !== 'G' && p.rd === (p.lvl === 'M' ? 4 : 6)))]]) {
    const s = ho.filter(sel); const m0 = U.metrics(s.map((p) => ({ p: ens(p), y: p.y }))), m1 = U.metrics(s.map((p) => ({ p: fd.pred(p), y: p.y }))); const bb = U.pairedBootstrap(s.map((p) => ll(ens(p), p.y) - ll(fd.pred(p), p.y)), 1000);
    res.days_por_contexto[tag] = { n: s.length, base_skill: U.r(m0.skill_pct, 2), var_skill: U.r(m1.skill_pct, 2), dLL: U.r(bb.mean, 5), t: U.r(bb.t, 2) };
  }
  // 6) ¿"días desde el último partido" = ausencia del circuito principal? distribución de days en holdout y prob. de ganar por tramo (residuo vs ensamble)
  const tramos = [[0, 3], [4, 9], [10, 20], [21, 45], [46, 60], [61, 9999]]; res.residuo_por_tramo_days = {};
  for (const [a, b] of tramos) { let n = 0, w = 0, e = 0; for (const p of ho) { for (const [f, isX] of [[p.fX, true], [p.fY, false]]) { if (!f.hasPrev) continue; const d = Math.max(0, f.days); if (d < a || d > b) continue; n++; const won = isX ? p.y : 1 - p.y; const pe = isX ? ens(p) : 1 - ens(p); w += won; e += pe; } } res.residuo_por_tramo_days[`${a}-${b}`] = { n, gana_real: U.r(w / n, 3), ens: U.r(e / n, 3), residuo_pp: U.r(100 * (w - e) / n, 1) }; }
  out[label] = res;
  console.log(`\n═══ SK-H1 ${label.toUpperCase()} ═══ holdout n=${res.n_holdout} base skill ${res.base_holdout.skill_pct}%`);
  console.log(`solo_intercepto: skill ${res.fits.solo_intercepto.skill_pct}% ΔLL ${res.fits.solo_intercepto.dLL_vs_base} t ${res.fits.solo_intercepto.t} coef ${JSON.stringify(res.fits.solo_intercepto.coef)}`);
  for (const [k, v] of Object.entries(res.fits)) { if (k === 'solo_intercepto') continue; console.log(`${k.padEnd(16)} con_int skill ${v.con_intercepto.skill_pct}% ΔLL ${v.con_intercepto.dLL_vs_base} (t ${v.con_intercepto.t}) · SIN int skill ${v.sin_intercepto.skill_pct}% ΔLL ${v.sin_intercepto.dLL_vs_base} (t ${v.sin_intercepto.t}) · incremento sobre solo-int ΔLL ${v.incremento_sobre_solo_intercepto.dLL} (t ${v.incremento_sobre_solo_intercepto.t}) · coef sin int ${JSON.stringify(v.sin_intercepto.coef)}`); }
  console.log('estabilidad:', JSON.stringify(res.estabilidad, null, 0));
  console.log('edad por año (sin int):', JSON.stringify(res.edad_por_anyo_dev));
  console.log('days por contexto:', JSON.stringify(res.days_por_contexto));
  console.log('residuo por tramo days:', JSON.stringify(res.residuo_por_tramo_days));
}
fs.writeFileSync(__dirname + '/sk-h1-out.json', JSON.stringify(out, null, 1));
