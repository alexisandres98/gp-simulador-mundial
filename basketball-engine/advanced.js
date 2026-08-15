// basketball-engine/advanced.js — INTELIGENCIA DE EQUIPO DERIVADA (16-ago).
//
// QUÉ RESUELVE. El rating dice CUÁNTO de bueno es un equipo. Este módulo dice DE QUÉ está hecho: cómo tira,
// dónde tira, cuánto de lo que le sale es habilidad y cuánto es suerte reciente, qué hace en el último
// cuarto, cómo cambia cuando el partido está apretado, y qué parte de su récord es sostenible.
//
// LA REGLA QUE ORDENA TODO: BRUTO Y AJUSTADO SON DOS NÚMEROS DISTINTOS, Y LOS DOS SE PUBLICAN. Un eFG del
// 55% contra las tres peores defensas de la liga no es un eFG del 55%. Todas las métricas de este módulo
// salen en dos versiones —la observada y la ajustada por rival— y la ficha enseña las dos, porque esconder
// la bruta es tan deshonesto como publicar la bruta sola.
//
// LA MÉTRICA MÁS IMPORTANTE DEL ARCHIVO: eFG ESPERADO. Un equipo que tira mucho desde la esquina y del aro
// "debería" meter más que uno que vive del media distancia, aunque los dos tengan el mismo talento. Comparar
// el eFG real contra el que le corresponde a SU MEZCLA DE TIROS separa tres cosas que el ojo mezcla: elegir
// buenos tiros (habilidad estable), meterlos (habilidad menos estable) y la suerte de las últimas semanas
// (que no persiste). Esa separación es lo que permite decir "este equipo va a bajar" antes de que baje.
//
// PURO: entra el dataset derivado, salen números. Sin red, sin disco, sin db.
'use strict';

const R = require('./ratings');

// ---- UTILIDADES ------------------------------------------------------------------------------------------
const num = (x) => (Number.isFinite(x) ? x : null);
const r2 = (x, d = 3) => (Number.isFinite(x) ? +x.toFixed(d) : null);
const sideOf = (g, teamId) => (String(g.home.id) === String(teamId) ? g.home : g.away);
const foeOf = (g, teamId) => (String(g.home.id) === String(teamId) ? g.away : g.home);
const played = (g) => g && g.home && g.home.pts != null && g.away && g.away.pts != null;

// ---- 1) AJUSTE POR RIVAL, GENÉRICO -----------------------------------------------------------------------
// Para CUALQUIER métrica por partido se estima el mismo modelo aditivo que usa el rating: lo observado es
// "lo que este ataque produce" menos "lo que esta defensa concede", alrededor de la media de liga. Se
// resuelve por mínimos cuadrados alternados (el mismo esquema del rating, que ya está validado acá) y se
// encoge hacia la media según el tamaño de muestra, que es lo que evita que 4 partidos manden.
//
// `pick(side, foe, game)` devuelve el valor de la métrica para ese equipo en ese partido.
function adjustMetric(games, pick, { iters = 40, prior = 6, minGames = 3 } = {}) {
  const off = new Map(), def = new Map(), n = new Map();
  const rows = [];
  for (const g of games) {
    if (!played(g)) continue;
    for (const [me, foe] of [[g.home, g.away], [g.away, g.home]]) {
      const v = pick(me, foe, g);
      if (!Number.isFinite(v)) continue;
      rows.push({ o: String(me.id), d: String(foe.id), v });
      n.set(String(me.id), (n.get(String(me.id)) || 0) + 1);
    }
  }
  if (rows.length < 20) return null;
  const lg = rows.reduce((s, r) => s + r.v, 0) / rows.length;
  for (const r of rows) { if (!off.has(r.o)) off.set(r.o, 0); if (!def.has(r.d)) def.set(r.d, 0); }
  // alternancia: fijo defensas y resuelvo ataques, y al revés. Converge rápido y no necesita álgebra pesada.
  for (let it = 0; it < iters; it++) {
    const accO = new Map(), cntO = new Map();
    for (const r of rows) { const e = r.v - (def.get(r.d) || 0) - lg; accO.set(r.o, (accO.get(r.o) || 0) + e); cntO.set(r.o, (cntO.get(r.o) || 0) + 1); }
    for (const [k, s] of accO) off.set(k, s / (cntO.get(k) + prior));        // el +prior ES el encogimiento
    const accD = new Map(), cntD = new Map();
    for (const r of rows) { const e = r.v - (off.get(r.o) || 0) - lg; accD.set(r.d, (accD.get(r.d) || 0) + e); cntD.set(r.d, (cntD.get(r.d) || 0) + 1); }
    for (const [k, s] of accD) def.set(k, s / (cntD.get(k) + prior));
  }
  return {
    lg: r2(lg, 4),
    off: Object.fromEntries([...off].map(([k, v]) => [k, r2(v, 4)])),
    def: Object.fromEntries([...def].map(([k, v]) => [k, r2(v, 4)])),
    n: Object.fromEntries([...n]),
    min_games: minGames,
  };
}

// ---- 2) VALOR ESPERADO POR ZONA (la base del eFG esperado) ----------------------------------------------
// Puntos por intento en cada zona, con la muestra REAL de la liga. No se hardcodean: la WNBA y la NBA tienen
// valores distintos y la liga cambia año a año.
function zoneBaseline(games) {
  const z = {};
  for (const g of games) for (const s of (g.shots || [])) {
    const k = s.z || 'otro';
    if (!z[k]) z[k] = { att: 0, pts: 0 };
    z[k].att++; z[k].pts += s.m ? s.v : 0;
  }
  const out = {}; let att = 0, pts = 0;
  for (const k of Object.keys(z)) { out[k] = { pps: r2(z[k].pts / Math.max(z[k].att, 1)), att: z[k].att }; att += z[k].att; pts += z[k].pts; }
  return { zones: out, lg_pps: r2(pts / Math.max(att, 1)), attempts: att };
}

// eFG esperado de una mezcla de tiros: Σ(intentos_zona × pps_zona) / (2 × intentos). Es exactamente la
// definición de eFG pero con el porcentaje que la liga saca DESDE ESA ZONA en lugar del que sacó el equipo.
function expectedEfg(shotCounts, base) {
  let att = 0, pts = 0;
  for (const [k, nAtt] of Object.entries(shotCounts || {})) {
    const b = base.zones[k]; if (!b || !nAtt) continue;
    att += nAtt; pts += nAtt * b.pps;
  }
  if (!att) return null;
  return { xefg: r2(pts / (2 * att), 4), attempts: att, xpps: r2(pts / att) };
}

// ---- 3) PERFIL COMPLETO DE UN EQUIPO ---------------------------------------------------------------------
// Todo lo que el blueprint pide de un equipo, calculado sobre SU muestra y con la versión ajustada al lado.
function teamAdvanced(games, teamId, { lastN = null, adj = null, base = null, fit = null, excludeGarbage = true } = {}) {
  let gs = games.filter((g) => played(g) && (String(g.home.id) === String(teamId) || String(g.away.id) === String(teamId)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (lastN) gs = gs.slice(0, lastN);
  if (!gs.length) return null;
  const B = base || zoneBaseline(games);

  const me = (g) => sideOf(g, teamId), foe = (g) => foeOf(g, teamId);
  const sum = (f) => gs.reduce((s, g) => s + (f(g) || 0), 0);
  const avg = (f) => sum(f) / gs.length;
  // REGISTRO DE AUSENCIAS (regla 11 del blueprint). Un campo que la fuente NUNCA trae no es un cero: es
  // "no observado". ESPN, por ejemplo, no publica points-off-turnovers en NBA ni WNBA. Publicar 0 ahí
  // convertiría una ausencia de dato en una señal —"este equipo no anota tras pérdida"— que es falsa.
  const avgObs = (f) => { const seen = gs.filter((g) => Number.isFinite(f(g)) && f(g) !== 0); return seen.length ? sum(f) / gs.length : null; };

  // --- FOUR FACTORS, ataque y defensa, brutos ---
  const ffOf = (side) => ({
    efg: avg((g) => (side(g).ff || {}).efg),
    tov: avg((g) => (side(g).ff || {}).tov_pct),
    orb: avg((g) => (side(g).ff || {}).orb_pct),
    ftr: avg((g) => (side(g).ff || {}).ftr),
    tpa_rate: avg((g) => (side(g).ff || {}).tpa_rate),
    ortg: avg((g) => (side(g).ff || {}).ortg),
  });
  const ffO = ffOf(me), ffD = ffOf(foe);

  // --- MEZCLA DE TIROS Y eFG ESPERADO (el corazón del módulo) ---
  const mine = {}, theirs = {};
  let mineMade = 0, mineAtt = 0, minePts = 0;
  for (const g of gs) for (const s of (g.shots || [])) {
    const tgt = String(s.t) === String(teamId) ? mine : theirs;
    tgt[s.z || 'otro'] = (tgt[s.z || 'otro'] || 0) + 1;
    if (String(s.t) === String(teamId)) { mineAtt++; if (s.m) { mineMade++; minePts += s.v; } }
  }
  const xO = expectedEfg(mine, B), xD = expectedEfg(theirs, B);
  const efgReal = mineAtt ? minePts / (2 * mineAtt) : null;
  const efgAllowed = (() => {
    let a = 0, p = 0;
    for (const g of gs) for (const s of (g.shots || [])) if (String(s.t) !== String(teamId)) { a++; if (s.m) p += s.v; }
    return a ? p / (2 * a) : null;
  })();
  const mix = (o) => { const t = Object.values(o).reduce((s, v) => s + v, 0) || 1; const r = {}; for (const k of Object.keys(o)) r[k] = r2(o[k] / t, 4); return r; };

  // --- SUERTE DE TIRO: real − esperado, en ataque y en defensa ---
  // El signo importa: en ataque, positivo = está metiendo MÁS de lo que su mezcla merece (candidato a bajar).
  // En defensa, positivo = el rival está metiendo más de lo que sus tiros merecen (candidato a mejorar).
  const luckO = efgReal != null && xO ? efgReal - xO.xefg : null;
  const luckD = efgAllowed != null && xD ? efgAllowed - xD.xefg : null;

  // --- TRANSICIÓN Y PRESIÓN AL ARO (definiciones de ESPN, declaradas como tales) ---
  const poss = avg((g) => g.poss) || 100;
  const per100 = (v) => (poss > 0 ? (100 * v) / poss : null);
  const rimRate = mix(mine).rim || 0;
  const c3 = mix(mine).corner3 || 0, atb = mix(mine).atb3 || 0;

  // --- CUARTOS: identidad por periodo (arranque, banquillo, ajuste de descanso, cierre) ---
  const q = [0, 1, 2, 3].map((i) => {
    const f = gs.filter((g) => (me(g).line || []).length > i && (foe(g).line || []).length > i);
    if (!f.length) return null;
    const mn = f.reduce((s, g) => s + me(g).line[i], 0) / f.length;
    const op = f.reduce((s, g) => s + foe(g).line[i], 0) / f.length;
    return { q: i + 1, pts: r2(mn, 2), allowed: r2(op, 2), diff: r2(mn - op, 2), n: f.length };
  }).filter(Boolean);

  // --- CLUTCH: reconstruido desde los tramos (últimos 5 min, margen ≤ 5) ---
  const clutch = clutchFromStints(gs, teamId);

  // --- FORMA AJUSTADA POR CALENDARIO: residuo contra lo que el rating esperaba, con decaimiento ---
  const form = fit ? scheduleAdjustedForm(gs, teamId, fit) : null;

  // --- VERSIÓN AJUSTADA POR RIVAL de las métricas que más se contaminan ---
  const A = adj || null;
  const adjOf = (key) => {
    if (!A || !A[key]) return null;
    const o = A[key].off[String(teamId)], d = A[key].def[String(teamId)];
    return { off: num(o), def: num(d), lg: A[key].lg, off_vs_lg: r2((o || 0), 4), def_vs_lg: r2((d || 0), 4) };
  };

  return {
    team_id: String(teamId), games: gs.length, poss: r2(poss, 2),
    four_factors: {
      offense: { efg: r2(ffO.efg, 4), tov: r2(ffO.tov, 4), orb: r2(ffO.orb, 4), ftr: r2(ffO.ftr, 4), ortg: r2(ffO.ortg, 2) },
      defense: { efg: r2(ffD.efg, 4), tov: r2(ffD.tov, 4), orb: r2(ffD.orb, 4), ftr: r2(ffD.ftr, 4), drtg: r2(ffD.ortg, 2) },
      adjusted: { efg: adjOf('efg'), tov: adjOf('tov'), orb: adjOf('orb'), ftr: adjOf('ftr'), ortg: adjOf('ortg'), pace: adjOf('pace') },
    },
    shooting: {
      efg: r2(efgReal, 4), xefg: xO ? xO.xefg : null, luck: r2(luckO, 4),
      efg_allowed: r2(efgAllowed, 4), xefg_allowed: xD ? xD.xefg : null, luck_allowed: r2(luckD, 4),
      mix: mix(mine), mix_allowed: mix(theirs), attempts: mineAtt, made: mineMade,
      // lectura ya masticada: qué parte del rendimiento no debería sostenerse
      note: luckO == null ? null : Math.abs(luckO) < 0.012 ? 'tirando como su mezcla de tiros merece'
        : luckO > 0 ? 'metiendo por encima de su mezcla: parte del rendimiento no debería sostenerse'
          : 'metiendo por debajo de su mezcla: hay margen de rebote al alza',
    },
    rim_pressure: { rim_rate: r2(rimRate, 4), ftr: r2(ffO.ftr, 4), paint_per100: r2(per100(avg((g) => me(g).paint)), 2) },
    three_point: { rate: r2(ffO.tpa_rate, 4), corner_share: r2(c3, 4), atb_share: r2(atb, 4),
      corner_of_threes: r2(c3 + atb > 0 ? c3 / (c3 + atb) : null, 4) },
    transition: { fastbreak_per100: r2(per100(avgObs((g) => me(g).fastbreak)), 2),
      pts_off_tov_per100: r2(per100(avgObs((g) => me(g).pts_off_tov)), 2),
      allowed_fastbreak_per100: r2(per100(avgObs((g) => foe(g).fastbreak)), 2),
      source: 'definición de ESPN (fastbreak points)',
      missing: avgObs((g) => me(g).pts_off_tov) == null ? ['pts_off_tov: la fuente no lo publica en esta liga'] : [] },
    quarters: q,
    clutch,
    form,
    turnovers: { tov_pct: r2(ffO.tov, 4), forced_pct: r2(ffD.tov, 4), stl_per100: r2(per100(avg((g) => me(g).stl)), 2) },
    fouls: { pf_per100: r2(per100(avg((g) => me(g).pf)), 2), drawn_per100: r2(per100(avg((g) => foe(g).pf)), 2), ftr: r2(ffO.ftr, 4), ftr_allowed: r2(ffD.ftr, 4) },
    rebounding: { orb_pct: r2(ffO.orb, 4), drb_pct: r2(1 - (ffD.orb || 0), 4), orb_per100: r2(per100(avg((g) => me(g).orb)), 2) },
  };
}

// ---- 4) CLUTCH DESDE LOS TRAMOS --------------------------------------------------------------------------
// Un tramo trae inicio, fin y los puntos de cada lado DENTRO del tramo. Acumulando se reconstruye el
// marcador en cada frontera, y con eso se puede aislar lo que pasó con el partido apretado y poco tiempo.
// SE ENCOGE MUY FUERTE. Una temporada entera deja 120-150 posesiones de clutch por equipo, y el net rating
// sobre esa muestra tiene una desviación enorme: sin encoger salen +39 y −31 por 100, que es exactamente
// como nacen las narrativas de "equipo clutch". El prior son 300 posesiones —el orden de magnitud en que
// esta métrica empieza a estabilizarse—, así que una temporada entra con un peso de ~0,3 y el número que
// se publica es deliberadamente tímido. Aun así se publica el bruto al lado: esconderlo sería lo contrario
// de lo que este archivo intenta hacer.
function clutchFromStints(games, teamId, { lastSecs = 300, maxMargin = 5, prior = 300 } = {}) {
  let pf = 0, pa = 0, poss = 0, secs = 0, n = 0;
  for (const g of games) {
    const st = g.stints; if (!st || !st.length) continue;
    const isHome = String(g.home.id) === String(teamId);
    const arr = Array.isArray(st[0]) ? st.map((x) => ({ s: x[0], e: x[1], ph: x[4], pa: x[5], p: x[6], g: x[7] })) : st;
    const end = arr[arr.length - 1].e;
    let hs = 0, as = 0, used = false;
    for (const s of arr) {
      const before = hs - as;
      hs += s.ph || 0; as += s.pa || 0;
      const inLast = s.e > end - lastSecs;
      if (!inLast || Math.abs(before) > maxMargin) continue;
      used = true;
      pf += isHome ? (s.ph || 0) : (s.pa || 0);
      pa += isHome ? (s.pa || 0) : (s.ph || 0);
      poss += s.p || 0; secs += (s.e - s.s);
    }
    if (used) n++;
  }
  if (poss < 20) return { games: n, poss: r2(poss, 1), enough: false, note: 'muestra insuficiente para leer el clutch' };
  const net = (100 * (pf - pa)) / poss;
  // encogimiento hacia 0 por posesiones: con `prior` posesiones de referencia, 80 posesiones entran a la mitad
  const shrunk = net * (poss / (poss + prior));
  return { games: n, poss: r2(poss, 1), minutes: r2(secs / 60, 1), pts_for: pf, pts_against: pa,
    net_raw: r2(net, 2), net: r2(shrunk, 2), shrink: r2(poss / (poss + prior), 2), enough: true };
}

// ---- 5) FORMA AJUSTADA POR CALENDARIO --------------------------------------------------------------------
// "Últimos 10" en crudo miente: cinco partidos contra los peores de la liga no son forma. Acá la forma es el
// RESIDUO contra lo que el rating esperaba en cada partido, con decaimiento exponencial. Positivo = está
// rindiendo por encima de su propio nivel; negativo = por debajo. Y se publica también la dureza del
// calendario recorrido, porque sin eso el residuo no se puede interpretar.
function scheduleAdjustedForm(games, teamId, fit, { halfLife = 6, lastN = 12 } = {}) {
  const gs = games.filter(played).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, lastN);
  if (!gs.length || !fit) return null;
  let wsum = 0, acc = 0, sos = 0, sosW = 0, rawW = 0, rawAcc = 0;
  const rows = [];
  gs.forEach((g, i) => {
    const isHome = String(g.home.id) === String(teamId);
    const h = String(g.home.id), a = String(g.away.id);
    if (!fit.off[h] || !fit.off[a]) return;
    const poss = fit.lgPace + (fit.pace[h] || 0) + (fit.pace[a] || 0);
    const expH = (((fit.off[h] - fit.def[a]) - (fit.off[a] - fit.def[h])) + fit.hca * (g.neutral ? 0 : 1)) * poss / 100;
    const exp = isHome ? expH : -expH;
    const real = isHome ? (g.home.pts - g.away.pts) : (g.away.pts - g.home.pts);
    const w = Math.pow(0.5, i / halfLife);
    wsum += w; acc += w * (real - exp);
    rawW += w; rawAcc += w * real;
    const oppNet = (fit.off[isHome ? a : h] || 0) - (fit.def[isHome ? a : h] || 0);
    sos += w * oppNet; sosW += w;
    rows.push({ date: g.date, opp: isHome ? a : h, real, exp: r2(exp, 1), resid: r2(real - exp, 1), w: r2(w, 3) });
  });
  if (!wsum) return null;
  return {
    residual: r2(acc / wsum, 2),                       // puntos por partido por encima/debajo de su nivel
    margin_raw: r2(rawAcc / rawW, 2),
    sos_net100: r2(sosW ? sos / sosW : null, 2),       // calidad media del rival recorrido
    n: rows.length, half_life_games: halfLife, rows: rows.slice(0, 8),
    note: acc / wsum > 1.5 ? 'rindiendo por encima de su nivel' : acc / wsum < -1.5 ? 'rindiendo por debajo de su nivel' : 'en línea con su nivel',
  };
}

// ---- 6) RENDIMIENTO SOSTENIBLE ---------------------------------------------------------------------------
// El récord observado mezcla nivel real y suerte (tiros que entraron, partidos apretados). Se compara el
// récord real contra el que sale de simular la temporada con el rating ajustado: la diferencia es la parte
// que NO deberíamos esperar que continúe.
function sustainable(games, teamId, fit) {
  const gs = games.filter((g) => played(g) && (String(g.home.id) === String(teamId) || String(g.away.id) === String(teamId)));
  if (!gs.length || !fit || !fit.off[String(teamId)]) return null;
  let w = 0, expW = 0;
  const sd = (fit.sd && fit.sd.margin) || 12.5;
  for (const g of gs) {
    const isHome = String(g.home.id) === String(teamId);
    const h = String(g.home.id), a = String(g.away.id);
    if (!fit.off[h] || !fit.off[a]) continue;
    const poss = fit.lgPace + (fit.pace[h] || 0) + (fit.pace[a] || 0);
    const expH = (((fit.off[h] - fit.def[a]) - (fit.off[a] - fit.def[h])) + fit.hca * (g.neutral ? 0 : 1)) * poss / 100;
    const exp = isHome ? expH : -expH;
    const real = isHome ? (g.home.pts - g.away.pts) : (g.away.pts - g.home.pts);
    if (real > 0) w++;
    // P(ganar) normal con la desviación del margen de la liga
    expW += 1 - normCdf(0, exp, sd);
  }
  const n = gs.length;
  return { games: n, wins: w, expected_wins: r2(expW, 1), luck_wins: r2(w - expW, 1),
    win_pct: r2(w / n, 3), expected_win_pct: r2(expW / n, 3),
    note: w - expW > 2 ? 'gana más de lo que su juego sostiene' : w - expW < -2 ? 'gana menos de lo que su juego merece' : 'récord en línea con su juego' };
}
function normCdf(x, mu, sd) {
  const z = (x - mu) / (sd * Math.SQRT2);
  // erf por aproximación de Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  const erf = z >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

// ---- 7) TABLA DE AJUSTES DE LIGA -------------------------------------------------------------------------
// Se calcula UNA vez por liga y lo consume cada equipo. Cada métrica ajustada es un modelo aparte.
function leagueAdjustments(games) {
  const ff = (s) => s.ff || {};
  return {
    efg: adjustMetric(games, (me) => ff(me).efg),
    tov: adjustMetric(games, (me) => ff(me).tov_pct),
    orb: adjustMetric(games, (me) => ff(me).orb_pct),
    ftr: adjustMetric(games, (me) => ff(me).ftr),
    ortg: adjustMetric(games, (me) => ff(me).ortg),
    pace: adjustMetric(games, (me, foe, g) => g.poss),
  };
}

// ---- 8) PERCENTILES DE LIGA ------------------------------------------------------------------------------
// Para que la ficha pueda decir "top 10%" en vez de un número sin escala.
function leaguePercentiles(profiles, path) {
  const vals = [];
  for (const p of profiles) { const v = getPath(p, path); if (Number.isFinite(v)) vals.push(v); }
  vals.sort((a, b) => a - b);
  return (x) => {
    if (!Number.isFinite(x) || !vals.length) return null;
    let lo = 0; while (lo < vals.length && vals[lo] < x) lo++;
    return r2(lo / vals.length, 3);
  };
}
function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }

module.exports = {
  adjustMetric, zoneBaseline, expectedEfg, teamAdvanced, clutchFromStints,
  scheduleAdjustedForm, sustainable, leagueAdjustments, leaguePercentiles, normCdf,
};
