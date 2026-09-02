// H2 — distribución de rondas por mapa: empírica vs esports-engine/valorant.js mapRounds.
// Empírica: (1) BO1 de series.json (el marcador de serie ES el de rondas: 13-x o prórroga 14-12, 15-13…),
//           con p_mapa point-in-time del predictor ganador de H1 (h1_preds.json);
//           (2) mapas de las 51 series del libro de picks con detalle ("Lotus 13-10 · Sunset 13-10"), con
//           p_mapa del rating final de H1 (válido: la última serie es del 17-ago y las picks empiezan el 18).
// Modelo: mapRounds(clampRound(p), bias, {eco}) — clampRound = 0,5 + (p−0,5)·0,44 (valorant.js:368);
//         bias y eco del perfil medio del circuito (map-stats.json) con el eco ajustado por bisección a la
//         prórroga, igual que calibrateDrag; para los mapas del libro, el perfil del mapa real (look-ahead
//         declarado en la identidad del mapa, no en el resultado).
// Correcciones evaluadas (ajustadas en desarrollo ≤ 2025-06-30, evaluadas en 2025-07 → 2026-08 + libro):
//   V1  pRound por bisección para que P(A gana el mapa | sim) = p   (consistencia interna; sustituye ×0,44)
//   V2  V1 + eco reajustado a la prórroga con la nueva escala
//   V3  V2 + heterogeneidad: pRound ~ N(pRound, σ) por mapa (ensancha totales); σ elegido en desarrollo
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = '/home/user/gp-simulador-mundial';
const HERE = __dirname;
const C = require(path.join(REPO, 'esports-engine/core.js'));
const V = require(path.join(REPO, 'esports-engine/valorant.js'));
const VD = require(path.join(REPO, 'esports-engine/valorant-data.js'));
const RESEARCH = '/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research';

const H1 = JSON.parse(fs.readFileSync(path.join(HERE, 'h1_preds.json'), 'utf8'));
const FR = JSON.parse(fs.readFileSync(path.join(HERE, 'h1_final_ratings.json'), 'utf8'));
const MS = JSON.parse(fs.readFileSync(path.join(REPO, 'data/esports/valorant/map-stats.json'), 'utf8'));
const lg = (p) => Math.log(p / (1 - p)), sg = (x) => 1 / (1 + Math.exp(-x));
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r3 = (x) => +x.toFixed(3), r2 = (x) => +x.toFixed(2), r4 = (x) => +x.toFixed(4);

// ── perfil medio del circuito ────────────────────────────────────────────────────────────────────────────
const rows = MS.rows.filter((r) => r.in_rotation && r.n >= 40);
const wN = rows.reduce((s, r) => s + r.n, 0);
const circuit = {
  n: wN, mean_rounds: rows.reduce((s, r) => s + r.n * r.mean_rounds, 0) / wN,
  overtime_p: rows.reduce((s, r) => s + r.n * r.overtime_p, 0) / wN,
  atk: rows.reduce((s, r) => s + r.n * r.atk_round_share, 0) / wN,
};
circuit.def_round_share = 1 - circuit.atk;
console.log('[h2] perfil medio del circuito (map-stats, 180 d):', JSON.stringify({ n: wN, mean_rounds: r2(circuit.mean_rounds), overtime_p: r4(circuit.overtime_p), def_round_share: r3(circuit.def_round_share) }));

// réplica de calibrateDrag (no exportada): bisección del eco para reproducir la prórroga a p=0,5
function fitEco(bias, targetOt, pRoundAt05 = 0.5, sims = 6000) {
  let lo = 0, hi = 0.18;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; const ot = V.mapRounds(pRoundAt05, bias, { eco: mid, sims, seed: 4127 }).overtime_p; if (ot > targetOt) lo = mid; else hi = mid; }
  return +((lo + hi) / 2).toFixed(3);
}
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.44, 0.32, 0.68);
const ecoCircuit = fitEco(circuit.def_round_share, circuit.overtime_p);
const profileOf = (mapName) => { const r = MS.rows.find((x) => x.map.toLowerCase() === String(mapName).toLowerCase()); return r && r.n >= 40 && r.atk_round_share != null ? { bias: 1 - r.atk_round_share, ot: r.overtime_p, mean: r.mean_rounds, name: r.map } : null; };
const ecoCache = new Map();
const ecoFor = (prof) => { const k = prof.name || 'circuit'; if (!ecoCache.has(k)) ecoCache.set(k, prof.name ? fitEco(prof.bias, prof.ot) : ecoCircuit); return ecoCache.get(k); };
console.log(`[h2] eco ajustado al circuito = ${ecoCircuit} (producción usa el de cada mapa; ECO_DRAG por defecto 0,065)`);

// ── simulador local con los mismos mecanismos que mapRounds + heterogeneidad opcional ────────────────────
function simRounds(pRound, bias, { eco, sims = 20000, seed = 29, sigma = 0 } = {}) {
  const rnd = C.rng(seed);
  const d = bias - 0.5;
  const tot = [], marg = [], ra = [], rb = []; let otN = 0;
  for (let i = 0; i < sims; i++) {
    let pr = pRound;
    if (sigma > 0) { const u1 = Math.max(1e-12, rnd()), u2 = rnd(); pr = C.clamp(pr + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2), 0.1, 0.9); }
    const pDef = C.clamp(pr + d, 0.10, 0.90), pAtk = C.clamp(pr - d, 0.10, 0.90);
    let a = 0, b = 0, st = 0;
    const play = (p) => { if (rnd() < C.clamp(p + st * eco, 0.05, 0.95)) { a++; st = Math.min(2, st <= 0 ? 1 : st + 1); } else { b++; st = Math.max(-2, st >= 0 ? -1 : st - 1); } };
    for (let r = 0; r < 12 && a < 13 && b < 13; r++) play(pDef);
    for (let r = 0; r < 12 && a < 13 && b < 13; r++) play(pAtk);
    let ot = 0;
    while (a === b && a >= 12) { ot++; play(pDef); play(pAtk); if (ot > 10) break; }
    if (ot) otN++;
    tot.push(a + b); marg.push(a - b); ra.push(a); rb.push(b);
  }
  return { tot, marg, ra, rb, ot_p: otN / sims, n: sims };
}
// P(A gana) de una simulación
const pWinOf = (S) => S.marg.filter((m) => m > 0).length / S.n;
// pRound tal que P(A gana | sim) = p — bisección (la corrección V1)
const invCache = new Map();
function pRoundFor(p, bias, eco, sigma = 0) {
  const key = [p.toFixed(3), bias.toFixed(3), eco, sigma].join('|');
  if (invCache.has(key)) return invCache.get(key);
  let lo = 0.2, hi = 0.8;
  for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; const pw = pWinOf(simRounds(mid, bias, { eco, sims: 6000, seed: 911, sigma })); if (pw < p) lo = mid; else hi = mid; }
  const v = (lo + hi) / 2; invCache.set(key, v); return v;
}
// estadísticos de un vector de mapas {tot, marg}
function stats(S) {
  const n = S.tot.length;
  const f = (pred, arr) => arr.filter(pred).length / n;
  return { n, mean_total: r2(mean(S.tot)), sd_total: r2(sd(S.tot)), p_ot: r4(f((t) => t > 24, S.tot)), p_total_le20: r4(f((t) => t <= 20, S.tot)),
    p_total_le21: r4(f((t) => t <= 21, S.tot)), p_total_ge23: r4(f((t) => t >= 23, S.tot)),
    p_A_wins: r4(f((m) => m > 0, S.marg)), mean_abs_margin: r2(mean(S.marg.map(Math.abs))), p_absmargin_le3: r4(f((m) => Math.abs(m) <= 3, S.marg)),
    p_absmargin_ge7: r4(f((m) => Math.abs(m) >= 7, S.marg)) };
}

// ── empírica 1: BO1 de series.json ───────────────────────────────────────────────────────────────────────
const valid = (s1, s2) => { const w = Math.max(s1, s2), l = Math.min(s1, s2); return (w === 13 && l <= 11) || (w >= 14 && w - l === 2); };
const bo1 = H1.rows.filter((r) => r.bo1rounds && valid(r.s1, r.s2)).map((r) => ({ ...r, tot: r.s1 + r.s2, marg: r.s1 - r.s2, src: 'bo1' }));
console.log(`[h2] BO1 válidos: ${bo1.length} (cualificados ${bo1.filter((r) => r.qual).length}); ≥2023: ${bo1.filter((r) => r.at >= '2023').length}; ≥2025: ${bo1.filter((r) => r.at >= '2025').length}`);

// ── empírica 2: mapas del libro de picks ────────────────────────────────────────────────────────────────
const book = JSON.parse(fs.readFileSync(path.join(RESEARCH, 'es_full_valorant.json'), 'utf8')).recent;
const vd = VD.load();
const slugOf = (name) => VD.norm(name).replace(/ /g, '-');
const bySlug = {}; for (const [team, r] of Object.entries(FR.teams)) bySlug[slugOf(team)] = { team, ...r };
const rate = (name) => { const id = VD.resolveTeam(name, { data: vd }); return id && bySlug[id] ? bySlug[id] : null; };
const pMapFinal = (home, away) => {
  const A = rate(home), B = rate(away); if (!A || !B) return null;
  const pM = 1 / (1 + Math.pow(10, (B.elo_map - A.elo_map) / 400));
  return { p: sg(FR.temperatura * lg(Math.min(0.97, Math.max(0.03, pM)))), nA: A.series, nB: B.series };
};
const events = {}; for (const p of book) if (p.final && p.final.detail) events[p.event_id] = { home: p.home, away: p.away, detail: p.final.detail, start: p.start_at };
const bookMaps = [];
let unresolved = 0;
for (const [eid, e] of Object.entries(events)) {
  const pm = pMapFinal(e.home, e.away); if (!pm) { unresolved++; }
  e.detail.split('·').map((x) => x.trim()).forEach((seg, i) => {
    const m = seg.match(/^([A-Za-z ]+?)\s+(\d+)-(\d+)(\s+OT)?$/); if (!m) return;
    const s1 = +m[2], s2 = +m[3]; if (!valid(s1, s2)) return;
    bookMaps.push({ event: eid, map: m[1].trim(), idx: i + 1, s1, s2, tot: s1 + s2, marg: s1 - s2, p_win: pm ? pm.p : null, src: 'book', at: e.start.slice(0, 10) });
  });
}
console.log(`[h2] mapas del libro: ${bookMaps.length} en ${Object.keys(events).length} series (${unresolved} series sin rating resoluble)`);

// ── comparación por tramo del favorito (q = p del favorito según el predictor; margen orientado al favorito) ─
function orient(r) { const fav = r.p_win >= 0.5; return { q: fav ? r.p_win : 1 - r.p_win, tot: r.tot, marg: fav ? r.marg : -r.marg }; }
const TRAMOS = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.7], [0.7, 1.01]];
function empiricalByTramo(recs) {
  const out = [];
  for (const [lo, hi] of TRAMOS) {
    const sub = recs.filter((r) => r.p_win != null).map(orient).filter((o) => o.q >= lo && o.q < hi);
    if (!sub.length) continue;
    out.push({ tramo: `${lo}-${Math.min(1, hi)}`, q_medio: r3(mean(sub.map((o) => o.q))), ...stats({ tot: sub.map((o) => o.tot), marg: sub.map((o) => o.marg) }) });
  }
  return out;
}
function modelAtTramo(emp, variant, prof) {
  const eco = variant.eco != null ? variant.eco : ecoFor(prof);
  const pr = variant.inv ? pRoundFor(emp.q_medio, prof.bias, eco, variant.sigma || 0) : clampRound(emp.q_medio);
  const S = simRounds(pr, prof.bias, { eco, sigma: variant.sigma || 0, sims: 30000 });
  return { tramo: emp.tramo, pRound: r3(pr), ...stats(S) };
}
const BASE = { name: 'actual (×0,44, eco calibrado a la prórroga)', inv: false };

// tabla empírica global (sin p) para varias ventanas + circuito
const windows = { 'bo1_2023+': bo1.filter((r) => r.at >= '2023'), 'bo1_2025+': bo1.filter((r) => r.at >= '2025'), 'libro_2026': bookMaps };
const empGlobal = {};
for (const [k, recs] of Object.entries(windows)) empGlobal[k] = stats({ tot: recs.map((r) => r.tot), marg: recs.map((r) => r.marg) });
console.log('\n[h2] totales/márgenes empíricos (sin condicionar):'); console.table(empGlobal);
console.log(`[h2] referencia map-stats (2.716 mapas, 180 d): media ${r2(circuit.mean_rounds)} · prórroga ${r4(circuit.overtime_p)}`);
const S0 = simRounds(0.5, circuit.def_round_share, { eco: ecoCircuit, sims: 40000 });
console.log('[h2] modelo actual a p=0,5, perfil circuito:', JSON.stringify(stats(S0)));

// por tramo, en la ventana de DESARROLLO y en la de EVALUACIÓN (BO1 cualificados con p)
const DEV_END = '2025-06-30';
const devRecs = bo1.filter((r) => r.qual && r.at >= '2022-01-01' && r.at <= DEV_END);
const evalRecs = bo1.filter((r) => r.qual && r.at > DEV_END);
console.log(`\n[h2] desarrollo BO1 cualificados 2022-01→${DEV_END}: ${devRecs.length}; evaluación >${DEV_END}: ${evalRecs.length}; libro: ${bookMaps.filter((r) => r.p_win != null).length}`);
const empDev = empiricalByTramo(devRecs);
console.log('[h2] EMPÍRICO desarrollo por tramo de p del favorito:'); console.table(empDev);
const modDev = empDev.map((e) => modelAtTramo(e, BASE, { bias: circuit.def_round_share, ot: circuit.overtime_p }));
console.log('[h2] MODELO ACTUAL en esos tramos:'); console.table(modDev);

// ── correcciones: elegir en desarrollo ──────────────────────────────────────────────────────────────────
// métrica de ajuste: Brier medio sobre un panel de mercados derivados (over/under 19,5…23,5; hándicap del
// favorito −8,5…+2,5; ganador) evaluado mapa a mapa con la distribución simulada a SU p.
const LINES_T = [19.5, 20.5, 21.5, 22.5, 23.5];
const LINES_H = [-8.5, -6.5, -4.5, -2.5, -1.5, 1.5, 2.5];
const simCache = new Map();
function distFor(p, prof, variant) {
  const eco = variant.eco != null ? variant.eco : ecoFor(prof);
  const key = [variant.name, p.toFixed(2), prof.name || 'c'].join('|');
  if (simCache.has(key)) return simCache.get(key);
  const pr = variant.inv ? pRoundFor(+p.toFixed(2), prof.bias, eco, variant.sigma || 0) : clampRound(p);
  const S = simRounds(pr, prof.bias, { eco, sigma: variant.sigma || 0, sims: 20000, seed: 29 });
  const H = { over: {}, cover: {}, pwin: pWinOf(S), mean: mean(S.tot), ot: S.ot_p };
  for (const L of LINES_T) H.over[L] = S.tot.filter((t) => t > L).length / S.n;
  for (const h of LINES_H) H.cover[h] = S.marg.filter((m) => m + h > 0).length / S.n;   // favorito cubre h
  simCache.set(key, H); return H;
}
function panel(recs, variant, useMapProfile = false) {
  let n = 0, bT = 0, nT = 0, bH = 0, nH = 0, bW = 0, meanErr = 0, otErr = 0;
  const perMap = [];
  for (const r of recs) {
    if (r.p_win == null) continue;
    const o = orient(r);
    const prof = (useMapProfile && r.map && profileOf(r.map)) || { bias: circuit.def_round_share, ot: circuit.overtime_p };
    const H = distFor(o.q, prof, variant);
    let bt = 0, bh = 0;
    for (const L of LINES_T) { const y = o.tot > L ? 1 : 0; bt += (H.over[L] - y) ** 2; }
    for (const h of LINES_H) { const y = o.marg + h > 0 ? 1 : 0; bh += (H.cover[h] - y) ** 2; }
    const bw = (H.pwin - (o.marg > 0 ? 1 : 0)) ** 2;
    bT += bt; nT += LINES_T.length; bH += bh; nH += LINES_H.length; bW += bw; n++;
    meanErr += H.mean - o.tot; otErr += H.ot - (o.tot > 24 ? 1 : 0);
    perMap.push({ bt: bt / LINES_T.length, bh: bh / LINES_H.length, bw });
  }
  return { n, brier_totales: r4(bT / nT), brier_handicap: r4(bH / nH), brier_ganador: r4(bW / n), sesgo_media_rondas: r2(meanErr / n), sesgo_prorroga: r4(otErr / n), perMap };
}
function bootDelta(pA, pB, key, reps = 1000) {
  const rnd = C.rng(3); const n = pA.length; const d = pA.map((x, i) => x[key] - pB[i][key]);
  const pt = mean(d); const ds = [];
  for (let r = 0; r < reps; r++) { let s = 0; for (let i = 0; i < n; i++) s += d[(rnd() * n) | 0]; ds.push(s / n); }
  ds.sort((a, b) => a - b);
  return { delta: r4(pt), se: r4(sd(ds)), ci95: [r4(ds[Math.floor(0.025 * reps)]), r4(ds[Math.floor(0.975 * reps)])] };
}

const variants = [BASE,
  { name: 'V1 inversión P(gana)=p, eco actual', inv: true },
];
// V2: eco re-ajustado con la escala invertida (a p=0,5 la inversión no cambia nada → mismo eco; la diferencia
// aparece porque el eco del circuito se ajustó a p=0,5 pero el pool real de partidos tiene p≠0,5).
// Se barre un factor multiplicativo del eco en desarrollo.
for (const f of [0.6, 0.8, 1.0, 1.2, 1.5]) variants.push({ name: `V2 inversión + eco×${f}`, inv: true, eco: +(ecoCircuit * f).toFixed(3) });
for (const sg2 of [0.02, 0.04, 0.06]) variants.push({ name: `V3 inversión + σ=${sg2}`, inv: true, sigma: sg2 });
const devPanel = {};
for (const v of variants) { const P = panel(devRecs, v); devPanel[v.name] = { n: P.n, brier_totales: P.brier_totales, brier_handicap: P.brier_handicap, brier_ganador: P.brier_ganador, sesgo_media: P.sesgo_media_rondas, sesgo_ot: P.sesgo_prorroga }; }
console.log('\n[h2] DESARROLLO — panel de mercados derivados (Brier medio por mapa):'); console.table(devPanel);
const score = (x) => x.brier_totales + x.brier_handicap;   // criterio fijado a priori: totales + hándicap a partes iguales
const bestName = Object.entries(devPanel).filter(([k]) => k !== BASE.name).sort((a, b) => score(a[1]) - score(b[1]))[0][0];
const best = variants.find((v) => v.name === bestName);
console.log(`[h2] mejor variante en desarrollo: ${bestName}`);

// ── EVALUACIÓN fuera de muestra, UNA vez: BO1 > 2025-06-30 y libro 2026 ─────────────────────────────────
const evalOut = {};
for (const [tag, recs, useProf] of [['bo1_eval', evalRecs, false], ['libro_2026_perfil_circuito', bookMaps, false], ['libro_2026_perfil_mapa_real', bookMaps, true]]) {
  const Pb = panel(recs, BASE, useProf), Pv = panel(recs, best, useProf), P1 = panel(recs, variants[1], useProf);
  evalOut[tag] = {
    n: Pb.n,
    actual: { brier_totales: Pb.brier_totales, brier_handicap: Pb.brier_handicap, brier_ganador: Pb.brier_ganador, sesgo_media: Pb.sesgo_media_rondas, sesgo_ot: Pb.sesgo_prorroga },
    v1: { brier_totales: P1.brier_totales, brier_handicap: P1.brier_handicap, brier_ganador: P1.brier_ganador, sesgo_media: P1.sesgo_media_rondas, sesgo_ot: P1.sesgo_prorroga },
    mejor: { nombre: bestName, brier_totales: Pv.brier_totales, brier_handicap: Pv.brier_handicap, brier_ganador: Pv.brier_ganador, sesgo_media: Pv.sesgo_media_rondas, sesgo_ot: Pv.sesgo_prorroga },
    delta_mejor_vs_actual: { totales: bootDelta(Pv.perMap, Pb.perMap, 'bt'), handicap: bootDelta(Pv.perMap, Pb.perMap, 'bh'), ganador: bootDelta(Pv.perMap, Pb.perMap, 'bw') },
    delta_v1_vs_actual: { totales: bootDelta(P1.perMap, Pb.perMap, 'bt'), handicap: bootDelta(P1.perMap, Pb.perMap, 'bh'), ganador: bootDelta(P1.perMap, Pb.perMap, 'bw') },
  };
  console.log(`\n[h2] EVALUACIÓN ${tag} (n=${Pb.n}):`); console.table({ actual: evalOut[tag].actual, v1: evalOut[tag].v1, mejor: evalOut[tag].mejor });
  console.log('  Δ mejor−actual:', JSON.stringify(evalOut[tag].delta_mejor_vs_actual));
}
// tramos en evaluación: empírico vs actual vs mejor
const empEval = empiricalByTramo(evalRecs.concat(bookMaps.filter((r) => r.p_win != null)));
const modEvalBase = empEval.map((e) => modelAtTramo(e, BASE, { bias: circuit.def_round_share, ot: circuit.overtime_p }));
const modEvalBest = empEval.map((e) => modelAtTramo(e, best, { bias: circuit.def_round_share, ot: circuit.overtime_p }));
console.log('\n[h2] EVALUACIÓN por tramo — empírico:'); console.table(empEval);
console.log('[h2] modelo actual:'); console.table(modEvalBase);
console.log('[h2] mejor variante:'); console.table(modEvalBest);

fs.writeFileSync(path.join(HERE, 'h2_result.json'), JSON.stringify({ at: new Date().toISOString(), circuit: { ...circuit, eco_fit: ecoCircuit },
  empirico_global: empGlobal, modelo_actual_p05: stats(S0), dev: { n: devRecs.length, empirico: empDev, modelo_actual: modDev, panel: devPanel, mejor: bestName },
  eval: { ...evalOut, tramos: { empirico: empEval, actual: modEvalBase, mejor: modEvalBest } }, book_maps: bookMaps.length, book_unresolved: unresolved }, null, 1));
fs.writeFileSync(path.join(HERE, 'h2_bookmaps.json'), JSON.stringify(bookMaps));
console.log('[h2] escrito h2_result.json');
