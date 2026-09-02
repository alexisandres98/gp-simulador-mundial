'use strict';
// H4 — RETIROS. (1) fracción de retiros por circuito/superficie/ronda/formato/nivel en la base;
// (2) riesgo de retiro por jugador (edad, ranking, historial de retiros, fatiga) → ¿predice el retiro fuera de muestra?
//     modelo a nivel PARTIDO: P(el partido acaba en RET) con rasgos sumados de ambos jugadores, ajustado en dev, evaluado en holdout
//     modelo a nivel JUGADOR: P(este jugador se retira) → en los partidos con retiro del holdout, ¿acierta quién?
// (3) ¿aporta el riesgo (X−Y) al logit del ensamble en partidos completos (ML)?
const fs = require('fs');
const U = require('./util.js');
const DEV_END = 20250101;
const out = {};
const rate = (arr) => ({ n: arr.length, ret_pct: U.r(100 * arr.filter((p) => p.ret).length / arr.length, 2) });
for (const label of ['atp', 'wta']) {
  const P = JSON.parse(fs.readFileSync(__dirname + `/preds-${label}.json`, 'utf8'));
  const u = P.cfg.u;
  const all = P.preds; // incluye retiros
  const res = { n_total: all.length, n_ret: all.filter((p) => p.ret).length, ret_pct: U.r(100 * all.filter((p) => p.ret).length / all.length, 2) };
  const by = (fn) => { const G = {}; for (const p of all) { const k = fn(p); (G[k] = G[k] || []).push(p); } return Object.fromEntries(Object.entries(G).map(([k, v]) => [k, rate(v)])); };
  res.por_superficie = by((p) => ['dura', 'arcilla', 'hierba', 'moqueta'][p.surf] || 'desconocida');
  res.por_formato = by((p) => 'bo' + p.bo);
  res.por_nivel = by((p) => p.lvl);
  res.por_ronda = by((p) => ({ 4: 'R128', 5: 'R64', 6: 'R32', 7: 'R16', 8: 'QF', 9: 'SF', 10: 'F' })[p.rd] || p.rd);
  res.por_mes = by((p) => String(Math.floor(p.date / 100) % 100).padStart(2, '0'));
  res.juegos_medios = { completos: U.r(all.filter((p) => !p.ret).reduce((s, p) => s + p.actGames, 0) / all.filter((p) => !p.ret).length, 2), con_retiro: U.r(all.filter((p) => p.ret).reduce((s, p) => s + p.actGames, 0) / Math.max(1, all.filter((p) => p.ret).length), 2) };
  // rasgos de riesgo por jugador
  const pf = (f, p) => ({
    edad: f.age != null ? f.age - 27 : 0, edad_mayor30: f.age != null && f.age >= 30 ? 1 : 0,
    log_rank: Math.log(f.rank || 150) - Math.log(50),
    ret365: f.ret365, ret_prev: f.retLast,
    tasa_ret_carrera: (f.nRet + 0.03 * 20) / (f.nM + 20) * 100 - 3,
    days_log: Math.log1p(f.hasPrev ? Math.min(Math.max(0, f.days), 60) : 30) - Math.log1p(7), layoff30: f.hasPrev && f.days >= 30 ? 1 : 0,
    min_prev: f.minLast != null ? (f.minLast - p.meanMin) / 60 : 0, n7: f.n7,
  });
  const PN = Object.keys(pf(all[0].fX, all[0]));
  // 'slam' se quita: en la ATP es idéntico a bo5 (colinealidad perfecta) y en la WTA bo5 es siempre 0
  const MN = ['bo5_o_slam', 'arcilla', 'hierba', 'ronda_temprana'];
  const mf = (p) => [p.bo === 5 || p.lvl === 'G' ? 1 : 0, p.surf === 1 ? 1 : 0, p.surf === 2 ? 1 : 0, p.rd <= 5 ? 1 : 0];
  // nivel partido: suma de rasgos de ambos + rasgos del partido
  const Xm = (p) => { const a = pf(p.fX, p), b = pf(p.fY, p); return [...PN.map((k) => a[k] + b[k]), ...mf(p)]; };
  const dev = all.filter((p) => p.date < DEV_END), ho = all.filter((p) => p.date >= DEV_END);
  const fitM = U.logisticFit(dev.map(Xm), dev.map((p) => p.ret), null, { intercept: true, ridge: 1e-3 });
  const baseRate = dev.filter((p) => p.ret).length / dev.length;
  const ph = ho.map((p) => ({ p: fitM.predict(Xm(p)), y: p.ret }));
  const mv = U.metrics(ph), mb = U.metrics(ho.map((p) => ({ p: baseRate, y: p.ret })));
  // lift por deciles en holdout
  const sorted = [...ph].sort((a, b) => a.p - b.p); const dec = []; for (let d = 0; d < 10; d++) { const sl = sorted.slice(Math.floor(d * sorted.length / 10), Math.floor((d + 1) * sorted.length / 10)); dec.push({ decil: d + 1, n: sl.length, p_media_pct: U.r(100 * sl.reduce((s, x) => s + x.p, 0) / sl.length, 2), ret_real_pct: U.r(100 * sl.filter((x) => x.y).length / sl.length, 2) }); }
  const dLL = ho.map((p, i) => { const l = (q) => (p.ret ? -Math.log(q) : -Math.log(1 - q)); return l(baseRate) - l(U.clamp(ph[i].p, 1e-6, 1 - 1e-6)); });
  const bb = U.pairedBootstrap(dLL, 1000);
  res.modelo_retiro_partido = {
    n_dev: dev.length, n_holdout: ho.length, tasa_base_dev_pct: U.r(100 * baseRate, 2), tasa_holdout_pct: U.r(100 * ho.filter((p) => p.ret).length / ho.length, 2),
    coef_t: Object.fromEntries(['intercept', ...PN.map((k) => 'suma_' + k), ...MN].map((k, i) => [k, U.r(fitM.t[i], 2)])),
    coef: Object.fromEntries(['intercept', ...PN.map((k) => 'suma_' + k), ...MN].map((k, i) => [k, U.r(fitM.coef[i], 4)])),
    holdout: { auc: U.r(mv.auc), logloss: U.r(mv.logloss), brier: U.r(mv.brier, 5), logloss_base_rate: U.r(mb.logloss), brier_base_rate: U.r(mb.brier, 5), delta_logloss_base_minus_modelo: { mean: U.r(bb.mean, 5), t: U.r(bb.t, 2) } },
    deciles_holdout: dec,
  };
  // nivel jugador: y = 1 si ESTE jugador se retiró (el que se retira es el perdedor con ret=1)
  const rowsPl = []; for (const p of dev) { for (const [f, retired] of [[p.fX, p.ret && p.y === 0], [p.fY, p.ret && p.y === 1]]) rowsPl.push({ x: [...PN.map((k) => pf(f, p)[k]), ...mf(p)], y: retired ? 1 : 0 }); }
  const fitP = U.logisticFit(rowsPl.map((r) => r.x), rowsPl.map((r) => r.y), null, { intercept: true, ridge: 1e-3 });
  const riskOf = (f, p) => fitP.predict([...PN.map((k) => pf(f, p)[k]), ...mf(p)]);
  const hoRet = ho.filter((p) => p.ret);
  let hitRisk = 0, hitElo = 0, hitRank = 0, nR = 0;
  for (const p of hoRet) { const rx = riskOf(p.fX, p), ry = riskOf(p.fY, p); const retX = p.y === 0; if (rx !== ry) { nR++; if ((rx > ry) === retX) hitRisk++; } if ((p.mix < 0.5) === retX) hitElo++; const rkX = p.fX.rank || 999, rkY = p.fY.rank || 999; if ((rkX > rkY) === retX) hitRank++; }
  res.quien_se_retira_holdout = { n_ret: hoRet.length, acierto_riesgo_pct: U.r(100 * hitRisk / Math.max(1, nR), 1), acierto_elo_underdog_pct: U.r(100 * hitElo / hoRet.length, 1), acierto_peor_ranking_pct: U.r(100 * hitRank / hoRet.length, 1), coef_t_jugador: Object.fromEntries(['intercept', ...PN, ...MN].map((k, i) => [k, U.r(fitP.t[i], 2)])) };
  // (3) riesgo en el ML de partidos completos: z = logit(ens) + γ·(logit riskX − logit riskY)
  const comp = all.filter((p) => !p.ret); const cd = comp.filter((p) => p.date < DEV_END), ch = comp.filter((p) => p.date >= DEV_END);
  const ens = (p) => U.sig((1 - u) * U.lg(p.mix) + u * U.lg(p.comp.V0_prod));
  const xr = (p) => [U.lg(riskOf(p.fX, p)) - U.lg(riskOf(p.fY, p))];
  const fitR = U.logisticFit(cd.map(xr), cd.map((p) => p.y), cd.map((p) => U.lg(ens(p))), { intercept: true, ridge: 1e-3 });
  const m0 = U.metrics(ch.map((p) => ({ p: ens(p), y: p.y }))), m1 = U.metrics(ch.map((p) => ({ p: fitR.predict(xr(p), U.lg(ens(p))), y: p.y })));
  const dl = ch.map((p) => { const l = (q) => (p.y ? -Math.log(q) : -Math.log(1 - q)); return l(U.clamp(ens(p), 1e-6, 1 - 1e-6)) - l(U.clamp(fitR.predict(xr(p), U.lg(ens(p))), 1e-6, 1 - 1e-6)); });
  const br = U.pairedBootstrap(dl, 1000);
  res.riesgo_en_ML_completos = { n_dev: cd.length, n_holdout: ch.length, gamma: U.r(fitR.coef[1], 4), t_gamma_dev: U.r(fitR.t[1], 2), holdout_base: { logloss: U.r(m0.logloss), skill_pct: U.r(m0.skill_pct, 2) }, holdout_var: { logloss: U.r(m1.logloss), skill_pct: U.r(m1.skill_pct, 2) }, delta_logloss: { mean: U.r(br.mean, 5), t: U.r(br.t, 2) } };
  out[label] = res;
  console.log(`\n═══ H4 ${label.toUpperCase()} ═══ n=${res.n_total} retiros ${res.n_ret} (${res.ret_pct}%)`);
  console.log('superficie', JSON.stringify(res.por_superficie), '\nformato', JSON.stringify(res.por_formato), '\nnivel', JSON.stringify(res.por_nivel), '\nronda', JSON.stringify(res.por_ronda));
  console.log('modelo partido holdout:', JSON.stringify(res.modelo_retiro_partido.holdout), '\ndeciles:', JSON.stringify(res.modelo_retiro_partido.deciles_holdout.map((d) => d.ret_real_pct)), '\nt coef:', JSON.stringify(res.modelo_retiro_partido.coef_t));
  console.log('quién se retira:', JSON.stringify(res.quien_se_retira_holdout));
  console.log('riesgo en ML:', JSON.stringify(res.riesgo_en_ML_completos));
}
fs.writeFileSync(__dirname + '/h4-out.json', JSON.stringify(out, null, 1));
