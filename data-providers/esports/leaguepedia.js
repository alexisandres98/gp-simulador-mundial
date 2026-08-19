// data-providers/esports/leaguepedia.js — KILLS Y DURACIÓN POR PARTIDA EN LoL (19-ago).
//
// POR QUÉ EXISTE, medido en producción: LoL llevaba 18 picks generadas y CERO liquidadas. No era un fallo
// de emparejamiento ni de nombres — era estructural. LoL genera sus picks en las familias de KILLS (es el
// único de los cuatro juegos con ese mercado abierto), y la fuente de resultados que teníamos
// —lolesports— solo publica el MARCADOR DE SERIE. Sin kills por partida, `settleOne` devolvía null y la
// pick se quedaba abierta para siempre. Una pick que no puede liquidarse nunca no produce CLV, y sin CLV
// no sirve para la revisión del lunes: es trabajo que se tira.
//
// La fuente correcta ya la usamos: `ScoreboardGames` de Leaguepedia trae Team1Kills/Team2Kills, duración y
// objetivos, y es la misma de la que salió la base histórica. Aquí se pide solo la ventana reciente.
//
// EL LIMITADOR ES UN CUBO DE FICHAS, no un límite por tamaño: comprobado que una petición de 500 filas pasa
// y la siguiente de 50 no. Así que se pide UNA vez, ancho, y se cachea fuerte. Liquidar no es urgente —
// pasa una vez cada pocas horas— y gastar fichas aquí se las quita al rellenado histórico.
'use strict';

const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com)';
const CACHE = { at: 0, since: null, rows: [] };

async function cargo(where, limit = 500) {
  const q = new URLSearchParams({
    action: 'cargoquery', format: 'json', tables: 'ScoreboardGames',
    fields: ['Team1', 'Team2', 'Team1Kills', 'Team2Kills', 'Team1Score', 'Team2Score',
      'Gamelength_Number', 'WinTeam', 'DateTime_UTC'].map((f) => 'ScoreboardGames.' + f).join(','),
    where, order_by: 'ScoreboardGames.DateTime_UTC DESC', limit: String(limit),
  });
  const r = await fetch('https://lol.fandom.com/api.php?' + q, {
    headers: { 'user-agent': UA }, signal: AbortSignal.timeout(35000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.info || j.error.code);
  return (j.cargoquery || []).map((x) => x.title);
}

const N = (x) => (x == null || x === '' ? null : Number(x));

// Devuelve una fila POR SERIE, con sus partidas dentro — la misma forma que las otras fuentes del módulo
// de resultados, para que `settleOne` no tenga que saber de dónde vino el dato.
async function lolGamesWithKills({ since = null, ttlMs = 30 * 60e3 } = {}) {
  const from = since || new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  if (CACHE.rows.length && CACHE.since === from && Date.now() - CACHE.at < ttlMs) return CACHE.rows;
  const raw = await cargo(`ScoreboardGames.DateTime_UTC >= '${from} 00:00:00'`);
  // agrupar las partidas en series: mismo par de equipos dentro de la misma jornada
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  const bySeries = new Map();
  for (const g of raw) {
    const t1 = g.Team1, t2 = g.Team2;
    const at = String(g['DateTime UTC'] || '');
    if (!t1 || !t2 || !at) continue;
    const day = at.slice(0, 10);
    const pair = [norm(t1), norm(t2)].sort().join('|');
    const k = `${day}|${pair}`;
    if (!bySeries.has(k)) bySeries.set(k, { at, a: t1, b: t2, maps: [], maps_a: 0, maps_b: 0 });
    const S = bySeries.get(k);
    // los lados pueden invertirse entre partidas de la misma serie: se orientan al primero visto
    const flip = norm(t1) !== norm(S.a);
    const ka = N(flip ? g.Team2Kills : g.Team1Kills), kb = N(flip ? g.Team1Kills : g.Team2Kills);
    const win = g.WinTeam ? (norm(g.WinTeam) === norm(S.a) ? 'a' : 'b') : null;
    if (win === 'a') S.maps_a++; else if (win === 'b') S.maps_b++;
    S.maps.push({ n: S.maps.length + 1, map: null, rounds: null, ot: 0,
      kills_a: ka, kills_b: kb, kills_total: (ka != null && kb != null) ? ka + kb : null,
      minutes: N(g['Gamelength Number']), winner: win });
    if (at < S.at) S.at = at;
  }
  const rows = [...bySeries.values()].map((s) => ({
    source: 'leaguepedia', provider_id: null,
    at: s.at.replace(' ', 'T') + 'Z', a: s.a, b: s.b,
    maps_a: s.maps_a, maps_b: s.maps_b, maps: s.maps,
    kills_total: s.maps.reduce((t, m) => t + (m.kills_total || 0), 0) || null,
  }));
  CACHE.rows = rows; CACHE.at = Date.now(); CACHE.since = from;
  return rows;
}

module.exports = { lolGamesWithKills };
