// basketball-engine/minutes.js — PROYECCIÓN DE MINUTOS Y AJUSTE POR BAJAS (16-ago).
//
// EL PUENTE. El RAPM dice cuánto vale cada jugador; los minutos dicen cuánto de ese valor entra al partido.
// Sin este módulo el rating de equipo sigue siendo una media histórica que no sabe quién juega hoy — que es
// exactamente el hueco que nos separaba del mercado en NBA, donde la línea se mueve 2-6 puntos por una baja.
//
// CÓMO SE PROYECTA. Media exponencial de los minutos recientes (los últimos partidos pesan más que los de
// hace un mes) + reparto de los minutos liberados por los ausentes entre los disponibles, con dos reglas
// que evitan las salidas absurdas:
//   1) TECHO por jugador: nadie pasa de su máximo histórico + 6 minutos. Un suplente no juega 44 minutos
//      porque falten dos titulares; el entrenador estira la rotación, no a una persona.
//   2) NORMALIZACIÓN al total de la liga (240 minutos-jugador en NBA/WNBA, 200 en NCAA): lo que sobra tras
//      aplicar los techos baja a los siguientes de la rotación, y si aun así falta, entra nivel de reemplazo.
// El reparto es proporcional al peso reciente de cada disponible, no a partes iguales: los minutos de una
// estrella lesionada van sobre todo a quien ya jugaba a su lado, no al 12º hombre.
//
// PURO: entra el historial derivado + la lista de bajas, salen minutos. Sin red, sin disco, sin db.
'use strict';

// Minutos-jugador totales de un partido: 5 en cancha × minutos de partido.
function teamMinutes(L) { return 5 * (L && L.minutes ? L.minutes : 48); }

// ---- PERFIL DE ROTACIÓN ---------------------------------------------------------------------------------
// Para cada jugador de un equipo: minutos esperados (media exponencial), techo observado, y cuántos partidos
// de los recientes jugó. `startShare` es qué fracción de sus apariciones fue como titular — se usa para
// decidir a quién asciende la rotación cuando falta un titular.
function rotationProfile(games, teamId, { lastN = 15, halfLife = 5, now = Date.now() } = {}) {
  const gs = games
    .filter((g) => String(g.home.id) === String(teamId) || String(g.away.id) === String(teamId))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, lastN);
  if (!gs.length) return null;
  const acc = new Map();
  let wTotal = 0;                                    // peso de TODOS los partidos de la ventana
  gs.forEach((g, i) => {
    const w = Math.pow(0.5, i / halfLife);
    wTotal += w;
    for (const p of (g.players || [])) {
      if (String(p.t) !== String(teamId)) continue;
      const cur = acc.get(p.id) || { id: p.id, name: p.n, pos: p.pos, msum: 0, max: 0, apps: 0, starts: 0 };
      cur.msum += w * (p.min || 0);
      cur.max = Math.max(cur.max, p.min || 0);
      if ((p.min || 0) > 0) cur.apps++;
      if (p.st) cur.starts++;
      acc.set(p.id, cur);
    }
  });
  // DIVIDIR POR LA VENTANA ENTERA, no por los partidos en los que apareció. Promediar solo sus apariciones
  // dice "cuánto juega CUANDO juega", que no es la pregunta: quien se perdió 10 de los últimos 15 partidos
  // no espera sus minutos habituales. Con el divisor equivocado la suma del equipo se iba muy por encima de
  // los 200/240 minutos reales y la normalización recortaba a TODOS — la titular pasaba de 33 a 24,6.
  const rows = [...acc.values()].map((r) => ({
    id: r.id, name: r.name, pos: r.pos,
    exp: +(r.msum / Math.max(wTotal, 1e-9)).toFixed(2),
    max: r.max, apps: r.apps, startShare: +(r.starts / gs.length).toFixed(2),
  })).filter((r) => r.exp > 0.5).sort((a, b) => b.exp - a.exp);
  return { team_id: String(teamId), games: gs.length, rows };
}

// ---- PROYECCIÓN CON BAJAS -------------------------------------------------------------------------------
// `out` = ids que NO juegan. `doubtful` = ids con probabilidad de jugar (se les aplica un factor).
function projectMinutes(profile, { out = [], doubtful = {}, L = null, replacementName = 'Reemplazo' } = {}) {
  if (!profile || !profile.rows.length) return null;
  const TOTAL = teamMinutes(L || { minutes: 48 });
  const outSet = new Set((out || []).map(String));
  const avail = profile.rows.filter((r) => !outSet.has(String(r.id)));
  if (!avail.length) return null;

  // base: minutos esperados, descontando a los dudosos por su probabilidad de jugar
  const base = avail.map((r) => {
    const pr = doubtful[String(r.id)] != null ? Math.max(0, Math.min(1, doubtful[String(r.id)])) : 1;
    return { ...r, prob: pr, mins: r.exp * pr, cap: Math.min(TOTAL / 5 + 6, r.max + 6) };
  });
  const lost = TOTAL - base.reduce((s, r) => s + r.mins, 0);

  if (lost > 0.5) {
    // repartir proporcionalmente al peso reciente, respetando techos; lo que no cabe se vuelve a repartir
    let remaining = lost;
    for (let pass = 0; pass < 6 && remaining > 0.25; pass++) {
      const open = base.filter((r) => r.mins < r.cap - 0.01 && r.prob > 0);
      const wsum = open.reduce((s, r) => s + r.mins + 1, 0);   // +1 evita que un 0 se quede fuera para siempre
      if (!open.length || wsum <= 0) break;
      let given = 0;
      for (const r of open) {
        const want = remaining * (r.mins + 1) / wsum;
        const can = Math.min(want, r.cap - r.mins);
        r.mins += can; given += can;
      }
      remaining -= given;
      if (given < 0.01) break;
    }
    if (remaining > 1) base.push({ id: '__repl__', name: replacementName, pos: null, exp: 0, mins: remaining, prob: 1, replacement: true });
  } else if (lost < -0.5) {
    // más minutos de los que caben (vuelve un lesionado): se escala todo hacia abajo
    const k = TOTAL / base.reduce((s, r) => s + r.mins, 0);
    for (const r of base) r.mins *= k;
  }
  const rows = base.filter((r) => r.mins > 0.2).sort((a, b) => b.mins - a.mins)
    .map((r) => ({ id: r.id, name: r.name, pos: r.pos, min: +r.mins.toFixed(1), base: +(r.exp || 0).toFixed(1),
      delta: +(r.mins - (r.exp || 0)).toFixed(1), prob: r.prob != null ? r.prob : 1, replacement: !!r.replacement }));
  const map = {};
  for (const r of rows) map[r.id] = r.min;
  return { team_id: profile.team_id, total: +rows.reduce((s, r) => s + r.min, 0).toFixed(1), rows, map,
    out: [...outSet], missing_minutes: +Math.max(0, lost).toFixed(1) };
}

// ---- BAJAS DESDE EL PARTE DE ESPN ----------------------------------------------------------------------
// El parte viene con estados en inglés. Se traduce a: fuera (no juega) o dudoso (probabilidad de jugar).
// Las probabilidades son las convenciones de la industria, y están acá a la vista para poder discutirlas.
const STATUS_PROB = { out: 0, doubtful: 0.25, questionable: 0.5, probable: 0.85, 'day-to-day': 0.7, available: 1, active: 1 };
function injuriesToRoster(injuries, teamId) {
  const out = [], doubtful = {};
  for (const t of (injuries || [])) {
    if (String(t.team_id) !== String(teamId)) continue;
    for (const i of (t.items || [])) {
      const st = String(i.status || '').toLowerCase().trim();
      const p = STATUS_PROB[st];
      if (p === 0) out.push(String(i.id));
      else if (p != null && p < 1) doubtful[String(i.id)] = p;
    }
  }
  return { out, doubtful };
}

module.exports = { rotationProfile, projectMinutes, injuriesToRoster, teamMinutes, STATUS_PROB };
