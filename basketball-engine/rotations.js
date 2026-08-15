// basketball-engine/rotations.js — ROTACIONES, QUINTETOS Y ÁRBOL DE REEMPLAZO (16-ago).
//
// LA TESIS DEL BLUEPRINT, LITERAL: "la mayoría de errores grandes en props y game pricing comienzan con
// minutos o combinaciones mal proyectadas". Este módulo convierte los tramos ya reconstruidos en las cinco
// cosas que un modelo necesita saber antes de simular nada:
//   1. QUÉ QUINTETOS existen y cuánto rinden (con regularización fuerte: 6 minutos juntos no son un rating).
//   2. CUÁL ES EL PATRÓN del entrenador — quién entra en qué minuto de cada cuarto, no una media de 48.
//   3. QUIÉN ARRANCA y quién CIERRA, que son dos preguntas distintas y las dos mueven mercados distintos
//      (el primer cuarto y el resultado final).
//   4. QUIÉN COMPARTE cancha con quién: el staggering decide si un suplente juega con titulares o contra
//      titulares, y eso cambia sus números sin que cambie su talento.
//   5. SI FALTA X, QUIÉN ABSORBE — minutos, tiros, asistencias y rebotes, por posición y por afinidad real
//      de haber jugado juntos, no repartido a partes iguales.
//
// POR QUÉ ES POSIBLE ACÁ Y NO EN LA MAYORÍA DE PRODUCTOS: porque ya reconstruimos los quintetos jugada a
// jugada desde las sustituciones y los auditamos contra el acta (error medio 0,25 min por jugador). Sin esa
// base, todo esto serían medias de temporada disfrazadas.
//
// PURO: entra el dataset derivado, salen estructuras. Sin red, sin disco, sin db.
'use strict';

const LU = require('./lineups');

const unpack = (g) => (g.stints && g.stints.length && Array.isArray(g.stints[0]) ? LU.unpackStints(g.stints) : (g.stints || []));
const r2 = (x, d = 2) => (Number.isFinite(x) ? +x.toFixed(d) : null);
const played = (g) => g && g.home && g.home.pts != null;

// Nombre de un jugador desde el box, con caché por dataset.
function nameIndex(games) {
  const m = new Map();
  for (const g of games) for (const p of (g.players || [])) if (!m.has(String(p.id))) m.set(String(p.id), { name: p.n, pos: p.pos, team: String(p.t) });
  return m;
}

// ---- 1) QUINTETOS: RATING CON REGULARIZACIÓN FUERTE ------------------------------------------------------
// Un quinteto con 20 posesiones y +12 de neto NO es un quinteto de +12. Se encoge hacia la media del equipo
// con un prior en POSESIONES: el peso propio es poss/(poss+k). Con k = 100, veinte posesiones pesan un 17%.
// Es la diferencia entre un dato y una anécdota, y es lo que impide que el panel publique ruido con formato
// de conclusión.
function lineupRatings(games, teamId, { k = 100, minPoss = 12, dropGarbage = true, top = 12 } = {}) {
  const agg = new Map();
  let teamPF = 0, teamPA = 0, teamPoss = 0;
  for (const g of games) {
    if (!played(g) || !g.roster) continue;
    const isHome = String(g.home.id) === String(teamId), isAway = String(g.away.id) === String(teamId);
    if (!isHome && !isAway) continue;
    for (const s of unpack(g)) {
      if (dropGarbage && s.g) continue;
      const idx = isHome ? s.h : s.a;
      if (!idx || idx.length !== 5) continue;
      const ids = idx.map((i) => (g.roster[i] || {}).id).filter(Boolean);
      if (ids.length !== 5) continue;
      const pf = isHome ? (s.ph || 0) : (s.pa || 0);
      const pa = isHome ? (s.pa || 0) : (s.ph || 0);
      const poss = s.p || 0;
      teamPF += pf; teamPA += pa; teamPoss += poss;
      const key = ids.slice().sort().join('|');
      const cur = agg.get(key) || { ids: ids.slice().sort(), pf: 0, pa: 0, poss: 0, secs: 0, n: 0 };
      cur.pf += pf; cur.pa += pa; cur.poss += poss; cur.secs += (s.e - s.s); cur.n++;
      agg.set(key, cur);
    }
  }
  if (!teamPoss) return null;
  const teamNet = (100 * (teamPF - teamPA)) / teamPoss;
  const names = nameIndex(games);
  const rows = [...agg.values()].filter((r) => r.poss >= minPoss).map((r) => {
    const rawNet = (100 * (r.pf - r.pa)) / Math.max(r.poss, 1e-9);
    const w = r.poss / (r.poss + k);
    return {
      ids: r.ids, players: r.ids.map((id) => (names.get(id) || {}).name || id),
      poss: r2(r.poss, 1), minutes: r2(r.secs / 60, 1), stints: r.n,
      off: r2((100 * r.pf) / r.poss), def: r2((100 * r.pa) / r.poss),
      net_raw: r2(rawNet), net: r2(w * rawNet + (1 - w) * teamNet), weight: r2(w, 2),
    };
  }).sort((a, b) => b.poss - a.poss);
  return { team_id: String(teamId), team_net: r2(teamNet), team_poss: r2(teamPoss, 1),
    lineups: rows.slice(0, top), n_lineups: rows.length, k, note: 'net encogido hacia la media del equipo por posesiones jugadas' };
}

// ---- 2) PLANTILLA DE ROTACIÓN: QUIÉN ESTÁ EN CANCHA EN CADA MINUTO ---------------------------------------
// Para cada jugador, la probabilidad de estar en cancha en cada minuto del partido, promediada sobre los
// partidos recientes con decaimiento. Esto es lo que alimenta la cinta de 48 minutos del panel y —más
// importante— lo que permite proyectar los minutos del PRIMER cuarto y los del CIERRE por separado.
function rotationTemplate(games, teamId, { lastN = 15, halfLife = 6, regMin = null, bins = null } = {}) {
  const gs = games.filter((g) => played(g) && g.roster && g.stints
    && (String(g.home.id) === String(teamId) || String(g.away.id) === String(teamId)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, lastN);
  if (!gs.length) return null;
  // LA DURACIÓN SALE DE LOS DATOS, NO DE UNA CONSTANTE. La WNBA juega 40 minutos y la NBA 48; con 48
  // cableado, la cinta de la WNBA repartía a todo el mundo sobre ocho minutos que no existen y el "cuarto
  // cuarto" caía en tiempo vacío (una titular de 32 min aparecía con 3,2 en Q4). Se toma la mediana del
  // final del último tramo sin prórroga, que es exactamente la duración reglamentaria observada.
  if (!regMin) {
    const ends = gs.filter((g) => !g.ot).map((g) => { const a = unpack(g); return a.length ? a[a.length - 1].e / 60 : null; })
      .filter(Number.isFinite).sort((a, b) => a - b);
    regMin = ends.length ? Math.round(ends[Math.floor(ends.length / 2)]) : 48;
  }
  const NB = bins || regMin;                                     // un bin por minuto de tiempo reglamentario
  const binSec = (regMin * 60) / NB;
  const acc = new Map();                                          // id → Float64Array(NB)
  let wTot = 0;
  gs.forEach((g, gi) => {
    const w = Math.pow(0.5, gi / halfLife); wTot += w;
    const isHome = String(g.home.id) === String(teamId);
    for (const s of unpack(g)) {
      const idx = isHome ? s.h : s.a; if (!idx) continue;
      const ids = idx.map((i) => (g.roster[i] || {}).id).filter(Boolean);
      const b0 = Math.max(0, Math.floor(s.s / binSec)), b1 = Math.min(NB - 1, Math.ceil(s.e / binSec) - 1);
      for (const id of ids) {
        if (!acc.has(id)) acc.set(id, new Float64Array(NB));
        const a = acc.get(id);
        for (let b = b0; b <= b1; b++) {
          // fracción del bin realmente cubierta por el tramo: sin esto, un tramo de 12 segundos contaría
          // como un minuto entero y la cinta mentiría en los cambios rápidos
          const lo = Math.max(s.s, b * binSec), hi = Math.min(s.e, (b + 1) * binSec);
          if (hi > lo) a[b] += w * ((hi - lo) / binSec);
        }
      }
    }
  });
  const names = nameIndex(games);
  const rows = [...acc.entries()].map(([id, a]) => {
    const p = Array.from(a).map((x) => r2(Math.min(1, x / Math.max(wTot, 1e-9)), 3));
    const meta = names.get(id) || {};
    return { id, name: meta.name || id, pos: meta.pos || null, on: p,
      minutes: r2(p.reduce((s, x) => s + x, 0) * (regMin / NB), 1),
      q1: r2(p.slice(0, Math.floor(NB / 4)).reduce((s, x) => s + x, 0) * (regMin / NB), 1),
      q4: r2(p.slice(Math.floor(3 * NB / 4)).reduce((s, x) => s + x, 0) * (regMin / NB), 1) };
  }).filter((r) => r.minutes > 1).sort((a, b) => b.minutes - a.minutes);
  return { team_id: String(teamId), games: gs.length, bins: NB, reg_minutes: regMin, minutes_per_bin: r2(regMin / NB, 3), rows };
}

// ---- 3) PROBABILIDAD DE SER TITULAR Y DE CERRAR ----------------------------------------------------------
// Dos preguntas distintas. Titular sale del acta. Cerrador sale de quién está en cancha en los últimos
// minutos DE PARTIDOS APRETADOS: quién cierra un +25 no informa de nada, y meterlo contamina la respuesta.
function starterAndCloser(games, teamId, { lastN = 15, halfLife = 6, closeSecs = 300, maxMargin = 8 } = {}) {
  const gs = games.filter((g) => played(g) && (String(g.home.id) === String(teamId) || String(g.away.id) === String(teamId)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, lastN);
  if (!gs.length) return null;
  const st = new Map(), cl = new Map();
  let wSt = 0, wCl = 0;
  gs.forEach((g, gi) => {
    const w = Math.pow(0.5, gi / halfLife);
    wSt += w;
    for (const p of (g.players || [])) if (String(p.t) === String(teamId) && p.st) st.set(String(p.id), (st.get(String(p.id)) || 0) + w);
    // cierre: solo si el partido llegó apretado al último tramo
    const arr = unpack(g); if (!arr.length || !g.roster) return;
    const isHome = String(g.home.id) === String(teamId);
    const end = arr[arr.length - 1].e;
    const margin = Math.abs((g.home.pts || 0) - (g.away.pts || 0));
    if (margin > maxMargin) return;
    wCl += w;
    const secs = new Map();
    for (const s of arr) {
      if (s.e <= end - closeSecs) continue;
      const idx = isHome ? s.h : s.a; if (!idx) continue;
      const dur = s.e - Math.max(s.s, end - closeSecs);
      for (const i of idx) { const id = (g.roster[i] || {}).id; if (id) secs.set(id, (secs.get(id) || 0) + dur); }
    }
    // se cuenta como "cerrador" quien estuvo la mayor parte de esos minutos, no quien pisó la cancha 8 seg
    for (const [id, sec] of secs) if (sec >= closeSecs * 0.5) cl.set(id, (cl.get(id) || 0) + w);
  });
  const names = nameIndex(games);
  const ids = new Set([...st.keys(), ...cl.keys()]);
  const rows = [...ids].map((id) => ({
    id, name: (names.get(id) || {}).name || id,
    p_start: r2(wSt ? (st.get(id) || 0) / wSt : null, 3),
    p_close: wCl ? r2((cl.get(id) || 0) / wCl, 3) : null,
  })).sort((a, b) => (b.p_start || 0) - (a.p_start || 0));
  return { team_id: String(teamId), games: gs.length, close_games: r2(wCl, 2), rows,
    note: wCl < 2 ? 'pocos partidos apretados en la ventana: la probabilidad de cierre es débil' : null };
}

// ---- 4) CON QUIÉN JUEGA CADA UNO (staggering) ------------------------------------------------------------
// Matriz de segundos compartidos. Sirve para dos cosas: explicar por qué un suplente rinde distinto según
// con quién sale, y —clave para el árbol de reemplazo— saber a quién le tocan de verdad los minutos que
// deja un ausente. Los minutos de una estrella no van al 12º hombre: van a quien ya jugaba a su lado.
function sharedMinutes(games, teamId, { lastN = 20 } = {}) {
  const gs = games.filter((g) => played(g) && g.roster && g.stints
    && (String(g.home.id) === String(teamId) || String(g.away.id) === String(teamId)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, lastN);
  const pair = new Map(), solo = new Map();
  for (const g of gs) {
    const isHome = String(g.home.id) === String(teamId);
    for (const s of unpack(g)) {
      const idx = isHome ? s.h : s.a; if (!idx) continue;
      const ids = idx.map((i) => (g.roster[i] || {}).id).filter(Boolean);
      const dur = (s.e - s.s) / 60;
      for (let i = 0; i < ids.length; i++) {
        solo.set(ids[i], (solo.get(ids[i]) || 0) + dur);
        for (let j = i + 1; j < ids.length; j++) {
          const k = [ids[i], ids[j]].sort().join('|');
          pair.set(k, (pair.get(k) || 0) + dur);
        }
      }
    }
  }
  return { minutes: solo, together: pair, games: gs.length };
}

// ---- 5) ÁRBOL DE REEMPLAZO -------------------------------------------------------------------------------
// Si falta X: ¿quién absorbe sus minutos? El reparto es proporcional a (a) los minutos que ese jugador ya
// juega y (b) cuánto SUELE jugar sin X en cancha —los "minutos de relevo" reales—. Un compañero que nunca
// coincide con X es probablemente su suplente directo y debe recibir más, no menos.
function replacementTree(games, teamId, missingIds, { lastN = 20 } = {}) {
  const sh = sharedMinutes(games, teamId, { lastN });
  if (!sh.games) return null;
  const names = nameIndex(games);
  const out = [];
  for (const mid of (missingIds || []).map(String)) {
    const mMin = sh.minutes.get(mid) || 0;
    if (!(mMin > 0)) { out.push({ id: mid, name: (names.get(mid) || {}).name || mid, minutes: 0, absorbers: [], note: 'sin minutos en la ventana' }); continue; }
    const cands = [];
    for (const [id, min] of sh.minutes) {
      if (id === mid || (missingIds || []).map(String).includes(id)) continue;
      const tog = sh.together.get([id, mid].sort().join('|')) || 0;
      const apart = Math.max(0, min - tog);                     // minutos que ya juega SIN el ausente
      // afinidad de relevo: cuánto de lo suyo es sin X. Un suplente directo tiene ratio alto.
      const relief = min > 0 ? apart / min : 0;
      cands.push({ id, name: (names.get(id) || {}).name || id, min: r2(min, 1), together: r2(tog, 1), apart: r2(apart, 1), relief: r2(relief, 3),
        score: apart * (0.5 + relief) });                        // peso: minutos disponibles × afinidad
    }
    const tot = cands.reduce((s, c) => s + c.score, 0) || 1;
    const absorbers = cands.sort((a, b) => b.score - a.score).slice(0, 6)
      .map((c) => ({ ...c, share: r2(c.score / tot, 3), minutes_gained: r2((mMin / Math.max(sh.games, 1)) * (c.score / tot), 1) }));
    out.push({ id: mid, name: (names.get(mid) || {}).name || mid, minutes: r2(mMin / Math.max(sh.games, 1), 1), absorbers });
  }
  return { team_id: String(teamId), games: sh.games, tree: out };
}

// ---- 6) REDISTRIBUCIÓN DE USO ----------------------------------------------------------------------------
// Los minutos son la mitad de la historia. La otra mitad: los TIROS, las ASISTENCIAS y los REBOTES del
// ausente también se reparten, y no necesariamente a la misma gente ni en la misma proporción. Un base
// lesionado deja asistencias que absorbe otro creador; un pívot deja rebotes que absorbe otro grande.
function usageRedistribution(games, teamId, missingIds, { lastN = 20 } = {}) {
  const tree = replacementTree(games, teamId, missingIds, { lastN });
  if (!tree) return null;
  const gs = games.filter((g) => played(g) && (String(g.home.id) === String(teamId) || String(g.away.id) === String(teamId)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, lastN);
  const per = new Map();                                          // id → medias por partido
  for (const g of gs) for (const p of (g.players || [])) {
    if (String(p.t) !== String(teamId)) continue;
    const c = per.get(String(p.id)) || { n: 0, fga: 0, ast: 0, reb: 0, pts: 0, min: 0 };
    c.n++; c.fga += p.fga || 0; c.ast += p.ast || 0; c.reb += p.reb || 0; c.pts += p.pts || 0; c.min += p.min || 0;
    per.set(String(p.id), c);
  }
  const mean = (id, k) => { const c = per.get(String(id)); return c && c.n ? c[k] / c.n : 0; };
  const out = tree.tree.map((t) => {
    const freed = { fga: mean(t.id, 'fga'), ast: mean(t.id, 'ast'), reb: mean(t.id, 'reb'), pts: mean(t.id, 'pts') };
    // el reparto por categoría pondera la cuota de minutos POR la tasa propia del absorbente en esa
    // categoría: quien ya asiste, absorbe asistencias; quien ya rebotea, absorbe rebotes.
    const rate = (id, k) => { const m = mean(id, 'min'); return m > 0 ? mean(id, k) / m : 0; };
    const cats = ['fga', 'ast', 'reb'];
    const abs = t.absorbers.map((a) => {
      const g = {};
      for (const c of cats) g[c] = rate(a.id, c);
      return { ...a, rates: g };
    });
    const split = {};
    for (const c of cats) {
      const tot = abs.reduce((s, a) => s + a.share * a.rates[c], 0) || 1;
      split[c] = abs.map((a) => ({ id: a.id, name: a.name, gain: r2((freed[c] * a.share * a.rates[c]) / tot, 2) }))
        .filter((x) => x.gain > 0.15).slice(0, 5);
    }
    return { id: t.id, name: t.name, freed: { fga: r2(freed.fga, 1), ast: r2(freed.ast, 1), reb: r2(freed.reb, 1), pts: r2(freed.pts, 1) }, split };
  });
  return { team_id: String(teamId), games: gs.length, rows: out };
}

// ---- 7) SALUD DE LA PLANTILLA ----------------------------------------------------------------------------
// No es "cuántos lesionados": es qué fracción del IMPACTO habitual está disponible. Perder al décimo hombre
// y perder al que juega 37 minutos no son la misma noticia, y un contador de bajas los iguala.
function lineupHealth(rotationProfileRows, rapm, outIds, doubtful = {}) {
  if (!rotationProfileRows || !rotationProfileRows.length) return null;
  const outSet = new Set((outIds || []).map(String));
  let total = 0, avail = 0, lost = [];
  for (const r of rotationProfileRows) {
    const imp = rapm && rapm.players[String(r.id)] ? Math.max(0, rapm.players[String(r.id)].net + 3) : 3;   // +3 ≈ nivel de reemplazo
    const wgt = (r.exp || 0) * imp;
    total += wgt;
    const pr = outSet.has(String(r.id)) ? 0 : (doubtful[String(r.id)] != null ? doubtful[String(r.id)] : 1);
    avail += wgt * pr;
    if (pr < 1) lost.push({ id: r.id, name: r.name, min: r.exp, p_play: pr, impact: rapm && rapm.players[String(r.id)] ? rapm.players[String(r.id)].net : null });
  }
  if (!(total > 0)) return null;
  const pct = avail / total;
  return { health: r2(pct, 3), missing: lost.sort((a, b) => (b.min || 0) - (a.min || 0)),
    label: pct > 0.97 ? 'plantilla completa' : pct > 0.9 ? 'baja menor' : pct > 0.78 ? 'baja importante' : 'plantilla muy mermada' };
}

module.exports = { lineupRatings, rotationTemplate, starterAndCloser, sharedMinutes, replacementTree, usageRedistribution, lineupHealth, nameIndex };
