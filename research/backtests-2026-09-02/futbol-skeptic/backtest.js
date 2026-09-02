// backtest.js — FÚTBOL CLUBES (SOLID / GOALS / CORNERS). Split temporal por created_at:
// ajustar en el primer X % (X=60 y X=50), evaluar en el resto. Sin mirar el futuro.
// Uso: node backtest.js [--split 0.6]   → escribe results-<split>.json en este dir e imprime resumen.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/clubs_picks_full.json';
const OUT = __dirname;
const args = process.argv.slice(2);
const SPLIT = Number((args[args.indexOf('--split') + 1]) || 0.6);

const all = JSON.parse(fs.readFileSync(SRC, 'utf8')).picks;
const decided = all.filter(p => p.result_code === 'WIN' || p.result_code === 'LOSS');
const byT = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);

// ───────────────────────── utilidades ─────────────────────────
const logit = p => Math.log(p / (1 - p));
const sig = x => 1 / (1 + Math.exp(-x));
const clampP = p => Math.min(0.999, Math.max(0.001, p));
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const r4 = x => (x == null || !isFinite(x)) ? null : +x.toFixed(4);
const r2 = x => (x == null || !isFinite(x)) ? null : +x.toFixed(2);
const win = p => p.result_code === 'WIN' ? 1 : 0;
const pnlAt = (p, odds) => win(p) ? odds - 1 : -1;
// PRNG determinista para bootstrap
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function boot(arr, stat, B = 2000) {
  if (!arr.length) return null;
  const vals = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < arr.length; i++) s.push(arr[Math.floor(rnd() * arr.length)]); vals.push(stat(s)); }
  vals.sort((a, b) => a - b);
  return { lo95: r4(vals[Math.floor(0.025 * B)]), hi95: r4(vals[Math.floor(0.975 * B)]) };
}
function corr(x, y) { const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); }

// Métricas de una cartera de picks (stake plano 1u a best_odds; también a cuota de cierre).
function metrics(picks, probFn) {
  const n = picks.length;
  if (!n) return { n: 0 };
  const pnl = picks.map(p => pnlAt(p, p.best_odds));
  const wc = picks.filter(p => p.closing && p.closing.odds > 1);
  const pnlC = wc.map(p => pnlAt(p, p.closing.odds));
  const clv = picks.filter(p => typeof p.clv === 'number').map(p => p.clv);
  const clvEv = picks.filter(p => typeof p.clv_ev_pp === 'number').map(p => p.clv_ev_pp);
  const roi = mean(pnl), se = sd(pnl) / Math.sqrt(n);
  const out = {
    n, hit: r4(mean(picks.map(win))), roi: r4(roi), roi_se: r4(se), roi_t: r4(roi / se),
    roi_ci95: boot(pnl, mean), pnl_u: r2(pnl.reduce((s, x) => s + x, 0)),
    roi_close: r4(mean(pnlC)), n_close: wc.length,
    clv_avg_pct: r4(mean(clv)), clv_t: r4(mean(clv) / (sd(clv) / Math.sqrt(clv.length))),
    clv_ev_pp_avg: r4(mean(clvEv)),
    odds_avg: r4(mean(picks.map(p => p.best_odds))),
  };
  if (probFn) {
    const bm = mean(picks.map(p => (probFn(p) - win(p)) ** 2));
    const bk = mean(picks.map(p => (p.market_prob - win(p)) ** 2));
    const bc = mean(picks.filter(p => p.closing && p.closing.fair_prob).map(p => (p.closing.fair_prob - win(p)) ** 2));
    out.brier_variant = r4(bm); out.brier_market = r4(bk); out.brier_close = r4(bc);
    out.p_avg_variant = r4(mean(picks.map(probFn))); out.p_avg_market = r4(mean(picks.map(p => p.market_prob)));
  }
  return out;
}

// Regresión logística por Newton (pocos parámetros). X: filas de features (sin intercepto implícito), y: 0/1.
function logisticFit(X, y, { iters = 60, ridge = 1e-6 } = {}) {
  const k = X[0].length; let w = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      let z = 0; for (let j = 0; j < k; j++) z += w[j] * X[i][j];
      const p = sig(z), r = p - y[i];
      for (let j = 0; j < k; j++) { g[j] += r * X[i][j]; for (let l = 0; l < k; l++) H[j][l] += p * (1 - p) * X[i][j] * X[i][l]; }
    }
    for (let j = 0; j < k; j++) { g[j] += ridge * w[j]; H[j][j] += ridge; }
    const step = solve(H, g); let mx = 0;
    for (let j = 0; j < k; j++) { w[j] -= step[j]; mx = Math.max(mx, Math.abs(step[j])); }
    if (mx < 1e-9) break;
  }
  // errores estándar ≈ sqrt(diag(H^-1))
  const H = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < X.length; i++) { let z = 0; for (let j = 0; j < k; j++) z += w[j] * X[i][j]; const p = sig(z); for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) H[j][l] += p * (1 - p) * X[i][j] * X[i][l]; }
  const se = []; for (let j = 0; j < k; j++) { const e = new Array(k).fill(0); e[j] = 1; se.push(Math.sqrt(solve(H.map(r => r.slice()), e)[j])); }
  return { w, se };
}
function solve(A, b) { // Gauss con pivoteo
  const n = b.length; A = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / d; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((r, i) => r[n] / (r[i] || 1e-12));
}
// Ajuste 1-parámetro: p* = σ(logit(pk) + c·Δ), Δ = logit(pm) − logit(pk). Offset fijo → maximizar LL en c (grid + refinamiento).
function fitC(picks, { intercept = false } = {}) {
  const rows = picks.map(p => ({ y: win(p), lk: logit(clampP(p.market_prob)), d: logit(clampP(p.model_prob)) - logit(clampP(p.market_prob)) }));
  const ll = (c, a = 0) => rows.reduce((s, r) => { const q = clampP(sig(a + r.lk + c * r.d)); return s + (r.y ? Math.log(q) : Math.log(1 - q)); }, 0);
  if (!intercept) {
    let best = { c: 0, ll: -Infinity };
    for (let c = -2; c <= 2.0001; c += 0.01) { const v = ll(c); if (v > best.ll) best = { c: +c.toFixed(2), ll: v }; }
    // SE aprox por curvatura numérica
    const h = 0.05, curv = (ll(best.c + h) - 2 * ll(best.c) + ll(best.c - h)) / (h * h);
    return { c: best.c, se: r4(Math.sqrt(-1 / curv)), ll: r4(best.ll), ll0: r4(ll(0)), ll1: r4(ll(1)), n: rows.length };
  }
  let best = { c: 0, a: 0, ll: -Infinity };
  for (let a = -1; a <= 1.0001; a += 0.02) for (let c = -2; c <= 2.0001; c += 0.02) { const v = ll(c, a); if (v > best.ll) best = { c: +c.toFixed(2), a: +a.toFixed(2), ll: v }; }
  return { c: best.c, a: best.a, ll: r4(best.ll), ll0: r4(ll(0)), n: rows.length };
}
const pStar = (p, c, a = 0) => clampP(sig(a + logit(clampP(p.market_prob)) + c * (logit(clampP(p.model_prob)) - logit(clampP(p.market_prob)))));

function split(picks, frac) {
  const s = picks.slice().sort(byT); const k = Math.floor(s.length * frac);
  return { fit: s.slice(0, k), ev: s.slice(k), cut_at: s[k] ? s[k].created_at : null };
}

const RES = { split: SPLIT, generated_at: new Date().toISOString(), families: {} };

// ═══════════════════════════ SOLID ═══════════════════════════
(function SOLID() {
  const S = decided.filter(p => p.family === 'SOLID' && p.model_prob > 0 && p.market_prob > 0);
  const { fit, ev, cut_at } = split(S, SPLIT);
  const R = { n_total: S.length, n_fit: fit.length, n_eval: ev.length, cut_at };
  R.base_all = metrics(S, p => p.model_prob);
  R.base_fit = metrics(fit, p => p.model_prob);
  R.base_eval = metrics(ev, p => p.model_prob);
  // blend actual de producción (0.5/0.5 lineal) como referencia de calibración
  R.base_eval.brier_blend50 = r4(mean(ev.map(p => (0.5 * p.model_prob + 0.5 * p.market_prob - win(p)) ** 2)));

  // ── H1: blend logit con c ajustado en fit ──
  const cfit = fitC(fit);
  const cfitA = fitC(fit, { intercept: true });
  // regresión con intercepto + pendiente libre para el mercado (diagnóstico)
  const lr = logisticFit(fit.map(p => [1, logit(clampP(p.market_prob)), logit(clampP(p.model_prob)) - logit(clampP(p.market_prob))]), fit.map(win));
  R.H1 = { c_fit: cfit, c_fit_con_intercepto: cfitA, regresion_libre_fit: { a: r4(lr.w[0]), b_mkt: r4(lr.w[1]), c_delta: r4(lr.w[2]), se: lr.se.map(r4) }, eval: {} };
  const ceval_check = fitC(ev); R.H1.c_refit_en_eval_solo_diagnostico = ceval_check;
  for (const c of [cfit.c, 0, 1]) {
    for (const th of [0, 0.02, 0.04]) {
      const sel = ev.filter(p => pStar(p, c) * p.best_odds - 1 > th);
      R.H1.eval[`c=${c}|theta=${th}`] = metrics(sel, p => pStar(p, c));
    }
  }
  // Brier out-of-sample del p* con c_fit vs mercado vs modelo crudo (todas las picks de eval)
  R.H1.eval_brier_all = { brier_pstar: r4(mean(ev.map(p => (pStar(p, cfit.c) - win(p)) ** 2))), brier_market: R.base_eval.brier_market, brier_model: R.base_eval.brier_variant, brier_close: R.base_eval.brier_close, n: ev.length };

  // ── H2: filtros declarados en fit, evaluados en eval ──
  const CUP = /Cup|Copa|Pokal|Champions|Europa|Libertadores|Sudamericana|Leagues Cup|Supercopa/i;
  const firstKO = {}; for (const p of all) { const t = Date.parse(p.event.kickoff_at); if (!firstKO[p.league] || t < firstKO[p.league]) firstKO[p.league] = t; }
  const seasonStart = lg => (firstKO[lg] >= Date.parse('2026-08-01') ? firstKO[lg] : null); // ligas que arrancan en el libro (europeas 26/27); resto: desconocido
  const inFirst2w = p => { const s = seasonStart(p.league); return s != null && Date.parse(p.event.kickoff_at) < s + 14 * 86400e3; };
  const FILTERS = {
    odds_le_2_5: p => p.best_odds <= 2.5,
    odds_le_3_2: p => p.best_odds <= 3.2,
    books_ge_10: p => (p.books || 0) >= 10,
    sin_copas: p => !CUP.test(p.competition_name || ''),
    sin_2_primeras_semanas: p => !inFirst2w(p),
    regime_anchor: p => p.regime === 'anchor',
    regime_lead: p => p.regime === 'lead',
    sel_home: p => p.selection_code === 'home',
    sel_away: p => p.selection_code === 'away',
    gate_approved: p => p.gate_status === 'approved',
    discrep_lt_10pp: p => (p.model_prob - p.market_prob) < 0.10,
    discrep_ge_10pp: p => (p.model_prob - p.market_prob) >= 0.10,
    market_fav_ge_50: p => p.market_prob >= 0.5,
    combo_odds2_5_books10_sincopas: p => p.best_odds <= 2.5 && (p.books || 0) >= 10 && !CUP.test(p.competition_name || ''),
  };
  R.H2 = { season_start_inferido: Object.fromEntries(Object.keys(firstKO).filter(l => seasonStart(l)).map(l => [l, new Date(seasonStart(l)).toISOString().slice(0, 10)])), filtros: {} };
  R.H2.n_first2w_total = S.filter(inFirst2w).length; R.H2.n_cups_total = S.filter(p => CUP.test(p.competition_name || '')).length;
  for (const [k, f] of Object.entries(FILTERS)) {
    const mf = metrics(fit.filter(f), p => p.model_prob), me = metrics(ev.filter(f), p => p.model_prob);
    const declared = mf.n >= 25 && mf.roi > R.base_fit.roi; // regla de declaración: mejora el ROI del tramo de ajuste con n≥25
    R.H2.filtros[k] = { fit: mf, declarado_en_fit: declared, eval: me, eval_delta_roi_vs_base: r4((me.roi || 0) - R.base_eval.roi) };
  }

  // ── H3: señal inversa. Eval: discrepancia ≥10pp → apostar el lado contrario ("no gana el lado del modelo") a precio justo 1/(1−k) menos margen.
  const H3 = { nota: 'El libro solo guarda la prob del lado elegido; el lado contrario se valora a su precio JUSTO 1/(1−market_prob) menos un margen supuesto (0/3/5 %). Es una medida de información contraria, no una regla.' };
  for (const [tag, set] of [['eval', ev], ['fit', fit], ['all', S]]) {
    const d10 = set.filter(p => (p.model_prob - p.market_prob) >= 0.10);
    const rows = { n: d10.length, lado_modelo: metrics(d10, p => p.model_prob) };
    for (const mg of [0, 0.03, 0.05]) {
      const pnl = d10.map(p => { const o = (1 / (1 - p.market_prob)) * (1 - mg); return win(p) ? -1 : o - 1; });
      const pnlC = d10.filter(p => p.closing && p.closing.fair_prob).map(p => { const o = (1 / (1 - p.closing.fair_prob)) * (1 - mg); return win(p) ? -1 : o - 1; });
      rows[`lado_mercado_margen_${mg}`] = { roi: r4(mean(pnl)), roi_se: r4(sd(pnl) / Math.sqrt(pnl.length)), roi_ci95: boot(pnl, mean), roi_a_cierre: r4(mean(pnlC)) };
    }
    // calibración por bucket de discrepancia
    const B = {};
    for (const p of set) { const d = (p.model_prob - p.market_prob) * 100; const k = d < 0 ? '<0' : d < 5 ? '0-5' : d < 10 ? '5-10' : d < 20 ? '10-20' : '>=20'; (B[k] = B[k] || []).push(p); }
    rows.calibracion_por_discrepancia = Object.fromEntries(Object.entries(B).map(([k, a]) => [k, { n: a.length, p_modelo: r4(mean(a.map(p => p.model_prob))), p_mercado: r4(mean(a.map(p => p.market_prob))), p_cierre: r4(mean(a.map(p => p.closing ? p.closing.fair_prob : p.market_prob))), observado: r4(mean(a.map(win))), roi: r4(mean(a.map(p => pnlAt(p, p.best_odds)))) }]));
    H3[tag] = rows;
  }
  R.H3 = H3;
  RES.families.SOLID = R;
})();

// ═══════════════════════════ GOALS (+COMBO) ═══════════════════════════
// Aproximación declarada: el total de goles se trata como Poisson(Λ) (la corrección Dixon-Coles mueve <1pp la
// cola O/U 2.5). Λ se invierte desde model_prob(over, línea); escala Λ' = k·Λ → nueva prob over.
function poisCdf(lam, k) { let s = 0, t = Math.exp(-lam); for (let i = 0; i <= k; i++) { s += t; t *= lam / (i + 1); } return s; }
const pOverPois = (lam, line) => 1 - poisCdf(lam, Math.floor(line));
function invertLambda(pOver, line) { let lo = 0.05, hi = 12; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (pOverPois(m, line) < pOver) lo = m; else hi = m; } return (lo + hi) / 2; }
(function GOALS() {
  const G = decided.filter(p => p.family === 'GOALS' && p.model_prob > 0 && p.market_prob > 0 && p.line != null);
  const { fit, ev, cut_at } = split(G, SPLIT);
  const R = { n_total: G.length, n_fit: fit.length, n_eval: ev.length, cut_at };
  R.base_all = metrics(G, p => p.model_prob); R.base_fit = metrics(fit, p => p.model_prob); R.base_eval = metrics(ev, p => p.model_prob);
  const pOverM = p => p.side === 'over' ? p.model_prob : 1 - p.model_prob;
  const pOverK = p => p.side === 'over' ? p.market_prob : 1 - p.market_prob;
  const yOver = p => (p.side === 'over') === (p.result_code === 'WIN') ? 1 : 0;
  const calib = set => ({ n: set.length, p_over_modelo: r4(mean(set.map(pOverM))), p_over_mercado: r4(mean(set.map(pOverK))), over_observado: r4(mean(set.map(yOver))), brier_over_modelo: r4(mean(set.map(p => (pOverM(p) - yOver(p)) ** 2))), brier_over_mercado: r4(mean(set.map(p => (pOverK(p) - yOver(p)) ** 2))) });
  R.H4 = { calibracion_over: { all: calib(G), fit: calib(fit), eval: calib(ev), por_linea_all: {}, por_lado_all: {}, por_regime_all: {} } };
  for (const [k, f] of [['2.5', p => p.line === 2.5], ['3.5', p => p.line === 3.5], ['1.5', p => p.line === 1.5]]) R.H4.calibracion_over.por_linea_all[k] = calib(G.filter(f));
  for (const s of ['over', 'under']) R.H4.calibracion_over.por_lado_all[s] = Object.assign(calib(G.filter(p => p.side === s)), { roi: r4(mean(G.filter(p => p.side === s).map(p => pnlAt(p, p.best_odds)))) });
  for (const rg of ['anchor', 'monitor', 'edge', 'undefined']) { const a = G.filter(p => String(p.regime) === rg); if (a.length) R.H4.calibracion_over.por_regime_all[rg] = Object.assign(calib(a), { roi: r4(mean(a.map(p => pnlAt(p, p.best_odds)))) }); }
  // escala k ajustada en fit (log-loss del over), evaluada en eval
  const lam = p => invertLambda(clampP(pOverM(p)), p.line);
  const pOverScaled = (p, k) => clampP(pOverPois(k * lam(p), p.line));
  const ll = (set, k) => -mean(set.map(p => { const q = pOverScaled(p, k); return yOver(p) ? Math.log(q) : Math.log(1 - q); }));
  let best = { k: 1, ll: Infinity }; for (let k = 0.6; k <= 1.4001; k += 0.01) { const v = ll(fit, k); if (v < best.ll) best = { k: +k.toFixed(2), ll: v }; }
  const kfit = best.k;
  const pSideScaled = (p, k) => p.side === 'over' ? pOverScaled(p, k) : 1 - pOverScaled(p, k);
  const evalK = (k) => {
    const bets = ev.filter(p => pSideScaled(p, k) * p.best_odds - 1 > 0);
    return { k, logloss_over_eval: r4(ll(ev, k)), brier_over_eval: r4(mean(ev.map(p => (pOverScaled(p, k) - yOver(p)) ** 2))), lambda_medio_eval: r4(mean(ev.map(p => k * lam(p)))), apuestas_EV_positivo: metrics(bets, p => pSideScaled(p, k)) };
  };
  R.H4.escala_lambda = { k_fit: kfit, logloss_fit_k1: r4(ll(fit, 1)), logloss_fit_kfit: r4(best.ll), eval_k1: evalK(1), eval_kfit: evalK(kfit), mercado_eval: { logloss_over: r4(-mean(ev.map(p => { const q = clampP(pOverK(p)); return yOver(p) ? Math.log(q) : Math.log(1 - q); }))), brier_over: calib(ev).brier_over_mercado } };
  // H1 para GOALS
  const cfit = fitC(fit); R.H1 = { c_fit: cfit, c_refit_en_eval_solo_diagnostico: fitC(ev), eval: {} };
  for (const c of [cfit.c, 0, 1]) for (const th of [0, 0.02, 0.04]) R.H1.eval[`c=${c}|theta=${th}`] = metrics(ev.filter(p => pStar(p, c) * p.best_odds - 1 > th), p => pStar(p, c));
  R.H1.eval_brier_all = { brier_pstar: r4(mean(ev.map(p => (pStar(p, cfit.c) - win(p)) ** 2))), brier_market: R.base_eval.brier_market, brier_model: R.base_eval.brier_variant, brier_close: R.base_eval.brier_close, n: ev.length };
  // COMBO: sin model_prob en el libro → solo ROI descriptivo (+ROI de la pata de goles no separable).
  const CO = decided.filter(p => p.family === 'COMBO');
  R.COMBO = { n: CO.length, hit: r4(mean(CO.map(win))), roi: r4(mean(CO.map(p => pnlAt(p, p.best_odds)))), roi_se: r4(sd(CO.map(p => pnlAt(p, p.best_odds))) / Math.sqrt(CO.length)), odds_avg: r4(mean(CO.map(p => p.best_odds))), nota: 'COMBO no guarda model_prob ni market_prob ni resultado por pata → no entra a la calibración H4.' };
  RES.families.GOALS = R;
})();

// ═══════════════════════════ CORNERS ═══════════════════════════
(function CORNERS() {
  const C = decided.filter(p => p.family === 'CORNERS' && p.model_prob > 0 && p.market_prob > 0 && p.line != null);
  const { fit, ev, cut_at } = split(C, SPLIT);
  const R = { n_total: C.length, n_fit: fit.length, n_eval: ev.length, cut_at };
  R.base_all = metrics(C, p => p.model_prob); R.base_fit = metrics(fit, p => p.model_prob); R.base_eval = metrics(ev, p => p.model_prob);
  const bySide = s => metrics(C.filter(p => p.side === s), p => p.model_prob);
  R.por_lado_all = { over: bySide('over'), under: bySide('under') };
  R.por_lado_eval = { over: metrics(ev.filter(p => p.side === 'over'), p => p.model_prob), under: metrics(ev.filter(p => p.side === 'under'), p => p.model_prob) };
  R.por_books_all = { books_1: metrics(C.filter(p => p.books === 1), p => p.model_prob), books_ge_2: metrics(C.filter(p => p.books >= 2), p => p.model_prob) };
  // H1
  const cfit = fitC(fit); R.H1 = { c_fit: cfit, c_refit_en_eval_solo_diagnostico: fitC(ev), eval: {} };
  for (const c of [cfit.c, 0, 1]) for (const th of [0, 0.02, 0.04]) R.H1.eval[`c=${c}|theta=${th}`] = metrics(ev.filter(p => pStar(p, c) * p.best_odds - 1 > th), p => pStar(p, c));
  R.H1.eval_brier_all = { brier_pstar: r4(mean(ev.map(p => (pStar(p, cfit.c) - win(p)) ** 2))), brier_market: R.base_eval.brier_market, brier_model: R.base_eval.brier_variant, brier_close: R.base_eval.brier_close, n: ev.length };
  // H5a: μ del modelo (≈ media de liga × game-state) invertida desde model_prob (Poisson; NB con r grande ≈ Poisson)
  const pOverM = p => p.side === 'over' ? p.model_prob : 1 - p.model_prob;
  const pOverK = p => p.side === 'over' ? p.market_prob : 1 - p.market_prob;
  const pOverClose = p => p.side === 'over' ? p.closing.fair_prob : 1 - p.closing.fair_prob;
  const yOver = p => (p.side === 'over') === (p.result_code === 'WIN') ? 1 : 0;
  const muM = p => invertLambda(clampP(pOverM(p)), p.line);
  const dev = p => p.line - muM(p); // >0: la casa puso la línea por ENCIMA de la media de liga
  const edgeOver = p => pOverM(p) - pOverK(p);
  const H5 = {};
  // regresión en fit: y_over ~ a + b·logit(k_over) + c·dev ; evaluar log-loss en eval vs solo mercado
  const X = set => set.map(p => [1, logit(clampP(pOverK(p))), dev(p)]);
  const lr = logisticFit(X(fit), fit.map(yOver));
  const lr0 = logisticFit(fit.map(p => [1, logit(clampP(pOverK(p)))]), fit.map(yOver));
  const llOf = (set, f) => -mean(set.map(p => { const q = clampP(f(p)); return yOver(p) ? Math.log(q) : Math.log(1 - q); }));
  H5.a_desviacion_linea = {
    fit_coef: { a: r4(lr.w[0]), b_mkt: r4(lr.w[1]), c_dev: r4(lr.w[2]), se_c_dev: r4(lr.se[2]), t_c_dev: r4(lr.w[2] / lr.se[2]) },
    eval_logloss_mercado_solo: r4(llOf(ev, p => sig(lr0.w[0] + lr0.w[1] * logit(clampP(pOverK(p)))))),
    eval_logloss_mercado_mas_dev: r4(llOf(ev, p => sig(lr.w[0] + lr.w[1] * logit(clampP(pOverK(p))) + lr.w[2] * dev(p)))),
    eval_logloss_modelo_crudo: r4(llOf(ev, pOverM)), eval_logloss_mercado_crudo: r4(llOf(ev, pOverK)),
    eval_corr_dev_vs_over: r4(corr(ev.map(dev), ev.map(yOver))), eval_corr_edge_vs_win: r4(corr(ev.map(p => p.model_prob - p.market_prob), ev.map(win))),
    dev_medio_all: r4(mean(C.map(dev))), mu_modelo_medio_all: r4(mean(C.map(muM))), linea_media_all: r4(mean(C.map(p => p.line))),
  };
  // Estrategia "seguir al modelo": umbral θ elegido en fit (mejor ROI con n≥30), evaluado en eval
  const thGrid = [0, 0.02, 0.04, 0.06, 0.08, 0.10];
  const roiTh = (set, th) => metrics(set.filter(p => (p.model_prob - p.market_prob) >= th), p => p.model_prob);
  const fitTh = thGrid.map(th => ({ th, m: roiTh(fit, th) })).filter(x => x.m.n >= 30).sort((a, b) => b.m.roi - a.m.roi)[0];
  H5.seguir_modelo = { theta_elegido_en_fit: fitTh ? fitTh.th : null, fit: fitTh ? fitTh.m : null, eval: fitTh ? roiTh(ev, fitTh.th) : null, eval_por_theta: Object.fromEntries(thGrid.map(th => [th, roiTh(ev, th)])) };
  // H5b: movimiento de línea/precio: move = closing.fair_prob − market_prob (lado elegido)
  const withMove = set => set.filter(p => p.closing && p.closing.fair_prob > 0);
  const move = p => p.closing.fair_prob - p.market_prob;
  const evM = withMove(ev), fitM = withMove(fit);
  const moveStats = set => ({ n: set.length, n_move_pos: set.filter(p => move(p) > 1e-4).length, n_move_neg: set.filter(p => move(p) < -1e-4).length, n_move_0: set.filter(p => Math.abs(move(p)) <= 1e-4).length, corr_move_vs_win: r4(corr(set.map(move), set.map(win))), corr_edge_vs_win: r4(corr(set.map(p => p.model_prob - p.market_prob), set.map(win))), corr_move_vs_edge: r4(corr(set.map(move), set.map(p => p.model_prob - p.market_prob))) });
  H5.b_movimiento = { eval: moveStats(evM), fit: moveStats(fitM), all: moveStats(withMove(C)) };
  // seguir el movimiento: apostar el lado elegido si el cierre se movió a favor (move>0); si se movió en contra, apostar el lado contrario al precio JUSTO de apertura 1/(1−k) (aprox., margen 0 y 5 %)
  const follow = (set, mg) => {
    const pos = set.filter(p => move(p) > 1e-4), neg = set.filter(p => move(p) < -1e-4);
    const pnlPos = pos.map(p => pnlAt(p, p.best_odds));
    const pnlNeg = neg.map(p => { const o = (1 / (1 - p.market_prob)) * (1 - mg); return win(p) ? -1 : o - 1; });
    const allp = pnlPos.concat(pnlNeg);
    return { n_pos: pos.length, roi_pos_lado_elegido: r4(mean(pnlPos)), hit_pos: r4(mean(pos.map(win))), n_neg: neg.length, roi_neg_lado_contrario: r4(mean(pnlNeg)), roi_total: r4(mean(allp)), roi_total_se: r4(sd(allp) / Math.sqrt(allp.length)) };
  };
  H5.seguir_movimiento = { eval_margen_0: follow(evM, 0), eval_margen_5: follow(evM, 0.05), all_margen_0: follow(withMove(C), 0) };
  // ¿el cierre predice mejor que el modelo? Brier/logloss del lado elegido
  H5.brier_lado_elegido_eval = { modelo: r4(mean(ev.map(p => (p.model_prob - win(p)) ** 2))), mercado_apertura: r4(mean(ev.map(p => (p.market_prob - win(p)) ** 2))), cierre: r4(mean(evM.map(p => (p.closing.fair_prob - win(p)) ** 2))), blend50: r4(mean(ev.map(p => (0.5 * p.model_prob + 0.5 * p.market_prob - win(p)) ** 2))), n: ev.length };
  // el movimiento ¿va hacia el modelo? (si el modelo "ve" algo, el cierre debería moverse hacia él)
  H5.cierre_hacia_modelo = { all: r4(mean(withMove(C).map(p => Math.sign(move(p)) * Math.sign(p.model_prob - p.market_prob)))), eval: r4(mean(evM.map(p => Math.sign(move(p)) * Math.sign(p.model_prob - p.market_prob)))) };
  R.H5 = H5;
  // por liga (all) — descriptivo
  const byL = {}; for (const p of C) (byL[p.league] = byL[p.league] || []).push(p);
  R.por_liga_all = Object.fromEntries(Object.entries(byL).filter(([, a]) => a.length >= 20).map(([k, a]) => [k, { n: a.length, hit: r4(mean(a.map(win))), roi: r4(mean(a.map(p => pnlAt(p, p.best_odds)))), clv: r4(mean(a.filter(p => typeof p.clv === 'number').map(p => p.clv))) }]));
  RES.families.CORNERS = R;
})();

fs.writeFileSync(path.join(OUT, `results-${SPLIT}.json`), JSON.stringify(RES, null, 1));
console.log(JSON.stringify(RES, null, 1));
