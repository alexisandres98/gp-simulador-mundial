// esports-engine/store.js — LA CAPA QUE SIRVE INTELIGENCIA DE ESPORTS (16-ago).
//
// Junta proveedor + rating propio + el motor del juego que toque, y arma los objetos que consumen las rutas
// /api/esports/*. Vive fuera de server.js por la misma razón que baloncesto: server.js ya es enorme y este
// producto tiene superficie propia. Aquí razona; allá solo hay rutas.
//
// TRES DECISIONES QUE CONVIENE LEER ANTES DE TOCAR NADA:
//
//   1. **UN MOTOR POR JUEGO, DESPACHADO AQUÍ.** cs2/lol/valorant/dota2 son cuatro archivos que no se
//      conocen entre ellos. Este es el único sitio donde se elige cuál corre. Añadir un quinto juego es
//      añadir un archivo y una línea en `ENGINES`, no tocar el resto.
//   2. **CS2 TIENE BASE PROPIA; LOS OTROS TRES NO, Y NO SE DISIMULA.** CS2 razona sobre 48.678 mapas
//      cosechados por GP (`scripts/cs2-harvest.js`), con un modelo jerárquico validado fuera de muestra.
//      LoL, Valorant y Dota 2 no tienen fuente de resultados todavía: su ritmo y su duración son PERFILES DE
//      CIRCUITO escritos a mano. Los cuatro se enseñan; solo el que está medido apuesta.
//   3. **LAS PICKS SOLO SALEN DE FAMILIAS DERIVADAS.** El ganador de serie se calcula, se enseña y se
//      explica, pero NO genera pick. Baloncesto perdió 11,87 % de ROI ahí y combate −8,34 % de CLV. Esa
//      puerta está cerrada por código, no por configuración, y quitarla debería costar un commit con nombre
//      y apellidos.
//   4. **TRES CASAS, NO UNA** (16-ago). Pinnacle, Bovada y Cloudbet entran por `data-providers/esports/books`
//      y salen fundidas. Eso trae consenso, mejor precio y arbitraje — y sin consenso este producto no podía
//      dar ni una pick.
//
// LOS TRES VETOS QUE APAGAN UNA PICK, en orden de cuántas matan. Están escritos donde se aplican y los tres
// nacieron de una medición, no de una intuición:
//   · `estructura_no_medida`        — el perfil de fondo es un supuesto de circuito (LoL dio una "ventaja"
//                                     de 37,83 pp que era eso).
//   · `ventaja_explicada_por_calibracion` — el residuo de nuestro propio ajuste explica la ventaja entera
//                                     (mirage se queda 0,53 rondas corto y eso vale ~7 pp hacia el "menos").
//   · la TESIS repetida             — 29 "picks" que eran 8 opiniones copiadas en distintas líneas.
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./core');
// EL MOSTRADOR DE VARIAS CASAS. Desde el 16-ago este deporte ya no lee de una sola casa: Pinnacle (la
// referencia de cierre del sector), Bovada (la más ancha) y Cloudbet (la de más cobertura) entran por la
// misma puerta y salen fundidas, orientadas al mismo local y con su procedencia. Lo que cambia de verdad no
// es la cantidad de precios: es que **ahora hay consenso**, y sin consenso este producto no podía dar picks
// —`core.js` le cobraba a todas un recargo de 2,5 pp que era, en la práctica, un veto permanente.
const BK = require('../data-providers/esports/books');

const ENGINES = {
  cs2: require('./cs2'),
  lol: require('./lol'),
  valorant: require('./valorant'),
  dota2: require('./dota2'),
};
const GAME_ORDER = ['cs2', 'lol', 'valorant', 'dota2'];

// La puerta cerrada del punto 3. Si alguna vez se abre, que se vea en el diff.
const PICK_FAMILIES = new Set([
  'TOTAL_MAPAS', 'HANDICAP',
  'RONDAS', 'RONDAS_EQUIPO', 'RONDAS_HANDICAP', 'PRORROGA',
  'KILLS', 'KILLS_EQUIPO', 'KILLS_HANDICAP', 'KILLS_DNB',
]);
const PICK_DOCTRINE = 'el ganador de serie no genera picks por decisión de la casa: es el mercado donde GP ya midió pérdidas en dos deportes (baloncesto −11,87 % de ROI, combate −8,34 % de CLV). Se calcula y se explica, pero no se apuesta.';

// DÓNDE SE ESCRIBE, Y POR QUÉ NO EN EL REPO. Los cierres de mercado son lo ÚNICO que este deporte acumula
// hoy, y el directorio del repo en Render se recrea en cada deploy: guardarlos ahí significaría empezar de
// cero cada vez que se toca una línea de código, que es justo lo contrario de acumular histórico. Así que
// van al disco persistente, al lado de `db.json`, con el mismo criterio que ya usan los datos de clubes.
// Sin disco persistente (desarrollo local) cae al repo, que ahí sí es lo correcto.
const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'esports');
const REPO_DIR = path.join(__dirname, '..', 'data', 'esports');
const DIR = (() => {
  try { fs.mkdirSync(DISK_DIR, { recursive: true }); return DISK_DIR; } catch { return REPO_DIR; }
})();
const ensureDir = () => { try { fs.mkdirSync(DIR, { recursive: true }); } catch {} };
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => { try { ensureDir(); fs.writeFileSync(path.join(DIR, f), JSON.stringify(o)); return true; } catch { return false; } };

const G = global._esports = global._esports || { slate: {}, markets: {}, ratings: {} };
const SLATE_TTL = 10 * 60e3;
const MARKET_TTL = 3 * 60e3;

// ---- 1) AGENDA -------------------------------------------------------------------------------------------
// La resolución de nombres entre casas se le presta al mostrador, y para CS2 se le presta la BUENA: la base
// propia de 1.031 equipos sabe que "NIP" y "Ninjas In Pyjamas" son el mismo y —lo que importa más— sabe que
// "Spirit" y "Spirit Academy" NO lo son. Fundir dos partidos distintos mezcla dos mercados y fabrica un
// arbitraje que no existe, así que ante la duda se dejan separados.
function resolverFor(game) {
  if (game !== 'cs2') return null;
  try { const CD = require('./cs2-data'); return (name) => CD.resolveTeam(name); } catch { return null; }
}

async function slate(game, { days = 7, force = false } = {}) {
  if (!ENGINES[game]) return null;
  const c = G.slate[game];
  if (c && !force && Date.now() - c.at < SLATE_TTL) return c.data;
  const data = await BK.slate(game, { days, resolve: resolverFor(game) });
  G.slate[game] = { at: Date.now(), data };
  return data;
}

// Panorama de los cuatro juegos: es la pantalla de entrada del deporte y tiene que decir la verdad sobre lo
// que cada título tiene abierto hoy, incluida la asimetría (LoL tiene kills, Valorant y Dota ni precio).
async function overview({ days = 5 } = {}) {
  const games = [];
  let srcs = [];
  for (const g of GAME_ORDER) {
    const E = ENGINES[g];
    const s = await slate(g, { days }).catch(() => null);
    const rt = ratings(g);
    if (s && s.sources) srcs = s.sources;
    const evs = (s && s.events) || [];
    games.push({
      game: g, label: E.GAME.label, short: E.GAME.short,
      unit: E.GAME.unit, default_bo: E.GAME.default_bo,
      native: E.GAME.native, edge_families: E.GAME.edge_families, families: E.GAME.families,
      events: evs.length,
      // el dato que de verdad importa desde hoy: cuántos partidos tienen MÁS DE UNA casa. Con una sola no
      // hay consenso, y sin consenso el listón de la pick sube 2,5 pp.
      events_multibook: evs.filter((e) => (e.books || 0) > 1).length,
      books: (s && s.books) || 0,
      competitions: (s && s.competitions) ? s.competitions.length : 0,
      next: evs[0] || null,
      rating_matches: rt ? rt.n : 0,
      rating_teams: rt ? Object.keys(rt.elo).length : 0,
      closes_stored: closesCount(g),
      available: !!(s && s.available),
    });
  }
  return {
    games, order: GAME_ORDER,
    doctrine: PICK_DOCTRINE,
    // el cuadro de rating en cero tiene que venir con su motivo, o se lee como un fallo del sistema
    ratings_state: {
      // CS2 tiene rating propio desde el 16-ago (cosecha histórica de GP, 48.678 mapas) y LoL desde el
      // 18-ago (base Leaguepedia 2020→, Elo con lado y parche validado walk-forward) — se declara por
      // juego según qué base cargó de verdad, no por una lista escrita a mano.
      own_rating: ['cs2', 'lol'].filter((g2) => !!cdOf(g2)).join('+') || 'ninguno',
      why: BK.RESULTS_UNAVAILABLE.why,
      consequence: 'en CS2 la fuerza sale de la base propia (modelo jerárquico calibrado, validado fuera de muestra) y en LoL el Elo propio con lado y parche entra anclado a mercado con peso creciente por muestra. En Valorant y Dota 2 el ganador sigue siendo el consenso del mercado sin margen con 0 % de peso propio; la estructura derivada —rondas, duración y kills— es del modelo y no depende del rating.',
      next: BK.RESULTS_UNAVAILABLE.next,
    },
    // LAS CASAS, con su papel. No es adorno: es lo que explica por qué desde hoy pueden salir picks donde
    // ayer no salía ninguna.
    books: srcs,
    books_probed: BK.BOOKS_PROBED,
    source: srcs.filter((s) => s.available).map((s) => s.name).join(' + ') || 'sin casas disponibles',
    at: new Date().toISOString(),
  };
}

// ---- 2) RATING PROPIO (nace vacío y crece) --------------------------------------------------------------
// Elo simple sobre serie ganada, con K decreciente por muestra. No hay nada más sofisticado a propósito: con
// 40 partidos observados, un modelo elaborado es un modelo sobreajustado. Cuando la muestra dé para más, se
// sustituye por algo mejor y el anclaje al mercado lo absorbe sin sobresaltos.
const K0 = 32, K_FLOOR = 12;
function ratings(game) {
  const c = G.ratings[game];
  if (c && Date.now() - c.at < 15 * 60e3) return c.data;
  const st = rd(`results-${game}.json`);
  const rows = (st && st.results) || [];
  const elo = {}, seen = {}, pairs = {};
  const sorted = rows.slice().sort((a, b) => Date.parse(a.start_at || 0) - Date.parse(b.start_at || 0));
  for (const r of sorted) {
    if (!r.result || !r.result.winner) continue;
    const a = r.home.id, b = r.away.id;
    if (!a || !b) continue;
    elo[a] = elo[a] != null ? elo[a] : 1500;
    elo[b] = elo[b] != null ? elo[b] : 1500;
    seen[a] = (seen[a] || 0) + 1; seen[b] = (seen[b] || 0) + 1;
    const pk = [a, b].sort().join('|'); pairs[pk] = (pairs[pk] || 0) + 1;
    const exp = C.eloProbability(elo[a], elo[b]);
    const sc = r.result.winner === 'home' ? 1 : 0;
    const ka = Math.max(K_FLOOR, K0 - Math.min(20, seen[a] * 0.5));
    const kb = Math.max(K_FLOOR, K0 - Math.min(20, seen[b] * 0.5));
    elo[a] += ka * (sc - exp);
    elo[b] += kb * ((1 - sc) - (1 - exp));
  }
  const data = { game, elo, matches: seen, pairs, n: sorted.length, at: new Date().toISOString() };
  G.ratings[game] = { at: Date.now(), data };
  return data;
}

// ---- 2 bis) LA COSECHA QUE SÍ SE PUEDE HACER HOY -------------------------------------------------------
// Se intentó cosechar RESULTADOS y no existen: Cloudbet devuelve los eventos terminados con `settlement`
// vacío y sin mercados, y su catálogo de fixtures solo mira hacia delante (comprobado el 16-ago, la nota
// larga está en el proveedor). Así que el rating propio de esports NO va a arrancar solo, y decirlo es
// parte del producto: un cuadro de rating en cero sin explicación se lee como un fallo.
//
// Lo que sí se puede empezar a acumular HOY, y es lo que hace `snapshot`, es el CIERRE DE MERCADO: el
// último consenso observado de cada familia antes del inicio. Sin resultados no se puede liquidar, pero el
// día que entre una fuente de histórico el archivo de cierres ya estará ahí, y el CLV —que es la métrica
// con la que esta casa juzga de verdad— se podrá calcular hacia atrás en vez de empezar de cero otra vez.
// LA VENTANA SE ABRIÓ DE 3 h A 12 h, y no es un ajuste cosmético: es la causa medida de que el CLV saliera
// vacío. Las picks NACEN hasta 12 h antes del partido, pero el cierre solo se guardaba en las 3 h previas, así
// que una pick nacida temprano cuyo partido pasaba por la ventana entre dos pasadas se quedaba sin cierre
// para siempre. Medido en producción el 17-ago: de 5 picks liquidadas, 4 sin cierre guardado.
// Guardar de más no cuesta precisión —cada pasada SOBREESCRIBE el cierre del evento, así que el último
// guardado antes del inicio sigue siendo el cierre real— solo cuesta peticiones, y por eso lleva tope.
async function snapshot(game, { withinMin = 720, cap = 14 } = {}) {
  if (!ENGINES[game]) return { game, saved: 0 };
  const s = await slate(game, { days: 2, force: true }).catch(() => null);
  const evs = ((s && s.events) || []).filter((e) => {
    if (!e.start_at) return false;
    const mins = (Date.parse(e.start_at) - Date.now()) / 60000;
    return mins > -15 && mins < withinMin;    // la ventana previa al inicio, que es donde vive el cierre
  }).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)).slice(0, cap);
  const st = rd(`closes-${game}.json`) || { game, closes: {} };
  let saved = 0;
  for (const ev of evs) {
    const mk = await market(game, ev, { force: true }).catch(() => null);
    if (!mk || !mk.markets.length) continue;
    const prev = st.closes[ev.id] || null;
    const entry = {
      id: ev.id, provider_id: ev.provider_id, start_at: ev.start_at,
      home: ev.home, away: ev.away, competition: ev.competition,
      // CADA FILA GUARDA SU CASA, y esto es lo que convierte el archivo de cierres en algo que sirve. El CLV
      // no se mide contra "el mercado": se mide contra un cierre concreto de una casa concreta, y el baremo
      // del sector es el de Pinnacle. Sin la etiqueta de casa, los cierres de tres casas se mezclan en una
      // media que no es el cierre de nadie y el día que haya resultados no se puede calcular nada hacia atrás.
      rows: mk.markets.map((r) => ({ book: r.book, family: r.family, line: r.line, side: r.side, period: r.period, map: r.map, team: r.team, odds: r.odds })),
      books: (mk.by_book || []).filter((b) => b.rows).map((b) => b.book),
      at: mk.at,
    };
    // APERTURA + CINTA (17-ago, del blueprint de feedback CS2: "opening, current y closing point-in-time").
    // Antes cada pasada SOBREESCRIBÍA la anterior: quedaba el cierre y se perdía todo lo demás. Ahora la
    // primera lectura de un evento queda congelada como apertura, se cuenta cuántas pasadas lo vieron, y el
    // ganador de serie lleva una cinta ligera (mejor precio por lado entre casas, hasta 30 puntos) — lo
    // justo para medir apertura→cierre sin engordar el archivo con las ~200 filas de cada pasada.
    if (prev && prev.open_rows) {
      entry.open_rows = prev.open_rows; entry.open_at = prev.open_at;
      entry.moves = (prev.moves || 1) + 1; entry.tape = prev.tape || [];
    } else {
      entry.open_rows = entry.rows; entry.open_at = mk.at; entry.moves = 1; entry.tape = [];
    }
    const serie = mk.markets.filter((r) => r.family === 'SERIE' && r.odds);
    const bestOf = (side) => serie.filter((r) => r.side === side).reduce((mx, r) => Math.max(mx, r.odds), 0) || null;
    const th = bestOf('home'), ta = bestOf('away');
    if (th || ta) {
      entry.tape.push({ t: mk.at, h: th, a: ta });
      if (entry.tape.length > 30) entry.tape.splice(0, entry.tape.length - 30);
    }
    st.closes[ev.id] = entry;
    saved++;
  }
  st.at = new Date().toISOString();
  wr(`closes-${game}.json`, st);
  return { game, saved, total: Object.keys(st.closes).length };
}

// Se conserva el nombre `harvest` porque es el que usan los trabajos de fondo del resto de deportes, pero
// devuelve la verdad en vez de un cero silencioso.
async function harvest(game) {
  const snap = await snapshot(game).catch(() => ({ saved: 0 }));
  return { game, results_available: false, why: BK.RESULTS_UNAVAILABLE.why, next: BK.RESULTS_UNAVAILABLE.next, closes_saved: snap.saved };
}

// ---- 3) UN PARTIDO -----------------------------------------------------------------------------------------
// La caché se indexa por el id de GP y NO por el del proveedor, porque ahora un partido tiene un id por casa.
async function market(game, ev, { force = false } = {}) {
  if (!ev) return null;
  const key = game + ':' + (ev.id || ev.provider_id);
  const c = G.markets[key];
  if (c && !force && Date.now() - c.at < MARKET_TTL) return c.data;
  const data = await BK.markets(game, ev).catch(() => null);
  G.markets[key] = { at: Date.now(), data };
  return data;
}

function boOf(mk, fallback, ev = null) {
  // Cuando una casa DECLARA el formato —Pinnacle lo hace, con `bestOfX`— se le cree a ella antes que a la
  // deducción: deducir un BO5 de que exista una línea de ±2.5 falla en cuanto una casa publica un hándicap
  // alternativo generoso, y equivocarse de formato descoloca la simulación entera de la serie.
  if (ev && Number.isFinite(ev.bo) && ev.bo >= 1) return ev.bo;
  // si no, se deduce del mercado: si hay hándicap de ±2.5 mapas o marcador 3-x, es BO5.
  const rows = (mk && mk.markets) || [];
  const maxAbs = rows.filter((r) => r.family === 'HANDICAP' && r.line != null)
    .reduce((m, r) => Math.max(m, Math.abs(r.line)), 0);
  if (maxAbs >= 2.5) return 5;
  const tot = rows.filter((r) => r.family === 'TOTAL_MAPAS' && r.line != null)
    .reduce((m, r) => Math.max(m, r.line), 0);
  if (tot >= 3.5) return 5;
  if (maxAbs >= 1.5 || tot >= 2.5) return 3;
  return fallback;
}

// LoL (18-ago): cuando la base propia resuelve a los DOS equipos, su Elo (historial completo 2020→, lado
// azul y recencia por parche, constantes validadas walk-forward) sustituye al Elo de resultados liquidados
// (~30 partidas), y el tempo MEDIDO de la liga sustituye al perfil de circuito asumido. Si no resuelve,
// todo cae al camino anterior sin romperse — el ancla de mercado absorbe la diferencia.
function lolOwnInput(ev, competition) {
  try {
    const LD = require('./lol-data');
    const r = LD.ratingsFor(ev.home.name, ev.away.name);
    if (!r || r.elo_a == null || r.elo_b == null) return null;
    const t = LD.tempoFor(competition);
    return { ratings: { elo_a: r.elo_a, elo_b: r.elo_b }, sample: Math.min(r.matches_a, r.matches_b),
      observedTempo: t ? { games: t.n, kpm: t.kpm, minutes: t.mean_min } : null, own: true };
  } catch { return null; }
}

async function analyzeMatch(game, eventId, { days = 7 } = {}) {
  const E = ENGINES[game];
  if (!E) return null;
  const s = await slate(game, { days });
  const ev = ((s && s.events) || []).find((e) => e.id === eventId || e.provider_id === String(eventId)
    || (e.sources || []).some((x) => String(x.provider_id) === String(eventId)));
  if (!ev) return null;
  const mk = await market(game, ev);
  const bo = boOf(mk, E.GAME.default_bo, ev);
  const rt = ratings(game);
  const a = ev.home.id, b = ev.away.id;
  const own = game === 'lol' ? lolOwnInput(ev, ev.competition) : null;
  const sample = own ? own.sample : Math.min(rt.matches[a] || 0, rt.matches[b] || 0);
  const model = E.analyze({
    market: mk,
    ratings: own ? own.ratings : { elo_a: rt.elo[a], elo_b: rt.elo[b] },
    // los NOMBRES van al motor: CS2 los resuelve contra su propio histórico para sacar la fuerza por mapa
    teams: { a: ev.home.name, b: ev.away.name },
    bo, sample, competition: ev.competition,
    observedTempo: own ? own.observedTempo : null,
  });
  // el Draft Room del cruce (solo LoL): pools medidos, comfort, fragilidad y meta del parche
  if (game === 'lol' && model) {
    try { model.draft_room = require('./lol-data').draftIntel(ev.home.name, ev.away.name); } catch { }
  }
  const edges = evaluateAll({ game, model, mk, ev, bo, sample });
  // LO QUE SOLO SE VE CON VARIAS CASAS, y va aparte de las picks a propósito: el arbitraje NO pasa por el
  // modelo, así que no hereda su riesgo. Si el modelo estuviera entero equivocado, esta sección seguiría
  // siendo válida — es la única señal de la casa de la que se puede decir eso.
  const cross = BK.crossBook((mk && mk.markets) || []);
  const arbs = BK.arbitrages((mk && mk.markets) || []);
  return {
    event: ev, bo, sample,
    rating: own
      ? { a: own.ratings.elo_a, b: own.ratings.elo_b, matches_a: own.sample, matches_b: own.sample, source: 'base propia (Leaguepedia, walk-forward validado)' }
      : { a: C.r2(rt.elo[a] || null), b: C.r2(rt.elo[b] || null), matches_a: rt.matches[a] || 0, matches_b: rt.matches[b] || 0 },
    model,
    market_raw: mk ? { markets: mk.markets, at: mk.at } : null,
    books: mk ? { n: mk.books, by_book: mk.by_book, sources: ev.sources } : null,
    // los mercados donde MÁS DE UNA casa opina: consenso sin margen, mejor precio de cada lado y dispersión.
    // La dispersión es la señal de "aquí las casas no se ponen de acuerdo", que es donde vive tanto el valor
    // como la trampa, y por eso se publica en vez de resolverse en silencio.
    cross_book: cross.filter((m) => m.books > 1),
    arbitrages: arbs,
    edges,
    // el historial directo entre los dos, si la base lo tiene (solo CS2). Contexto, no señal: el modelo ya
    // pondera el pasado como corresponde; esto es para que quien mira entienda de dónde viene el cruce.
    h2h: (game === 'cs2' || game === 'lol') ? h2h(game, ev.home.name, ev.away.name) : null,
    provenance: C.provenance([
      { source: `Agenda de ${(ev.sources || []).map((x) => x.book).join(' + ') || 'las casas'}`, kind: 'proveedor', at: (s && s.at) || null },
      mk ? { source: `Mercados de ${(mk.by_book || []).filter((b) => b.rows).map((b) => b.book).join(' + ')}`, kind: 'proveedor', at: mk.at } : null,
      { source: 'Rating propio de GP', kind: 'derivado', at: rt.at },
    ]),
    doctrine: PICK_DOCTRINE,
    at: new Date().toISOString(),
  };
}

// ---- 4) DE MODELO A PRECIO: LAS FAMILIAS DERIVADAS ------------------------------------------------------
// Aquí es donde el motor se moja. Para cada línea que la casa cotiza en una familia derivada, se saca la
// probabilidad de GP del objeto de análisis y se compara. Lo que no se puede mapear se ignora en silencio:
// inventarle una probabilidad a una línea que el modelo no cubre es exactamente cómo se pierde dinero.
function probFor(game, model, row) {
  const f = row.family, line = row.line, side = String(row.side || '').toLowerCase();
  const isOver = /^(over|más|mas)$/.test(side), isUnder = /^(under|menos)$/.test(side);
  const isHome = side === 'home', isAway = side === 'away';
  const K = model.kills || null;
  // LA DISTRIBUCIÓN DEL MAPA QUE SE ESTÁ COTIZANDO, no la del primero. Una casa que cotiza el total de rondas
  // del mapa 1, del 2 y del 3 por separado está haciendo TRES preguntas distintas: mapas distintos del pool,
  // con duraciones distintas y con un reparto de fuerza distinto. Contestarlas con la misma distribución
  // devolvía la misma probabilidad tres veces y la presentaba como tres oportunidades. Si el motor no tiene
  // ese mapa —porque el veto no llega hasta ahí— la respuesta es NADA, no la del mapa 1 disfrazada de la del 3.
  const byMap = model.rounds_by_map || null;
  const R = row.map != null && byMap
    ? (byMap[row.map] || null)
    : (model.rounds || null);
  // el lado del hándicap y de los totales de equipo se lee del parámetro `team`, no del `side`:
  // en un total de equipo el side es over/under y quién es el equipo va aparte.
  const team = row.team === 'home' || row.team === 'away' ? row.team : null;

  if (f === 'TOTAL_MAPAS' && line != null && model.simulation) {
    // total de mapas jugados en la serie: sale de la distribución de marcadores, que ya la tiene la sim
    let over = 0;
    for (const s of model.simulation.scores) {
      const [x, y] = s.score.split('-').map(Number);
      if (x + y > line) over += s.p;
    }
    if (isOver) return { p: C.r4(over), how: 'distribución de marcadores de la simulación de serie' };
    if (isUnder) return { p: C.r4(1 - over), how: 'distribución de marcadores de la simulación de serie' };
    return null;
  }

  if (f === 'HANDICAP' && line != null && model.simulation) {
    // LA CONVENCIÓN DEL HÁNDICAP, comprobada contra precios reales el 16-ago porque la primera versión la
    // tuvo al revés: **la línea se aplica SIEMPRE al local**, y el lado dice a quién apuestas con esa
    // línea puesta. Con `handicap=1.5`, "local" es local +1.5 y "visitante" es visitante −1.5.
    // La comprobación que lo zanjó, en BASEMENT BOYS vs INOX: local +1.5 a 1,66 (implícita 0,600) contra
    // un modelo que da 0,594; y visitante a 2,13 (0,470) contra un modelo que da 0,465 SOLO si se lee como
    // visitante −1.5. Leyéndolo como visitante +1.5 salía una ventaja de 38,8 pp — que era el error, no
    // una oportunidad. Una ventaja de 38 puntos contra una casa nunca es una ventaja: es un fallo de lectura.
    if (!isHome && !isAway) return null;
    let win = 0, push = 0;
    for (const s of model.simulation.scores) {
      const [x, y] = s.score.split('-').map(Number);
      const v = (x - y) + line;                      // margen del local con su línea
      if (v === 0) push += s.p;
      else if (isHome ? v > 0 : v < 0) win += s.p;
    }
    return { p: C.r4(push > 0 ? win / (1 - push) : win), how: 'margen de mapas de la simulación de serie' };
  }

  if (f === 'RONDAS' && line != null && R && R.dist) {
    if (isOver) return { p: C.pOver(R.dist.total, line), how: 'simulación de rondas del mapa' };
    if (isUnder) return { p: C.pUnder(R.dist.total, line), how: 'simulación de rondas del mapa' };
    return null;
  }
  if (f === 'RONDAS_EQUIPO' && line != null && R && R.dist && team) {
    const d = R.dist[team];
    if (isOver) return { p: C.pOver(d, line), how: 'rondas del equipo en la simulación del mapa' };
    if (isUnder) return { p: C.pUnder(d, line), how: 'rondas del equipo en la simulación del mapa' };
    return null;
  }
  if (f === 'RONDAS_HANDICAP' && line != null && R && R.dist) {
    // misma convención que el hándicap de mapas: la línea es del local, el visitante juega su negación
    if (!isHome && !isAway) return null;
    const h = isHome ? C.pHandicap(R.dist.margin, line) : C.pHandicap(negHist(R.dist.margin), -line);
    return h ? { p: h.p, how: 'margen de rondas de la simulación del mapa' } : null;
  }
  if (f === 'PRORROGA' && R && R.overtime_p != null) {
    if (/^(yes|si|sí)$/.test(side)) return { p: R.overtime_p, how: 'tasa de prórroga de la simulación de rondas' };
    if (/^no$/.test(side)) return { p: C.r4(1 - R.overtime_p), how: 'tasa de prórroga de la simulación de rondas' };
    return null;
  }

  if (f === 'KILLS' && line != null && K && K.dist) {
    if (isOver) return { p: C.pOver(K.dist.total, line), how: 'ritmo del circuito × duración esperada (simulación de kills)' };
    if (isUnder) return { p: C.pUnder(K.dist.total, line), how: 'ritmo del circuito × duración esperada (simulación de kills)' };
    return null;
  }
  if (f === 'KILLS_EQUIPO' && line != null && K && K.dist && team) {
    const d = K.dist[team];
    if (isOver) return { p: C.pOver(d, line), how: 'reparto de kills por equipo en la simulación' };
    if (isUnder) return { p: C.pUnder(d, line), how: 'reparto de kills por equipo en la simulación' };
    return null;
  }
  if (f === 'KILLS_HANDICAP' && line != null && K && K.dist) {
    if (!isHome && !isAway) return null;
    const h = isHome ? C.pHandicap(K.dist.margin, line) : C.pHandicap(negHist(K.dist.margin), -line);
    return h ? { p: h.p, how: 'margen de kills de la simulación' } : null;
  }
  if (f === 'KILLS_DNB' && K && K.dist) {
    if (!isHome && !isAway) return null;
    // sin empate: el empate exacto devuelve la apuesta y `pHandicap` ya renormaliza por el push
    const h = C.pHandicap(isHome ? K.dist.margin : negHist(K.dist.margin), 0);
    return h ? { p: h.p, how: 'margen de kills sin empate (el empate devuelve la apuesta)' } : null;
  }

  return null;
}

// ---- 4 bis) EL ERROR DE CALIBRACIÓN SE PAGA, NO SE COBRA -------------------------------------------------
// LA MEDICIÓN QUE OBLIGÓ A ESCRIBIR ESTO. El ajuste del arrastre económico tiene UN grado de libertad y DOS
// objetivos: se ajusta a la tasa de prórroga observada de cada mapa y la media de rondas queda como residuo.
// En el conjunto del pool ese residuo es +0,063 rondas —o sea, insignificante— PERO NO ES UNIFORME:
//
//     dust2 −0,10 · mirage −0,53 · ancient +0,09 · nuke +0,34 · inferno +0,37 · anubis +0,11 · cache +0,16
//
// Mirage se queda medio round corto. Y medio round de sesgo en la media, con la densidad que tiene la
// distribución de totales alrededor de la línea principal, vale del orden de SIETE PUNTOS de probabilidad
// hacia el "menos". Cuando se comprobó, las tres únicas picks que el sistema producía eran exactamente eso:
// "menos de 20,5 / 21,5 / 22,5 rondas en mirage" con ventajas de 5,8 a 9,6 pp. No eran una opinión sobre la
// duración del mapa. Eran el residuo de nuestra propia calibración, cobrado como si fuera ventaja.
//
// La respuesta correcta no es re-tocar el arrastre hasta que la pick sobreviva —eso es ajustar la medición
// para que diga lo que uno quiere— sino **hacer que el error se pague a sí mismo**: se traduce el residuo a
// puntos de probabilidad EN ESA LÍNEA (residuo × densidad de la distribución en la línea), se suma a la
// incertidumbre, y se exige que la ventaja lo supere. Una ventaja que nuestro propio error de calibración
// puede producir entera no es una ventaja: es un NO PICK con motivo.
function calibrationPp(family, R, line, team) {
  if (!R || !R.calibration || !R.calibration.fitted || line == null) return 0;
  const cal = R.calibration;
  if (family === 'PRORROGA') {
    // aquí la prórroga ES el objetivo del ajuste, así que el residuo es el de la prórroga y es pequeño
    return C.r2(Math.abs(100 * ((cal.got_ot || 0) - (cal.target_ot || 0))));
  }
  const res = cal.rounds_residual;
  if (!Number.isFinite(res) || !res) return 0;
  const d = family === 'RONDAS_EQUIPO' && team ? (R.dist && R.dist[team]) : (R.dist && R.dist.total);
  if (!d || !d.h) return 0;
  // densidad discreta en la línea: la masa de los dos enteros que la rodean, promediada. Es exactamente la
  // derivada de P(más de la línea) cuando toda la distribución se desplaza, que es lo que hace un sesgo en
  // la media.
  const lo = Math.floor(line), hi = Math.ceil(line);
  const dens = ((d.h[lo] || 0) + (d.h[hi] || 0)) / 2;
  // el total de un equipo se lleva aproximadamente la mitad del sesgo del total del mapa
  const share = family === 'RONDAS_EQUIPO' ? 0.5 : 1;
  return C.r2(Math.abs(res) * share * dens * 100);
}

// El margen está siempre medido desde el local. Para valorar el lado visitante se le da la vuelta al
// histograma en vez de restar de uno: restar de uno cuenta el empate exacto para el lado equivocado, que es
// justo el error que en una línea entera de hándicap mueve la probabilidad en la dirección cara.
function negHist(d) {
  if (!d || !d.h) return null;
  const h = {};
  for (const [k, p] of Object.entries(d.h)) h[-k] = p;
  return { h, n: d.n };
}

// LA INCERTIDUMBRE NO ES LA MISMA PARA TODAS LAS FAMILIAS, y usar una sola cifra estaba matando el producto
// por el lado equivocado. El término que domina la incertidumbre general es "¿conozco a estos dos equipos?"
// —14 pp cuando la muestra propia es cero, que es siempre hoy—, y eso es lo correcto para el GANADOR y para
// cualquier cosa que dependa de quién es mejor. Pero un TOTAL DE KILLS o un TOTAL DE RONDAS no depende de
// eso: depende de si el perfil de ritmo de la liga y la forma de la distribución de rondas son correctos.
// Cobrarle a un total la ignorancia sobre el emparejamiento hacía que ninguna línea de volumen pudiera
// pasar nunca el listón, no porque el modelo dudara sino porque se le estaba pasando la factura de otro.
//
// Reparto: las familias de MARGEN (quién gana, por cuánto) pagan la incertidumbre del par; las de VOLUMEN
// (cuántas rondas, cuántos kills, si hay prórroga) pagan la del perfil, que baja cuando el perfil está
// medido en vez de supuesto.
const VOLUME_FAMILIES = new Set(['RONDAS', 'RONDAS_EQUIPO', 'KILLS', 'KILLS_EQUIPO', 'PRORROGA']);

// ---- LA REGLA QUE MÁS PICKS MATA, Y POR ESO MISMO LA MÁS IMPORTANTE -------------------------------------
// UN SUPUESTO NO GENERA PICKS. Solo la estructura MEDIDA genera picks.
//
// LA MEDICIÓN QUE OBLIGÓ A ESCRIBIRLO. Al entrar las casas nuevas, LoL empezó a producir picks de total de
// kills, y una de ellas venía con una ventaja de **37,83 pp**. Ese número no es una oportunidad: es un
// diagnóstico. GP no tiene histórico de LoL —no hay fuente de resultados— así que su ritmo de kills es un
// PERFIL DE CIRCUITO escrito a mano (`measured: false` en todas las ligas, siempre). El modelo esperaba unos
// 28 kills en el mapa y la casa cotizaba 38: no estaban en desacuerdo sobre este partido, estaban en
// desacuerdo sobre cuántos kills tiene un mapa de LoL, y de los dos el que ha visto los partidos es la casa.
//
// Esto es exactamente el fallo que ya costó dinero en baloncesto —picks que prometían 56,5 % de acierto y
// daban 43,6 %— y la lección era que un modelo sin validar no puede opinar contra un cierre. Así que la
// puerta se cierra por código, familia por familia, y solo la abre una estructura medida:
//
//   CS2        rondas, prórroga y fuerza por mapa MEDIDAS sobre 48.678 mapas del histórico propio  → SÍ
//   LoL        ritmo de kills y duración: perfil de circuito, sin muestra propia                    → NO
//   Valorant   sin perfil de rondas medido                                                          → NO
//   Dota 2     ritmo y duración: perfil de circuito                                                 → NO
//
// No es un apagado temporal por prudencia: se reabre solo, sin tocar código, en cuanto cada motor pueda
// declarar `measured: true` porque tiene datos detrás (OpenDota para Dota 2, la API de Riot para LoL).
function basisFor(family, model, R) {
  if (family === 'KILLS' || family === 'KILLS_EQUIPO' || family === 'KILLS_HANDICAP' || family === 'KILLS_DNB') {
    return { measured: !!(model.tempo && model.tempo.measured), what: 'el ritmo de kills de la competición' };
  }
  if (family === 'RONDAS' || family === 'RONDAS_EQUIPO' || family === 'RONDAS_HANDICAP' || family === 'PRORROGA') {
    return { measured: !!(R && R.measured), what: 'el perfil de rondas de este mapa' };
  }
  if (family === 'TOTAL_MAPAS' || family === 'HANDICAP') {
    return { measured: !!(model.dataset && model.dataset.available), what: 'la fuerza por mapa del par' };
  }
  return { measured: false, what: 'la estructura de esta familia' };
}
function uncertaintyFor(family, model, baseUnc, books) {
  if (!VOLUME_FAMILIES.has(family)) return baseUnc;
  const measured = !!((model.tempo && model.tempo.measured) || (model.rounds && model.rounds.measured));
  const profile = measured ? 3.0 : 6.5;                 // perfil de circuito vs perfil medido
  const market = books >= 3 ? 1.5 : books >= 1 ? 3.5 : 6;
  return C.r2(Math.sqrt(profile * profile + market * market));
}

function evaluateAll({ game, model, mk, ev, bo, sample }) {
  const rows = (mk && mk.markets) || [];
  const books = (model.market && model.market.books) || 0;
  const unc = model.uncertainty ? model.uncertainty.epistemic_pp : 8;
  // CUÁNTAS CASAS COTIZAN **ESTA LÍNEA**, no cuántas cotizan el partido. La diferencia importa: en un mismo
  // partido el ganador de la serie lo cotizan tres casas y el total de rondas por equipo lo cotiza una sola,
  // y cobrarle a la segunda la profundidad de la primera es exactamente el error que el recargo por casa
  // única existía para evitar. Cada línea paga su propia profundidad.
  const depth = new Map();
  for (const m of BK.crossBook(rows)) {
    for (const s of m.sides) depth.set([m.family, m.map == null ? '' : m.map, m.team || '', m.line == null ? '' : m.line, s.side].join('|'), s.books);
  }
  const depthOf = (r) => depth.get([r.family, r.map == null ? '' : r.map, r.team || '', r.line == null ? '' : r.line, r.side].join('|')) || 1;
  const out = [], skipped = [];
  // NO SE BUSCA VALOR EN EL PRECIO CONTRA EL QUE TE HAS CALIBRADO. Si la probabilidad de serie salió del
  // hándicap de mapas, comparar el modelo contra ese mismo hándicap es compararlo consigo mismo: cualquier
  // diferencia que aparezca es error de ajuste, no ventaja. Pasó de verdad —una "ventaja" de 41 pp en un
  // hándicap que era justo el ancla— y por eso la familia que ancló queda fuera de la valoración y se dice.
  const anchorFam = (model.market_anchor && model.market_anchor.family) || null;
  const byKey = new Map();
  for (const r of rows) {
    if (anchorFam && r.family === anchorFam) {
      if (!skipped.some((s) => s.family === anchorFam)) {
        skipped.push({ family: anchorFam, why: `esta familia es la que ancló la probabilidad de GP (${model.market_anchor.from}): medirse contra ella sería medirse contra uno mismo, así que no se valora.` });
      }
      continue;
    }
    if (!PICK_FAMILIES.has(r.family)) {
      if (r.family === 'SERIE') skipped.push({ family: 'SERIE', why: PICK_DOCTRINE });
      continue;
    }
    const got = probFor(game, model, r);
    if (!got || got.p == null) continue;
    // MISMA LÍNEA Y MISMO LADO EN VARIAS CASAS: se cobra contra el MEJOR precio, que es el que de verdad se
    // puede tomar. Es también la razón por la que traer casas mejora el producto aunque el modelo no cambie:
    // la misma probabilidad contra un precio mejor es más ventaja, sin haber acertado nada nuevo.
    const key = [r.family, r.line, r.side, r.period, r.map, r.team].join('|');
    const prev = byKey.get(key);
    if (prev && prev.odds >= r.odds) continue;
    const nBooks = depthOf(r);
    // el residuo de calibración de ESTE mapa en ESTA línea, en puntos de probabilidad
    const byMapR = model.rounds_by_map || null;
    const Rrow = r.map != null && byMapR ? (byMapR[r.map] || null) : (model.rounds || null);
    const calPp = calibrationPp(r.family, Rrow, r.line, r.team);
    const uncF = C.r2(Math.sqrt(uncertaintyFor(r.family, model, unc, nBooks) ** 2 + calPp ** 2));
    const ev2 = C.evaluateEdge({
      pGp: got.p, odds: r.odds, uncertaintyPp: uncF,
      minEdgePp: 3, family: r.family, marketBooks: nBooks,
      freshMin: mk && mk.at ? (Date.now() - Date.parse(mk.at)) / 60000 : null,
    });
    // EL PRIMER VETO: sin estructura medida detrás, no hay pick. Se calcula igual y se enseña igual —la
    // comparación con el mercado es información— pero no se apuesta un supuesto.
    const basis = basisFor(r.family, model, Rrow);
    if (!basis.measured) {
      ev2.pick = false;
      ev2.no_pick_reasons = (ev2.no_pick_reasons || []).concat([{ code: 'estructura_no_medida',
        text: `${basis.what} es un perfil de circuito, no una medición propia: GP todavía no tiene histórico de este juego. Una diferencia con el mercado aquí no dice que el mercado se equivoque, dice que nuestro supuesto y el suyo no coinciden — y quien ha visto los partidos es la casa.` }]);
    }
    // Y por encima de la incertidumbre, un veto propio: si el residuo de calibración por sí solo explica la
    // ventaja, la ventaja es nuestra y no del mercado. No se apuesta contra el propio error.
    if (calPp > 0 && ev2.edge_pp != null && ev2.edge_pp <= calPp) {
      ev2.pick = false;
      ev2.no_pick_reasons = (ev2.no_pick_reasons || []).concat([{ code: 'ventaja_explicada_por_calibracion',
        text: `la ventaja (${ev2.edge_pp} pp) no supera el error de calibración del modelo de rondas en ${Rrow && Rrow.map ? Rrow.map : 'este mapa'} (±${calPp} pp, residuo de ${Rrow && Rrow.calibration ? Rrow.calibration.rounds_residual : '?'} rondas): la diferencia con el mercado la puede producir entera nuestro propio ajuste` }]);
    }
    const row = { ...ev2, line: r.line, side: r.side, period: r.period, map: r.map, team: r.team,
      calibration_pp: calPp,
      uncertainty_pp: uncF, uncertainty_kind: VOLUME_FAMILIES.has(r.family) ? 'perfil de la liga' : 'conocimiento del emparejamiento',
      label: r.family_label, how: got.how, max_stake: r.max_stake,
      // de QUÉ casa sale el precio que se está recomendando, y contra cuántas se midió. Una pick sin casa es
      // una pick que nadie puede tomar.
      book: r.book || null, books_quoting: nBooks,
      basis_measured: basis.measured, basis: basis.what };
    byKey.set(key, row);
  }
  for (const v of byKey.values()) out.push(v);
  out.sort((a, b) => (b.pick - a.pick) || (b.edge_pp - a.edge_pp));

  // ── UNA OPINIÓN, UNA PICK ────────────────────────────────────────────────────────────────────────────
  // LO QUE SE VIO AL TRAER LAS CASAS NUEVAS: un partido pasó a producir 29 "picks". No eran 29 opiniones.
  // "menos de 20,5", "menos de 21,5" y "menos de 22,5 rondas en mirage" son LA MISMA apuesta a tres precios,
  // y "el visitante saca más rondas" aparecía a la vez como hándicap de rondas, como total del local por
  // debajo y como total del visitante por encima. Publicarlas como oportunidades separadas no es un problema
  // de presentación: es cómo una cartera acaba con todo el riesgo en una sola idea creyendo que está
  // diversificada, que es exactamente lo que hunde un histórico.
  //
  // Se agrupan por TESIS —la afirmación de fondo— y sale UNA sola pick por tesis: la de mejor ventaja. Las
  // demás no se tiran, se cuelgan de ella como líneas alternativas del mismo argumento, que es información
  // útil (dice a qué precios sigue vivo) sin fingir que son apuestas independientes.
  const picksRaw = out.filter((x) => x.pick);
  const byThesis = new Map();
  for (const p of picksRaw) {
    const t = thesisOf(p);
    if (!byThesis.has(t)) byThesis.set(t, []);
    byThesis.get(t).push(p);
  }
  const picks = [];
  for (const [t, list] of byThesis) {
    list.sort((a, b) => b.edge_pp - a.edge_pp);
    const head = list[0];
    head.thesis = t;
    head.same_thesis = list.slice(1).map((x) => ({ line: x.line, side: x.side, team: x.team, odds: x.odds,
      book: x.book, edge_pp: x.edge_pp, family: x.family }));
    head.correlated_n = list.length - 1;
    picks.push(head);
    for (const x of list.slice(1)) { x.pick = false; x.thesis = t; x.folded_into = head.thesis; }
  }
  picks.sort((a, b) => b.edge_pp - a.edge_pp);

  // EL RECUENTO DE POR QUÉ NO. Un hueco sin explicación se lee como un sistema roto —y es literalmente la
  // pregunta que hizo Alexis al ver la pantalla vacía: "¿por qué no me aparecen las picks?". El motor sabe la
  // respuesta línea por línea; lo que faltaba era sumarla y sacarla a la superficie.
  const reasons = {};
  for (const r of out) {
    if (r.pick || r.folded_into) continue;
    for (const x of r.no_pick_reasons || []) reasons[x.code] = (reasons[x.code] || 0) + 1;
  }

  return {
    rows: out,
    // las picks salen ya con la forma de la card de la casa: el frontend no adapta nada, igual que en
    // baloncesto. Se conserva `edges.rows` sin decorar para las vistas que miran el detalle crudo.
    picks: ev ? picks.map((r) => asPickCard(r, { game, ev, bo, model })) : picks,
    reasons,
    valued: out.length,
    // las que se plegaron NO son "no picks" por falta de valor: son la misma pick a otro precio, y mezclarlas
    // con los rechazos haría ilegible el motivo de cada hueco
    folded: picksRaw.length - picks.length,
    no_picks: out.filter((x) => !x.pick && !x.folded_into),
    families_allowed: [...PICK_FAMILIES],
    excluded: skipped,
    note: out.length ? null : 'la casa no tiene todavía mercados derivados abiertos para este partido; suelen abrir en las horas previas al inicio.',
  };
}

// ---- 4 ter) LA PICK, CON LA FORMA DE LA CASA -------------------------------------------------------------
// Esports enseñaba sus picks en una tabla propia. Eso estaba mal por el mismo motivo por el que el calendario
// estaba mal: **la casa ya tiene una card de pick** —la misma en fútbol, en combate y en baloncesto— y un
// cuarto deporte con su propia forma no es personalidad, es deuda. El usuario aprende a leer una pick UNA vez.
//
// Se sigue el patrón que ya usa baloncesto: el SERVIDOR emite la pick con los campos que `pickCard()` espera
// y el frontend no adapta nada. Lo único que cambia es la gramática del deporte —qué dice el ticket— porque
// "Menos de 21.5 rondas · mapa 1" no se redacta como "Menos de 182.5 puntos".
//
// Las familias de esports se traducen a las que la card ya entiende, y no de cualquier manera: se eligen las
// que devuelven `selection_name` tal cual, para que el ticket lo redacte esta capa (que sabe de rondas y de
// mapas) y no la card (que no tiene por qué saberlo).
const CARD_FAMILY = {
  RONDAS: 'ROUNDS', RONDAS_EQUIPO: 'ROUNDS',
  RONDAS_HANDICAP: 'SPREAD', HANDICAP: 'SPREAD', KILLS_HANDICAP: 'SPREAD',
  TOTAL_MAPAS: 'TOTAL', KILLS: 'TOTAL', KILLS_EQUIPO: 'TOTAL',
  PRORROGA: 'METHOD', KILLS_DNB: 'SPREAD',
};
const SIDED_FAM = new Set(['HANDICAP', 'RONDAS_HANDICAP', 'KILLS_HANDICAP']);

// El chip de familia va en una esquina de la card, al lado del nombre de la competición, y ahí solo caben
// DOS PALABRAS. Con el nombre largo ("Total de rondas del mapa") la cabecera se partía en tres líneas y
// empujaba la hora fuera de sitio: la card compartida asume etiquetas cortas porque las de fútbol lo son
// ("Ganador", "Goles"). El nombre completo no se pierde — vive en el ticket y en el porqué.
const CARD_LABEL = {
  RONDAS: 'Rondas', RONDAS_EQUIPO: 'Rondas equipo', RONDAS_HANDICAP: 'Hánd. rondas',
  HANDICAP: 'Hánd. mapas', TOTAL_MAPAS: 'Total mapas',
  KILLS: 'Kills', KILLS_EQUIPO: 'Kills equipo', KILLS_HANDICAP: 'Hánd. kills',
  KILLS_DNB: 'Kills sin empate', PRORROGA: 'Prórroga',
};

// El ticket, redactado como se lee un ticket. La regla del signo importa: la línea que guarda el motor es
// SIEMPRE la del local, así que el lado visitante se escribe con la línea negada — enseñarla tal cual diría
// justo lo contrario de lo que se está apostando.
function selectionName(r, ev) {
  const A = (ev && ev.home && ev.home.name) || 'Local';
  const B = (ev && ev.away && ev.away.name) || 'Visitante';
  const teamOf = (k) => (k === 'home' ? A : k === 'away' ? B : null);
  const mapTxt = r.map ? ` · mapa ${r.map}` : '';
  const num = (x) => String(x).replace('.', ',');
  const side = String(r.side || '').toLowerCase();

  if (SIDED_FAM.has(r.family)) {
    const who = teamOf(side) || side;
    const line = side === 'away' && r.line != null ? -r.line : r.line;
    const unit = r.family === 'HANDICAP' ? 'mapas' : r.family === 'KILLS_HANDICAP' ? 'kills' : 'rondas';
    const sign = line > 0 ? '+' : '−';
    return `${who} ${sign}${num(Math.abs(line))} ${unit}${mapTxt}`;
  }
  if (r.family === 'PRORROGA') return `${/^(yes|si|sí)$/.test(side) ? 'Sí' : 'No'} hay prórroga${mapTxt}`;

  const mas = side === 'over' ? 'Más de' : 'Menos de';
  if (r.family === 'TOTAL_MAPAS') return `${mas} ${num(r.line)} mapas`;
  if (r.family === 'KILLS') return `${mas} ${num(r.line)} kills${mapTxt}`;
  if (r.family === 'RONDAS') return `${mas} ${num(r.line)} rondas${mapTxt}`;
  if (r.family === 'RONDAS_EQUIPO' || r.family === 'KILLS_EQUIPO') {
    const who = teamOf(r.team) || '';
    const unit = r.family === 'KILLS_EQUIPO' ? 'kills' : 'rondas';
    return `${who}: ${mas.toLowerCase()} ${num(r.line)} ${unit}${mapTxt}`;
  }
  return `${r.family_label || r.family} · ${side}${r.line != null ? ' ' + num(r.line) : ''}${mapTxt}`;
}

// El "por qué". Se redacta con lo que el motor ya sabe y NO con adjetivos: de dónde sale la probabilidad,
// cuánta ventaja hay contra qué precio, cuántas casas lo cotizan, qué error de calibración se le descontó y
// qué otras líneas dicen lo mismo. Es la misma exigencia que en los otros tres deportes: la card puede
// abrirse y tiene que aguantar la lectura.
function pickWhy(r, ev, model) {
  const parts = [];
  parts.push(`La probabilidad de GP (${(100 * r.p_gp).toFixed(1)} %) sale de ${r.how}.`);
  parts.push(`El mercado paga ${r.odds.toFixed(2)}, que implica ${(100 * r.p_market).toFixed(1)} %: ${r.edge_pp > 0 ? '+' : ''}${r.edge_pp} puntos de ventaja.`);
  parts.push(r.books_quoting > 1
    ? `Lo cotizan ${r.books_quoting} casas y el precio recomendado es el mejor de ellas (${r.book}).`
    : `Lo cotiza una sola casa (${r.book}), así que el listón de ventaja sube 2,5 pp en vez de dar la pick por buena.`);
  if (r.calibration_pp > 0) {
    parts.push(`Al modelo de rondas de este mapa se le descuenta su propio error de calibración (±${r.calibration_pp} pp): la ventaja tiene que superarlo, y lo supera.`);
  }
  parts.push(`Margen de error del modelo en esta familia: ±${r.uncertainty_pp} pp (${r.uncertainty_kind}).`);
  if (r.correlated_n) {
    parts.push(`Hay ${r.correlated_n} línea${r.correlated_n > 1 ? 's' : ''} más con la misma tesis; se publica solo esta porque apostarlas todas sería la misma apuesta repetida, no una cartera.`);
  }
  const veto = model && model.veto_impact;
  if (veto && r.map) parts.push(`Veto: ${String(veto.verdict).toLowerCase()} (${veto.shift_pp > 0 ? '+' : ''}${veto.shift_pp} pp sobre el reparto de mapas).`);
  return parts.join(' ');
}

// Kelly/4 sobre la probabilidad de GP, con el mismo techo que baloncesto. No se usa la cruda del modelo sin
// más: en esports no hay todavía NI UN resultado liquidado, así que el tamaño se mantiene deliberadamente
// pequeño hasta que exista un histórico contra el que juzgarse.
const STAKE_CAP = 2.0;
function stakeOf(p, odds) {
  const b = odds - 1;
  if (!(b > 0)) return null;
  const k = (b * p - (1 - p)) / b;
  if (!(k > 0)) return null;
  const raw = 100 * k / 4;
  return { pct: +Math.min(STAKE_CAP, raw).toFixed(2), raw: +raw.toFixed(2), capped: raw > STAKE_CAP };
}

function asPickCard(r, { game, ev, bo, model }) {
  const T = (model && model.teams) || {};
  const st = stakeOf(r.p_gp, r.odds);
  return {
    ...r,
    // ── los campos que consume pickCard(), la MISMA card de fútbol, combate y baloncesto ──
    family: CARD_FAMILY[r.family] || 'TOTAL',
    // LA FAMILIA CRUDA SE CONSERVA, y no es un detalle: `family` se sobreescribe con la de la card
    // (ROUNDS/SPREAD/TOTAL) y la que sabe LIQUIDAR es esta. Sin ella, una pick guardada no se puede
    // liquidar después porque nadie sabe si "SPREAD" era hándicap de mapas o de rondas.
    family_raw: r.family,
    fam_label: CARD_LABEL[r.family] || r.label || r.family,   // corto: el chip no da para más
    selection_name: selectionName(r, ev),
    home: ev.home.name, away: ev.away.name,
    home_team_id: null, away_team_id: null,      // sin banderas: en esports el escudo va por es_logos
    es_logos: { h: (T.a && T.a.logo) || null, a: (T.b && T.b.logo) || null },
    es_hash: `esmatch/${game}/${ev.id}`,
    competition_name: ev.competition || null,
    kickoff: ev.start_at || null,
    // `confidence` es NUMÉRICA porque la card la usa para el color del indicador y la calculadora de stake la
    // usa como probabilidad. Es la de GP para ESA selección, que es justo lo que dimensiona la apuesta.
    confidence: r.p_gp,
    sample_confidence: (r.confidence && r.confidence.level) || null,
    pick_id: `es_${game}_${ev.id}_${r.family}_${r.side}_${r.line != null ? r.line : 'x'}_${r.map || 0}`,
    why_es: pickWhy(r, ev, model) + (st && st.capped
      ? ` Kelly/4 pediría ${String(st.raw).replace('.', ',')} % del banco y la casa lo recorta al tope de ${String(STAKE_CAP).replace('.', ',')} %: en esports todavía no hay NI UNA pick liquidada —ninguna casa publica resultados— así que el tamaño se mantiene pequeño hasta que exista un histórico contra el que juzgarse.`
      : ''),
    stake_pct: st ? st.pct : null,
    stake_raw_pct: st ? st.raw : null,
    stake_capped: !!(st && st.capped),
    signals: {
      win_prob: r.p_gp,
      edge_pp: r.edge_pp,
      data_confidence: (r.confidence && r.confidence.level) === 'alta' ? 'high' : (r.confidence && r.confidence.level) === 'media' ? 'med' : 'low',
      pick_quality: r.edge_pp >= 6 ? 'strong' : r.edge_pp >= 4 ? 'moderate' : 'marginal',
      // MONITOR, y no es prudencia decorativa: esports no tiene NI UN resultado liquidado —ninguna de las
      // tres casas publica marcadores— así que no existe un histórico contra el que juzgar estas picks. El
      // chip lo dice en la propia card en vez de dejar que se lean como un feed con historial detrás.
      regime: 'monitor',
    },
  };
}

// LA TESIS DE UNA APUESTA: la afirmación de fondo, despojada de la línea y de la familia en la que se
// expresa. Dos apuestas con la misma tesis están casi perfectamente correlacionadas aunque el mercado las
// venda por separado, y esto es lo que las junta.
//   · volumen  → "este mapa da muchas/pocas rondas (o kills)"
//   · margen   → "este equipo saca más rondas (o kills) que el otro"
//   · prórroga → "este mapa se alarga"
// El caso que hay que ver para entenderlo: "local menos de 12,5 rondas" y "visitante más de 12,5 rondas" son
// la MISMA tesis —que el visitante domina el mapa— vendidas como dos mercados distintos.
function thesisOf(r) {
  const m = r.map == null ? 'serie' : `mapa ${r.map}`;
  const f = r.family;
  if (f === 'RONDAS' || f === 'KILLS') return `${m} · volumen · ${r.side}`;
  if (f === 'TOTAL_MAPAS') return `serie · duración · ${r.side}`;
  if (f === 'RONDAS_EQUIPO' || f === 'KILLS_EQUIPO') {
    const dir = (r.team === 'home') === (String(r.side) === 'over') ? 'local' : 'visitante';
    return `${m} · margen · ${dir}`;
  }
  if (f === 'RONDAS_HANDICAP' || f === 'KILLS_HANDICAP' || f === 'KILLS_DNB') {
    return `${m} · margen · ${r.side === 'home' ? 'local' : 'visitante'}`;
  }
  if (f === 'HANDICAP') return `serie · margen · ${r.side === 'home' ? 'local' : 'visitante'}`;
  if (f === 'PRORROGA') return `${m} · prórroga · ${r.side}`;
  return `${m} · ${f} · ${r.side}`;
}

// ---- 5) LA PIZARRA DE UN JUEGO (todas las oportunidades del día) ---------------------------------------
// Se limita a `maxEvents` a propósito y SE DICE cuántos quedaron fuera: un recorte silencioso se lee como
// "esto es todo lo que hay", que es mentira.
async function board(game, { days = 3, maxEvents = 14 } = {}) {
  const E = ENGINES[game];
  if (!E) return null;
  const s = await slate(game, { days });
  const evs = ((s && s.events) || []);
  const use = evs.slice(0, maxEvents);

  // Los mercados se piden en TANDAS, no de uno en uno. En serie, catorce eventos a ~600 ms cada uno son
  // nueve segundos de pantalla en blanco la primera vez que se abre un juego. En tandas de cuatro baja a
  // dos segundos y medio y el proveedor no se molesta (el límite que sí importa es el 429 por ráfaga, y
  // cuatro en paralelo está muy por debajo). No se sube más por la lección de memoria del 15-ago: lo que
  // tumbó el proceso fueron tres trabajos concurrentes, no uno lento.
  // Con tres casas cada partido cuesta hasta tres peticiones en vez de una, así que la tanda baja de cuatro
  // a tres partidos: son las mismas ~nueve peticiones simultáneas de antes, repartidas entre proveedores
  // distintos (que además no comparten límite de ráfaga entre ellos).
  const BATCH = 3;
  const mkts = new Map();
  for (let i = 0; i < use.length; i += BATCH) {
    const chunk = use.slice(i, i + BATCH);
    const got = await Promise.all(chunk.map((ev) => market(game, ev).catch(() => null)));
    chunk.forEach((ev, k) => mkts.set(ev.id, got[k]));
  }

  const items = [];
  for (const ev of use) {
    const mk = mkts.get(ev.id) || null;
    const bo = boOf(mk, E.GAME.default_bo, ev);
    const rt = ratings(game);
    const ownB = game === 'lol' ? lolOwnInput(ev, ev.competition) : null;
    const sample = ownB ? ownB.sample : Math.min(rt.matches[ev.home.id] || 0, rt.matches[ev.away.id] || 0);
    let model = null;
    try {
      model = E.analyze({ market: mk, ratings: ownB ? ownB.ratings : { elo_a: rt.elo[ev.home.id], elo_b: rt.elo[ev.away.id] },
        teams: { a: ev.home.name, b: ev.away.name }, bo, sample, competition: ev.competition,
        observedTempo: ownB ? ownB.observedTempo : null });
    } catch { model = null; }
    const edges = model ? evaluateAll({ game, model, mk, ev, bo, sample }) : null;
    const arbs = mk ? BK.arbitrages(mk.markets || []) : [];
    items.push({
      event: ev, bo,
      p_home: model && model.probability ? model.probability.p : null,
      anchor: model && model.probability ? model.probability.source : null,
      books: mk ? mk.books : (ev.books || 0),
      // las casas que de verdad DEVOLVIERON precio, no las que listaban el partido: una casa que lo tiene en
      // la agenda pero ya cerró el mercado (porque el partido empezó) no está cotizando nada.
      book_list: mk ? (mk.by_book || []).filter((b) => b.rows).map((b) => b.book) : (ev.sources || []).map((x) => x.book),
      markets_n: (mk && mk.markets) ? mk.markets.length : 0,
      picks: edges ? edges.picks.length : 0,
      best: edges && edges.picks.length ? edges.picks[0] : null,
      // TODAS las picks del partido, ya con forma de card. Antes solo viajaba la mejor y la pizarra de
      // oportunidades no podía enseñar el resto: un partido con tres tesis distintas se veía como uno con una.
      picks_list: edges ? edges.picks : [],
      // el motivo de cada NO, contado. Es lo que permite que la pantalla de oportunidades explique un hueco
      // en vez de dejarlo mudo.
      reasons: edges ? edges.reasons : null,
      valued: edges ? edges.valued : 0,
      arbitrages: arbs.length,
      arbs: arbs.slice(0, 4),
      best_arb: arbs[0] || null,
      highlight: highlightOf(game, model),
      // LOS ESCUDOS VIAJAN CON LA PIZARRA. Estaban solo en la ficha del partido, así que el calendario era una
      // lista de nombres — y un calendario de deporte sin caras no se parece a un calendario, se parece a un
      // registro. El motor ya resolvió los equipos contra la base propia aquí mismo; no cuesta nada más.
      crests: model && model.teams
        ? { a: (model.teams.a && model.teams.a.logo) || null, b: (model.teams.b && model.teams.b.logo) || null }
        : null,
    });
  }
  return {
    game, label: E.GAME.label, short: E.GAME.short,
    native: E.GAME.native, edge_families: E.GAME.edge_families,
    items,
    shown: use.length, total: evs.length,
    truncated: evs.length > use.length ? evs.length - use.length : 0,
    competitions: (s && s.competitions) || [],
    // qué casas contestaron HOY. Un partido con una casa y uno con tres no valen lo mismo y la pizarra
    // tiene que poder decirlo sin que el usuario abra la ficha.
    sources: (s && s.sources) || [],
    books: (s && s.books) || 0,
    arbitrages: items.reduce((a, x) => a + x.arbitrages, 0),
    doctrine: PICK_DOCTRINE,
    at: new Date().toISOString(),
  };
}

// La frase que distingue a cada juego en la pizarra. No es adorno: es lo que le dice al usuario POR QUÉ
// estas cuatro pestañas son cuatro productos y no cuatro copias.
function highlightOf(game, model) {
  if (!model) return null;
  if (game === 'cs2') {
    return model.veto_impact
      ? `Veto ${model.veto_impact.verdict.toLowerCase()}: ${model.veto_impact.shift_pp > 0 ? '+' : ''}${model.veto_impact.shift_pp} pp`
      : (model.rounds ? `${model.rounds.mean_rounds} rondas esperadas` : null);
  }
  if (game === 'lol') {
    return model.kills ? `${model.kills.mean_kills} kills · ${model.duration.mean_min} min` : null;
  }
  if (game === 'valorant') {
    return model.rounds ? `${model.rounds.mean_rounds} rondas · ${Math.round(100 * model.rounds.overtime_p)}% prórroga` : null;
  }
  if (game === 'dota2') {
    return model.duration ? `${model.duration.mean_min} min (cola hasta ${model.duration.p99})` : null;
  }
  return null;
}

// ---- 6) EL MOTOR COMO HERRAMIENTA, NO COMO CARTEL -------------------------------------------------------
// La pestaña "El motor" enseñaba una lista de lo que el motor sabe hacer. Eso es un folleto: se lee una vez y
// no se vuelve. Lo que la convierte en herramienta es poder PREGUNTARLE — elegir dos equipos cualesquiera del
// histórico y ver qué dice el modelo de ese cruce, con su veto, su reparto por mapa y su distribución de
// rondas, SIN que ninguna casa tenga que cotizarlo primero.
//
// Y eso solo se puede ofrecer desde que CS2 tiene base propia: hasta hoy la probabilidad nacía del mercado,
// así que un cruce sin mercado no tenía respuesta. Ahora sí la tiene, y decir de dónde sale —modelo puro, sin
// ancla— es parte de la respuesta.
function teamSearch(game, q, { limit = 24 } = {}) {
  if (game !== 'cs2') return { game, available: false, why: 'solo CS2 tiene base propia de equipos; los otros tres juegos todavía no tienen fuente de resultados.', teams: [] };
  const CD = require('./cs2-data');
  const data = CD.load();
  const needle = CD.norm(q || '');
  const rows = Object.values(data.teams)
    .filter((t) => !needle || CD.norm(t.name).indexOf(needle) >= 0)
    // se ordena por HISTORIAL, no alfabéticamente: quien busca "spirit" quiere Team Spirit, no su filial
    .sort((a, b) => (b.n || 0) - (a.n || 0))
    .slice(0, limit)
    .map((t) => {
      const g = data.teamGlobal[t.id];
      return { id: t.id, name: t.name, logo: t.logo || null, rank: t.rank || null,
        maps: t.n || 0, elo: g ? g.elo : null, wr: g ? g.wr : null };
    });
  return { game, available: true, teams: rows, total: Object.keys(data.teams).length, at: data.at };
}

// Un cruce simulado sin mercado. `bo` lo elige quien pregunta porque aquí no hay casa que lo declare.
function simulate(game, aName, bName, { bo = 3 } = {}) {
  const E = ENGINES[game];
  if (!E) return null;
  if (game !== 'cs2') return { game, available: false, why: 'el simulador necesita base propia y hoy solo la tiene CS2.' };
  const CD = require('./cs2-data');
  const data = CD.load();
  const idA = CD.resolveTeam(aName, { data }), idB = CD.resolveTeam(bName, { data });
  if (!idA || !idB) {
    return { game, available: false, resolved: { a: idA, b: idB },
      why: `no reconozco a ${!idA ? aName : bName} en la base propia. Se devuelve nada antes que el historial de otro equipo: darle a un equipo el pasado de otro es peor que no tener pasado, porque el modelo se pone seguro sobre una mentira.` };
  }
  if (idA === idB) return { game, available: false, why: 'los dos nombres resuelven al mismo equipo.' };
  // se le pasa un mercado VACÍO a propósito: es la probabilidad del modelo sola, sin ancla ninguna
  const model = E.analyze({ market: { markets: [] }, ratings: {}, bo, sample: 0,
    teams: { a: data.teams[idA].name, b: data.teams[idB].name } });
  return {
    game, available: true, bo,
    teams: { a: CD.teamCard(idA, { data }), b: CD.teamCard(idB, { data }) },
    model,
    h2h: h2h(game, idA, idB),
    standalone: true,
    note: 'esta probabilidad NO está anclada a ninguna casa: es la del modelo sola, sobre la base propia de GP. En una partida real el mercado manda sobre el ganador y el modelo aporta la estructura — aquí se enseña el modelo desnudo a propósito, que es de lo que va esta pantalla.',
    at: new Date().toISOString(),
  };
}

// ---- 7) EL BUCLE CERRADO: NACER, LIQUIDARSE Y MEDIRSE ---------------------------------------------------
// LO QUE ESTO ARREGLA, DICHO SIN ADORNOS. Esports generaba picks y no podía liquidar NINGUNA, porque las
// tres casas sirven catálogo de apuesta y no marcadores. Un deporte que no puede medirse no es un producto:
// es una demo que nunca aprende. Con `data-providers/esports/results` entran las tres fuentes que sí
// publican resultados (bo3 para CS2, OpenDota para Dota 2, lolesports para LoL) y el bucle se cierra.
//
// DOS PIEZAS, Y EL ORDEN IMPORTA:
//   · `recordPicks` — la pick NACE y se guarda con su precio de entrada y el estado del mercado en ese
//     momento. Sin esto no hay nada que liquidar después: hoy las picks se calculaban al vuelo en cada
//     petición y se evaporaban. Es también lo que impide el autoengaño de "esa la habría acertado".
//   · `settlePicks` — cuando el partido termina, se busca el resultado, se liquida y se calcula el CLV
//     contra el CIERRE guardado. El CLV es la vara de esta casa y es la que habla primero: con 17 apuestas
//     el ROI es ruido y el CLV ya dice algo.
const PICKS_F = (g) => `picks-${g}.json`;

// La pick se guarda una vez y NO se toca: si el motor cambia de opinión mañana, esa es otra pick. Reescribir
// la de ayer con el criterio de hoy es exactamente cómo un histórico deja de servir para medir nada.
// MIGRACIÓN DE UN SOLO USO, y queda escrita en vez de hacerse a mano en producción. Las primeras picks
// nacieron con el id de evento ROTO —cambiaba según qué casas contestaran esa pasada— así que el mismo
// partido aparecía con dos ids, la misma pick se guardaba dos veces y su cierre no se encontraba nunca (CLV
// nulo). Aquí se recalcula el id canónico de cada pick guardada y se colapsan los duplicados quedándose con
// la que nació ANTES: la primera es la que de verdad se habría tomado, y quedarse con la segunda sería
// elegir el precio a toro pasado.
const PICKS_SCHEMA = 2;
function migratePicks(game, st) {
  if (!st || st.schema === PICKS_SCHEMA) return { migrated: 0, merged: 0 };
  const BK = require('../data-providers/esports/books');
  const resolve = resolverFor(game);
  const byKey = new Map();
  let merged = 0;
  for (const p of Object.values(st.picks || {})) {
    const pair = [BK.teamKey(p.home, resolve), BK.teamKey(p.away, resolve)].sort().join('~');
    const eid = BK.canonicalId(game, `${game}:${pair}`, p.start_at);
    const key = [eid, p.family, p.line, p.side, p.map, p.team].join('|');
    const prev = byKey.get(key);
    if (prev) {
      merged++;
      // se conserva la que nació antes, pero si la duplicada trae resultado y la original no, se rescata:
      // el veredicto es un hecho del partido, no del momento en que se guardó
      if (!prev.result_code && p.result_code) Object.assign(prev, { status: p.status, result_code: p.result_code, units: p.units, final: p.final, settled_at: p.settled_at, result_source: p.result_source });
      if (Date.parse(p.born_at || 0) < Date.parse(prev.born_at || 0)) { prev.born_at = p.born_at; prev.odds = p.odds; prev.book = p.book; }
      continue;
    }
    p.event_id = eid;
    p.pick_id = `es_${game}_${eid}_${p.family}_${p.side}_${p.line != null ? p.line : 'x'}_${p.map || 0}`;
    byKey.set(key, p);
  }
  st.picks = Object.fromEntries([...byKey.values()].map((p) => [p.pick_id, p]));
  st.schema = PICKS_SCHEMA;
  return { migrated: byKey.size, merged };
}

// Los CIERRES estaban indexados por el mismo id roto, así que se migran con el mismo criterio. Si no, los
// cierres ya guardados quedan huérfanos y el CLV de esas picks se pierde para siempre — y el cierre es
// justamente lo único que este deporte llevaba acumulando desde antes de poder liquidar nada.
function migrateCloses(game) {
  const st = rd(`closes-${game}.json`);
  if (!st || st.schema === PICKS_SCHEMA) return 0;
  const BK = require('../data-providers/esports/books');
  const resolve = resolverFor(game);
  const out = {};
  let moved = 0;
  for (const c of Object.values(st.closes || {})) {
    const hn = (c.home && c.home.name) || c.home, an = (c.away && c.away.name) || c.away;
    const pair = [BK.teamKey(hn, resolve), BK.teamKey(an, resolve)].sort().join('~');
    const eid = BK.canonicalId(game, `${game}:${pair}`, c.start_at);
    if (eid !== c.id) moved++;
    c.id = eid;
    // si ya había uno bajo ese id canónico se conserva el MÁS RECIENTE: el cierre es el último precio visto
    if (!out[eid] || String(c.at || '') > String(out[eid].at || '')) out[eid] = c;
  }
  st.closes = out; st.schema = PICKS_SCHEMA;
  wr(`closes-${game}.json`, st);
  return moved;
}

async function recordPicks(game, { withinMin = 720, cap = 10 } = {}) {
  if (!ENGINES[game]) return { game, saved: 0 };
  const movedCloses = migrateCloses(game);
  const s = await slate(game, { days: 2 }).catch(() => null);
  // TOPE DE PARTIDOS POR PASADA, y no por prudencia abstracta: lo que tumbó la plataforma el 15-ago fueron
  // trabajos de fondo concurrentes, y este corre encadenado con el de cierres cada 20 minutos. Diez partidos
  // por pasada cubren de sobra la ventana de 12 h y dejan el pico donde está.
  const evs = ((s && s.events) || []).filter((e) => {
    if (!e.start_at) return false;
    const mins = (Date.parse(e.start_at) - Date.now()) / 60000;
    return mins > -30 && mins < withinMin;
  }).slice(0, cap);
  const st = rd(PICKS_F(game)) || { game, picks: {}, schema: PICKS_SCHEMA };
  const mig = migratePicks(game, st);
  let saved = 0;
  for (const ev of evs) {
    let out = null;
    try { out = await analyzeMatch(game, ev.id, { days: 2 }); } catch { out = null; }
    if (!out || !out.edges || !out.edges.picks.length) continue;
    for (const p of out.edges.picks) {
      if (st.picks[p.pick_id]) continue;                    // ya nació: no se reescribe
      st.picks[p.pick_id] = {
        pick_id: p.pick_id, game, event_id: ev.id,
        start_at: ev.start_at, competition: ev.competition,
        home: ev.home.name, away: ev.away.name, bo: out.bo,
        // la familia CRUDA de esports (no la traducida para la card): es la que sabe liquidar
        family: p.family_raw || p.family,
        family_label: p.label || null,
        line: p.line, side: p.side, map: p.map, team: p.team,
        selection_name: p.selection_name,
        odds: p.odds, book: p.book, books_quoting: p.books_quoting,
        p_gp: p.p_gp, p_market: p.p_market, edge_pp: p.edge_pp,
        uncertainty_pp: p.uncertainty_pp, calibration_pp: p.calibration_pp,
        thesis: p.thesis, stake_pct: p.stake_pct,
        born_at: new Date().toISOString(),
        status: 'ACTIVE', result_code: null, units: null, clv_pct: null, close_odds: null,
      };
      saved++;
    }
  }
  st.at = new Date().toISOString();
  wr(PICKS_F(game), st);
  return { game, saved, total: Object.keys(st.picks).length, migrated: mig.merged || 0, closes_migrated: movedCloses };
}

// ---- de un resultado a un veredicto ---------------------------------------------------------------------
// Cada familia se liquida contra el dato que le corresponde y NUNCA contra uno parecido. Lo que la fuente no
// trae devuelve `null` y la pick se queda sin liquidar con su motivo, que es infinitamente mejor que
// inventarle un resultado: una pick mal liquidada envenena el histórico para siempre y no deja rastro.
function settleOne(pk, res) {
  const maps = res.maps || [];
  const m = pk.map ? maps.find((x) => x.n === pk.map) : null;
  const need = (v) => (v == null || Number.isNaN(v) ? null : v);
  const cmp = (val, line, over) => {
    if (val == null || line == null) return null;
    if (val === line) return 'PUSH';                        // línea entera clavada: devuelve la apuesta
    return (over ? val > line : val < line) ? 'WIN' : 'LOSS';
  };
  const isOver = pk.side === 'over', isUnder = pk.side === 'under';

  if (pk.family === 'TOTAL_MAPAS') {
    const played = res.maps_a + res.maps_b;
    return cmp(played, pk.line, isOver);
  }
  if (pk.family === 'HANDICAP') {
    const marg = res.maps_a - res.maps_b;                    // margen del LOCAL
    const v = marg + pk.line;
    if (v === 0) return 'PUSH';
    return (pk.side === 'home' ? v > 0 : v < 0) ? 'WIN' : 'LOSS';
  }
  if (!pk.map) return null;                                  // el resto es por mapa
  if (!m) return null;                                       // ese mapa no se jugó (serie corta): sin liquidar

  if (pk.family === 'RONDAS') return cmp(need(m.rounds), pk.line, isOver);
  if (pk.family === 'PRORROGA') {
    if (m.ot == null) return null;
    const hubo = !!m.ot;
    return (/^(yes|si|sí)$/.test(String(pk.side)) ? hubo : !hubo) ? 'WIN' : 'LOSS';
  }
  if (pk.family === 'RONDAS_EQUIPO') {
    const v = pk.team === 'home' ? need(m.score_a) : pk.team === 'away' ? need(m.score_b) : null;
    return cmp(v, pk.line, isOver);
  }
  if (pk.family === 'RONDAS_HANDICAP') {
    if (m.score_a == null || m.score_b == null) return null;
    const v = (m.score_a - m.score_b) + pk.line;
    if (v === 0) return 'PUSH';
    return (pk.side === 'home' ? v > 0 : v < 0) ? 'WIN' : 'LOSS';
  }
  // KILLS: bo3 no publica kills por mapa. Se deja explícito y sin liquidar en vez de aproximarlo.
  return null;
}

// El CLV se calcula igual que en baloncesto —`cuota_tomada / cuota_cierre − 1`— para que las cifras de los
// cuatro deportes se puedan poner en la misma tabla sin nota al pie.
function closeOddsFor(pk, closes) {
  const c = closes && closes.closes && closes.closes[pk.event_id];
  if (!c || !c.rows) return null;
  const same = c.rows.filter((r) => r.family === pk.family && r.side === pk.side
    && (r.line == null ? null : +r.line) === (pk.line == null ? null : +pk.line)
    && (r.map || null) === (pk.map || null) && (r.team || null) === (pk.team || null));
  if (!same.length) return null;
  // el cierre de referencia es el de la MISMA casa si está; si no, el mejor precio del cierre
  const mine = same.filter((r) => r.book === pk.book);
  const pool = mine.length ? mine : same;
  return pool.reduce((mx, r) => Math.max(mx, r.odds || 0), 0) || null;
}

const RES = require('../data-providers/esports/results');

async function settlePicks(game, { sinceDays = 4 } = {}) {
  const st = rd(PICKS_F(game));
  if (!st || !st.picks) return { game, settled: 0, pending: 0, no_source: false };
  const closes0 = rd(`closes-${game}.json`);
  // REPESCA DE CLV. Una pick ya liquidada sin CLV no volvía a mirarse nunca, así que si su cierre aparecía
  // después —o se recuperaba al migrar los ids— el dato se perdía para siempre. El cierre es un hecho del
  // pasado: si está, se usa, aunque la pick ya esté cerrada.
  let backfilled = 0;
  for (const p of Object.values(st.picks)) {
    if (p.status !== 'SETTLED' || p.clv_pct != null) continue;
    const co = closeOddsFor(p, closes0);
    if (co) { p.close_odds = co; p.clv_pct = +(((p.odds / co) - 1) * 100).toFixed(2); backfilled++; }
  }
  if (backfilled) wr(PICKS_F(game), st);

  const pend = Object.values(st.picks).filter((p) => p.status === 'ACTIVE'
    && p.start_at && Date.parse(p.start_at) < Date.now() - 20 * 60e3);
  if (!pend.length) return { game, settled: 0, pending: 0, clv_backfilled: backfilled };

  const since = new Date(Date.now() - sinceDays * 864e5).toISOString().slice(0, 10);
  const rs = await RES.results(game, { since }).catch(() => null);
  if (!rs || !rs.available) return { game, settled: 0, pending: pend.length, no_source: true, why: (rs && rs.why) || 'sin fuente de resultados' };

  const closes = rd(`closes-${game}.json`);
  const resolve = resolverFor(game);
  const key = (n) => {
    if (resolve) { const id = resolve(n); if (id) return 'gp:' + id; }
    return String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  };
  // El resultado se empareja por PAR DE EQUIPOS y ventana de tiempo, y se ORIENTA al local de la pick: si la
  // fuente trae los lados al revés, todo lo que dependa del lado —hándicaps, totales por equipo— se liquida
  // exactamente al revés. Es el mismo cuidado que se puso al fundir las casas, y por el mismo motivo.
  const idx = rs.rows.map((r) => ({ r, ka: key(r.a), kb: key(r.b), t: Date.parse(r.at || 0) }));

  let settled = 0, unmatched = 0, unsettleable = 0;
  for (const pk of pend) {
    const kh = key(pk.home), ka = key(pk.away), t = Date.parse(pk.start_at || 0);
    const hit = idx.find((x) => Math.abs(x.t - t) < 12 * 3600e3
      && ((x.ka === kh && x.kb === ka) || (x.ka === ka && x.kb === kh)));
    if (!hit) { unmatched++; continue; }
    const flip = hit.ka !== kh;
    const r = flip
      ? { ...hit.r, a: hit.r.b, b: hit.r.a, maps_a: hit.r.maps_b, maps_b: hit.r.maps_a,
          maps: (hit.r.maps || []).map((m) => ({ ...m, score_a: m.score_b, score_b: m.score_a })) }
      : hit.r;

    const verdict = settleOne(pk, r);
    if (!verdict) { unsettleable++; pk.unsettleable_why = 'la fuente no publica el dato de esta familia (o ese mapa no se jugó)'; continue; }
    pk.status = 'SETTLED';
    pk.result_code = verdict;
    pk.units = verdict === 'WIN' ? +(pk.odds - 1).toFixed(3) : verdict === 'LOSS' ? -1 : 0;
    pk.final = { maps: `${r.maps_a}-${r.maps_b}`, detail: (r.maps || []).map((m) => `${m.map || 'g' + m.n} ${m.score_a}-${m.score_b}${m.ot ? ' OT' : ''}`).join(' · ') };
    pk.settled_at = new Date().toISOString();
    pk.result_source = r.source;
    const co = closeOddsFor(pk, closes);
    if (co) { pk.close_odds = co; pk.clv_pct = +(((pk.odds / co) - 1) * 100).toFixed(2); }
    settled++;
  }
  st.at = new Date().toISOString();
  wr(PICKS_F(game), st);
  return { game, settled, unmatched, unsettleable, pending: pend.length, clv_backfilled: backfilled, source: rs.source };
}

// El cuadro de rendimiento del deporte. Se publica el CLV SEPARADO del ROI y por delante, porque con
// muestras pequeñas el ROI es ruido y el CLV ya tiene señal — es la lección que dejó baloncesto.
function track(game, { limit = 60 } = {}) {
  const st = rd(PICKS_F(game));
  const all = st && st.picks ? Object.values(st.picks) : [];
  const closes = rd(`closes-${game}.json`);
  const settled = all.filter((p) => p.status === 'SETTLED');
  const w = settled.filter((p) => p.result_code === 'WIN').length;
  const l = settled.filter((p) => p.result_code === 'LOSS').length;
  const push = settled.filter((p) => p.result_code === 'PUSH').length;
  const units = settled.reduce((s, p) => s + (p.units || 0), 0);
  const staked = settled.filter((p) => p.result_code !== 'PUSH').length;
  const clvs = settled.filter((p) => p.clv_pct != null).map((p) => p.clv_pct);
  const byFam = {};
  for (const p of settled) {
    const f = p.family || '?';
    byFam[f] = byFam[f] || { n: 0, w: 0, units: 0, clv: [] };
    byFam[f].n++; if (p.result_code === 'WIN') byFam[f].w++;
    byFam[f].units += p.units || 0;
    if (p.clv_pct != null) byFam[f].clv.push(p.clv_pct);
  }
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
  return {
    game,
    total: all.length, active: all.filter((p) => p.status === 'ACTIVE').length,
    settled: settled.length, w, l, push,
    units: +units.toFixed(2),
    roi_pct: staked ? +(100 * units / staked).toFixed(2) : null,
    hit_pct: (w + l) ? +(100 * w / (w + l)).toFixed(1) : null,
    clv_avg_pct: avg(clvs), clv_n: clvs.length,
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, v]) => [k,
      { n: v.n, hit_pct: v.n ? +(100 * v.w / v.n).toFixed(1) : null, units: +v.units.toFixed(2), clv_avg_pct: avg(v.clv) }])),
    // la advertencia va DENTRO del dato, no en una nota aparte: con esta muestra el ROI no significa nada
    reading: settled.length < 30
      ? `muestra de ${settled.length}: el ROI todavía es ruido. El CLV es el número que ya dice algo, y hacen falta centenares de picks liquidadas por familia para hablar de ventaja.`
      : 'muestra en construcción; el CLV sigue siendo la vara principal.',
    // POR QUÉ FALTA EL CLV, contado. Es la métrica que esta casa dice que manda, así que un hueco ahí no
    // puede quedarse mudo: o no se guardó el cierre de ese partido, o se guardó y no tenía esa línea.
    clv_diag: (() => {
      const sinClv = settled.filter((p) => p.clv_pct == null);
      const sinCierre = sinClv.filter((p) => !(closes && closes.closes && closes.closes[p.event_id])).length;
      return {
        con_clv: clvs.length, sin_clv: sinClv.length,
        sin_cierre_guardado: sinCierre,
        cierre_sin_esa_linea: sinClv.length - sinCierre,
        nota: sinClv.length
          ? 'el cierre se guarda en la ventana de 3 h previa al inicio; una pick nacida antes y con el partido ya empezado cuando corrió el trabajo se queda sin cierre y por tanto sin CLV.'
          : null,
      };
    })(),
    // las liquidadas, de la más reciente a la más vieja, para que Rendimiento pueda enseñarlas
    recent: settled.slice().sort((a, b) => String(b.settled_at || '').localeCompare(String(a.settled_at || ''))).slice(0, limit),
    open: all.filter((p) => p.status === 'ACTIVE')
      .sort((a, b) => String(a.start_at || '').localeCompare(String(b.start_at || ''))).slice(0, 20),
    source: (RES.SOURCES[game] || {}).name || null,
    at: (st && st.at) || null,
  };
}

function closesCount(game) {
  const st = rd(`closes-${game}.json`);
  return st && st.closes ? Object.keys(st.closes).length : 0;
}

// ---- 7b) EVIDENCIA DE MERCADO (17-ago, P0 del blueprint de feedback CS2) --------------------------------
// "El cuello de botella estratégico no es añadir otra métrica visual, sino completar la evidencia de
// mercado que permita demostrar qué familias realmente superan al precio." Esta función junta, en un solo
// objeto auditable, lo que la casa ya acumula: cobertura del archivo de cierres (¿cuántos eventos tienen
// apertura Y cierre?), cuánto se mueve el mercado entre ambas, y el CLV liquidado cortado por familia Y
// por casa. Separa a propósito predictividad (CLV) de rentabilidad (unidades): la doctrina del documento.
function marketEvidence(game) {
  const st = rd(`closes-${game}.json`);
  const closes = st && st.closes ? Object.values(st.closes) : [];
  const withOpen = closes.filter((c) => c.open_rows && c.open_at && c.at !== c.open_at);
  // movimiento apertura→cierre del ganador de serie, en puntos de probabilidad implícita del mejor precio
  const movers = [];
  for (const c of withOpen) {
    const best = (rows, side) => (rows || []).filter((r) => r.family === 'SERIE' && r.side === side && r.odds)
      .reduce((mx, r) => Math.max(mx, r.odds), 0) || null;
    const oh = best(c.open_rows, 'home'), ch = best(c.rows, 'home');
    if (!oh || !ch) continue;
    const shift = (1 / ch - 1 / oh) * 100;                  // + = el local se ENCARECIÓ (el mercado le creyó)
    movers.push({
      id: c.id, home: (c.home || {}).name, away: (c.away || {}).name, competition: c.competition,
      open_at: c.open_at, close_at: c.at, moves: c.moves || 1,
      open_odds: oh, close_odds: ch, shift_pp: +shift.toFixed(2),
    });
  }
  movers.sort((a, b) => Math.abs(b.shift_pp) - Math.abs(a.shift_pp));
  const avgAbs = movers.length ? +(movers.reduce((a, m) => a + Math.abs(m.shift_pp), 0) / movers.length).toFixed(2) : null;
  // CLV liquidado por casa — el corte que faltaba (por familia ya lo sirve track())
  const pst = rd(PICKS_F(game));
  const settled = pst && pst.picks ? Object.values(pst.picks).filter((p) => p.status === 'SETTLED') : [];
  const byBook = {};
  for (const p of settled) {
    if (p.clv_pct == null) continue;
    const b = p.book || '?';
    byBook[b] = byBook[b] || { n: 0, clv: 0 };
    byBook[b].n++; byBook[b].clv += p.clv_pct;
  }
  return {
    game,
    coverage: {
      closes: closes.length,
      with_open_and_close: withOpen.length,
      avg_passes: closes.length ? +(closes.reduce((a, c) => a + (c.moves || 1), 0) / closes.length).toFixed(1) : null,
      note: 'la apertura se congela desde el 17-ago; los eventos anteriores solo tienen cierre y no entran al movimiento.',
    },
    movement: {
      n: movers.length, avg_abs_shift_pp: avgAbs,
      top: movers.slice(0, 6),
      note: 'desplazamiento apertura→cierre del mejor precio del ganador de serie, en puntos de probabilidad implícita. Positivo = el mercado se movió hacia el local.',
    },
    clv_by_book: Object.fromEntries(Object.entries(byBook).map(([k, v]) => [k, { n: v.n, clv_avg_pct: +(v.clv / v.n).toFixed(2) }])),
    doctrine: 'una familia no se promociona por ROI en muestra corta: necesita calibración, CLV, estabilidad temporal y confirmación fuera de muestra. Predictividad y rentabilidad se miden por separado.',
    at: (st && st.at) || null,
  };
}

// ---- 8) EL CATÁLOGO (17-ago): EQUIPOS · JUGADORES · RANKING · CIRCUITO · RESULTADOS · H2H ---------------
// Seis productos que salen ENTEROS de la base propia — ninguno depende de que una casa cotice nada. Solo
// CS2 los tiene, porque solo CS2 tiene base; los otros juegos devuelven el "por qué no" en vez de una
// pantalla vacía sin explicación. Todo lo que se sirve aquí lleva su procedencia: el rating de 6 meses de
// un jugador es del proveedor y se dice; el Elo de un equipo es de GP y también.
const CATALOG_WHY = 'solo CS2 tiene base propia (88.000+ mapas cosechados y validados); para el resto de juegos no hay fuente de resultados todavía.';
const noCatalog = (game) => ({ game, available: false, why: CATALOG_WHY });
const cdOf = (game) => {
  // el catálogo por juego: CS2 desde el 16-ago; LoL desde el 18-ago (base Leaguepedia, ver RIGHTS.md).
  // El contrato es el mismo (load/norm/resolveTeam/teamCard/rankingMovement) y cada juego pone su semántica.
  if (game === 'cs2') { try { return require('./cs2-data'); } catch { return null; } }
  if (game === 'lol') { try { const LD = require('./lol-data'); return LD.load().available ? LD : null; } catch { return null; } }
  return null;
};
const scoreDesc = (s) => {
  // el marcador de una serie guardada viaja en el orden de origen; para enseñarlo junto al GANADOR se
  // normaliza ganador-primero (en una serie el ganador siempre tiene más mapas, así que basta ordenar).
  const m = String(s || '').match(/^(\d+)-(\d+)$/);
  return m ? `${Math.max(+m[1], +m[2])}-${Math.min(+m[1], +m[2])}` : s || null;
};
const ageOf = (birthday) => {
  const t = Date.parse(birthday || '');
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / (365.25 * 24 * 3600e3)) : null;
};

function teamsDirectory(game, { q = '', limit = 60 } = {}) {
  const CD = cdOf(game); if (!CD) return noCatalog(game);
  const data = CD.load();
  if (!data.available) return { game, available: false, why: 'los agregados de la base propia no están cargados.' };
  const needle = CD.norm(q);
  const rankOf = new Map((((data.rankings || {}).rows) || []).map((r) => [r.id, r.rank]));
  const rows = Object.values(data.teams)
    .filter((t) => !needle || CD.norm(t.name).indexOf(needle) >= 0)
    .map((t) => {
      const g = data.teamGlobal[t.id], ro = data.rosters[t.id];
      return {
        id: t.id, name: t.name, logo: t.logo || null, country_id: t.country_id != null ? t.country_id : null,
        rank_gp: rankOf.get(t.id) || null,
        elo: g ? g.elo : null, wr: g ? g.wr : null, n: t.n || 0,
        form: (data.form[t.id] || []).slice(-5).map((f) => f.r),
        shock: !!(ro && ro.changed_recently),
        five: !!(ro && ro.five && ro.five.length >= 5),
      };
    })
    // ranqueados primero (por posición GP), después el resto por historial: quien abre el directorio quiere
    // ver la élite arriba, no 1.000 filas alfabéticas.
    .sort((a, b) => (a.rank_gp || 9e3) - (b.rank_gp || 9e3) || (b.n || 0) - (a.n || 0))
    .slice(0, Math.max(1, Math.min(200, limit)));
  return { game, available: true, teams: rows, total: Object.keys(data.teams).length, at: data.at };
}

function teamProfile(game, ref) {
  const CD = cdOf(game); if (!CD) return noCatalog(game);
  const data = CD.load();
  const id = data.teams[ref] ? ref : CD.resolveTeam(String(ref || ''), { data });
  if (!id) return { game, available: false, why: `no reconozco "${ref}" en la base propia.` };
  const card = CD.teamCard(id, { data });
  const rk = (((data.rankings || {}).rows) || []).find((r) => r.id === id) || null;
  let move = null;
  if (rk) {
    const mv = CD.rankingMovement({ data });
    const row = mv && mv.rows.find((r) => r.id === id);
    move = row ? row.move : null;
  }
  // el quinteto de la ficha se enriquece con el directorio de jugadores (foto, edad) y — desde el 17-ago —
  // con la estadística PROPIA: rating GP, ADR/KAST reales y su mejor mapa en la ventana.
  const five = ((card.roster && card.roster.five) || []).map((f) => {
    const p = data.players[f.id] || {};
    const st = data.playerStats[f.id] || null;
    let bestMap = null;
    if (st && st.maps) {
      const e = Object.entries(st.maps).sort((a, b) => (b[1].adr || 0) - (a[1].adr || 0))[0];
      if (e) bestMap = { map: e[0], adr: e[1].adr, n: e[1].n };
    }
    return { ...f, name: p.name || null, photo: p.photo || null, age: ageOf(p.birthday),
      country_id: p.country_id != null ? p.country_id : null, joined_at: p.joined_at || null,
      rating6m: p.rating6m != null ? p.rating6m : null,
      rating_gp: st ? st.rating_gp : null, adr: st ? st.adr : null, kast: st ? st.kast : null,
      maps_n: st ? st.n : null, best_map: bestMap };
  });
  const coach = card.roster && card.roster.coach
    ? { ...card.roster.coach, photo: (data.players[card.roster.coach.id] || {}).photo || null } : null;
  // rivales más frecuentes: la puerta de entrada al H2H desde la ficha
  const rivals = [];
  for (const [k, P] of Object.entries(data.pairs)) {
    const [x, y] = k.split('~');
    if (x !== id && y !== id) continue;
    const other = x === id ? y : x;
    if (!data.teams[other]) continue;
    const wins = x === id ? P.w_a : P.n - P.w_a;
    rivals.push({ id: other, name: data.teams[other].name, logo: data.teams[other].logo || null,
      n: P.n, wins, last: P.last || null });
  }
  rivals.sort((a, b) => b.n - a.n);
  return {
    game, available: true,
    team: { id: card.id, name: card.name, logo: card.logo || null, country_id: card.country_id != null ? card.country_id : null,
      rank_provider: card.rank || null, elo: card.elo, wr: card.wr, n: card.n },
    rank_gp: rk ? { rank: rk.rank, move, week: data.rankings.week } : null,
    maps: card.maps,                                   // efecto por mapa, ya ordenado por efecto
    roster: card.roster ? { five, coach, changed_recently: !!card.roster.changed_recently,
      shock_note: card.roster.changed_recently ? 'cambio de plantilla reciente: el historial pesa menos de lo que aparenta.' : null } : null,
    form: (data.form[id] || []).slice().reverse().map((f) => ({ ...f,
      vs_name: (data.teams[f.vs] || {}).name || f.vs, vs_logo: (data.teams[f.vs] || {}).logo || null })),
    rivals: rivals.slice(0, 6),
    provenance: C.provenance([
      { source: 'Base propia de GP (bo3.gg cosechado y validado)', kind: 'derivado', at: data.at },
      { source: 'Rating de jugadores: del proveedor (6 meses), no de GP', kind: 'proveedor', at: data.at },
    ]),
    at: data.at,
  };
}

function playersDirectory(game, { q = '', limit = 80 } = {}) {
  const CD = cdOf(game); if (!CD) return noCatalog(game);
  const data = CD.load();
  const all = Object.values(data.players || {});
  if (!all.length) return { game, available: false, why: 'el directorio de jugadores todavía no se ha derivado (corre con la cosecha de plantillas).' };
  const needle = CD.norm(q);
  const hasOwn = Object.keys(data.playerStats).length > 0;
  const rows = all
    .filter((p) => !p.coach)
    .filter((p) => !needle || CD.norm(p.nick).indexOf(needle) >= 0 || CD.norm(p.name || '').indexOf(needle) >= 0
      || CD.norm(p.team_name || '').indexOf(needle) >= 0)
    .map((p) => {
      const st = data.playerStats[p.id] || null;
      return { ...p, age: ageOf(p.birthday), team_logo: (data.teams[p.team] || {}).logo || null,
        rating_gp: st ? st.rating_gp : null, adr: st ? st.adr : null, kast: st ? st.kast : null,
        kpr: st ? st.kpr : null, maps_n: st ? st.n : null, open_pr: st ? st.open_pr : null };
    })
    // desde el 17-ago manda el RATING PROPIO (fórmula publicada, media del circuito = 1.00); el del
    // proveedor queda al lado como segunda vara. Sin estadística propia todavía, manda la del proveedor.
    .sort((a, b) => hasOwn ? ((b.rating_gp || 0) - (a.rating_gp || 0) || (b.rating6m || 0) - (a.rating6m || 0))
      : (b.rating6m || 0) - (a.rating6m || 0))
    .slice(0, Math.max(1, Math.min(300, limit)));
  return { game, available: true, players: rows, total: all.filter((p) => !p.coach).length,
    own_stats: data.playerStatsMeta || null,
    rating_note: hasOwn
      ? 'Rating GP: propio, derivado del scoreboard real por mapa (ventana ' + ((data.playerStatsMeta || {}).window_days || 180) + ' días; media del circuito = 1.00). El de 6 meses del proveedor (escala 0-10) se enseña al lado.'
      : 'rating de 6 meses del proveedor (bo3), no de GP: viaja etiquetado hasta que exista estadística propia por mapa.', at: data.at };
}

// ── FICHA DE JUGADOR (17-ago v3): identidad + Rating GP + desglose por mapa + bitácora ──────────────────
function playerProfile(game, id) {
  const CD = cdOf(game); if (!CD) return noCatalog(game);
  const data = CD.load();
  const p = data.players[id] || null;
  const st = data.playerStats[id] || null;
  if (!p && !st) return { game, available: false, why: `no reconozco "${id}" entre los jugadores con ficha.` };
  const team = p ? data.teams[p.team] : null;
  const maps = st && st.maps ? Object.entries(st.maps).map(([k, m]) => ({ map: k, ...m }))
    .sort((a, b) => (b.adr || 0) - (a.adr || 0)) : [];
  return {
    game, available: true,
    player: {
      id, nick: (st && st.nick) || (p && p.nick) || id, name: p ? p.name : null,
      photo: p ? p.photo : null, role: p ? p.role : null, age: p ? ageOf(p.birthday) : null,
      joined_at: p ? p.joined_at : null, winnings: p ? p.winnings : null,
      team: p ? p.team : null, team_name: p ? p.team_name : null, team_logo: (team && team.logo) || null,
    },
    rating_gp: st ? st.rating_gp : null,
    provider_rating: (st && st.provider_rating_avg != null) ? st.provider_rating_avg : (p ? p.rating6m : null),
    totals: st ? { n: st.n, rounds: st.rounds, wr: st.wr, kpr: st.kpr, dpr: st.dpr, apr: st.apr, adr: st.adr,
      kast: st.kast, open_pr: st.open_pr, fk: st.fk, fd: st.fd, clutches: st.clutches, multi3plus: st.multi3plus, hs_pct: st.hs_pct } : null,
    maps, recent: (st && st.recent) || [],
    // HUELLA (17-ago, del blueprint de feedback: "pasar de stats a impacto contextual"). Percentil del
    // jugador contra la POBLACIÓN CUALIFICADA de la ventana en las dimensiones que describen su rol de
    // hecho: apertura (fk−fd/ronda), volumen (kpr), daño (adr), consistencia (kast), clutch y multi-kill
    // por mapa. No es una proyección: es dónde se sienta entre sus pares, medido, y con la n al lado.
    footprint: st ? (() => {
      const pop = Object.values(data.playerStats || {});
      const dims = {
        apertura: (x) => x.open_pr,
        volumen: (x) => x.kpr,
        dano: (x) => x.adr,
        consistencia: (x) => x.kast,
        clutch: (x) => (x.n ? (x.clutches || 0) / x.n : null),
        multikill: (x) => (x.n ? (x.multi3plus || 0) / x.n : null),
      };
      const out = {};
      for (const [k, f] of Object.entries(dims)) {
        const mine = f(st);
        if (mine == null) { out[k] = null; continue; }
        const vals = pop.map(f).filter((v) => v != null);
        const below = vals.filter((v) => v < mine).length;
        out[k] = { value: +(+mine).toFixed(3), pct: vals.length ? Math.round(100 * below / vals.length) : null };
      }
      return { dims: out, pop_n: pop.length };
    })() : null,
    meta: data.playerStatsMeta,
    note: st ? 'Rating GP propio (media del circuito = 1.00, fórmula publicada en la ficha del motor); el del proveedor (0-10) viaja al lado. Todo sale del scoreboard real de la ventana.'
      : 'sin muestra propia suficiente en la ventana: se enseña la identidad y el rating del proveedor, etiquetado.',
    at: data.at,
  };
}

function rankingBoard(game) {
  const CD = cdOf(game); if (!CD) return noCatalog(game);
  const data = CD.load();
  const mv = CD.rankingMovement({ data });
  if (!mv) return { game, available: false, why: 'el ranking todavía no se ha derivado de la base.' };
  return {
    game, available: true, week: mv.week, prev_week: mv.prev_week, min_maps: mv.min_maps, at: mv.at,
    rows: mv.rows.slice(0, 50).map((r) => ({ rank: r.rank, id: r.id, elo: r.elo, wr: r.wr, n: r.n,
      move: r.move, name: (r.team || {}).name || r.id, logo: (r.team || {}).logo || null,
      country_id: r.team && r.team.country_id != null ? r.team.country_id : null,
      form: (data.form[r.id] || []).slice(-5).map((f) => f.r) })),
    note: mv.prev_week ? null : 'primera semana con foto: las flechas de movimiento aparecen la semana que viene.',
  };
}

function championsBoard(game, { role = null } = {}) {
  // el meta de campeones del parche vigente — hoy solo LoL lo deriva de su base (blueprint Fase 4);
  // el contrato queda abierto para que otro juego con "unidades" (héroes de Dota) lo implemente igual.
  const CD = cdOf(game); if (!CD || typeof CD.championsBoard !== 'function') {
    return { game, available: false, why: 'este juego no tiene tablero de campeones en la base propia.' };
  }
  const out = CD.championsBoard({ role });
  if (!out || !out.available) return { game, available: false, why: 'los agregados de campeones no están cargados todavía.' };
  return {
    game, available: true, patch: out.patch, prev_patch: out.prev_patch, games_patch: out.games_patch,
    role: role || null, rows: out.rows.slice(0, 60), note: out.note,
    rights_note: 'Datos derivados de Leaguepedia (CC BY-SA).',
  };
}

function circuit(game) {
  const CD = cdOf(game); if (!CD) return noCatalog(game);
  const data = CD.load();
  if (!data.available) return { game, available: false, why: 'los agregados de la base propia no están cargados.' };
  const entries = Object.entries(data.maps).filter(([, m]) => (m.n || 0) >= 40);
  const sumRecent = entries.reduce((s, [, m]) => s + (m.recent_n || 0), 0) || 1;
  const sumAll = entries.reduce((s, [, m]) => s + (m.n || 0), 0) || 1;
  const rankTop = new Set(((((data.rankings || {}).rows) || []).slice(0, 50)).map((r) => r.id));
  const rows = entries.map(([k, m]) => {
    const shareRecent = (m.recent_n || 0) / sumRecent, shareAll = (m.n || 0) / sumAll;
    // quién manda en el mapa: mayor EFECTO (no tasa bruta) entre la élite, con muestra mínima en ese mapa
    const specialists = [];
    for (const id of rankTop) {
      const tm = data.teamMaps[id];
      const row = tm && tm.maps && tm.maps[k];
      if (!row || (row.n || 0) < 12 || row.effect == null) continue;
      specialists.push({ id, name: (data.teams[id] || {}).name || id, logo: (data.teams[id] || {}).logo || null,
        effect: row.effect, wr: row.wr, n: row.n });
    }
    specialists.sort((a, b) => b.effect - a.effect);
    return {
      map: k, in_pool: (data.pool || []).includes(k),
      n: m.n, recent_n: m.recent_n || 0,
      share_recent: +(shareRecent * 100).toFixed(1), share_all: +(shareAll * 100).toFixed(1),
      trend: +((shareRecent - shareAll) * 100).toFixed(1),     // + = se juega más que su media histórica
      mean_rounds: m.recent_mean_rounds != null ? m.recent_mean_rounds : m.mean_rounds,
      all_mean_rounds: m.mean_rounds,
      overtime_p: m.recent_overtime_p != null ? m.recent_overtime_p : m.overtime_p,
      blowout_p: m.blowout_p != null ? m.blowout_p : null,
      decider_mean_rounds: m.decider_mean_rounds != null ? m.decider_mean_rounds : null,
      specialists: specialists.slice(0, 3),
    };
  }).sort((a, b) => (b.in_pool - a.in_pool) || (b.recent_n - a.recent_n));
  return {
    game, available: true, pool: data.pool || [], rows,
    note: 'el pool activo se deduce de lo que se juega de verdad en los últimos meses, no de una lista escrita a mano. "Tendencia" compara la cuota reciente del mapa contra su cuota histórica.',
    at: data.at,
  };
}

// Resultados recientes con marcador real de la serie — la pantalla que quita la limitación de "no verás
// marcadores". La fuente es bo3 (la misma que liquida las picks) y se cachea fuerte: es una pantalla de
// lectura, no de tiempo real.
const RESULTS_TTL = 10 * 60e3;
async function resultsRecent(game, { days = 10, force = false } = {}) {
  if (game !== 'cs2') return { game, available: false, why: 'solo CS2 tiene fuente de resultados con marcador (bo3); Dota/LoL liquidarán picks pero no tienen esta pantalla todavía.' };
  const c = G.resultsFeed && G.resultsFeed[game];
  if (c && !force && Date.now() - c.at < RESULTS_TTL) return c.data;
  const CD = cdOf(game);
  const RES = require('../data-providers/esports/results');
  const since = new Date(Date.now() - days * 24 * 3600e3).toISOString();
  // el proveedor devuelve { available, rows } — no un array a secas
  let rows = [];
  try { const rr = await RES.results(game, { since, max: 260 }); rows = (rr && rr.rows) || []; } catch { rows = []; }
  const data = CD ? CD.load() : null;
  const deco = (name) => {
    const id = data ? CD.resolveTeam(name, { data }) : null;
    const t = id && data.teams[id];
    return { name, id: id || null, logo: (t && t.logo) || null };
  };
  const out = {
    game, available: true, days,
    results: rows
      .filter((r) => (r.maps_a || 0) !== (r.maps_b || 0))     // series sin ganador claro no se enseñan
      .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0))
      .map((r) => ({ at: r.at, a: deco(r.a), b: deco(r.b), maps_a: r.maps_a, maps_b: r.maps_b,
        maps: (r.maps || []).map((m) => ({ n: m.n, map: m.map, score_a: m.score_a, score_b: m.score_b, ot: m.ot })) })),
    source: 'bo3.gg — la misma fuente que liquida las picks de CS2',
    at: new Date().toISOString(),
  };
  G.resultsFeed = G.resultsFeed || {};
  G.resultsFeed[game] = { at: Date.now(), data: out };
  return out;
}

// H2H orientado: pairs.json guarda cada par UNA vez con la convención "victorias del id menor", y aquí se
// gira a la orientación que pide quien pregunta. La convención vive en un solo sitio (la cosecha) y este es
// el único lector que la conoce.
function h2h(game, refA, refB) {
  const CD = cdOf(game); if (!CD) return null;
  const data = CD.load();
  const idA = data.teams[refA] ? refA : CD.resolveTeam(String(refA || ''), { data });
  const idB = data.teams[refB] ? refB : CD.resolveTeam(String(refB || ''), { data });
  if (!idA || !idB || idA === idB) return null;
  const [x, y] = [idA, idB].sort();
  const P = data.pairs[`${x}~${y}`];
  const base = {
    a: { id: idA, name: (data.teams[idA] || {}).name || refA, logo: (data.teams[idA] || {}).logo || null },
    b: { id: idB, name: (data.teams[idB] || {}).name || refB, logo: (data.teams[idB] || {}).logo || null },
  };
  if (!P) return { ...base, n: 0, wins_a: 0, wins_b: 0, recent: [], note: 'sin series entre ellos en la base propia.' };
  const winsA = idA === x ? P.w_a : P.n - P.w_a;
  return {
    ...base, n: P.n, wins_a: winsA, wins_b: P.n - winsA, last: P.last || null,
    recent: (P.recent || []).slice().reverse().map((r) => ({
      at: r.at || null, winner_id: r.w, winner: (data.teams[r.w] || {}).name || r.w,
      score: scoreDesc(r.s), tier: r.tier || null })),
  };
}

module.exports = {
  ENGINES, GAME_ORDER, PICK_FAMILIES, PICK_DOCTRINE, DIR,
  slate, overview, ratings, harvest, snapshot, closesCount, marketEvidence, market, analyzeMatch, board, evaluateAll, probFor, boOf,
  teamSearch, simulate, recordPicks, settlePicks, track, settleOne,
  teamsDirectory, teamProfile, playersDirectory, rankingBoard, circuit, resultsRecent, h2h, playerProfile,
  championsBoard,
};
