#!/usr/bin/env node
/**
 * H3/H4 — Libro de picks de combate (combat_picks_full.json): reglas de publicación y qué sabe el mercado.
 * Todo es DESCRIPTIVO sobre las picks ya publicadas (n chico): solo se pueden evaluar reglas MÁS estrictas
 * que la actual (subconjuntos), nunca reglas que hubieran publicado picks que no existen.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/combat_picks_full.json';
const all = JSON.parse(fs.readFileSync(SRC, 'utf8')).picks;
const settled = all.filter(p => p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS'));
const F = settled.filter(p => p.family === 'FIGHT');
const R = settled.filter(p => p.family === 'ROUNDS');
const M = settled.filter(p => p.family === 'METHOD');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const win = (p) => p.result_code === 'WIN' ? 1 : 0;
const unitsAt = (p, odds) => (win(p) ? odds - 1 : -1);
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function bootCI(vals, seed = 7, B = 4000) {
  if (!vals.length) return null; const R0 = rng(seed); const n = vals.length; const ms = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let j = 0; j < n; j++) s += vals[(R0() * n) | 0]; ms.push(s / n); }
  ms.sort((a, b) => a - b); return [+(100 * ms[Math.floor(0.025 * B)]).toFixed(1), +(100 * ms[Math.floor(0.975 * B)]).toFixed(1)];
}
function summary(rows, label) {
  const n = rows.length; if (!n) return { label, n: 0 };
  const u = rows.map(p => unitsAt(p, p.best_odds));
  const withCl = rows.filter(p => p.closing && p.closing.odds > 1);
  const uc = withCl.map(p => unitsAt(p, p.closing.odds));
  const evClose = withCl.filter(p => p.closing.fair != null).map(p => p.closing.fair * p.best_odds - 1); // EV a la cuota tomada, juzgado por el fair de cierre
  const clv = rows.filter(p => p.clv_pct != null).map(p => p.clv_pct);
  const roi = mean(u), se = sd(u) / Math.sqrt(n);
  return {
    label, n, wins: rows.reduce((s, p) => s + win(p), 0), hit: +(100 * mean(rows.map(win))).toFixed(1),
    roi_taken: +(100 * roi).toFixed(1), roi_se: +(100 * se).toFixed(1), t: +(roi / se).toFixed(2), roi_ci95_boot: bootCI(u),
    roi_at_close: withCl.length ? +(100 * mean(uc)).toFixed(1) : null, n_close: withCl.length,
    ev_at_close_fair: evClose.length ? +(100 * mean(evClose)).toFixed(1) : null,
    clv_mean: clv.length ? +mean(clv).toFixed(2) : null, clv_se: clv.length > 1 ? +(sd(clv) / Math.sqrt(clv.length)).toFixed(2) : null,
    avg_odds: +mean(rows.map(p => p.best_odds)).toFixed(2), avg_model: +mean(rows.map(p => p.model_prob)).toFixed(3), avg_mkt: +mean(rows.map(p => p.market_prob)).toFixed(3),
    implied_hit_model: +(100 * mean(rows.map(p => p.model_prob))).toFixed(1), implied_hit_mkt: +(100 * mean(rows.map(p => p.market_prob))).toFixed(1),
  };
}
const brier = (rows, f) => +(mean(rows.map(p => (f(p) - win(p)) ** 2))).toFixed(4);
const logl = (rows, f) => +(mean(rows.map(p => { const q = Math.min(0.999, Math.max(0.001, f(p))); return -(win(p) * Math.log(q) + (1 - win(p)) * Math.log(1 - q)); }))).toFixed(4);

const out = {};
console.log(`liquidadas W/L: ${settled.length} · FIGHT ${F.length} · ROUNDS ${R.length} · METHOD ${M.length}`);
out.families = { FIGHT: summary(F, 'FIGHT'), ROUNDS: summary(R, 'ROUNDS'), METHOD: summary(M, 'METHOD') };
console.log(JSON.stringify(out.families, null, 1));

// ── Brier/logloss en las 48 FIGHT: modelo vs mercado (tomada) vs blend vs cierre ──
out.fight_brier = {
  n: F.length,
  model: brier(F, p => p.model_prob), market_taken: brier(F, p => p.market_prob), blend: brier(F, p => p.blend_prob),
  close_fair: brier(F.filter(p => p.closing && p.closing.fair != null), p => p.closing.fair),
  logloss: { model: logl(F, p => p.model_prob), market_taken: logl(F, p => p.market_prob), blend: logl(F, p => p.blend_prob), close_fair: logl(F.filter(p => p.closing && p.closing.fair != null), p => p.closing.fair) },
  // mezcla óptima m/k a posteriori (solo diagnóstico, n=48 → no es una regla)
  grid: [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1].map(w => ({ w_market: w, brier: brier(F, p => (1 - w) * p.model_prob + w * p.market_prob) })),
};
console.log('\nBRIER FIGHT (48):', JSON.stringify(out.fight_brier));

// ── H3: reglas (subconjuntos de lo publicado) ──
// peso del mercado w: eg = (1−w)(m−k) ≥ 2pp  ⇔  m−k ≥ 2/(1−w) pp. w=0.5 → 4pp (actual), w=0.8 → 10pp, w=1 → nunca publica.
const rules = {};
const edgeRaw = (p) => (p.model_prob - p.market_prob) * 100;
rules['w0.5 (actual, edge_raw>=4pp)'] = F.filter(p => edgeRaw(p) >= 4 - 1e-9);
rules['w0.6 (edge_raw>=5pp)'] = F.filter(p => edgeRaw(p) >= 5);
rules['w0.7 (edge_raw>=6.67pp)'] = F.filter(p => edgeRaw(p) >= 20 / 3);
rules['w0.8 (edge_raw>=10pp)'] = F.filter(p => edgeRaw(p) >= 10);
rules['w0.9 (edge_raw>=20pp)'] = F.filter(p => edgeRaw(p) >= 20);
rules['w1.0 (mercado puro: eg=0 → 0 picks)'] = [];
rules['techo cuota <3'] = F.filter(p => p.best_odds < 3);
rules['techo cuota <2.5'] = F.filter(p => p.best_odds < 2.5);
rules['techo cuota <2.0 (favoritos)'] = F.filter(p => p.best_odds < 2.0);
rules['cuota >=3 (lo que el techo quitó)'] = F.filter(p => p.best_odds >= 3);
rules['cuota 2.5-3'] = F.filter(p => p.best_odds >= 2.5 && p.best_odds < 3);
// veto por deriva en contra antes de publicar: opening anterior a la pick y cuota abierta MENOR que la tomada
const drifted = (p) => p.opening && p.opening.at && Date.parse(p.opening.at) < Date.parse(p.created_at) - 60e3 && p.opening.odds < p.best_odds;
const driftedFor = (p) => p.opening && p.opening.at && Date.parse(p.opening.at) < Date.parse(p.created_at) - 60e3 && p.opening.odds > p.best_odds;
rules['con deriva EN CONTRA pre-publicación (veto candidato)'] = F.filter(drifted);
rules['sin deriva en contra (lo que queda tras el veto)'] = F.filter(p => !drifted(p));
rules['opening == publicación (sin historia previa)'] = F.filter(p => !(p.opening && p.opening.at && Date.parse(p.opening.at) < Date.parse(p.created_at) - 60e3));
rules['con deriva A FAVOR pre-publicación'] = F.filter(driftedFor);
rules['combinada: cuota<2.5 & sin deriva en contra'] = F.filter(p => p.best_odds < 2.5 && !drifted(p));
rules['combinada: cuota<3 & w0.8'] = F.filter(p => p.best_odds < 3 && edgeRaw(p) >= 10);
rules['liga ufc'] = F.filter(p => p.league === 'ufc');
rules['liga mma (Bellator/PFL)'] = F.filter(p => p.league === 'mma');
rules['liga boxing'] = F.filter(p => p.league === 'boxing');
rules['books>=5'] = F.filter(p => p.books >= 5);
rules['books<=2'] = F.filter(p => p.books <= 2);
rules['main card'] = F.filter(p => p.card_slot === 'main');
rules['prelim'] = F.filter(p => p.card_slot !== 'main');
rules['lado favorito del mercado (k>=0.5)'] = F.filter(p => p.market_prob >= 0.5);
rules['lado perro del mercado (k<0.5)'] = F.filter(p => p.market_prob < 0.5);
out.rules = {};
console.log('\nH3 REGLAS (FIGHT, subconjuntos de lo publicado):');
for (const [k, rows] of Object.entries(rules)) { out.rules[k] = summary(rows, k); const s = out.rules[k]; console.log(`  ${k.padEnd(52)} n=${String(s.n).padStart(2)} hit ${s.hit}% ROI ${s.roi_taken}% (±${s.roi_se}, t ${s.t}, CI ${JSON.stringify(s.roi_ci95_boot)}) ROI@cierre ${s.roi_at_close}% EV@fair-cierre ${s.ev_at_close_fair}% CLV ${s.clv_mean}`); }

// ── H4: ¿el mercado tarde tiene razón? deriva apertura→cierre vs resultado y vs antelación ──
const H = F.filter(p => p.opening && p.opening.odds > 1 && p.closing && p.closing.odds > 1).map(p => ({
  drift: Math.log(p.closing.odds / p.opening.odds),                       // >0 = nuestro lado se alargó (mercado en contra)
  driftTaken: Math.log(p.closing.odds / p.best_odds),
  dfair: (p.closing.fair - p.market_prob) * 100,                          // pp de prob de cierre − prob al publicar
  lead_days: (Date.parse(p.event.kickoff_at) - Date.parse(p.created_at)) / 864e5,
  win: win(p), odds: p.best_odds, model: p.model_prob, mkt: p.market_prob, clf: p.closing.fair, edge: edgeRaw(p), lg: p.league, books: p.books,
}));
const corr = (xs, ys) => { const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const tOfR = (r, n) => r * Math.sqrt((n - 2) / (1 - r * r));
const n = H.length;
const rDrift = corr(H.map(h => h.driftTaken), H.map(h => h.win));
const rDfair = corr(H.map(h => h.dfair), H.map(h => h.win));
const rLead = corr(H.map(h => h.lead_days), H.map(h => h.driftTaken));
const rLeadWin = corr(H.map(h => h.lead_days), H.map(h => h.win));
const rEdgeDrift = corr(H.map(h => h.edge), H.map(h => h.driftTaken));
const against = H.filter(h => h.driftTaken > 0.02), forUs = H.filter(h => h.driftTaken < -0.02), flat = H.filter(h => Math.abs(h.driftTaken) <= 0.02);
const grp = (rows, label) => ({ label, n: rows.length, hit: rows.length ? +(100 * mean(rows.map(h => h.win))).toFixed(1) : null, roi: rows.length ? +(100 * mean(rows.map(h => h.win ? h.odds - 1 : -1))).toFixed(1) : null, avg_model: rows.length ? +mean(rows.map(h => h.model)).toFixed(3) : null, avg_mkt: rows.length ? +mean(rows.map(h => h.mkt)).toFixed(3) : null, avg_close: rows.length ? +mean(rows.map(h => h.clf)).toFixed(3) : null });
// antelación en terciles
const leadSorted = H.slice().sort((a, b) => a.lead_days - b.lead_days);
const t1 = leadSorted[Math.floor(n / 3)].lead_days, t2 = leadSorted[Math.floor(2 * n / 3)].lead_days;
out.h4 = {
  n,
  corr_drift_vs_win: { r: +rDrift.toFixed(3), t: +tOfR(rDrift, n).toFixed(2) },
  corr_closefair_minus_mkt_vs_win: { r: +rDfair.toFixed(3), t: +tOfR(rDfair, n).toFixed(2) },
  corr_lead_vs_drift: { r: +rLead.toFixed(3), t: +tOfR(rLead, n).toFixed(2) },
  corr_lead_vs_win: { r: +rLeadWin.toFixed(3), t: +tOfR(rLeadWin, n).toFixed(2) },
  corr_modeledge_vs_drift: { r: +rEdgeDrift.toFixed(3), t: +tOfR(rEdgeDrift, n).toFixed(2) },
  moved_against: grp(against, 'cierre > tomada (mercado en contra, >2%)'), moved_for: grp(forUs, 'cierre < tomada (mercado a favor)'), flat: grp(flat, 'plano ±2%'),
  share_moved_against: +(100 * against.length / n).toFixed(1),
  avg_drift_log: +mean(H.map(h => h.driftTaken)).toFixed(4), avg_taken: +mean(H.map(h => h.odds)).toFixed(2), avg_close: +mean(F.map(p => p.closing.odds)).toFixed(2),
  lead_terciles: { cut_days: [+t1.toFixed(1), +t2.toFixed(1)], early: grp(H.filter(h => h.lead_days >= t2), `antelación ≥${t2.toFixed(1)}d`), mid: grp(H.filter(h => h.lead_days >= t1 && h.lead_days < t2), 'tercil medio'), late: grp(H.filter(h => h.lead_days < t1), `antelación <${t1.toFixed(1)}d`) },
  lead_vs_drift_by_tercile: { early: +mean(H.filter(h => h.lead_days >= t2).map(h => h.driftTaken)).toFixed(4), mid: +mean(H.filter(h => h.lead_days >= t1 && h.lead_days < t2).map(h => h.driftTaken)).toFixed(4), late: +mean(H.filter(h => h.lead_days < t1).map(h => h.driftTaken)).toFixed(4) },
  // ¿la magnitud del edge del modelo predice que el mercado se mueva en contra? (si sí: el "edge" es error del modelo que el mercado corrige)
  drift_by_edge: { edge_lt10: +mean(H.filter(h => h.edge < 10).map(h => h.driftTaken)).toFixed(4), edge_10_20: +mean(H.filter(h => h.edge >= 10 && h.edge < 20).map(h => h.driftTaken)).toFixed(4), edge_ge20: +mean(H.filter(h => h.edge >= 20).map(h => h.driftTaken)).toFixed(4), n: [H.filter(h => h.edge < 10).length, H.filter(h => h.edge >= 10 && h.edge < 20).length, H.filter(h => h.edge >= 20).length] },
  hit_by_edge: { edge_lt10: grp(H.filter(h => h.edge < 10), '<10pp'), edge_10_20: grp(H.filter(h => h.edge >= 10 && h.edge < 20), '10-20pp'), edge_ge20: grp(H.filter(h => h.edge >= 20), '>=20pp') },
};
console.log('\nH4:', JSON.stringify(out.h4, null, 1));

// ROUNDS/METHOD: cierre vs tomada (referencia)
out.derived = { ROUNDS: { by_side: { over: summary(R.filter(p => p.side === 'over'), 'over'), under: summary(R.filter(p => p.side === 'under'), 'under') }, by_league: { ufc: summary(R.filter(p => p.league === 'ufc'), 'ufc'), mma: summary(R.filter(p => p.league === 'mma'), 'mma'), boxing: summary(R.filter(p => p.league === 'boxing'), 'boxing') }, brier: { model: brier(R, p => p.model_prob), market: brier(R, p => p.market_prob), blend: brier(R, p => p.blend_prob) } }, METHOD: { brier: { model: brier(M, p => p.model_prob), market: brier(M, p => p.market_prob), blend: brier(M, p => p.blend_prob) }, odds_lt3: summary(M.filter(p => p.best_odds < 3), '<3'), odds_ge3: summary(M.filter(p => p.best_odds >= 3), '>=3') } };
console.log('\nDERIVADAS:', JSON.stringify(out.derived, null, 1));
fs.writeFileSync(path.join(__dirname, 'h3_h4_results.json'), JSON.stringify(out, null, 1));
console.log('\nescrito h3_h4_results.json');
