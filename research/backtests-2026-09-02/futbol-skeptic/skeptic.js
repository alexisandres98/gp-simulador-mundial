// skeptic.js — verificación adversarial de las hipótesis ACEPTADAS del backtest de fútbol clubes:
//   (A) H2-SOLID-copas: excluir copas.   (B) H2-CORNERS: exigir ≥2 casas.
// Solo lectura del libro; escribe skeptic.json en este directorio.
'use strict';
const fs = require('fs');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/clubs_picks_full.json';
const all = JSON.parse(fs.readFileSync(SRC, 'utf8')).picks;
const dec = all.filter(p => p.result_code === 'WIN' || p.result_code === 'LOSS');
const byT = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const se = a => sd(a) / Math.sqrt(a.length);
const r3 = x => isFinite(x) ? +x.toFixed(3) : null;
const r4 = x => isFinite(x) ? +x.toFixed(4) : null;
const win = p => p.result_code === 'WIN' ? 1 : 0;
const pnlAt = (p, o) => win(p) ? o - 1 : -1;
const pnl = p => pnlAt(p, p.best_odds);
const oddsCreate = p => (p.odds_at_create != null ? p.odds_at_create : p.best_odds);
const pnlCreate = p => pnlAt(p, oddsCreate(p));
const booksCreate = p => { const m = /consenso de (\d+) casas/.exec(p.why_es || ''); return m ? Number(m[1]) : (p.books || 0); };
// Welch t entre dos grupos de pnl
const welch = (a, b) => { const d = mean(a) - mean(b), s = Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length); return { diff: r4(d), se: r4(s), t: r3(d / s) }; };
const M = a => a.length ? ({
  n: a.length, hit: r4(mean(a.map(win))), roi: r4(mean(a.map(pnl))), se: r4(se(a.map(pnl))), t: r3(mean(a.map(pnl)) / se(a.map(pnl))),
  roi_odds_create: r4(mean(a.map(pnlCreate))), ev_si_mercado_acierta: r4(mean(a.map(p => p.market_prob * p.best_odds - 1))),
  p_model: r4(mean(a.map(p => p.model_prob))), p_mkt: r4(mean(a.map(p => p.market_prob))), obs_menos_mkt_pp: r4(100 * mean(a.map(p => win(p) - p.market_prob))),
  t_obs_mkt: r3(mean(a.map(p => win(p) - p.market_prob)) / se(a.map(p => win(p) - p.market_prob))), odds: r4(mean(a.map(p => p.best_odds))),
}) : { n: 0 };
let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const OUT = { generated_at: new Date().toISOString() };

// ═══════════════════ (A) SOLID — copas ═══════════════════
(function A() {
  const S = dec.filter(p => p.family === 'SOLID' && p.model_prob > 0 && p.market_prob > 0).sort(byT);
  const CUP_BUG = /Cup|Copa|Pokal|Champions|Europa|Libertadores|Sudamericana|Leagues Cup|Supercopa/i;
  // Definición correcta: por clave de liga (CLUB_CUPS de server.js + placeholders champions/europa/uefa)
  const CUP_LEAGUES = new Set(['libertadores', 'sudamericana', 'leaguescup', 'eflcup', 'facup', 'dfbpokal', 'copadelrey', 'coppaitalia', 'coupefrance', 'uclq', 'champions', 'europa', 'uefa']);
  const isCupBug = p => CUP_BUG.test(p.competition_name || '');
  const isCup = p => CUP_LEAGUES.has(p.league);
  const A = {};
  A.definicion = {
    bug_regex_incluye_Championship: M(S.filter(p => isCupBug(p) && !isCup(p))),
    bug_regex_omite_CoppaItalia: M(S.filter(p => !isCupBug(p) && isCup(p))),
    copas_regex_agente: M(S.filter(isCupBug)), copas_por_liga_correcto: M(S.filter(isCup)),
    coppaitalia_detalle: S.filter(p => p.league === 'coppaitalia').map(p => [p.created_at.slice(0, 10), p.event.home, p.event.away, p.selection_code, r3(p.model_prob), r3(p.market_prob), p.best_odds, p.result_code]),
  };
  const cups = S.filter(isCup), non = S.filter(p => !isCup(p));
  A.copas_vs_no_copas_all = { copas: M(cups), no_copas: M(non), welch_pnl: welch(cups.map(pnl), non.map(pnl)), welch_obs_menos_mkt: welch(cups.map(p => win(p) - p.market_prob), non.map(p => win(p) - p.market_prob)) };
  // splits temporales con la definición correcta
  for (const frac of [0.6, 0.5]) {
    const k = Math.floor(S.length * frac), fit = S.slice(0, k), ev = S.slice(k);
    const fN = fit.filter(p => !isCup(p)), eN = ev.filter(p => !isCup(p));
    A[`split_${frac}`] = {
      cut_at: ev[0].created_at, base_fit: M(fit), base_eval: M(ev), copas_fit: M(fit.filter(isCup)), copas_eval: M(ev.filter(isCup)),
      sin_copas_fit: M(fN), declarado: fN.length >= 25 && mean(fN.map(pnl)) > mean(fit.map(pnl)), sin_copas_eval: M(eN),
      eval_delta_roi: r4(mean(eN.map(pnl)) - mean(ev.map(pnl))), welch_eval_copas_vs_no: welch(ev.filter(isCup).map(pnl), eN.map(pnl)),
    };
  }
  // Confusor 1: cuota. ¿Las copas pierden más que las no-copas A IGUAL CUOTA?
  const ob = p => p.best_odds <= 2.5 ? 'a_<=2.5' : p.best_odds <= 3.2 ? 'b_2.5-3.2' : p.best_odds <= 5 ? 'c_3.2-5' : 'd_>5';
  const byB = {}; for (const p of S) { const k = ob(p); (byB[k] = byB[k] || { cup: [], non: [] })[isCup(p) ? 'cup' : 'non'].push(p); }
  A.confusor_cuota = Object.fromEntries(Object.entries(byB).sort().map(([k, g]) => [k, { copas: M(g.cup), no_copas: M(g.non), welch: g.cup.length > 1 && g.non.length > 1 ? welch(g.cup.map(pnl), g.non.map(pnl)) : null }]));
  // regresión lineal pnl ~ cup + bucket cuota (dummies) — coeficiente de cup ajustado por cuota
  (function () {
    const keys = Object.keys(byB).sort(); const X = S.map(p => [1, isCup(p) ? 1 : 0, ...keys.slice(1).map(k => ob(p) === k ? 1 : 0)]); const y = S.map(pnl);
    const k = X[0].length; const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
    const inv = invert(XtX); const w = inv.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
    const res = X.map((x, i) => y[i] - x.reduce((s, v, j) => s + v * w[j], 0)); const s2 = res.reduce((s, r) => s + r * r, 0) / (X.length - k);
    A.regresion_pnl_cup_ajustada_por_cuota = { coef_cup: r4(w[1]), se: r4(Math.sqrt(s2 * inv[1][1])), t: r3(w[1] / Math.sqrt(s2 * inv[1][1])), n: X.length };
    // lo mismo con y = win − market_prob (¿el mercado se equivoca más en copas, a igual cuota?)
    const y2 = S.map(p => win(p) - p.market_prob); const Xty2 = new Array(k).fill(0); for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) Xty2[a] += X[i][a] * y2[i];
    const w2 = inv.map(r => r.reduce((s, v, j) => s + v * Xty2[j], 0)); const res2 = X.map((x, i) => y2[i] - x.reduce((s, v, j) => s + v * w2[j], 0)); const s22 = res2.reduce((s, r) => s + r * r, 0) / (X.length - k);
    A.regresion_obsmenosmkt_cup_ajustada_por_cuota = { coef_cup_pp: r4(100 * w2[1]), se_pp: r4(100 * Math.sqrt(s22 * inv[1][1])), t: r3(w2[1] / Math.sqrt(s22 * inv[1][1])) };
  })();
  // Confusor 2: ventana temporal. No-copas creadas en la misma ventana que las copas (≥ 15-ago)
  const t0 = Math.min(...cups.map(p => Date.parse(p.created_at)));
  A.confusor_tiempo = { ventana_desde: new Date(t0).toISOString(), copas: M(cups), no_copas_misma_ventana: M(non.filter(p => Date.parse(p.created_at) >= t0)), no_copas_antes: M(non.filter(p => Date.parse(p.created_at) < t0)), no_copas_misma_ventana_cuota_gt_3_2: M(non.filter(p => Date.parse(p.created_at) >= t0 && p.best_odds > 3.2)), copas_cuota_gt_3_2: M(cups.filter(p => p.best_odds > 3.2)) };
  // Mecanismo: copas que cruzan divisiones (pool 1500 compartido) vs copas de mismo nivel entre países
  const CROSS = new Set(['dfbpokal', 'eflcup', 'coppaitalia', 'facup', 'copadelrey', 'coupefrance']);
  const cross = cups.filter(p => CROSS.has(p.league)), same = cups.filter(p => !CROSS.has(p.league));
  const delta = a => ({ n: a.length, delta_modelo_menos_mkt_pp: r4(100 * mean(a.map(p => p.model_prob - p.market_prob))), obs: r4(mean(a.map(win))), p_model: r4(mean(a.map(p => p.model_prob))), p_mkt: r4(mean(a.map(p => p.market_prob))), roi: r4(mean(a.map(pnl))), se: r4(se(a.map(pnl))), brier_modelo: r4(mean(a.map(p => (p.model_prob - win(p)) ** 2))), brier_mkt: r4(mean(a.map(p => (p.market_prob - win(p)) ** 2))) });
  A.mecanismo = { copas_cruzan_divisiones: delta(cross), copas_mismo_nivel_entre_paises: delta(same), por_copa: Object.fromEntries([...CUP_LEAGUES].filter(l => cups.some(p => p.league === l)).map(l => [l, delta(cups.filter(p => p.league === l))])), no_copas_referencia: delta(non), no_copas_delta_ge_15pp: delta(non.filter(p => p.model_prob - p.market_prob >= 0.15)), copas_delta_ge_15pp: delta(cups.filter(p => p.model_prob - p.market_prob >= 0.15)) };
  // Nulo Monte Carlo: si el MERCADO tuviera razón (y ~ Bern(market_prob)), ¿qué ROI esperaríamos en las copas y con qué prob. sale ≤ el observado?
  const mc = (set, obsRoi, B = 4000) => { let le = 0; const rois = []; for (let b = 0; b < B; b++) { let s = 0; for (const p of set) s += (rnd() < p.market_prob ? p.best_odds - 1 : -1); const r = s / set.length; rois.push(r); if (r <= obsRoi) le++; } rois.sort((a, b) => a - b); return { roi_esperado_nulo: r4(mean(rois)), p05: r4(rois[Math.floor(0.05 * B)]), p_valor_roi_le_obs: r4(le / B) }; };
  A.nulo_mercado_copas = { observado: r4(mean(cups.map(pnl))), n: cups.length, ...mc(cups, mean(cups.map(pnl))) };
  A.nulo_mercado_no_copas = { observado: r4(mean(non.map(pnl))), n: non.length, ...mc(non, mean(non.map(pnl))) };
  // Multiplicidad: los 14 filtros del agente (+ el correcto de copas) bajo el nulo de mercado. ¿Con qué frecuencia ALGÚN filtro queda
  // "declarado en fit" y mejora el ROI de eval en ≥ +10 pp (lo observado para sin_copas)?
  const firstKO = {}; for (const p of all) { const t = Date.parse(p.event.kickoff_at); if (!firstKO[p.league] || t < firstKO[p.league]) firstKO[p.league] = t; }
  const seasonStart = lg => (firstKO[lg] >= Date.parse('2026-08-01') ? firstKO[lg] : null);
  const inFirst2w = p => { const s = seasonStart(p.league); return s != null && Date.parse(p.event.kickoff_at) < s + 14 * 86400e3; };
  const FILTERS = {
    odds_le_2_5: p => p.best_odds <= 2.5, odds_le_3_2: p => p.best_odds <= 3.2, books_ge_10: p => (p.books || 0) >= 10,
    sin_copas_bug: p => !isCupBug(p), sin_copas_ok: p => !isCup(p), sin_2_primeras_semanas: p => !inFirst2w(p),
    regime_anchor: p => p.regime === 'anchor', regime_lead: p => p.regime === 'lead', sel_home: p => p.selection_code === 'home', sel_away: p => p.selection_code === 'away',
    gate_approved: p => p.gate_status === 'approved', discrep_lt_10pp: p => (p.model_prob - p.market_prob) < 0.10, discrep_ge_10pp: p => (p.model_prob - p.market_prob) >= 0.10,
    market_fav_ge_50: p => p.market_prob >= 0.5, combo: p => p.best_odds <= 2.5 && (p.books || 0) >= 10 && !isCupBug(p),
  };
  const k60 = Math.floor(S.length * 0.6), fit = S.slice(0, k60), ev = S.slice(k60);
  const obsDelta = mean(ev.filter(p => !isCup(p)).map(pnl)) - mean(ev.map(pnl));
  const B = 2000; let anyHit = 0, cupHit = 0; const maxDeltas = [];
  for (let b = 0; b < B; b++) {
    const y = new Map(S.map(p => [p.pick_id, rnd() < p.market_prob ? 1 : 0]));
    const pn = p => y.get(p.pick_id) ? p.best_odds - 1 : -1;
    const bf = mean(fit.map(pn)), be = mean(ev.map(pn)); let mx = -Infinity, hit = false;
    for (const [name, f] of Object.entries(FILTERS)) {
      const ff = fit.filter(f), fe = ev.filter(f); if (ff.length < 25 || !fe.length) continue;
      if (mean(ff.map(pn)) > bf) { const d = mean(fe.map(pn)) - be; mx = Math.max(mx, d); if (d >= obsDelta) hit = true; if (name === 'sin_copas_ok' && d >= obsDelta) cupHit = cupHit + 1; }
    }
    if (hit) anyHit++; maxDeltas.push(mx);
  }
  maxDeltas.sort((a, b) => a - b);
  A.multiplicidad_nulo_mercado = { n_filtros: Object.keys(FILTERS).length, delta_eval_observado_sin_copas: r4(obsDelta), p_algun_filtro_declarado_con_delta_ge_obs: r4(anyHit / B), p_sin_copas_solo: r4(cupHit / B), mediana_max_delta_nulo: r4(maxDeltas[Math.floor(B / 2)]), p95_max_delta_nulo: r4(maxDeltas[Math.floor(0.95 * B)]), sims: B, nota: 'Nulo = el mercado acierta (y~Bern(market_prob)) y el modelo no informa; misma regla de declaración del agente (n≥25 y ROI_fit > base_fit).' };
  // Lo que queda tras quitar copas: ¿es rentable?
  A.solid_sin_copas_resultado = { all: M(non), eval60: M(ev.filter(p => !isCup(p))), all_a_cuota_creacion: r4(mean(non.map(pnlCreate))) };
  // Brier del modelo vs mercado sin copas (¿mejora la calibración del modelo o solo se quita un grupo?)
  A.brier_sin_copas = { modelo: r4(mean(non.map(p => (p.model_prob - win(p)) ** 2))), mercado: r4(mean(non.map(p => (p.market_prob - win(p)) ** 2))), n: non.length, modelo_copas: r4(mean(cups.map(p => (p.model_prob - win(p)) ** 2))), mercado_copas: r4(mean(cups.map(p => (p.market_prob - win(p)) ** 2))) };
  OUT.A_SOLID_copas = A;
})();

function invert(A) { const n = A.length; const M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => i === j ? 1 : 0))); for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } } return M.map(r => r.slice(n)); }

// ═══════════════════ (B) CORNERS — ≥2 casas ═══════════════════
(function B() {
  const C = dec.filter(p => p.family === 'CORNERS' && p.model_prob > 0 && p.market_prob > 0 && p.line != null).sort(byT);
  const Bk = {};
  // 1) ¿"books" es dato de creación? Cruce books refrescado vs books al crear (why_es)
  const tab = {}; for (const p of C) { const k = `create_${booksCreate(p) >= 2 ? 'ge2' : '1'}|refresh_${(p.books || 0) >= 2 ? 'ge2' : '1'}`; tab[k] = (tab[k] || 0) + 1; }
  Bk.books_creacion_vs_refrescado = { tabla: tab, n_refrescadas: C.filter(p => p.odds_refreshed_at).length, n_odds_create_distinta: C.filter(p => p.odds_at_create != null && Math.abs(p.odds_at_create - p.best_odds) > 1e-9).length, closing_odds_igual_best: C.filter(p => p.closing && Math.abs(p.closing.odds - p.best_odds) < 1e-9).length, nota: 'server.js refreshClubPickPrices (≤2h del KO, cada 20 min) sobreescribe best_odds/best_book/books; el valor de creación de books solo sobrevive en why_es ("consenso de N casas"), y el de la cuota en odds_at_create.' };
  const defs = { books_refrescado: p => (p.books || 0) >= 2, books_creacion: p => booksCreate(p) >= 2 };
  for (const [dn, f] of Object.entries(defs)) {
    const R = { all_ge2: M(C.filter(f)), all_1: M(C.filter(p => !f(p))), welch_all: welch(C.filter(f).map(pnl), C.filter(p => !f(p)).map(pnl)) };
    for (const frac of [0.6, 0.5]) {
      const k = Math.floor(C.length * frac), fit = C.slice(0, k), ev = C.slice(k);
      const ff = fit.filter(f), fe = ev.filter(f);
      R[`split_${frac}`] = { base_fit: M(fit), base_eval: M(ev), ge2_fit: M(ff), declarado: ff.length >= 25 && mean(ff.map(pnl)) > mean(fit.map(pnl)) + 0.02, ge2_eval: M(fe), compl_eval: M(ev.filter(p => !f(p))), welch_eval: welch(fe.map(pnl), ev.filter(p => !f(p)).map(pnl)) };
    }
    Bk[dn] = R;
  }
  // 2) Robustez al punto de corte y por semana (definición refrescada, la del agente)
  const f = defs.books_refrescado; const G2 = C.filter(f);
  Bk.cortes = {}; for (const frac of [0.3, 0.4, 0.5, 0.6, 0.7]) { const k = Math.floor(C.length * frac); const ev = C.slice(k).filter(f), fit = C.slice(0, k).filter(f); Bk.cortes[frac] = { fit: { n: fit.length, roi: r4(mean(fit.map(pnl))) }, eval: { n: ev.length, roi: r4(mean(ev.map(pnl))), se: r4(se(ev.map(pnl))) } }; }
  const wk = p => { const d = new Date(p.created_at); const on = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return 'w' + String(Math.ceil(((d - on) / 86400e3 + on.getUTCDay() + 1) / 7)).padStart(2, '0'); };
  const byW = {}; for (const p of G2) (byW[wk(p)] = byW[wk(p)] || []).push(p);
  Bk.por_semana_ge2 = Object.fromEntries(Object.entries(byW).sort().map(([k, a]) => [k, { n: a.length, roi: r4(mean(a.map(pnl))), pnl_u: r3(a.reduce((s, p) => s + pnl(p), 0)), hit: r4(mean(a.map(win))) }]));
  Bk.semanas_positivas = Object.values(byW).filter(a => mean(a.map(pnl)) > 0).length + '/' + Object.keys(byW).length;
  // 3) Concentración: casa, liga, lado, línea — leave-one-out
  const grp = (arr, g) => { const o = {}; for (const p of arr) (o[g(p)] = o[g(p)] || []).push(p); return o; };
  const loo = (arr, g) => Object.fromEntries(Object.entries(grp(arr, g)).sort((a, b) => b[1].length - a[1].length).map(([k, a]) => { const rest = arr.filter(p => g(p) !== k); return [k, { n: a.length, roi: r4(mean(a.map(pnl))), pnl_u: r3(a.reduce((s, p) => s + pnl(p), 0)), roi_sin_este: r4(mean(rest.map(pnl))), t_sin_este: r3(mean(rest.map(pnl)) / se(rest.map(pnl)))}]; }));
  Bk.ge2_por_casa_loo = loo(G2, p => p.best_book);
  Bk.ge2_por_liga_loo = loo(G2, p => p.league);
  Bk.ge2_por_lado = { over: M(G2.filter(p => p.side === 'over')), under: M(G2.filter(p => p.side === 'under')) };
  Bk.books1_por_lado = { over: M(C.filter(p => !f(p) && p.side === 'over')), under: M(C.filter(p => !f(p) && p.side === 'under')) };
  Bk.ge2_por_regime = Object.fromEntries(Object.entries(grp(G2, p => p.regime)).map(([k, a]) => [k, M(a)]));
  Bk.ge2_por_n_books = Object.fromEntries(Object.entries(grp(G2, p => p.books <= 3 ? '2-3' : p.books <= 7 ? '4-7' : '8+')).sort().map(([k, a]) => [k, M(a)]));
  // 4) ¿Cuánto del ROI es "line shopping" (EV positivo aunque el mercado acierte) y cuánto señal (obs − mkt)?
  Bk.descomposicion = { ge2: { roi: r4(mean(G2.map(pnl))), ev_si_mercado_acierta: r4(mean(G2.map(p => p.market_prob * p.best_odds - 1))), exceso_sobre_nulo: r4(mean(G2.map(pnl)) - mean(G2.map(p => p.market_prob * p.best_odds - 1))), obs_menos_mkt_pp: r4(100 * mean(G2.map(p => win(p) - p.market_prob))) }, books1: (() => { const a = C.filter(p => !f(p)); return { roi: r4(mean(a.map(pnl))), ev_si_mercado_acierta: r4(mean(a.map(p => p.market_prob * p.best_odds - 1))), obs_menos_mkt_pp: r4(100 * mean(a.map(p => win(p) - p.market_prob))) }; })() };
  // Nulo mercado para el grupo ≥2: P(ROI ≥ observado)
  const mcGe = (set, obs, B = 4000) => { let ge = 0; const rs = []; for (let b = 0; b < B; b++) { let s = 0; for (const p of set) s += (rnd() < p.market_prob ? p.best_odds - 1 : -1); const r = s / set.length; rs.push(r); if (r >= obs) ge++; } rs.sort((a, b) => a - b); return { roi_esperado_nulo: r4(mean(rs)), p95: r4(rs[Math.floor(0.95 * B)]), p_valor_roi_ge_obs: r4(ge / B) }; };
  Bk.nulo_mercado_ge2 = { observado: r4(mean(G2.map(pnl))), n: G2.length, ...mcGe(G2, mean(G2.map(pnl))) };
  const k60 = Math.floor(C.length * 0.6), fit = C.slice(0, k60), ev = C.slice(k60);
  Bk.nulo_mercado_ge2_eval60 = { observado: r4(mean(ev.filter(f).map(pnl))), n: ev.filter(f).length, ...mcGe(ev.filter(f), mean(ev.filter(f).map(pnl))) };
  // 5) Multiplicidad: 18 filtros del agente (filters2.js) bajo el nulo de mercado; misma regla de declaración (n≥25 y ROI_fit > base+2pp)
  const leadH = p => (Date.parse(p.event.kickoff_at) - Date.parse(p.created_at)) / 3600e3;
  const CF = {
    books_ge_2: p => (p.books || 0) >= 2, books_1: p => (p.books || 0) === 1, lado_over: p => p.side === 'over', lado_under: p => p.side === 'under',
    under_books_ge_2: p => p.side === 'under' && (p.books || 0) >= 2, precio_sobre_justo: p => p.best_odds * p.market_prob > 1,
    edge_ge_6pp: p => (p.model_prob - p.market_prob) >= 0.06, edge_ge_10pp: p => (p.model_prob - p.market_prob) >= 0.10, odds_ge_1_6: p => p.best_odds >= 1.6,
    antelacion_lt_24h: p => leadH(p) < 24, band_eficiente: p => p.league_band === 'eficiente', band_no_eficiente: p => p.league_band !== 'eficiente',
    gate_approved: p => p.gate_status === 'approved', regime_anchor: p => p.regime === 'anchor', regime_edge: p => p.regime === 'edge',
    linea_alta_ge_11_5: p => p.line >= 11.5, linea_baja_le_9_5: p => p.line <= 9.5, book_sharp: p => /pinnacle|matchbook|betfair/i.test(p.best_book || ''),
  };
  const obsRoiEval = mean(ev.filter(f).map(pnl)), obsDeltaEval = obsRoiEval - mean(ev.map(pnl)), obsRoiAll = mean(G2.map(pnl));
  const B = 2000; let anyDelta = 0, anyRoi = 0, anyAll = 0; const maxRoiEval = [];
  for (let b = 0; b < B; b++) {
    const y = new Map(C.map(p => [p.pick_id, rnd() < p.market_prob ? 1 : 0])); const pn = p => y.get(p.pick_id) ? p.best_odds - 1 : -1;
    const bf = mean(fit.map(pn)), be = mean(ev.map(pn)); let hd = false, hr = false, ha = false, mx = -Infinity;
    for (const g of Object.values(CF)) {
      const ff = fit.filter(g), fe = ev.filter(g); if (ff.length < 25 || fe.length < 20) continue;
      if (mean(ff.map(pn)) > bf + 0.02) { const re = mean(fe.map(pn)); mx = Math.max(mx, re); if (re - be >= obsDeltaEval) hd = true; if (re >= obsRoiEval) hr = true; if (mean(C.filter(g).map(pn)) >= obsRoiAll) ha = true; }
    }
    if (hd) anyDelta++; if (hr) anyRoi++; if (ha) anyAll++; maxRoiEval.push(mx);
  }
  maxRoiEval.sort((a, b) => a - b);
  Bk.multiplicidad_nulo_mercado = { n_filtros: Object.keys(CF).length, obs_roi_eval_ge2: r4(obsRoiEval), obs_delta_eval: r4(obsDeltaEval), obs_roi_all_ge2: r4(obsRoiAll), p_algun_filtro_declarado_delta_eval_ge_obs: r4(anyDelta / B), p_algun_filtro_declarado_roi_eval_ge_obs: r4(anyRoi / B), p_algun_filtro_declarado_y_roi_total_ge_obs: r4(anyAll / B), mediana_max_roi_eval_nulo: r4(maxRoiEval[Math.floor(B / 2)]), p95_max_roi_eval_nulo: r4(maxRoiEval[Math.floor(0.95 * B)]), sims: B };
  // 6) Sesgo de selección: tasa de SUPERSEDED por books de creación (¿la poda favorece a las ≥2?)
  const allC = all.filter(p => p.family === 'CORNERS' && p.result_code !== 'PENDING');
  const sup = g => { const a = allC.filter(g); return { n: a.length, superseded: a.filter(p => p.result_code === 'SUPERSEDED').length, tasa: r4(a.filter(p => p.result_code === 'SUPERSEDED').length / a.length) }; };
  Bk.superseded_por_books_creacion = { ge2: sup(p => booksCreate(p) >= 2), b1: sup(p => booksCreate(p) < 2) };
  // 7) Cierre post-kickoff (contaminación in-play de las métricas "a cierre")
  Bk.closing_post_kickoff = { corners: C.filter(p => p.closing && p.closing.at && Date.parse(p.closing.at) > Date.parse(p.event.kickoff_at)).length };
  OUT.B_CORNERS_books = Bk;
})();

fs.writeFileSync(__dirname + '/skeptic.json', JSON.stringify(OUT, null, 1));
console.log(JSON.stringify(OUT, null, 1));
