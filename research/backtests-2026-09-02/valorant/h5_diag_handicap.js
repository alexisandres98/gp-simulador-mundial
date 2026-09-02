// H5 (diagnóstico complementario a H1/H2/H4) — ¿de dónde salió la p_gp de las picks por mapa?
// 1) Se invierte mapRounds (perfil circuito, ×0,44 actual) para recuperar la pRound/p_mapa IMPLÍCITA que
//    producción usó en cada pick (RONDAS_HANDICAP y RONDAS_EQUIPO son monótonas en pRound; RONDAS solo da |p−0,5|).
// 2) Se compara con la p_mapa de H1 y con el resultado real del mapa (¿ganó el favorito de producción? ¿el de H1?).
// 3) Se re-cotizan RONDAS_HANDICAP y RONDAS_EQUIPO con el modelo corregido (H2-V1) y p_mapa de H1, con el gate
//    de producción, para ver cuántas nacen y con qué resultado (misma lógica que H4 para los unders).
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const REPO = '/home/user/gp-simulador-mundial';
const RESEARCH = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research';
const C = require(path.join(REPO, 'esports-engine/core.js'));
const V = require(path.join(REPO, 'esports-engine/valorant.js'));
const VD = require(path.join(REPO, 'esports-engine/valorant-data.js'));
const FR = JSON.parse(fs.readFileSync(path.join(HERE, 'h1_final_ratings.json'), 'utf8'));
const MS = JSON.parse(fs.readFileSync(path.join(REPO, 'data/esports/valorant/map-stats.json'), 'utf8'));
const book = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'es_full_valorant.json'), 'utf8')).recent.filter((p) => p.result_code === 'WIN' || p.result_code === 'LOSS');
const lg = (p) => Math.log(p / (1 - p)), sg = (x) => 1 / (1 + Math.exp(-x));
const r4 = (x) => +x.toFixed(4), r2 = (x) => +x.toFixed(2);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const rows = MS.rows.filter((r) => r.in_rotation && r.n >= 40); const wN = rows.reduce((s, r) => s + r.n, 0);
const circuit = { name: null, bias: 1 - rows.reduce((s, r) => s + r.n * r.atk_round_share, 0) / wN, ot: rows.reduce((s, r) => s + r.n * r.overtime_p, 0) / wN };
function fitEco(bias, targetOt) { let lo = 0, hi = 0.18; for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; const ot = V.mapRounds(0.5, bias, { eco: mid, sims: 6000, seed: 4127 }).overtime_p; if (ot > targetOt) lo = mid; else hi = mid; } return +((lo + hi) / 2).toFixed(3); }
const ECO = fitEco(circuit.bias, circuit.ot);
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.44, 0.32, 0.68);
const simCache = new Map();
const sim = (pr) => { const k = pr.toFixed(4); if (!simCache.has(k)) simCache.set(k, V.mapRounds(pr, circuit.bias, { eco: ECO, sims: 12000, seed: 29 })); return simCache.get(k); };
const negHist = (d) => { const h = {}; for (const [k, p] of Object.entries(d.h)) h[-k] = p; return { h, n: d.n }; };
const pWin = (R) => Object.entries(R.dist.margin.h).reduce((s, [k, p]) => s + (+k > 0 ? p : 0), 0);
// probabilidad de la pick dada pRound (convenciones de store.probFor)
function probOf(p, R) {
  if (p.family === 'RONDAS_HANDICAP') { const h = p.side === 'home' ? C.pHandicap(R.dist.margin, p.line) : C.pHandicap(negHist(R.dist.margin), -p.line); return h ? h.p : null; }
  if (p.family === 'RONDAS_EQUIPO') { const d = R.dist[p.team]; return p.side === 'over' ? C.pOver(d, p.line) : C.pUnder(d, p.line); }
  if (p.family === 'RONDAS') return p.side === 'over' ? C.pOver(R.dist.total, p.line) : C.pUnder(R.dist.total, p.line);
  return null;
}
// inversión: pRound que reproduce p_gp (monótona para hándicap y equipo; para RONDAS se busca en [0,5, 0,8])
function impliedPRound(p) {
  const f = (pr) => probOf(p, sim(pr));
  if (p.family === 'RONDAS') { let lo = 0.5, hi = 0.8; const inc = f(0.8) > f(0.5); for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if ((f(mid) < p.p_gp) === inc) lo = mid; else hi = mid; } return (lo + hi) / 2; }
  let lo = 0.2, hi = 0.8; const inc = f(0.8) > f(0.2);
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if ((f(mid) < p.p_gp) === inc) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const invCache = new Map();
function pRoundFor(p) { const k = p.toFixed(3); if (invCache.has(k)) return invCache.get(k); let lo = 0.2, hi = 0.8; for (let i = 0; i < 13; i++) { const mid = (lo + hi) / 2; if (pWin(sim(mid)) < p) lo = mid; else hi = mid; } const v = (lo + hi) / 2; invCache.set(k, v); return v; }
const vd = VD.load();
const slugOf = (name) => VD.norm(name).replace(/ /g, '-');
const bySlug = {}; for (const [team, r] of Object.entries(FR.teams)) bySlug[slugOf(team)] = r;
const pMapOf = (home, away) => { const a = VD.resolveTeam(home, { data: vd }), b = VD.resolveTeam(away, { data: vd }); if (!a || !b || !bySlug[a] || !bySlug[b]) return null; const pm = 1 / (1 + Math.pow(10, (bySlug[b].elo_map - bySlug[a].elo_map) / 400)); return sg(FR.temperatura * lg(Math.min(0.97, Math.max(0.03, pm)))); };
const realMap = (p) => { if (!p.final || !p.final.detail) return null; const s = p.final.detail.split('·').map((x) => x.trim())[p.map - 1]; if (!s) return null; const m = s.match(/^([A-Za-z ]+?)\s+(\d+)-(\d+)/); return m ? { map: m[1].trim(), s1: +m[2], s2: +m[3] } : null; };
const gate = (p, edgePp) => { const single = !p.books_quoting || p.books_quoting < 2; return edgePp >= 3 + (single ? 2.5 : 0) && edgePp >= 0.75 * p.uncertainty_pp && !(p.calibration_pp > 0 && edgePp <= p.calibration_pp); };

const out = [];
for (const p of book.filter((q) => ['RONDAS_HANDICAP', 'RONDAS_EQUIPO', 'RONDAS'].includes(q.family))) {
  const pm = pMapOf(p.home, p.away); const rm = realMap(p);
  const prProd = impliedPRound(p);
  const pMapProd = p.family === 'RONDAS' ? null : 0.5 + (prProd - 0.5) / 0.44;   // inversa de clampRound
  const y = p.result_code === 'WIN' ? 1 : 0;
  const row = { pick_id: p.pick_id, family: p.family, side: p.side, team: p.team, line: p.line, odds: p.odds, y, p_gp: p.p_gp, p_market: p.p_market,
    pRound_prod: r4(prProd), p_map_prod: pMapProd != null ? r4(pMapProd) : null, abs_dev_prod: r4(Math.abs(prProd - 0.5) / 0.44),
    p_map_h1: pm != null ? r4(pm) : null, home_won_map: rm ? (rm.s1 > rm.s2 ? 1 : 0) : null, real_map: rm ? rm.map : null };
  if (pm != null && p.family !== 'RONDAS') {
    // re-cotización corregida (H2-V1) con p_mapa H1, perfil circuito
    const Rc = sim(pRoundFor(pm)); const pc = probOf(p, Rc);
    const Ra = sim(clampRound(pm)); const pa = probOf(p, Ra);
    row.corr = { p: r4(pc), edge_pp: r2((pc - p.p_market) * 100), nace: gate(p, (pc - p.p_market) * 100) };
    row.actual_h1 = { p: r4(pa), edge_pp: r2((pa - p.p_market) * 100), nace: gate(p, (pa - p.p_market) * 100) };
  }
  out.push(row);
}
const RH = out.filter((r) => r.family === 'RONDAS_HANDICAP'), RE = out.filter((r) => r.family === 'RONDAS_EQUIPO'), RO = out.filter((r) => r.family === 'RONDAS');
// 1) p_mapa implícita de producción vs H1
const diag = {};
for (const [k, rows2] of [['RONDAS_HANDICAP', RH], ['RONDAS_EQUIPO', RE]]) {
  const withMap = rows2.filter((r) => r.home_won_map != null && r.p_map_h1 != null);
  const favProdWon = withMap.filter((r) => (r.p_map_prod >= 0.5) === (r.home_won_map === 1)).length;
  const favH1Won = withMap.filter((r) => (r.p_map_h1 >= 0.5) === (r.home_won_map === 1)).length;
  const agree = withMap.filter((r) => (r.p_map_prod >= 0.5) === (r.p_map_h1 >= 0.5)).length;
  // el equipo ELEGIDO en el hándicap: side home → local; away → visitante
  const chosenWon = k === 'RONDAS_HANDICAP' ? withMap.filter((r) => (r.side === 'home') === (r.home_won_map === 1)).length : null;
  const brierProd = mean(withMap.map((r) => (r.p_map_prod - r.home_won_map) ** 2)), brierH1 = mean(withMap.map((r) => (r.p_map_h1 - r.home_won_map) ** 2));
  diag[k] = { n: rows2.length, n_con_mapa: withMap.length, abs_dev_p_map_prod_medio: r4(mean(rows2.map((r) => Math.abs(r.p_map_prod - 0.5)))), abs_dev_p_map_h1_medio: r4(mean(rows2.filter((r) => r.p_map_h1 != null).map((r) => Math.abs(r.p_map_h1 - 0.5)))),
    p_map_prod_extrema_pct: r2(100 * rows2.filter((r) => Math.abs(r.p_map_prod - 0.5) >= 0.15).length / rows2.length),
    fav_prod_gano_mapa_pct: r2(100 * favProdWon / withMap.length), fav_h1_gano_mapa_pct: r2(100 * favH1Won / withMap.length), prod_y_h1_coinciden_pct: r2(100 * agree / withMap.length),
    equipo_elegido_gano_mapa_pct: chosenWon != null ? r2(100 * chosenWon / withMap.length) : null,
    brier_mapa_prod: r4(brierProd), brier_mapa_h1: r4(brierH1), brier_mapa_moneda: 0.25 };
}
diag.RONDAS = { n: RO.length, abs_dev_p_map_prod_medio: r4(mean(RO.map((r) => r.abs_dev_prod))), abs_dev_p_map_h1_medio: r4(mean(RO.filter((r) => r.p_map_h1 != null).map((r) => Math.abs(r.p_map_h1 - 0.5)))), nota: 'para totales solo se recupera |p−0,5| (simétrico)' };
console.log('[h5] p_mapa implícita en producción vs H1:'); console.table(diag);
// 3) re-cotización
const req = {};
for (const [k, rows2] of [['RONDAS_HANDICAP', RH], ['RONDAS_EQUIPO', RE]]) {
  const rr = rows2.filter((r) => r.corr);
  const born = rr.filter((r) => r.corr.nace), bornA = rr.filter((r) => r.actual_h1.nace);
  const roi = (b) => (b.length ? r2(100 * mean(b.map((r) => (r.y ? r.odds - 1 : -1)))) : null);
  req[k] = { n: rr.length, original: { nacen: rr.length, win: rr.filter((r) => r.y).length, roi_pct: roi(rr), brier: r4(mean(rr.map((r) => (r.p_gp - r.y) ** 2))) },
    actual_con_p_h1: { nacen: bornA.length, win: bornA.filter((r) => r.y).length, roi_pct: roi(bornA), brier: r4(mean(rr.map((r) => (r.actual_h1.p - r.y) ** 2))), edge_medio: r2(mean(rr.map((r) => r.actual_h1.edge_pp))) },
    corregido_con_p_h1: { nacen: born.length, win: born.filter((r) => r.y).length, roi_pct: roi(born), brier: r4(mean(rr.map((r) => (r.corr.p - r.y) ** 2))), edge_medio: r2(mean(rr.map((r) => r.corr.edge_pp))) },
    brier_mercado_bruto: r4(mean(rr.map((r) => (r.p_market - r.y) ** 2))) };
}
console.log('[h5] re-cotización con p_mapa H1 (perfil circuito), gate de producción:'); console.log(JSON.stringify(req, null, 1));
fs.writeFileSync(path.join(HERE, 'h5_result.json'), JSON.stringify({ at: new Date().toISOString(), eco_circuito: ECO, diag, requote: req, picks: out }, null, 1));
console.log('[h5] escrito h5_result.json');
