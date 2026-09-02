// filters2.js — (1) SOLID: test de "observado − mercado" por régimen/tramo, c por régimen, supervivencia (SUPERSEDED vs decididas);
// (2) GOALS y CORNERS: filtros de regla declarados en el tramo de ajuste (60 %) y evaluados en el 40 % (y 50/50).
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
const logit = p => Math.log(p / (1 - p)), sig = x => 1 / (1 + Math.exp(-x)), cl = p => Math.min(0.999, Math.max(0.001, p));
const M = a => ({ n: a.length, hit: r4(mean(a.map(win))), roi: r4(mean(a.map(pnl))), roi_se: r4(sd(a.map(pnl)) / Math.sqrt(a.length)), roi_close: r4(mean(a.filter(p => p.closing && p.closing.odds > 1).map(p => win(p) ? p.closing.odds - 1 : -1))), clv: r4(mean(a.filter(p => typeof p.clv === 'number').map(p => p.clv))), p_model: r4(mean(a.map(p => p.model_prob))), p_mkt: r4(mean(a.map(p => p.market_prob))), odds: r4(mean(a.map(p => p.best_odds))) });
// test observado − mercado (calibración del mercado sobre los lados elegidos)
const gapTest = a => { const d = a.map(p => win(p) - p.market_prob); const dc = a.filter(p => p.closing && p.closing.fair_prob).map(p => win(p) - p.closing.fair_prob); const dm = a.map(p => win(p) - p.model_prob); return { n: a.length, obs_menos_mercado_pp: r4(mean(d) * 100), se_pp: r4(sd(d) / Math.sqrt(d.length) * 100), t: r4(mean(d) / (sd(d) / Math.sqrt(d.length))), obs_menos_cierre_pp: r4(mean(dc) * 100), t_cierre: r4(mean(dc) / (sd(dc) / Math.sqrt(dc.length))), obs_menos_modelo_pp: r4(mean(dm) * 100), t_modelo: r4(mean(dm) / (sd(dm) / Math.sqrt(dm.length))) }; };
function fitC(picks) { const rows = picks.map(p => ({ y: win(p), lk: logit(cl(p.market_prob)), d: logit(cl(p.model_prob)) - logit(cl(p.market_prob)) })); const ll = c => rows.reduce((s, r) => { const q = cl(sig(r.lk + c * r.d)); return s + (r.y ? Math.log(q) : Math.log(1 - q)); }, 0); let best = { c: 0, ll: -Infinity }; for (let c = -3; c <= 3.0001; c += 0.01) { const v = ll(c); if (v > best.ll) best = { c: +c.toFixed(2), ll: v }; } const h = 0.05, curv = (ll(best.c + h) - 2 * ll(best.c) + ll(best.c - h)) / (h * h); return { c: best.c, se: r4(Math.sqrt(-1 / curv)), n: rows.length, ll_c: r4(best.ll), ll_c0: r4(ll(0)), ll_c1: r4(ll(1)) }; }
const out = {};
// ── SOLID ──
const S = dec.filter(p => p.family === 'SOLID').sort(byT);
const k60 = Math.floor(S.length * 0.6);
out.SOLID_gap = { all: gapTest(S), fit60: gapTest(S.slice(0, k60)), eval40: gapTest(S.slice(k60)), lead: gapTest(S.filter(p => p.regime === 'lead')), anchor: gapTest(S.filter(p => p.regime === 'anchor')), lead_eval40: gapTest(S.slice(k60).filter(p => p.regime === 'lead')), home: gapTest(S.filter(p => p.selection_code === 'home')), away: gapTest(S.filter(p => p.selection_code === 'away')) };
out.SOLID_c_por_regimen = { lead_all: fitC(S.filter(p => p.regime === 'lead')), lead_fit60: fitC(S.slice(0, k60).filter(p => p.regime === 'lead')), lead_eval40: fitC(S.slice(k60).filter(p => p.regime === 'lead')), anchor_all: fitC(S.filter(p => p.regime === 'anchor')), delta_neg_all: fitC(S.filter(p => p.model_prob < p.market_prob)), delta_pos_all: fitC(S.filter(p => p.model_prob >= p.market_prob)) };
// anchor/lever: apostar contra el favorito (lay a precio justo) cuando el modelo está por debajo del mercado
const neg = S.filter(p => p.model_prob < p.market_prob);
const lay = (a, mg) => { const v = a.map(p => { const o = (1 / (1 - p.market_prob)) * (1 - mg); return win(p) ? -1 : o - 1; }); return { n: v.length, roi: r4(mean(v)), se: r4(sd(v) / Math.sqrt(v.length)) }; };
out.SOLID_modelo_bajo_mercado = { apostar_pick: M(neg), lay_justo_margen_0: lay(neg, 0), lay_justo_margen_5: lay(neg, 0.05), fit60: { n: S.slice(0, k60).filter(p => p.model_prob < p.market_prob).length, pick: M(S.slice(0, k60).filter(p => p.model_prob < p.market_prob)), lay0: lay(S.slice(0, k60).filter(p => p.model_prob < p.market_prob), 0) }, eval40: { n: S.slice(k60).filter(p => p.model_prob < p.market_prob).length, pick: M(S.slice(k60).filter(p => p.model_prob < p.market_prob)), lay0: lay(S.slice(k60).filter(p => p.model_prob < p.market_prob), 0) } };
// supervivencia: SUPERSEDED vs decididas
const SS = all.filter(p => p.family === 'SOLID' && p.result_code === 'SUPERSEDED');
const desc = a => ({ n: a.length, delta_pp: r4(mean(a.map(p => (p.model_prob - p.market_prob) * 100))), odds: r4(mean(a.map(p => p.best_odds))), p_mkt: r4(mean(a.map(p => p.market_prob))), antelacion_h: r4(mean(a.map(p => (Date.parse(p.event.kickoff_at) - Date.parse(p.created_at)) / 3600e3))), regimes: a.reduce((c, p) => { c[p.regime] = (c[p.regime] || 0) + 1; return c; }, {}), bands: a.reduce((c, p) => { c[p.league_band] = (c[p.league_band] || 0) + 1; return c; }, {}) });
const sdecEv = new Set(S.map(p => p.event.canonical_event_id));
out.SOLID_supervivencia = { superseded: desc(SS), decididas: desc(S), superseded_sin_reemplazo: SS.filter(p => !sdecEv.has(p.event.canonical_event_id)).length, superseded_con_pick_decidida_en_el_evento: SS.filter(p => sdecEv.has(p.event.canonical_event_id)).length, horas_vividas_superseded: r4(mean(SS.map(p => (Date.parse(p.settled_at) - Date.parse(p.created_at)) / 3600e3))), nota: 'Las SUPERSEDED no tienen resultado ni cierre en el libro: la muestra decidida está seleccionada por "el mercado NO se acercó al modelo antes del kickoff" (la regla lead re-evalúa y poda cuando el edge post-blend cae <2pp).' };
// ── GOALS filtros ──
function evalFilters(fam, FILTERS, split) {
  const F = dec.filter(p => p.family === fam && p.model_prob > 0 && p.market_prob > 0).sort(byT);
  const k = Math.floor(F.length * split); const fit = F.slice(0, k), ev = F.slice(k);
  const base = { fit: M(fit), eval: M(ev) };
  const res = {};
  for (const [name, f] of Object.entries(FILTERS)) {
    const mf = M(fit.filter(f)), me = M(ev.filter(f));
    res[name] = { fit: mf, declarado: mf.n >= 25 && mf.roi > base.fit.roi + 0.02, eval: me, eval_delta_roi: r4(me.roi - base.eval.roi), complemento_eval: M(ev.filter(p => !f(p))) };
  }
  return { n: F.length, n_fit: fit.length, n_eval: ev.length, cut_at: ev[0] && ev[0].created_at, base, filtros: res };
}
const leadH = p => (Date.parse(p.event.kickoff_at) - Date.parse(p.created_at)) / 3600e3;
const GF = {
  precio_sobre_justo: p => p.best_odds * p.market_prob > 1,
  precio_sobre_justo_2pct: p => p.best_odds * p.market_prob > 1.02,
  antelacion_lt_48h: p => leadH(p) < 48,
  antelacion_ge_48h: p => leadH(p) >= 48,
  lado_over: p => p.side === 'over', lado_under: p => p.side === 'under',
  linea_2_5: p => p.line === 2.5,
  books_ge_10: p => (p.books || 0) >= 10,
  regime_anchor: p => p.regime === 'anchor', regime_monitor: p => p.regime === 'monitor',
  edge_modelo_ge_3pp: p => (p.model_prob - p.market_prob) >= 0.03,
  modelo_confirma: p => p.model_prob >= p.market_prob,
  band_eficiente: p => p.league_band === 'eficiente',
};
out.GOALS_filtros_60 = evalFilters('GOALS', GF, 0.6); out.GOALS_filtros_50 = evalFilters('GOALS', GF, 0.5);
const CF = {
  books_ge_2: p => (p.books || 0) >= 2, books_1: p => (p.books || 0) === 1,
  lado_over: p => p.side === 'over', lado_under: p => p.side === 'under',
  under_books_ge_2: p => p.side === 'under' && (p.books || 0) >= 2,
  precio_sobre_justo: p => p.best_odds * p.market_prob > 1,
  edge_ge_6pp: p => (p.model_prob - p.market_prob) >= 0.06,
  edge_ge_10pp: p => (p.model_prob - p.market_prob) >= 0.10,
  odds_ge_1_6: p => p.best_odds >= 1.6,
  antelacion_lt_24h: p => leadH(p) < 24,
  band_eficiente: p => p.league_band === 'eficiente', band_no_eficiente: p => p.league_band !== 'eficiente',
  gate_approved: p => p.gate_status === 'approved',
  regime_anchor: p => p.regime === 'anchor', regime_edge: p => p.regime === 'edge',
  linea_alta_ge_11_5: p => p.line >= 11.5, linea_baja_le_9_5: p => p.line <= 9.5,
  book_pinnacle_o_matchbook: p => /pinnacle|matchbook|betfair/i.test(p.best_book || ''),
};
out.CORNERS_filtros_60 = evalFilters('CORNERS', CF, 0.6); out.CORNERS_filtros_50 = evalFilters('CORNERS', CF, 0.5);
// CORNERS: qué casa pone la "mejor" cuota (única casa en el 65 % de los casos)
const C = dec.filter(p => p.family === 'CORNERS');
const byBook = {}; for (const p of C) (byBook[p.best_book] = byBook[p.best_book] || []).push(p);
out.CORNERS_por_casa = Object.fromEntries(Object.entries(byBook).filter(([, a]) => a.length >= 15).map(([k, a]) => [k, M(a)]));
// CORNERS: calibración del modelo por bucket de model_prob (all) — ¿sobreconfianza en under?
const bk = p => p.model_prob < 0.6 ? 'a_<60' : p.model_prob < 0.7 ? 'b_60-70' : p.model_prob < 0.8 ? 'c_70-80' : 'd_>=80';
const g = {}; for (const p of C) (g[bk(p)] = g[bk(p)] || []).push(p);
out.CORNERS_calib_modelo = Object.fromEntries(Object.entries(g).sort().map(([k, a]) => [k, { n: a.length, p_model: r4(mean(a.map(p => p.model_prob))), p_mkt: r4(mean(a.map(p => p.market_prob))), obs: r4(mean(a.map(win))), roi: r4(mean(a.map(pnl))) }]));
out.CORNERS_gap = { all: gapTest(C), under: gapTest(C.filter(p => p.side === 'under')), over: gapTest(C.filter(p => p.side === 'over')), books1: gapTest(C.filter(p => p.books === 1)), books2: gapTest(C.filter(p => p.books >= 2)) };
const G = dec.filter(p => p.family === 'GOALS');
out.GOALS_gap = { all: gapTest(G), anchor: gapTest(G.filter(p => p.regime === 'anchor')), monitor: gapTest(G.filter(p => p.regime === 'monitor')) };
fs.writeFileSync(__dirname + '/filters2.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
