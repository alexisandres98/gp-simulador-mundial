#!/usr/bin/env node
// ESCÉPTICO H3/H4 sobre el libro de picks de combate: ¿el hallazgo "LADO" (perro vs favorito) y el "techo cuota 3"
// sobreviven a un split temporal honesto (pre-techo = donde se eligió la regla / post-techo = fuera de muestra)?
// ¿Está confundido con la liga? ¿Cómo cambia el ROI con VOIDs, stakes reales y precio de cierre?
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/combat_picks_full.json';
const all = JSON.parse(fs.readFileSync(SRC, 'utf8')).picks;
const WL = (p) => p.result_code === 'WIN' || p.result_code === 'LOSS';
const F = all.filter(p => p.family === 'FIGHT' && WL(p)).sort((a, b) => a.created_at.localeCompare(b.created_at));
const y = (p) => (p.result_code === 'WIN' ? 1 : 0);
const m = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = (a) => { const mu = m(a); return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, a.length - 1)); };
const se = (a) => a.length > 1 ? sd(a) / Math.sqrt(a.length) : null;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const units = (p, odds) => (y(p) ? odds - 1 : -1);
const clvOf = (p) => (p.closing && p.closing.odds > 1) ? (p.best_odds / p.closing.odds - 1) * 100 : null;
const stat = (rows, label) => {
  if (!rows.length) return { label, n: 0 };
  const u = rows.map(p => units(p, p.best_odds)); const uc = rows.filter(p => p.closing && p.closing.odds > 1).map(p => units(p, p.closing.odds));
  const c = rows.map(clvOf).filter(x => x != null);
  const evPub = rows.map(p => p.market_prob * p.best_odds - 1); // EV a la cuota tomada si el MERCADO (al publicar) tiene razón
  const evClose = rows.filter(p => p.closing && p.closing.fair != null).map(p => p.closing.fair * p.best_odds - 1);
  let st = 0, pl = 0; for (const p of rows) { const s = p.stake_pct || 1; st += s; pl += s * units(p, p.best_odds); }
  return { label, n: rows.length, wins: rows.filter(y).length, hit_pct: +(100 * m(rows.map(y))).toFixed(1), roi_pct: +(100 * m(u)).toFixed(1), roi_se: +(100 * se(u)).toFixed(1), roi_close_pct: +(100 * m(uc)).toFixed(1), roi_stakeweighted_pct: +(100 * pl / st).toFixed(1), clv_mean: +m(c).toFixed(2), clv_se: c.length > 1 ? +se(c).toFixed(2) : null, clv_t: c.length > 1 ? +(m(c) / se(c)).toFixed(2) : null, ev_pub_if_market_right_pct: +(100 * m(evPub)).toFixed(1), ev_close_pct: +(100 * m(evClose)).toFixed(1), avg_odds: +m(rows.map(p => p.best_odds)).toFixed(2), model: +m(rows.map(p => p.model_prob)).toFixed(3), mkt: +m(rows.map(p => p.market_prob)).toFixed(3) };
};
const diff = (a, b, f, label) => { // diferencia de medias con bootstrap
  const xa = a.map(f).filter(x => x != null), xb = b.map(f).filter(x => x != null);
  const d = m(xa) - m(xb); const s = Math.sqrt(se(xa) ** 2 + se(xb) ** 2);
  const R = rng(99); let neg = 0; const B = 4000;
  for (let i = 0; i < B; i++) { let sa = 0, sb = 0; for (let j = 0; j < xa.length; j++) sa += xa[(R() * xa.length) | 0]; for (let j = 0; j < xb.length; j++) sb += xb[(R() * xb.length) | 0]; if (sa / xa.length - sb / xb.length <= 0) neg++; }
  return { label, na: xa.length, nb: xb.length, diff: +d.toFixed(2), se: +s.toFixed(2), t: +(d / s).toFixed(2), p_boot_diff_le_0: +(neg / B).toFixed(3) };
};
const out = {};
const CUT = '2026-08-02';
const pre = F.filter(p => p.created_at < CUT), post = F.filter(p => p.created_at >= CUT);
const dog = (p) => p.market_prob < 0.5, fav = (p) => p.market_prob >= 0.5;
out.n = { fight_WL: F.length, pre_techo: pre.length, post_techo: post.length, void: all.filter(p => p.family === 'FIGHT' && p.result_code === 'VOID').length, superseded: all.filter(p => p.family === 'FIGHT' && p.result_code === 'SUPERSEDED').length, pending: all.filter(p => p.family === 'FIGHT' && p.status === 'ACTIVE').length };
out.todo = { all: stat(F, 'todas'), dog: stat(F.filter(dog), 'perro'), fav: stat(F.filter(fav), 'favorito') };
out.pre_techo = { all: stat(pre, 'pre'), dog: stat(pre.filter(dog), 'perro'), fav: stat(pre.filter(fav), 'favorito') };
out.post_techo_OOS = { all: stat(post, 'post'), dog: stat(post.filter(dog), 'perro'), fav: stat(post.filter(fav), 'favorito') };
out.diff_fav_minus_dog = {
  todo_roi: diff(F.filter(fav), F.filter(dog), p => 100 * units(p, p.best_odds), 'ROI fav − perro (todo)'),
  todo_clv: diff(F.filter(fav), F.filter(dog), clvOf, 'CLV fav − perro (todo)'),
  post_roi: diff(post.filter(fav), post.filter(dog), p => 100 * units(p, p.best_odds), 'ROI fav − perro (post-techo OOS)'),
  post_clv: diff(post.filter(fav), post.filter(dog), clvOf, 'CLV fav − perro (post-techo OOS)'),
  pre_clv: diff(pre.filter(fav), pre.filter(dog), clvOf, 'CLV fav − perro (pre-techo)'),
};
// ¿el techo de cuota 3 se eligió sobre las mismas picks que lo "validan"? cuándo se crearon las 13 con cuota ≥3
const ge3 = F.filter(p => p.best_odds >= 3);
out.techo3 = { n_ge3: ge3.length, creadas_pre_techo: ge3.filter(p => p.created_at < CUT).length, creadas_post_techo: ge3.filter(p => p.created_at >= CUT).length, fechas: ge3.map(p => p.created_at.slice(0, 10) + ' ' + p.best_odds + ' ' + p.result_code) };
// confusión con la liga: perro/favorito por liga
out.lado_por_liga = {};
for (const lg of ['ufc', 'mma', 'boxing']) out.lado_por_liga[lg] = { dog: stat(F.filter(p => p.league === lg && dog(p)), lg + ' perro'), fav: stat(F.filter(p => p.league === lg && fav(p)), lg + ' favorito') };
// CLV perro vs favorito controlando liga (solo UFC)
out.diff_fav_minus_dog_ufc_clv = diff(F.filter(p => p.league === 'ufc' && fav(p)), F.filter(p => p.league === 'ufc' && dog(p)), clvOf, 'CLV fav − perro (solo UFC)');
// tramo de cuota fino dentro de <3
out.por_cuota = {};
for (const [a, b] of [[1, 1.5], [1.5, 2], [2, 2.5], [2.5, 3], [3, 99]]) out.por_cuota[`${a}-${b}`] = stat(F.filter(p => p.best_odds >= a && p.best_odds < b), `${a}-${b}`);
// H4: deriva — se alarga vs se acorta (verificación) y correlación
const H = F.filter(p => p.closing && p.closing.odds > 1);
const drift = H.map(p => Math.log(p.closing.odds / p.best_odds)); const win = H.map(y);
const corr = (xs, ys) => { const mx = m(xs), my = m(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const r = corr(drift, win);
out.h4 = { n: H.length, r_drift_win: +r.toFixed(3), t: +(r * Math.sqrt((H.length - 2) / (1 - r * r))).toFixed(2), alargan: stat(H.filter((p, i) => drift[i] > 0.02), 'se alargó >2%'), acortan: stat(H.filter((p, i) => drift[i] < -0.02), 'se acortó >2%'), planas: stat(H.filter((p, i) => Math.abs(drift[i]) <= 0.02), 'plana') };
// veto por deriva pre-publicación: diferencia real entre grupos
const drifted = (p) => p.opening && p.opening.at && Date.parse(p.opening.at) < Date.parse(p.created_at) - 60e3 && p.opening.odds < p.best_odds;
out.veto_deriva = { con: stat(F.filter(drifted), 'con deriva en contra'), sin: stat(F.filter(p => !drifted(p)), 'sin'), diff_roi: diff(F.filter(drifted), F.filter(p => !drifted(p)), p => 100 * units(p, p.best_odds), 'ROI con − sin deriva') };
// ¿edge_pp del libro = (model − market)·100? y CLV del libro = best/close − 1?
out.consistencia = { edge_ok: F.filter(p => Math.abs(p.edge_pp - (p.model_prob - p.market_prob) * 100) < 0.02).length, clv_ok: F.filter(p => p.clv_pct != null && Math.abs(p.clv_pct - clvOf(p)) < 0.02).length, blend_ok: F.filter(p => Math.abs(p.blend_prob - (p.model_prob + p.market_prob) / 2) < 0.002).length, n: F.length, best_shorter_than_fair: F.filter(p => 1 / p.best_odds > p.market_prob).length };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'sk2_book.json'), JSON.stringify(out, null, 1));
