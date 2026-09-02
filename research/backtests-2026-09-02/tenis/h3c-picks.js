'use strict';
// H3(c) — libro de producción tennis_full2.json, familia TOTAL: split TEMPORAL 60/40 por created_at.
// Ajuste en el 60 % inicial de  P(gana) = σ(a + b·logit(p_impl) + c·[logit(p_model) − logit(p_impl)])
// y evaluación en el 40 % final: ROI a la cuota real disponible con la regla "apostar si p*·odds > 1",
// frente a la regla de producción (todas las picks, p_model tal cual) y frente a c fijo = 6 (in-sample previo).
const fs = require('fs');
const U = require('./util.js');
const RES = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/tennis_full2.json';
const book = JSON.parse(fs.readFileSync(RES, 'utf8'));
const all = book.recent.filter((p) => p.family === 'TOTAL' && /WIN|LOSS/.test(p.result) && p.p_model > 0 && p.p_implied > 0).sort((a, b) => a.created_at.localeCompare(b.created_at));
const y = (p) => (p.result === 'WIN' ? 1 : 0);
const out = { n: all.length, first: all[0].created_at, last: all[all.length - 1].created_at };
const roi = (rows, stakeFn) => { let st = 0, pnl = 0, w = 0, n = 0; const pl = []; for (const p of rows) { const s = stakeFn(p); if (!(s > 0)) continue; n++; st += s; const g = y(p) ? s * (p.odds - 1) : -s; pnl += g; pl.push(g / s); if (y(p)) w++; } const ms = pl.length > 1 ? U.meanSe(pl) : { se: null, t: null }; return { n, hit_pct: n ? U.r(100 * w / n, 1) : null, roi_pct: st ? U.r(100 * pnl / st, 1) : null, se_pct: ms.se != null ? U.r(100 * ms.se, 1) : null, t: ms.t != null ? U.r(ms.t, 2) : null, units: U.r(pnl, 2) }; };
// referencia: toda la muestra (in-sample, lo que ya se midió) y CLV disponible
out.full_sample_flat = roi(all, () => 1);
const clv = all.filter((p) => p.clv_pct != null).map((p) => p.clv_pct);
out.full_sample_clv = clv.length ? { n: clv.length, ...U.meanSe(clv) } : { n: 0 };
// c ajustado en TODA la muestra (in-sample, referencia)
const fitC = (rows) => { const X = rows.map((p) => [U.lg(p.p_implied), U.lg(p.p_model) - U.lg(p.p_implied)]); const f = U.logisticFit(X, rows.map(y), null, { intercept: true, ridge: 1e-3 }); return { n: rows.length, a: U.r(f.coef[0], 3), b_mkt: U.r(f.coef[1], 3), c_model: U.r(f.coef[2], 3), se_c: U.r(f.se[2], 3), t_c: U.r(f.t[2], 2), f }; };
const full = fitC(all); out.fit_full_insample = { n: full.n, a: full.a, b_mkt: full.b_mkt, c_model: full.c_model, se_c: full.se_c, t_c: full.t_c };
// split temporal 60/40
const cut = Math.floor(all.length * 0.6); const dev = all.slice(0, cut), ev = all.slice(cut);
out.split = { dev_n: dev.length, dev_until: dev[dev.length - 1].created_at, eval_n: ev.length, eval_from: ev[0].created_at };
const fd = fitC(dev); out.fit_dev = { n: fd.n, a: fd.a, b_mkt: fd.b_mkt, c_model: fd.c_model, se_c: fd.se_c, t_c: fd.t_c };
const pStar = (f, p) => f.predict([U.lg(p.p_implied), U.lg(p.p_model) - U.lg(p.p_implied)]);
out.eval = {
  regla_produccion_todas: roi(ev, () => 1),
  regla_produccion_dev: roi(dev, () => 1),
  pstar_dev_fit_bet_if_pstar_x_odds_gt_1: roi(ev, (p) => (pStar(fd.f, p) * p.odds > 1 ? 1 : 0)),
  pstar_dev_fit_kelly_quarter: roi(ev, (p) => { const q = pStar(fd.f, p); const b = p.odds - 1; const k = (q * b - (1 - q)) / b; return k > 0 ? Math.min(0.02, k / 4) : 0; }),
  c6_fixed_bet_if_pstar_x_odds_gt_1: roi(ev, (p) => { const q = U.sig(U.lg(p.p_implied) + 6 * (U.lg(p.p_model) - U.lg(p.p_implied))); return q * p.odds > 1 ? 1 : 0; }),
  c1_raw_model_bet_if_pmodel_x_odds_gt_1: roi(ev, (p) => (p.p_model * p.odds > 1 ? 1 : 0)),
};
// Brier en evaluación: modelo crudo vs p* vs implícita
const brier = (rows, fn) => U.r(rows.reduce((s, p) => s + (fn(p) - y(p)) ** 2, 0) / rows.length, 4);
out.eval_brier = { n: ev.length, p_model: brier(ev, (p) => p.p_model), p_implied: brier(ev, (p) => p.p_implied), p_star_dev_fit: brier(ev, (p) => pStar(fd.f, p)) };
// cortes descriptivos (toda la muestra): lado, circuito, formato, ventaja
const cut2 = (name, fn) => { const G = {}; for (const p of all) { const k = fn(p); (G[k] = G[k] || []).push(p); } out['corte_' + name] = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, roi(v, () => 1)])); };
cut2('lado', (p) => p.side); cut2('circuito', (p) => (p.tour === 0 ? 'ATP' : 'WTA')); cut2('formato', (p) => 'bo' + p.best_of); cut2('ventaja', (p) => (p.edge_pp >= 8 ? '>=8pp' : p.edge_pp >= 5 ? '5-8pp' : '3-5pp'));
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(__dirname + '/h3c-out.json', JSON.stringify(out, null, 1));
