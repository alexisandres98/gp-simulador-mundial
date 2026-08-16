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
// frecuente de lo que sale del binomio** (16,1 % con moneda justa frente al ~11 % real del circuito). Sin
// este término el modelo vendía prórrogas caras de forma sistemática, que es justo el mercado que aquí se
// quiere atacar.
const ECO_DRAG = 0.055;

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
function whatMatters({ anchored, veto, mapProbs, unc, bo }) {
  const out = [];
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
  return out.slice(0, 5).map((x, i) => ({ ...x, rank: i + 1 }));
}

// ---- 5) FACHADA ------------------------------------------------------------------------------------------
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
  const veto = strength ? vetoTree(strength, { bo }) : null;
  const mapProbs = veto ? veto.likely_maps : null;
  const poolProbs = strength ? MAP_POOL.map((m) => strength.a[m.key]).filter((x) => x != null) : null;
  const impact = mapProbs ? vetoImpact(poolProbs, mapProbs, bo, { anchoredP: pSeries }) : null;

  const unc = C.uncertainty({ p: pSeries != null ? pSeries : 0.5, sampleMatches: sample,
    marketBooks: cons ? cons.books : 0,
    missing: [].concat(strength ? [] : ['fuerza por mapa'], ['datos de ronda (demos)']) });

  const sim = pMap != null ? C.simulateSeries(pMap, bo, { perMap: mapProbs ? mapProbs.map((m) => m.p_a) : null }) : null;
  const rounds = pMap != null ? mapRounds(clampRound(pMap)) : null;

  return {
    game: 'cs2', bo,
    probability: anchored, market: cons, market_anchor: anchor ? { from: anchor.from, family: anchor.family, direct: anchor.direct, p_map: anchor.p_map != null ? anchor.p_map : null } : null, simulation: sim,
    veto, veto_impact: impact, rounds, economy: ECONOMY_MODEL,
    uncertainty: unc,
    what_matters: whatMatters({ anchored, veto: impact, mapProbs, unc, bo }),
    map_pool: MAP_POOL, pool_version: POOL_VERSION,
    native: GAME.native, edge_families: GAME.edge_families,
  };
}
// la probabilidad de RONDA no es la de mapa: un 60 % de mapa es ~53 % de ronda. Se comprime hacia el centro.
const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.42, 0.32, 0.68);

module.exports = { GAME, MAP_POOL, POOL_VERSION, vetoTree, vetoImpact, mapRounds, ECONOMY_MODEL, whatMatters, analyze };
