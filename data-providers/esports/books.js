// data-providers/esports/books.js — EL MOSTRADOR DE VARIAS CASAS (16-ago).
//
// EL PROBLEMA QUE RESUELVE, DICHO SIN ADORNOS. Hasta hoy esports tenía UNA casa. Con una casa no hay consenso;
// sin consenso no hay forma de distinguir un precio dormido de un precio acertado; y por eso `core.js` le
// cobraba a TODA pick un recargo permanente de 2,5 pp — un impuesto sobre un problema que no se arregla
// subiendo el listón, se arregla trayendo otra casa. Aquí entran tres:
//
//   casa       qué aporta                                                        papel
//   ────────── ───────────────────────────────────────────────────────────────── ───────────────────────────
//   Pinnacle   serie, hándicap y total de mapas, y por mapa: ganador, total de    la REFERENCIA. Su cierre es
//              rondas, hándicap de rondas y total de rondas POR EQUIPO            el baremo del CLV.
//   Bovada     lo anterior menos el total por equipo, más prórroga, par/impar,    la ANCHURA. Familias que
//              kills y marcador exacto                                            nadie más cotiza.
//   Cloudbet   catálogo amplio en LoL (kills) y presencia en los cuatro juegos    la COBERTURA.
//
// LAS TRES COSAS QUE ESTE ARCHIVO HACE Y NINGUNA CASA SUELTA PUEDE HACER:
//   1. CONSENSO — mediana de la implícita entre casas, sin margen. La mediana y no la media: una casa dormida
//      con un precio viejo mueve una media y no mueve una mediana.
//   2. MEJOR PRECIO — la ventaja se cobra contra el precio que de verdad se puede tomar, no contra el promedio.
//   3. ARBITRAJE — cuando el mejor precio de los dos lados suma menos de 1, hay beneficio sin modelo. Esto no
//      depende del motor, así que es la única señal de la casa que sobrevive aunque el modelo esté equivocado.
//
// LO QUE ESTE ARCHIVO **NO** HACE: decidir. Aquí no hay picks ni doctrina. Entra catálogo de tres casas, sale
// catálogo unificado con su procedencia. Quien decide es `esports-engine/store.js`.
'use strict';

const CB = require('./cloudbet');
const PIN = require('./pinnacle');
const BOV = require('./bovada');

// Cada casa se declara con su interfaz mínima: cómo pedir agenda, con qué referencia pedir mercados, y si
// está disponible. Añadir una cuarta casa es añadir una entrada aquí y un archivo al lado — nada más.
const ADAPTERS = [
  {
    key: 'cloudbet', name: 'Cloudbet', sharp: false, mod: CB,
    ref: (e) => e.provider_id,
    ready: () => !!process.env.CLOUDBET_API_KEY,
    why_not: 'falta CLOUDBET_API_KEY',
    role: 'cobertura: es la única de las tres presente en los cuatro juegos y la que trae kills en LoL',
  },
  {
    key: 'pinnacle', name: 'Pinnacle', sharp: true, mod: PIN,
    ref: (e) => e.provider_id,
    ready: () => true,
    role: 'referencia: márgenes bajos y sin limitación de cuentas ganadoras, así que su cierre es el baremo del CLV',
  },
  {
    key: 'bovada', name: 'Bovada', sharp: false, mod: BOV,
    ref: (e) => e.provider_ref || e.provider_id,
    ready: () => true,
    role: 'anchura: aporta prórroga del mapa, par/impar, kills y marcador exacto',
  },
];

// Se puede apagar una casa por entorno sin desplegar código, que es lo que hace falta el día que una empiece
// a devolver basura a las tres de la mañana.
function enabled() {
  const want = String(process.env.GP_ESPORTS_BOOKS || '').trim();
  const list = want ? want.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  return ADAPTERS.filter((a) => (!list || list.includes(a.key)) && a.ready());
}

// ---- 1) IDENTIDAD ENTRE CASAS ---------------------------------------------------------------------------
// EL PROBLEMA REAL: "Ninjas In Pyjamas" (Pinnacle), "Ninjas in Pyjamas" (Bovada) y "NIP" son el mismo equipo,
// y "Spirit" y "Spirit Academy" NO lo son. Emparejar de más es peor que emparejar de menos: juntar dos
// partidos distintos mezcla dos mercados y fabrica un arbitraje que no existe. Así que se empareja por par de
// equipos normalizados **y** por hora de inicio, y ante la duda se dejan separados.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(esports?|gaming|team|club|cs2?|the)\b/g, '').replace(/[^a-z0-9]/g, '');

// Los alias que la normalización no puede adivinar porque no son variantes ortográficas sino nombres cortos
// de marca. Es una lista corta a propósito: cada entrada es una decisión, no una regla.
const ALIAS = {
  nip: 'ninjasinpyjamas', navi: 'natusvincere', na: 'natusvincere', tl: 'liquid',
  vit: 'vitality', g2esports: 'g2', mouz: 'mousesports', faze: 'fazeclan',
  ence: 'ence', big: 'big', og: 'og', tsm: 'tsm',
};
const teamKey = (name, resolve) => {
  if (resolve) { const id = resolve(name); if (id) return 'gp:' + id; }
  const n = norm(name);
  return ALIAS[n] || n;
};
// ±8 horas: un partido puede figurar con hora provisional en una casa y confirmada en otra, pero dos equipos
// no se enfrentan dos veces el mismo día con menos de ocho horas de diferencia.
const NEAR_MS = 8 * 3600e3;
const pairOf = (ev, resolve) => [teamKey(ev.home.name, resolve), teamKey(ev.away.name, resolve)].sort().join('~');

// ---- 2) AGENDA UNIFICADA --------------------------------------------------------------------------------
// Se piden las tres agendas EN PARALELO —son tres proveedores distintos, no hay ráfaga que respetar entre
// ellos— y se funden. Un partido que solo tiene una casa entra igual: media cobertura es mejor que ninguna, y
// la ficha dice cuántas casas lo cotizan para que nadie confunda "una casa" con "consenso".
async function slate(game, { days = 7, resolve = null } = {}) {
  const use = enabled();
  const got = await Promise.all(use.map((a) =>
    a.mod.fixtures(game, { days }).then((r) => ({ a, r })).catch(() => ({ a, r: null }))));

  const merged = [];
  const sources = [];
  for (const { a, r } of got) {
    sources.push({
      book: a.key, name: a.name, sharp: a.sharp, role: a.role,
      available: !!(r && r.available), events: (r && r.events) ? r.events.length : 0,
      competitions: (r && r.competitions) ? r.competitions.length : 0,
    });
    for (const ev of (r && r.events) || []) {
      const pk = pairOf(ev, resolve);
      const t = Date.parse(ev.start_at || 0) || 0;
      const hit = merged.find((m) => m.pair_key === pk && Math.abs(m.t - t) < NEAR_MS);
      const src = { book: a.key, provider_id: ev.provider_id, ref: a.ref(ev),
        start_at: ev.start_at, competition: ev.competition, bo: ev.bo || null,
        // el orden local/visitante NO es el mismo en todas las casas, y eso hay que saberlo antes de fundir
        // precios: un "home" de Bovada puede ser el "away" de Pinnacle. Se guarda el nombre para poder
        // orientar cada fila a la orientación del evento fundido.
        home_name: ev.home.name, away_name: ev.away.name };
      if (hit) {
        hit.sources.push(src);
        if (!hit.competition && ev.competition) hit.competition = ev.competition;
        if (!hit.bo && ev.bo) hit.bo = ev.bo;
        continue;
      }
      merged.push({
        // LA IDENTIDAD DE GP SE MANTIENE. Cuando Cloudbet tiene el partido, su id sigue siendo el id de GP:
        // los cierres ya guardados en disco están indexados por ese id y cambiarlo perdería el histórico que
        // este deporte lleva acumulando desde que existe. Los partidos que Cloudbet no tiene estrenan id.
        id: ev.id, pair_key: pk, t,
        game, competition: ev.competition, start_at: ev.start_at, bo: ev.bo || null,
        home: ev.home, away: ev.away, name: ev.name,
        provider_id: ev.provider_id,           // compatibilidad con el resto del motor
        sources: [src],
      });
    }
  }
  // ── EL ID ES CANÓNICO Y NO DEPENDE DE QUÉ CASAS CONTESTARON ──────────────────────────────────────────
  // ESTO SE REESCRIBIÓ POR UN FALLO QUE TARDÓ UN DÍA EN VERSE Y QUE HABRÍA ENVENENADO EL HISTÓRICO ENTERO.
  // La primera versión usaba el id derivado de Cloudbet cuando Cloudbet tenía el partido, y el de otra casa
  // cuando no. Consecuencia: **el mismo partido cambiaba de id entre pasadas** —según qué casa respondiera
  // esa vez, o según qué nombre de equipo hubiera ganado la fusión ("paiN Academy" contra "paiN Gaming
  // Academy")—. Con eso:
  //   · el cierre guardado bajo un id no se encontraba al liquidar una pick nacida bajo otro → CLV SIEMPRE
  //     NULO, que es justo la métrica que esta casa dice que manda;
  //   · la misma pick se guardaba dos veces con dos ids distintos, inflando la muestra con duplicados.
  // El id pasa a salir de la IDENTIDAD RESUELTA del par (la base propia de GP, no el nombre que use la casa)
  // más la fecha. Con eso el mismo partido es el mismo partido aunque hoy lo cotice una casa y mañana tres.
  for (const m of merged) {
    const cb = m.sources.find((s) => s.book === 'cloudbet');
    if (cb) m.provider_id = cb.provider_id;
    // La hora del evento es la MÁS TEMPRANA de las casas, no la de la que respondiera primero. Dos motivos y
    // los dos son de correctitud, no de estética: (1) el id lleva la fecha, y si una casa falta en una pasada
    // la hora podía moverse lo justo para cruzar la medianoche UTC y cambiar el id del mismo partido;
    // (2) la liquidación empareja por ventana de tiempo, así que una hora que baila es una pick que no
    // encuentra su resultado.
    const ts = m.sources.map((s) => Date.parse(s.start_at || 0)).filter(Boolean);
    if (ts.length) m.start_at = new Date(Math.min(...ts)).toISOString();
    m.id = canonicalId(game, m.pair_key, m.start_at);
    m.books = m.sources.length;
    delete m.t;
  }
  merged.sort((a, b) => Date.parse(a.start_at || 0) - Date.parse(b.start_at || 0));
  return {
    game, events: merged, sources,
    books: sources.filter((s) => s.available).length,
    competitions: dedupComps(got),
    available: sources.some((s) => s.available),
    at: new Date().toISOString(),
  };
}
const slugName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// `pair_key` ya viene de la identidad RESUELTA contra la base propia (`gp:<id>`), así que dos casas que
// escriben el nombre distinto producen la misma clave. La fecha va en UTC y sin hora: una casa puede mover
// el inicio veinte minutos y eso no puede cambiar de qué partido estamos hablando.
function canonicalId(game, pairKey, startAt) {
  const pair = String(pairKey || '').replace(new RegExp('^' + game + ':'), '').replace(/gp:/g, '');
  return `${game}:${String(startAt || '').slice(0, 10)}:${pair}`;
}
function dedupComps(got) {
  const m = new Map();
  for (const { r } of got) for (const c of (r && r.competitions) || []) if (c && c.name) m.set(c.name, c);
  return [...m.values()];
}

// ---- 3) MERCADOS DE LAS TRES CASAS, ORIENTADOS AL MISMO LOCAL --------------------------------------------
// LA TRAMPA QUE HAY QUE EVITAR AQUÍ ES LA MÁS CARA DE TODAS: cada casa elige a quién llama "local", y no
// siempre coinciden. Fundir un `home` de una casa con un `home` de otra sin comprobarlo mezcla los dos lados
// del mismo mercado, y el resultado no es un error visible sino un consenso plausible y equivocado —y, peor,
// un "arbitraje" del 15 % que en realidad es la misma apuesta dos veces. Así que cada fila se REORIENTA a la
// orientación del evento fundido antes de entrar: si la casa tenía los lados al revés, se le da la vuelta al
// lado y se le cambia el signo a la línea (que por convención es siempre la del local).
const FLIP_SIDE = { home: 'away', away: 'home' };
const SIDED = new Set(['HANDICAP', 'RONDAS_HANDICAP', 'KILLS_HANDICAP']);

function orient(rows, flip) {
  if (!flip) return rows;
  return rows.map((r) => {
    const o = { ...r };
    if (FLIP_SIDE[r.side]) o.side = FLIP_SIDE[r.side];
    if (r.team && FLIP_SIDE[r.team]) o.team = FLIP_SIDE[r.team];
    // marcador exacto "2:1" visto del otro lado es "1:2"
    if (r.family === 'MARCADOR' && /^\d+:\d+$/.test(String(r.side))) o.side = String(r.side).split(':').reverse().join(':');
    if (r.line != null && (SIDED.has(r.family) || r.family === 'RONDAS_EQUIPO')) {
      // el hándicap está medido desde el local: cambiar de local le cambia el signo. Un total NO cambia.
      if (SIDED.has(r.family)) o.line = -r.line;
    }
    o.flipped = true;
    return o;
  });
}

async function markets(game, mergedEvent, { only = null } = {}) {
  const use = enabled().filter((a) => !only || only.includes(a.key));
  const mine = (mergedEvent.sources || []).filter((s) => use.some((a) => a.key === s.book));
  const homeKey = teamKey(mergedEvent.home.name);
  const got = await Promise.all(mine.map(async (s) => {
    const a = ADAPTERS.find((x) => x.key === s.book);
    try {
      const r = await a.mod.markets(s.ref, game);
      if (!r) return { book: s.book, rows: [], at: null, error: 'sin respuesta' };
      // ¿esta casa tiene el mismo local que el evento fundido?
      const flip = teamKey(s.home_name) !== homeKey;
      return { book: s.book, rows: orient(r.markets || [], flip), at: r.at, flipped: flip,
        disabled: r.disabled_selections || 0 };
    } catch (e) { return { book: s.book, rows: [], at: null, error: String((e && e.message) || e) }; }
  }));

  // ── SEGUNDA PASADA: LA ORIENTACIÓN SE DECIDE POR PRECIO, PORQUE POR NOMBRE YA FALLÓ ──────────────────
  // El 19-ago apareció un "arbitraje" del +269 % en CS2. No era una casa despistada: dos casas tenían
  // invertidos el local y el visitante y la comprobación por nombre —comparar el nombre del local de la casa
  // con el del evento fundido— no lo detectó. Con los lados cruzados, `crossBook` funde el local de una con
  // el visitante de la otra: las dos filas son EL MISMO LADO, sumar sus mejores precios da un número
  // precioso y falso, y —mucho peor que el arbitraje— el CONSENSO que ancla al modelo sale de la mediana de
  // las dos orientaciones, o sea 50/50 en un partido de 94/6. Eso no rompe nada visiblemente: fabrica
  // ventaja enorme en todas las familias y la pick sale con toda naturalidad.
  //
  // El nombre es un dato del proveedor y puede venir mal, tarde o distinto. El PRECIO no miente: si tras
  // darle la vuelta a una casa su favorito coincide con el de las demás y antes no, es que estaba al revés.
  // Se toma como referencia la casa con más mercados de dos salidas (a igualdad, la afilada) y se corrige a
  // las demás contra ella. Es una corrección barata y sin red: solo cambia algo cuando el desacuerdo es
  // mayor dándole la vuelta que sin dársela.
  const pHomeDe = (rows0) => {
    const m = new Map();
    for (const r of rows0 || []) {
      if (!(r.odds > 1) || (r.side !== 'home' && r.side !== 'away')) continue;
      const k = keyOf(r);
      if (!m.has(k)) m.set(k, {});
      const c = m.get(k);
      if (!c[r.side] || r.odds > c[r.side]) c[r.side] = r.odds;
    }
    const ps = [];
    for (const c of m.values()) { if (!(c.home > 1) || !(c.away > 1)) continue; const ih = 1 / c.home, ia = 1 / c.away; ps.push(ih / (ih + ia)); }
    return ps.length ? { p: ps.reduce((a, b) => a + b, 0) / ps.length, n: ps.length } : null;
  };
  const conP = got.map((g) => ({ g, ph: pHomeDe(g.rows) })).filter((x) => x.ph);
  if (conP.length >= 2) {
    const esAfilada = (bk) => ((ADAPTERS.find((z) => z.key === bk) || {}).sharp ? 1 : 0);
    conP.sort((a, b) => (b.ph.n - a.ph.n) || (esAfilada(b.g.book) - esAfilada(a.g.book)));
    const ref = conP[0];
    for (const x of conP.slice(1)) {
      const dir = Math.abs(x.ph.p - ref.ph.p), inv = Math.abs((1 - x.ph.p) - ref.ph.p);
      if (inv < dir - 0.15) {          // margen para no darle la vuelta a una discrepancia normal
        x.g.rows = orient(x.g.rows, true);
        x.g.reoriented_by_price = { was_p_home: r4(x.ph.p), ref: ref.g.book, ref_p_home: r4(ref.ph.p) };
      }
    }
  }

  const rows = [];
  for (const g of got) for (const r of g.rows) rows.push({ ...r, book: g.book });
  const at = got.map((g) => g.at).filter(Boolean).sort()[0] || new Date().toISOString();
  return {
    provider_id: mergedEvent.provider_id, game, markets: rows, at,
    by_book: got.map((g) => ({ book: g.book, rows: g.rows.length, at: g.at, flipped: !!g.flipped,
      reoriented_by_price: g.reoriented_by_price || null,
      disabled: g.disabled || 0, error: g.error || null })),
    orientation: orientationCheck(rows),
    books: got.filter((g) => g.rows.length).length,
    disabled_selections: got.reduce((s, g) => s + (g.disabled || 0), 0),
  };
}

// ---- 4) LO QUE SOLO SE PUEDE VER CON VARIAS CASAS -------------------------------------------------------
// Agrupa las filas en MERCADOS (familia + línea + mapa + equipo) y, para cada uno, publica: cuántas casas lo
// cotizan, la implícita de cada una, el mejor precio de cada lado, la dispersión y si hay arbitraje.
// Nada de esto pasa por el modelo, así que nada de esto hereda su riesgo.
const keyOf = (r) => [r.family, r.map == null ? '' : r.map, r.team || '', r.line == null ? '' : r.line].join('|');

function crossBook(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!(r.odds > 1)) continue;
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, { family: r.family, family_label: r.family_label, map: r.map, team: r.team, line: r.line, sides: new Map() });
    const g = groups.get(k);
    if (!g.sides.has(r.side)) g.sides.set(r.side, []);
    g.sides.get(r.side).push({ book: r.book, odds: r.odds, implied: 1 / r.odds });
  }

  const out = [];
  for (const g of groups.values()) {
    const sides = [...g.sides.entries()].map(([side, list]) => {
      const sorted = list.slice().sort((a, b) => b.odds - a.odds);
      const imp = list.map((x) => x.implied).sort((a, b) => a - b);
      const h = imp.length >> 1;
      const median = imp.length % 2 ? imp[h] : (imp[h - 1] + imp[h]) / 2;
      return {
        side, books: list.length,
        best_odds: sorted[0].odds, best_book: sorted[0].book,
        worst_odds: sorted[sorted.length - 1].odds,
        median_implied: r4(median),
        // dispersión en PUNTOS de probabilidad, que es la unidad en la que esta casa razona. Es la señal de
        // "aquí las casas no se ponen de acuerdo", que es donde vive tanto el valor como la trampa.
        spread_pp: r2(100 * (imp[imp.length - 1] - imp[0])),
        prices: sorted,
      };
    });
    const sum = sides.reduce((s, x) => s + x.median_implied, 0);
    // SOLO LOS MERCADOS DE DOS LADOS entran en la aritmética de consenso y arbitraje. El marcador exacto tiene
    // cuatro resultados y el par/impar dos, pero un mercado incompleto —una casa que solo cotiza el "más"—
    // también aparece con un lado suelto. Quitarle el margen a un conjunto de lados que no es exhaustivo da un
    // número plausible y falso, y sumar los mejores precios de un mercado incompleto declara un arbitraje que
    // no existe. Los multi-resultado se publican con sus precios y sin aritmética inventada.
    const twoWay = sides.length === 2;
    const arbSum = twoWay ? sides.reduce((s, x) => s + 1 / x.best_odds, 0) : null;
    out.push({
      family: g.family, family_label: g.family_label, map: g.map, team: g.team, line: g.line,
      books: Math.max(...sides.map((s) => s.books)),
      sides_n: sides.length,
      overround: twoWay ? r4(sum - 1) : null,
      // el consenso SIN MARGEN, que es contra lo que se compara el modelo
      consensus: twoWay && sum > 0 ? sides.map((s) => ({ side: s.side, p: r4(s.median_implied / sum) })) : null,
      sides,
      arbitrage: arbSum != null && arbSum < 1
        ? { profit_pct: r2(100 * (1 / arbSum - 1)), legs: sides.map((s) => ({ side: s.side, book: s.best_book, odds: s.best_odds })) }
        : null,
      // una casa sola no es dispersión: es una casa sola, y se dice.
      single_book: Math.max(...sides.map((s) => s.books)) < 2,
    });
  }
  out.sort((a, b) => (b.books - a.books) || (b.family < a.family ? 1 : -1));
  return out;
}

// Arbitrajes de verdad: dos lados del MISMO mercado en casas DISTINTAS. Si las dos patas salen de la misma
// casa no es arbitraje, es que la casa tiene el mercado mal montado y lo va a anular — así que se exige que
// las casas sean distintas y se dice por qué.
// TECHO DE CORDURA. Un arbitraje real entre casas vive entre el 0,5 % y el 3 %; por encima del 8 % lo que
// hay no es una casa despistada, es un dato mal leído — una línea que no es la misma, un mercado con más
// salidas de las que creemos, o los lados cambiados. Se corta ahí y se dice por qué en vez de publicarlo.
const ARB_MAX_PCT = 8;
function arbitrages(rows) {
  const or = orientationCheck(rows);
  if (!or.ok) return [];
  return crossBook(rows)
    .filter((m) => m.arbitrage && m.arbitrage.profit_pct <= ARB_MAX_PCT && new Set(m.arbitrage.legs.map((l) => l.book)).size >= 2)
    .map((m) => ({
      family: m.family, family_label: m.family_label, map: m.map, team: m.team, line: m.line,
      profit_pct: m.arbitrage.profit_pct, legs: m.arbitrage.legs,
      note: 'arbitraje puro: no depende del modelo, solo de que las dos casas mantengan el precio. Los límites de apuesta y la velocidad de cambio mandan.',
    }))
    .sort((a, b) => b.profit_pct - a.profit_pct);
}

// ── LA GUARDIA DE ORIENTACIÓN ───────────────────────────────────────────────────────────────────────────
// ESTO SALIÓ DE UN ARBITRAJE DEL +269 % (19-ago), y no era una oportunidad: era este fallo. Cuando dos casas
// tienen invertidos el local y el visitante y la reorientación no lo corrige, `crossBook` funde el "local"
// de una con el "visitante" de la otra. Las dos filas son EL MISMO LADO del partido, así que sumar sus
// mejores precios da un número precioso y falso — y como el arbitraje se publica diciendo "esto no depende
// del modelo", que es la etiqueta más creíble de la casa, es exactamente el sitio donde un dato falso hace
// más daño.
//
// La comprobación no se fía de los nombres, que es lo que ya falló: se fía de los PRECIOS. Cada casa que
// cotiza los dos lados de un mercado de dos salidas declara implícitamente a quién ve favorito; se le quita
// el margen y queda su probabilidad del local. Dos casas pueden discrepar —de eso vive esta pantalla— pero
// no pueden discrepar en veinticinco puntos sobre quién va a ganar. Si lo hacen, no están hablando del mismo
// lado, y ninguna superficie cruzada de ese partido se publica.
//
// El umbral es deliberadamente ancho. Un 25 pp de diferencia entre dos casas sobre el mismo favorito no
// ocurre en un mercado real ni en el peor partido desalineado del calendario; una inversión de lados produce
// diferencias de 60-90 pp. Ancho a propósito: prefiero no cazar una discrepancia rarísima y legítima a
// publicar un arbitraje inventado.
const ORIENT_MAX_PP = 25;
function orientationCheck(rows) {
  const porCasa = new Map();
  for (const r of rows || []) {
    if (!(r.odds > 1) || (r.side !== 'home' && r.side !== 'away')) continue;
    const k = keyOf(r);
    if (!porCasa.has(r.book)) porCasa.set(r.book, new Map());
    const m = porCasa.get(r.book);
    if (!m.has(k)) m.set(k, {});
    const cell = m.get(k);
    // el mejor precio de cada lado dentro de la MISMA casa
    if (!cell[r.side] || r.odds > cell[r.side]) cell[r.side] = r.odds;
  }
  // la probabilidad del local de cada casa, sin margen, promediada sobre los mercados donde tiene los dos lados
  const pDe = new Map();
  for (const [book, m] of porCasa) {
    const ps = [];
    for (const cell of m.values()) {
      if (!(cell.home > 1) || !(cell.away > 1)) continue;
      const ih = 1 / cell.home, ia = 1 / cell.away;
      ps.push(ih / (ih + ia));
    }
    if (ps.length) pDe.set(book, ps.reduce((a, b) => a + b, 0) / ps.length);
  }
  if (pDe.size < 2) return { ok: true, books: pDe.size, spread_pp: null, why: null };
  const vals = [...pDe.entries()].sort((a, b) => a[1] - b[1]);
  const lo = vals[0], hi = vals[vals.length - 1];
  const spread = 100 * (hi[1] - lo[1]);
  const books_p = Object.fromEntries([...pDe].map(([b, p]) => [b, r4(p)]));
  if (spread <= ORIENT_MAX_PP) return { ok: true, books: pDe.size, spread_pp: r2(spread), why: null, books_p };
  return {
    ok: false, books: pDe.size, spread_pp: r2(spread),
    why: `${lo[0]} da al local un ${Math.round(100 * lo[1])} % y ${hi[0]} un ${Math.round(100 * hi[1])} %: ` +
      'esa diferencia no es discrepancia de mercado, es que una de las dos tiene invertidos local y visitante. ' +
      'No se publica ninguna superficie cruzada de este partido.',
    books_p,
  };
}

// ── MIDDLES ─────────────────────────────────────────────────────────────────────────────────────────────
// Un middle no es un arbitraje: se paga un coste pequeño y a cambio hay una franja de resultados donde ganan
// LAS DOS patas. Con totales es directo —Over 24,5 en una casa y Under 26,5 en otra ganan las dos si el mapa
// acaba en 25 o 26 rondas—; con hándicap hay que tener cuidado con el signo, y ahí es donde se equivoca todo
// el mundo. En esta casa `line` está normalizada al HÁNDICAP DEL LOCAL: el local con hándicap Lh cubre si el
// margen supera −Lh, y la pata visitante de un mercado cuyo hándicap local es La cubre si el margen es menor
// que −La. Las dos ganan en (−Lh, −La), o sea hueco Lh − La. Sumar los dos números en vez de restarlos
// publica pares donde las dos patas PIERDEN juntas, que es el reverso exacto de un middle.
//
// EL HUECO MÍNIMO DEPENDE DE LA UNIDAD, y por eso no hay una constante única. Un hueco de 1 en mapas es una
// serie entera; un hueco de 1 en rondas de CS2 es ruido, porque media ronda de diferencia no existe y las
// líneas se mueven de dos en dos. Cada familia declara el suyo.
const MIDDLE_GAP = { TOTAL_MAPAS: 1, HANDICAP: 1, RONDAS: 2, RONDAS_EQUIPO: 2, RONDAS_HANDICAP: 2,
  KILLS: 2, KILLS_EQUIPO: 2, KILLS_HANDICAP: 2 };
const MIDDLE_LOW = { HANDICAP: 'home', RONDAS_HANDICAP: 'home', KILLS_HANDICAP: 'home' };  // el resto, over/under

function middles(rows, { maxCostPct = 6 } = {}) {
  // la misma guardia que el arbitraje, y por el mismo motivo: con los lados cambiados, un "middle" es dos
  // veces la misma apuesta con un coste negativo precioso
  if (!orientationCheck(rows).ok) return [];
  // se agrupa por TODO menos la línea: la línea es justo lo que tiene que variar entre las dos patas
  const groups = new Map();
  for (const r of rows || []) {
    if (!(r.odds > 1) || r.line == null || !MIDDLE_GAP[r.family]) continue;
    const k = [r.family, r.map == null ? '' : r.map, r.team || '', r.period || ''].join('|');
    if (!groups.has(k)) groups.set(k, { family: r.family, family_label: r.family_label, map: r.map, team: r.team, period: r.period, rows: [] });
    groups.get(k).rows.push(r);
  }
  const out = [];
  for (const g of groups.values()) {
    const esHcp = !!MIDDLE_LOW[g.family];
    const ladoBajo = MIDDLE_LOW[g.family] || 'over';
    const ladoAlto = esHcp ? 'away' : 'under';
    // mejor precio de cada lado EN CADA LÍNEA: un middle se arma con las dos mejores puntas, no con cualquiera
    const mejorPorLinea = (side) => {
      const o = new Map();
      for (const r of g.rows) {
        if (r.side !== side) continue;
        const prev = o.get(r.line);
        if (!prev || r.odds > prev.odds) o.set(r.line, { line: r.line, odds: r.odds, book: r.book });
      }
      return [...o.values()];
    };
    const bajos = mejorPorLinea(ladoBajo), altos = mejorPorLinea(ladoAlto);
    for (const a of bajos) for (const b of altos) {
      if (a.book === b.book) continue;                       // el middle vive ENTRE casas, como el arbitraje
      const hueco = esHcp ? a.line - b.line : b.line - a.line;
      if (!(hueco >= MIDDLE_GAP[g.family])) continue;
      const coste = (1 / a.odds + 1 / b.odds - 1) * 100;
      if (coste > maxCostPct) continue;
      const zLo = esHcp ? -a.line : a.line, zHi = esHcp ? -b.line : b.line;
      out.push({
        family: g.family, family_label: g.family_label, map: g.map, team: g.team, period: g.period,
        low: { line: a.line, odds: r2(a.odds), book: a.book, side: ladoBajo },
        high: { line: b.line, odds: r2(b.odds), book: b.book, side: ladoAlto },
        gap: +hueco.toFixed(1), cost_pct: +coste.toFixed(2),
        // la franja donde ganan las dos, en la unidad de la familia
        zone: esHcp
          ? `margen del local entre ${Math.ceil(Math.min(zLo, zHi))} y ${Math.floor(Math.max(zLo, zHi))}`
          : `entre ${Math.ceil(zLo)} y ${Math.floor(zHi)}`,
        note: 'middle: se pagan las dos patas y las dos ganan si el resultado cae en la franja. El coste es lo que se pierde si no cae.',
      });
    }
  }
  out.sort((a, b) => (a.cost_pct - b.cost_pct) || (b.gap - a.gap));
  return out;
}

// ── CAÍDAS DE CUOTA ─────────────────────────────────────────────────────────────────────────────────────
// La lectura de la casa de referencia AHORA contra la de la primera vez que se vio el mercado. Si el precio
// cayó, entró dinero informado y la línea se movió; las casas que todavía no la movieron son donde queda el
// precio viejo. Esto NO pasa por el modelo: si el modelo estuviera entero equivocado, la señal seguiría en pie.
//
// Se mide SOLO contra la casa afilada, y esto no es un detalle. Una casa blanda mueve su precio por su propio
// riesgo —porque le entró un cliente grande, o porque copió tarde— y su caída no dice nada del partido. La
// caída que importa es la de quien no limita cuentas ganadoras, porque esa solo se mueve cuando el precio
// estaba mal.
function dropping(openRows, nowRows, { minDropPct = 5, sharpBooks = null } = {}) {
  const afiladas = new Set(sharpBooks || ADAPTERS.filter((a) => a.sharp).map((a) => a.key));
  const mejor = (rows, filtro) => {
    const m = new Map();
    for (const r of rows || []) {
      if (!(r.odds > 1) || !filtro(r.book)) continue;
      const k = keyOf(r) + '|' + r.side;
      const prev = m.get(k);
      if (!prev || r.odds > prev.odds) m.set(k, r);
    }
    return m;
  };
  const antes = mejor(openRows, (b) => afiladas.has(b));
  const ahora = mejor(nowRows, (b) => afiladas.has(b));
  const blandas = mejor(nowRows, (b) => !afiladas.has(b));
  const out = [];
  for (const [k, a] of ahora) {
    const b0 = antes.get(k);
    if (!b0) continue;
    const caida = 100 * (1 - a.odds / b0.odds);
    if (!(caida >= minDropPct)) continue;
    // las rezagadas: casas blandas que TODAVÍA pagan el precio de antes (con un 1,5 % de tolerancia, que es
    // el ruido normal entre casas). Son el único motivo por el que una caída se publica en vez de anotarse.
    const rezagadas = (nowRows || [])
      .filter((r) => !afiladas.has(r.book) && r.odds >= b0.odds * 0.985 && keyOf(r) + '|' + r.side === k)
      .sort((x, y) => y.odds - x.odds).slice(0, 5)
      .map((r) => ({ book: r.book, odds: r2(r.odds) }));
    out.push({
      family: a.family, family_label: a.family_label, map: a.map, team: a.team, line: a.line, side: a.side,
      sharp_book: a.book, sharp_before: r2(b0.odds), sharp_now: r2(a.odds),
      drop_pct: +caida.toFixed(1),
      move_pp: +(100 * ((1 / a.odds) - (1 / b0.odds))).toFixed(1),
      stale: rezagadas,
      note: rezagadas.length
        ? 'la casa de referencia bajó el precio y estas todavía no lo movieron: ahí queda el precio viejo.'
        : 'la casa de referencia bajó el precio y el resto ya lo siguió: queda como señal de movimiento, no como precio aprovechable.',
    });
    void blandas;
  }
  out.sort((a, b) => (b.stale.length - a.stale.length) || (b.drop_pct - a.drop_pct));
  return out;
}

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

module.exports = {
  ADAPTERS, enabled, slate, markets, crossBook, arbitrages, middles, dropping, orientationCheck, orient, teamKey, norm, canonicalId,
  BOOKS_PROBED: BOV.BOOKS_PROBED,
  RESULTS_UNAVAILABLE: {
    available: false,
    why: 'NINGUNA de las tres casas publica marcadores: las tres sirven catálogo de apuesta y un partido terminado sale del listado. Comprobado el 16-ago en Cloudbet, Pinnacle y Bovada.',
    next: ['el histórico propio de CS2 ya no depende de esto: sale de scripts/cs2-harvest.js (48.678 mapas)',
      'para LoL, Valorant y Dota 2 siguen pendientes OpenDota, la API de Riot y Liquipedia'],
  },
};
