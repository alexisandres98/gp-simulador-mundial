// scripts/smoke/valorant-smoke.js — humo del motor de Valorant tras las mejoras del 2-sep.
// Sin red, sin servidor, sin disco escrito: requiere los módulos del engine y comprueba tres cosas.
//   1. `pRoundFor` invierte bien la simulación: con el pRound resuelto, P(A gana el mapa) ≈ p_mapa (±0,015)
//      para p ∈ {0,55, 0,70, 0,80}; y se enseña lo que daba el viejo ×0,44 (0,70 → ~0,82).
//   2. `analyze()` con mercado y ratings sintéticos (5 mapas de fuerza) publica `map_anchoring`,
//      `rounds.p_round_solved` y `rounds_by_map`, y la serie simulada reproduce la serie anclada.
//   3. `cs2.js` sigue cargando y conserva su `clampRound` (no se toca).
// Uso: node scripts/smoke/valorant-smoke.js   → sale con código 1 si algo no cuadra.
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(path.join(ROOT, 'esports-engine/core'));
const V = require(path.join(ROOT, 'esports-engine/valorant'));

let fallos = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK   ' : '  FALLO') + ' ' + msg); if (!cond) fallos++; };
const oldClamp = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.44, 0.32, 0.68);

console.log('[1] pRound por bisección vs ×0,44 (bias 0,51, eco 0,065, 20.000 sims)');
for (const p of [0.55, 0.70, 0.80]) {
  const pr = V.pRoundFor(p, 0.51, 0.065);
  const R = V.mapRounds(pr, 0.51, { eco: 0.065, sims: 20000 });
  const O = V.mapRounds(oldClamp(p), 0.51, { eco: 0.065, sims: 20000 });
  console.log(`      p_mapa ${p}: pRound ${pr} → p_win_a ${R.p_win_a} (viejo ×0,44: pRound ${C.r3(oldClamp(p))} → ${O.p_win_a}) · media ${R.mean_rounds} rondas · prórroga ${R.overtime_p}`);
  ok(Math.abs(R.p_win_a - p) <= 0.015, `p_win_a ≈ ${p} (±0,015)`);
  if (p === 0.70) ok(O.p_win_a > 0.80, 'el viejo ×0,44 daba ~0,82 con p 0,70 (lo que el backtest midió)');
}
ok(V.pRoundFor(0.70, 0.51, 0.065) === V.pRoundFor(0.70, 0.51, 0.065), 'cache estable por (p, bias, eco)');

console.log('[2] analyze() con mercado y ratings sintéticos (BO3, 5 mapas)');
const market = { markets: [
  { family: 'SERIE', side: 'home', odds: 1.55, book: 'x' }, { family: 'SERIE', side: 'away', odds: 2.55, book: 'x' },
  { family: 'RONDAS', side: 'over', line: 21.5, map: 1, odds: 1.90, book: 'x' }, { family: 'RONDAS', side: 'under', line: 21.5, map: 1, odds: 1.90, book: 'x' },
] };
const maps = ['ascent', 'haven', 'lotus', 'sunset', 'pearl'];
const strength = { a: {}, b: {} };
[0.66, 0.58, 0.50, 0.44, 0.38].forEach((p, i) => { strength.a[maps[i]] = p; strength.b[maps[i]] = C.r3(1 - p); });
const ratings = { elo_a: 1580, elo_b: 1500, map_strength: strength };
const m = V.analyze({ market, ratings, bo: 3, sample: 40 });
console.log('      probabilidad:', JSON.stringify(m.probability));
console.log('      map_anchoring:', JSON.stringify(m.map_anchoring));
console.log('      rounds:', JSON.stringify({ map: m.rounds.map, p_map_a: m.rounds.p_map_a, p_map_a_model: m.rounds.p_map_a_model,
  p_round_solved: m.rounds.p_round_solved, p_map_target: m.rounds.p_map_target, p_map_sim: m.rounds.p_map_sim,
  dist_method: m.rounds.dist_method, mean_rounds: m.rounds.mean_rounds, overtime_p: m.rounds.overtime_p, measured: m.rounds.measured }));
for (const [k, r] of Object.entries(m.rounds_by_map || {})) {
  console.log(`      rounds_by_map[${k}]:`, JSON.stringify({ map: r.map, p_map_a: r.p_map_a, p_map_a_model: r.p_map_a_model,
    p_round_solved: r.p_round_solved, p_map_sim: r.p_map_sim, mean_rounds: r.mean_rounds, overtime_p: r.overtime_p }));
}
console.log('      simulación de serie:', JSON.stringify({ p_series_a: m.simulation.p_series_a, scores: m.simulation.scores }));
ok(m.probability && m.probability.max_model === 0.25 && m.probability.temperature === 0.85, 'nivel de serie: maxModel 0,25 y temperatura 0,85');
ok(m.probability && m.probability.w_model <= 0.25, `peso propio ≤ 0,25 (sale ${m.probability && m.probability.w_model})`);
ok(m.map_anchoring && m.map_anchoring.bracketed, 'map_anchoring resuelto por bisección');
ok(Math.abs(m.simulation.p_series_a - m.probability.p) <= 0.02, `serie simulada sobre mapas anclados ≈ serie anclada (${m.simulation.p_series_a} vs ${m.probability.p})`);
ok(m.rounds && m.rounds.dist_method === 'bisect' && m.rounds.p_round_solved != null, 'rounds trae p_round_solved y dist_method bisect');
ok(m.rounds && Math.abs(m.rounds.p_map_sim - m.rounds.p_map_target) <= 0.015, 'rounds: p_map_sim ≈ p_map_target');
ok(m.rounds_by_map && Object.keys(m.rounds_by_map).length >= 3, 'rounds_by_map con al menos tres mapas');
ok(Object.values(m.rounds_by_map || {}).every((r) => Math.abs(r.p_map_sim - r.p_map_target) <= 0.015), 'rounds_by_map: cada mapa reproduce su p anclada');
ok(m.veto.likely_maps.every((x) => x.p_a != null) && m.map_anchoring.maps.every((x) => x.p_a_model != null), 'veto conserva p_a del modelo y map_anchoring.maps lleva p_a_model');
// el desplazamiento conserva la FORMA: el orden de los mapas por p_a no cambia al anclar
const orderModel = m.map_anchoring.maps.slice().sort((x, y) => y.p_a_model - x.p_a_model).map((x) => x.map).join(',');
const orderAnch = m.map_anchoring.maps.slice().sort((x, y) => y.p_a - x.p_a).map((x) => x.map).join(',');
ok(orderModel === orderAnch, 'el anclaje conserva el orden de los mapas (forma del veto)');

console.log('[2b] analyze() con mercado DIRECTO de mapa (anchor.p_map manda sobre el mapa 1)');
const marketMapa = { markets: [
  { family: 'MAPA', map: 1, side: 'home', odds: 1.40, book: 'x' }, { family: 'MAPA', map: 1, side: 'away', odds: 3.00, book: 'x' },
] };
const m2 = V.analyze({ market: marketMapa, ratings, bo: 3, sample: 40 });
console.log('      market_anchor:', JSON.stringify(m2.market_anchor));
console.log('      map_anchoring:', JSON.stringify({ shift_logit: m2.map_anchoring.shift_logit, p_map_market: m2.map_anchoring.p_map_market, from: m2.map_anchoring.p_map_market_from, maps: m2.map_anchoring.maps }));
ok(m2.market_anchor.p_map != null && m2.rounds.p_map_a === C.r4(m2.market_anchor.p_map), `el mapa 1 usa el precio directo del mercado (${m2.rounds.p_map_a})`);

console.log('[2c] analyze() sin fuerza por mapa (solo Elo + serie): estructura sin veto, sin rounds_by_map');
const m3 = V.analyze({ market, ratings: { elo_a: 1580, elo_b: 1500 }, bo: 3, sample: 40 });
ok(m3.rounds && m3.rounds.dist_method === 'bisect' && m3.rounds_by_map == null && m3.map_anchoring == null, 'sin veto: rounds por bisección, sin anclaje por mapa ni tabla por mapa');

console.log('[3] veto: el mapa sin composición se veta MÁS, no menos');
// el pool del circuito (medido) es el que usa analyze(); el escrito a mano no lista pearl
const VD = require(path.join(ROOT, 'esports-engine/valorant-data'));
const pool = (VD.circuitPool() || V.MAP_POOL).filter((mp) => maps.includes(mp.key));
const depth = { a: { ascent: 1, haven: 1, lotus: 1, sunset: 1, pearl: 0.2 }, b: {} };
const vt0 = V.vetoTree(strength, { bo: 3, pool }), vt1 = V.vetoTree(strength, { bo: 3, pool, depth });
console.log('      secuencia:', vt0.sequence.map((s) => `${s.who} ${s.kind} ${s.map}`).join(' · '), '→ decisivo', vt0.decider && vt0.decider.map);
ok(vt0.likely_maps.length === 3 && vt0.decider != null, 'con 5 mapas el BO3 deja dos picks y un decisivo (no se veta el último)');
const banP = (vt, k) => vt.ban_probabilities.a.find((x) => x.map === k).p;
const pickP = (vt, k) => vt.pick_probabilities.a.find((x) => x.map === k).p;
console.log(`      pearl (A sin composición): ban ${banP(vt0, 'pearl')} → ${banP(vt1, 'pearl')} · pick ${pickP(vt0, 'pearl')} → ${pickP(vt1, 'pearl')}`);
ok(banP(vt1, 'pearl') > banP(vt0, 'pearl'), 'la falta de composición SUBE la probabilidad de veto');
ok(pickP(vt1, 'pearl') < pickP(vt0, 'pearl'), 'la falta de composición BAJA la probabilidad de elección');
ok(vt0.sequence[0].map === 'pearl', 'A veta primero el mapa donde el rival es más fuerte (pearl)');

console.log('[4] cs2.js intacto');
const CS = require(path.join(ROOT, 'esports-engine/cs2'));
ok(typeof CS.analyze === 'function' && typeof CS.mapRounds === 'function', 'cs2.js carga');
ok(V.mapRounds(0.5, 0.51, { sims: 2000 }).dist.margin.h['0'] == null, 'ningún mapa acaba empatado');

console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : '\nTodo en orden');
process.exit(fallos ? 1 : 0);
