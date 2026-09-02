#!/usr/bin/env node
/**
 * H3/H4 — análisis del libro de picks de combate (combat_picks_full.json).
 * H3: ROI a cuota tomada y al cierre de reglas alternativas (peso del mercado, veto por deriva pre-publicación,
 *     techo de cuota). Bootstrap de ROI (2000) + t.  H4: ¿tiene razón el mercado tardío? movimiento
 *     apertura→cierre vs resultado y vs antelación; Brier de modelo / mercado / blend / cierre.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BOOK = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/combat_picks_full.json';
const OUT = path.join(__dirname, 'h3_h4_result.json');
const all = JSON.parse(fs.readFileSync(BOOK, 'utf8')).picks;
const settled = all.filter(p => p.result_code === 'WIN' || p.result_code === 'LOSS');
const R = (() => { let a = 20260902; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

// ROI plano 1u por pick a la cuota `oddsOf(p)`; bootstrap IC95 + t
function roi(list, oddsOf) {
  const u = list.map(p => { const o = oddsOf(p); if (!(o > 1)) return null; return p.result_code === 'WIN' ? o - 1 : -1; }).filter(x => x != null);
  const n = u.length; if (!n) return { n: 0 };
  const m = mean(u), s = sd(u);
  const bs = []; for (let b = 0; b < 2000; b++) { let t = 0; for (let j = 0; j < n; j++) t += u[(R() * n) | 0]; bs.push(t / n); }
  bs.sort((a, b) => a - b);
  return { n, wins: list.filter(p => p.result_code === 'WIN').length, roi_pct: r2(m * 100), se_pct: s != null ? r2(s / Math.sqrt(n) * 100) : null, t: s ? r2(m / (s / Math.sqrt(n))) : null, ci95_pct: [r2(bs[50] * 100), r2(bs[1949] * 100)] };
}
const clvOf = (p) => (p.closing && p.closing.odds > 1 && p.best_odds > 1) ? (p.best_odds / p.closing.odds - 1) * 100 : null;
const clvAgg = (list) => { const c = list.map(clvOf).filter(x => x != null); const s = sd(c); return { n: c.length, clv_avg_pct: r2(mean(c)), se: s != null ? r2(s / Math.sqrt(c.length)) : null, t: s ? r2(mean(c) / (s / Math.sqrt(c.length))) : null, pct_negativo: c.length ? r2(100 * c.filter(x => x < 0).length / c.length) : null }; };
const takenOdds = (p) => p.best_odds, closeOdds = (p) => (p.closing || {}).odds;
const fairFromClose = (p) => (p.closing || {}).fair; // sin margen (mediana de-vig)

function evalRule(name, list) {
  return { rule: name, taken: roi(list, takenOdds), closing: roi(list, closeOdds), clv: clvAgg(list) };
}

const out = { n_settled_total: settled.length, families: {} };
const fams = {};
for (const p of settled) (fams[p.family] = fams[p.family] || []).push(p);
for (const [f, list] of Object.entries(fams)) out.families[f] = evalRule('actual', list);

// ---------------- H3: FIGHT ----------------
const FIGHT = fams.FIGHT || [];
const h3 = { n: FIGHT.length, rules: [] };
// Peso del mercado w: blend = (1−w)·m + w·k ; edge_blend = (blend−k)·100 = (1−w)(m−k)·100 ≥ 2  ⇔  m−k ≥ 2/(100(1−w))
// (todas las picks del libro ya cumplen la regla actual w=0.5 → m−k ≥ 4 pp; las reglas más duras son SUBCONJUNTOS)
const edge = (p) => (p.model_prob - p.market_prob) * 100;
const lineEdge = (p) => (p.best_odds * p.market_prob - 1) * 100; // mercado puro: la mejor cuota bate al consenso de-vig
for (const [w, thr] of [[0.5, 4], [0.8, 10], [0.9, 20]]) {
  const sub = FIGHT.filter(p => edge(p) >= thr);
  h3.rules.push(evalRule(`w_mercado=${w} (m−k ≥ ${thr}pp) · techo actual`, sub));
  h3.rules.push(evalRule(`w_mercado=${w} (m−k ≥ ${thr}pp) · cuota<3`, sub.filter(p => p.best_odds < 3)));
}
// mercado puro (w=1.0): el blend no genera edge; la única señal es la ventaja de precio entre casas
for (const thr of [0, 2, 4]) h3.rules.push(evalRule(`w_mercado=1.0: best_odds·k−1 ≥ ${thr}% (line-shopping)`, FIGHT.filter(p => lineEdge(p) >= thr)));
h3.rules.push(evalRule('control: TODAS las FIGHT', FIGHT));
// techo de cuota
for (const cap of [2.0, 2.5, 3.0, 99]) h3.rules.push(evalRule(`techo cuota < ${cap}`, FIGHT.filter(p => p.best_odds < cap)));
h3.rules.push(evalRule('cuota ≥ 3 (fuera del techo actual)', FIGHT.filter(p => p.best_odds >= 3)));
// favorito vs perro
h3.rules.push(evalRule('perros (k<0.5)', FIGHT.filter(p => p.market_prob < 0.5)));
h3.rules.push(evalRule('favoritos (k≥0.5)', FIGHT.filter(p => p.market_prob >= 0.5)));
h3.rules.push(evalRule('cuota<3 y favoritos', FIGHT.filter(p => p.best_odds < 3 && p.market_prob >= 0.5)));
// veto por deriva pre-publicación: opening.at < created_at y opening.odds < best_odds ⇒ la cuota se ALARGÓ antes
// de que compráramos (el mercado se movió hacia el rival). Alternativa: se acortó (mercado con nosotros).
const openEarlier = (p) => p.opening && p.opening.at && p.opening.at < p.created_at && p.opening.odds > 1;
const drifted = (p) => openEarlier(p) && p.opening.odds < p.best_odds;
const steamed = (p) => openEarlier(p) && p.opening.odds > p.best_odds;
h3.veto = {
  n_open_earlier: FIGHT.filter(openEarlier).length, n_drift_out: FIGHT.filter(drifted).length, n_steam_in: FIGHT.filter(steamed).length,
  drift_out: evalRule('deriva EN CONTRA antes de publicar (opening.odds < best_odds)', FIGHT.filter(drifted)),
  steam_in: evalRule('deriva A FAVOR antes de publicar (opening.odds > best_odds)', FIGHT.filter(steamed)),
  same: evalRule('sin señal (opening = publicación)', FIGHT.filter(p => !openEarlier(p) || p.opening.odds === p.best_odds)),
  con_veto: evalRule('regla actual + VETO deriva en contra', FIGHT.filter(p => !drifted(p))),
  con_veto_cap3: evalRule('cuota<3 + VETO deriva en contra', FIGHT.filter(p => !drifted(p) && p.best_odds < 3)),
};
// la misma pregunta con la señal CONTINUA que sí existe en todas las picks: k_creación vs fair de cierre
// por slot y liga
h3.slots = { main: evalRule('main', FIGHT.filter(p => p.card_slot === 'main')), prelim: evalRule('prelim', FIGHT.filter(p => p.card_slot !== 'main')) };
h3.leagues = Object.fromEntries(['ufc', 'mma', 'boxing'].map(l => [l, evalRule(l, FIGHT.filter(p => p.league === l))]));
h3.books = { multi: evalRule('books ≥ 5', FIGHT.filter(p => (p.books || 0) >= 5)), thin: evalRule('books ≤ 2', FIGHT.filter(p => (p.books || 0) <= 2)) };
out.h3 = h3;

// ---------------- H4: ¿tiene razón el mercado tardío? ----------------
const h4 = {};
const withClose = FIGHT.filter(p => p.closing && p.closing.fair != null);
const y = (p) => (p.result_code === 'WIN' ? 1 : 0);
const brier = (list, f) => r3(mean(list.map(p => (f(p) - y(p)) ** 2)));
const logloss = (list, f) => r3(mean(list.map(p => { const q = Math.min(0.999, Math.max(0.001, f(p))); return -(y(p) * Math.log(q) + (1 - y(p)) * Math.log(1 - q)); })));
h4.brier_on_pick_side = {
  n: withClose.length,
  modelo: brier(withClose, p => p.model_prob), mercado_creacion: brier(withClose, p => p.market_prob), blend_50: brier(withClose, p => p.blend_prob),
  cierre_fair: brier(withClose, p => p.closing.fair), implicita_cuota_tomada: brier(withClose, p => 1 / p.best_odds),
  logloss: { modelo: logloss(withClose, p => p.model_prob), mercado_creacion: logloss(withClose, p => p.market_prob), cierre_fair: logloss(withClose, p => p.closing.fair) },
  hit_real_pct: r2(100 * mean(withClose.map(y))), prob_media_modelo: r3(mean(withClose.map(p => p.model_prob))), prob_media_mercado: r3(mean(withClose.map(p => p.market_prob))), prob_media_cierre: r3(mean(withClose.map(p => p.closing.fair))),
};
// movimiento creación→cierre en prob (pp) y correlación con el resultado
const mv = (p) => (p.closing.fair - p.market_prob) * 100;
const corr = (xs, ys) => { const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; };
const mvs = withClose.map(mv), ys = withClose.map(y);
const rho = corr(mvs, ys);
h4.movimiento_vs_resultado = {
  n: withClose.length, mov_medio_pp: r2(mean(mvs)), pct_en_contra: r2(100 * mvs.filter(x => x < 0).length / mvs.length),
  corr_mov_resultado: r3(rho), t_corr: rho != null ? r2(rho * Math.sqrt((mvs.length - 2) / (1 - rho * rho))) : null,
  hit_si_mercado_se_movio_a_favor: (() => { const s = withClose.filter(p => mv(p) > 0); return { n: s.length, hit_pct: r2(100 * mean(s.map(y))), roi_pct: roi(s, takenOdds).roi_pct }; })(),
  hit_si_mercado_se_movio_en_contra: (() => { const s = withClose.filter(p => mv(p) < 0); return { n: s.length, hit_pct: r2(100 * mean(s.map(y))), roi_pct: roi(s, takenOdds).roi_pct }; })(),
  hit_si_mov_en_contra_mayor_3pp: (() => { const s = withClose.filter(p => mv(p) < -3); return { n: s.length, hit_pct: r2(100 * mean(s.map(y))), roi_pct: roi(s, takenOdds).roi_pct }; })(),
  hit_si_mov_a_favor_mayor_3pp: (() => { const s = withClose.filter(p => mv(p) > 3); return { n: s.length, hit_pct: r2(100 * mean(s.map(y))), roi_pct: roi(s, takenOdds).roi_pct }; })(),
};
// ¿la deriva depende de la ANTELACIÓN? (días entre publicación y KO)
const lead = (p) => (Date.parse(p.event.kickoff_at) - Date.parse(p.created_at)) / 864e5;
const leads = withClose.map(lead);
h4.antelacion = {
  lead_medio_dias: r2(mean(leads)), corr_lead_mov: r3(corr(leads, mvs)), corr_lead_clv: r3(corr(leads, withClose.map(clvOf))),
  by_bucket: Object.fromEntries([[0, 2], [2, 5], [5, 99]].map(([lo, hi]) => { const s = withClose.filter(p => lead(p) >= lo && lead(p) < hi); return [`${lo}-${hi}d`, { n: s.length, mov_medio_pp: r2(mean(s.map(mv))), clv_avg: clvAgg(s).clv_avg_pct, hit_pct: r2(100 * mean(s.map(y))), roi_pct: roi(s, takenOdds).roi_pct }]; })),
};
// ¿el desacuerdo modelo-mercado predice la deriva en contra? (si el mercado corrige hacia el modelo, mov>0)
const eds = withClose.map(edge);
h4.edge_vs_movimiento = { corr_edge_mov: r3(corr(eds, mvs)), corr_edge_resultado: r3(corr(eds, ys)), by_edge: Object.fromEntries([[4, 8], [8, 15], [15, 99]].map(([lo, hi]) => { const s = withClose.filter(p => edge(p) >= lo && edge(p) < hi); return [`${lo}-${hi}pp`, { n: s.length, hit_pct: r2(100 * mean(s.map(y))), mov_medio_pp: r2(mean(s.map(mv))), clv_avg: clvAgg(s).clv_avg_pct, roi_pct: roi(s, takenOdds).roi_pct }]; })) };
// mismo test para ROUNDS y METHOD (cierre = Cloudbet, 1 casa)
for (const fam of ['ROUNDS', 'METHOD']) {
  const L = (fams[fam] || []).filter(p => p.closing && p.closing.fair != null);
  const m2 = L.map(p => (p.closing.fair - p.market_prob) * 100), y2 = L.map(y);
  h4[fam.toLowerCase()] = { n: L.length, brier_modelo: brier(L, p => p.model_prob), brier_mercado: brier(L, p => p.market_prob), brier_blend: brier(L, p => p.blend_prob), brier_cierre: brier(L, p => p.closing.fair), mov_medio_pp: r2(mean(m2)), corr_mov_resultado: r3(corr(m2, y2)), hit_pct: r2(100 * mean(y2)), prob_media_modelo: r3(mean(L.map(p => p.model_prob))), prob_media_mercado: r3(mean(L.map(p => p.market_prob))) };
}
// calibración cruda del modelo en el libro: tramos de model_prob
h4.calibracion_modelo_libro = Object.fromEntries([[0, 0.45], [0.45, 0.6], [0.6, 1.01]].map(([lo, hi]) => { const s = FIGHT.filter(p => p.model_prob >= lo && p.model_prob < hi); return [`${lo}-${hi}`, { n: s.length, p_modelo: r3(mean(s.map(p => p.model_prob))), p_mercado: r3(mean(s.map(p => p.market_prob))), real: r3(mean(s.map(y))) }]; }));
out.h4 = h4;

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
