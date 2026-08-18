// esports-engine/valorant.js — VALORANT (16-ago).
//
// EL PARECIDO CON CS2 ES UNA TRAMPA, y por eso este archivo existe aparte en vez de ser `cs2.js` con otro
// pool de mapas. Sí: mapas, veto, rondas a 13, economía, lados. Pero tres cosas cambian el modelo de raíz:
//
//   1. **AGENTES Y COMPOSICIÓN.** En CS2 los cinco jugadores tienen el mismo kit y la única variable de
//      terreno es el mapa. En Valorant cada equipo elige cinco agentes con habilidades, y algunos mapas
//      tienen composiciones casi obligatorias (dobles controladores, Viper en mapas con calles largas). El
//      resultado es que **la fuerza por mapa depende de la profundidad del roster en agentes**, y un equipo
//      puede ser bueno en un mapa y no poder jugarlo porque su composición no existe. Eso no tiene análogo
//      en CS2.
//   2. **LA ASIMETRÍA ATAQUE/DEFENSA ES MUCHO MÁS FUERTE.** En CS2 el desequilibrio T/CT existe pero es
//      moderado; en Valorant hay mapas donde la defensa gana el 55-58 % de las rondas de forma estructural,
//      porque las habilidades de retención son más potentes que las de entrada. Modelar las rondas con una
//      sola probabilidad —como se puede hacer casi sin coste en CS2— aquí sesga la primera mitad entera.
//   3. **LA PRÓRROGA ES MUERTE SÚBITA POR PAREJAS** (13-13 → se juega a ganar por dos), y no un MR3 como en
//      CS2. La cola de la distribución de rondas es distinta y el mercado de totales vive justo en esa cola.
//
// ── LO QUE HOY NO SE PUEDE ────────────────────────────────────────────────────────────────────────────────
// Medido contra el proveedor el 16-ago: Valorant tiene FIXTURES pero los mercados aún no estaban abiertos en
// la franja mirada. Así que este motor está completo y a la espera de precio, y la UI lo dice tal cual en vez
// de enseñar una pantalla vacía sin explicación. Las composiciones por equipo necesitan histórico de partida
// (VLR/Riot), que GP no tiene autorizado: la estructura está, las tasas por agente no se inventan.
'use strict';

const C = require('./core');

// El pool competitivo. Igual que en CS2 es un dato del editor y cambia con los actos: se versiona.
const MAP_POOL = [
  { key: 'ascent', name: 'Ascent', bias: 0.53, note: 'defensa fuerte por el control del centro' },
  { key: 'bind', name: 'Bind', bias: 0.51, note: 'los teleportes reparten: rotaciones baratas para los dos lados' },
  { key: 'haven', name: 'Haven', bias: 0.49, note: 'tres sitios estiran a la defensa; el ataque tiene ventaja de elección' },
  { key: 'icebox', name: 'Icebox', bias: 0.54, note: 'ángulos verticales y plantados difíciles: el mapa más defensivo' },
  { key: 'lotus', name: 'Lotus', bias: 0.49, note: 'tres sitios y puertas rotatorias: el ataque manda el ritmo' },
  { key: 'sunset', name: 'Sunset', bias: 0.52, note: 'medio estrecho, la defensa retiene barato' },
  { key: 'abyss', name: 'Abyss', bias: 0.50, note: 'sin paredes exteriores; equilibrado y de rondas cortas' },
];
const POOL_VERSION = '2026-08';
// `bias` = probabilidad de que la DEFENSA gane una ronda entre iguales. Es el dato que CS2 no necesita con
// esta fuerza y aquí sí. Declarado como referencia de circuito, no como medición propia: se sustituye en
// cuanto haya histórico de rondas por mapa.
const BIAS_NOTE = 'la ventaja defensiva por mapa es una referencia del circuito 2026, no una medición de GP. Es el parámetro que más mueve la primera mitad y el primero que se recalibra cuando entre histórico de rondas.';

const GAME = {
  key: 'valorant', label: 'Valorant', short: 'VAL',
  unit: 'mapa', unit_plural: 'mapas', default_bo: 3,
  families: ['SERIE', 'MAPA', 'HANDICAP', 'TOTAL_MAPAS', 'RONDAS', 'MARCADOR'],
  edge_families: ['RONDAS', 'TOTAL_MAPAS', 'HANDICAP'],
  native: ['Veto de mapas', 'Composición de agentes', 'Asimetría ataque/defensa', 'Prórroga por parejas'],
};

// ---- 1) VETO ---------------------------------------------------------------------------------------------
// La secuencia estándar de Valorant en BO3 es ban-ban-pick-pick-ban-ban-decider, igual que CS2. Lo que
// cambia es el criterio: aquí un equipo también banea mapas donde NO TIENE composición, aunque su nivel
// general sea bueno. Por eso `depth` entra en la preferencia con peso propio.
function vetoTree(mapStrength, { bo = 3, pool = MAP_POOL, depth = null } = {}) {
  const maps = pool.map((m) => ({
    ...m,
    a: mapStrength.a[m.key] != null ? mapStrength.a[m.key] : null,
    b: mapStrength.b[m.key] != null ? mapStrength.b[m.key] : null,
    da: depth && depth.a && depth.a[m.key] != null ? depth.a[m.key] : null,
    db: depth && depth.b && depth.b[m.key] != null ? depth.b[m.key] : null,
  })).filter((m) => m.a != null && m.b != null);
  if (maps.length < 3) return null;

  const pref = (side, sign) => {
    const w = maps.map((m) => {
      const edge = side === 'a' ? (m.a - m.b) : (m.b - m.a);
      // penalización por falta de composición: un mapa que no sabes jugar se banea aunque el rival tampoco
      const own = side === 'a' ? m.da : m.db;
      const gap = own == null ? 0 : (1 - C.clamp01(own)) * 0.35;
      return Math.exp(sign * (edge * 6 - gap * 6 * (sign > 0 ? 1 : -1)));
    });
    const s = w.reduce((x, y) => x + y, 0) || 1;
    return maps.map((m, i) => ({ map: m.key, name: m.name, p: C.r3(w[i] / s) }));
  };
  const banA = pref('a', -1), banB = pref('b', -1), pickA = pref('a', 1), pickB = pref('b', 1);

  const used = new Set(), seq = [];
  const step = (who, kind, arr) => {
    const t = arr.filter((x) => !used.has(x.map)).sort((x, y) => y.p - x.p)[0];
    if (!t) return; used.add(t.map); seq.push({ who, kind, map: t.map, name: t.name, p: t.p });
  };
  if (bo === 3) { step('a', 'ban', banA); step('b', 'ban', banB); step('a', 'pick', pickA); step('b', 'pick', pickB); step('a', 'ban', banA); step('b', 'ban', banB); }
  else if (bo === 5) { step('a', 'ban', banA); step('b', 'ban', banB); step('a', 'pick', pickA); step('b', 'pick', pickB); step('a', 'pick', pickA); step('b', 'pick', pickB); }
  else { for (let i = 0; i < 3; i++) { step('a', 'ban', banA); step('b', 'ban', banB); } }
  const decider = maps.filter((m) => !used.has(m.key))[0] || null;

  const played = seq.filter((s) => s.kind === 'pick').map((s) => s.map);
  if (decider) played.push(decider.key);

  return {
    sequence: seq,
    decider: decider ? { map: decider.key, name: decider.name } : null,
    likely_maps: played.map((k) => {
      const m = maps.find((x) => x.key === k);
      return m ? { map: m.key, name: m.name, p_a: C.r3(m.a), bias: m.bias, note: m.note } : null;
    }).filter(Boolean),
    ban_probabilities: { a: banA, b: banB },
    pick_probabilities: { a: pickA, b: pickB },
    pool_version: POOL_VERSION,
    note: 'a diferencia de CS2, aquí un equipo también banea el mapa que no puede COMPONER: la falta de agentes entra en la preferencia con peso propio. Sin histórico de vetos accesible, las preferencias se derivan de fuerza y profundidad, no de vetos observados.',
  };
}

// ---- 2) COMPOSICIONES (lo que no tiene análogo en CS2) --------------------------------------------------
// Los roles son fijos y el reparto habitual por mapa es conocido; lo que no se puede saber sin histórico es
// qué agentes juega ESTE equipo. Se publica la estructura y el hueco, no una composición inventada.
const ROLES = [
  { key: 'duelista', label: 'Duelista', note: 'abre el sitio; en mapas de defensa fuerte su entrada vale doble' },
  { key: 'controlador', label: 'Controlador', note: 'humos; en mapas de calles largas es obligatorio y a veces doble' },
  { key: 'iniciador', label: 'Iniciador', note: 'información antes de entrar: lo que convierte un 5v5 en un 5v4' },
  { key: 'centinela', label: 'Centinela', note: 'retiene y vigila flancos; el rol que sostiene el sesgo defensivo del mapa' },
];
function compositionModel(mapKey) {
  const m = MAP_POOL.find((x) => x.key === mapKey) || null;
  return {
    roles: ROLES,
    map: m ? { key: m.key, name: m.name, bias: m.bias, note: m.note } : null,
    demand: m
      ? (m.bias >= 0.53 ? 'mapa defensivo: pide doble iniciador y una entrada que de verdad abra'
        : m.bias <= 0.49 ? 'mapa de ataque: pide centinela sólido y control de rotaciones'
        : 'mapa equilibrado: la composición estándar funciona y decide la ejecución')
      : null,
    missing: 'las composiciones por equipo y sus tasas de victoria necesitan histórico de partida (VLR/Riot), no autorizado todavía. No se inventan: aquí solo está la demanda estructural del mapa.',
  };
}

// ---- 3) RONDAS CON ASIMETRÍA ATAQUE/DEFENSA -------------------------------------------------------------
// La diferencia técnica con CS2: cada mitad se simula con SU probabilidad de ronda, porque el lado importa.
// A juega 12 rondas de un lado y 12 del otro; la prórroga es muerte súbita por parejas hasta ganar por dos.
// Mismo arrastre económico que en CS2 y por la misma razón, pero algo más fuerte: en Valorant la ronda de
// bonus tras perder la pistola encadena con más frecuencia, y las ultimates del que va perdiendo llegan a
// tramos y no de forma continua. Sin este término la tasa de prórroga salía en 15,5 % —que es exactamente
// el binomio de una moneda justa— cuando el circuito está en torno al 11 %.
const ECO_DRAG = 0.065;

function mapRounds(pRoundA, mapBias, { target = 13, sims = 20000, seed = 29, eco = ECO_DRAG } = {}) {
  const rnd = C.rng(seed);
  // pRoundA es "en un mapa neutro". El sesgo del mapa se aplica al LADO, no al equipo: en la mitad donde A
  // defiende, A gana más rondas; en la que ataca, menos. El efecto neto sobre el mapa completo es ~0, que es
  // exactamente el punto — lo que cambia no es quién gana el mapa sino CUÁNTAS rondas se juegan.
  const d = (mapBias - 0.5);
  const pDef = C.clamp(pRoundA + d, 0.10, 0.90);
  const pAtk = C.clamp(pRoundA - d, 0.10, 0.90);
  let sum = 0, otN = 0; const dist = {};
  const tot = [], ra = [], rb = [], marg = [];
  // signo `+`: la racha se refuerza (el que ganó llega con dinero). Ver la nota equivalente en cs2.js.
  const round = (p, st) => rnd() < C.clamp(p + st * eco, 0.05, 0.95);
  for (let i = 0; i < sims; i++) {
    let a = 0, b = 0, st = 0;
    const play = (p) => {
      if (round(p, st)) { a++; st = Math.min(2, st <= 0 ? 1 : st + 1); }
      else { b++; st = Math.max(-2, st >= 0 ? -1 : st - 1); }
    };
    // primera mitad: 12 rondas, A defiende
    for (let r = 0; r < 12 && a < target && b < target; r++) play(pDef);
    // segunda mitad: A ataca
    for (let r = 0; r < 12 && a < target && b < target; r++) play(pAtk);
    // prórroga: hay que ganar por dos, en parejas de rondas con lados alternos
    let ot = 0;
    while (a === b && a >= target - 1) {
      ot++;
      play(pDef); play(pAtk);
      if (ot > 10) break;
    }
    if (ot) otN++;
    sum += a + b;
    tot.push(a + b); ra.push(a); rb.push(b); marg.push(a - b);
    const loser = Math.min(a, b);
    dist[loser] = (dist[loser] || 0) + 1;
  }
  const rows = Object.entries(dist).map(([k, v]) => ({ loser_rounds: +k, p: C.r4(v / sims) }))
    .sort((x, y) => x.loser_rounds - y.loser_rounds);
  const srt = tot.slice().sort((x, y) => x - y);
  const totals = {};
  for (const line of [20.5, 21.5, 22.5, 23.5, 24.5, 25.5]) {
    totals['over_' + String(line).replace('.', '_')] = C.r4(srt.filter((x) => x > line).length / srt.length);
  }
  return {
    mean_rounds: C.r2(sum / sims), overtime_p: C.r4(otN / sims),
    dist: { total: C.histOf(tot), home: C.histOf(ra), away: C.histOf(rb), margin: C.histOf(marg) },
    p_round_defense: C.r3(pDef), p_round_attack: C.r3(pAtk), map_bias: mapBias,
    loser_distribution: rows, totals, sims,
    note: 'cada mitad se simula con su propia probabilidad de ronda. El sesgo del mapa casi no mueve quién gana —los dos equipos juegan los dos lados— pero mueve mucho CUÁNTAS rondas se juegan, que es donde vive el mercado de totales.',
  };
}

// ---- 4) ECONOMÍA ------------------------------------------------------------------------------------------
const ECONOMY_MODEL = {
  buys: [
    { key: 'pistol', label: 'Pistola', note: 'rondas 1 y 13; con las ultimates de arranque pesa más que en CS2' },
    { key: 'eco', label: 'Eco', note: 'se guarda crédito y se juega a robar armas; ganar aquí rompe el plan del rival' },
    { key: 'force', label: 'Force / bonus', note: 'la ronda 2 tras perder la pistola: la más decisiva de la primera mitad' },
    { key: 'full', label: 'Full buy', note: 'armas y las cuatro habilidades: la ronda donde se mide el nivel real' },
  ],
  ults: 'las ultimates acumulan por rondas y por orbes: un equipo que va perdiendo llega al tramo 6-9 con más ultimates que el que va ganando, y ahí es donde se rompen las rachas. Sin datos de partida esto es estructura, no medición.',
  note: 'estructura del modelo económico de Valorant. Las tasas de conversión por equipo necesitan datos de ronda que GP no tiene autorizados todavía.',
};

// ---- 5) LO QUE IMPORTA -----------------------------------------------------------------------------------
function whatMatters({ anchored, veto, rounds, unc, bo }) {
  const out = [];
  if (veto && veto.likely_maps && veto.likely_maps.length) {
    const best = veto.likely_maps.slice().sort((x, y) => y.p_a - x.p_a)[0];
    const worst = veto.likely_maps.slice().sort((x, y) => x.p_a - y.p_a)[0];
    if (best && worst && best.map !== worst.map) {
      out.push({ rank: 1, pp: C.r2((best.p_a - worst.p_a) * 100), driver: 'mapas',
        text: `El reparto probable no es plano: ${best.name} (${Math.round(100 * best.p_a)}%) frente a ${worst.name} (${Math.round(100 * worst.p_a)}%).` });
    }
  }
  if (rounds) {
    out.push({ rank: out.length + 1, pp: null, driver: 'lado',
      text: `Con el sesgo del mapa (${rounds.map_bias}) la mitad defensiva sale a ${Math.round(100 * rounds.p_round_defense)}% de ronda y la ofensiva a ${Math.round(100 * rounds.p_round_attack)}%. El mapa se decide parejo; lo que cambia es la longitud.` });
    out.push({ rank: out.length + 1, pp: null, driver: 'rondas',
      text: `Duración esperada ${rounds.mean_rounds} rondas, con ${Math.round(100 * rounds.overtime_p)}% de prórroga.` });
  }
  if (anchored) out.push({ rank: out.length + 1, pp: null, driver: 'anclaje',
    text: anchored.w_model === 0
      ? 'Sin muestra propia: el ganador es el consenso del mercado sin margen, no una opinión de GP.'
      : `GP pesa un ${Math.round(100 * anchored.w_model)}% sobre el consenso.` });
  if (unc) out.push({ rank: out.length + 1, pp: unc.epistemic_pp, driver: 'incertidumbre',
    text: `Lo que GP no sabe vale ±${unc.epistemic_pp} pp: sin histórico de composiciones ni de rondas, la fuerza por mapa es una estimación y no una medición.` });
  return out.slice(0, 5).map((x, i) => ({ ...x, rank: i + 1 }));
}

// ---- 6) FACHADA ------------------------------------------------------------------------------------------
function analyze({ market, ratings, bo = 3, sample = 0 }) {
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

  const strength = (ratings && ratings.map_strength) || null;
  const veto = strength ? vetoTree(strength, { bo, depth: (ratings && ratings.agent_depth) || null }) : null;
  const mapProbs = veto ? veto.likely_maps : null;

  const firstMap = mapProbs && mapProbs.length ? mapProbs[0] : null;
  const bias = firstMap ? firstMap.bias : 0.51;
  const rounds = pMap != null ? mapRounds(clampRound(pMap), bias) : null;

  const unc = C.uncertainty({
    p: pSeries != null ? pSeries : 0.5, sampleMatches: sample,
    marketBooks: cons ? cons.books : 0,
    // Valorant es el único de los cuatro al que todavía le falta el detalle: la cosecha de mapas y
    // scoreboard está moliendo. Mientras no esté, se cobra — y cuando entre, esta lista se vacía sola.
    missing: [].concat(strength ? [] : ['fuerza por mapa medida'], rounds && rounds.measured ? [] : ['perfil de rondas por mapa'], ['composiciones de agentes']),
  });

  const sim = pMap != null ? C.simulateSeries(pMap, bo, { perMap: mapProbs ? mapProbs.map((m) => m.p_a) : null }) : null;

  return {
    game: 'valorant', bo,
    probability: anchored, market: cons, market_anchor: anchor ? { from: anchor.from, family: anchor.family, direct: anchor.direct, p_map: anchor.p_map != null ? anchor.p_map : null } : null, simulation: sim,
    veto, rounds, economy: ECONOMY_MODEL,
    composition: compositionModel(firstMap ? firstMap.map : null),
    uncertainty: unc,
    what_matters: whatMatters({ anchored, veto, rounds, unc, bo }),
    map_pool: MAP_POOL, pool_version: POOL_VERSION, bias_note: BIAS_NOTE,
    native: GAME.native, edge_families: GAME.edge_families,
  };
}
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.44, 0.32, 0.68);

module.exports = { GAME, MAP_POOL, POOL_VERSION, BIAS_NOTE, ROLES, vetoTree, compositionModel, mapRounds, ECONOMY_MODEL, whatMatters, analyze };
