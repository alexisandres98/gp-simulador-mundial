// esports-engine/cs2.js — COUNTER-STRIKE 2 (16-ago). Blueprint capítulos 05-12.
//
// LO QUE HACE A CS2 DISTINTO DE LOS OTROS TRES, y por lo que este archivo existe en vez de una función
// genérica con un parámetro: **la serie se decide antes de empezar, en el veto**. Ningún otro de los cuatro
// juegos tiene un mecanismo donde los equipos ELIGEN el terreno y con ello mueven la probabilidad varios
// puntos porcentuales antes del primer disparo. El blueprint lo llama "probablemente una de las features
// bandera" y tiene razón: es el módulo que no se puede copiar de otro deporte.
//
// Los otros dos rasgos nativos: la ronda como unidad económica (eco / force / full buy y su conversión) y
// la asimetría T/CT, que en algunos mapas vale más que la diferencia de nivel entre los equipos.
//
// ── LO QUE HOY SE PUEDE Y LO QUE NO, SIN ADORNOS ─────────────────────────────────────────────────────────
// El blueprint pide todo esto desde demos .dem parseadas con Awpy/demoparser2. GP **no tiene acceso a demos
// todavía** (FACEIT Downloads necesita solicitud aprobada), así que aquí NO hay heatmaps, ni posiciones, ni
// tiempos de rotación. Lo que sí hay es la estructura completa —pool de mapas, veto, rondas, economía— con
// las probabilidades que el mercado y nuestro histórico permiten estimar, y cada hueco marcado como hueco.
// Cuando lleguen las demos, entran por aquí sin rehacer el producto. Inventar un heatmap sin demos sería
// exactamente la "fake precision" que el blueprint prohíbe en el módulo 244.
'use strict';

const C = require('./core');

// El active duty pool. Es un dato de Valve y cambia con las actualizaciones: se versiona, no se hardcodea
// para siempre (blueprint 7: "nunca sobrescribir estados históricos").
const MAP_POOL = [
  { key: 'mirage', name: 'Mirage' },
  { key: 'inferno', name: 'Inferno' },
  { key: 'nuke', name: 'Nuke' },
  { key: 'ancient', name: 'Ancient' },
  { key: 'dust2', name: 'Dust II' },
  { key: 'anubis', name: 'Anubis' },
  { key: 'train', name: 'Train' },
];
const POOL_VERSION = '2026-08';

const GAME = {
  key: 'cs2', label: 'Counter-Strike 2', short: 'CS2',
  unit: 'mapa', unit_plural: 'mapas', default_bo: 3,
  // las familias que este juego cotiza de verdad, medidas contra el proveedor el 16-ago
  families: ['SERIE', 'MAPA', 'HANDICAP', 'TOTAL_MAPAS', 'RONDAS', 'MARCADOR'],
  // dónde el motor puede aportar estructura que el precio no tiene (la doctrina: derivados, no ganador)
  edge_families: ['TOTAL_MAPAS', 'RONDAS', 'HANDICAP'],
  native: ['Veto de mapas', 'Economía por ronda', 'Asimetría T/CT'],
};

// ---- 1) VETO ENGINE (blueprint 42-46) -------------------------------------------------------------------
// El veto de un BO3 estándar: ban A, ban B, pick A, pick B, ban A, ban B, decider. Se modela como ÁRBOL de
// ramas con probabilidad, no como una secuencia adivinada — que es la diferencia entre un pronóstico y una
// corazonada. Sin histórico de vetos (no hay fuente accesible todavía) las probabilidades de ban salen de
// la fuerza relativa en cada mapa: se banea lo que más duele.
function vetoTree(mapStrength, { bo = 3, pool = MAP_POOL } = {}) {
  const maps = pool.map((m) => ({
    ...m,
    a: mapStrength.a[m.key] != null ? mapStrength.a[m.key] : null,
    b: mapStrength.b[m.key] != null ? mapStrength.b[m.key] : null,
  })).filter((m) => m.a != null && m.b != null);
  if (maps.length < 3) return null;

  // Probabilidad de que A banee el mapa m: crece con lo malo que es para A frente a B.
  const banPref = (side) => {
    const w = maps.map((m) => {
      const edge = side === 'a' ? (m.a - m.b) : (m.b - m.a);   // >0 = me conviene
      return Math.exp(-edge * 6);                              // banear lo que me perjudica
    });
    const s = w.reduce((x, y) => x + y, 0) || 1;
    return maps.map((m, i) => ({ map: m.key, name: m.name, p: C.r3(w[i] / s) }));
  };
  const pickPref = (side) => {
    const w = maps.map((m) => {
      const edge = side === 'a' ? (m.a - m.b) : (m.b - m.a);
      return Math.exp(edge * 6);                               // elegir lo que me favorece
    });
    const s = w.reduce((x, y) => x + y, 0) || 1;
    return maps.map((m, i) => ({ map: m.key, name: m.name, p: C.r3(w[i] / s) }));
  };

  // La rama más probable, que es la que la UI enseña por defecto; el árbol completo queda disponible.
  const banA = banPref('a'), banB = banPref('b'), pickA = pickPref('a'), pickB = pickPref('b');
  const top = (arr, excl) => arr.filter((x) => !excl.has(x.map)).sort((x, y) => y.p - x.p)[0] || null;
  const used = new Set(), seq = [];
  const step = (who, kind, arr) => {
    const t = top(arr, used); if (!t) return;
    used.add(t.map); seq.push({ who, kind, map: t.map, name: t.name, p: t.p });
  };
  if (bo === 3) { step('a', 'ban', banA); step('b', 'ban', banB); step('a', 'pick', pickA); step('b', 'pick', pickB); step('a', 'ban', banA); step('b', 'ban', banB); }
  else if (bo === 1) { step('a', 'ban', banA); step('b', 'ban', banB); step('a', 'ban', banA); step('b', 'ban', banB); step('a', 'ban', banA); step('b', 'ban', banB); }
  else { step('a', 'ban', banA); step('b', 'ban', banB); step('a', 'pick', pickA); step('b', 'pick', pickB); step('a', 'pick', pickA); step('b', 'pick', pickB); }
  const decider = maps.filter((m) => !used.has(m.key))[0] || null;
  const played = seq.filter((s) => s.kind === 'pick').map((s) => s.key || s.map);
  if (decider) played.push(decider.key);

  return {
    sequence: seq,
    decider: decider ? { map: decider.key, name: decider.name, a: decider.a, b: decider.b } : null,
    likely_maps: played.map((k) => {
      const m = maps.find((x) => x.key === k);
      return m ? { map: m.key, name: m.name, p_a: C.r3(m.a) } : null;
    }).filter(Boolean),
    ban_probabilities: { a: banA, b: banB },
    pick_probabilities: { a: pickA, b: pickB },
    pool_version: POOL_VERSION,
    note: 'sin histórico de vetos accesible, las preferencias se derivan de la fuerza relativa por mapa: se banea lo que perjudica y se elige lo que favorece. Cuando haya histórico de veto real, este árbol se reemplaza sin tocar el resto.',
  };
}

// ---- 2) IMPACTO DEL VETO (blueprint 46, 151) ------------------------------------------------------------
// La cifra que el blueprint pone de ejemplo de producto: cuánto movió el veto la probabilidad, en puntos, y
// por culpa de qué mapa. Es lo que convierte una tabla de mapas en una historia.
// LA REFERENCIA IMPORTA MÁS QUE EL NÚMERO. La primera versión de esto comparaba la serie después del veto
// contra la probabilidad ANCLADA AL MERCADO, y daba −8,67 pp en un caso donde el veto era casi neutro: lo
// que medía no era el veto sino la distancia entre dos escalas distintas (el precio de la casa y nuestra
// fuerza por mapa). El veto solo se puede medir contra sí mismo: **serie sobre el pool entero** frente a
// **serie sobre los mapas que de verdad se van a jugar**, las dos con la misma escala.
function vetoImpact(poolProbs, mapProbs, bo, { anchoredP = null } = {}) {
  if (!mapProbs || !mapProbs.length || !poolProbs || !poolProbs.length) return null;
  const flat = poolProbs.reduce((s, p) => s + p, 0) / poolProbs.length;
  const pre = C.simulateSeries(flat, bo, { n: 12000, seed: 811 }).p_series_a;
  const avg = mapProbs.reduce((s, m) => s + m.p_a, 0) / mapProbs.length;
  const post = C.simulateSeries(avg, bo, { perMap: mapProbs.map((m) => m.p_a), n: 12000, seed: 811 }).p_series_a;
  const shift = (post - pre) * 100;
  const contrib = mapProbs.map((m) => ({
    map: m.map, name: m.name, p_a: C.r3(m.p_a), pp: C.r2((m.p_a - flat) * 100),
  })).sort((x, y) => Math.abs(y.pp) - Math.abs(x.pp));
  return {
    pre_p: C.r4(pre), post_p: C.r4(post), shift_pp: C.r2(shift),
    baseline: 'serie jugada sobre el pool entero con la misma escala de fuerza por mapa',
    flat_map_p: C.r3(flat),
    // el mercado se enseña al lado, pero NO como referencia del veto: es otra escala y mezclarlas engaña
    market_p: anchoredP != null ? C.r4(anchoredP) : null,
    verdict: shift > 2.5 ? 'FAVORABLE' : shift < -2.5 ? 'DESFAVORABLE' : 'NEUTRO',
    by_map: contrib,
  };
}

// ---- 3) RONDAS Y ECONOMÍA (blueprint 51-60, 80) ---------------------------------------------------------
// El mapa se juega a 13 con prórroga. La distribución de rondas del perdedor es lo que sostiene el mercado
// de totales, que es una de las familias donde este motor puede aportar de verdad.
// EL ARRASTRE ECONÓMICO NO ES UN ADORNO, es lo que hace que la distribución de rondas tenga la forma que
// tiene. Quien pierde una ronda entra a la siguiente con menos dinero, y eso encadena rachas. Consecuencia
// medible: los marcadores se separan más de lo que predice una moneda independiente y **el 12-12 es MENOS
// frecuente de lo que sale del binomio** (16,1 % con moneda justa frente al ~11 % real del circuito).
//
// EL VALOR YA NO SE ELIGE A OJO. Con el histórico propio (`data/esports/cs2/maps.json`) el arrastre se
// AJUSTA POR MAPA para reproducir la tasa de prórroga que ese mapa tiene de verdad, que no es la misma en
// todos: medido sobre el circuito, Overpass va al 8,2 % y Cache al 13,9 %. Este 0,055 queda solo como
// respaldo para un mapa sin muestra suficiente.
const ECO_DRAG = 0.055;

// Ajuste por mapa: se busca el arrastre que hace que la prórroga simulada coincida con la observada. Es una
// calibración contra datos, no una constante de autor, y se cachea porque cuesta unas cuantas simulaciones.
const _dragCache = new Map();
function calibrateDrag(profile) {
  if (!profile || !profile.measured || profile.n < 80 || !(profile.overtime_p > 0)) return { eco: ECO_DRAG, fitted: false, target_ot: null };
  const key = profile.map + ':' + profile.n;
  if (_dragCache.has(key)) return _dragCache.get(key);
  // la prórroga baja de forma monótona con el arrastre, así que basta una bisección
  let lo = 0, hi = 0.16;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const ot = mapRounds(0.5, { eco: mid, sims: 6000, seed: 4127 }).overtime_p;
    if (ot > profile.overtime_p) lo = mid; else hi = mid;
  }
  const eco = C.r3((lo + hi) / 2);
  const check = mapRounds(0.5, { eco, sims: 12000, seed: 4127 });
  const out = {
    eco, fitted: true,
    target_ot: profile.overtime_p, got_ot: check.overtime_p,
    target_rounds: profile.mean_rounds, got_rounds: check.mean_rounds,
    // el ajuste tiene UN grado de libertad y DOS objetivos: se ajusta a la prórroga y se PUBLICA el residuo
    // en rondas medias en vez de esconderlo. Si ese residuo crece, el modelo de ronda se queda corto y hay
    // que cambiarlo, no re-tocar el arrastre.
    rounds_residual: C.r2(check.mean_rounds - profile.mean_rounds),
    n: profile.n,
  };
  _dragCache.set(key, out);
  return out;
}

function mapRounds(pRoundA, { target = 13, sims = 20000, seed = 23, eco = ECO_DRAG } = {}) {
  const rnd = C.rng(seed);
  let sumRounds = 0; const dist = {}; let otN = 0;
  const tot = [], ra = [], rb = [], marg = [];
  // una ronda con arrastre: `st` es el signo y tamaño de la racha en curso
  // el SIGNO importa y es fácil de equivocar: quien GANÓ la ronda anterior llega con dinero y quien la
  // perdió llega pobre, así que la racha se refuerza (`+`). Con el signo al revés el modelo revertía a la
  // media, comprimía los marcadores hacia el empate y disparaba la prórroga al 19 % en vez de bajarla.
  const round = (st) => rnd() < C.clamp(pRoundA + st * eco, 0.05, 0.95);
  for (let i = 0; i < sims; i++) {
    let a = 0, b = 0, st = 0;
    // REGULACIÓN: 24 rondas como máximo. Llegar a 12-12 NO se resuelve jugando la 25 — se va a prórroga,
    // que es una estructura distinta. Modelarlo como carrera a 13 hacía imposible el 12-12 y por eso la
    // tasa de prórroga salía exactamente 0, que es un imposible del juego, no un resultado.
    for (let r = 0; r < 24 && a < target && b < target; r++) {
      if (round(st)) { a++; st = Math.min(2, st <= 0 ? 1 : st + 1); }
      else { b++; st = Math.max(-2, st >= 0 ? -1 : st - 1); }
    }
    // PRÓRROGA CS2: bloques MR3 (6 rondas, primero a 4). Si el bloque acaba 3-3, otro bloque.
    let ot = 0;
    while (a === b && a >= target - 1 && ot <= 6) {
      ot++;
      let oa = 0, ob = 0;
      for (let r = 0; r < 6 && oa < 4 && ob < 4; r++) { if (round(st)) { oa++; st = 1; } else { ob++; st = -1; } }
      a += oa; b += ob;
      if (oa !== ob) break;   // el bloque decidió; si acabó 3-3 se juega otro
    }
    if (ot) otN++;
    const t = a + b; sumRounds += t;
    tot.push(t); ra.push(a); rb.push(b); marg.push(a - b);
    const loser = Math.min(a, b);
    dist[loser] = (dist[loser] || 0) + 1;
  }
  const rows = Object.entries(dist).map(([k, v]) => ({ loser_rounds: +k, p: C.r4(v / sims) }))
    .sort((x, y) => x.loser_rounds - y.loser_rounds);
  const mean = sumRounds / sims;
  const srt = tot.slice().sort((x, y) => x - y);
  const overs = {};
  for (const line of [20.5, 21.5, 22.5, 23.5, 24.5, 25.5, 26.5]) {
    overs['over_' + String(line).replace('.', '_')] = C.r4(srt.filter((x) => x > line).length / srt.length);
  }
  return {
    mean_rounds: C.r2(mean), overtime_p: C.r4(otN / sims), loser_distribution: rows, totals: overs, sims,
    dist: { total: C.histOf(tot), home: C.histOf(ra), away: C.histOf(rb), margin: C.histOf(marg) },
  };
}

// Clasificación de compra y su conversión. Sin demos no hay valor de equipamiento real, así que esto
// describe el MODELO (qué significa cada tipo de ronda y cuánto suele convertir en el circuito) y queda
// listo para recibir datos reales. Se marca como estructura, no como medición del equipo.
const ECONOMY_MODEL = {
  buys: [
    { key: 'pistol', label: 'Pistola', note: 'rondas 1 y 13; altísima varianza y efecto arrastre en las dos siguientes' },
    { key: 'eco', label: 'Eco', note: 'se ahorra; ganar aquí es sorpresa, no plan' },
    { key: 'force', label: 'Force', note: 'compra forzada: gana rondas y rompe la economía del siguiente ciclo' },
    { key: 'full', label: 'Full buy', note: 'la ronda estándar donde se mide de verdad la calidad' },
    { key: 'anti_eco', label: 'Anti-eco', note: 'ventaja material; perderla cuesta doble' },
  ],
  note: 'estructura del modelo económico. Los porcentajes de conversión por equipo necesitan datos de ronda (demos .dem), que GP todavía no tiene autorizados: se muestran cuando existan, no antes.',
};

// ---- 4) LO QUE IMPORTA (blueprint 122, 147) -------------------------------------------------------------
// Cinco factores cuantificados, no cinco frases. Cada uno con su impacto en puntos y su procedencia.
function whatMatters({ anchored, veto, mapProbs, unc, bo, rounds, cardA, cardB }) {
  const out = [];
  if (rounds && rounds.measured && rounds.observed) {
    out.push({ rank: 1, pp: null, driver: 'mapa',
      text: `${rounds.map_name} se juega a ${rounds.observed.mean_rounds} rondas de media y va a prórroga el ${(100 * rounds.observed.overtime_p).toFixed(1)} % de las veces — medido sobre ${rounds.observed.n} mapas del circuito, no estimado.` });
  }
  if (cardA && cardB && cardA.maps.length && cardB.maps.length) {
    const ba = cardA.maps[0], bb = cardB.maps[0];
    out.push({ rank: out.length + 1, pp: null, driver: 'historial',
      text: `${cardA.name} es más fuerte en ${MAP_NAMES[ba.map] || ba.map} (${Math.round(100 * ba.wr)} % en ${ba.n} mapas) y ${cardB.name} en ${MAP_NAMES[bb.map] || bb.map} (${Math.round(100 * bb.wr)} % en ${bb.n}).` });
  }
  if (veto && veto.shift_pp != null && Math.abs(veto.shift_pp) >= 1) {
    out.push({ rank: out.length + 1, pp: veto.shift_pp,
      text: `El reparto de mapas probable ${veto.shift_pp > 0 ? 'favorece' : 'perjudica'} al favorito (${veto.verdict.toLowerCase()}).`,
      driver: 'veto' });
  }
  if (mapProbs && mapProbs.length) {
    const best = mapProbs.slice().sort((x, y) => y.p_a - x.p_a)[0];
    const worst = mapProbs.slice().sort((x, y) => x.p_a - y.p_a)[0];
    if (best && worst && best.map !== worst.map) {
      out.push({ rank: out.length + 1, pp: C.r2((best.p_a - worst.p_a) * 100),
        text: `El pool no es plano: ${best.name} (${Math.round(100 * best.p_a)}%) contra ${worst.name} (${Math.round(100 * worst.p_a)}%).`,
        driver: 'mapas' });
    }
  }
  if (anchored && anchored.w_model != null) {
    out.push({ rank: out.length + 1, pp: null,
      text: anchored.w_model === 0
        ? 'Sin muestra propia todavía: la probabilidad es la del mercado sin margen, no una opinión de GP.'
        : `GP pesa un ${Math.round(100 * anchored.w_model)}% sobre el consenso; el resto lo pone el mercado.`,
      driver: 'anclaje' });
  }
  if (unc) {
    out.push({ rank: out.length + 1, pp: unc.epistemic_pp,
      text: `Lo que GP no sabe vale ±${unc.epistemic_pp} pp — y esa es la vara que cualquier ventaja tiene que superar.`,
      driver: 'incertidumbre' });
  }
  out.push({ rank: out.length + 1, pp: null,
    text: `Serie al mejor de ${bo}: el formato reparte la varianza y castiga a quien depende de un solo mapa.`,
    driver: 'formato' });
  return out.slice(0, 6).map((x, i) => ({ ...x, rank: i + 1 }));
}

// ---- 5) FACHADA ------------------------------------------------------------------------------------------
// AHORA EL MOTOR VA A BUSCAR SUS PROPIOS DATOS. Antes esperaba que alguien le pasara `ratings.map_strength`
// y, como nadie los tenía, el árbol de veto —la feature bandera de CS2— nunca se dibujaba. Con el histórico
// propio cosechado, la fuerza por mapa sale de aquí dentro: nombres de equipo → ids de GP → tasa de victoria
// por mapa medida, encogida y con decaimiento. Lo que se pase por fuera sigue mandando (sirve para probar).
function analyze({ market, ratings, bo = 3, sample = 0, teams = null }) {
  const CD = require('./cs2-data');
  const store = CD.load();
  const bookRows = (market && market.markets) || [];
  // El ancla NO es solo la familia `SERIE`: la mayoría de partidos con mercado abierto no la cotizan y sí
  // cotizan marcador, hándicap o ganador de mapa. `marketAnchor` recorre esas fuentes en orden y dice de
  // cuál salió — ver la nota larga en core.js.
  const anchor = C.marketAnchor(bookRows, bo);
  const cons = anchor ? anchor.market : null;
  const marketP = anchor ? anchor.p : null;

  // ── FUERZA POR MAPA, DE NUESTRA PROPIA BASE ────────────────────────────────────────────────────────────
  const idA = teams ? CD.resolveTeam(teams.a) : null;
  const idB = teams ? CD.resolveTeam(teams.b) : null;
  const cardA = idA ? CD.teamCard(idA, { data: store }) : null;
  const cardB = idB ? CD.teamCard(idB, { data: store }) : null;
  const pool = (store.pool && store.pool.length ? store.pool : MAP_POOL.map((m) => m.key));

  let strength = (ratings && ratings.map_strength) || null;
  let matchup = null;
  if (!strength && idA && idB) {
    matchup = CD.matchupMaps(idA, idB, { data: store, pool });
    const withData = matchup.filter((m) => m.p_a != null);
    if (withData.length >= 3) {
      strength = { a: {}, b: {} };
      for (const m of withData) { strength.a[m.map] = m.p_a; strength.b[m.map] = C.r3(1 - m.p_a); }
    }
  }
  const poolObjs = pool.map((k) => ({ key: k, name: MAP_NAMES[k] || cap(k) }));
  const veto = strength ? vetoTree(strength, { bo, pool: poolObjs }) : null;
  const mapProbs = veto ? veto.likely_maps : null;
  const poolProbs = strength ? pool.map((k) => strength.a[k]).filter((x) => x != null) : null;

  // ── LA PROBABILIDAD PROPIA DE GP, QUE YA NO DEPENDE DE QUE HAYA MERCADO ───────────────────────────────
  // Este es el cambio que separa a un lector de precios de una plataforma de inteligencia. Con el histórico
  // propio, la probabilidad de serie sale de simular los mapas que el veto va a dejar en pie — sin que
  // ninguna casa tenga que opinar primero. Antes, un partido sin mercado abierto enseñaba un guion; ahora
  // enseña la estimación de GP y dice que es suya.
  //
  // Sigue mandando el mercado cuando existe, y eso NO es contradicción: el mercado es el mejor estimador
  // conocido del ganador y batirlo ahí es donde esta casa ya perdió dinero dos veces. Pero cuando el mercado
  // calla, callar nosotros también sería desperdiciar la base que acabamos de construir.
  let ownP = null;
  if (mapProbs && mapProbs.length >= 2) {
    ownP = C.simulateSeries(
      mapProbs.reduce((a, m) => a + m.p_a, 0) / mapProbs.length, bo,
      { perMap: mapProbs.map((m) => m.p_a), n: 20000, seed: 5501 },
    ).p_series_a;
  }
  const eloP = ratings && ratings.elo_a != null && ratings.elo_b != null
    ? C.eloProbability(ratings.elo_a, ratings.elo_b) : null;
  const modelP = ownP != null ? ownP : eloP;
  // la muestra que da peso al modelo es la del PAR: los mapas del que menos tiene
  const ownSample = Math.max(sample, Math.min(cardA ? cardA.n : 0, cardB ? cardB.n : 0));
  const anchored = C.anchoredProbability(marketP, modelP, { n: ownSample });
  const pSeries = anchored ? anchored.p : null;
  const pMap = pSeries != null ? C.seriesToMap(pSeries, bo) : null;

  const impact = mapProbs ? vetoImpact(poolProbs, mapProbs, bo, { anchoredP: pSeries }) : null;

  // ── RONDAS, CALIBRADAS CONTRA EL MAPA QUE SE VA A JUGAR ───────────────────────────────────────────────
  // Ya no es "el mapa medio de CS2": es el primer mapa probable del veto, con SU perfil medido y SU arrastre
  // económico ajustado para reproducir SU tasa de prórroga real.
  const firstMap = mapProbs && mapProbs.length ? mapProbs[0].map : (pool[0] || null);
  const profile = firstMap ? CD.mapProfile(firstMap, { data: store }) : null;
  const drag = calibrateDrag(profile);
  const pRoundBase = mapProbs && mapProbs.length && mapProbs[0].p_a != null ? mapProbs[0].p_a : pMap;
  const rounds = pRoundBase != null ? {
    ...mapRounds(clampRound(pRoundBase), { eco: drag.eco }),
    map: firstMap, map_name: MAP_NAMES[firstMap] || cap(firstMap),
    calibration: drag, observed: profile,
    measured: !!(profile && profile.measured),
  } : null;

  const missing = [].concat(strength ? [] : ['fuerza por mapa'], profile ? [] : ['perfil de ronda del mapa'], ['datos de ronda (demos)']);
  const unc = C.uncertainty({ p: pSeries != null ? pSeries : 0.5,
    sampleMatches: ownSample, marketBooks: cons ? cons.books : 0, missing });

  const sim = pMap != null ? C.simulateSeries(pMap, bo, { perMap: mapProbs ? mapProbs.map((m) => m.p_a) : null }) : null;

  return {
    game: 'cs2', bo,
    probability: anchored, market: cons, market_anchor: anchor ? { from: anchor.from, family: anchor.family, direct: anchor.direct, p_map: anchor.p_map != null ? anchor.p_map : null } : null, simulation: sim,
    veto, veto_impact: impact, rounds, economy: ECONOMY_MODEL,
    // la ficha de cada equipo con su logo y su historial por mapa: es lo que da cara al producto
    teams: { a: cardA, b: cardB, resolved: !!(idA && idB) },
    matchup,
    // el bloque de "modelo propio": de dónde salió la probabilidad y con qué peso
    model_probability: modelP != null ? {
      p: C.r4(modelP),
      from: ownP != null ? 'simulación de la serie sobre la fuerza por mapa medida' : 'Elo del par',
      sample_maps: ownSample,
      standalone: marketP == null,
    } : null,
    dataset: store.available ? {
      available: true,
      at: store.at, teams: Object.keys(store.teamMaps).length,
      games: store.meta && store.meta.coverage ? store.meta.coverage.games : null,
      pool,
      note: 'fuerza por mapa, distribución de rondas y prórroga MEDIDAS sobre el histórico propio de GP, no supuestas.',
    } : { available: false, note: 'todavía no hay histórico propio cosechado: ejecutar scripts/cs2-harvest.js' },
    uncertainty: unc,
    what_matters: whatMatters({ anchored, veto: impact, mapProbs, unc, bo, rounds, cardA, cardB }),
    map_pool: poolObjs, pool_version: POOL_VERSION,
    native: GAME.native, edge_families: GAME.edge_families,
  };
}
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const MAP_NAMES = { mirage: 'Mirage', inferno: 'Inferno', nuke: 'Nuke', ancient: 'Ancient', dust2: 'Dust II', anubis: 'Anubis', train: 'Train', overpass: 'Overpass', cache: 'Cache', vertigo: 'Vertigo' };
// la probabilidad de RONDA no es la de mapa: un 60 % de mapa es ~53 % de ronda. Se comprime hacia el centro.
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.42, 0.32, 0.68);

module.exports = { GAME, MAP_POOL, MAP_NAMES, POOL_VERSION, vetoTree, vetoImpact, mapRounds, calibrateDrag, ECONOMY_MODEL, whatMatters, analyze };
