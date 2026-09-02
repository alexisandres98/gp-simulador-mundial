// diag.js — diagnósticos complementarios SOLID: calibración del mercado por tramo de cuota (sesgo favorito-longshot
// del consenso), copas vs liga y primeras 2 semanas por tramo, y CLV vs resultado.
'use strict';
const fs = require('fs');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/clubs_picks_full.json';
const all = JSON.parse(fs.readFileSync(SRC, 'utf8')).picks;
const dec = all.filter(p => p.result_code === 'WIN' || p.result_code === 'LOSS');
const byT = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r4 = x => isFinite(x) ? +x.toFixed(4) : null;
const win = p => p.result_code === 'WIN' ? 1 : 0;
const pnl = p => win(p) ? p.best_odds - 1 : -1;
const M = a => ({ n: a.length, hit: r4(mean(a.map(win))), roi: r4(mean(a.map(pnl))), se: r4(sd(a.map(pnl)) / Math.sqrt(a.length)), p_mkt: r4(mean(a.map(p => p.market_prob))), p_close: r4(mean(a.map(p => p.closing ? p.closing.fair_prob : p.market_prob))), p_model: r4(mean(a.map(p => p.model_prob))), impl_best: r4(mean(a.map(p => 1 / p.best_odds))), clv: r4(mean(a.filter(p => typeof p.clv === 'number').map(p => p.clv))) });
const S = dec.filter(p => p.family === 'SOLID').sort(byT);
const CUP = /Cup|Copa|Pokal|Champions|Europa|Libertadores|Sudamericana|Leagues Cup|Supercopa/i;
const out = {};
// 1) calibración del consenso por tramo de cuota (todas las SOLID decididas; y por tramo temporal)
const bucket = p => p.best_odds <= 1.8 ? 'a_<=1.8' : p.best_odds <= 2.5 ? 'b_1.8-2.5' : p.best_odds <= 3.2 ? 'c_2.5-3.2' : p.best_odds <= 5 ? 'd_3.2-5' : 'e_>5';
const grp = (arr, f) => { const g = {}; for (const p of arr) (g[f(p)] = g[f(p)] || []).push(p); return Object.fromEntries(Object.entries(g).sort().map(([k, a]) => [k, M(a)])); };
out.calib_mercado_por_cuota_all = grp(S, bucket);
const k60 = Math.floor(S.length * 0.6);
out.calib_mercado_por_cuota_fit60 = grp(S.slice(0, k60), bucket);
out.calib_mercado_por_cuota_eval40 = grp(S.slice(k60), bucket);
// lo mismo para probabilidad de mercado (bucket de market_prob)
const bk2 = p => p.market_prob < 0.2 ? 'a_<20' : p.market_prob < 0.3 ? 'b_20-30' : p.market_prob < 0.4 ? 'c_30-40' : p.market_prob < 0.5 ? 'd_40-50' : p.market_prob < 0.6 ? 'e_50-60' : 'f_>=60';
out.calib_por_prob_mercado_all = grp(S, bk2);
// 2) copas / primeras 2 semanas por tramo
const firstKO = {}; for (const p of all) { const t = Date.parse(p.event.kickoff_at); if (!firstKO[p.league] || t < firstKO[p.league]) firstKO[p.league] = t; }
const seasonStart = lg => (firstKO[lg] >= Date.parse('2026-08-01') ? firstKO[lg] : null);
const inFirst2w = p => { const s = seasonStart(p.league); return s != null && Date.parse(p.event.kickoff_at) < s + 14 * 86400e3; };
const isCup = p => CUP.test(p.competition_name || '');
for (const [tag, set] of [['fit60', S.slice(0, k60)], ['eval40', S.slice(k60)], ['all', S]]) {
  out['copas_' + tag] = { solo_copas: M(set.filter(isCup)), sin_copas: M(set.filter(p => !isCup(p))) };
  out['primeras2sem_' + tag] = { solo_primeras2sem: M(set.filter(inFirst2w)), resto: M(set.filter(p => !inFirst2w(p))), primeras2sem_sin_copas: M(set.filter(p => inFirst2w(p) && !isCup(p))), copas_fuera_primeras2sem: M(set.filter(p => isCup(p) && !inFirst2w(p))) };
  out['ligas_arranque_vs_medio_' + tag] = { ligas_que_arrancan_en_libro: M(set.filter(p => seasonStart(p.league) != null)), ligas_a_mitad_de_temporada: M(set.filter(p => seasonStart(p.league) == null)) };
}
// 3) por competición (n≥10)
const byC = {}; for (const p of S) (byC[p.competition_name] = byC[p.competition_name] || []).push(p);
out.por_competicion_all = Object.fromEntries(Object.entries(byC).filter(([, a]) => a.length >= 10).map(([k, a]) => [k, M(a)]));
// 4) ROI a cuota de cierre vs mejor cuota, por tramo; y "picks con clv>0" vs "clv<0"
for (const [tag, set] of [['fit60', S.slice(0, k60)], ['eval40', S.slice(k60)]]) {
  out['clv_split_' + tag] = { clv_pos: M(set.filter(p => p.clv > 0)), clv_neg: M(set.filter(p => p.clv <= 0)) };
}
// 5) tiempo hasta el kickoff (h) por tramo
const lead = p => (Date.parse(p.event.kickoff_at) - Date.parse(p.created_at)) / 3600e3;
out.por_antelacion_all = grp(S, p => lead(p) < 24 ? 'a_<24h' : lead(p) < 72 ? 'b_24-72h' : lead(p) < 120 ? 'c_72-120h' : 'd_>120h');
// 6) implied de la mejor cuota vs mercado: cuánto "sobreprecio" tiene la mejor cuota (best vs fair), por bucket
out.best_vs_fair_all = grp(S, p => { const e = (p.market_prob * p.best_odds - 1) * 100; return e < 0 ? 'a_ev<0' : e < 5 ? 'b_0-5' : e < 10 ? 'c_5-10' : 'd_>=10'; });
fs.writeFileSync(__dirname + '/diag.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));

// 7) Recalibración del mercado (proxy de un de-vig no proporcional): p_adj = σ(a + b·logit(p_mkt)) ajustado en fit60,
//    Brier en eval40 vs mercado crudo; y el blend con intercepto+Δ (a + b·logit(pk) + c·Δ) del H1.
const logit = p => Math.log(p / (1 - p)), sig = x => 1 / (1 + Math.exp(-x)), cl = p => Math.min(0.999, Math.max(0.001, p));
function lfit(X, y) { let w = new Array(X[0].length).fill(0); for (let it = 0; it < 50; it++) { const k = w.length, g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0)); for (let i = 0; i < X.length; i++) { let z = 0; for (let j = 0; j < k; j++) z += w[j] * X[i][j]; const p = sig(z), r = p - y[i]; for (let j = 0; j < k; j++) { g[j] += r * X[i][j]; for (let l = 0; l < k; l++) H[j][l] += p * (1 - p) * X[i][j] * X[i][l]; } } for (let j = 0; j < k; j++) H[j][j] += 1e-6; const s = solve(H, g); for (let j = 0; j < k; j++) w[j] -= s[j]; } return w; }
function solve(A, b) { const n = b.length; A = A.map((r, i) => r.concat([b[i]])); for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; [A[c], A[piv]] = [A[piv], A[c]]; const d = A[c][c] || 1e-12; for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / d; for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]; } } return A.map((r, i) => r[n] / (r[i] || 1e-12)); }
const fit = S.slice(0, k60), ev = S.slice(k60);
const wK = lfit(fit.map(p => [1, logit(cl(p.market_prob))]), fit.map(win));
const wKD = lfit(fit.map(p => [1, logit(cl(p.market_prob)), logit(cl(p.model_prob)) - logit(cl(p.market_prob))]), fit.map(win));
const pK = p => sig(wK[0] + wK[1] * logit(cl(p.market_prob)));
const pKD = p => sig(wKD[0] + wKD[1] * logit(cl(p.market_prob)) + wKD[2] * (logit(cl(p.model_prob)) - logit(cl(p.market_prob))));
const brier = (set, f) => r4(mean(set.map(p => (f(p) - win(p)) ** 2)));
const strat = (set, f, th) => { const s = set.filter(p => f(p) * p.best_odds - 1 > th); return Object.assign(M(s), { th }); };
out.recalibracion_mercado = {
  coef_fit60: { a: r4(wK[0]), b: r4(wK[1]) }, coef_fit60_con_delta: { a: r4(wKD[0]), b: r4(wKD[1]), c: r4(wKD[2]) },
  eval40: { brier_mercado: brier(ev, p => p.market_prob), brier_mercado_recalibrado: brier(ev, pK), brier_recalibrado_mas_delta: brier(ev, pKD), brier_modelo: brier(ev, p => p.model_prob), n: ev.length,
    p_media_mercado: r4(mean(ev.map(p => p.market_prob))), p_media_recal: r4(mean(ev.map(pK))), observado: r4(mean(ev.map(win))) },
  fit60: { brier_mercado: brier(fit, p => p.market_prob), brier_mercado_recalibrado: brier(fit, pK), n: fit.length },
  estrategia_eval40_p_recal: [0, 0.02, 0.04].map(th => strat(ev, pK, th)),
  estrategia_eval40_p_recal_delta: [0, 0.02, 0.04].map(th => strat(ev, pKD, th)),
  estrategia_eval40_cierre_fair: [0, 0.02, 0.04].map(th => strat(ev, p => p.closing.fair_prob, th)),
};
fs.writeFileSync(__dirname + '/diag.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.recalibracion_mercado, null, 1));
