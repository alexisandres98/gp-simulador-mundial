// basketball-engine/scenarios.js — ESCENARIOS, SENSIBILIDAD E INCERTIDUMBRE (16-ago).
//
// EL ERROR QUE ESTE ARCHIVO EVITA. Un parte de lesiones dice "duda". Casi todos los productos hacen una de
// dos cosas con eso, y las dos están mal: o lo ignoran (y proyectan como si jugara) o asumen el escenario
// más probable (y proyectan como si NO jugara). Las dos publican un número puntual con una certeza que no
// existe. Lo correcto es simular las dos ramas, mostrarlas por separado Y publicar la mezcla ponderada.
//
// LA SEGUNDA IDEA: LA INCERTIDUMBRE TIENE DOS FUENTES Y NO SE PUEDEN SUMAR A CIEGAS.
//   · ALEATORIA — el baloncesto. Aunque supiéramos todo, el partido se juega y los tiros entran o no. Es el
//     intervalo que sale del simulador y NO baja con más datos.
//   · EPISTÉMICA — lo que no sabemos. Quién juega, cuántos minutos, si el rating está bien estimado. ESTA sí
//     baja con más datos, y es la que decide si una ventaja es publicable o no.
// Una ventaja de 5 puntos porcentuales con incertidumbre epistémica de 7 no es una ventaja: es ruido con
// buena presentación. Separarlas es lo que permite decir NO PICK con argumento.
//
// LA TERCERA: EL TORNADO. En vez de afirmar "creemos 58%", se mide cuánto se mueve ese 58% si cada supuesto
// cambia. Lo que sale ordenado por impacto es, literalmente, la lista de cosas que pueden hacer que nos
// equivoquemos — y es lo que se publica en el panel "qué haría que GP se equivoque".
//
// PURO: recibe el estado cargado y una función de simulación, devuelve estructuras. Sin red, sin disco.
'use strict';

const MD = require('./model');
const MN = require('./minutes');

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const pp = (x) => (Number.isFinite(x) ? +(100 * x).toFixed(2) : null);

// ---- 1) QUIÉN ESTÁ EN DUDA -------------------------------------------------------------------------------
// Del parte real se extraen los jugadores cuyo estado NO está resuelto. Solo esos generan ramas: preguntar
// "¿y si no juega el que ya está descartado?" no informa de nada.
function openQuestions(C, game, injuries, { minMinutes = 12, max = 3 } = {}) {
  const out = [];
  for (const side of ['home', 'away']) {
    const tid = String(game[side].id);
    const prof = MN.rotationProfile(C.games, tid, { lastN: 15 });
    if (!prof) continue;
    const { doubtful } = MN.injuriesToRoster(injuries || [], tid);
    for (const [id, p] of Object.entries(doubtful)) {
      const row = prof.rows.find((r) => String(r.id) === String(id));
      if (!row || row.exp < minMinutes) continue;                 // un jugador de 6 minutos no mueve el precio
      const imp = C.rapm && C.rapm.players[id] ? C.rapm.players[id].net : null;
      out.push({ id, side, team_id: tid, name: row.name, minutes: row.exp, p_play: p, impact: imp });
    }
  }
  return out.sort((a, b) => (b.minutes * Math.abs(b.impact || 1)) - (a.minutes * Math.abs(a.impact || 1))).slice(0, max);
}

// ---- 2) ÁRBOL DE ESCENARIOS ------------------------------------------------------------------------------
// Tres ramas por jugador en duda: juega normal, no juega, juega limitado (60% de sus minutos, que es lo que
// suele significar una vuelta de lesión o una restricción de minutos anunciada).
const BRANCHES = [
  { key: 'plays', label: 'juega', factor: 1 },
  { key: 'limited', label: 'juega limitado', factor: 0.6 },
  { key: 'sits', label: 'no juega', factor: 0 },
];
// Reparto de la probabilidad del parte entre las tres ramas. `p` es P(juega) del estado oficial; lo que
// queda para "limitado" sale de que un jugador en duda que acaba jugando suele hacerlo por debajo de lo
// habitual — asumir que vuelve al 100% es el sesgo optimista clásico.
function branchProbs(p) {
  const plays = p * 0.65, limited = p * 0.35, sits = 1 - p;
  return { plays: r4(plays), limited: r4(limited), sits: r4(sits) };
}

function scenarioTree(C, game, { injuries = null, L = null, sims = 6000, market = null, maxPlayers = 2 } = {}) {
  const qs = openQuestions(C, game, injuries, { max: maxPlayers });
  const baseOverride = buildOverride(C, game, injuries);
  const run = (override, seed) => {
    const s = MD.simulateGame(C, game, { injuries, L, sims, seed, market, override });
    return s ? { p_home: r4(s.win.home), margin: r2(s.margin && s.margin.mean), total: r2(s.total && s.total.mean) } : null;
  };
  const base = run(baseOverride, 13);
  if (!base) return null;
  if (!qs.length) return { base, players: [], weighted: base, note: 'no hay jugadores en duda con minutos relevantes' };

  const players = [];
  for (const q of qs) {
    const probs = branchProbs(q.p_play);
    const branches = [];
    for (const b of BRANCHES) {
      const ov = cloneOverride(baseOverride);
      const sideKey = q.side;
      ov[sideKey] = ov[sideKey] || { out: [], doubtful: {} };
      // se retira al jugador de la lista de dudosos y se le fija la rama concreta
      delete ov[sideKey].doubtful[q.id];
      ov[sideKey].out = (ov[sideKey].out || []).filter((x) => String(x) !== String(q.id));
      if (b.factor === 0) ov[sideKey].out.push(String(q.id));
      else if (b.factor < 1) ov[sideKey].doubtful[String(q.id)] = b.factor;
      const r = run(ov, 17);
      if (r) branches.push({ ...b, prob: probs[b.key], ...r, delta_pp: pp(r.p_home - base.p_home) });
    }
    players.push({ ...q, branches });
  }
  // MEZCLA PONDERADA: se asume independencia entre jugadores en duda, que es una simplificación honesta y
  // se declara. Con dos dudas del mismo equipo la correlación real es positiva (el mismo virus, el mismo
  // partido de anoche), así que la mezcla subestima ligeramente la cola mala.
  let wp = 0, wtot = 0;
  for (const pl of players) for (const b of pl.branches) { wp += (b.prob || 0) * b.p_home; wtot += (b.prob || 0); }
  const weighted = players.length ? { p_home: r4(wtot > 0 ? wp / wtot : base.p_home) } : base;
  // dispersión entre ramas: es la parte EPISTÉMICA que aporta la duda de alineación
  const spread = players.length
    ? Math.max(...players.map((pl) => Math.max(...pl.branches.map((b) => b.p_home)) - Math.min(...pl.branches.map((b) => b.p_home))))
    : 0;
  return { base, players, weighted, lineup_spread_pp: pp(spread),
    assumption: 'las dudas se combinan como independientes; con dos bajas del mismo equipo la cola mala queda algo subestimada' };
}

function buildOverride(C, game, injuries) {
  const ov = {};
  for (const side of ['home', 'away']) {
    const tid = String(game[side].id);
    const { out, doubtful } = MN.injuriesToRoster(injuries || [], tid);
    ov[side] = { out: out.slice(), doubtful: { ...doubtful } };
  }
  return ov;
}
const cloneOverride = (o) => ({ home: { out: (o.home.out || []).slice(), doubtful: { ...(o.home.doubtful || {}) } },
  away: { out: (o.away.out || []).slice(), doubtful: { ...(o.away.doubtful || {}) } } });

// ---- 3) TORNADO DE SENSIBILIDAD --------------------------------------------------------------------------
// Cada palanca se mueve una cantidad DEFENDIBLE —no un 1% arbitrario— y se mide el efecto en la
// probabilidad publicada:
//   · cada titular clave, fuera (el escenario que de verdad mueve una línea);
//   · el ritmo, ±1 desviación de lo que varía el ritmo de un equipo entre partidos;
//   · la ventaja de cancha, ±50% (su propio error de estimación es de ese orden);
//   · el rating de cada equipo, ±1 error estándar;
//   · el peso de mezcla con el mercado, a 0 y a 1 (los dos extremos de la decisión).
function sensitivity(C, game, { injuries = null, L = null, sims = 5000, market = null, topPlayers = 3 } = {}) {
  const baseOv = buildOverride(C, game, injuries);
  const run = (opts, ov = baseOv) => {
    const s = MD.simulateGame(C, game, { injuries, L, sims, seed: 23, market, override: ov, ...opts });
    return s ? s.win.home : null;
  };
  const p0 = run({});
  if (p0 == null) return null;
  const rows = [];

  // (a) jugadores clave fuera, de los dos equipos
  for (const side of ['home', 'away']) {
    const tid = String(game[side].id);
    const prof = MN.rotationProfile(C.games, tid, { lastN: 15 });
    if (!prof) continue;
    const already = new Set((baseOv[side].out || []).map(String));
    for (const r of prof.rows.filter((x) => !already.has(String(x.id))).slice(0, topPlayers)) {
      const ov = cloneOverride(baseOv);
      ov[side].out.push(String(r.id));
      const p = run({}, ov);
      if (p == null) continue;
      rows.push({ lever: `${r.name} fuera`, kind: 'roster', side, delta_pp: pp(p - p0), p, detail: `${r.exp} min habituales` });
    }
  }

  // (b) ritmo del partido: ±3 posesiones, que es aproximadamente la desviación entre partidos
  for (const d of [-3, 3]) {
    const s = MD.simulateGame(C, game, { injuries, L, sims, seed: 23, market, override: baseOv });
    if (!s) break;
    // el ritmo no cambia el ganador por sí solo, pero sí la varianza del margen: se mide con el simulador
    const s2 = require('./simulate').simulate(C.fit, String(game.home.id), String(game.away.id),
      { n: sims, seed: 23, neutral: !!game.neutral, adj: { ...s.adj, pace: d }, regMin: (L && L.minutes) || 48, otMin: (L && L.otMin) || 5 });
    if (!s2) break;
    const p = C.blend && C.blend.ok && market != null && s.layers && s.layers.blend ? MD.blend(s2.win.home, market, C.blend.w) : s2.win.home;
    rows.push({ lever: `Ritmo ${d > 0 ? '+' : ''}${d} posesiones`, kind: 'pace', delta_pp: pp(p - p0), p });
  }

  // (c) ventaja de cancha: ±50% de su valor
  if (!game.neutral && C.fit && C.fit.hca) {
    for (const f of [0.5, 1.5]) {
      const fit2 = { ...C.fit, hca: C.fit.hca * f };
      const s2 = require('./simulate').simulate(fit2, String(game.home.id), String(game.away.id),
        { n: sims, seed: 23, neutral: false, regMin: (L && L.minutes) || 48, otMin: (L && L.otMin) || 5 });
      if (!s2) continue;
      const p = C.blend && C.blend.ok && market != null ? MD.blend(s2.win.home, market, C.blend.w) : s2.win.home;
      rows.push({ lever: `Ventaja de cancha ×${f}`, kind: 'hca', delta_pp: pp(p - p0), p, detail: `${r2(C.fit.hca)} → ${r2(C.fit.hca * f)} pts` });
    }
  }

  // (d) el peso de mezcla en sus dos extremos: es la decisión de modelo más grande que tomamos
  if (market != null && C.blend && C.blend.ok) {
    const s = MD.simulateGame(C, game, { injuries, L, sims, seed: 23, market: null, override: baseOv });
    if (s) {
      const pm = s.win.home;
      rows.push({ lever: 'Solo el modelo (peso 100%)', kind: 'blend', delta_pp: pp(pm - p0), p: r4(pm) });
      rows.push({ lever: 'Solo el mercado (peso 0%)', kind: 'blend', delta_pp: pp(market - p0), p: r4(market) });
    }
  }

  rows.sort((a, b) => Math.abs(b.delta_pp || 0) - Math.abs(a.delta_pp || 0));
  return { p_base: r4(p0), rows: rows.slice(0, 12),
    note: 'cada palanca se mueve una cantidad defendible, no un porcentaje arbitrario' };
}

// ---- 4) DESCOMPOSICIÓN DE LA INCERTIDUMBRE ---------------------------------------------------------------
// Aleatoria: el intervalo de muestreo del simulador (baja con más simulaciones, no con más datos).
// Epistémica: la dispersión que generan nuestras dudas — alineación, ritmo, ventaja de cancha, rating.
// La total NO es la suma: son independientes en primera aproximación, así que se suman las varianzas.
function uncertainty(sim, tree, sens) {
  const ale = sim && sim.win_ci ? (sim.win_ci.hi - sim.win_ci.lo) / 2 : null;
  const parts = [];
  if (tree && tree.lineup_spread_pp) parts.push({ source: 'alineación en duda', sd_pp: r2(tree.lineup_spread_pp / 3.29) });
  if (sens && sens.rows) {
    const paceRows = sens.rows.filter((r) => r.kind === 'pace');
    if (paceRows.length) parts.push({ source: 'ritmo', sd_pp: r2(Math.max(...paceRows.map((r) => Math.abs(r.delta_pp))) / 2) });
    const hcaRows = sens.rows.filter((r) => r.kind === 'hca');
    if (hcaRows.length) parts.push({ source: 'ventaja de cancha', sd_pp: r2(Math.max(...hcaRows.map((r) => Math.abs(r.delta_pp))) / 2) });
    const blendRows = sens.rows.filter((r) => r.kind === 'blend');
    if (blendRows.length) parts.push({ source: 'peso de mezcla con el mercado', sd_pp: r2(Math.max(...blendRows.map((r) => Math.abs(r.delta_pp))) / 2) });
  }
  const epi = parts.length ? Math.sqrt(parts.reduce((s, p) => s + (p.sd_pp || 0) ** 2, 0)) : null;
  const aleP = ale != null ? 100 * ale : null;
  const tot = aleP != null && epi != null ? Math.sqrt(aleP * aleP + epi * epi) : (epi != null ? epi : aleP);
  return {
    aleatoric_pp: r2(aleP), epistemic_pp: r2(epi), total_pp: r2(tot), parts,
    dominant: epi != null && aleP != null ? (epi > aleP ? 'epistémica' : 'aleatoria') : null,
    note: epi != null && aleP != null && epi > aleP
      ? 'lo que más pesa es lo que NO sabemos: más datos y un parte resuelto estrecharían esto'
      : 'lo que más pesa es la varianza del propio juego: no baja con más información',
  };
}

// ---- 5) QUÉ HARÍA QUE GP SE EQUIVOQUE --------------------------------------------------------------------
// El tornado ya ordenó las palancas. Acá se traduce a frases con signo y magnitud, que es lo que un lector
// puede usar. Se excluyen las palancas de modelo (mezcla) porque no son un riesgo del partido: son una
// decisión nuestra, y va en su propio sitio.
// FRASES, NO ETIQUETAS DE PALANCA. "Ventaja de cancha ×1.5" es el nombre interno de un experimento; lo que
// un lector puede usar es "si la cancha pesa más de lo que estimamos". El tornado enseña las palancas; este
// panel enseña las consecuencias, que no es lo mismo aunque salgan del mismo cálculo.
function phrase(r) {
  if (r.kind === 'roster') return `si ${r.lever.replace(/ fuera$/, '')} no juega`;
  if (r.kind === 'pace') return `si el partido va ${r.lever.includes('+') ? 'más rápido' : 'más lento'} de lo previsto`;
  if (r.kind === 'hca') return r.lever.includes('1.5') ? 'si la cancha pesa más de lo que estimamos' : 'si la cancha pesa menos de lo que estimamos';
  return r.lever;
}
function risks(sens, tree, { max = 5 } = {}) {
  const out = [];
  for (const r of ((sens && sens.rows) || [])) {
    if (r.kind === 'blend') continue;
    if (Math.abs(r.delta_pp || 0) < 0.4) continue;
    out.push({ text: phrase(r), lever: r.lever, delta_pp: r.delta_pp, kind: r.kind, detail: r.detail || null,
      direction: r.delta_pp > 0 ? 'a favor del local' : 'a favor del visitante' });
    if (out.length >= max) break;
  }
  for (const pl of ((tree && tree.players) || [])) {
    const sit = pl.branches.find((b) => b.key === 'sits');
    if (sit && Math.abs(sit.delta_pp || 0) >= 0.4 && out.length < max + 2) {
      out.push({ text: `${pl.name} está en duda (${Math.round(100 * pl.p_play)}% de jugar)`, delta_pp: sit.delta_pp,
        kind: 'availability', detail: `si no juega, la probabilidad se mueve ${sit.delta_pp > 0 ? '+' : ''}${sit.delta_pp} pp`,
        direction: sit.delta_pp > 0 ? 'a favor del local' : 'a favor del visitante' });
    }
  }
  return out.slice(0, max + 2);
}

module.exports = { openQuestions, scenarioTree, sensitivity, uncertainty, risks, branchProbs, buildOverride };
