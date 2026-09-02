// ESCÉPTICO Valorant — intenta refutar H2 (bisección) y H4/H6 (re-cotización de los under).
// A) Control "FLAT": ¿la mejora de V1 sobre el actual es por la bisección o por dejar de creer en p?
//    Panel idéntico al de h2 (mismas líneas, mismo simulador) con: actual, V1, FLAT (pRound=0,5, ignora p),
//    V1 con p encogida al 50 %, y —solo libro— V1/actual/FLAT con la p_mapa que USÓ PRODUCCIÓN (recuperada en H5).
// B) Re-cotizar los 80 under con la |p−0,5| de PRODUCCIÓN (H5) y la bisección SOLA (sin cambiar p_mapa).
// C) SE por clúster (event-map) de la mejora de Brier de H6 (0,2164 vs 0,2198, n=73).
// D) Sesgo de selección: "favorito de producción ganó 39,4 %" sobre picks correlacionadas → sobre event-maps únicos.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = '/home/user/gp-simulador-mundial';
const HERE = __dirname;
const RESEARCH = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research';
const C = require(path.join(REPO, 'esports-engine/core.js'));
const V = require(path.join(REPO, 'esports-engine/valorant.js'));
const MS = JSON.parse(fs.readFileSync(path.join(REPO, 'data/esports/valorant/map-stats.json'), 'utf8'));
const H1 = JSON.parse(fs.readFileSync(path.join(HERE, 'h1_preds.json'), 'utf8'));
const H5 = JSON.parse(fs.readFileSync(path.join(HERE, 'h5_result.json'), 'utf8'));
const H6 = JSON.parse(fs.readFileSync(path.join(HERE, 'h6_result.json'), 'utf8'));
const bookMaps = JSON.parse(fs.readFileSync(path.join(HERE, 'h2_bookmaps.json'), 'utf8'));
const book = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'es_full_valorant.json'), 'utf8')).recent.filter((p) => p.result_code === 'WIN' || p.result_code === 'LOSS');
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r4 = (x) => +x.toFixed(4), r2 = (x) => +x.toFixed(2);

// ── mismo perfil/eco/simulador que h2 ──
const rows = MS.rows.filter((r) => r.in_rotation && r.n >= 40); const wN = rows.reduce((s, r) => s + r.n, 0);
const circuit = { bias: 1 - rows.reduce((s, r) => s + r.n * r.atk_round_share, 0) / wN, ot: rows.reduce((s, r) => s + r.n * r.overtime_p, 0) / wN };
function fitEco(bias, targetOt) { let lo = 0, hi = 0.18; for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; const ot = V.mapRounds(0.5, bias, { eco: mid, sims: 6000, seed: 4127 }).overtime_p; if (ot > targetOt) lo = mid; else hi = mid; } return +((lo + hi) / 2).toFixed(3); }
const ECO = fitEco(circuit.bias, circuit.ot);
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.44, 0.32, 0.68);
function simRounds(pRound, bias, { eco, sims = 20000, seed = 29 } = {}) {
  const rnd = C.rng(seed); const d = bias - 0.5; const tot = [], marg = [];
  const pDef = C.clamp(pRound + d, 0.10, 0.90), pAtk = C.clamp(pRound - d, 0.10, 0.90);
  for (let i = 0; i < sims; i++) {
    let a = 0, b = 0, st = 0;
    const play = (p) => { if (rnd() < C.clamp(p + st * eco, 0.05, 0.95)) { a++; st = Math.min(2, st <= 0 ? 1 : st + 1); } else { b++; st = Math.max(-2, st >= 0 ? -1 : st - 1); } };
    for (let r = 0; r < 12 && a < 13 && b < 13; r++) play(pDef);
    for (let r = 0; r < 12 && a < 13 && b < 13; r++) play(pAtk);
    let ot = 0; while (a === b && a >= 12) { ot++; play(pDef); play(pAtk); if (ot > 10) break; }
    tot.push(a + b); marg.push(a - b);
  }
  return { tot, marg, n: sims };
}
const pWinOf = (S) => S.marg.filter((m) => m > 0).length / S.n;
const invCache = new Map();
function pRoundFor(p) { const k = p.toFixed(3); if (invCache.has(k)) return invCache.get(k); let lo = 0.2, hi = 0.8; for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (pWinOf(simRounds(mid, circuit.bias, { eco: ECO, sims: 6000, seed: 911 })) < p) lo = mid; else hi = mid; } const v = (lo + hi) / 2; invCache.set(k, v); return v; }
const LINES_T = [19.5, 20.5, 21.5, 22.5, 23.5], LINES_H = [-8.5, -6.5, -4.5, -2.5, -1.5, 1.5, 2.5];
const distCache = new Map();
function distFor(pRound) {
  const k = pRound.toFixed(3); if (distCache.has(k)) return distCache.get(k);
  const S = simRounds(+k, circuit.bias, { eco: ECO }); const H = { over: {}, cover: {}, pwin: pWinOf(S) };
  for (const L of LINES_T) H.over[L] = S.tot.filter((t) => t > L).length / S.n;
  for (const h of LINES_H) H.cover[h] = S.marg.filter((m) => m + h > 0).length / S.n;
  distCache.set(k, H); return H;
}
// mapping p → pRound por variante
const MAP = {
  actual: (p) => clampRound(p),
  v1: (p) => pRoundFor(p),
  flat: () => 0.5,
  v1_shrink50: (p) => pRoundFor(0.5 + (p - 0.5) * 0.5),
  actual_shrink50: (p) => clampRound(0.5 + (p - 0.5) * 0.5),
};
// panel por mapa: r = {q (p del favorito según el predictor), tot, marg orientado al favorito}
function perMap(recs, mapping) {
  return recs.map((r) => {
    const H = distFor(mapping(r.q));
    let bt = 0, bh = 0;
    for (const L of LINES_T) bt += (H.over[L] - (r.tot > L ? 1 : 0)) ** 2;
    for (const h of LINES_H) bh += (H.cover[h] - (r.marg + h > 0 ? 1 : 0)) ** 2;
    return { bt: bt / LINES_T.length, bh: bh / LINES_H.length, bw: (H.pwin - (r.marg > 0 ? 1 : 0)) ** 2 };
  });
}
function boot(pA, pB, key, reps = 2000, seed = 3) {
  const rnd = C.rng(seed); const d = pA.map((x, i) => x[key] - pB[i][key]); const n = d.length; const ds = [];
  for (let r = 0; r < reps; r++) { let s = 0; for (let i = 0; i < n; i++) s += d[(rnd() * n) | 0]; ds.push(s / n); }
  ds.sort((a, b) => a - b);
  return { delta: r4(mean(d)), se: r4(sd(ds)), ci95: [r4(ds[Math.floor(0.025 * reps)]), r4(ds[Math.floor(0.975 * reps)])] };
}
const orient = (p, s1, s2) => { const fav = p >= 0.5; return { q: fav ? p : 1 - p, tot: s1 + s2, marg: fav ? s1 - s2 : s2 - s1 }; };
const valid = (s1, s2) => { const w = Math.max(s1, s2), l = Math.min(s1, s2); return (w === 13 && l <= 11) || (w >= 14 && w - l === 2); };
function table(recs, tag) {
  const out = {}; const P = {};
  for (const k of Object.keys(MAP)) { P[k] = perMap(recs, MAP[k]); out[k] = { n: recs.length, brier_totales: r4(mean(P[k].map((x) => x.bt))), brier_handicap: r4(mean(P[k].map((x) => x.bh))), brier_ganador: r4(mean(P[k].map((x) => x.bw))) }; }
  console.log(`\n[skeptic] ${tag} (n=${recs.length})`); console.table(out);
  const deltas = { v1_vs_actual: {}, flat_vs_actual: {}, flat_vs_v1: {}, v1shrink_vs_v1: {} };
  for (const key of ['bt', 'bh', 'bw']) {
    deltas.v1_vs_actual[key] = boot(P.v1, P.actual, key); deltas.flat_vs_actual[key] = boot(P.flat, P.actual, key);
    deltas.flat_vs_v1[key] = boot(P.flat, P.v1, key); deltas.v1shrink_vs_v1[key] = boot(P.v1_shrink50, P.v1, key);
  }
  for (const [k, v] of Object.entries(deltas)) console.log(`  Δ ${k}: totales ${v.bt.delta} (SE ${v.bt.se}) · hándicap ${v.bh.delta} (SE ${v.bh.se}) · ganador ${v.bw.delta} (SE ${v.bw.se})`);
  return { tabla: out, deltas };
}

// ── A1) BO1 eval (>2025-06-30, cualificados) con p de H1 — como en h2 ──
const bo1 = H1.rows.filter((r) => r.bo1rounds && valid(r.s1, r.s2) && r.qual && r.at > '2025-06-30').map((r) => orient(r.p_win, r.s1, r.s2));
const A1 = table(bo1, 'BO1 eval 2025-07→2026-01 · p de H1 (elomap_24, temp 0,85)');
// ── A2) libro 128 mapas con p de H1 — como en h2 (perfil circuito) ──
const bk = bookMaps.filter((r) => r.p_win != null).map((r) => ({ ...orient(r.p_win, r.s1, r.s2), event: r.event, idx: r.idx }));
const A2 = table(bk, 'Libro 2026 (128 mapas) · p de H1');
// ── A3) libro con la p_mapa de PRODUCCIÓN recuperada en H5 (media por event-map de RONDAS_HANDICAP/RONDAS_EQUIPO) ──
const byPick = Object.fromEntries(book.map((p) => [p.pick_id, p]));
const prodEM = {};
for (const r of H5.picks) {
  if (r.p_map_prod == null) continue; const p = byPick[r.pick_id]; if (!p) continue;
  const k = p.event_id + '|' + p.map; (prodEM[k] = prodEM[k] || []).push(r.p_map_prod);
}
const bkProd = bookMaps.filter((r) => prodEM[r.event + '|' + r.idx]).map((r) => ({ ...orient(mean(prodEM[r.event + '|' + r.idx]), r.s1, r.s2), event: r.event, idx: r.idx }));
console.log(`\n[skeptic] event-maps del libro con p_mapa de producción recuperada: ${bkProd.length}; |p−0,5| medio ${r4(mean(bkProd.map((r) => r.q - 0.5)))}; favorito de producción ganó ${r2(100 * mean(bkProd.map((r) => r.marg > 0 ? 1 : 0)))} % (SE binomial ${r2(100 * Math.sqrt(0.25 / bkProd.length))})`);
const A3 = table(bkProd, 'Libro 2026 · p_mapa de PRODUCCIÓN (H5) — lo que el motor usó de verdad');
// mismo subconjunto con p de H1 para comparar peras con peras
const bkH1same = bookMaps.filter((r) => prodEM[r.event + '|' + r.idx] && r.p_win != null).map((r) => ({ ...orient(r.p_win, r.s1, r.s2) }));
const A3b = table(bkH1same, 'Libro 2026 · mismo subconjunto · p de H1');

// ── B) re-cotizar los 80 under con |p−0,5| de PRODUCCIÓN + bisección SOLA ──
const h5ByPick = Object.fromEntries(H5.picks.map((r) => [r.pick_id, r]));
const unders = book.filter((p) => p.family === 'RONDAS' && p.side === 'under');
const gate = (p, edgePp) => { const single = !p.books_quoting || p.books_quoting < 2; return edgePp >= 3 + (single ? 2.5 : 0) && edgePp >= 0.75 * p.uncertainty_pp && !(p.calibration_pp > 0 && edgePp <= p.calibration_pp); };
const fullDist = new Map();
const distTot = (pr) => { const k = pr.toFixed(3); if (!fullDist.has(k)) fullDist.set(k, V.mapRounds(+k, circuit.bias, { eco: ECO, sims: 20000, seed: 29 })); return fullDist.get(k); };
const rq = [];
for (const p of unders) {
  const h = h5ByPick[p.pick_id]; if (!h) continue;
  const pProd = 0.5 + h.abs_dev_prod;           // p_mapa implícita de producción (signo irrelevante para totales)
  const y = p.result_code === 'WIN' ? 1 : 0;
  const Ra = distTot(clampRound(pProd)), Rc = distTot(pRoundFor(Math.min(0.97, pProd)));
  const pa = C.pUnder(Ra.dist.total, p.line), pc = C.pUnder(Rc.dist.total, p.line);
  rq.push({ pick_id: p.pick_id, line: p.line, odds: p.odds, y, p_gp: p.p_gp, p_market: p.p_market, p_prod: r4(pProd), p_under_actual_recup: r4(pa), p_under_v1: r4(pc), edge_v1: r2((pc - p.p_market) * 100), nace_v1: gate(p, (pc - p.p_market) * 100), nace_actual_recup: gate(p, (pa - p.p_market) * 100) });
}
const bornV1 = rq.filter((r) => r.nace_v1), bornA = rq.filter((r) => r.nace_actual_recup);
const roi = (b) => (b.length ? r2(100 * mean(b.map((r) => (r.y ? r.odds - 1 : -1)))) : null);
const B = { n: rq.length, recuperacion_actual: { p_gp_medio: r4(mean(rq.map((r) => r.p_gp))), p_under_recuperado_medio: r4(mean(rq.map((r) => r.p_under_actual_recup))), err_abs_medio: r4(mean(rq.map((r) => Math.abs(r.p_under_actual_recup - r.p_gp)))), nacen: bornA.length },
  p_prod_medio: r4(mean(rq.map((r) => r.p_prod))), p_prod_ge_0_65_pct: r2(100 * mean(rq.map((r) => r.p_prod >= 0.65 ? 1 : 0))),
  v1_con_p_prod: { p_under_medio: r4(mean(rq.map((r) => r.p_under_v1))), edge_medio_pp: r2(mean(rq.map((r) => r.edge_v1))), brier: r4(mean(rq.map((r) => (r.p_under_v1 - r.y) ** 2))), nacen: bornV1.length, win: bornV1.filter((r) => r.y).length, roi_pct: roi(bornV1) },
  original: { brier: r4(mean(rq.map((r) => (r.p_gp - r.y) ** 2))), roi_pct: roi(rq), win: rq.filter((r) => r.y).length }, brier_mercado: r4(mean(rq.map((r) => (r.p_market - r.y) ** 2))) };
console.log('\n[skeptic] B) under re-cotizados con |p−0,5| de PRODUCCIÓN y bisección sola:'); console.log(JSON.stringify(B, null, 1));

// ── C) H6: SE por clúster (event-map) de Brier corr_mkt − mercado bruto ──
const det = H6.detalle.map((r) => ({ ...r, em: r.pick_id.replace(/_RONDAS_under_.*$/, '') + '|' + r.pick_id.match(/_(\d+)$/)[1] }));
const groups = {}; for (const r of det) (groups[r.em] = groups[r.em] || []).push(r);
const G = Object.values(groups);
const clusterBoot = (f, reps = 2000, seed = 5) => { const rnd = C.rng(seed); const out = []; for (let k = 0; k < reps; k++) { let s = 0, n = 0; for (let i = 0; i < G.length; i++) { const g = G[(rnd() * G.length) | 0]; for (const r of g) { s += f(r); n++; } } out.push(s / n); } out.sort((a, b) => a - b); return { mean: r4(mean(out)), se: r4(sd(out)), ci95: [r4(out[Math.floor(0.025 * reps)]), r4(out[Math.floor(0.975 * reps)])] }; };
const Cc = { n_picks: det.length, n_event_maps: G.length, brier_corr_mkt: r4(mean(det.map((r) => (r.p_under_corr - r.y) ** 2))), brier_mercado: r4(mean(det.map((r) => (r.p_market - r.y) ** 2))), brier_orig: r4(mean(det.map((r) => (r.p_gp_orig - r.y) ** 2))),
  delta_corr_vs_mercado_cluster: clusterBoot((r) => (r.p_under_corr - r.y) ** 2 - (r.p_market - r.y) ** 2), delta_orig_vs_mercado_cluster: clusterBoot((r) => (r.p_gp_orig - r.y) ** 2 - (r.p_market - r.y) ** 2),
  corr_medio_p_under_vs_mercado: r4(mean(det.map((r) => r.p_under_corr - r.p_market))), hit_real_pct: r2(100 * mean(det.map((r) => r.y))) };
console.log('\n[skeptic] C) H6 con error por clúster:'); console.log(JSON.stringify(Cc, null, 1));

// ── D) "favorito de producción ganó el 39,4 %": sobre event-maps únicos ──
const emRows = {};
for (const r of H5.picks) { if (r.p_map_prod == null || r.home_won_map == null) continue; const p = byPick[r.pick_id]; const k = p.event_id + '|' + p.map; (emRows[k] = emRows[k] || { pm: [], h1: r.p_map_h1, y: r.home_won_map }).pm.push(r.p_map_prod); }
const EM = Object.values(emRows).map((e) => ({ p: mean(e.pm), h1: e.h1, y: e.y }));
const favProd = mean(EM.map((e) => ((e.p >= 0.5) === (e.y === 1)) ? 1 : 0)), favH1 = mean(EM.filter((e) => e.h1 != null).map((e) => ((e.h1 >= 0.5) === (e.y === 1)) ? 1 : 0));
const D = { n_event_maps: EM.length, fav_prod_gano_pct: r2(100 * favProd), se_binomial_pct: r2(100 * Math.sqrt(0.25 / EM.length)), z_vs_50: r2((favProd - 0.5) / Math.sqrt(0.25 / EM.length)), fav_h1_gano_pct: r2(100 * favH1), brier_prod: r4(mean(EM.map((e) => (e.p - e.y) ** 2))), brier_h1: r4(mean(EM.filter((e) => e.h1 != null).map((e) => (e.h1 - e.y) ** 2))),
  nota: 'las picks del libro existen PORQUE producción discrepó del mercado: condicionado a discrepancia, el favorito de GP pierde más de lo normal aunque el predictor sea neutro en población (H1 intacta: wr_8 Brier 0,244 < 0,25)' };
console.log('\n[skeptic] D) sesgo de selección en el "anti-predictivo":'); console.log(JSON.stringify(D, null, 1));

fs.writeFileSync(path.join(HERE, 'skeptic_result.json'), JSON.stringify({ at: new Date().toISOString(), eco: ECO, A1, A2, A3, A3b, B, C: Cc, D, requote_unders: rq }, null, 1));
console.log('\n[skeptic] escrito skeptic_result.json');
