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
      // CS2 sí tiene rating propio desde el 16-ago, y no viene de ninguna casa: sale de la cosecha histórica
      // de GP (48.678 mapas). Los otros tres juegos siguen sin él, y mezclar las dos situaciones en una sola
      // frase era mentir sobre la mitad del producto.
      own_rating: 'cs2',
      why: BK.RESULTS_UNAVAILABLE.why,
      consequence: 'en CS2 la fuerza sale de la base propia (modelo jerárquico calibrado, validado fuera de muestra). En LoL, Valorant y Dota 2 el ganador sigue siendo el consenso del mercado sin margen con 0 % de peso propio; la estructura derivada —rondas, duración y kills— es del modelo y no depende del rating.',
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
async function snapshot(game, { withinMin = 180 } = {}) {
  if (!ENGINES[game]) return { game, saved: 0 };
  const s = await slate(game, { days: 2, force: true }).catch(() => null);
  const evs = ((s && s.events) || []).filter((e) => {
    if (!e.start_at) return false;
    const mins = (Date.parse(e.start_at) - Date.now()) / 60000;
    return mins > -15 && mins < withinMin;    // la ventana previa al inicio, que es donde vive el cierre
  });
  const st = rd(`closes-${game}.json`) || { game, closes: {} };
  let saved = 0;
  for (const ev of evs) {
    const mk = await market(game, ev, { force: true }).catch(() => null);
    if (!mk || !mk.markets.length) continue;
    st.closes[ev.id] = {
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
  const sample = Math.min(rt.matches[a] || 0, rt.matches[b] || 0);
  const model = E.analyze({
    market: mk,
    ratings: { elo_a: rt.elo[a], elo_b: rt.elo[b] },
    // los NOMBRES van al motor: CS2 los resuelve contra su propio histórico para sacar la fuerza por mapa
    teams: { a: ev.home.name, b: ev.away.name },
    bo, sample, competition: ev.competition,
  });
  const edges = evaluateAll({ game, model, mk, ev, bo, sample });
  // LO QUE SOLO SE VE CON VARIAS CASAS, y va aparte de las picks a propósito: el arbitraje NO pasa por el
  // modelo, así que no hereda su riesgo. Si el modelo estuviera entero equivocado, esta sección seguiría
  // siendo válida — es la única señal de la casa de la que se puede decir eso.
  const cross = BK.crossBook((mk && mk.markets) || []);
  const arbs = BK.arbitrages((mk && mk.markets) || []);
  return {
    event: ev, bo, sample,
    rating: { a: C.r2(rt.elo[a] || null), b: C.r2(rt.elo[b] || null), matches_a: rt.matches[a] || 0, matches_b: rt.matches[b] || 0 },
    model,
    market_raw: mk ? { markets: mk.markets, at: mk.at } : null,
    books: mk ? { n: mk.books, by_book: mk.by_book, sources: ev.sources } : null,
    // los mercados donde MÁS DE UNA casa opina: consenso sin margen, mejor precio de cada lado y dispersión.
    // La dispersión es la señal de "aquí las casas no se ponen de acuerdo", que es donde vive tanto el valor
    // como la trampa, y por eso se publica en vez de resolverse en silencio.
    cross_book: cross.filter((m) => m.books > 1),
    arbitrages: arbs,
    edges,
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
    picks,
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
    const sample = Math.min(rt.matches[ev.home.id] || 0, rt.matches[ev.away.id] || 0);
    let model = null;
    try {
      model = E.analyze({ market: mk, ratings: { elo_a: rt.elo[ev.home.id], elo_b: rt.elo[ev.away.id] },
        teams: { a: ev.home.name, b: ev.away.name }, bo, sample, competition: ev.competition });
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
    standalone: true,
    note: 'esta probabilidad NO está anclada a ninguna casa: es la del modelo sola, sobre la base propia de GP. En una partida real el mercado manda sobre el ganador y el modelo aporta la estructura — aquí se enseña el modelo desnudo a propósito, que es de lo que va esta pantalla.',
    at: new Date().toISOString(),
  };
}

function closesCount(game) {
  const st = rd(`closes-${game}.json`);
  return st && st.closes ? Object.keys(st.closes).length : 0;
}

module.exports = {
  ENGINES, GAME_ORDER, PICK_FAMILIES, PICK_DOCTRINE, DIR,
  slate, overview, ratings, harvest, snapshot, closesCount, market, analyzeMatch, board, evaluateAll, probFor, boOf,
  teamSearch, simulate,
};
