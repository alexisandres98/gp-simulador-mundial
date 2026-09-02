// skeptic2.js — comprobaciones adicionales: concentración Liga MX, picks cuyo books llegó a 2 solo en el refresco,
// composición del grupo 1 casa, bootstrap por clúster liga×semana, leave-one-competition-out en copas.
'use strict';
const fs = require('fs');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/clubs_picks_full.json';
const all = JSON.parse(fs.readFileSync(SRC, 'utf8')).picks;
const dec = all.filter(p => p.result_code === 'WIN' || p.result_code === 'LOSS');
const byT = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const se = a => sd(a) / Math.sqrt(a.length);
const r3 = x => isFinite(x) ? +x.toFixed(3) : null, r4 = x => isFinite(x) ? +x.toFixed(4) : null;
const win = p => p.result_code === 'WIN' ? 1 : 0;
const pnl = p => win(p) ? p.best_odds - 1 : -1;
const booksCreate = p => { const m = /consenso de (\d+) casas/.exec(p.why_es || ''); return m ? Number(m[1]) : (p.books || 0); };
const M = a => a.length ? ({ n: a.length, hit: r4(mean(a.map(win))), roi: r4(mean(a.map(pnl))), se: r4(se(a.map(pnl))), t: r3(mean(a.map(pnl)) / se(a.map(pnl))), pnl_u: r3(a.reduce((s, p) => s + pnl(p), 0)), p_mkt: r4(mean(a.map(p => p.market_prob))), obs_menos_mkt_pp: r4(100 * mean(a.map(p => win(p) - p.market_prob))), t_obs_mkt: r3(mean(a.map(p => win(p) - p.market_prob)) / se(a.map(p => win(p) - p.market_prob))), odds: r4(mean(a.map(p => p.best_odds))) }) : { n: 0 };
let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const wk = p => { const d = new Date(p.created_at); const on = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return 'w' + String(Math.ceil(((d - on) / 86400e3 + on.getUTCDay() + 1) / 7)).padStart(2, '0'); };
const cnt = (a, f) => { const c = {}; for (const p of a) { const k = f(p); c[k] = (c[k] || 0) + 1; } return c; };
// bootstrap por clúster: remuestrea clústeres con reemplazo; devuelve SE e IC del ROI
function clusterBoot(arr, keyFn, B = 3000) {
  const g = {}; for (const p of arr) (g[keyFn(p)] = g[keyFn(p)] || []).push(p); const cl = Object.values(g); const vals = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (let i = 0; i < cl.length; i++) { const c = cl[Math.floor(rnd() * cl.length)]; for (const p of c) { s += pnl(p); n++; } } vals.push(s / n); }
  vals.sort((a, b) => a - b); return { n_clusters: cl.length, se_cluster: r4(sd(vals)), ci95: [r4(vals[Math.floor(0.025 * B)]), r4(vals[Math.floor(0.975 * B)])], t_cluster: r3(mean(arr.map(pnl)) / sd(vals)) };
}
const OUT = {};
// ─── CORNERS ───
const C = dec.filter(p => p.family === 'CORNERS' && p.model_prob > 0 && p.market_prob > 0 && p.line != null).sort(byT);
const G2 = C.filter(p => (p.books || 0) >= 2), B1 = C.filter(p => (p.books || 0) < 2);
OUT.corners = {};
OUT.corners.ligamx_ge2 = { resumen: M(G2.filter(p => p.league === 'ligamx')), side: cnt(G2.filter(p => p.league === 'ligamx'), p => p.side), semana: cnt(G2.filter(p => p.league === 'ligamx'), wk), casa: cnt(G2.filter(p => p.league === 'ligamx'), p => p.best_book), lineas: cnt(G2.filter(p => p.league === 'ligamx'), p => p.line) };
OUT.corners.ge2_sin_ligamx = M(G2.filter(p => p.league !== 'ligamx'));
OUT.corners.ge2_sin_ligamx_eval60 = (() => { const k = Math.floor(C.length * 0.6); return M(C.slice(k).filter(p => (p.books || 0) >= 2 && p.league !== 'ligamx')); })();
OUT.corners.ge2_sin_ligamx_eval50 = (() => { const k = Math.floor(C.length * 0.5); return M(C.slice(k).filter(p => (p.books || 0) >= 2 && p.league !== 'ligamx')); })();
// ligamx en el grupo 1 casa (¿es Liga MX o es ≥2 casas?)
OUT.corners.ligamx_books1 = M(B1.filter(p => p.league === 'ligamx'));
OUT.corners.ligamx_all_corners = M(C.filter(p => p.league === 'ligamx'));
// picks que llegaron a ≥2 solo en el refresco (creación 1 → refresco ≥2)
OUT.corners.creacion1_refresco_ge2 = M(C.filter(p => booksCreate(p) < 2 && (p.books || 0) >= 2));
OUT.corners.creacion_ge2_refresco_ge2 = M(C.filter(p => booksCreate(p) >= 2 && (p.books || 0) >= 2));
// composición del grupo de comparación (1 casa)
OUT.corners.books1_por_casa_lado = cnt(B1, p => p.best_book + '|' + p.side);
OUT.corners.leovegas_unders_1casa = M(B1.filter(p => p.best_book === 'leovegas' && p.side === 'under'));
OUT.corners.books1_sin_leovegas = M(B1.filter(p => p.best_book !== 'leovegas'));
// ¿varios picks decididos por evento? (correlación intra-partido)
const evCnt = cnt(G2, p => p.event.canonical_event_id); OUT.corners.ge2_eventos_con_mas_de_1_pick = Object.values(evCnt).filter(n => n > 1).length;
// bootstrap por clúster liga×semana y por liga
OUT.corners.ge2_boot_cluster_liga_semana = clusterBoot(G2, p => p.league + '|' + wk(p));
OUT.corners.ge2_boot_cluster_liga = clusterBoot(G2, p => p.league);
OUT.corners.ge2_boot_cluster_fecha_kickoff = clusterBoot(G2, p => p.event.kickoff_at.slice(0, 10));
OUT.corners.ge2_boot_iid = clusterBoot(G2, p => p.pick_id);
const k60 = Math.floor(C.length * 0.6); const ev60 = C.slice(k60).filter(p => (p.books || 0) >= 2);
OUT.corners.ge2_eval60_boot_cluster_liga_semana = clusterBoot(ev60, p => p.league + '|' + wk(p));
OUT.corners.ge2_eval60_boot_cluster_fecha = clusterBoot(ev60, p => p.event.kickoff_at.slice(0, 10));
// distribución por fecha de kickoff del grupo ≥2 (¿pocos días concentran el P&L?)
const byDay = {}; for (const p of G2) (byDay[p.event.kickoff_at.slice(0, 10)] = byDay[p.event.kickoff_at.slice(0, 10)] || []).push(p);
const days = Object.entries(byDay).map(([d, a]) => ({ d, n: a.length, pnl: r3(a.reduce((s, p) => s + pnl(p), 0)) })).sort((a, b) => b.pnl - a.pnl);
OUT.corners.ge2_top5_dias_pnl = days.slice(0, 5); OUT.corners.ge2_n_dias = days.length; OUT.corners.ge2_pnl_total = r3(G2.reduce((s, p) => s + pnl(p), 0));
OUT.corners.ge2_sin_top3_dias = (() => { const top = new Set(days.slice(0, 3).map(x => x.d)); return M(G2.filter(p => !top.has(p.event.kickoff_at.slice(0, 10)))); })();
// market_prob: ¿de qué es de-vig? ratio 1/best_odds vs market_prob por books
OUT.corners.margen_implicito = { ge2: r4(mean(G2.map(p => 1 / p.best_odds - p.market_prob)) * 100), b1: r4(mean(B1.map(p => 1 / p.best_odds - p.market_prob)) * 100), nota: 'pp de diferencia entre la implícita de la mejor cuota y market_prob (≈ margen que carga la mejor cuota frente al consenso sin margen)' };
// ─── SOLID copas: leave-one-competition-out y nulo sobre obs−mkt ───
const S = dec.filter(p => p.family === 'SOLID' && p.model_prob > 0 && p.market_prob > 0).sort(byT);
const CUP_LEAGUES = new Set(['libertadores', 'sudamericana', 'leaguescup', 'eflcup', 'facup', 'dfbpokal', 'copadelrey', 'coppaitalia', 'coupefrance', 'uclq', 'champions', 'europa', 'uefa']);
const isCup = p => CUP_LEAGUES.has(p.league); const cups = S.filter(isCup), non = S.filter(p => !isCup(p));
OUT.solid = {};
OUT.solid.copas_loo = Object.fromEntries([...new Set(cups.map(p => p.league))].map(l => { const rest = cups.filter(p => p.league !== l); return [l, { n_quitado: cups.length - rest.length, roi_sin: r4(mean(rest.map(pnl))), se_sin: r4(se(rest.map(pnl))), t_sin: r3(mean(rest.map(pnl)) / se(rest.map(pnl))), obs_menos_mkt_sin_pp: r4(100 * mean(rest.map(p => win(p) - p.market_prob))) }]; }));
// bootstrap por clúster (fecha de kickoff: las copas se crean en lotes) del ROI de copas y de la diferencia copas−no copas
OUT.solid.copas_boot_cluster_fecha = clusterBoot(cups, p => p.event.kickoff_at.slice(0, 10));
OUT.solid.copas_boot_iid = clusterBoot(cups, p => p.pick_id);
// nulo de mercado sobre obs−mkt de copas vs no copas (la SE del ROI con longshots es poco fiable): permutación de la etiqueta copa
(function () { const B = 4000; const d0 = mean(cups.map(p => win(p) - p.market_prob)) - mean(non.map(p => win(p) - p.market_prob)); let ge = 0; const r0 = mean(cups.map(pnl)) - mean(non.map(pnl)); let geR = 0;
  for (let b = 0; b < B; b++) { const idx = S.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } const cs = idx.slice(0, cups.length).map(i => S[i]), ns = idx.slice(cups.length).map(i => S[i]);
    if (mean(cs.map(p => win(p) - p.market_prob)) - mean(ns.map(p => win(p) - p.market_prob)) <= d0) ge++; if (mean(cs.map(pnl)) - mean(ns.map(pnl)) <= r0) geR++; }
  OUT.solid.permutacion_etiqueta_copa = { diff_obs_menos_mkt_pp: r4(100 * d0), p_valor_perm: r4(ge / B), diff_roi: r4(r0), p_valor_perm_roi: r4(geR / B), sims: B, nota: 'Permuta la etiqueta copa/no copa entre las 432 SOLID; p = P(diferencia ≤ observada) bajo independencia.' };
})();
// misma permutación pero estratificada por bucket de cuota (controla el confusor cuota)
(function () { const ob = p => p.best_odds <= 2.5 ? 0 : p.best_odds <= 3.2 ? 1 : p.best_odds <= 5 ? 2 : 3; const B = 4000; const d0 = mean(cups.map(p => win(p) - p.market_prob)) - mean(non.map(p => win(p) - p.market_prob)); const r0 = mean(cups.map(pnl)) - mean(non.map(pnl)); let ge = 0, geR = 0;
  const strata = [0, 1, 2, 3].map(k => S.filter(p => ob(p) === k)); const nCup = strata.map(s => s.filter(isCup).length);
  for (let b = 0; b < B; b++) { const cs = [], ns = []; strata.forEach((s, k) => { const idx = s.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } idx.forEach((i, pos) => (pos < nCup[k] ? cs : ns).push(s[i])); });
    if (mean(cs.map(p => win(p) - p.market_prob)) - mean(ns.map(p => win(p) - p.market_prob)) <= d0) ge++; if (mean(cs.map(pnl)) - mean(ns.map(pnl)) <= r0) geR++; }
  OUT.solid.permutacion_estratificada_cuota = { p_valor_perm_obs_menos_mkt: r4(ge / B), p_valor_perm_roi: r4(geR / B), sims: B };
})();
fs.writeFileSync(__dirname + '/skeptic2.json', JSON.stringify(OUT, null, 1));
console.log(JSON.stringify(OUT, null, 1));
