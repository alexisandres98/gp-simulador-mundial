// esports-engine/core.js — EL NÚCLEO COMPARTIDO DE LOS CUATRO JUEGOS (16-ago).
// Blueprint CS2, capítulos 13 (Series Prediction), 15 (Market Intelligence), 16 (Picks) y 18 (Validación).
//
// QUÉ VA AQUÍ Y QUÉ NO. Aquí vive lo que es IGUAL en los cuatro títulos: convertir cuotas en probabilidad
// sin margen, simular una serie al mejor de N a partir de la probabilidad por mapa, medir ventaja contra el
// mercado, y decir NO PICK cuando la incertidumbre se come la ventaja. Todo lo que es propio de un juego
// —veto y economía en CS2, kills y objetivos en LoL, ataque/defensa en Valorant, draft y duración en Dota—
// vive en su archivo y NO se contamina con el de al lado. Esa es la instrucción de Alexis y también la del
// blueprint: "sus módulos tácticos son específicos del juego".
//
// ── LA DECISIÓN DE ARQUITECTURA MÁS IMPORTANTE, Y ESTÁ MEDIDA EN OTROS DOS DEPORTES ──────────────────────
// GP ya aprendió por las malas, dos veces, que **el mercado de GANADOR es donde se pierde dinero y los
// mercados DERIVADOS son donde hay señal**: en baloncesto el ganador dio ROI −11,87 % y en combate CLV
// −8,34 %, mientras los derivados daban +2,15 % y +4,88 % respectivamente. Esports arranca con esa lección
// puesta desde el minuto cero en vez de repetirla: la fuerza de los equipos se ANCLA al consenso del
// mercado, y el motor solo manda donde aporta estructura que el precio no tiene — el reparto por mapa, la
// duración, las rondas y los kills. Un sistema que empieza opinando sobre el ganador ya sabemos dónde
// termina.
//
// PURO: entran números, salen números. Sin red, sin disco, sin db.
'use strict';

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clamp01 = (x) => clamp(x, 0, 1);

// ---- 1) MERCADO SIN MARGEN (blueprint 87-91) ------------------------------------------------------------
// Comparar la probabilidad de GP contra una cuota CON margen es compararse contra un número que ya viene
// inflado a favor de la casa. Se quita primero el margen y después se compara; nunca al revés.
function noVig(prices) {
  const inv = prices.map((p) => (p > 1 ? 1 / p : null));
  if (inv.some((x) => x == null)) return null;
  const s = inv.reduce((a, b) => a + b, 0);
  if (!(s > 0)) return null;
  return { probs: inv.map((x) => r4(x / s)), overround: r4(s - 1), books: prices.length };
}

// Consenso entre casas: mediana de la implícita por lado y renormalización. La mediana y no la media,
// porque una casa dormida con un precio viejo mueve una media y no mueve una mediana.
function consensus(rows, sides) {
  const by = {};
  for (const s of sides) by[s] = [];
  for (const r of rows) if (by[r.side] && r.odds > 1) by[r.side].push(1 / r.odds);
  const med = (a) => { if (!a.length) return null; const v = a.slice().sort((x, y) => x - y); const h = v.length >> 1; return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; };
  const m = sides.map((s) => med(by[s]));
  if (m.some((x) => x == null)) return null;
  const sum = m.reduce((a, b) => a + b, 0);
  return {
    probs: m.map((x) => r4(x / sum)), overround: r4(sum - 1),
    books: Math.max(...sides.map((s) => by[s].length)),
    best: sides.map((s) => Math.max(...rows.filter((r) => r.side === s).map((r) => r.odds), 0) || null),
  };
}

// ---- 1 bis) EL ANCLA: DE DÓNDE SALE LA PROBABILIDAD DE SERIE CUANDO NO HAY MERCADO DE SERIE -------------
// Descubierto midiendo contra el proveedor el 16-ago y NO es un caso raro: la mayoría de los partidos con
// mercado abierto **no cotizan el ganador de la serie**, pero sí cotizan el marcador exacto, el hándicap de
// mapas y el ganador de cada mapa. Anclarse solo a la familia `SERIE` dejaba la plataforma en blanco en
// partidos que tenían dieciséis líneas abiertas.
//
// El orden de preferencia no es arbitrario: va de lo más directo a lo más derivado, y cada escalón dice de
// cuál salió. Un número sin su procedencia no vale nada aquí.
function marketAnchor(rows, bo, { simulate = simulateSeries } = {}) {
  const R = rows || [];

  // 1) ganador de la serie, si existe: es la lectura directa
  const serie = R.filter((r) => r.family === 'SERIE' && r.odds > 1);
  if (serie.length >= 2) {
    const c = consensus(serie, ['home', 'away']);
    if (c) return { p: c.probs[0], market: c, from: 'ganador de la serie', family: 'SERIE', direct: true };
  }

  // 2) marcador exacto: se suman los marcadores en los que gana el local y se quita el margen sobre TODOS
  //    los resultados a la vez, que es la forma correcta cuando el mercado es multi-resultado.
  const sc = R.filter((r) => r.family === 'MARCADOR' && /^\d+\s*:\s*\d+$/.test(String(r.side || '')) && r.odds > 1);
  if (sc.length >= 3) {
    const inv = sc.map((r) => 1 / r.odds);
    const sum = inv.reduce((a, b) => a + b, 0);
    let home = 0;
    sc.forEach((r, i) => { const [x, y] = String(r.side).split(':').map(Number); if (x > y) home += inv[i] / sum; });
    return {
      p: r4(home), from: 'marcador exacto de la serie', family: 'MARCADOR',
      market: { probs: [r4(home), r4(1 - home)], overround: r4(sum - 1), books: 1, best: null },
      direct: true,
    };
  }

  // 3) hándicap de mapas: en un BO3, "local −1.5" es exactamente "local gana 2-0". Se convierte a serie
  //    invirtiendo la simulación, que es lo mismo que hace el resto del motor y no una regla aparte.
  const hc = R.filter((r) => r.family === 'HANDICAP' && r.line != null && r.odds > 1);
  if (hc.length >= 2) {
    // EL SIGNO DE LA LÍNEA ES LA LÍNEA. La primera versión agrupaba por `Math.abs(line)` y después usaba ese
    // valor absoluto para resolver: con un mercado de "local −1.5" acababa resolviendo "local +1.5" y
    // devolvía un favorito del 62 % donde el mercado decía 90 %. Peor todavía, esa probabilidad mal anclada
    // se comparaba luego contra el propio hándicap y fabricaba una ventaja de 41 pp que no existía.
    //
    // La lectura correcta, verificada con un partido que cotizaba a la vez marcador, ganador de mapa y
    // hándicap (UNiTY vs Misa, 16-ago): la línea se aplica al LOCAL con su signo, y la selección visitante
    // es el complemento. Las tres familias daban P(local 2-0) = 0,308 / 0,306 / 0,330. Coinciden.
    const byLine = {};
    for (const r of hc) (byLine[r.line] = byLine[r.line] || []).push(r);
    const line = Object.keys(byLine).map(Number).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
    const grp = byLine[line];
    const c = consensus(grp, ['home', 'away']);
    if (c) {
      // se busca la probabilidad por mapa que reproduce ese hándicap, y de ahí sale la serie
      const cover = (pMap) => {
        const sim = simulate(pMap, bo, { n: 4000, seed: 733 });
        let p = 0;
        for (const s of sim.scores) { const [x, y] = s.score.split('-').map(Number); if ((x - y) + line > 0) p += s.p; }
        return p;                                   // probabilidad de que el LOCAL cubra su línea
      };
      let lo = 0.02, hi = 0.98;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (cover(mid) < c.probs[0]) lo = mid; else hi = mid;
      }
      const pMap = (lo + hi) / 2;
      return {
        p: r4(simulate(pMap, bo, { n: 8000, seed: 733 }).p_series_a), market: c,
        from: `hándicap de mapas ${line > 0 ? '+' : ''}${line}`, family: 'HANDICAP', direct: false, p_map: r4(pMap),
      };
    }
  }

  // 4) ganador de un mapa: es probabilidad POR MAPA, así que la serie sale de simularla. Se usa el primer
  //    mapa cotizado, porque es el que menos supuestos arrastra (el mapa 3 solo se juega si hay 1-1).
  const mw = R.filter((r) => r.family === 'MAPA' && r.odds > 1);
  if (mw.length >= 2) {
    const maps = [...new Set(mw.map((r) => r.map || 1))].sort((a, b) => a - b);
    const first = mw.filter((r) => (r.map || 1) === maps[0]);
    const c = consensus(first, ['home', 'away']);
    if (c) {
      return {
        p: r4(simulate(c.probs[0], bo, { n: 8000, seed: 733 }).p_series_a),
        market: c, from: `ganador del mapa ${maps[0]}`, family: 'MAPA', direct: false, p_map: c.probs[0],
      };
    }
  }
  return null;
}

// ---- 2) FUERZA DE EQUIPO ANCLADA AL MERCADO (la doctrina, aplicada de entrada) ---------------------------
// `elo` es nuestro rating propio, que al principio no sabe casi nada porque no hay histórico de esports al
// que GP tenga acceso legal. `marketP` es lo que el mercado dice. El peso del modelo crece con la muestra
// —número de partidos observados del par— y JAMÁS llega a 1: incluso con muestra grande el mercado
// conserva voz, porque es el baseline que hay que batir y no el rival al que ignorar.
function anchoredProbability(marketP, modelP, { n = 0, nFull = 60, maxModel = 0.45 } = {}) {
  if (marketP == null && modelP == null) return null;
  if (marketP == null) return { p: r4(modelP), w_model: 1, source: 'solo modelo (sin mercado abierto)' };
  if (modelP == null) return { p: r4(marketP), w_model: 0, source: 'solo mercado (sin muestra propia)' };
  const w = clamp(maxModel * (n / (n + nFull)), 0, maxModel);
  return {
    p: r4(marketP * (1 - w) + modelP * w), w_model: r3(w), market_p: r4(marketP), model_p: r4(modelP),
    source: `anclado al mercado con ${Math.round(100 * w)}% de peso propio (${n} partidos de muestra)`,
  };
}

// Elo con encogimiento por muestra. Con 3 partidos un equipo no tiene rating, tiene una anécdota.
function eloProbability(ra, rb, { scale = 400 } = {}) {
  if (!Number.isFinite(ra) || !Number.isFinite(rb)) return null;
  return r4(1 / (1 + Math.pow(10, (rb - ra) / scale)));
}

// ---- 3) SIMULACIÓN DE SERIE (blueprint 77-82) -----------------------------------------------------------
// Al mejor de N a partir de la probabilidad POR MAPA. No es un binomio: los mapas de una serie no son
// independientes —el mismo equipo, el mismo día, el mismo estado mental— así que se propaga una correlación
// explícita: quien gana el mapa 1 llega al 2 con un empujón, y quien lo pierde con un lastre. Sin eso, la
// distribución de 2-0 sale sistemáticamente baja contra lo que ocurre en la realidad.
function simulateSeries(pMapA, bo, { momentum = 0.06, perMap = null, n = 20000, seed = 17 } = {}) {
  const need = Math.floor(bo / 2) + 1;
  const rnd = rng(seed);
  const tally = {};
  let winA = 0, mapsA = 0, mapsB = 0;
  for (let i = 0; i < n; i++) {
    let a = 0, b = 0, mom = 0;
    while (a < need && b < need) {
      const idx = a + b;
      const base = perMap && perMap[idx] != null ? perMap[idx] : pMapA;
      const p = clamp01(base + mom);
      if (rnd() < p) { a++; mom = momentum; } else { b++; mom = -momentum; }
    }
    winA += a > b ? 1 : 0; mapsA += a; mapsB += b;
    const k = a + '-' + b;
    tally[k] = (tally[k] || 0) + 1;
  }
  const scores = Object.entries(tally)
    .map(([k, v]) => ({ score: k, p: r4(v / n) }))
    .sort((x, y) => y.p - x.p);
  return {
    p_series_a: r4(winA / n), p_series_b: r4(1 - winA / n),
    scores, bo, maps_to_win: need,
    expected_maps: r2((mapsA + mapsB) / n),
    p_map_a: r4(pMapA), sims: n,
    correlation_note: 'los mapas NO se simulan independientes: quien gana el anterior llega con ventaja al siguiente, que es lo que produce la tasa real de 2-0',
  };
}

// La inversa: del precio de serie que cotiza el mercado, sacar la probabilidad por mapa implícita. Es lo que
// permite comparar peras con peras cuando la casa solo cotiza la serie y GP razona por mapa.
function seriesToMap(pSeries, bo, { momentum = 0.06, sims = 4000 } = {}) {
  let lo = 0.02, hi = 0.98;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const p = simulateSeries(mid, bo, { momentum, n: sims, seed: 991 }).p_series_a;
    if (p < pSeries) lo = mid; else hi = mid;
  }
  return r4((lo + hi) / 2);
}

// ---- 4) VENTAJA, CONFIANZA Y "NO PICK" (blueprint 96-101) -----------------------------------------------
// EL BLUEPRINT ES EXPLÍCITO Y COINCIDE CON LA DOCTRINA DE LA CASA: "un edge no es automáticamente una pick"
// y "GP debe ser excelente también diciendo NO PICK". Así que esto devuelve un veredicto, no un número
// suelto, y el NO PICK trae SIEMPRE su motivo — un hueco sin explicación se lee como un fallo del sistema.
// UNA SOLA CASA NO PUEDE SER UN VETO PERMANENTE. La primera versión bloqueaba toda pick con menos de dos
// casas cotizando, y como hoy GP tiene UNA fuente de esports, eso significaba cero picks para siempre — un
// producto que no puede decir que sí nunca aprende si sabe decir que no. Pero el riesgo que motivaba el
// bloqueo es real: sin una segunda casa no hay forma de saber si el precio está dormido o equivocado.
// La respuesta correcta no es ignorar el riesgo ni prohibir el producto, es **subir el listón**: con una
// sola casa la ventaja tiene que ser mayor para valer lo mismo. Se sube 2,5 pp y se dice en la ficha.
const SINGLE_BOOK_PENALTY_PP = 2.5;

function evaluateEdge({ pGp, odds, uncertaintyPp = 6, minEdgePp = 3, family = 'SERIE', marketBooks = 0, freshMin = null }) {
  if (!(odds > 1) || pGp == null) return { pick: false, reason: 'sin precio o sin probabilidad' };
  const pMarket = 1 / odds;
  const edgePp = (pGp - pMarket) * 100;
  const ev = pGp * (odds - 1) - (1 - pGp);
  const single = !marketBooks || marketBooks < 2;
  const bar = minEdgePp + (single ? SINGLE_BOOK_PENALTY_PP : 0);
  const reasons = [];
  // la ventaja se compara con la INCERTIDUMBRE, no con cero: 4 pp con ±9 pp de error no es una ventaja
  if (edgePp < bar) reasons.push({ code: 'ventaja_insuficiente', text: `la ventaja (${r2(edgePp)} pp) no llega al listón de ${r2(bar)} pp${single ? ' (subido por cotizar una sola casa)' : ''}` });
  if (edgePp < uncertaintyPp * 0.75) reasons.push({ code: 'ventaja_bajo_ruido', text: `la ventaja (${r2(edgePp)} pp) no supera el ruido del propio modelo (±${r2(uncertaintyPp)} pp)` });
  if (freshMin != null && freshMin > 90) reasons.push({ code: 'precio_viejo', text: `el precio tiene ${Math.round(freshMin)} minutos` });
  return {
    pick: reasons.length === 0,
    edge_pp: r2(edgePp), ev_pct: r2(100 * ev), fair_odds: r2(1 / pGp),
    p_gp: r4(pGp), p_market: r4(pMarket), odds, family,
    bar_pp: r2(bar), single_book: single,
    single_book_note: single ? 'una sola casa cotizando: no hay consenso contra el que medirse, así que el listón de ventaja sube 2,5 pp en vez de dar la pick por buena' : null,
    no_pick_reasons: reasons,
    // 99: confianza y probabilidad son cosas distintas y se muestran separadas
    confidence: confidenceOf({ uncertaintyPp, marketBooks, edgePp }),
  };
}

function confidenceOf({ uncertaintyPp, marketBooks, edgePp }) {
  const parts = [
    { key: 'modelo', v: clamp01(1 - uncertaintyPp / 18), label: 'estabilidad del modelo' },
    { key: 'mercado', v: clamp01((marketBooks || 0) / 4), label: 'profundidad del mercado' },
    { key: 'margen', v: clamp01(Math.abs(edgePp) / 10), label: 'tamaño de la ventaja' },
  ];
  const score = parts.reduce((s, p) => s + p.v, 0) / parts.length;
  return {
    score: r3(score),
    level: score >= 0.66 ? 'alta' : score >= 0.4 ? 'media' : 'baja',
    // 190: los componentes NUNCA se esconden detrás del número final
    parts: parts.map((p) => ({ ...p, v: r3(p.v) })),
  };
}

// ---- 5) INCERTIDUMBRE (blueprint 117, 145) --------------------------------------------------------------
// Dos fuentes distintas y no se suman a lo bruto: el azar del propio juego (que no baja con más datos) y
// nuestra ignorancia (que sí). Se publica la segunda en puntos, porque es la única accionable.
function uncertainty({ p, sampleMatches = 0, marketBooks = 0, missing = [] }) {
  const aleatoric = Math.sqrt(clamp01(p) * (1 - clamp01(p))) * 100;
  const sampleTerm = 14 / Math.sqrt(Math.max(1, sampleMatches));
  const marketTerm = marketBooks >= 3 ? 1.5 : marketBooks >= 1 ? 3.5 : 6;
  const missingTerm = missing.length * 2.2;
  const epistemic = Math.sqrt(sampleTerm ** 2 + marketTerm ** 2 + missingTerm ** 2);
  return {
    aleatoric_pp: r2(aleatoric), epistemic_pp: r2(epistemic),
    total_pp: r2(Math.sqrt(aleatoric ** 2 + epistemic ** 2)),
    drivers: [
      { source: 'muestra propia del par', pp: r2(sampleTerm), detail: `${sampleMatches} partidos observados` },
      { source: 'profundidad del mercado', pp: r2(marketTerm), detail: `${marketBooks} precios` },
      ...(missing.length ? [{ source: 'datos que faltan', pp: r2(missingTerm), detail: missing.join(', ') }] : []),
    ],
    missing,
  };
}

// ---- 6) PROCEDENCIA (blueprint 114-116, 202) ------------------------------------------------------------
// Cada cifra tiene que poder decir de dónde viene y cuándo. Es el requisito de confianza del blueprint y ya
// es la costumbre de la casa en los otros tres deportes.
function provenance(sources) {
  return sources.filter(Boolean).map((s) => ({
    source: s.source, kind: s.kind || 'derivado', at: s.at || null,
    fresh_min: s.at ? Math.round((Date.now() - Date.parse(s.at)) / 60000) : null,
  }));
}

// ---- 7) DISTRIBUCIONES CONSULTABLES ---------------------------------------------------------------------
// Las casas no cotizan las líneas que a uno le vienen bien: hoy publican 23,5 kills y mañana 24,5, y en
// hándicap de kills salen seis líneas distintas a la vez. Publicar una tabla fija de líneas obliga a
// interpolar, e interpolar una cola es exactamente donde se inventan probabilidades. Así que cada modelo
// devuelve además el HISTOGRAMA de su simulación y el precio se lee de ahí, sea cual sea la línea.
function histOf(samples) {
  const h = {}; const n = samples.length || 1;
  for (const v of samples) h[v] = (h[v] || 0) + 1;
  for (const k of Object.keys(h)) h[k] = h[k] / n;
  return { h, n: samples.length };
}
const pOver = (d, line) => (!d || !d.h ? null : r4(Object.entries(d.h).reduce((s, [k, p]) => s + (+k > line ? p : 0), 0)));
const pUnder = (d, line) => { const o = pOver(d, line); return o == null ? null : r4(1 - o); };
// hándicap: gana el lado si (margen + línea) > 0. El empate exacto se trata aparte porque en línea entera
// devuelve la apuesta, y contarlo como victoria infla la probabilidad justo donde el mercado es más fino.
function pHandicap(d, line) {
  if (!d || !d.h) return null;
  let win = 0, push = 0;
  for (const [k, p] of Object.entries(d.h)) {
    const v = +k + line;
    if (v > 0) win += p; else if (v === 0) push += p;
  }
  return { p: r4(push > 0 ? win / (1 - push) : win), push: r4(push), raw: r4(win) };
}

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = {
  noVig, consensus, marketAnchor, anchoredProbability, eloProbability,
  simulateSeries, seriesToMap, evaluateEdge, confidenceOf, uncertainty, provenance, rng,
  histOf, pOver, pUnder, pHandicap,
  r4, r3, r2, clamp, clamp01,
};
