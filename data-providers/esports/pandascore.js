// data-providers/esports/pandascore.js — LA BASE PROPIA QUE LES FALTABA A TRES DE LOS CUATRO (19-ago).
//
// POR QUÉ EXISTE, y qué NO es. Esto no viene a liquidar picks: para eso ya hay fuente en los cuatro juegos
// (bo3.gg en CS2, Leaguepedia en LoL, OpenDota en Dota 2, cosecha propia en Valorant). Viene a tapar el
// agujero que este deporte lleva declarado desde el principio en su propio estado: `rating: 0` en los
// cuatro. CS2 salió de ahí con cosecha propia —48.678 mapas—, y LoL, Valorant y Dota 2 seguían esperando a
// OpenDota, a Riot y a Liquipedia. PandaScore los cubre a los tres, con la misma forma y desde 2016.
//
// QUÉ DA EL PLAN LIBRE, MEDIDO HOY (no prometido — comprobado endpoint por endpoint):
//   ✔ LISTAS: /{juego}/matches con paginación, filtros y rango de fechas. 100 filas por página, 1.000
//     peticiones por hora. Cada fila trae: liga, serie, torneo, los dos equipos con id y acrónimo, el
//     formato (bo1/bo3/bo5), el MARCADOR DE SERIE, y por cada mapa el GANADOR y la DURACIÓN en segundos.
//   ✔ CATÁLOGOS: /teams, /players, /leagues, /series, /tournaments.
//   ✘ DETALLE: /{juego}/games/{id} y /{juego}/matches/{id} devuelven 403. Es decir: NO hay rondas de CS2,
//     NO hay kills de LoL, NO hay mapa jugado. Eso sigue viniendo de donde venía.
//   ✘ CUOTAS: no hay endpoint de odds en este plan (404). No resuelve el hueco de mercado de Dota 2 —ese
//     es un problema de casas, no de datos— y conviene no confundirse: esto es la mitad de datos del
//     problema, no la de precio.
//
// LO QUE SÍ DESBLOQUEA, en orden de valor:
//   1. RATING PROPIO en LoL, Valorant y Dota 2. Quién ganó a quién, cuándo, en qué competición y con qué
//      marcador es exactamente lo que un rating necesita. 46.931 partidos de LoL, 38.329 de Dota 2 y
//      17.924 de Valorant, terminados y accesibles.
//   2. DURACIÓN POR MAPA en Dota 2, que es la familia sobre la que ese motor está construido y para la que
//      no tenía ni una observación propia.
//   3. Catálogo de equipos y jugadores con imagen para los cuatro, sin depender de raspar nada.
//
// PROFUNDIDAD REAL, medida: CS2 y LoL desde el 13-ene-2016, Dota 2 desde el 6-ene-2016, Valorant desde el
// 30-ene-2021 (el juego es de 2020).
//
// PURO salvo la red: sin disco, sin db. Quien persiste es el script de cosecha.
'use strict';

const BASE = 'https://api.pandascore.co';
const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com)';

// nuestros nombres de juego → los suyos. `cs-go` es el slug histórico y sigue siendo el de CS2.
const GAME_PATH = { cs2: 'csgo', lol: 'lol', valorant: 'valorant', dota2: 'dota2' };

const token = () => String(process.env.PANDASCORE_TOKEN || '').trim();
const enabled = () => !!token();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// EL LIMITADOR ES POR HORA (1.000), NO POR SEGUNDO. La cabecera `x-rate-limit-remaining` viene en cada
// respuesta y es la verdad; se devuelve al llamador para que la cosecha decida cuándo parar sola en vez de
// descubrirlo con un 429 a mitad de página.
async function get(path, { timeout = 25000, tries = 3 } = {}) {
  if (!enabled()) throw new Error('sin PANDASCORE_TOKEN');
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, {
        headers: { authorization: 'Bearer ' + token(), 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      });
      const rem = Number(r.headers.get('x-rate-limit-remaining'));
      const total = Number(r.headers.get('x-total'));
      if (r.status === 429) { last = new Error('429'); await sleep(20000); continue; }
      if (r.status === 403) throw new Error('403: ese recurso no está en el plan libre');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const body = await r.json();
      return { body, remaining: Number.isFinite(rem) ? rem : null, total: Number.isFinite(total) ? total : null };
    } catch (e) {
      last = e;
      if (/plan libre/.test(e.message)) throw e;   // no reintentar lo que nunca va a funcionar
      await sleep(1500 * (i + 1));
    }
  }
  throw last || new Error('agotado');
}

// ── NORMALIZACIÓN ───────────────────────────────────────────────────────────────────────────────────────
// A la MISMA forma que ya usan las otras fuentes del módulo de resultados, para que nada aguas abajo tenga
// que saber de dónde vino el dato: `a`/`b` orientados al primer oponente listado, mapas con ganador y
// duración, marcador de serie por lado.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

function normalizeMatch(m) {
  const ops = (m.opponents || []).map((o) => o.opponent).filter(Boolean);
  if (ops.length !== 2) return null;                       // 1v1 solamente: nada de free-for-all
  const [A, B] = ops;
  const score = (id) => { const r = (m.results || []).find((x) => x.team_id === id); return r ? Number(r.score) : null; };
  const maps = (m.games || [])
    .filter((g) => g.finished || g.complete)
    .sort((x, y) => (x.position || 0) - (y.position || 0))
    .map((g) => {
      const w = (g.winner && g.winner.id) || null;
      return {
        n: g.position || null,
        map: null,                                        // el plan libre no dice qué mapa se jugó
        rounds: null, ot: 0, kills_a: null, kills_b: null, kills_total: null,
        // duración en MINUTOS, que es la unidad en la que trabajan los motores (Dota y LoL la usan)
        minutes: Number.isFinite(g.length) ? +(g.length / 60).toFixed(2) : null,
        seconds: Number.isFinite(g.length) ? g.length : null,
        winner: w == null ? null : (w === A.id ? 'a' : w === B.id ? 'b' : null),
        forfeit: !!g.forfeit,
      };
    });
  return {
    source: 'pandascore', provider_id: String(m.id),
    at: m.begin_at || m.scheduled_at || m.original_scheduled_at || null,
    a: A.name, b: B.name,
    a_id: A.id, b_id: B.id, a_key: norm(A.acronym || A.name), b_key: norm(B.acronym || B.name),
    a_acronym: A.acronym || null, b_acronym: B.acronym || null,
    maps_a: score(A.id), maps_b: score(B.id),
    bo: m.number_of_games || null,
    league: (m.league || {}).name || null,
    serie: (m.serie || {}).full_name || (m.serie || {}).name || null,
    tournament: (m.tournament || {}).name || null,
    tier: (m.tournament || {}).tier || (m.serie || {}).tier || null,
    maps,
    // sin kills en este plan: se declara null en vez de inventar un cero, que liquidaría mal
    kills_total: null,
    forfeit: !!m.forfeit,
  };
}

// ── PARTIDOS TERMINADOS, POR PÁGINA ─────────────────────────────────────────────────────────────────────
// `from`/`to` en ISO. Orden ascendente por fecha para que una cosecha reanudable avance siempre hacia
// delante y el cursor tenga sentido.
// OJO CON EL ORDEN DESCENDENTE, que costó una lectura falsa: pedir `sort=-begin_at` sobre
// `filter[status]=finished` devuelve PRIMERO las filas con `begin_at` nulo (walkovers, partidos nunca
// programados), y la sonda informaba que el último partido de LoL era de marzo de 2025 cuando en realidad
// hay partidos de hoy. Para "lo más reciente" se usa `/matches/past`, que es el endpoint que ya viene
// ordenado y filtrado por la casa; el rango de fechas se reserva para el barrido histórico, que va
// ASCENDENTE y ahí el problema no aparece.
async function finishedMatches(game, { from = null, to = null, page = 1, perPage = 100, recent = false } = {}) {
  const g = GAME_PATH[game];
  if (!g) throw new Error('juego desconocido: ' + game);
  const qs = [`page=${page}`, `per_page=${Math.min(100, perPage)}`];
  let path;
  if (recent) {
    path = `/${g}/matches/past?` + qs.join('&');
  } else {
    qs.push('filter[status]=finished', 'sort=begin_at');
    qs.push(`range[begin_at]=${from || '2015-01-01T00:00:00Z'},${to || new Date().toISOString()}`);
    path = `/${g}/matches?` + qs.map(encodeURI).join('&');
  }
  const { body, remaining, total } = await get(path);
  const rows = Array.isArray(body) ? body.map(normalizeMatch).filter(Boolean) : [];
  return { rows, remaining, total, raw: Array.isArray(body) ? body.length : 0 };
}

// ── CATÁLOGOS ───────────────────────────────────────────────────────────────────────────────────────────
async function teams(game, { page = 1, perPage = 100 } = {}) {
  const g = GAME_PATH[game];
  const { body, remaining, total } = await get(`/${g}/teams?page=${page}&per_page=${Math.min(100, perPage)}`);
  const rows = (Array.isArray(body) ? body : []).map((t) => ({
    id: t.id, name: t.name, acronym: t.acronym || null, key: norm(t.acronym || t.name),
    country: t.location || null, image: t.image_url || null, slug: t.slug || null,
  }));
  return { rows, remaining, total };
}

async function players(game, { page = 1, perPage = 100 } = {}) {
  const g = GAME_PATH[game];
  const { body, remaining, total } = await get(`/${g}/players?page=${page}&per_page=${Math.min(100, perPage)}`);
  const rows = (Array.isArray(body) ? body : []).map((p) => ({
    id: p.id, nick: p.name || null, first: p.first_name || null, last: p.last_name || null,
    role: p.role || null, country: p.nationality || null, image: p.image_url || null,
    team_id: (p.current_team || {}).id || null, team: (p.current_team || {}).name || null,
    age: p.age || null, birthday: p.birthday || null, slug: p.slug || null,
  }));
  return { rows, remaining, total };
}

// ── SONDA ───────────────────────────────────────────────────────────────────────────────────────────────
// Para /api/internal/esports: qué se ve desde aquí, sin gastar más de cuatro peticiones.
async function probe() {
  const out = { enabled: enabled(), at: new Date().toISOString(), games: {}, errors: [] };
  if (!enabled()) { out.why = 'sin PANDASCORE_TOKEN en el entorno'; return out; }
  for (const game of Object.keys(GAME_PATH)) {
    try {
      const r = await finishedMatches(game, { perPage: 5, recent: true });
      const conDur = r.rows.reduce((n, x) => n + x.maps.filter((m) => m.minutes != null).length, 0);
      const mapas = r.rows.reduce((n, x) => n + x.maps.length, 0);
      // el "último" es el MÁXIMO con fecha, no la primera fila: `past` también cuela filas sin `begin_at`
      // (walkovers) y con ellas al frente CS2 y Dota 2 informaban `null` teniendo partidos de hoy
      const fechas = r.rows.map((x) => x.at).filter(Boolean).sort();
      out.games[game] = { terminados: r.total, ultimo: fechas.length ? fechas[fechas.length - 1] : null,
        mapas_en_muestra: mapas, con_duracion: conDur };
      out.remaining = r.remaining;
    } catch (e) { out.errors.push(`${game}: ${e.message}`); }
  }
  return out;
}

module.exports = { enabled, finishedMatches, teams, players, probe, normalizeMatch, GAME_PATH, get };
