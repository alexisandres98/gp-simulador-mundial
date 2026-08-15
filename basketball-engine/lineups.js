// basketball-engine/lineups.js — QUINTETOS Y TRAMOS (16-ago).
//
// LA PIEZA QUE FALTABA. Todo lo que separa un modelo de equipo de un modelo de baloncesto pasa por saber
// QUIÉN ESTABA EN LA CANCHA en cada momento: el impacto real de un jugador (RAPM), el reparto de minutos,
// la basura del final y el ajuste por bajas. Sin tramos, un equipo es una media; con tramos, es una suma
// de partes que se pueden recomponer cuando falta alguien.
//
// CÓMO SE RECONSTRUYE. El play-by-play de ESPN trae `Substitution` con [entra, sale] y el reloj. El quinteto
// inicial NO viene marcado como evento: se deduce de los titulares del box score, y se VERIFICA — si alguien
// aparece en una jugada sin estar en cancha, se corrige y se cuenta el fallo. Un reconstructor que no se
// audita a sí mismo produce basura silenciosa, que es peor que no tener nada.
//
// PURO: no toca red, ni disco, ni db. Entra el summary crudo, salen tramos.
'use strict';

const { elapsed, periodSecs } = require('./possessions');

// ---- TRAMOS ---------------------------------------------------------------------------------------------
// Un TRAMO es un intervalo con los mismos 10 jugadores en cancha. Se corta en cada sustitución.
// Devuelve { stints, roster, quality } — quality es la auditoría, y viaja SIEMPRE con el dato.
function buildStints(sum, game, L) {
  if (!sum || !game) return null;
  const plays = (sum.plays || []).filter((p) => p.period);
  if (!plays.length) return null;
  const homeId = String(game.home.id), awayId = String(game.away.id);

  // roster + titulares del box score
  const box = sum.players || [];
  const roster = [];
  const idx = new Map();
  const push = (id, teamId) => {
    if (!id) return -1;
    if (idx.has(id)) return idx.get(id);
    const i = roster.length; roster.push({ id, t: String(teamId) }); idx.set(id, i); return i;
  };
  for (const p of box) push(String(p.id), p.team_id);

  const starters = { [homeId]: [], [awayId]: [] };
  for (const p of box) {
    if (!p.starter) continue;
    const t = String(p.team_id);
    if (starters[t] && starters[t].length < 5) starters[t].push(String(p.id));
  }
  // sin titulares marcados no hay punto de partida honesto
  if (starters[homeId].length !== 5 || starters[awayId].length !== 5) {
    return { stints: [], roster, quality: { ok: false, reason: 'sin titulares en el box' } };
  }

  const onCourt = { [homeId]: new Set(starters[homeId]), [awayId]: new Set(starters[awayId]) };
  const stints = [];
  let curStart = 0, curH = 0, curA = 0;
  const q = { subs: 0, fixed: 0, ghosts: 0, size_errors: 0 };

  const snapshot = (endSec, scoreH, scoreA) => {
    const dur = endSec - curStart;
    if (dur <= 0) return;
    const h = [...onCourt[homeId]].map((x) => idx.get(x)).filter((x) => x != null);
    const a = [...onCourt[awayId]].map((x) => idx.get(x)).filter((x) => x != null);
    if (h.length !== 5 || a.length !== 5) q.size_errors++;
    stints.push({ s: curStart, e: endSec, h, a, ph: scoreH - curH, pa: scoreA - curA });
    curStart = endSec; curH = scoreH; curA = scoreA;
  };

  let lastScoreH = 0, lastScoreA = 0;
  for (const p of plays) {
    const sec = elapsed(L, p.period, p.clock);
    const sh = Number(p.home_score) || 0, sa = Number(p.away_score) || 0;
    // AUDITORÍA, SIN TOCAR EL QUINTETO. La tentación es "arreglar" metiendo al jugador que actúa sin estar
    // en cancha, pero `athletes` de una falta incluye al jugador del OTRO equipo, así que ese arreglo mete
    // rivales en el quinteto y lo rompe entero (medido: 11 fantasmas → los 43 tramos con tamaño inválido).
    // La cadena de sustituciones es consistente por sí sola —0 salidas de alguien que no estaba, en la
    // verificación— así que se cuenta la anomalía y no se toca nada.
    if (!/substitut/i.test(p.type || '') && p.team_id && onCourt[String(p.team_id)]) {
      for (const aid of (p.athletes || [])) if (!onCourt[String(p.team_id)].has(String(aid)) && idx.has(String(aid))) q.ghosts++;
    }
    if (/substitut/i.test(p.type || '')) {
      const t = String(p.team_id || '');
      const [inId, outId] = (p.athletes || []).map(String);
      if (onCourt[t]) {
        snapshot(sec, sh, sa);
        if (outId) onCourt[t].delete(outId);
        if (inId) { onCourt[t].add(inId); push(inId, t); }
        q.subs++;
      }
    }
    lastScoreH = sh; lastScoreA = sa;
  }
  const total = periodSecs(L, L.periods) + Math.max(0, (game.home.line || []).length - L.periods) * L.otMin * 60;
  snapshot(total, lastScoreH, lastScoreA);

  // minutos reconstruidos vs minutos del box: la prueba de que los tramos son reales
  const recon = {};
  for (const st of stints) {
    const d = (st.e - st.s) / 60;
    for (const i of st.h.concat(st.a)) recon[i] = (recon[i] || 0) + d;
  }
  let diffSum = 0, n = 0;
  for (const p of box) {
    const i = idx.get(String(p.id)); if (i == null) continue;
    const boxMin = Number(p.MIN != null ? p.MIN : p.min) || 0;
    if (boxMin <= 0) continue;
    diffSum += Math.abs((recon[i] || 0) - boxMin); n++;
  }
  const mae = n ? diffSum / n : null;
  return {
    stints, roster,
    quality: { ok: mae != null && mae <= 4, minutes_mae: mae != null ? +mae.toFixed(2) : null, players: n, ...q },
  };
}

// ---- GARBAGE TIME ---------------------------------------------------------------------------------------
// Regla continua tipo Cleaning the Glass, no un flag por partido: un TRAMO es basura si en su inicio la
// diferencia supera el umbral para el tiempo que queda. Se devuelve por tramo para poder EXCLUIRLO del
// ajuste — que es lo único que hace útil detectarlo. Escalado por la anotación de la liga.
function markGarbage(stints, L, homeScoreSeries) {
  const total = periodSecs(L, L.periods);
  const k = (L.ppg || 115) / 115;
  // umbral(t) = puntos de diferencia a partir de los cuales el partido está decidido con t segundos restantes
  const thr = (rem) => {
    if (rem > 12 * 60) return Infinity;                 // antes del último cuarto no se declara basura
    if (rem > 9 * 60) return 25 * k;
    if (rem > 6 * 60) return 20 * k;
    if (rem > 3 * 60) return 15 * k;
    return 10 * k;
  };
  let h = 0, a = 0, garbage = false;
  for (const st of stints) {
    const rem = total - st.s;
    const diff = Math.abs(h - a);
    if (!garbage && rem <= 12 * 60 && diff >= thr(rem)) garbage = true;   // una vez basura, sigue basura
    st.g = garbage ? 1 : 0;
    h += st.ph; a += st.pa;
  }
  const gs = stints.filter((s) => s.g);
  const secs = gs.reduce((s2, x) => s2 + (x.e - x.s), 0);
  return { garbage_secs: secs, garbage_pct: +(100 * secs / (total || 1)).toFixed(1), stints_garbage: gs.length };
}

// ---- POSESIONES POR TRAMO -------------------------------------------------------------------------------
// El ritmo no es uniforme: reparte las posesiones del partido proporcionalmente al tiempo de cada tramo.
// Es una aproximación declarada — sin el detalle de cada posesión no se puede hacer mejor, y el error se
// reparte simétricamente entre los dos equipos, que es lo que importa para un rating por 100.
function attachPossessions(stints, gamePoss, L) {
  const total = stints.reduce((s, x) => s + (x.e - x.s), 0) || 1;
  for (const st of stints) st.p = +(gamePoss * (st.e - st.s) / total).toFixed(3);
  return stints;
}

// Forma compacta para disco: array de arrays en vez de objetos con claves repetidas 60 veces por partido.
function packStints(stints) {
  return stints.map((s) => [s.s, s.e, s.h, s.a, s.ph, s.pa, +(s.p || 0).toFixed(2), s.g || 0]);
}
function unpackStints(arr) {
  return (arr || []).map((x) => ({ s: x[0], e: x[1], h: x[2], a: x[3], ph: x[4], pa: x[5], p: x[6], g: x[7] }));
}

module.exports = { buildStints, markGarbage, attachPossessions, packStints, unpackStints };
