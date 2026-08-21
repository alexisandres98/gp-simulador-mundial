// data-providers/esports/results.js — LO QUE FALTABA PARA QUE EL CUARTO DEPORTE PUEDA MEDIRSE (16-ago).
//
// EL AGUJERO QUE TAPA. Hasta hoy esports generaba picks y NO PODÍA LIQUIDARLAS: ninguna de las tres casas
// publica marcadores (comprobado una por una — Cloudbet devuelve `settlement` vacío, y en Pinnacle y Bovada
// el partido terminado sale del catálogo; `/matchups/{id}/result` y `/sports/12/matchups/settled` son 404).
// Sin liquidación no hay ROI, ni acierto, ni CLV: el bucle "generar → medir → corregir" quedaba abierto y un
// deporte que no puede medirse no es un producto, es una demo.
//
// SE PROBÓ TAMBIÉN LA IDEA DE TIRAR DEL CIERRE DE LAS CASAS y no funciona, y conviene dejarlo escrito:
//   · Pinnacle  → no hay endpoint de liquidación pública; `/matchups/{id}` da 403 por geolocalización.
//   · Bovada    → el cupón solo mira hacia delante.
//   · Polymarket→ SÍ resuelve sus mercados, pero de CS2 solo cotiza FUTUROS del torneo (ganador del EWC,
//                 MVP, kills a cuchillo). No hay mercado por partido, así que no puede liquidar una pick de
//                 "menos de 20,5 rondas en el mapa 1".
//
// LAS CUATRO FUENTES, MEDIDAS EL 16-ago (no prometidas):
//   CS2       bo3.gg          ✔ la MISMA que ya construyó el histórico de 48.678 mapas. Sirve partidos
//                               terminados de los últimos días con marcador de serie, rondas POR MAPA y
//                               marca de prórroga. Es la única de las cuatro que llega al detalle de ronda,
//                               que es justo donde CS2 genera sus picks.
//   Dota 2    OpenDota        ✔ pública y sin clave. `/proMatches` → 100 partidos con `radiant_win`,
//                               marcador y duración.
//   LoL       lolesports      ✔ pública (la clave es la del propio cliente web). 39 eventos completados con
//                               marcador de serie.
//   Valorant  —               ✘ sin fuente todavía. Se declara, no se disimula.
//
// AVISO QUE NO SE DEBE BORRAR: el robots.txt de bo3.gg desaconseja el acceso automático a `/api/`. Se usa
// con throttle y sin paralelismo, igual que la cosecha histórica, y la interfaz de este archivo está pensada
// para que sustituirla por Liquipedia o FACEIT —cuando aprueben las solicitudes— sea cambiar un adaptador.
'use strict';

const BO3 = require('./bo3');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, headers = {}, { tries = 3, timeoutMs = 20000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(700 * (i + 1)); }
  }
  return null;
}

// ---- LA FORMA COMÚN --------------------------------------------------------------------------------------
// Todos los juegos devuelven lo MISMO, y lo que un juego no tiene viaja en null en vez de ausente: la capa
// que liquida tiene que poder decir "esta familia no se puede liquidar aquí" en vez de fallar en silencio.
//   { source, at, a, b, maps_a, maps_b, maps:[{ n, map, rounds, ot, score_a, score_b }] }
// `a` y `b` son NOMBRES: la resolución a identidades de GP la hace el motor, que tiene la base para hacerlo
// bien (y para negarse cuando no está seguro, que es lo importante).

// ── CS2 · bo3.gg ──────────────────────────────────────────────────────────────────────────────────────────
// Se piden partidos y mapas por separado y se unen por `match_id`. Los nombres de equipo salen de los MAPAS
// (`winner_clan_name` / `loser_clan_name`) y no del partido, porque el partido solo trae ids numéricos del
// proveedor que no están en nuestra base — y resolver por nombre es justo lo que la base sabe hacer.
async function cs2Results({ since, max = 300 } = {}) {
  const rows = [];
  await BO3.matches({ since, max, onPage: (p) => { for (const m of p) rows.push(BO3.normMatch(m)); } });
  const byId = new Map(rows.map((m) => [m.provider_id, m]));

  const games = [];
  await BO3.games({ since, max: max * 3, onPage: (p) => { for (const g of p) games.push(BO3.normGame(g)); } });

  const byMatch = new Map();
  for (const g of games) {
    if (!byMatch.has(g.match_id)) byMatch.set(g.match_id, []);
    byMatch.get(g.match_id).push(g);
  }

  const out = [];
  for (const [mid, gs] of byMatch) {
    const m = byId.get(mid) || null;
    gs.sort((x, y) => (x.number || 0) - (y.number || 0));
    // los dos nombres del enfrentamiento salen del conjunto de mapas; si algún mapa no los trae, se descarta
    const names = [...new Set(gs.flatMap((g) => [g.w_name, g.l_name]).filter(Boolean))];
    if (names.length !== 2) continue;
    const [a, b] = names;
    const maps = gs.map((g) => {
      const aWon = g.w_name === a;
      return {
        n: g.number || null, map: g.map || null,
        rounds: g.rounds != null ? g.rounds : (Number(g.w_score) + Number(g.l_score)) || null,
        ot: g.ot ? 1 : 0,
        score_a: aWon ? Number(g.w_score) : Number(g.l_score),
        score_b: aWon ? Number(g.l_score) : Number(g.w_score),
      };
    }).filter((x) => Number.isFinite(x.score_a) && Number.isFinite(x.score_b));
    if (!maps.length) continue;
    out.push({
      source: 'bo3', provider_id: mid,
      at: (m && m.at) || gs[0].at || null,
      a, b,
      maps_a: maps.filter((x) => x.score_a > x.score_b).length,
      maps_b: maps.filter((x) => x.score_b > x.score_a).length,
      maps,
      // bo3 no publica kills por mapa: la familia de kills NO se puede liquidar con esta fuente, y decirlo
      // es parte del contrato — liquidar a ciegas sería inventarse un resultado.
      has_rounds: true, has_kills: false,
    });
  }
  return out;
}

// ── Dota 2 · OpenDota ─────────────────────────────────────────────────────────────────────────────────────
// Pública y sin clave. Da el partido (un "mapa" en la gramática de GP) con su ganador y su duración, pero NO
// la estructura de serie: `series_id` existe pero el marcador de serie hay que reconstruirlo agrupando.
async function dota2Results({ since } = {}) {
  const j = await getJSON('https://api.opendota.com/api/proMatches');
  if (!Array.isArray(j)) return [];
  const cut = since ? Date.parse(since) / 1000 : 0;
  const bySeries = new Map();
  for (const m of j) {
    if (!m.radiant_name || !m.dire_name || (cut && m.start_time < cut)) continue;
    const key = m.series_id ? 's' + m.series_id : 'm' + m.match_id;
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key).push(m);
  }
  const out = [];
  for (const [key, ms] of bySeries) {
    ms.sort((x, y) => x.start_time - y.start_time);
    // el "local" es quien abrió como radiant en el primer mapa: es una convención, y va declarada
    const a = ms[0].radiant_name, b = ms[0].dire_name;
    const maps = ms.map((m, i) => {
      const aRad = m.radiant_name === a;
      const aWin = aRad ? m.radiant_win : !m.radiant_win;
      return {
        n: i + 1, map: null, rounds: null, ot: 0,
        score_a: aWin ? 1 : 0, score_b: aWin ? 0 : 1,
        duration_min: m.duration ? +(m.duration / 60).toFixed(1) : null,
        kills_a: aRad ? m.radiant_score : m.dire_score,
        kills_b: aRad ? m.dire_score : m.radiant_score,
      };
    });
    out.push({
      source: 'opendota', provider_id: key,
      at: new Date(ms[0].start_time * 1000).toISOString(),
      a, b,
      maps_a: maps.filter((x) => x.score_a > x.score_b).length,
      maps_b: maps.filter((x) => x.score_b > x.score_a).length,
      maps,
      // Dota sí trae kills (radiant_score/dire_score SON kills) y duración; no hay rondas porque el juego
      // no tiene rondas.
      has_rounds: false, has_kills: true,
      league: ms[0].league_name || null,
    });
  }
  return out;
}

// ── LoL · lolesports ──────────────────────────────────────────────────────────────────────────────────────
// La clave es la que publica su propio cliente web —igual que la de invitado de Pinnacle— y se deja
// sobreescribible por entorno para el día que la roten.
const LOL_KEY = () => process.env.LOLESPORTS_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
async function lolResults({ since } = {}) {
  const j = await getJSON('https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=es-ES', { 'x-api-key': LOL_KEY() });
  const evs = ((j && j.data && j.data.schedule) || {}).events || [];
  const cut = since ? Date.parse(since) : 0;
  const out = [];
  for (const e of evs) {
    if (e.state !== 'completed' || !e.match || !e.match.teams || e.match.teams.length < 2) continue;
    if (cut && Date.parse(e.startTime || 0) < cut) continue;
    const [t1, t2] = e.match.teams;
    const w1 = (t1.result && t1.result.gameWins) || 0, w2 = (t2.result && t2.result.gameWins) || 0;
    const maps = [];
    for (let i = 0; i < w1 + w2; i++) maps.push({ n: i + 1, map: null, rounds: null, ot: 0, score_a: null, score_b: null });
    out.push({
      source: 'lolesports', provider_id: e.match.id,
      at: e.startTime || null,
      a: t1.name, b: t2.name,
      maps_a: w1, maps_b: w2, maps,
      // el calendario da el marcador de SERIE pero no el detalle por partida: los kills y la duración —que
      // es donde LoL tendría edge— necesitan otra llamada. Se declara para que nadie liquide un total de
      // kills contra un dato que no existe.
      has_rounds: false, has_kills: false,
      league: (e.league && e.league.name) || null,
    });
  }
  return out;
}

// Leaguepedia primero (trae kills), lolesports de respaldo (solo marcador).
async function lolResultsWithKills(opts) {
  try {
    const LP = require('./leaguepedia');
    const rows = await LP.lolGamesWithKills(opts || {});
    if (rows && rows.length) return rows;
  } catch { /* cubo vacío o caída: se cae al respaldo */ }
  return lolResults(opts || {});
}

// Lee la cosecha propia de Valorant del disco persistente (o del repo en desarrollo). Sin red.
function valorantResults({ since = null } = {}) {
  const fs = require('fs'), path = require('path');
  // LEER DONDE LA COSECHA ESCRIBE DE VERDAD (21-ago). Esto leía `<disco>/esports/valorant/series.json` y
  // la cosecha escribe en `/data/val-raw` (su GP_VAL_DIR). Dos directorios distintos: el liquidador caía
  // siempre a la copia del repo, congelada el 17-ago, y por eso Valorant tenía 94 picks abiertas y CERO
  // liquidadas — no por nombres ni por fechas, sino porque leía un archivo que nadie actualiza desde que
  // se sembró. Se prueban las rutas en el orden en que es probable que estén, y gana la que traiga la
  // serie más reciente: si hay dos copias, la buena es la que está al día, no la primera que exista.
  const cands = [
    process.env.GP_VAL_DIR,
    fs.existsSync('/data') ? '/data/val-raw' : null,
    path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', '..', 'db.json')), 'esports', 'valorant'),
    path.join(__dirname, '..', '..', 'data', 'esports', 'valorant'),
  ].filter(Boolean);
  let doc = null, mejor = '';
  for (const d of cands) {
    let cand = null;
    try { cand = JSON.parse(fs.readFileSync(path.join(d, 'series.json'), 'utf8')); } catch { continue; }
    if (!cand || !cand.rows) continue;
    let ult = '';
    for (const r of Object.values(cand.rows)) if (r && r.at && r.at > ult) ult = r.at;
    if (ult > mejor) { mejor = ult; doc = cand; }
  }
  if (!doc || !doc.rows) return [];
  const from = since || new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  return Object.values(doc.rows)
    .filter((r) => r && r.at && r.at >= from && r.s1 != null && r.s2 != null)
    .map((r) => ({
      // `day_only`: esta fuente solo publica el DÍA, así que la hora es un relleno. El liquidador tiene que
      // saberlo — comparar un mediodía inventado contra la hora real de la serie con una ventana de ±12 h
      // deja fuera todo lo que se juega de madrugada o a última hora, que en un circuito global es media
      // agenda. Sin la marca, esos fallos parecen "la fuente no lo tiene" y son "la hora es mentira".
      source: 'vlr', provider_id: r.id, at: r.at + 'T12:00:00Z', day_only: true,
      a: r.t1, b: r.t2, maps_a: +r.s1, maps_b: +r.s2,
      // sin detalle por mapa todavía: se declara vacío en vez de inventar rondas
      maps: [], competition: r.event || null,
    }));
}

const SOURCES = {
  cs2: { fn: cs2Results, name: 'bo3.gg', available: true,
    note: 'la misma fuente del histórico propio: llega al detalle de ronda y prórroga por mapa, que es donde CS2 genera sus picks.' },
  dota2: { fn: dota2Results, name: 'OpenDota', available: true,
    note: 'pública y sin clave; da ganador, kills y duración por partida.' },
  // LoL LIQUIDA POR LEAGUEPEDIA, NO POR LOLESPORTS (19-ago). lolesports da el marcador de serie y nada más,
  // y LoL genera sus picks en las familias de KILLS: 18 picks generadas y CERO liquidadas, porque
  // `settleOne` no tenía el dato y devolvía null. Leaguepedia trae kills y duración POR PARTIDA y es la
  // misma fuente de la que salió nuestra base histórica, así que el marcador y el detalle vienen del mismo
  // sitio y no pueden contradecirse. Si Leaguepedia falla (su limitador es un cubo de fichas y a veces está
  // vacío) se cae a lolesports, que al menos permite liquidar el ganador de mapa y los totales de mapas.
  lol: { fn: lolResultsWithKills, name: 'leaguepedia', available: true,
    note: 'kills y duración por partida, de la misma fuente que la base histórica; con lolesports de respaldo para el marcador de serie.' },
  // VALORANT LIQUIDA DE SU PROPIA COSECHA (19-ago). Estaba marcado "sin fuente" y por eso 2 picks y cero
  // liquidadas. Pero la cosecha de vlr.gg que ya corre escribe `series.json` en el disco con el marcador de
  // mapas de cada serie: no hace falta pedir nada, basta leer lo que ya tenemos. Cubre las familias de
  // MAPAS (total y hándicap). Las de RONDAS necesitan el detalle por mapa —`maps.json`, que la misma
  // cosecha escribe— y se añadirán cuando ese archivo esté completo en el disco de producción; hasta
  // entonces esas picks quedan declaradas inliquidables, que es distinto de fingir que no hay fuente.
  valorant: { fn: valorantResults, name: 'vlr.gg (cosecha propia)', available: true,
    note: 'marcador de mapas de la cosecha propia; el detalle por ronda llega cuando maps.json esté completo.' },
};

async function results(game, { since = null, max = 300 } = {}) {
  const S = SOURCES[game];
  if (!S) return { game, available: false, rows: [] };
  if (!S.available) return { game, available: false, why: S.note, rows: [] };
  try {
    const rows = await S.fn({ since, max });
    return { game, available: true, source: S.name, note: S.note, rows, at: new Date().toISOString() };
  } catch (e) {
    return { game, available: false, error: String((e && e.message) || e), rows: [] };
  }
}

module.exports = { results, SOURCES };
