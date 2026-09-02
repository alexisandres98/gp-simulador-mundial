// H6 (complemento de H1/H4) — p_mapa IMPLÍCITA EN EL MERCADO a partir del precio del hándicap de rondas.
// El libro no guarda la probabilidad de serie del mercado, pero sí el precio de cada RONDAS_HANDICAP tomado:
// con el modelo corregido (H2-V1, perfil circuito) se invierte P(lado cubre | pRound) = p_market/(1+margen)
// → pRound_mkt → p_mapa_mkt = P(local gana el mapa | sim). Margen asumido 5 % Pinnacle / 7,5 % Bovada.
// 1) ¿predice el ganador del mapa mejor que H1 y que la moneda? (Brier sobre event-map únicos)
// 2) re-cotizar los UNDER de RONDAS del mismo event-map con p_mapa_mkt + distribución corregida (gate producción).
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const REPO = '/home/user/gp-simulador-mundial';
const RESEARCH = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research';
const C = require(path.join(REPO, 'esports-engine/core.js'));
const V = require(path.join(REPO, 'esports-engine/valorant.js'));
const H5 = JSON.parse(fs.readFileSync(path.join(HERE, 'h5_result.json'), 'utf8'));
const MS = JSON.parse(fs.readFileSync(path.join(REPO, 'data/esports/valorant/map-stats.json'), 'utf8'));
const book = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'es_full_valorant.json'), 'utf8')).recent.filter((p) => p.result_code === 'WIN' || p.result_code === 'LOSS');
const r4 = (x) => +x.toFixed(4), r2 = (x) => +x.toFixed(2);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const MARGIN = { pinnacle: 0.05, bovada: 0.075 };
const rows = MS.rows.filter((r) => r.in_rotation && r.n >= 40); const wN = rows.reduce((s, r) => s + r.n, 0);
const bias = 1 - rows.reduce((s, r) => s + r.n * r.atk_round_share, 0) / wN;
const ECO = H5.eco_circuito;
const simCache = new Map();
const sim = (pr) => { const k = pr.toFixed(4); if (!simCache.has(k)) simCache.set(k, V.mapRounds(pr, bias, { eco: ECO, sims: 12000, seed: 29 })); return simCache.get(k); };
const negHist = (d) => { const h = {}; for (const [k, p] of Object.entries(d.h)) h[-k] = p; return { h, n: d.n }; };
const pWin = (R) => Object.entries(R.dist.margin.h).reduce((s, [k, p]) => s + (+k > 0 ? p : 0), 0);
const pCover = (p, R) => { const h = p.side === 'home' ? C.pHandicap(R.dist.margin, p.line) : C.pHandicap(negHist(R.dist.margin), -p.line); return h ? h.p : null; };
function invertCover(p, target) { const f = (pr) => pCover(p, sim(pr)); let lo = 0.2, hi = 0.8; const inc = f(0.8) > f(0.2); for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if ((f(mid) < target) === inc) lo = mid; else hi = mid; } return (lo + hi) / 2; }
const realMap = (p) => { if (!p.final || !p.final.detail) return null; const s = p.final.detail.split('·').map((x) => x.trim())[p.map - 1]; if (!s) return null; const m = s.match(/^([A-Za-z ]+?)\s+(\d+)-(\d+)/); return m ? { map: m[1].trim(), s1: +m[2], s2: +m[3] } : null; };
const gate = (p, edgePp) => { const single = !p.books_quoting || p.books_quoting < 2; return edgePp >= 3 + (single ? 2.5 : 0) && edgePp >= 0.75 * p.uncertainty_pp && !(p.calibration_pp > 0 && edgePp <= p.calibration_pp); };

// 1) p_mapa del mercado por event-map (media de las implícitas de todos los hándicaps del mismo event-map)
const byEM = {};
for (const p of book.filter((q) => q.family === 'RONDAS_HANDICAP')) {
  const m = MARGIN[p.book] != null ? MARGIN[p.book] : 0.05;
  const target = Math.min(0.97, Math.max(0.03, p.p_market / (1 + m)));
  const pr = invertCover(p, target); const pm = pWin(sim(pr));
  const k = p.event_id + '|' + p.map;
  const e = byEM[k] = byEM[k] || { event: p.event_id, map: p.map, pms: [], rm: realMap(p) };
  e.pms.push(pm);
}
const h1ByPick = Object.fromEntries(H5.picks.map((r) => [r.pick_id, r]));
const ems = Object.values(byEM).map((e) => ({ ...e, p_map_mkt: mean(e.pms), spread: Math.max(...e.pms) - Math.min(...e.pms) }));
// p_mapa H1 por event-map (del H5, cualquier pick del mismo event-map)
const h1ByEM = {}; for (const r of H5.picks) if (r.p_map_h1 != null) h1ByEM[r.pick_id.split('_RONDAS')[0].replace(/^es_valorant_/, '') + '|' + (r.pick_id.match(/_(\d+)$/) || [])[1]] = r.p_map_h1;
// más robusto: mapear por event_id + map desde el libro
const h1EM = {}; for (const p of book) { const r = h1ByPick[p.pick_id]; if (r && r.p_map_h1 != null) h1EM[p.event_id + '|' + p.map] = r.p_map_h1; }
const withRes = ems.filter((e) => e.rm);
const yOf = (e) => (e.rm.s1 > e.rm.s2 ? 1 : 0);
const brierMkt = mean(withRes.map((e) => (e.p_map_mkt - yOf(e)) ** 2));
const withH1 = withRes.filter((e) => h1EM[e.event + '|' + e.map] != null);
const brierH1 = mean(withH1.map((e) => (h1EM[e.event + '|' + e.map] - yOf(e)) ** 2));
const brierMktH1set = mean(withH1.map((e) => (e.p_map_mkt - yOf(e)) ** 2));
const favMkt = withRes.filter((e) => (e.p_map_mkt >= 0.5) === (yOf(e) === 1)).length;
console.log(`[h6] event-maps con hándicap: ${ems.length}; con resultado: ${withRes.length}; dispersión media de implícitas dentro del event-map: ${r4(mean(ems.map((e) => e.spread)))}`);
console.log(`[h6] ganador del mapa — Brier mercado ${r4(brierMkt)} (n=${withRes.length}, favorito acierta ${r2(100 * favMkt / withRes.length)}%) · Brier H1 ${r4(brierH1)} vs mercado ${r4(brierMktH1set)} en el mismo set (n=${withH1.length}) · moneda 0,25`);
console.log(`[h6] |p_mapa_mkt − 0,5| medio ${r4(mean(ems.map((e) => Math.abs(e.p_map_mkt - 0.5))))}`);

// 2) re-cotizar los UNDER con p_mapa_mkt y modelo corregido
const invCache = new Map();
function pRoundFor(p) { const k = p.toFixed(3); if (invCache.has(k)) return invCache.get(k); let lo = 0.2, hi = 0.8; for (let i = 0; i < 13; i++) { const mid = (lo + hi) / 2; if (pWin(sim(mid)) < p) lo = mid; else hi = mid; } const v = (lo + hi) / 2; invCache.set(k, v); return v; }
const unders = book.filter((p) => p.family === 'RONDAS' && p.side === 'under');
const rq = [];
for (const p of unders) {
  const e = byEM[p.event_id + '|' + p.map]; if (!e) continue;
  const pm = mean(e.pms);
  const R = sim(pRoundFor(pm));
  const pu = C.pUnder(R.dist.total, p.line);
  const edge = (pu - p.p_market) * 100;
  rq.push({ pick_id: p.pick_id, line: p.line, odds: p.odds, y: p.result_code === 'WIN' ? 1 : 0, p_gp_orig: p.p_gp, p_market: p.p_market, p_map_mkt: r4(pm), p_under_corr: r4(pu), edge_pp: r2(edge), nace: gate(p, edge), mean_rounds: R.mean_rounds });
}
const born = rq.filter((r) => r.nace);
const S = { n_unders_con_p_mkt: rq.length, brier_orig: r4(mean(rq.map((r) => (r.p_gp_orig - r.y) ** 2))), brier_corr_mkt: r4(mean(rq.map((r) => (r.p_under_corr - r.y) ** 2))), brier_mercado_bruto: r4(mean(rq.map((r) => (r.p_market - r.y) ** 2))),
  p_under_orig_medio: r4(mean(rq.map((r) => r.p_gp_orig))), p_under_corr_medio: r4(mean(rq.map((r) => r.p_under_corr))), p_market_medio: r4(mean(rq.map((r) => r.p_market))), edge_corr_medio_pp: r2(mean(rq.map((r) => r.edge_pp))),
  nacen: born.length, win: born.filter((r) => r.y).length, roi_pct: born.length ? r2(100 * mean(born.map((r) => (r.y ? r.odds - 1 : -1)))) : null,
  roi_original_mismo_set: r2(100 * mean(rq.map((r) => (r.y ? r.odds - 1 : -1)))), hit_original: r2(100 * mean(rq.map((r) => r.y))) };
console.log('[h6] re-cotización de los under con p_mapa del mercado + modelo corregido:', JSON.stringify(S));
fs.writeFileSync(path.join(HERE, 'h6_result.json'), JSON.stringify({ at: new Date().toISOString(), margen: MARGIN, event_maps: ems.length, ganador_mapa: { n: withRes.length, brier_mercado: r4(brierMkt), fav_mercado_acierta_pct: r2(100 * favMkt / withRes.length), n_h1: withH1.length, brier_h1: r4(brierH1), brier_mercado_mismo_set: r4(brierMktH1set) }, unders: S, detalle: rq }, null, 1));
console.log('[h6] escrito h6_result.json');
