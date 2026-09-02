// H4 — re-cotizar las picks UNDER de RONDAS del libro con la distribución corregida de H2.
// p_mapa: rating final de H1 (Elo por mapa con temperatura; point-in-time: última serie 17-ago, picks ≥18-ago).
// (El libro no guarda la probabilidad de serie del mercado, así que la aproximación "p_market de la serie"
// no es posible; se declara.) Perfil de rondas: (a) medio del circuito —lo que se sabe al nacer la pick sin
// veto—; (b) el del mapa REAL (look-ahead solo en la identidad del mapa, para acotar).
// Gate de producción reproducido con los campos guardados en la pick: ventaja ≥ 3 pp (+2,5 si una sola
// casa), ventaja ≥ 0,75·uncertainty_pp, y ventaja > calibration_pp cuando ésta es > 0 (store.js:784-803).
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
const book = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'es_full_valorant.json'), 'utf8')).recent;
const lg = (p) => Math.log(p / (1 - p)), sg = (x) => 1 / (1 + Math.exp(-x));
const r4 = (x) => +x.toFixed(4), r2 = (x) => +x.toFixed(2);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

// perfil y eco (misma réplica que H2)
const rows = MS.rows.filter((r) => r.in_rotation && r.n >= 40); const wN = rows.reduce((s, r) => s + r.n, 0);
const circuit = { name: null, bias: 1 - rows.reduce((s, r) => s + r.n * r.atk_round_share, 0) / wN, ot: rows.reduce((s, r) => s + r.n * r.overtime_p, 0) / wN };
function fitEco(bias, targetOt) { let lo = 0, hi = 0.18; for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; const ot = V.mapRounds(0.5, bias, { eco: mid, sims: 6000, seed: 4127 }).overtime_p; if (ot > targetOt) lo = mid; else hi = mid; } return +((lo + hi) / 2).toFixed(3); }
const ecoCache = new Map();
const ecoFor = (prof) => { const k = prof.name || 'c'; if (!ecoCache.has(k)) ecoCache.set(k, fitEco(prof.bias, prof.ot)); return ecoCache.get(k); };
const profileOf = (m) => { const r = MS.rows.find((x) => x.map.toLowerCase() === String(m).toLowerCase()); return r && r.n >= 40 ? { name: r.map, bias: 1 - r.atk_round_share, ot: r.overtime_p } : null; };
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.44, 0.32, 0.68);
const pWin = (R) => Object.entries(R.dist.margin.h).reduce((s, [k, p]) => s + (+k > 0 ? p : 0), 0);
const invCache = new Map();
function pRoundFor(p, prof) {
  const eco = ecoFor(prof); const key = [p.toFixed(3), prof.name].join('|'); if (invCache.has(key)) return invCache.get(key);
  let lo = 0.2, hi = 0.8; for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; const pw = pWin(V.mapRounds(mid, prof.bias, { eco, sims: 6000, seed: 911 })); if (pw < p) lo = mid; else hi = mid; }
  const v = (lo + hi) / 2; invCache.set(key, v); return v;
}
const vd = VD.load();
const slugOf = (name) => VD.norm(name).replace(/ /g, '-');
const bySlug = {}; for (const [team, r] of Object.entries(FR.teams)) bySlug[slugOf(team)] = r;
const pMapOf = (home, away) => { const a = VD.resolveTeam(home, { data: vd }), b = VD.resolveTeam(away, { data: vd }); if (!a || !b || !bySlug[a] || !bySlug[b]) return null;
  const pm = 1 / (1 + Math.pow(10, (bySlug[b].elo_map - bySlug[a].elo_map) / 400)); return sg(FR.temperatura * lg(Math.min(0.97, Math.max(0.03, pm)))); };

const unders = book.filter((p) => p.family === 'RONDAS' && p.side === 'under' && (p.result_code === 'WIN' || p.result_code === 'LOSS'));
console.log(`[h4] ${unders.length} picks under de RONDAS (${unders.filter((p) => p.result_code === 'WIN').length} WIN)`);
// mapa real jugado (del detalle) para el índice de mapa de la pick
const realMap = (p) => { if (!p.final || !p.final.detail) return null; const segs = p.final.detail.split('·').map((x) => x.trim()); const s = segs[p.map - 1]; if (!s) return null; const m = s.match(/^([A-Za-z ]+?)\s+(\d+)-(\d+)/); return m ? { map: m[1].trim(), tot: +m[2] + +m[3] } : null; };

const gate = (p, edgePp) => {
  const single = !p.books_quoting || p.books_quoting < 2;
  const bar = 3 + (single ? 2.5 : 0);
  const ok = edgePp >= bar && edgePp >= 0.75 * p.uncertainty_pp && !(p.calibration_pp > 0 && edgePp <= p.calibration_pp);
  return ok;
};
const out = [];
let noRating = 0;
for (const p of unders) {
  const pm = pMapOf(p.home, p.away);
  if (pm == null) { noRating++; continue; }
  const rm = realMap(p);
  const profReal = rm && profileOf(rm.map);
  const y = p.result_code === 'WIN' ? 1 : 0;
  const q = (prof, corrected) => {
    const pr = corrected ? pRoundFor(pm, prof) : clampRound(pm);
    const R = V.mapRounds(pr, prof.bias, { eco: ecoFor(prof), sims: 20000, seed: 29 });
    return { p_under: C.pUnder(R.dist.total, p.line), mean: R.mean_rounds, pr };
  };
  const variants = {
    actual_circuito: q(circuit, false), corregido_circuito: q(circuit, true),
    actual_mapa_real: profReal ? q(profReal, false) : null, corregido_mapa_real: profReal ? q(profReal, true) : null,
  };
  const row = { pick_id: p.pick_id, home: p.home, away: p.away, map: p.map, real_map: rm ? rm.map : null, real_total: rm ? rm.tot : null, line: p.line, odds: p.odds, book: p.book, books: p.books_quoting,
    p_gp_orig: p.p_gp, edge_orig: p.edge_pp, p_market: p.p_market, y, p_map_h1: r4(pm), unc: p.uncertainty_pp, calpp: p.calibration_pp };
  for (const [k, v] of Object.entries(variants)) {
    if (!v) continue;
    const edge = (v.p_under - p.p_market) * 100;
    row[k] = { p_under: r4(v.p_under), edge_pp: r2(edge), nace: gate(p, edge), mean_rounds: v.mean, pRound: r4(v.pr) };
  }
  out.push(row);
}
console.log(`[h4] ${out.length} re-cotizadas (${noRating} sin rating resoluble)`);
function summary(key) {
  const rows = out.filter((r) => r[key]); const born = rows.filter((r) => r[key].nace);
  const units = born.reduce((s, r) => s + (r.y ? r.odds - 1 : -1), 0);
  return { n: rows.length, nacen: born.length, win: born.filter((r) => r.y).length, roi_pct: born.length ? r2(100 * units / born.length) : null,
    p_under_medio: r4(mean(rows.map((r) => r[key].p_under))), brier_p_under: r4(mean(rows.map((r) => (r[key].p_under - r.y) ** 2))),
    edge_medio_pp: r2(mean(rows.map((r) => r[key].edge_pp))), mean_rounds_medio: r2(mean(rows.map((r) => r[key].mean_rounds))) };
}
const S = { original: { n: out.length, nacen: out.length, win: out.filter((r) => r.y).length, roi_pct: r2(100 * mean(out.map((r) => (r.y ? r.odds - 1 : -1)))), p_under_medio: r4(mean(out.map((r) => r.p_gp_orig))), brier_p_under: r4(mean(out.map((r) => (r.p_gp_orig - r.y) ** 2))), edge_medio_pp: r2(mean(out.map((r) => r.edge_orig))), brier_mercado_bruto: r4(mean(out.map((r) => (r.p_market - r.y) ** 2))) } };
for (const k of ['actual_circuito', 'corregido_circuito', 'actual_mapa_real', 'corregido_mapa_real']) S[k] = summary(k);
console.table(S);
console.log(`[h4] línea media ${r2(mean(out.map((r) => r.line)))}, total real medio ${r2(mean(out.filter((r) => r.real_total).map((r) => r.real_total)))} (n=${out.filter((r) => r.real_total).length}), p_map_h1 medio del local ${r4(mean(out.map((r) => r.p_map_h1)))}, |p−0,5| medio ${r4(mean(out.map((r) => Math.abs(r.p_map_h1 - 0.5))))}`);
// ¿cuánto de la p_gp original se explica por una p_mapa extrema? implícita: qué pRound reproduce p_gp_orig con el perfil circuito
fs.writeFileSync(path.join(HERE, 'h4_result.json'), JSON.stringify({ at: new Date().toISOString(), n_unders: unders.length, sin_rating: noRating, resumen: S, picks: out }, null, 1));
console.log('[h4] escrito h4_result.json');
