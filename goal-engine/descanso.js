// goal-engine/descanso.js — EL MARCADOR AL DESCANSO, RECONSTRUIDO DE LOS GOLES CON SU TIEMPO (13-sep)
//
// POR QUÉ. Las familias de mitad no se pueden liquidar con el marcador final: hace falta la foto del
// descanso, y nuestro archivo de resultados (`data/clubs/results-<liga>.json`) solo guarda el final. La
// fuente más barata y sin llave es ESPN, que en el resumen de cada partido publica `keyEvents` con cada
// gol, su periodo y su equipo. Comprobado el 13-sep contra Bournemouth-Brentford: goles en el 34' y el 38'
// del primer periodo y en el 52' y el 56' del segundo → 1-1 al descanso, 2-2 al final. Correcto.
//
// LA PARANOIA, QUE AQUÍ NO ES OPCIONAL. Liquidar una mitad con los lados cambiados no se nota: paga como
// ganadora cada vez que pierde y desde fuera parece un modelo malo, no un signo invertido. Así que el
// descanso pasa DOS puertas antes de valer, y si falla cualquiera se devuelve `null` y la pick se queda sin
// liquidar (que es un coste de muestra, no un error de contabilidad):
//
//   1. EL NOMBRE. El local de ESPN tiene que resolver a nuestro local, con el mismo normalizador que ya usa
//      el resto del sistema. Si no resuelve, fuera.
//   2. EL CUADRE. Los goles de las dos mitades sumados tienen que dar EXACTAMENTE el marcador final que ya
//      teníamos por otra fuente. Si no cuadran, la lista de eventos está incompleta (ESPN a veces publica
//      el resumen antes de tener todos los goles) y el descanso que saldría de ella sería mentira.
//
// La segunda puerta es la que de verdad protege: aunque el nombre se resolviera al revés, un marcador final
// asimétrico no cuadraría y la pick se anularía. Solo pasa desapercibido el caso en que los dos lados dan
// el mismo número —y entonces la orientación da igual por construcción.
'use strict';

// ── PARTE PURA ──────────────────────────────────────────────────────────────────────────────────────────
// Separada a propósito: es la que decide, y se puede probar sin red.

// Un gol en la lista de ESPN es un evento con `scoringPlay: true`. Los autogoles cuentan para el equipo al
// que ESPN ya se los atribuye (el que se beneficia), así que no hay que girar nada; los penaltis de la
// tanda de desempate van en un periodo distinto del 1 y del 2 y por eso quedan fuera solos.
function golesPorPeriodo(keyEvents, { idLocal, idVisita } = {}) {
  const out = { p1: { home: 0, away: 0 }, p2: { home: 0, away: 0 }, otros: 0, sin_equipo: 0 };
  for (const e of (keyEvents || [])) {
    if (!e || e.scoringPlay !== true) continue;
    const per = e.period && Number(e.period.number);
    if (per !== 1 && per !== 2) { out.otros++; continue; }          // prórroga y penaltis: no son nuestro periodo
    const tid = e.team && (e.team.id != null ? String(e.team.id) : null);
    if (!tid) { out.sin_equipo++; continue; }
    const lado = tid === String(idLocal) ? 'home' : (tid === String(idVisita) ? 'away' : null);
    if (!lado) { out.sin_equipo++; continue; }
    out[per === 1 ? 'p1' : 'p2'][lado]++;
  }
  return out;
}

// El resultado final: { h1Home, h1Away } o null con el motivo. `finalConocido` es el marcador que ya
// tenemos por otra vía, orientado a NUESTRO local — es el que manda y el que se usa para cuadrar.
function descansoDesde(keyEvents, { idLocal, idVisita, finalConocido, espnEsNuestroLocal = true } = {}) {
  if (!Array.isArray(keyEvents) || !keyEvents.length) return { ok: false, why: 'sin eventos' };
  if (idLocal == null || idVisita == null) return { ok: false, why: 'sin ids de equipo' };
  const g = golesPorPeriodo(keyEvents, { idLocal, idVisita });
  if (g.sin_equipo) return { ok: false, why: `${g.sin_equipo} gol(es) sin equipo reconocible` };
  // orientar a NUESTRO local
  const gira = (o) => (espnEsNuestroLocal ? o : { home: o.away, away: o.home });
  const p1 = gira(g.p1), p2 = gira(g.p2);
  const ftH = p1.home + p2.home, ftA = p1.away + p2.away;
  if (finalConocido && (typeof finalConocido.homeGoals === 'number') && (typeof finalConocido.awayGoals === 'number')) {
    if (ftH !== finalConocido.homeGoals || ftA !== finalConocido.awayGoals) {
      return { ok: false, why: `no cuadra: de los eventos sale ${ftH}-${ftA} y el final conocido es ${finalConocido.homeGoals}-${finalConocido.awayGoals}` };
    }
  } else {
    return { ok: false, why: 'sin marcador final con el que cuadrar' };
  }
  return { ok: true, h1Home: p1.home, h1Away: p1.away, ftHome: ftH, ftAway: ftA, goles_fuera_de_periodo: g.otros };
}

// ── PARTE DE RED ────────────────────────────────────────────────────────────────────────────────────────
// `deps` inyecta el fetch y el comparador de nombres para que este módulo no dependa del servidor. Nunca
// lanza: cualquier fallo es `null` y la pick se queda sin liquidar.
const HOST = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const yyyymmdd = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');

async function buscaDescanso({ slug, home, away, kickoffAt, finalConocido, nombresIguales, fetchJson, ventanaDias = 1 } = {}) {
  if (!slug || !kickoffAt || typeof fetchJson !== 'function' || typeof nombresIguales !== 'function') return null;
  const ko = Date.parse(kickoffAt);
  if (!Number.isFinite(ko)) return null;
  const d0 = yyyymmdd(ko - ventanaDias * 86400e3), d1 = yyyymmdd(ko + ventanaDias * 86400e3);
  let sb = null;
  try { sb = await fetchJson(`${HOST}/${slug}/scoreboard?dates=${d0}-${d1}&limit=100`); } catch { return null; }
  const evs = (sb && sb.events) || [];
  let hit = null, espnEsNuestroLocal = true;
  for (const e of evs) {
    const c = (e.competitions || [])[0]; if (!c) continue;
    const L = (c.competitors || []).find((x) => x.homeAway === 'home');
    const V = (c.competitors || []).find((x) => x.homeAway === 'away');
    if (!L || !V) continue;
    const nl = L.team && (L.team.displayName || L.team.name), nv = V.team && (V.team.displayName || V.team.name);
    if (nombresIguales(nl, home) && nombresIguales(nv, away)) { hit = { e, L, V }; espnEsNuestroLocal = true; break; }
    if (nombresIguales(nl, away) && nombresIguales(nv, home)) { hit = { e, L, V }; espnEsNuestroLocal = false; break; }
  }
  if (!hit) return null;
  let sum = null;
  try { sum = await fetchJson(`${HOST}/${slug}/summary?event=${hit.e.id}`); } catch { return null; }
  const r = descansoDesde((sum && sum.keyEvents) || [], {
    idLocal: hit.L.team && hit.L.team.id, idVisita: hit.V.team && hit.V.team.id,
    finalConocido, espnEsNuestroLocal,
  });
  return r && r.ok ? { h1Home: r.h1Home, h1Away: r.h1Away, espn_event: hit.e.id } : { ok: false, why: (r && r.why) || 'sin descanso' };
}

module.exports = { golesPorPeriodo, descansoDesde, buscaDescanso, HOST };
