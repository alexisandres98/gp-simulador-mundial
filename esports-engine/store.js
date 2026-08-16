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
//   2. **EL RATING PROPIO NACE VACÍO Y CRECE SOLO.** GP no tiene acceso legal a histórico de esports, así
//      que el Elo se construye desde cero con los resultados que el propio proveedor va cerrando
//      (`harvest`). Al principio pesa 0 y toda la probabilidad es del mercado: eso NO es un fallo, es la
//      doctrina de la casa puesta por delante. El peso crece con la muestra y tiene techo.
//   3. **LAS PICKS SOLO SALEN DE FAMILIAS DERIVADAS.** El ganador de serie se calcula, se enseña y se
//      explica, pero NO genera pick. Baloncesto perdió 11,87 % de ROI ahí y combate −8,34 % de CLV. Esa
//      puerta está cerrada por código, no por configuración, y quitarla debería costar un commit con nombre
//      y apellidos.
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./core');
const CB = require('../data-providers/esports/cloudbet');

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
async function slate(game, { days = 7, force = false } = {}) {
  if (!ENGINES[game]) return null;
  const c = G.slate[game];
  if (c && !force && Date.now() - c.at < SLATE_TTL) return c.data;
  const data = await CB.fixtures(game, { days });
  G.slate[game] = { at: Date.now(), data };
  return data;
}

// Panorama de los cuatro juegos: es la pantalla de entrada del deporte y tiene que decir la verdad sobre lo
// que cada título tiene abierto hoy, incluida la asimetría (LoL tiene kills, Valorant y Dota ni precio).
async function overview({ days = 5 } = {}) {
  const games = [];
  for (const g of GAME_ORDER) {
    const E = ENGINES[g];
    const s = await slate(g, { days }).catch(() => null);
    const rt = ratings(g);
    games.push({
      game: g, label: E.GAME.label, short: E.GAME.short,
      unit: E.GAME.unit, default_bo: E.GAME.default_bo,
      native: E.GAME.native, edge_families: E.GAME.edge_families, families: E.GAME.families,
      events: (s && s.events) ? s.events.length : 0,
      competitions: (s && s.competitions) ? s.competitions.length : 0,
      next: (s && s.events && s.events[0]) || null,
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
      own_rating: false,
      why: CB.RESULTS_UNAVAILABLE.why,
      consequence: 'mientras no haya resultados, el ganador de serie es el consenso del mercado sin margen con 0 % de peso propio. La estructura derivada —mapas, rondas, duración y kills— sí es del modelo y no depende del rating.',
      next: CB.RESULTS_UNAVAILABLE.next,
    },
    source: 'Cloudbet (única fuente de esports disponible para GP hoy; The Odds API no publica ni un deporte electrónico)',
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
    const mk = await market(game, ev.provider_id, { force: true }).catch(() => null);
    if (!mk || !mk.markets.length) continue;
    st.closes[ev.id] = {
      id: ev.id, provider_id: ev.provider_id, start_at: ev.start_at,
      home: ev.home, away: ev.away, competition: ev.competition,
      rows: mk.markets.map((r) => ({ family: r.family, line: r.line, side: r.side, period: r.period, map: r.map, team: r.team, odds: r.odds })),
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
  return { game, results_available: false, why: CB.RESULTS_UNAVAILABLE.why, next: CB.RESULTS_UNAVAILABLE.next, closes_saved: snap.saved };
}

// ---- 3) UN PARTIDO -----------------------------------------------------------------------------------------
async function market(game, providerId, { force = false } = {}) {
  const key = game + ':' + providerId;
  const c = G.markets[key];
  if (c && !force && Date.now() - c.at < MARKET_TTL) return c.data;
  const data = await CB.markets(providerId, game).catch(() => null);
  G.markets[key] = { at: Date.now(), data };
  return data;
}

function boOf(mk, fallback) {
  // el formato se deduce del mercado: si hay hándicap de ±2.5 mapas o marcador 3-x, es BO5.
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
  const ev = ((s && s.events) || []).find((e) => e.id === eventId || e.provider_id === String(eventId));
  if (!ev) return null;
  const mk = await market(game, ev.provider_id);
  const bo = boOf(mk, E.GAME.default_bo);
  const rt = ratings(game);
  const a = ev.home.id, b = ev.away.id;
  const sample = Math.min(rt.matches[a] || 0, rt.matches[b] || 0);
  const model = E.analyze({
    market: mk,
    ratings: { elo_a: rt.elo[a], elo_b: rt.elo[b] },
    bo, sample, competition: ev.competition,
  });
  const edges = evaluateAll({ game, model, mk, ev, bo, sample });
  return {
    event: ev, bo, sample,
    rating: { a: C.r2(rt.elo[a] || null), b: C.r2(rt.elo[b] || null), matches_a: rt.matches[a] || 0, matches_b: rt.matches[b] || 0 },
    model,
    market_raw: mk ? { markets: mk.markets, at: mk.at } : null,
    edges,
    provenance: C.provenance([
      { source: 'Cloudbet — agenda', kind: 'proveedor', at: (s && s.at) || null },
      mk ? { source: 'Cloudbet — mercados', kind: 'proveedor', at: mk.at } : null,
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
  const K = model.kills || null, R = model.rounds || null;
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
    // en una misma línea y lado el proveedor puede repetir: nos quedamos con el mejor precio
    const key = [r.family, r.line, r.side, r.period, r.map, r.team].join('|');
    const prev = byKey.get(key);
    if (prev && prev.odds >= r.odds) continue;
    const uncF = uncertaintyFor(r.family, model, unc, books);
    const ev2 = C.evaluateEdge({
      pGp: got.p, odds: r.odds, uncertaintyPp: uncF,
      minEdgePp: 3, family: r.family, marketBooks: Math.max(1, books),
      freshMin: mk && mk.at ? (Date.now() - Date.parse(mk.at)) / 60000 : null,
    });
    const row = { ...ev2, line: r.line, side: r.side, period: r.period, map: r.map, team: r.team,
      uncertainty_pp: uncF, uncertainty_kind: VOLUME_FAMILIES.has(r.family) ? 'perfil de la liga' : 'conocimiento del emparejamiento',
      label: r.family_label, how: got.how, max_stake: r.max_stake };
    byKey.set(key, row);
  }
  for (const v of byKey.values()) out.push(v);
  out.sort((a, b) => (b.pick - a.pick) || (b.edge_pp - a.edge_pp));
  return {
    rows: out,
    picks: out.filter((x) => x.pick),
    no_picks: out.filter((x) => !x.pick),
    families_allowed: [...PICK_FAMILIES],
    excluded: skipped,
    note: out.length ? null : 'la casa no tiene todavía mercados derivados abiertos para este partido; suelen abrir en las horas previas al inicio.',
  };
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
  const BATCH = 4;
  const mkts = new Map();
  for (let i = 0; i < use.length; i += BATCH) {
    const chunk = use.slice(i, i + BATCH);
    const got = await Promise.all(chunk.map((ev) => market(game, ev.provider_id).catch(() => null)));
    chunk.forEach((ev, k) => mkts.set(ev.provider_id, got[k]));
  }

  const items = [];
  for (const ev of use) {
    const mk = mkts.get(ev.provider_id) || null;
    const bo = boOf(mk, E.GAME.default_bo);
    const rt = ratings(game);
    const sample = Math.min(rt.matches[ev.home.id] || 0, rt.matches[ev.away.id] || 0);
    let model = null;
    try {
      model = E.analyze({ market: mk, ratings: { elo_a: rt.elo[ev.home.id], elo_b: rt.elo[ev.away.id] }, bo, sample, competition: ev.competition });
    } catch { model = null; }
    const edges = model ? evaluateAll({ game, model, mk, ev, bo, sample }) : null;
    items.push({
      event: ev, bo,
      p_home: model && model.probability ? model.probability.p : null,
      anchor: model && model.probability ? model.probability.source : null,
      books: model && model.market ? model.market.books : 0,
      markets_n: (mk && mk.markets) ? mk.markets.length : 0,
      picks: edges ? edges.picks.length : 0,
      best: edges && edges.picks.length ? edges.picks[0] : null,
      highlight: highlightOf(game, model),
    });
  }
  return {
    game, label: E.GAME.label, short: E.GAME.short,
    native: E.GAME.native, edge_families: E.GAME.edge_families,
    items,
    shown: use.length, total: evs.length,
    truncated: evs.length > use.length ? evs.length - use.length : 0,
    competitions: (s && s.competitions) || [],
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

function closesCount(game) {
  const st = rd(`closes-${game}.json`);
  return st && st.closes ? Object.keys(st.closes).length : 0;
}

module.exports = {
  ENGINES, GAME_ORDER, PICK_FAMILIES, PICK_DOCTRINE, DIR,
  slate, overview, ratings, harvest, snapshot, closesCount, market, analyzeMatch, board, evaluateAll, probFor, boOf,
};
