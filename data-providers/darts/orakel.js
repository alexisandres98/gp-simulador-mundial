// data-providers/darts/orakel.js — DARTS ORAKEL: la estadística de partido que la PDC no publica
//
// dartsorakel.com expone dos endpoints JSON sin clave (comprobado el 6-sep-2026):
//   · leaderboard por ventana de fechas: /api/stats/player?rankKey=&dateFrom=&dateTo=&minMatches=
//     → por jugador: stat (la media, %…), sumField1/sumField2 (numerador y denominador: puntos/dardos,
//       180s/legs, dobles/intentos). Ventanas arbitrarias = la foto point-in-time que necesita la validación.
//   · partidos de un jugador: /api/player/matches/{player_key}?rankKey=&dateFrom=&dateTo=  (solo devuelve
//     Players Championship, comprobado con todos los parámetros de filtro).
// Derechos: sitio privado sin licencia de redistribución → uso interno de investigación, admin-only, con
// atribución donde se enseñe el dato. Ritmo amable: una llamada cada ~350 ms.
'use strict';

const BASE = 'https://dartsorakel.com';
const APP = 'https://app.dartsorakel.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) GP-Simulador research/1.0';

// claves de estadística (del <select> de la web; las desconocidas caen en silencio a la media)
const RANK = { AVG: 25, X180: 26, CHECKOUT_PCT: 1053, LEGS_WON_PCT: 1027, HIGHEST_CHECKOUT: 1028, FIRST9: 1029, FIRST3: 1030, WITH_THROW: 1031, AGAINST_THROW: 1032, LEGS_WON_THROW1: 1039, LEGS_WON_THROW2: 1040, X171_180: 1045, X140S: 1046, FUNCTIONAL_DOUBLES: 1215, MATCH_WIN_PCT: 10011 };

async function getJson(url, { timeoutMs = 25000, retries = 2 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*' }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) { last = new Error(`HTTP ${r.status}`); await sleep(2500 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      try { return JSON.parse(txt); } catch { throw new Error('respuesta no-JSON'); }
    } catch (e) { last = e; await sleep(1200 * (i + 1)); }
  }
  throw last || new Error('orakel: sin respuesta');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// leaderboard de una estadística en una ventana [from, to] (YYYY-MM-DD)
async function leaderboard(rankKey, from, to, { minMatches = 3 } = {}) {
  const j = await getJson(`${APP}/api/stats/player?rankKey=${rankKey}&dateFrom=${from}&dateTo=${to}&minMatches=${minMatches}`);
  return {
    rankKey, from, to, minMatches, total: j.recordsTotal || 0,
    rows: (j.data || []).map((r) => ({ key: r.player_key, name: r.player_name, country: r.country || null, num: +r.sumField1, den: +r.sumField2, stat: parseFloat(String(r.stat).replace('%', '')), rank: r.rank })),
  };
}
// partidos (Players Championship) de un jugador con una estadística por partido
async function playerMatches(playerKey, rankKey, from, to, { length = 500 } = {}) {
  const j = await getJson(`${BASE}/api/player/matches/${playerKey}?rankKey=${rankKey}&dateFrom=${from}&dateTo=${to}&draw=1&start=0&length=${length}`);
  return {
    total: j.recordsTotal || 0,
    rows: (j.data || []).map((r) => ({
      event_key: r.event_key, tournament: r.tournament_name, tournament_no: r.tournament_no, category: r.pdc_category,
      date: String(r.match_date || '').slice(0, 10), round: r.round,
      winner_key: r.winner_key, loser_key: r.loser_key, winner: r.winner_name, loser: r.loser_name,
      winner_score: r.winner_score, loser_score: r.loser_score, result: r.result,
      stat1: r.stat1 != null ? +r.stat1 : null, stat2: r.stat2 != null ? +r.stat2 : null, stat: r.stat != null ? parseFloat(String(r.stat).replace('%', '')) : null,
    })),
  };
}

module.exports = { RANK, leaderboard, playerMatches, getJson, sleep };
