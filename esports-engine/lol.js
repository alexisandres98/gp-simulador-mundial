// esports-engine/lol.js — LEAGUE OF LEGENDS (16-ago). Blueprint adaptado: capítulos 05-12 son de CS2, pero
// el ARMAZÓN (unidad de juego → serie → derivados → anclaje al mercado → NO PICK) es el mismo y aquí se
// instancia con la gramática propia de LoL.
//
// LO QUE HACE A LoL DISTINTO DE CS2, y por lo que este archivo no es una copia con otro nombre:
//   1. NO HAY VETO DE MAPAS. Se juega siempre en la Grieta del Invocador. Lo que hay es DRAFT: bans y picks
//      de campeones, que es un veto de *herramientas*, no de terreno. La consecuencia de producto es fuerte:
//      en CS2 el mapa mueve la probabilidad antes del primer disparo; aquí lo que la mueve es el lado (azul
//      o rojo, por prioridad de draft) y la composición.
//   2. NO HAY RONDAS. La partida es continua y se decide por NEXO. La unidad derivada equivalente no es la
//      ronda sino la DURACIÓN y los OBJETIVOS (torres, dragones, barones, heraldo).
//   3. **ES EL ÚNICO DE LOS CUATRO CON MERCADO DE KILLS ABIERTO HOY** — medido el 16-ago contra el proveedor:
//      total de kills del mapa, kills por equipo y hándicap de kills. Eso lo convierte en el título donde la
//      doctrina de la casa (derivados sí, ganador no) tiene sitio real desde el primer día, y no una promesa.
//
// LA CADENA CAUSAL QUE MODELA ESTE ARCHIVO, que es lo que un total de kills necesita de verdad:
//      fuerza relativa → ritmo de la liga → duración esperada → kills por minuto → total de kills
// Modelar el total de kills como un número plano por liga es lo que hace todo el mundo y por eso el mercado
// ya lo tiene metido en el precio. La estructura está en el ACOPLE: una partida que se alarga no suma kills
// linealmente (las muertes tardías cuestan más y los equipos juegan más lento con inhibidores en juego), y
// una paliza corta tiene MENOS kills totales pero MÁS desequilibrio. Ese acople es lo que aquí se calcula.
'use strict';

const C = require('./core');

const GAME = {
  key: 'lol', label: 'League of Legends', short: 'LoL',
  unit: 'partida', unit_plural: 'partidas', default_bo: 3,
  families: ['SERIE', 'MAPA', 'HANDICAP', 'TOTAL_MAPAS', 'MARCADOR', 'KILLS', 'KILLS_EQUIPO', 'KILLS_HANDICAP', 'KILLS_DNB'],
  // aquí es donde el motor manda: kills y duración. El ganador queda anclado al mercado, por doctrina.
  edge_families: ['KILLS', 'KILLS_EQUIPO', 'KILLS_HANDICAP', 'TOTAL_MAPAS'],
  native: ['Draft y prioridad de lado', 'Ritmo y duración', 'Objetivos neutrales', 'Mercado de kills'],
};

// ---- 1) RITMO POR LIGA -----------------------------------------------------------------------------------
// El ritmo NO es una constante del juego: es una propiedad de la región y del parche. LCK es lenta y
// controlada; LPL y LEC son sangrientas. Estos son los perfiles de referencia del circuito con los que se
// arranca; en cuanto haya histórico propio de resultados, cada liga sustituye su fila por la medida (ver
// `calibrateTempo`). Se declaran como SUPUESTO, no como medición, porque eso es lo que son hoy.
const TEMPO = {
  LCK:    { kpm: 0.62, minutes: 32.5, label: 'Corea — control, objetivos por delante de peleas' },
  LPL:    { kpm: 0.94, minutes: 30.0, label: 'China — peleas constantes, la liga más sangrienta' },
  LEC:    { kpm: 0.86, minutes: 30.5, label: 'Europa — agresiva y de partidas cortas' },
  LCS:    { kpm: 0.82, minutes: 31.5, label: 'Norteamérica — desordenada, alta varianza' },
  LTA:    { kpm: 0.88, minutes: 30.5, label: 'Américas — herencia de LLA/CBLOL, ritmo alto' },
  PCS:    { kpm: 0.90, minutes: 30.0, label: 'Pacífico — muy agresiva' },
  VCS:    { kpm: 1.02, minutes: 28.5, label: 'Vietnam — la de más kills por minuto del circuito' },
  WORLDS: { kpm: 0.70, minutes: 33.0, label: 'Internacional — se juega más cerrado que en liga regular' },
  DEFAULT:{ kpm: 0.84, minutes: 31.0, label: 'referencia global cuando la liga no está perfilada' },
};
const TEMPO_NOTE = 'perfiles de ritmo por liga declarados como SUPUESTO de arranque (parche 2026, referencia de circuito), no como medición propia de GP. Se sustituyen liga a liga en cuanto el histórico propio tenga muestra: ver `calibrateTempo`.';

// Reconoce la liga por el nombre de competición que llega del proveedor, que no viene normalizado.
function tempoOf(competition) {
  const s = String(competition || '').toUpperCase();
  for (const k of ['LCK', 'LPL', 'LEC', 'LCS', 'LTA', 'PCS', 'VCS']) if (s.includes(k)) return { ...TEMPO[k], league: k, measured: false };
  if (/WORLD|MSI|INTERNATIONAL/.test(s)) return { ...TEMPO.WORLDS, league: 'WORLDS', measured: false };
  return { ...TEMPO.DEFAULT, league: null, measured: false };
}

// Cuando haya histórico propio: la media medida sustituye al supuesto con encogimiento por muestra, para que
// una liga con 4 partidos no se coma el perfil de referencia con su ruido.
const PRIOR_GAMES = 25;
function calibrateTempo(base, observed) {
  if (!observed || !(observed.games > 0)) return { ...base, measured: false, games: 0 };
  const w = observed.games / (observed.games + PRIOR_GAMES);
  return {
    kpm: C.r3(base.kpm * (1 - w) + observed.kpm * w),
    minutes: C.r2(base.minutes * (1 - w) + observed.minutes * w),
    label: base.label, league: base.league,
    measured: w > 0.35, games: observed.games, weight_observed: C.r3(w),
  };
}

// ---- 2) DRAFT Y LADO (blueprint 42-46, traducido al draft) ----------------------------------------------
// El equivalente estructural del veto de CS2. Dos cosas distintas y no se mezclan:
//   · LADO: el azul elige primero. Es una ventaja real y medida en el circuito (~52-53 % histórico), pequeña
//     pero sistemática, y depende del parche: cuando hay un campeón roto, el primer pick vale mucho más.
//   · BANS: 5 por equipo, y su función es la misma que el veto — quitarle al rival lo que mejor hace.
const SIDE_EDGE = 0.025;  // en probabilidad, sobre 0.5 — el azul gana ~52,5 % histórico de circuito
const DRAFT_PHASES = [
  { key: 'ban1', label: 'Primera fase de bans', note: 'seis bans; se quita lo que rompe el parche y lo que define al rival' },
  { key: 'pick1', label: 'Primeros picks', note: 'el azul elige primero: si hay un campeón por encima del resto, se lo lleva' },
  { key: 'ban2', label: 'Segunda fase de bans', note: 'cuatro bans; ya no se banea lo general sino la respuesta concreta' },
  { key: 'pick2', label: 'Últimos picks', note: 'el rojo cierra: tiene la última palabra en los emparejamientos de calle' },
];

function sideModel(pBase, { sideEdge = SIDE_EDGE } = {}) {
  if (pBase == null) return null;
  return {
    blue_p: C.r4(C.clamp01(pBase + sideEdge)),
    red_p: C.r4(C.clamp01(pBase - sideEdge)),
    edge_pp: C.r2(sideEdge * 200),
    note: 'el lado azul elige primero en el draft; la ventaja es pequeña pero sistemática en el circuito. En una serie los lados alternan, así que se compensa parcialmente — no del todo, porque el lado del mapa decisivo lo decide el ganador del anterior.',
  };
}

function draftModel({ tempo }) {
  return {
    phases: DRAFT_PHASES,
    side: 'el azul tiene prioridad de primer pick; el rojo tiene la última respuesta',
    tempo_link: `en ${tempo.league || 'esta competición'} el draft tiende a ${tempo.kpm >= 0.9 ? 'composiciones de pelea temprana' : tempo.kpm <= 0.7 ? 'composiciones de escalado y control de objetivos' : 'equilibrio entre pelea y escalado'} (${tempo.kpm} kills por minuto de referencia)`,
    missing: 'las tasas de ban/pick por campeón y por equipo necesitan histórico de drafts (Riot API / Leaguepedia), que GP todavía no tiene autorizado. Cuando llegue, entra por aquí sin rehacer el producto.',
  };
}

// ---- 3) DURACIÓN Y OBJETIVOS -----------------------------------------------------------------------------
// La duración es la variable madre de LoL: de ella cuelgan los kills, los objetivos y la mitad de los
// derivados. Se modela como lognormal (las partidas tienen cola larga a la derecha y suelo duro a la
// izquierda: por debajo de ~20 minutos casi no existe partida profesional, por arriba se estiran a 45+).
// El desequilibrio ACORTA: una partida entre dos equipos parejos dura más que una paliza.
function durationModel(pMap, tempo, { sims = 20000, seed = 41 } = {}) {
  const gap = Math.abs(pMap - 0.5) * 2;                       // 0 = parejos, 1 = paliza
  const mu = Math.log(tempo.minutes * (1 - 0.16 * gap));      // el desequilibrio acorta hasta un 16 %
  const sigma = 0.20 + 0.05 * (1 - gap);                      // partidas parejas también son más variables
  const rnd = C.rng(seed);
  const arr = [];
  for (let i = 0; i < sims; i++) {
    // Box-Muller sobre nuestro PRNG determinista
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    arr.push(C.clamp(Math.exp(mu + sigma * z), 18, 62));
  }
  arr.sort((a, b) => a - b);
  const q = (p) => C.r2(arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const lines = {};
  for (const line of [26.5, 28.5, 30.5, 32.5, 34.5]) {
    lines['over_' + String(line).replace('.', '_')] = C.r4(arr.filter((x) => x > line).length / arr.length);
  }
  return {
    mean_min: C.r2(mean), p10: q(0.10), p50: q(0.50), p90: q(0.90),
    totals: lines,
    tempo_used: { league: tempo.league, kpm: tempo.kpm, base_min: tempo.minutes, measured: !!tempo.measured },
    note: 'la duración se acorta con el desequilibrio: una paliza termina antes, y por eso una partida muy desigual suele tener MENOS kills totales aunque el reparto sea más desigual. Ese acople es lo que separa este total de kills de un promedio de liga.',
    sims,
  };
}

// Objetivos neutrales. No hay mercado abierto para ellos hoy, pero son el esqueleto narrativo de la partida
// y lo que explica la duración: cada dragón alma y cada barón acelera el cierre.
// OBJETIVOS: MEDIDOS CUANDO HAY MUESTRA, FÓRMULA CUANDO NO (19-ago).
// Hasta hoy esto era aritmética sobre la duración —dragones = minutos/6,2, barones = (m−20)/9— y lo decía:
// "esperanzas del modelo, no medias observadas". Con los conteos reales por partida ya en la base, la media
// de la liga MANDA donde existe, y se escala por la duración de ESTE partido frente a la duración típica de
// esa liga: un partido más largo tiene más dragones que la media de su liga, y eso el promedio plano no lo ve.
// Donde no hay muestra se conserva la fórmula y se sigue diciendo que es un supuesto. Nunca se mezcla en
// silencio: cada ítem viaja con `measured`.
function objectiveModel(pMap, duration, obs) {
  const m = duration.mean_min;
  // factor de duración: cuánto se aparta ESTE partido de la duración típica de su liga (acotado, para que
  // un valor atípico no dispare el conteo)
  const ratio = (obs && obs.mean_min > 0) ? C.clamp(m / obs.mean_min, 0.7, 1.4) : 1;
  const item = (key, label, formula, measured, note) => {
    const useM = measured != null && measured > 0;
    return { key, label, expected: C.r2(useM ? measured * ratio : formula),
      measured: useM, n: useM ? (obs && obs.n) || null : null, note };
  };
  return {
    items: [
      item('dragons', 'Dragones', Math.min(6, m / 6.2), obs && obs.dragons,
        'uno cada ~5 min al principio y el alma sobre el cuarto: quien la toma suele cerrar en los 8 minutos siguientes'),
      item('baron', 'Barones', Math.max(0, (m - 20) / 9), obs && obs.barons,
        'aparece en el minuto 20; el primero es el que más veces termina la partida'),
      // el heraldo no viene en la base: se queda como supuesto y se declara
      item('herald', 'Heraldo', m > 14 ? 1.4 : 0.7, null,
        'convierte ventaja temprana en torre, que es lo que traduce kills en mapa'),
      item('towers', 'Torres', 4.6 + m * 0.20, obs && obs.towers,
        'la torre es la moneda real del mapa: los kills sin torres no ganan partidas'),
    ],
    control_p: C.r4(C.clamp(0.5 + (pMap - 0.5) * 0.85, 0.15, 0.85)),
    measured: !!(obs && obs.n),
    sample: (obs && obs.n) || 0,
    league: (obs && obs.league) || null,
    duration_factor: +ratio.toFixed(3),
    missing: (obs && obs.n)
      ? 'medias REALES de la liga en los últimos 180 días, escaladas por la duración esperada de este partido. El reparto POR EQUIPO sigue sin medirse: eso exige el histórico de partida de Riot.'
      : 'sin muestra propia de esta liga: los conteos son aritmética sobre la duración, no medias observadas.',
  };
}

// ---- 4) MERCADO DE KILLS — el único derivado con precio abierto en los cuatro juegos --------------------
// Total de kills = ritmo × duración, con dos correcciones que el promedio plano no tiene:
//   · el ritmo NO es constante dentro de la partida: las primeras muertes llegan lento (fase de líneas) y se
//     acelera al agrupar. Modelado con un factor creciente por tramo.
//   · el desequilibrio SUBE los kills por minuto (el que va ganando fuerza peleas) pero BAJA los minutos.
//     Los dos efectos se pelean, y cuál gana depende de cuánto desequilibrio hay. Ese es exactamente el
//     sitio donde un total plano de liga se equivoca.
function killsModel(pMap, tempo, duration, { sims = 20000, seed = 53 } = {}) {
  const gap = Math.abs(pMap - 0.5) * 2;
  const kpm = tempo.kpm * (1 + 0.13 * gap);                   // el desequilibrio calienta el ritmo
  const rnd = C.rng(seed);
  const shBase = C.clamp(0.5 + (pMap - 0.5) * 0.72, 0.24, 0.76);
  const tot = [], ka = [], kb = [], marg = [];
  for (let i = 0; i < sims; i++) {
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mins = C.clamp(Math.exp(Math.log(duration.mean_min) + 0.22 * z), 18, 62);
    // media de Poisson con sobre-dispersión: las partidas "de sangre" no son ruido de Poisson, son otro régimen
    const lam = kpm * mins * (0.86 + 0.30 * rnd());
    const k = poisson(lam, rnd);
    tot.push(k);
    // El reparto NO es fijo dentro de la partida: el favorito domina en promedio, pero hay partidas donde el
    // que iba a perder gana la pelea del minuto 25. Sin ese ruido, el hándicap de kills sale artificialmente
    // seguro y es justo la familia con más líneas cotizadas.
    const u3 = Math.max(1e-9, rnd()), u4 = rnd();
    const zs = Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);
    const sh = C.clamp(shBase + 0.085 * zs, 0.12, 0.88);
    const a = Math.round(k * sh), b = k - a;
    ka.push(a); kb.push(b); marg.push(a - b);
  }
  const srt = tot.slice().sort((a, b) => a - b);
  const mean = tot.reduce((a, b) => a + b, 0) / tot.length;
  const lines = {};
  for (const line of [20.5, 22.5, 24.5, 26.5, 28.5, 30.5]) {
    lines['over_' + String(line).replace('.', '_')] = C.r4(srt.filter((x) => x > line).length / srt.length);
  }
  const q = (p) => srt[Math.min(srt.length - 1, Math.floor(p * srt.length))];
  const shMean = ka.reduce((a, b) => a + b, 0) / Math.max(1, tot.reduce((a, b) => a + b, 0));
  return {
    mean_kills: C.r2(mean), p10: q(0.10), p50: q(0.50), p90: q(0.90),
    kpm_used: C.r3(kpm), share_a: C.r3(shMean),
    team_a_mean: C.r2(ka.reduce((a, b) => a + b, 0) / ka.length),
    team_b_mean: C.r2(kb.reduce((a, b) => a + b, 0) / kb.length),
    handicap_mean: C.r2(marg.reduce((a, b) => a + b, 0) / marg.length),
    totals: lines,
    // los histogramas son lo que permite valorar CUALQUIER línea que publique la casa sin interpolar colas
    dist: { total: C.histOf(tot), home: C.histOf(ka), away: C.histOf(kb), margin: C.histOf(marg) },
    chain: [
      { step: 'ritmo de liga', value: `${tempo.kpm} kills/min`, from: tempo.measured ? 'histórico propio' : 'perfil de circuito' },
      { step: 'ajuste por desequilibrio', value: `×${C.r3(1 + 0.13 * gap)}`, from: 'el que domina fuerza más peleas' },
      { step: 'duración esperada', value: `${duration.mean_min} min`, from: 'modelo de duración' },
      { step: 'total esperado', value: `${C.r2(mean)} kills`, from: 'simulación' },
    ],
    note: 'un total de kills plano por liga ya está en el precio. Lo que aquí se añade es el ACOPLE: el desequilibrio sube el ritmo y baja los minutos a la vez, y el saldo depende de cuánto desequilibrio hay.',
    sims,
  };
}

function poisson(lam, rnd) {
  if (lam > 30) {                                   // normal para lambdas grandes, que es el caso normal aquí
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.round(lam + Math.sqrt(lam) * z));
  }
  let L = Math.exp(-lam), k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return k - 1;
}

// ---- 5) LO QUE IMPORTA -----------------------------------------------------------------------------------
function whatMatters({ anchored, tempo, duration, kills, unc, bo }) {
  const out = [];
  out.push({ rank: 1, pp: null, driver: 'ritmo',
    text: `${tempo.league || 'La competición'} corre a ${tempo.kpm} kills por minuto${tempo.measured ? ' (medido con histórico propio)' : ' (perfil de circuito, todavía sin muestra propia)'}: eso, y no la fuerza de los equipos, es lo que fija el suelo del total.` });
  if (duration) out.push({ rank: 2, pp: null, driver: 'duración',
    text: `Duración esperada ${duration.mean_min} min, con el 80 % de las partidas entre ${duration.p10} y ${duration.p90}. Cuanto más desigual el emparejamiento, más corta la partida.` });
  if (kills) out.push({ rank: 3, pp: null, driver: 'kills',
    text: `Total esperado ${kills.mean_kills} kills, repartidos ${Math.round(100 * kills.share_a)}/${Math.round(100 * (1 - kills.share_a))}. El hándicap medio sale en ${kills.handicap_mean}.` });
  if (anchored) out.push({ rank: 4, pp: null, driver: 'anclaje',
    text: anchored.w_model === 0
      ? 'El ganador es el del mercado sin margen, no una opinión de GP: aquí el motor no aporta y no finge que sí.'
      : `GP pesa un ${Math.round(100 * anchored.w_model)}% sobre el consenso para el ganador; el resto lo pone el mercado.` });
  if (unc) out.push({ rank: 5, pp: unc.epistemic_pp, driver: 'incertidumbre',
    text: `Lo que GP no sabe vale ±${unc.epistemic_pp} pp. Sin histórico de partida (Riot API) la duración y el ritmo son supuestos de circuito, y eso está dentro de esa cifra.` });
  return out.slice(0, 5);
}

// ---- 6) FACHADA ------------------------------------------------------------------------------------------
function analyze({ market, ratings, bo = 3, sample = 0, competition = null, observedTempo = null, observedObjectives = null }) {
  const bookRows = (market && market.markets) || [];
  // El ancla NO es solo la familia `SERIE`: la mayoría de partidos con mercado abierto no la cotizan y sí
  // cotizan marcador, hándicap o ganador de mapa. `marketAnchor` recorre esas fuentes en orden y dice de
  // cuál salió — ver la nota larga en core.js.
  const anchor = C.marketAnchor(bookRows, bo);
  const cons = anchor ? anchor.market : null;
  const marketP = anchor ? anchor.p : null;

  const modelP = ratings && ratings.elo_a != null && ratings.elo_b != null
    ? C.eloProbability(ratings.elo_a, ratings.elo_b) : null;
  const anchored = C.anchoredProbability(marketP, modelP, { n: sample });

  const pSeries = anchored ? anchored.p : null;
  const pMap = pSeries != null ? C.seriesToMap(pSeries, bo) : null;

  const tempo = calibrateTempo(tempoOf(competition), observedTempo);
  const duration = pMap != null ? durationModel(pMap, tempo) : null;
  const kills = (pMap != null && duration) ? killsModel(pMap, tempo, duration) : null;
  const objectives = (pMap != null && duration) ? objectiveModel(pMap, duration, observedObjectives) : null;

  const unc = C.uncertainty({
    p: pSeries != null ? pSeries : 0.5, sampleMatches: sample,
    marketBooks: cons ? cons.books : 0,
    // 19-ago: el histórico de draft YA existe (37.990 drafts propios + meta por parche), así que dejó de
    // ser un faltante y dejó de cobrar incertidumbre. Lo que sigue faltando —y se cobra— es el scoreboard
    // por partida: sin él no hay kills medidos, que es justo lo que cierra las familias de volumen.
    missing: [].concat(tempo.measured ? [] : ['ritmo de kills medido de la liga'], ['scoreboard por partida (kills y oro por jugador)']),
  });

  const sim = pMap != null ? C.simulateSeries(pMap, bo) : null;

  return {
    game: 'lol', bo, competition,
    probability: anchored, market: cons, market_anchor: anchor ? { from: anchor.from, family: anchor.family, direct: anchor.direct, p_map: anchor.p_map != null ? anchor.p_map : null } : null, simulation: sim,
    side: sideModel(pMap), draft: draftModel({ tempo }),
    tempo: { ...tempo, note: TEMPO_NOTE },
    duration, kills, objectives,
    uncertainty: unc,
    what_matters: whatMatters({ anchored, tempo, duration, kills, unc, bo }),
    native: GAME.native, edge_families: GAME.edge_families,
  };
}

module.exports = { GAME, TEMPO, TEMPO_NOTE, tempoOf, calibrateTempo, sideModel, draftModel, durationModel, objectiveModel, killsModel, whatMatters, analyze };
