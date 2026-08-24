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

// LA PUERTA SE ABRE, Y SE VE EN EL DIFF (19-ago, decisión de Alexis: "no cierres ninguna familia de ningún
// deporte hasta tener más muestra").
//
// El ganador de serie estaba fuera por una razón que, mirada de cerca, no era evidencia sobre ESTE deporte:
// GP midió pérdidas en el mercado de ganador en BALONCESTO (−11,87 % de ROI) y en COMBATE (−8,34 % de CLV).
// Eso es un prior fuerte y sigue siéndolo — pero un prior tomado de otros dos deportes no es una medición
// de esports, y cerrar la familia garantiza que nunca la haya. Una puerta cerrada no produce el dato que
// justificaría cerrarla; solo lo hace imposible.
//
// Todo esto vive en SOMBRA y en admin: nada de aquí se publica. Así que abrir cuesta exactamente cero
// dinero y compra la única cosa que falta, que es muestra. Lo que NO cambia es la honestidad de la
// etiqueta: SERIE entra marcada con su prior en contra, y la revisión la juzgará por su CLV como a todas.
const PICK_FAMILIES = new Set([
  'TOTAL_MAPAS', 'HANDICAP',
  'RONDAS', 'RONDAS_EQUIPO', 'RONDAS_HANDICAP', 'PRORROGA',
  'KILLS', 'KILLS_EQUIPO', 'KILLS_HANDICAP', 'KILLS_DNB',
  'SERIE',
]);
// Familias que entran CON PRIOR EN CONTRA: se registran en sombra, pero la tarjeta lo dice y la revisión
// las mira aparte. No es lo mismo una familia sin historia que una con historia mala en otro deporte.
const PICK_PRIOR_CONTRA = { SERIE: 'el ganador de serie entra en sombra CON prior en contra: es el mercado donde GP midió pérdidas en otros dos deportes (baloncesto −11,87 % de ROI, combate −8,34 % de CLV). Se abre para tener muestra propia de esports, no porque se espere que gane. La revisión la juzga por su CLV, aparte del resto.' };
// Y UNA ACLARACIÓN QUE HAY QUE DEJAR ESCRITA: abrir la familia NO significa que vaya a producir picks en
// todos los partidos. Cuando la probabilidad de GP se ancla al precio del ganador de serie —que es el caso
// normal en CS2— esa familia queda vetada por ORTOGONALIDAD, que es una regla distinta y correcta: medirse
// contra el precio que uno mismo usó de prior es medirse contra uno mismo. Ese veto se queda. Lo que
// desaparece es el cierre por doctrina, que era otra cosa.
const PICK_DOCTRINE = 'el ganador de serie ya no está cerrado por doctrina: se registra en SOMBRA con prior en contra (GP midió pérdidas en ese mercado en baloncesto y en combate, pero eso no es una medición de esports y el cierre impedía tenerla). Cuando la probabilidad de GP se ancla a ese mismo mercado, la familia sigue vetada por ortogonalidad — no por doctrina — porque medirse contra el propio prior no mide nada. Nada de esto se publica.';

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
// DOS RESOLUTORES, Y LA DIFERENCIA ENTRE ELLOS ES DELIBERADA.
//
// El de la AGENDA solo se activa en CS2 y así se queda. No es que a los otros les falte: es que el id
// canónico del evento SALE del par resuelto, y cambiar la resolución cambia el id de partidos que ya
// tienen cierres y picks guardados bajo el id viejo. Eso es exactamente el fallo que costó un día de
// depuración y dejó el CLV a nulo (ver la nota larga en `slate`). Encenderlo en LoL, Valorant y Dota 2
// exige migrar el histórico primero, y esa es una tarea con su propio riesgo.
function resolverFor(game) {
  if (game !== 'cs2') return null;
  try { const CD = require('./cs2-data'); return (name) => CD.resolveTeam(name); } catch { return null; }
}

// El de la LIQUIDACIÓN sí se activa en los cuatro, y aquí no hay ningún riesgo de identidad porque no
// genera ids: solo empareja el nombre que guardó la pick con el nombre que publica la fuente de
// resultados. Sin él, ese emparejamiento era comparación de cadenas pelada.
//
// EL COSTE DE NO TENERLO, medido: Dota 2 tenía 12 picks vencidas y CERO liquidadas. La casa dice "Aurora
// Gaming" y OpenDota dice "Aurora"; la casa "Nigma Galaxy" y la fuente "Team Nigma Galaxy" — dos cadenas
// distintas, ninguna coincidencia, la pick se queda abierta para siempre y el registro nunca crece. Con
// el resolutor de cada juego, 15 de 16 nombres de OpenDota resuelven a un equipo de la base propia.
// La ventana de ±12 h que ya existía sigue mandando: dos partidos del mismo par en el mismo día son la
// misma serie, así que resolver mejor no puede emparejar con una serie ajena.
const DATA_MOD = { cs2: 'cs2-data', lol: 'lol-data', valorant: 'valorant-data', dota2: 'dota2-data' };
function resolverParaLiquidar(game) {
  const mod = DATA_MOD[game];
  if (!mod) return null;
  try {
    const CD = require('./' + mod);
    if (typeof CD.resolveTeam !== 'function') return null;
    const data = CD.load();
    return (name) => { try { return CD.resolveTeam(name, { data }); } catch { return null; } };
  } catch { return null; }
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
      // ── EL RATING QUE DE VERDAD USA EL MOTOR (19-ago) ────────────────────────────────────────────────
      // Esto informaba `rating_matches: rt.n`, donde `rt` es el Elo GENÉRICO que se calcula desde
      // `results-<juego>.json`. Ese fichero está vacío en los cuatro juegos, así que la sonda llevaba meses
      // publicando "rating 0" — y es falso: cuando existe capa propia por juego (`lol-data`,
      // `valorant-data`, `dota2-data`), el motor NO usa el Elo genérico, usa la capa, vía `ownInputFor`.
      // Y las capas están llenas: T1 tiene 1884 de Elo con 930 partidos, Team Spirit 1747 con 569.
      //
      // Un indicador que dice 0 cuando el valor real son miles no es un detalle de presentación: es una
      // trampa. Hoy me llevó a decidir sobre una carencia que no existía. Ahora informa las DOS cosas y
      // dice cuál manda.
      rating_matches: rt ? rt.n : 0,
      rating_teams: rt ? Object.keys(rt.elo).length : 0,
      rating_propio: (() => {
        const mod = { lol: './lol-data', valorant: './valorant-data', dota2: './dota2-data', cs2: './cs2-data' }[g];
        if (!mod) return null;
        try {
          const D = require(mod);
          const d = D.load && D.load();
          if (!d || d.available === false) return { capa: mod.slice(2), disponible: false };
          return { capa: mod.slice(2), disponible: true,
            equipos: d.teams ? Object.keys(d.teams).length : null,
            partidos: Array.isArray(d.matches) ? d.matches.length : null,
            manda: 'esta capa gobierna la probabilidad; el Elo genérico de arriba solo actúa si esta falla' };
        } catch (e) { return { capa: mod.slice(2), disponible: false, error: e.message }; }
      })(),
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
      own_rating: ['cs2', 'lol', 'valorant', 'dota2'].filter((g2) => !!cdOf(g2)).join('+') || 'ninguno',
      why: BK.RESULTS_UNAVAILABLE.why,
      // caja negra (18-ago): se dice QUÉ hay (base propia validada) y su fuerza relativa, no CÓMO se construye
      consequence: 'los CUATRO juegos tienen base propia de GP validada fuera de muestra desde el 18-ago — la señal de CS2 es la más fuerte y la de Dota 2 la más modesta, y el peso propio de cada juego lo refleja. Todo entra ANCLADO a mercado con peso creciente por muestra; la estructura derivada es del modelo y no depende del rating.',
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
      rows: mk.markets.map((r) => ({ book: r.book, family: r.family, line: r.line, side: r.side, period: r.period, map: r.map, team: r.team, odds: r.odds,
        // cuándo se vio este precio y a cuántos minutos del inicio. Sin esto no se puede distinguir un
        // cierre de verdad de un precio de hace diez horas, y los dos se estaban llamando igual.
        at: mk.at, pre_min: Math.round((Date.parse(ev.start_at) - Date.parse(mk.at)) / 60000) })),
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
    // NO BORRAR LO QUE LA CASA DEJÓ DE COTIZAR (25-ago). Cada pasada sobreescribía `rows` entera, y eso
    // parecía inocente: el último guardado antes del inicio es el cierre. Pero una casa no cotiza el mismo
    // menú todo el rato. El hándicap de kills de LoL se publica horas antes y DESAPARECE del tablero cerca
    // del inicio; la última pasada llegaba con MAPA/SERIE/HANDICAP/TOTAL_MAPAS y sin kills, y al sobreescribir
    // borraba el único precio que había. Resultado medido: 115 de las 165 picks liquidadas sin CLV tenían su
    // cierre guardado y sin su propia familia dentro. No era el casador de líneas: era esta línea.
    //
    // Ahora se FUSIONA por (casa · familia · línea · lado · periodo · mapa · equipo): la pasada nueva pisa lo
    // que vuelve a ver, y lo que ya no cotiza nadie conserva su última observación con la hora y los minutos
    // que faltaban para el inicio. Eso no convierte un precio viejo en un cierre —por eso viaja `pre_min`,
    // para poder separarlos en el informe en vez de mezclarlos— pero es el mejor precio observado que existe,
    // y perderlo era quedarse sin la métrica entera.
    {
      const keyOf = (r) => [r.book, r.family, r.line == null ? '' : r.line, r.side || '', r.period || '',
        r.map || '', r.team || ''].join('|');
      const m = new Map();
      for (const r of ((prev && prev.rows) || [])) m.set(keyOf(r), r);
      for (const r of entry.rows) m.set(keyOf(r), r);
      let fus = [...m.values()];
      // tope duro: si un evento acumula demasiadas combinaciones, se quedan las observaciones más recientes
      if (fus.length > 1200) fus = fus.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 1200);
      entry.rows = fus;
    }
    st.closes[ev.id] = entry;
    saved++;
  }
  st.at = new Date().toISOString();
  wr(`closes-${game}.json`, st);
  // POR QUÉ SE GUARDÓ CERO. Dota 2 lleva 0 cierres con 7 eventos en la agenda, y con el retorno de antes no
  // había forma de saber si es que ningún evento cayó en la ventana previa, si el proveedor no cotiza ese
  // juego, o si hay un fallo. Un cero sin motivo no se puede revisar el lunes. Ahora el motivo viaja.
  return { game, saved, total: Object.keys(st.closes).length,
    diag: { eventos_agenda: ((s && s.events) || []).length, en_ventana: evs.length,
      sin_mercado: evs.length - saved,
      why: !((s && s.events) || []).length ? 'el proveedor no lista eventos de este juego'
        : !evs.length ? `hay ${((s && s.events) || []).length} eventos pero ninguno dentro de la ventana de ${withinMin} min previa al inicio`
          : saved === 0 ? 'eventos en ventana pero el proveedor no devolvió mercados para ninguno' : null } };
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
    const o = LD.objectivesFor ? LD.objectivesFor(competition) : null;
    return { ratings: { elo_a: r.elo_a, elo_b: r.elo_b }, sample: Math.min(r.matches_a, r.matches_b),
      observedTempo: t ? { games: t.n, kpm: t.kpm, minutes: t.mean_min } : null,
      // conteos REALES de dragones/barones/torres de la liga: el panel de objetivos deja de ser aritmética
      observedObjectives: o, own: true,
      dataset: LD.datasetFor(ev.home.name, ev.away.name),
      source: 'base propia (Leaguepedia, walk-forward validado)' };
  } catch { return null; }
}
// Valorant (18-ago): mismo criterio — Elo propio de series (vlr.gg, margen+óxido validados) y, cuando el
// detalle por mapa existe, la fuerza por mapa MEDIDA y la profundidad de composición alimentan el árbol
// de veto del motor en lugar de dejarlo sin ramas. Si algo no resuelve, cae al camino anterior.
function valOwnInput(ev) {
  try {
    const VD = require('./valorant-data');
    const r = VD.ratingsFor(ev.home.name, ev.away.name);
    if (!r || r.elo_a == null || r.elo_b == null) return null;
    const ratings = { elo_a: r.elo_a, elo_b: r.elo_b };
    const vi = VD.vetoInput(ev.home.name, ev.away.name);
    if (vi) { ratings.map_strength = vi.map_strength; if (vi.agent_depth) ratings.agent_depth = vi.agent_depth; }
    return { ratings, sample: Math.min(r.matches_a, r.matches_b), observedTempo: null, own: true,
      dataset: VD.datasetFor(ev.home.name, ev.away.name),
      source: 'base propia (vlr.gg, walk-forward validado)' };
  } catch { return null; }
}
// Dota 2 (18-ago): el Elo propio existe desde el 17 (OpenDota, 1,92 % de skill validado — señal real,
// cuatro veces menor que CS2) y recién ahora se enchufa, anclado a mercado: con ese skill el peso propio
// que le da anchoredProbability por muestra es exactamente el que le corresponde — modesto.
function dotaOwnInput(ev) {
  try {
    const DD = require('./dota2-data');
    const r = DD.ratingsFor(ev.home.name, ev.away.name);
    if (!r || r.elo_a == null || r.elo_b == null) return null;
    // 19-ago: r_score/d_score de OpenDota SON los kills → el ritmo del torneo pasa de perfil asumido a
    // MEDIDO, que es la puerta que las familias de kills necesitaban para poder generar picks.
    const t = DD.tempoFor(ev.competition);
    return { ratings: { elo_a: r.elo_a, elo_b: r.elo_b }, sample: Math.min(r.matches_a, r.matches_b),
      observedTempo: t ? { games: t.n, kpm: t.kpm, minutes: t.mean_min } : null, own: true,
      dataset: DD.datasetFor(ev.home.name, ev.away.name),
      source: 'base propia (OpenDota, walk-forward validado)' };
  } catch { return null; }
}
const ownInputFor = (game, ev) => (game === 'lol' ? lolOwnInput(ev, ev.competition)
  : game === 'valorant' ? valOwnInput(ev) : game === 'dota2' ? dotaOwnInput(ev) : null);

// LAS FICHAS DE LOS DOS EQUIPOS (19-ago, pedido de Alexis: "no hay fotos, es una pila de datos"). CS2 las
// trae de su motor y por eso su héroe tiene escudo, muestra y forma; los otros tres las traen de su capa de
// datos y se adjuntan con la MISMA forma, así el héroe de CS2 sirve para los cuatro — y de paso la pizarra
// y las pick cards heredan el escudo, que es lo que convierte una lista de nombres en un calendario.
function attachTeamCards(game, model, ev) {
  if (!model || model.teams || game === 'cs2') return;
  try {
    const DL = require(`./${game}-data`);
    const dd = DL.load();
    if (!dd || !dd.available) return;
    const ida = DL.resolveTeam(ev.home.name, { data: dd }), idb = DL.resolveTeam(ev.away.name, { data: dd });
    const card = (id, fallbackName) => {
      if (!id) return { name: fallbackName, logo: null, n: 0, elo: null, wr: null, form: [], roster: null };
      const c = DL.teamCard(id, { data: dd });
      return { ...c, form: (dd.form && dd.form[id]) || [], roster: c.roster || (dd.rosters || {})[id] || null };
    };
    model.teams = { a: card(ida, ev.home.name), b: card(idb, ev.away.name) };
  } catch { /* sin base propia: el héroe cae al monograma, como antes */ }
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
  const own = ownInputFor(game, ev);
  const sample = own ? own.sample : Math.min(rt.matches[a] || 0, rt.matches[b] || 0);
  const model = E.analyze({
    market: mk,
    ratings: own ? own.ratings : { elo_a: rt.elo[a], elo_b: rt.elo[b] },
    // los NOMBRES van al motor: CS2 los resuelve contra su propio histórico para sacar la fuerza por mapa
    teams: { a: ev.home.name, b: ev.away.name },
    bo, sample, competition: ev.competition,
    observedTempo: own ? own.observedTempo : null,
    observedObjectives: own ? own.observedObjectives : null,
  });
  // LA ESTRUCTURA PROPIA MEDIDA (19-ago). `basisFor` exige, para las familias de mapas, que exista fuerza
  // medida del PAR — no del juego en general. CS2 la trae de su propio histórico dentro del motor; los
  // otros tres la traen de su capa de datos y se adjunta aquí para que la puerta sea la misma para todos.
  if (own && own.dataset && !model.dataset) model.dataset = own.dataset;
  attachTeamCards(game, model, ev);

  // el cuarto propio del cruce: en LoL el Draft Room (pools, comfort, fragilidad, meta del parche);
  // en Valorant la Sala de composición (pools de agentes, comfort, fragilidad, meta de la ventana).
  // Misma forma de datos a propósito: la UI los renderiza con el mismo panel.
  if (game === 'lol' && model) {
    try { model.draft_room = require('./lol-data').draftIntel(ev.home.name, ev.away.name); } catch { }
  }
  if (game === 'valorant' && model) {
    try { model.draft_room = require('./valorant-data').compIntel(ev.home.name, ev.away.name); } catch { }
  }
  if (game === 'dota2' && model) {
    try { model.draft_room = require('./dota2-data').draftIntel(ev.home.name, ev.away.name); } catch { }
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
      ? { a: own.ratings.elo_a, b: own.ratings.elo_b, matches_a: own.sample, matches_b: own.sample, source: own.source }
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
    h2h: h2h(game, ev.home.name, ev.away.name),   // los cuatro juegos tienen base propia desde el 18-ago; sin base devuelve null solo

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
    if (!PICK_FAMILIES.has(r.family)) continue;
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
      basis_measured: basis.measured, basis: basis.what,
      // FAMILIA CON PRIOR EN CONTRA: viaja pegado a la pick, no en una nota de pantalla. Si la fila acaba
      // en el registro de la sombra, la razón por la que se abrió tiene que estar dentro de la fila.
      prior_contra: PICK_PRIOR_CONTRA[r.family] || null };
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
  const supArbs = [], supMids = [], supDrops = [];
  // el archivo de cierres guarda la APERTURA de cada evento (`open_rows`, congelada en la primera pasada).
  // Se lee UNA vez para toda la pizarra, no una por partido.
  const abiertas = rd(`closes-${game}.json`);
  const evLite = (e) => ({ id: e.id, home: e.home, away: e.away, competition: e.competition, start_at: e.start_at });
  for (const ev of use) {
    const mk = mkts.get(ev.id) || null;
    const bo = boOf(mk, E.GAME.default_bo, ev);
    const rt = ratings(game);
    const ownB = ownInputFor(game, ev);
    const sample = ownB ? ownB.sample : Math.min(rt.matches[ev.home.id] || 0, rt.matches[ev.away.id] || 0);
    let model = null;
    try {
      model = E.analyze({ market: mk, ratings: ownB ? ownB.ratings : { elo_a: rt.elo[ev.home.id], elo_b: rt.elo[ev.away.id] },
        teams: { a: ev.home.name, b: ev.away.name }, bo, sample, competition: ev.competition,
        observedTempo: ownB ? ownB.observedTempo : null });
    } catch { model = null; }
    if (model && ownB && ownB.dataset && !model.dataset) model.dataset = ownB.dataset;
    attachTeamCards(game, model, ev);
    const edges = model ? evaluateAll({ game, model, mk, ev, bo, sample }) : null;
    const arbs = mk ? BK.arbitrages(mk.markets || []) : [];
    // LAS TRES SUPERFICIES QUE NO PASAN POR EL MODELO (19-ago, pedido de Alexis: "agrega arbitraje, caídas y
    // middles"). El arbitraje ya se calculaba y solo vivía dentro de la ficha del partido; los middles y las
    // caídas no existían en esports. Van juntas a propósito: las tres salen de precios entre casas, así que
    // si el modelo estuviera entero equivocado las tres seguirían siendo válidas — y son lo único de lo que
    // se puede decir eso. Las caídas necesitan un ANTES, y el antes es la apertura que ya guarda el archivo
    // de cierres desde el 17-ago: la primera lectura de cada evento queda congelada ahí.
    const mids = mk ? BK.middles(mk.markets || []) : [];
    const ab = abiertas && abiertas.closes && abiertas.closes[ev.id];
    const caidas = (mk && ab && ab.open_rows) ? BK.dropping(ab.open_rows, mk.markets || []) : [];
    for (const x of arbs) supArbs.push({ ...x, event: evLite(ev) });
    for (const x of mids) supMids.push({ ...x, event: evLite(ev) });
    for (const x of caidas) supDrops.push({ ...x, event: evLite(ev), since: ab.open_at || null, reads: ab.moves || null });
    items.push({
      event: ev, bo,
      p_home: model && model.probability ? model.probability.p : null,
      anchor: model && model.probability ? model.probability.source : null,
      books: mk ? mk.books : (ev.books || 0),
      // las casas que de verdad DEVOLVIERON precio, no las que listaban el partido: una casa que lo tiene en
      // la agenda pero ya cerró el mercado (porque el partido empezó) no está cotizando nada.
      book_list: mk ? (mk.by_book || []).filter((b) => b.rows).map((b) => b.book) : (ev.sources || []).map((x) => x.book),
      markets_n: (mk && mk.markets) ? mk.markets.length : 0,
      // QUÉ FAMILIAS LLEGA A COTIZAR EL MERCADO EN ESTE PARTIDO. Sin esto no se puede distinguir una
      // familia que el motor RECHAZA de una que ninguna casa OFRECE — y son dos problemas distintos.
      market_families: mk && mk.markets ? [...new Set(mk.markets.map((r) => r.family))] : [],
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
      // LA LECTURA DEL MOTOR EN NÚMEROS, no en una frase. `highlight` es una cadena para pintar de un
      // vistazo; el brief necesita los números sueltos para poder ordenar por ellos y para dárselos al
      // redactor. Cada juego pone LO SUYO —el veto en CS2, los kills en LoL, la prórroga en Valorant, la
      // cola de duración en Dota 2— porque es justo lo que hace que estas cuatro pestañas sean cuatro
      // productos y no cuatro copias.
      read: readOf(game, model),
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
    // las tres superficies de mercado, ya planas y con su partido dentro, listas para pintarse como pestañas
    surfaces: {
      arbs: supArbs.sort((a, b) => b.profit_pct - a.profit_pct).slice(0, 40),
      middles: supMids.sort((a, b) => a.cost_pct - b.cost_pct).slice(0, 40),
      dropping: supDrops.slice(0, 40),
      counts: { arbs: supArbs.length, middles: supMids.length, dropping: supDrops.length },
      // POR QUÉ PUEDE VENIR VACÍO, contado en vez de callado. Las tres necesitan más de una casa cotizando el
      // MISMO mercado, y las caídas necesitan además una lectura anterior guardada. Un cero sin motivo no se
      // puede revisar el lunes.
      why: (() => {
        const varias = items.filter((x) => (x.book_list || []).length > 1).length;
        const conApertura = use.filter((e) => abiertas && abiertas.closes && abiertas.closes[e.id] && abiertas.closes[e.id].open_rows).length;
        if (!items.length) return 'no hay partidos en la agenda de este juego ahora mismo';
        if (!varias) return `los ${items.length} partidos de la agenda los cotiza una sola casa: sin dos casas no hay arbitraje ni middle posible`;
        if (!conApertura) return `hay ${varias} partidos con varias casas, pero ninguno tiene todavía una lectura de apertura guardada: las caídas necesitan un antes`;
        return null;
      })(),
      diag: { partidos: items.length, con_varias_casas: items.filter((x) => (x.book_list || []).length > 1).length },
    },
    doctrine: PICK_DOCTRINE,
    at: new Date().toISOString(),
  };
}

// La lectura del motor EN NÚMEROS, para que el brief pueda ordenar por ella y el redactor citarla.
function readOf(game, model) {
  if (!model) return null;
  const o = {};
  if (model.veto_impact) o.veto = { verdict: model.veto_impact.verdict, shift_pp: model.veto_impact.shift_pp };
  if (model.rounds) { o.rounds = model.rounds.mean_rounds; if (model.rounds.overtime_p != null) o.overtime_pct = Math.round(100 * model.rounds.overtime_p); }
  if (model.kills) o.kills = model.kills.mean_kills;
  if (model.duration) { o.minutes = model.duration.mean_min; if (model.duration.p99 != null) o.minutes_p99 = model.duration.p99; }
  if (model.dataset && model.dataset.n != null) o.sample = model.dataset.n;
  return Object.keys(o).length ? o : null;
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
  const CD = game === 'cs2' ? require('./cs2-data') : cdOf(game);
  if (!CD) return { game, available: false, why: 'la base propia de este juego no está cargada todavía.', teams: [] };
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
  // desde el 18-ago los CUATRO juegos tienen base propia: CS2 con su simulador de mapas; LoL, Valorant y
  // Dota 2 con el Elo propio validado (el motor de cada juego pone la estructura encima).
  if (game !== 'cs2') {
    const CD2 = cdOf(game);
    if (!CD2) return { game, available: false, why: 'la base propia de este juego no está cargada todavía.' };
    const d2 = CD2.load();
    const iA = CD2.resolveTeam(aName, { data: d2 }), iB = CD2.resolveTeam(bName, { data: d2 });
    if (!iA || !iB) return { game, available: false, resolved: { a: iA, b: iB },
      why: `no reconozco a ${!iA ? aName : bName} en la base propia. Se devuelve nada antes que el historial de otro equipo.` };
    if (iA === iB) return { game, available: false, why: 'los dos nombres resuelven al mismo equipo.' };
    const cardA = CD2.teamCard(iA, { data: d2 }), cardB = CD2.teamCard(iB, { data: d2 });
    const ratings = { elo_a: cardA.elo != null ? cardA.elo : 1500, elo_b: cardB.elo != null ? cardB.elo : 1500 };
    const model = E.analyze({ market: { markets: [] }, ratings, bo,
      sample: Math.min(cardA.n || 0, cardB.n || 0), teams: { a: cardA.name, b: cardB.name } });
    if (model) {
      try {
        if (game === 'lol') model.draft_room = require('./lol-data').draftIntel(cardA.name, cardB.name);
        if (game === 'valorant') model.draft_room = require('./valorant-data').compIntel(cardA.name, cardB.name);
        if (game === 'dota2') model.draft_room = require('./dota2-data').draftIntel(cardA.name, cardB.name);
      } catch { }
    }
    return { game, available: true, bo, teams: { a: cardA, b: cardB }, model, h2h: h2h(game, iA, iB), standalone: true,
      note: 'probabilidad del modelo propio de GP sola, sin ancla de mercado — en una partida real el mercado manda sobre el ganador; aquí se enseña el modelo desnudo a propósito.',
      at: new Date().toISOString() };
  }
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

// ---- RETIRADA DE PICKS NACIDAS CON LOS LADOS CRUZADOS (19-ago) ------------------------------------------
// Sale del mismo fallo que la guardia de orientación de `books.js`: cuando dos casas tienen invertidos el
// local y el visitante, el CONSENSO que ancla al modelo es la mediana de las dos orientaciones. En el
// partido que lo destapó eso daba 50/50 donde las dos casas estaban de acuerdo en 87/13, y con un ancla así
// TODAS las familias parecen tener treinta y siete puntos de ventaja. No falla nada visiblemente: nacen
// picks perfectamente formadas, con su tesis y su stake — y en ese partido nacieron dieciséis, incluidas
// dos que apuestan los dos lados del mismo hándicap.
//
// Esas picks no se pueden dejar liquidar: ganen o pierdan, su resultado no mide al modelo, mide al fallo, y
// el registro es lo único que esta casa dice que manda. Se retiran con motivo explícito, que es lo mismo que
// se hace en fútbol con las que quedan fuera de doctrina. NO se borran: borrar resultados no se hace aquí.
function retireCrossedPicks(game) {
  const st = rd(PICKS_F(game));
  if (!st || !st.picks) return { game, retired: 0 };
  const cl = rd(`closes-${game}.json`);
  if (!cl || !cl.closes) return { game, retired: 0, why: 'sin cierres guardados con los que comprobar' };
  const malos = new Set();
  for (const [id, e] of Object.entries(cl.closes)) {
    for (const rows of [e.rows, e.open_rows]) {
      const o = BK.orientationCheck(rows || []);
      if (o.books >= 2 && !o.ok) { malos.add(id); break; }
    }
  }
  if (!malos.size) return { game, retired: 0, events: 0 };
  let n = 0;
  for (const p of Object.values(st.picks)) {
    if (p.status !== 'ACTIVE' || !malos.has(p.event_id)) continue;
    p.status = 'SETTLED'; p.result_code = 'SUPERSEDED';
    p.settled_at = new Date().toISOString();
    p.result_source = 'guardia de orientación: las casas de este partido tenían cruzados local y visitante, ' +
      'así que el consenso que ancló esta pick no era el consenso de nadie';
    p.units = 0;
    n++;
  }
  if (n) { st.at = new Date().toISOString(); wr(PICKS_F(game), st); }
  return { game, retired: n, events: malos.size };
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
  // ── KILLS (19-ago) ───────────────────────────────────────────────────────────────────────────────────
  // Antes esto era `return null` con la nota "bo3 no publica kills por mapa". Cierto para CS2 — y sigue
  // siéndolo — pero se llevó por delante a LoL, que es JUSTO el juego con mercado de kills abierto y donde
  // están todas sus picks: 18 generadas y cero liquidadas, para siempre. Ahora, cuando la fuente trae
  // kills (Leaguepedia en LoL, OpenDota en Dota 2), se liquidan; cuando no los trae, se sigue devolviendo
  // null y la pick queda declarada como inliquidable en vez de inventarse el dato.
  const kA = m ? need(m.kills_a) : null, kB = m ? need(m.kills_b) : null;
  const kTot = (kA != null && kB != null) ? kA + kB : (m ? need(m.kills_total) : null);
  if (pk.family === 'KILLS') return cmp(kTot, pk.line, isOver);
  if (pk.family === 'KILLS_EQUIPO') {
    const v = pk.team === 'home' ? kA : pk.team === 'away' ? kB : null;
    return cmp(v, pk.line, isOver);
  }
  if (pk.family === 'KILLS_HANDICAP') {
    if (kA == null || kB == null) return null;
    const v = (kA - kB) + pk.line;
    if (v === 0) return 'PUSH';
    return (pk.side === 'home' ? v > 0 : v < 0) ? 'WIN' : 'LOSS';
  }
  if (pk.family === 'KILLS_DNB') {
    // "sin empate": el empate exacto en kills devuelve la apuesta
    if (kA == null || kB == null) return null;
    if (kA === kB) return 'PUSH';
    return (pk.side === 'home' ? kA > kB : kB > kA) ? 'WIN' : 'LOSS';
  }
  return null;
}

// El CLV se calcula igual que en baloncesto —`cuota_tomada / cuota_cierre − 1`— para que las cifras de los
// cuatro deportes se puedan poner en la misma tabla sin nota al pie.
// EL PROBLEMA QUE ESTO RESUELVE (25-ago). El hándicap de kills de LoL lleva 132 picks liquidadas y solo
// ONCE con CLV. No es que falte el cierre —hay 149 cierres guardados—: es que la línea se mueve. Nacemos
// en +2,5 y la casa cierra en +3,5, y como este casador exigía la línea EXACTA, el 92 % de la familia se
// quedaba sin medir. Con una familia sin medir no se puede decidir nada, y era justo la que mejor pinta
// tenía de toda la casa.
//
// La corrección es la que usa cualquiera que mida CLV sobre hándicaps: si la línea exacta no está en el
// cierre, se INTERPOLA sobre la escalera de la misma casa. Con dos reglas que la hacen honesta:
//   · se interpola en PROBABILIDAD implícita, no en cuota — la cuota no es lineal en la línea;
//   · se marca de dónde salió (`exacta` / `interpolada`), porque un cierre interpolado es evidencia más
//     débil y el informe tiene que poder separarlas en vez de mezclarlas en una media que nadie pidió.
// Y un límite: fuera de 3 puntos de distancia no se interpola. A esa distancia ya no es la misma apuesta.
const CLOSE_MAX_GAP = 3;

function closeOddsFor(pk, closes) {
  const c = closes && closes.closes && closes.closes[pk.event_id];
  if (!c || !c.rows) return null;
  const mismaApuesta = (r) => r.family === pk.family && r.side === pk.side
    && (r.map || null) === (pk.map || null) && (r.team || null) === (pk.team || null);

  const exactas = c.rows.filter((r) => mismaApuesta(r)
    && (r.line == null ? null : +r.line) === (pk.line == null ? null : +pk.line));
  const mejor = (rows) => {
    const mine = rows.filter((r) => r.book === pk.book);
    const pool = mine.length ? mine : rows;
    return pool.reduce((mx, r) => (r.odds > (mx ? mx.odds : 0) ? r : mx), null);
  };
  if (exactas.length) {
    const r = mejor(exactas);
    return r && r.odds ? { odds: r.odds, src: 'exacta', pre_min: r.pre_min ?? null } : null;
  }

  // ── sin línea exacta: la escalera de la misma casa ──────────────────────────────────────────
  if (pk.line == null) return null;
  const mia = +pk.line;
  const escalera = c.rows.filter((r) => mismaApuesta(r) && r.line != null && r.odds > 1
    && r.book === pk.book && Math.abs(+r.line - mia) <= CLOSE_MAX_GAP);
  if (escalera.length < 2) return null;
  const pts = escalera.map((r) => ({ x: +r.line, p: 1 / r.odds })).sort((a, b) => a.x - b.x);
  const abajo = [...pts].reverse().find((q) => q.x <= mia);
  const arriba = pts.find((q) => q.x >= mia);
  // hacen falta los dos lados: extrapolar fuera de la escalera es inventarse un precio que nunca existió
  if (!abajo || !arriba || abajo.x === arriba.x) return null;
  const t = (mia - abajo.x) / (arriba.x - abajo.x);
  const pInterp = abajo.p + t * (arriba.p - abajo.p);
  if (!(pInterp > 0.01 && pInterp < 0.99)) return null;
  const preMin = escalera.reduce((mn, r) => (r.pre_min != null && (mn == null || r.pre_min < mn) ? r.pre_min : mn), null);
  return { odds: +(1 / pInterp).toFixed(3), src: 'interpolada', pre_min: preMin };
}

const RES = require('../data-providers/esports/results');

async function settlePicks(game, { sinceDays = 4, maxDias = 30 } = {}) {
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
    if (co) { p.close_odds = co.odds; p.close_src = co.src; p.close_pre_min = co.pre_min ?? null; p.clv_pct = +(((p.odds / co.odds) - 1) * 100).toFixed(2); backfilled++; }
  }
  if (backfilled) wr(PICKS_F(game), st);

  const pend = Object.values(st.picks).filter((p) => p.status === 'ACTIVE'
    && p.start_at && Date.parse(p.start_at) < Date.now() - 20 * 60e3);
  if (!pend.length) return { game, settled: 0, pending: 0, clv_backfilled: backfilled };

  // LA VENTANA DE LA FUENTE SE CALCULA DESDE LA PICK PENDIENTE MÁS ANTIGUA (22-ago). Estaba fija en cuatro
  // días, así que una pick cuyo partido se jugó hace cinco NO PODÍA liquidarse nunca: a la fuente no se le
  // preguntaba por ese día. Así se apilaron 90 vencidas en CS2 y 85 en Valorant, y el diagnóstico decía "el
  // par no está en la fuente" —cierto, pero porque nadie lo había pedido—. No era el matcher de nombres.
  // Con tope, para que una pick zombi no obligue a barrer el archivo entero en cada pasada.
  const masVieja = Math.min(...pend.map((p) => Date.parse(p.start_at || 0) || Infinity));
  const diasNec = Number.isFinite(masVieja) ? Math.ceil((Date.now() - masVieja) / 864e5) + 1 : sinceDays;
  const dias = Math.min(maxDias, Math.max(sinceDays, diasNec));
  const since = new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10);
  // Y EL TOPE DE FILAS TIENE QUE CRECER CON LA VENTANA. La fuente ordena por fecha DESCENDENTE: un tope
  // corto recorta justo las MÁS ANTIGUAS, que son las únicas que esta ventana viene a rescatar. Ampliar
  // `since` sin ampliar `max` no habría arreglado nada y habría parecido que el arreglo no servía.
  const maxFilas = Math.min(1500, Math.max(300, dias * 60));
  const rs = await RES.results(game, { since, max: maxFilas }).catch(() => null);
  if (!rs || !rs.available) return { game, settled: 0, pending: pend.length, no_source: true, why: (rs && rs.why) || 'sin fuente de resultados' };

  const closes = rd(`closes-${game}.json`);
  const resolve = resolverParaLiquidar(game);
  const key = (n) => {
    if (resolve) { const id = resolve(n); if (id) return 'gp:' + id; }
    return String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  };
  // El resultado se empareja por PAR DE EQUIPOS y ventana de tiempo, y se ORIENTA al local de la pick: si la
  // fuente trae los lados al revés, todo lo que dependa del lado —hándicaps, totales por equipo— se liquida
  // exactamente al revés. Es el mismo cuidado que se puso al fundir las casas, y por el mismo motivo.
  const idx = rs.rows.map((r) => ({ r, ka: key(r.a), kb: key(r.b), t: Date.parse(r.at || 0), dia: !!r.day_only }));
  // LA VENTANA SE AJUSTA A LA PRECISIÓN DE LA FUENTE. ±12 h vale cuando la fuente da la hora real; cuando
  // solo da el día y rellena con un mediodía, una serie a las 00:00 o a las 23:15 se sale por poco y se
  // queda sin liquidar para siempre. Con día-solo se admite ±30 h, que cubre el día entero y el de al lado
  // sin llegar a poder confundirse con otra serie del mismo par: dos enfrentamientos iguales separados por
  // menos de 30 h son, en la práctica, la misma serie.
  const ventana = (x) => (x.dia ? 30 : 12) * 3600e3;

  // ¿DE QUÉ TORNEOS SON LAS QUE NO CASAN? (22-ago) Con la ventana ya arreglada, lo que queda sin casar o es
  // un nombre que no resuelve o un torneo que la fuente NO CUBRE. Son dos arreglos distintos —un alias
  // contra cambiar de proveedor— y agrupando por competición se ve cuál es en un vistazo: si el 90 % sale
  // de tres torneos, no hay nada que arreglar en el matcher.
  const porCompeticion = {};
  const equiposEnFuente = new Set();
  for (const x of idx) { equiposEnFuente.add(x.ka); equiposEnFuente.add(x.kb); }
  let settled = 0, unmatched = 0, unsettleable = 0, voided = 0, caducadas = 0;
  // POR QUÉ NO CASA, NO SOLO CUÁNTAS (21-ago). El resumen decía `unmatched: 82` y ahí se acababa la
  // historia: con ese número no se puede distinguir "la fuente no trae esa serie" de "la trae con otro
  // nombre" de "la trae con otra fecha". Son tres fallos distintos con tres arreglos distintos, y sin
  // saber cuál es hay que adivinar. Valorant llevaba 94 picks abiertas y CERO liquidadas por esto.
  const sinCasar = [];
  for (const pk of pend) {
    const kh = key(pk.home), ka = key(pk.away), t = Date.parse(pk.start_at || 0);
    const hit = idx.find((x) => Math.abs(x.t - t) < ventana(x)
      && ((x.ka === kh && x.kb === ka) || (x.ka === ka && x.kb === kh)));
    if (!hit) {
      // CADUCIDAD (23-ago). Una pick que sigue sin aparecer en la fuente semanas después no va a aparecer
      // nunca: bo3 parsea en ~2 días y descarta el ~19 % de los partidos para siempre, y la ventana más
      // ancha que llegamos a pedir es de 30 días. Pasado ese plazo la pick no está esperando dato, está
      // esperando un dato que no existe, y dejarla ACTIVE para siempre engorda el contador de atascadas y
      // tapa los fallos nuevos — que es exactamente como se perdieron las 94 de Valorant en agosto.
      // Se cierra VOID: ni ganada ni perdida, no se pudo saber. Nunca antes de los 21 días.
      if (Date.now() - t > 21 * 864e5) {
        pk.status = 'SETTLED'; pk.result_code = 'VOID'; pk.units = 0;
        pk.settled_at = new Date().toISOString(); pk.result_source = 'caducidad';
        pk.unsettleable_why = 'la fuente nunca publicó este partido: 21 días sin aparecer';
        caducadas++; continue;
      }
      unmatched++;
      const comp = pk.competition || '(sin competición)';
      porCompeticion[comp] = (porCompeticion[comp] || 0) + 1;
      if (sinCasar.length < 12) {
        // ¿existe el par en la fuente aunque sea fuera de la ventana de tiempo? Eso separa un problema de
        // NOMBRE (no aparece nunca) de uno de FECHA (aparece, pero con otra hora).
        const porNombre = idx.find((x) => (x.ka === kh && x.kb === ka) || (x.ka === ka && x.kb === kh));
        sinCasar.push({
          serie: `${pk.home} vs ${pk.away}`, start_at: pk.start_at,
          clave_local: kh, clave_visita: ka,
          competicion: pk.competition || null,
          // cada lado por separado: si NINGUNO de los dos equipos aparece en la fuente, no es un alias —
          // es que la fuente no cubre ese torneo, y ahí el matcher no tiene nada que hacer
          local_en_fuente: equiposEnFuente.has(kh), visita_en_fuente: equiposEnFuente.has(ka),
          en_la_fuente_por_nombre: !!porNombre,
          fuente_at: porNombre ? new Date(porNombre.t).toISOString() : null,
          horas_de_diferencia: porNombre ? +(Math.abs(porNombre.t - t) / 3600e3).toFixed(1) : null,
          diagnostico: porNombre ? 'el par SÍ está en la fuente: falla la ventana de tiempo'
            : 'el par NO está en la fuente con esas claves: o no la cubre, o los nombres no resuelven igual',
        });
      }
      continue;
    }
    const flip = hit.ka !== kh;
    const r = flip
      ? { ...hit.r, a: hit.r.b, b: hit.r.a, maps_a: hit.r.maps_b, maps_b: hit.r.maps_a,
          maps: (hit.r.maps || []).map((m) => ({ ...m, score_a: m.score_b, score_b: m.score_a })) }
      : hit.r;

    // UNA FILA DE PARSEO RECHAZADO SOLO PUEDE ANULAR, NUNCA DECIDIR. Sus nombres salen del slug del partido
    // y el resolutor los acierta a medias: "ence prospects" cae en `gp:ence` y "vitality academy" en
    // `gp:vitality`, o sea la ORGANIZACIÓN en vez de la filial. Con eso, dejar que una de estas filas
    // dictara un WIN/LOSS podría liquidar la pick del primer equipo con el resultado de su academia. Se
    // usan para lo único que son fiables: certificar que de ese partido no va a haber dato.
    if (r.parse_rejected) {
      pk.status = 'SETTLED'; pk.result_code = 'VOID'; pk.units = 0;
      pk.settled_at = new Date().toISOString(); pk.result_source = r.source;
      pk.unsettleable_why = 'la fuente descartó el parseo de este partido: el detalle por mapa no va a existir';
      voided++; continue;
    }
    const verdict = settleOne(pk, r);
    if (!verdict) {
      // LA FUENTE DIJO QUE NO VA A HABER DATO (22-ago). bo3 marca ~19 % de los partidos como `rejected`:
      // no hay demo o no la pudieron leer, y el detalle por mapa no va a existir nunca. Una pick de mapa
      // sobre uno de esos partidos no está esperando dato, está esperando un dato que no existe — y
      // dejarla ACTIVE para siempre engorda el contador de atascadas y tapa los fallos de verdad.
      // Se cierra VOID (cero unidades, sin CLV), que es lo honesto: no se ganó ni se perdió, no se pudo
      // saber. `unsettleable` se reserva ya solo para las que TODAVÍA podrían resolverse.
      unsettleable++; pk.unsettleable_why = 'la fuente no publica el dato de esta familia (o ese mapa no se jugó)'; continue;
    }
    pk.status = 'SETTLED';
    pk.result_code = verdict;
    pk.units = verdict === 'WIN' ? +(pk.odds - 1).toFixed(3) : verdict === 'LOSS' ? -1 : 0;
    pk.final = { maps: `${r.maps_a}-${r.maps_b}`, detail: (r.maps || []).map((m) => `${m.map || 'g' + m.n} ${m.score_a}-${m.score_b}${m.ot ? ' OT' : ''}`).join(' · ') };
    pk.settled_at = new Date().toISOString();
    pk.result_source = r.source;
    const co = closeOddsFor(pk, closes);
    if (co) { pk.close_odds = co.odds; pk.close_src = co.src; pk.close_pre_min = co.pre_min ?? null; pk.clv_pct = +(((pk.odds / co.odds) - 1) * 100).toFixed(2); }
    settled++;
  }
  st.at = new Date().toISOString();
  const fechas = idx.map((x) => x.t).filter(Boolean).sort((a, b) => a - b);
  const resumen = { at: st.at, settled, unmatched, unsettleable, anuladas_sin_parseo: voided, caducadas, pending: pend.length, source: rs.source, resolver: !!resolve,
    // el estado de la FUENTE va en el mismo parte: sin esto no se sabe si el problema es nuestro o suyo
    // la ventana pedida viaja en el parte: sin esto, un `fuente_desde` corto no distingue "la fuente no
    // tiene más" de "no se le pidió más", que es exactamente el fallo que esto viene a cerrar
    ventana_dias: dias, ventana_desde: since, tope_filas: maxFilas,
    fuente_filas: idx.length,
    fuente_desde: fechas.length ? new Date(fechas[0]).toISOString().slice(0, 10) : null,
    fuente_hasta: fechas.length ? new Date(fechas[fechas.length - 1]).toISOString().slice(0, 10) : null,
    sin_casar: sinCasar,
    sin_casar_por_competicion: Object.fromEntries(Object.entries(porCompeticion).sort((a, b) => b[1] - a[1]).slice(0, 15)) };
  st.last_settle = resumen;   // queda guardado para que la sonda pueda contar el cero sin volver a liquidar
  wr(PICKS_F(game), st);
  // EL PARTE QUE SE GUARDA Y EL QUE SE DEVUELVE TIENEN QUE SER EL MISMO. Eran dos objetos distintos: el
  // diagnóstico nuevo se escribía en disco y NO salía por la respuesta, así que disparar la liquidación a
  // mano —que es justo cuando quieres verlo— devolvía el parte viejo sin los motivos.
  return { game, ...resumen, clv_backfilled: backfilled,
    // POR QUÉ SE LIQUIDÓ CERO. Un cero sin motivo no se puede revisar el lunes, y este deporte ya tuvo
    // doce picks vencidas sin liquidar durante días sin que nada lo dijera.
    why: (settled || voided || caducadas) ? null
      : unmatched === pend.length ? `las ${pend.length} vencidas no encuentran su partido en ${rs.source}: o la fuente no lo publica todavía, o los nombres no resuelven al mismo equipo`
        : unsettleable ? `${unsettleable} vencidas emparejadas pero sin el dato que su familia necesita en ${rs.source}`
          : null,
    resolver: !!resolve };
}

// El cuadro de rendimiento del deporte. Se publica el CLV SEPARADO del ROI y por delante, porque con
// muestras pequeñas el ROI es ruido y el CLV ya tiene señal — es la lección que dejó baloncesto.
// POR QUÉ UNA PICK LIQUIDADA SE QUEDÓ SIN CLV, contado caso por caso. El agregado ("165 sin línea
// exacta") no permite arreglar nada: no distingue "la casa no publica escalera" de "el nombre del lado no
// casa" de "la escalera existe pero solo por un lado". Cada una se arregla de forma distinta, así que el
// diagnóstico tiene que decir cuál es.
// QUÉ HAY DENTRO DEL ARCHIVO DE CIERRES. Sin esto, comprobar si la fusión funciona exige esperar a que
// una pick nueva se liquide —días— cuando la pregunta se contesta mirando el archivo.
function closesBoard(game, { limit = 6 } = {}) {
  const st = rd(`closes-${game}.json`);
  const evs = Object.values((st && st.closes) || {});
  evs.sort((a, b) => String(b.start_at || '').localeCompare(String(a.start_at || '')));
  const famGlobal = {};
  for (const e of evs) for (const f of new Set((e.rows || []).map((r) => r.family))) famGlobal[f] = (famGlobal[f] || 0) + 1;
  return {
    game, eventos: evs.length, at: (st && st.at) || null,
    eventos_con_familia: famGlobal,
    recientes: evs.slice(0, limit).map((e) => ({
      id: e.id, start_at: e.start_at, moves: e.moves || 1, filas: (e.rows || []).length,
      familias: [...new Set((e.rows || []).map((r) => r.family))],
      casas: [...new Set((e.rows || []).map((r) => r.book))],
      // cuántas filas llevan ya la marca temporal nueva y a qué distancia del inicio se vieron
      con_pre_min: (e.rows || []).filter((r) => r.pre_min != null).length,
      pre_min_rango: (() => { const v = (e.rows || []).map((r) => r.pre_min).filter((x) => x != null);
        return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null; })(),
    })),
  };
}

function clvWhy(game, { limit = 12 } = {}) {
  const st = rd(PICKS_F(game));
  const closes = rd(`closes-${game}.json`);
  const all = st && st.picks ? Object.values(st.picks) : [];
  const sin = all.filter((p) => p.status === 'SETTLED' && p.clv_pct == null);
  const motivos = {}; const muestra = [];
  for (const pk of sin) {
    const c = closes && closes.closes && closes.closes[pk.event_id];
    let why, det = null;
    if (!c || !c.rows) why = 'sin_cierre_del_evento';
    else {
      const fam = c.rows.filter((r) => r.family === pk.family);
      const misma = fam.filter((r) => r.side === pk.side && (r.map || null) === (pk.map || null)
        && (r.team || null) === (pk.team || null));
      const miCasa = misma.filter((r) => r.book === pk.book);
      if (!fam.length) { why = 'cierre_sin_esa_familia'; det = { familias: [...new Set(c.rows.map((r) => r.family))].slice(0, 12) }; }
      else if (!misma.length) { why = 'cierre_sin_ese_lado'; det = { pick: { side: pk.side, map: pk.map || null, team: pk.team || null },
        cierre: fam.slice(0, 8).map((r) => ({ book: r.book, side: r.side, map: r.map || null, team: r.team || null, line: r.line })) }; }
      else if (!miCasa.length) { why = 'cierre_sin_mi_casa'; det = { mi_casa: pk.book, casas: [...new Set(misma.map((r) => r.book))] }; }
      else {
        const lineas = [...new Set(miCasa.map((r) => (r.line == null ? null : +r.line)))].sort((a, b) => a - b);
        const mia = pk.line == null ? null : +pk.line;
        const cerca = lineas.filter((x) => x != null && mia != null && Math.abs(x - mia) <= CLOSE_MAX_GAP);
        if (lineas.length === 1) { why = 'la_casa_publica_una_sola_linea'; det = { mi_linea: mia, cierre: lineas }; }
        else if (cerca.length < 2) { why = 'escalera_lejos_de_mi_linea'; det = { mi_linea: mia, cierre: lineas }; }
        else if (!(cerca.some((x) => x <= mia) && cerca.some((x) => x >= mia))) { why = 'mi_linea_fuera_de_la_escalera'; det = { mi_linea: mia, cierre: lineas }; }
        else { why = 'deberia_haber_interpolado'; det = { mi_linea: mia, cierre: lineas }; }
      }
    }
    motivos[why] = (motivos[why] || 0) + 1;
    if (muestra.length < limit) muestra.push({ pick_id: pk.pick_id, family: pk.family, book: pk.book, line: pk.line ?? null, why, det });
  }
  return { game, settled_sin_clv: sin.length, motivos, muestra };
}

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
  // DE DÓNDE SALIÓ CADA CIERRE. Un CLV interpolado sobre la escalera es evidencia más débil que uno con
  // la línea exacta. Mezclarlos en una sola media sin decirlo sería justo lo que esta casa le reprocha a
  // las demás, así que el recuento viaja al lado del número.
  const srcCount = (rows) => rows.reduce((a, p) => {
    const k = p.close_src || (p.clv_pct != null ? "exacta" : null);
    if (k) a[k] = (a[k] || 0) + 1;
    return a;
  }, {});
  const byFam = {};
  // POR FAMILIA **Y CASA**: aquí se vio por primera vez que el hándicap de rondas daba +3,53 % en la casa
  // afilada y −3,13 % en la única conectable por API. El promedio entre casas no informa, desinforma.
  const byFB = {};
  for (const p of settled) {
    const f = p.family || '?';
    byFam[f] = byFam[f] || { n: 0, w: 0, units: 0, clv: [], rows: [] };
    byFam[f].n++; if (p.result_code === 'WIN') byFam[f].w++;
    byFam[f].units += p.units || 0;
    if (p.clv_pct != null) { byFam[f].clv.push(p.clv_pct); byFam[f].rows.push(p); }
    const bk = p.book || 'sin_casa';
    const k2 = f + ' · ' + bk;
    byFB[k2] = byFB[k2] || { n: 0, w: 0, units: 0, clv: [], family: f, book: bk };
    byFB[k2].n++; if (p.result_code === 'WIN') byFB[k2].w++;
    byFB[k2].units += p.units || 0;
    if (p.clv_pct != null) byFB[k2].clv.push(p.clv_pct);
  }
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
  // dispersión del CLV: la media sola no se puede juzgar. El tablero de familias la usa para el estadístico.
  const sdOf = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length;
    return +Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)).toFixed(2); };
  return {
    game,
    // lo que dejó dicho la última pasada del liquidador, para que un cero se pueda leer sin repetirla
    last_settle: (st && st.last_settle) || null,
    total: all.length, active: all.filter((p) => p.status === 'ACTIVE').length,
    settled: settled.length, w, l, push,
    units: +units.toFixed(2),
    roi_pct: staked ? +(100 * units / staked).toFixed(2) : null,
    hit_pct: (w + l) ? +(100 * w / (w + l)).toFixed(1) : null,
    clv_avg_pct: avg(clvs), clv_n: clvs.length,
    clv_src: srcCount(settled.filter((p) => p.clv_pct != null)),
    // A CUÁNTOS MINUTOS DEL INICIO SE OBSERVÓ EL PRECIO QUE LLAMAMOS CIERRE. Con la fusión de cierres, una
    // familia que la casa deja de cotizar conserva su última observación, y esa puede ser de horas antes.
    // Sigue siendo el mejor precio que existe, pero no es un cierre, y el número tiene que decirlo solo.
    clv_lag: (() => {
      const v = settled.filter((p) => p.clv_pct != null && p.close_pre_min != null).map((p) => p.close_pre_min).sort((a, b) => a - b);
      if (!v.length) return null;
      return { n: v.length, p50_min: v[Math.floor(v.length / 2)],
        hasta_60min: v.filter((x) => x <= 60).length, mas_de_180min: v.filter((x) => x > 180).length };
    })(),
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, v]) => [k,
      { n: v.n, hit_pct: v.n ? +(100 * v.w / v.n).toFixed(1) : null, units: +v.units.toFixed(2),
        clv_avg_pct: avg(v.clv), clv_n: v.clv.length, clv_sd: sdOf(v.clv), clv_src: srcCount(v.rows) }])),
    by_family_book: Object.fromEntries(Object.entries(byFB).map(([k, v]) => [k,
      { family: v.family, book: v.book, n: v.n, hit_pct: v.n ? +(100 * v.w / v.n).toFixed(1) : null,
        units: +v.units.toFixed(2), clv_avg_pct: avg(v.clv), clv_n: v.clv.length, clv_sd: sdOf(v.clv) }])),
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
    // `open` está recortada a 20 para la pantalla, así que CONTAR sobre ella miente por abajo. Estas dos
    // van sobre todas: `open_n` cuántas hay de verdad y `open_vencidas` cuántas llevan más de 6 h con el
    // partido ya jugado — que es la única cifra que distingue "aún no se juega" de "el liquidador está
    // roto". Contar sobre una lista recortada fue exactamente el error que la sonda de liquidación cometió
    // la primera vez que se ejecutó: los cuatro juegos daban 20 clavado, que es el tope, no el dato.
    open_n: all.filter((p) => p.status === 'ACTIVE').length,
    open_vencidas: all.filter((p) => p.status === 'ACTIVE' && p.start_at
      && Date.now() - Date.parse(p.start_at) > 6 * 3600e3).length,
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
  if (game === 'valorant') { try { const VD = require('./valorant-data'); return VD.load().available ? VD : null; } catch { return null; } }
  if (game === 'dota2') { try { const DD = require('./dota2-data'); return DD.load().available ? DD : null; } catch { return null; } }
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
    // la procedencia dice la verdad POR JUEGO: CS2 salió de bo3.gg; LoL de Leaguepedia (CC BY-SA exige
    // atribución donde se enseñe el dato); Valorant de vlr.gg (research_only, RIGHTS.md)
    provenance: C.provenance(game === 'lol'
      ? [{ source: 'Base propia de GP, derivada de Leaguepedia (CC BY-SA 4.0) y validada walk-forward', kind: 'derivado', at: data.at },
        { source: 'Rating GP de jugadores: propio, del scoreboard por partida (media del rol = 1.00)', kind: 'derivado', at: data.at }]
      : game === 'valorant'
        ? [{ source: 'Base propia de GP, derivada de vlr.gg y validada walk-forward', kind: 'derivado', at: data.at },
          { source: 'Rating GP de jugadores: propio, del scoreboard por mapa (media de la clase = 1.00)', kind: 'derivado', at: data.at }]
        : game === 'dota2'
          ? [{ source: 'Base propia de GP, derivada de OpenDota y validada walk-forward', kind: 'derivado', at: data.at },
            { source: 'Rating GP de jugadores: propio, por posición 1-5 inferida del oro (media de la posición = 1.00)', kind: 'derivado', at: data.at }]
          : [{ source: 'Base propia de GP (bo3.gg cosechado y validado)', kind: 'derivado', at: data.at },
            { source: 'Rating de jugadores: del proveedor (6 meses), no de GP', kind: 'proveedor', at: data.at }]),
    at: data.at,
  };
}

function playersDirectory(game, { q = '', limit = 80 } = {}) {
  const CD = cdOf(game); if (!CD) return noCatalog(game);
  const data = CD.load();
  const all = Object.values(data.players || {});
  if (!all.length) return { game, available: false, why: 'el directorio de jugadores todavía no se ha derivado (corre con la cosecha de plantillas).' };
  const needle = CD.norm(q);
  // Dota 2 habla en KP/KDA/GPM por POSICIÓN (1-5, inferida del oro): rama propia con sus columnas
  if (game === 'dota2') {
    const rows = all
      .filter((p) => !needle || CD.norm(p.nick).indexOf(needle) >= 0 || CD.norm(p.team_name || '').indexOf(needle) >= 0)
      .map((p) => {
        const st = data.playerStats[p.id] || null;
        return { id: p.id, nick: p.nick, role: p.role, team: p.team, team_name: p.team_name,
          rating_gp: st ? st.rating_gp : null, games_n: st ? st.n : null, wr: st ? st.wr : null,
          kda: st ? st.kda : null, kp: st ? st.kp : null, gpm: st ? st.gpm : null };
      })
      .sort((a, b) => (b.rating_gp || 0) - (a.rating_gp || 0) || (b.games_n || 0) - (a.games_n || 0))
      .slice(0, Math.max(1, Math.min(300, limit)));
    return { game, available: true, dota: true, players: rows, total: all.length,
      own_stats: data.playerStatsMeta || null,
      rating_note: 'Rating GP propio por posición 1-5 (media de la posición = 1.00), derivado del rendimiento medido en la base propia. Datos derivados de OpenDota.',
      at: data.at };
  }
  // Valorant habla en ACS/ADR/KAST por CLASE de agente: rama propia con sus columnas
  if (game === 'valorant') {
    const rows = all
      .filter((p) => !needle || CD.norm(p.nick).indexOf(needle) >= 0 || CD.norm(p.team_name || '').indexOf(needle) >= 0)
      .map((p) => {
        const st = data.playerStats[p.id] || null;
        return { id: p.id, nick: p.nick, role: p.role, team: p.team, team_name: p.team_name,
          rating_gp: st ? st.rating_gp : null, games_n: st ? st.n : null, wr: st ? st.wr : null,
          acs: st ? st.acs : null, adr: st ? st.adr : null, kast: st ? st.kast : null, kda: st ? st.kda : null };
      })
      .sort((a, b) => (b.rating_gp || 0) - (a.rating_gp || 0) || (b.games_n || 0) - (a.games_n || 0))
      .slice(0, Math.max(1, Math.min(300, limit)));
    return { game, available: true, valorant: true, players: rows, total: all.length,
      own_stats: data.playerStatsMeta || null,
      rating_note: 'Rating GP propio por clase de agente (media de la clase = 1.00), derivado del rendimiento medido en la base propia. Datos derivados de vlr.gg.',
      at: data.at };
  }
  // LoL habla su idioma (KP/KDA/CSPM por rol), no el de CS2 (ADR/KAST): rama propia con sus columnas
  if (game === 'lol') {
    const rows = all
      .filter((p) => !needle || CD.norm(p.nick).indexOf(needle) >= 0 || CD.norm(p.team_name || '').indexOf(needle) >= 0)
      .map((p) => {
        const st = data.playerStats[p.id] || null;
        return { id: p.id, nick: p.nick, role: p.role, team: p.team, team_name: p.team_name,
          rating_gp: st ? st.rating_gp : null, games_n: st ? st.n : null, wr: st ? st.wr : null,
          kda: st ? st.kda : null, kp: st ? st.kp : null, cspm: st ? st.cspm : null };
      })
      .sort((a, b) => (b.rating_gp || 0) - (a.rating_gp || 0) || (b.games_n || 0) - (a.games_n || 0))
      .slice(0, Math.max(1, Math.min(300, limit)));
    return { game, available: true, lol: true, players: rows, total: all.length,
      own_stats: data.playerStatsMeta || null,
      rating_note: 'Rating GP propio por rol (media del rol = 1.00), derivado del rendimiento medido en la base propia. Datos derivados de Leaguepedia (CC BY-SA 4.0).',
      at: data.at };
  }
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
  // ficha propia de Dota 2: rating por POSICIÓN, pool de héroes con recencia y bitácora. La huella
  // compara contra la población de su posición. Mismo molde texto-first que LoL/Valorant.
  if (game === 'dota2') {
    const pop = Object.values(data.playerStats || {}).filter((x) => x.pos === (st && st.pos));
    const pct = (f, invert = false) => {
      if (!st) return null;
      const mine = f(st); if (mine == null) return null;
      const vals = pop.map(f).filter((v) => v != null);
      const below = vals.filter((v) => (invert ? v > mine : v < mine)).length;
      return { value: +(+mine).toFixed(2), pct: vals.length ? Math.round(100 * below / vals.length) : null };
    };
    return {
      game, available: true, lol: true, dota: true,   // lol:true = molde texto-first; dota diferencia etiquetas
      player: { id, nick: (st && st.nick) || (p && p.nick) || id, role: st ? 'Pos ' + st.pos : (p && p.role) || null,
        team: (st && st.team_id) ? 't' + st.team_id : (p ? p.team : null),
        team_name: (p && p.team_name) || null },
      rating_gp: st ? st.rating_gp : null,
      totals: st ? { n: st.n, wr: st.wr, kda: st.kda, kp: st.kp, gpm: st.gpm, xpm: st.xpm, dpm: st.dpm } : null,
      side_split: null,
      champs: st ? (st.pool || []).slice(0, 8).map((c) => ({ ch: c.name, n: c.n,
        wr: c.n ? +(c.w / c.n).toFixed(2) : null, rw: c.rw, last: c.last ? new Date(c.last * 1000).toISOString().slice(0, 10) : null })) : [],
      recent: (st && st.recent) ? st.recent.map((r) => ({ at: r.at, ch: r.hero, vs: r.vs, k: r.k, d: r.d, a: r.a, win: r.win, side: null })) : [],
      footprint: st ? { role: 'Pos ' + st.pos, pop_n: pop.length, dims: {
        participacion: pct((x) => x.kp), kda: pct((x) => Math.min(8, x.kda)),
        farmeo: pct((x) => x.gpm), muertes: pct((x) => x.dpm, true) } } : null,
      meta: data.playerStatsMeta,
      note: st ? 'Rating GP propio (media de la posición = 1.00), del rendimiento medido en la base propia. Datos derivados de OpenDota.'
        : 'sin muestra propia suficiente en la ventana (≥8 partidas en 365 días).',
      at: data.at,
    };
  }
  // ficha propia de Valorant: rating por CLASE, pool de agentes con recencia y bitácora. La huella
  // compara contra la población de su clase (V-0108). Misma forma que la de LoL para que la UI la
  // renderice con el mismo molde, con sus dimensiones propias.
  if (game === 'valorant') {
    const pop = Object.values(data.playerStats || {}).filter((x) => x.class === (st && st.class));
    const pct = (f, invert = false) => {
      if (!st) return null;
      const mine = f(st); if (mine == null) return null;
      const vals = pop.map(f).filter((v) => v != null);
      const below = vals.filter((v) => (invert ? v > mine : v < mine)).length;
      return { value: +(+mine).toFixed(2), pct: vals.length ? Math.round(100 * below / vals.length) : null };
    };
    return {
      game, available: true, lol: true, valorant: true,   // lol:true = "usa la ficha texto-first"; el detalle diferencia abajo
      player: { id, nick: (st && st.nick) || (p && p.nick) || id, role: (st && st.class) ? String(st.class).replace(/^\w/, (c) => c.toUpperCase()) : (p && p.role) || null,
        team: (st && st.team) ? CD.resolveTeam(st.team, { data }) : (p ? p.team : null),
        team_name: (st && st.team) || (p && p.team_name) || null },
      rating_gp: st ? st.rating_gp : null,
      totals: st ? { n: st.n, wr: st.wr, kda: st.kda, acs: st.acs, adr: st.adr, kast: st.kast, fk_fd: st.fk_fd } : null,
      side_split: null,   // en Valorant los lados se alternan dentro del mapa: no hay reparto por lado de serie
      champs: st ? (st.pool || []).slice(0, 8).map((c) => ({ ch: String(c.agent).replace(/^\w/, (x) => x.toUpperCase()), n: c.n,
        wr: c.n ? +(c.w / c.n).toFixed(2) : null, rw: c.rw, last: c.last ? String(c.last).slice(0, 10) : null })) : [],
      recent: (st && st.recent) ? st.recent.map((r) => ({ at: r.at, ch: String(r.agent || '').replace(/^\w/, (x) => x.toUpperCase()), vs: null, k: r.k, d: r.d, a: r.a, win: r.win, side: null, acs: r.acs })) : [],
      footprint: st ? { role: st.class, pop_n: pop.length, dims: {
        acs: pct((x) => x.acs), dano: pct((x) => x.adr), consistencia: pct((x) => x.kast),
        apertura: pct((x) => x.fk_fd) } } : null,
      meta: data.playerStatsMeta,
      note: st ? 'Rating GP propio (media de la clase = 1.00), del rendimiento medido en la base propia. Datos derivados de vlr.gg.'
        : 'sin muestra propia suficiente en la ventana (≥8 mapas en 365 días).',
      at: data.at,
    };
  }
  // ficha propia de LoL: rating por rol, reparto por lado, pool de campeones con recencia y bitácora.
  // La huella compara contra la POBLACIÓN DE SU ROL (LOL-0007), no contra todo el circuito.
  if (game === 'lol') {
    const pop = Object.values(data.playerStats || {}).filter((x) => x.role === (st && st.role));
    const pct = (f, invert = false) => {
      if (!st) return null;
      const mine = f(st); if (mine == null) return null;
      const vals = pop.map(f).filter((v) => v != null);
      const below = vals.filter((v) => (invert ? v > mine : v < mine)).length;
      return { value: +(+mine).toFixed(2), pct: vals.length ? Math.round(100 * below / vals.length) : null };
    };
    return {
      game, available: true, lol: true,
      player: { id, nick: (st && st.nick) || (p && p.nick) || id, role: (st && st.role) || (p && p.role) || null,
        team: (st && st.team) ? CD.resolveTeam(st.team, { data }) : (p ? p.team : null),
        team_name: (st && st.team) || (p && p.team_name) || null },
      rating_gp: st ? st.rating_gp : null,
      totals: st ? { n: st.n, wr: st.wr, kda: st.kda, kp: st.kp, cspm: st.cspm, gpm: st.gpm, dpg: st.dpg } : null,
      side_split: st ? st.side_split : null,
      champs: st ? (st.champs || []).slice(0, 8).map((c) => ({ ch: c.ch, n: c.n,
        wr: c.n ? +(c.w / c.n).toFixed(2) : null, rw: c.rw, last: c.last ? String(c.last).slice(0, 10) : null })) : [],
      recent: (st && st.recent) ? st.recent.slice().reverse() : [],
      footprint: st ? { role: st.role, pop_n: pop.length, dims: {
        participacion: pct((x) => x.kp), kda: pct((x) => Math.min(8, x.kda)),
        farmeo: pct((x) => x.cspm), muertes: pct((x) => x.dpg, true) } } : null,
      meta: data.playerStatsMeta,
      note: st ? 'Rating GP propio (media del rol = 1.00), del rendimiento medido en la base propia. Datos derivados de Leaguepedia (CC BY-SA 4.0).'
        : 'sin muestra propia suficiente en la ventana (≥8 partidas en 365 días).',
      at: data.at,
    };
  }
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
    note: st ? 'Rating GP propio (media del circuito = 1.00); el del proveedor (0-10) viaja al lado. Todo sale del scoreboard real de la ventana.'
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

// ---- TORNEOS: LA COMPETICIÓN COMO UNIDAD, NO EL PARTIDO SUELTO -------------------------------------------
// Pedido de Alexis (19-ago): "vamos a agregar alguna sección tipo bracket o grupo o evolución para los
// torneos". Aquí hay que ser honesto con lo que se tiene y con lo que no:
//
//   · Un BRACKET oficial no se puede pintar. Ninguna de las tres casas publica la estructura del cuadro
//     —quién sale de cada llave, quién espera en semifinales— y dibujar un cuadro inventado a partir del
//     calendario sería exactamente el tipo de dato falso que esta casa no publica.
//   · Una EVOLUCIÓN de rating tampoco, todavía: la foto semanal del ranking empezó a guardarse hace una
//     semana, así que hoy hay UN punto. Dentro de un mes será una curva; hoy sería una línea recta con
//     pinta de dato.
//   · Lo que SÍ se tiene es el GRUPO: qué equipos hay en cada torneo, cómo llegan según la base propia
//     —rating, forma reciente— y qué se juega cuándo. Eso es lo que se publica.
//
// La agenda sale del proveedor y el rating y la forma de la base propia de GP. Un equipo que la base no
// reconoce aparece igual, con su hueco declarado: media plantilla de los torneos menores no está en el
// ranking, y esconderlos daría un torneo con cuatro equipos.
function tournamentsBoard(game, { days = 14 } = {}) {
  const CD = cdOf(game);
  const rank = (() => { try { return rankingBoard(game); } catch { return null; } })();
  const porId = new Map(((rank && rank.rows) || []).map((r) => [r.id, r]));
  const data = (() => { try { return CD ? CD.load() : null; } catch { return null; } })();
  const idDe = (nombre) => { try { return (CD && data) ? CD.resolveTeam(nombre, { data }) : null; } catch { return null; } };

  return (async () => {
    const s = await slate(game, { days }).catch(() => null);
    const evs = (s && s.events) || [];
    // CADA CASA NOMBRA EL TORNEO A SU MANERA y sin normalizar salen duplicados que parecen torneos distintos:
    // "United21" y "United 21", "ESL Challenger League Europe" y "CS2 - ESL Challenger League Europe". Se
    // agrupa por una clave sin el prefijo del juego, sin espacios y sin acentos, y se enseña el nombre más
    // largo de los que llegaron —que suele ser el completo.
    const claveComp = (x) => String(x || 'Sin competición')
      .replace(/^\s*(cs\s*2|cs:?go|lol|league of legends|valorant|dota\s*2)\s*[-–:·|]\s*/i, '')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const nombreComp = (x) => String(x || 'Sin competición')
      .replace(/^\s*(CS\s*2|CS:?GO|LoL|League of Legends|Valorant|Dota\s*2)\s*[-–:·|]\s*/i, '').trim() || 'Sin competición';
    const comps = new Map();
    for (const ev of evs) {
      const k = claveComp(ev.competition);
      const nombre = nombreComp(ev.competition);
      if (!comps.has(k)) comps.set(k, { competition: nombre, matches: [], teams: new Map() });
      const C = comps.get(k);
      if (nombre.length > C.competition.length) C.competition = nombre;
      C.matches.push({ id: ev.id, start_at: ev.start_at, bo: ev.bo || null,
        home: ev.home, away: ev.away, books: (ev.sources || []).length,
        live: !!ev.start_at && Date.parse(ev.start_at) <= Date.now() });
      for (const t of [ev.home, ev.away]) {
        if (C.teams.has(t.name)) continue;
        const id = idDe(t.name);
        const r = id ? porId.get(id) : null;
        C.teams.set(t.name, {
          name: t.name, id: id || null, logo: t.logo || (r && r.logo) || null,
          rank: r ? r.rank : null, elo: r ? r.elo : null, wr: r ? r.wr : null, n: r ? r.n : null,
          form: r ? r.form : null,
          // el hueco, dicho: en los circuitos menores la mitad de los equipos no llega al mínimo de mapas
          why_no_rank: r ? null : (id ? 'en la base pero sin mapas suficientes para entrar al ranking'
            : 'la base propia no reconoce a este equipo todavía'),
        });
      }
    }
    const rows = [...comps.values()].map((C) => ({
      competition: C.competition,
      matches: C.matches.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at))),
      teams: [...C.teams.values()].sort((a, b) => (b.elo || 0) - (a.elo || 0)),
      n_matches: C.matches.length, n_teams: C.teams.size,
      ranked: [...C.teams.values()].filter((t) => t.rank).length,
      starts: C.matches.length ? C.matches[0].start_at : null,
      ends: C.matches.length ? C.matches[C.matches.length - 1].start_at : null,
    })).sort((a, b) => (b.n_matches - a.n_matches) || String(a.starts).localeCompare(String(b.starts)));
    return {
      game, available: rows.length > 0, days, rows,
      rating_at: rank && rank.at ? rank.at : null,
      why: rows.length ? null : `el proveedor no lista partidas de ${game} en los próximos ${days} días`,
      note: 'la agenda sale de las casas; el rating y la forma, de la base propia de GP. No hay cuadro oficial: ' +
        'ninguna casa publica la estructura de llaves, y dibujar uno a partir del calendario sería inventarlo.',
      at: new Date().toISOString(),
    };
  })();
}

function championsBoard(game, { role = null } = {}) {
  // el meta de "unidades" del juego — campeones en LoL (por parche), agentes en Valorant (por ventana de
  // 90 días, porque la fuente no publica el parche). El contrato es el mismo tablero; cada juego pone su
  // corte temporal y lo declara.
  const CD = cdOf(game); if (!CD || typeof CD.championsBoard !== 'function') {
    return { game, available: false, why: 'este juego no tiene tablero de campeones en la base propia.' };
  }
  const out = CD.championsBoard({ role });
  if (!out || !out.available) return { game, available: false, why: 'los agregados todavía no están cargados.' };
  return {
    game, available: true, patch: out.patch || null, prev_patch: out.prev_patch || null,
    games_patch: out.games_patch || null, window: out.window || null, maps_cur: out.maps_cur || null,
    role: role || null, rows: out.rows.slice(0, 60), note: out.note,
    rights_note: game === 'valorant' ? 'Datos derivados de vlr.gg.' : game === 'dota2' ? 'Datos derivados de OpenDota.' : 'Datos derivados de Leaguepedia (CC BY-SA).',
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

// LAS PICKS EN CRUDO, para el ejecutor en la sombra. `track()` devuelve el agregado y `board()` la
// pizarra; el ejecutor necesita la lista tal cual —con su cuota, su casa y las casas que la cotizan—
// para decidir si tiene vía de ejecución. Solo lectura: nadie de fuera escribe aquí.
function picksRaw(game, { status = null } = {}) {
  const st = rd(PICKS_F(game));
  const all = st && st.picks ? Object.values(st.picks) : [];
  return status ? all.filter((p) => p.status === status) : all;
}

module.exports = {
  clvWhy, closesBoard, tournamentsBoard, retireCrossedPicks,
  ENGINES, GAME_ORDER, PICK_FAMILIES, PICK_DOCTRINE, DIR,
  slate, overview, ratings, harvest, snapshot, closesCount, marketEvidence, market, analyzeMatch, board, evaluateAll, probFor, boOf,
  teamSearch, simulate, recordPicks, settlePicks, track, settleOne, picksRaw,
  teamsDirectory, teamProfile, playersDirectory, rankingBoard, circuit, resultsRecent, h2h, playerProfile,
  championsBoard,
};
