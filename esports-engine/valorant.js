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
const BIAS_MEDIDO = 'la ventaja defensiva por mapa está MEDIDA sobre las mitades ataque/defensa de la base propia, no asumida. El pool y su reparto salen de lo que se está jugando, no de una lista escrita a mano.';

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
      // SIGNO (2-sep): `sign` es +1 para elegir y −1 para vetar. El término de fuerza ya iba bien —se veta
      // donde el RIVAL es más fuerte (edge negativo → peso alto con sign = −1)— pero el de composición
      // llevaba un factor extra que le cambiaba el signo en el veto: un mapa SIN composición salía con MENOS
      // probabilidad de ser vetado, justo lo contrario de lo que dice el comentario de arriba. Con la
      // preferencia escrita como sign·(edge − gap), el mapa que no se sabe jugar resta al elegir y suma al
      // vetar, que es la única lectura coherente.
      return Math.exp(sign * (edge * 6 - gap * 6));
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
function compositionModel(mapKey, pool = MAP_POOL) {
  const m = (pool || MAP_POOL).find((x) => x.key === mapKey) || MAP_POOL.find((x) => x.key === mapKey) || null;
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

// AJUSTE POR MAPA (20-ago): el 0,065 de arriba deja de ser la respuesta y pasa a ser el respaldo. Con el
// detalle cosechado (mitades ataque/defensa de miles de mapas) cada mapa tiene SU tasa de prórroga real
// —Fracture al 8,6 %, Summit al 15,3 %— y el arrastre se busca por bisección hasta reproducirla. Es la
// misma mecánica de CS2 y por la misma razón: una constante de autor no puede describir diez mapas.
// El ajuste tiene UN grado de libertad y DOS objetivos (prórroga y rondas medias): se ajusta a la
// prórroga y se PUBLICA el residuo en rondas, que es lo que luego cobra `calibrationPp` en store.js.
const _dragCache = new Map();
function calibrateDrag(profile) {
  if (!profile || !profile.measured || profile.n < 40 || !(profile.overtime_p > 0)) {
    return { eco: ECO_DRAG, fitted: false, target_ot: null };
  }
  const bias = profile.def_round_share != null ? profile.def_round_share : 0.5;
  const key = profile.map + ':' + profile.n;
  if (_dragCache.has(key)) return _dragCache.get(key);
  let lo = 0, hi = 0.18;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const ot = mapRounds(0.5, bias, { eco: mid, sims: 6000, seed: 4127 }).overtime_p;
    if (ot > profile.overtime_p) lo = mid; else hi = mid;
  }
  const eco = C.r3((lo + hi) / 2);
  const check = mapRounds(0.5, bias, { eco, sims: 12000, seed: 4127 });
  const out = { eco, fitted: true,
    target_ot: profile.overtime_p, got_ot: check.overtime_p,
    target_rounds: profile.mean_rounds, got_rounds: check.mean_rounds,
    rounds_residual: C.r2(check.mean_rounds - profile.mean_rounds),
    n: profile.n };
  _dragCache.set(key, out);
  return out;
}

function mapRounds(pRoundA, mapBias, { target = 13, sims = 20000, seed = 29, eco = ECO_DRAG } = {}) {
  const rnd = C.rng(seed);
  // pRoundA es "en un mapa neutro". El sesgo del mapa se aplica al LADO, no al equipo: en la mitad donde A
  // defiende, A gana más rondas; en la que ataca, menos. El efecto neto sobre el mapa completo es ~0, que es
  // exactamente el punto — lo que cambia no es quién gana el mapa sino CUÁNTAS rondas se juegan.
  const d = (mapBias - 0.5);
  const pDef = C.clamp(pRoundA + d, 0.10, 0.90);
  const pAtk = C.clamp(pRoundA - d, 0.10, 0.90);
  let sum = 0, otN = 0, winA = 0; const dist = {};
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
    // UN MAPA NUNCA ACABA EMPATADO (2-sep). El tope de diez parejas existe para que la simulación no se
    // cuelgue, pero dejaba mapas en 23-23 que después contaban como "ninguno gana" en el margen y en
    // p_win_a. La pareja final se resuelve con una ronda a pDef: un desempate, no una regla del juego.
    while (a === b) play(pDef);
    if (ot) otN++;
    if (a > b) winA++;
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
    // la probabilidad de que A gane el mapa SEGÚN ESTA SIMULACIÓN: es lo que `pRoundFor` iguala al objetivo
    p_win_a: C.r4(winA / sims),
    dist: { total: C.histOf(tot), home: C.histOf(ra), away: C.histOf(rb), margin: C.histOf(marg) },
    p_round_defense: C.r3(pDef), p_round_attack: C.r3(pAtk), map_bias: mapBias, p_round: C.r4(pRoundA),
    loser_distribution: rows, totals, sims,
    note: 'cada mitad se simula con su propia probabilidad de ronda. El sesgo del mapa casi no mueve quién gana —los dos equipos juegan los dos lados— pero mueve mucho CUÁNTAS rondas se juegan, que es donde vive el mercado de totales.',
  };
}

// ---- 3 bis) DE LA PROBABILIDAD DE MAPA A LA DE RONDA, POR BISECCIÓN (2-sep) -----------------------------
// LO QUE HABÍA: `clampRound`, una regla lineal (0,5 + (p − 0,5)·0,44) heredada de CS2. Medido en el backtest
// del 2-sep (docs/BACKTESTS_FAMILIAS_2026-09-02.md §4.2): un equipo con p_mapa 0,70 ganaba el mapa simulado el
// 82 % de las veces, y con 0,80 el 90 %. La distribución de rondas nacía de una fuerza que NO era la que el
// propio modelo publicaba, y esa incoherencia —no la duración del mapa— era la "ventaja" de las 80 under que
// no debieron nacer (§4.3). La corrección que sobrevivió al escéptico: buscar el pRound tal que la propia
// simulación reproduzca la probabilidad de mapa (bisección, mismo mecanismo que `calibrateDrag`). Baja el Brier
// del hándicap de rondas −0,0148 (SE 0,0055) sobre los 128 mapas del libro. Se cachea por (p, bias, eco).
const _pRoundCache = new Map();
function pRoundFor(pMap, bias, eco = ECO_DRAG, { sims = 6000, steps = 12, seed = 911 } = {}) {
  const target = C.clamp(pMap, 0.02, 0.98);
  const b = bias == null ? 0.5 : bias;
  const key = [target.toFixed(3), b.toFixed(3), (+eco).toFixed(3)].join('|');
  if (_pRoundCache.has(key)) return _pRoundCache.get(key);
  let lo = 0.20, hi = 0.80;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    const pw = mapRounds(mid, b, { eco, sims, seed }).p_win_a;
    if (pw < target) lo = mid; else hi = mid;
  }
  const out = C.r4((lo + hi) / 2);
  _pRoundCache.set(key, out);
  return out;
}
// la distribución final de un mapa, con el pRound resuelto y 20.000 sims, más el rastro de la inversión
function roundsAt(pMap, bias, { eco = ECO_DRAG, seed = 29 } = {}) {
  const pr = pRoundFor(pMap, bias, eco);
  const R = mapRounds(pr, bias, { eco, seed, sims: 20000 });
  return { ...R, p_round_solved: pr, p_map_target: C.r4(pMap), p_map_sim: R.p_win_a, dist_method: 'bisect' };
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

  const modelPraw = ratings && ratings.elo_a != null && ratings.elo_b != null
    ? C.eloProbability(ratings.elo_a, ratings.elo_b) : null;
  // NIVEL DE SERIE (2-sep, §4.1 y §4.5 del backtest): el Elo de serie no bate al win-rate encogido (Δ Brier
  // −0,0022 con SE 0,0022) y en VCT todo ronda la moneda. Así que la voz propia sobre QUIÉN GANA se templa
  // (temperatura 0,85 sobre el logit) y su peso máximo frente al mercado baja de 0,45 a 0,25. CS2 no cambia:
  // `maxModel` se pasa aquí, no en core.js.
  const LEVEL_TEMPERATURE = 0.85, LEVEL_MAX_MODEL = 0.25;
  const lg = (p) => Math.log(p / (1 - p));
  const sg = (x) => 1 / (1 + Math.exp(-x));
  const modelP = modelPraw != null ? C.r4(sg(LEVEL_TEMPERATURE * lg(C.clamp(modelPraw, 0.02, 0.98)))) : null;
  const anchoredBase = C.anchoredProbability(marketP, modelP, { n: sample, maxModel: LEVEL_MAX_MODEL });
  const anchored = anchoredBase ? { ...anchoredBase, model_p_raw: modelPraw, temperature: LEVEL_TEMPERATURE, max_model: LEVEL_MAX_MODEL } : null;
  const pSeries = anchored ? anchored.p : null;
  const pMap = pSeries != null ? C.seriesToMap(pSeries, bo) : null;

  // ── EL POOL, MEDIDO ────────────────────────────────────────────────────────────────────────────────────
  // El pool escrito a mano envejece con cada acto y ya no coincidía con lo que se juega (listaba Icebox y
  // Abyss, que no aparecen en la muestra, y no listaba Split, Breeze, Pearl ni Fracture, que son cuatro de
  // los siete mapas más jugados). Se lee del circuito cuando hay muestra; si no, queda el escrito.
  let VD = null; try { VD = require('./valorant-data'); } catch { }
  const vdData = VD ? (() => { try { return VD.load(); } catch { return null; } })() : null;
  const poolMed = VD && vdData ? VD.circuitPool({ data: vdData }) : null;
  const POOL = poolMed && poolMed.length >= 5 ? poolMed : MAP_POOL;
  const perfil = (k) => (VD && vdData && k ? VD.mapProfile(k, { data: vdData }) : null);

  const strength = (ratings && ratings.map_strength) || null;
  // 19-ago: sin fuerza por equipo medida el árbol de veto no se puede simular, pero el POOL y su reparto
  // ataque/defensa SÍ son estructura conocida del juego. Antes se devolvía null y la pantalla se quedaba sin
  // su objeto propio; ahora se sirve el pool con su sesgo y se declara que la preferencia por equipo falta.
  const veto = strength ? vetoTree(strength, { bo, pool: POOL, depth: (ratings && ratings.agent_depth) || null }) : {
    structure_only: true,
    likely_maps: POOL.map((m) => ({ map: m.key, name: m.name, p_a: null, bias: m.bias, note: m.note || null })),
    sequence: [], decider: null, pool_version: POOL_VERSION,
    note: 'pool y reparto ataque/defensa del juego (estructura conocida). La preferencia de veto por equipo necesita fuerza por mapa medida: la cosecha de detalle está en marcha y este tablero se completa solo cuando entre.',
  };
  const mapProbs = veto ? veto.likely_maps : null;

  // ── LOS MAPAS SE ANCLAN AL MISMO SITIO QUE LA SERIE (2-sep; réplica de cs2.js) ───────────────────────
  // El mismo fallo que CS2 corrigió el 17-ago seguía vivo aquí: la serie se publicaba anclada al mercado y
  // las rondas se simulaban con la fuerza por mapa SIN anclar (win-rate propio encogido), de modo que todo
  // mercado de MARGEN —hándicap de rondas, rondas por equipo— heredaba una opinión sobre QUIÉN GANA que el
  // backtest dice que no tenemos (§4.1: el favorito de producción ganó el 45 % de los mapas). Se desplazan
  // los logits de `likely_maps[].p_a` por UNA constante, resuelta por bisección, para que la serie SIMULADA
  // sobre esos mapas valga exactamente lo que vale la serie ANCLADA. La FORMA del veto (qué mapa le va mejor
  // a cada equipo) es de GP; el NIVEL lo pone el mercado. Y si el mercado cotiza directamente el mapa —ganador
  // de mapa o hándicap de rondas—, ese precio sin margen es el nivel del mapa 1 y los demás se desplazan
  // alrededor: `anchor.p_map` manda sobre cualquier inversión.
  const pMapDirect = anchor && anchor.p_map != null ? anchor.p_map : null;
  const hasShape = !!(mapProbs && mapProbs.length && mapProbs.some((m) => m.p_a != null));
  const shiftBy = (d) => mapProbs.map((m, i) => (i === 0 && pMapDirect != null ? pMapDirect
    : m.p_a == null ? null : sg(lg(C.clamp(m.p_a, 0.03, 0.97)) + d)));
  let mapShift = 0, shiftBracketed = false;
  if (hasShape && pSeries != null) {
    const serieAt = (d) => C.simulateSeries(0.5, bo, { perMap: shiftBy(d).filter((x) => x != null), n: 2500, seed: 8171 }).p_series_a;
    let lo = -3.5, hi = 3.5;
    if (serieAt(lo) < pSeries && serieAt(hi) > pSeries) {
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (serieAt(mid) < pSeries) lo = mid; else hi = mid; }
      mapShift = (lo + hi) / 2; shiftBracketed = true;
    }
  }
  // con veto simulable: cada mapa conserva su p del modelo y recibe la anclada. Sin veto (p_a nulos) el
  // nivel de cada mapa es el del mercado tal cual: el del mapa 1 si lo cotiza, el implícito de la serie si no.
  const mapProbsA = mapProbs ? mapProbs.map((m, i) => ({
    ...m, p_a_model: m.p_a,
    p_a: i === 0 && pMapDirect != null ? C.r4(pMapDirect)
      : m.p_a == null ? pMap
      : C.r4(sg(lg(C.clamp(m.p_a, 0.03, 0.97)) + mapShift)),
  })) : null;
  const mapAnchoring = hasShape ? {
    shift_logit: C.r3(mapShift),
    bracketed: shiftBracketed,
    p_map_market: pMapDirect != null ? C.r4(pMapDirect) : pMap,
    p_map_market_from: pMapDirect != null ? `mercado directo (${anchor.from})` : 'implícita de la serie anclada',
    p_map_model_mean: C.r4(mapProbs.reduce((a, m) => a + (m.p_a || 0), 0) / mapProbs.length),
    model_vs_market_pp: C.r2(100 * ((mapProbs.reduce((a, m) => a + (m.p_a || 0), 0) / mapProbs.length) - ((pMapDirect != null ? pMapDirect : pMap) || 0))),
    maps: mapProbsA.map((m) => ({ map: m.map, p_a_model: m.p_a_model, p_a: m.p_a })),
    why: 'la FORMA del veto es de GP (qué mapa le va mejor a cada equipo); el NIVEL lo pone el mercado. El backtest del 2-sep midió que la fuerza por mapa propia no acierta más que el mercado sobre quién gana el mapa (favorito de producción 45 % vs 56 % del mercado): sin este anclaje esa opinión se colaba en el hándicap de rondas y en las rondas por equipo como si fuera ventaja.',
  } : null;

  const firstMap = mapProbsA && mapProbsA.length ? mapProbsA[0] : null;
  // ── RONDAS, CALIBRADAS CONTRA EL MAPA QUE SE VA A JUGAR ────────────────────────────────────────────────
  // Antes esto era "el mapa medio de Valorant con un sesgo de autor". Ahora es el primer mapa probable del
  // veto, con SU reparto ataque/defensa medido y SU arrastre económico ajustado a SU prórroga real.
  const perfil1 = firstMap ? perfil(firstMap.map) : null;
  const bias = perfil1 ? perfil1.def_round_share : (firstMap ? firstMap.bias : 0.51);
  let drag1 = calibrateDrag(perfil1);
  // SIN VETO SIMULABLE NO SE SABE QUÉ MAPA SE JUEGA. El perfil de rondas sigue MEDIDO —eso no cambia— pero
  // se está aplicando el del mapa más jugado a un mapa que puede ser otro. Ese desconocimiento no se calla:
  // se suma en cuadratura al residuo de calibración la dispersión de rondas medias ENTRE mapas del pool, que
  // es exactamente lo que se puede equivocar uno al no saber cuál sale. Y ese residuo es lo que después cobra
  // `calibrationPp` en store.js: si la ventaja no supera nuestro propio error, no hay pick.
  if (!strength && drag1.fitted && POOL.length > 2) {
    const ms = POOL.map((m) => perfil(m.key)).filter((x) => x && x.mean_rounds != null).map((x) => x.mean_rounds);
    if (ms.length > 2) {
      const mu = ms.reduce((a, b) => a + b, 0) / ms.length;
      const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mu) ** 2, 0) / ms.length);
      drag1 = { ...drag1, map_assumed: true, map_spread_rounds: C.r2(sd),
        rounds_residual: C.r2(Math.sign(drag1.rounds_residual || 1) * Math.sqrt((drag1.rounds_residual || 0) ** 2 + sd * sd)) };
    }
  }
  // la p del mapa 1 es la ANCLADA (mercado directo si lo hay; si no, la del veto desplazada al nivel de la
  // serie; sin veto, la implícita de la serie) y la p de ronda sale de invertir la propia simulación.
  const pMap1 = pMap == null ? null : (firstMap && firstMap.p_a != null ? firstMap.p_a : pMap);
  const rounds = pMap1 != null ? {
    ...roundsAt(pMap1, bias, { eco: drag1.eco }),
    map: firstMap ? firstMap.map : null, map_name: firstMap ? firstMap.name : null,
    p_map_a: pMap1, p_map_a_model: firstMap ? firstMap.p_a_model : null,
    calibration: drag1, observed: perfil1, measured: !!(perfil1 && perfil1.measured),
  } : null;

  // ── UNA DISTRIBUCIÓN POR MAPA DE LA SERIE ──────────────────────────────────────────────────────────────
  // El mismo fallo que se corrigió en CS2 seguía vivo aquí: la casa cotiza el total de rondas del mapa 1, del
  // 2 y del 3 por separado y el motor devolvía una sola distribución. Tres precios distintos contra una
  // misma opinión no son tres oportunidades. Cada mapa lleva ahora su perfil, su arrastre y su reparto.
  // solo con veto simulable: sin fuerza por mapa medida el "mapa 3" del mercado no es el tercer mapa del
  // pool por uso, es un mapa desconocido — y cotizar la línea del 3 contra el tercero más jugado sería
  // inventarse el orden. Sin veto, esta tabla no existe y esas líneas se quedan sin valorar. Correcto.
  const roundsByMap = {};
  if (strength && mapProbsA && mapProbsA.length && pMap != null) {
    mapProbsA.forEach((mp, i) => {
      const prof = perfil(mp.map);
      const d = calibrateDrag(prof);
      const b = prof ? prof.def_round_share : mp.bias;
      const pA = mp.p_a != null ? mp.p_a : pMap;
      roundsByMap[i + 1] = {
        ...roundsAt(pA, b, { eco: d.eco, seed: 29 + i * 101 }),
        map: mp.map, map_name: mp.name, order: i + 1,
        p_map_a: pA, p_map_a_model: mp.p_a_model != null ? mp.p_a_model : null,
        calibration: d, observed: prof, measured: !!(prof && prof.measured),
      };
    });
  }

  const unc = C.uncertainty({
    p: pSeries != null ? pSeries : 0.5, sampleMatches: sample,
    marketBooks: cons ? cons.books : 0,
    // Valorant es el único de los cuatro al que todavía le falta el detalle: la cosecha de mapas y
    // scoreboard está moliendo. Mientras no esté, se cobra — y cuando entre, esta lista se vacía sola.
    missing: [].concat(strength ? [] : ['fuerza por mapa medida'], rounds && rounds.measured ? [] : ['perfil de rondas por mapa'], ['composiciones de agentes']),
  });

  // la serie también se simula con los mapas ANCLADOS: con `perMap`, simulateSeries ignora `pMap` y manda la
  // lista, así que pasarle los mapas sin anclar era simular un partido distinto del que se publicaba.
  const sim = pMap != null ? C.simulateSeries(pMap, bo, { perMap: hasShape ? mapProbsA.map((m) => m.p_a) : null }) : null;

  return {
    game: 'valorant', bo,
    probability: anchored, market: cons, market_anchor: anchor ? { from: anchor.from, family: anchor.family, direct: anchor.direct, p_map: anchor.p_map != null ? anchor.p_map : null } : null, simulation: sim,
    veto, map_anchoring: mapAnchoring, rounds, rounds_by_map: Object.keys(roundsByMap).length ? roundsByMap : null, economy: ECONOMY_MODEL,
    composition: compositionModel(firstMap ? firstMap.map : null, POOL),
    uncertainty: unc,
    what_matters: whatMatters({ anchored, veto, rounds, unc, bo }),
    map_pool: POOL, pool_version: poolMed ? 'medido/' + POOL_VERSION : POOL_VERSION,
    bias_note: poolMed ? BIAS_MEDIDO : BIAS_NOTE,
    native: GAME.native, edge_families: GAME.edge_families,
  };
}
// `clampRound` (0,5 + (p − 0,5)·0,44) se retiró el 2-sep: ver `pRoundFor`. CS2 conserva la suya.

module.exports = { GAME, MAP_POOL, POOL_VERSION, BIAS_NOTE, ROLES, vetoTree, compositionModel, mapRounds, pRoundFor, roundsAt, ECONOMY_MODEL, whatMatters, analyze };
