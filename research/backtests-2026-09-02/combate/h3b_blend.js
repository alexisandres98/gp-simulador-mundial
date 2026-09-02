// H3b — peso del mercado por Brier en el libro (split temporal: se elige w en la 1ª mitad, se evalúa en la 2ª) +
// era post-techo (picks creadas desde el 2-ago, cuando entró COMBAT_MAX_ODDS=3) + winner's curse.
'use strict';
const fs = require('fs');
const all = JSON.parse(fs.readFileSync('/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/combat_picks_full.json', 'utf8')).picks;
const F = all.filter(p => p.family === 'FIGHT' && (p.result_code === 'WIN' || p.result_code === 'LOSS')).sort((a, b) => a.created_at.localeCompare(b.created_at));
const y = (p) => (p.result_code === 'WIN' ? 1 : 0);
const brierW = (list, w) => list.reduce((s, p) => s + (((1 - w) * p.model_prob + w * p.market_prob) - y(p)) ** 2, 0) / list.length;
const out = {};
const half = Math.floor(F.length / 2); const A = F.slice(0, half), B = F.slice(half);
const grid = [0, 0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
out.brier_por_w = { n: F.length, todo: Object.fromEntries(grid.map(w => [w, +brierW(F, w).toFixed(4)])), primera_mitad: Object.fromEntries(grid.map(w => [w, +brierW(A, w).toFixed(4)])), segunda_mitad: Object.fromEntries(grid.map(w => [w, +brierW(B, w).toFixed(4)])) };
const wStar = grid.reduce((b, w) => (brierW(A, w) < brierW(A, b) ? w : b), grid[0]);
out.w_elegido_en_1a_mitad = wStar; out.brier_2a_mitad_con_w_elegido = +brierW(B, wStar).toFixed(4); out.brier_2a_mitad_con_w05 = +brierW(B, 0.5).toFixed(4); out.brier_2a_mitad_mercado = +brierW(B, 1).toFixed(4);
// winner's curse: sobreconfianza del modelo EN SUS PICKS (media modelo − real) vs mercado
const m = (a) => a.reduce((s, x) => s + x, 0) / a.length;
out.winners_curse = { n: F.length, p_modelo: +m(F.map(p => p.model_prob)).toFixed(3), p_mercado: +m(F.map(p => p.market_prob)).toFixed(3), real: +m(F.map(y)).toFixed(3), sobreconfianza_modelo_pp: +((m(F.map(p => p.model_prob)) - m(F.map(y))) * 100).toFixed(1), sobreconfianza_mercado_pp: +((m(F.map(p => p.market_prob)) - m(F.map(y))) * 100).toFixed(1) };
// era post-techo
const post = F.filter(p => p.created_at >= '2026-08-02');
const roi = (list) => { const u = list.map(p => (y(p) ? p.best_odds - 1 : -1)); const n = u.length; const mu = m(u); const sd = Math.sqrt(u.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)); return { n, wins: list.filter(y).length, roi_pct: +(mu * 100).toFixed(1), se_pct: +(sd / Math.sqrt(n) * 100).toFixed(1) }; };
const clv = (list) => { const c = list.filter(p => p.closing && p.closing.odds > 1).map(p => (p.best_odds / p.closing.odds - 1) * 100); return { n: c.length, clv_avg: +m(c).toFixed(2), pct_neg: +(100 * c.filter(x => x < 0).length / c.length).toFixed(1) }; };
out.post_techo_2ago = { roi: roi(post), clv: clv(post), perros: { roi: roi(post.filter(p => p.market_prob < 0.5)), clv: clv(post.filter(p => p.market_prob < 0.5)) }, favoritos: { roi: roi(post.filter(p => p.market_prob >= 0.5)), clv: clv(post.filter(p => p.market_prob >= 0.5)) } };
out.pre_techo = { roi: roi(F.filter(p => p.created_at < '2026-08-02')), clv: clv(F.filter(p => p.created_at < '2026-08-02')) };
// distribución de edge_pp del libro (para dimensionar los umbrales)
const ed = F.map(p => (p.model_prob - p.market_prob) * 100).sort((a, b) => a - b);
out.edge_pp_distribucion = { min: +ed[0].toFixed(1), q25: +ed[Math.floor(ed.length * .25)].toFixed(1), mediana: +ed[Math.floor(ed.length * .5)].toFixed(1), q75: +ed[Math.floor(ed.length * .75)].toFixed(1), max: +ed[ed.length - 1].toFixed(1) };
fs.writeFileSync(__dirname + '/h3b_result.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
