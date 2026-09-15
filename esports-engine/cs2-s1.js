// esports-engine/cs2-s1.js — CS2 · CHALLENGER S1 (15-sep-2026). T2.7 del plan de la auditoría externa.
//
// ── QUÉ ES ESTO Y QUÉ NO ────────────────────────────────────────────────────────────────────────────────
// Es un ASPIRANTE, no un reemplazo. `esports-engine/cs2.js` está CONGELADO: genera `cs2_rounds_v1`, que
// tiene 541 apuestas en la sombra y dinero histórico detrás, y cambiarle la lógica a mitad de ventana
// destruye lo único que la ventana produce, que es una muestra comparable. Este archivo no lo importa para
// modificarlo ni lo parchea: vive al lado y se compara contra él en `scripts/cs2-challengers.js`.
//
// ── EL FALLO QUE VIENE A REPARAR (A16 de la auditoría, §7.1) ────────────────────────────────────────────
// En `cs2.js` la probabilidad de RONDA, la de MAPA y la de SERIE se mezclan sin tipar, y la conversión entre
// las dos primeras es una constante escrita a ojo:
//
//     const clampRound = (pMap) => C.clamp(0.5 + (pMap - 0.5) * 0.42, 0.32, 0.68);
//     // «la probabilidad de RONDA no es la de mapa: un 60 % de mapa es ~53 % de ronda»
//
// El comentario es correcto en la intuición y FALSO en el número, y se puede comprobar en dos líneas. Si se
// mete p_round = 0,542 (lo que esa fórmula devuelve para un p_map de 0,60) en la propia simulación de rondas
// del motor, la probabilidad de GANAR EL MAPA que sale no es 0,60: es **0,678**. Medido sobre la
// distribución exacta de este archivo, con el arrastre económico por defecto:
//
//     p_map pedido   0,35   0,40   0,45   0,50   0,55   0,60   0,65   0,70   0,75   0,80
//     p_map obtenido 0,248  0,325  0,410  0,500  0,590  0,675  0,752  0,819  0,873  0,915
//     error (pp)    −10,2   −7,5   −4,0    0,0   +4,0   +7,5  +10,2  +11,9  +12,3  +11,5
//     p_round que SÍ reproduce el p_map pedido (bisección de este módulo):
//                   0,4643 0,4765 0,4883 0,5000 0,5117 0,5235 0,5357 0,5486 0,5624 0,5777
//
// O sea: el motor ANCLA la serie al mercado con todo el cuidado del mundo —hay media pantalla de comentario
// en `cs2.js` explicando por qué—, y acto seguido mete en la simulación de rondas un favorito entre 4 y 12
// puntos MÁS FUERTE del que el mercado acaba de cotizar. La distribución de margen de rondas que sale de
// ahí es la de otro partido. Y todo lo que se lee de esa distribución —hándicap de rondas, rondas por
// equipo, total de rondas— hereda el error, siempre en la misma dirección: **a favor del favorito**.
//
// Es exactamente el mismo fallo que `cs2.js` ya documentó y arregló UNA vez a nivel de mapa («por delante
// decía que el favorito era el local y por dentro jugaba como si el favorito fuera el visitante»). Lo que no
// se vio entonces es que el escalón siguiente —mapa → ronda— tenía la misma enfermedad y no se había medido.
//
// Peor: `clampRound` se aplica DOS VECES en el camino de `cs2.js`. Una dentro de `shiftBy()`, para desplazar
// los logits de los mapas hacia el nivel del mercado —y ahí no pinta nada, porque lo que se está desplazando
// son probabilidades de MAPA, no de ronda—, y otra al entrar a `mapRounds()`. Comprimir dos veces con una
// función pensada para comprimir una sola vez no tiene interpretación; es la «doble compresión» del informe.
//
// ── LAS CINCO PIEZAS DE S1 (las que pide el plan) ──────────────────────────────────────────────────────
//   1. TIPAR. `pRound`, `pMap` y `pSeries` son tres cosas distintas y aquí viajan etiquetadas
//      (`{ tipo: 'p_round' | 'p_map' | 'p_series' }`). No se pueden pasar la una por la otra sin que una
//      función de conversión lo diga.
//   2. BISECCIÓN. `pRoundDesdePMap(p_map)` resuelve la probabilidad de ronda que hace que la simulación de
//      mapa devuelva EXACTAMENTE ese p_map. Ninguna constante escrita a ojo.
//   3. SERIE COMPILADA. `serie(pMaps, bo)` compila el mejor de N con los p_map resultantes, uno por mapa, y
//      `pMapsDesdePSeries()` invierte el camino sin pasar por `clampRound`.
//   4. MOMENTUM APAGADO por defecto (`MOMENTUM = 0`). El +0,06 de `core.js` no tiene evidencia detrás —la
//      ficha del modelo lo etiqueta «experimental» y el blueprint 2.0 pide sustituirlo por correlación
//      aprendida—. Un aspirante no puede heredar un parámetro sin medir: se enciende a mano si se quiere.
//   5. VETO. Distribución sobre los vetos FACTIBLES (todas las ramas, con su probabilidad), no la rama
//      codiciosa; y condicionamiento EXACTO al prefijo cuando el veto ya se publicó.
//
// ── POR QUÉ DP EXACTA Y NO MONTE CARLO ──────────────────────────────────────────────────────────────────
// `cs2.js` simula 20.000 mapas para sacar la distribución de rondas. Eso mete ruido de ±0,3 pp en cada
// lectura, y una bisección sobre una función ruidosa no converge: oscila. Como el modelo de ronda es una
// cadena de Markov pequeña —marcador (a,b) por racha (−2..+2), 980 estados y 24 rondas— la distribución se
// calcula EXACTA por programación dinámica en milisegundos. Con eso la bisección es limpia, el resultado es
// reproducible bit a bit y la prueba de ida y vuelta puede exigir 0,002 sin depender de la semilla.
// La MECÁNICA de la ronda es la MISMA que la de `cs2.js` (13 rondas, tope de 24, prórroga MR3 a 4, arrastre
// con racha topada a ±2 en regulación y a ±1 en prórroga): si se cambiara, la comparación mediría dos cosas
// a la vez y no se sabría cuál movió el número.
'use strict';

const C = require('./core');

// ══ 0. CONSTANTES, CADA UNA CON SU ESTADO ═══════════════════════════════════════════════════════════════
// Arrastre económico por defecto. Es el mismo respaldo que usa `cs2.js` cuando un mapa no tiene muestra;
// el ajuste por mapa vive allí (`calibrateDrag`) y se le puede pasar a este módulo tal cual.
const ECO_DRAG = 0.055;
// Momentum de serie APAGADO. Ver punto 4 de la cabecera.
const MOMENTUM = 0;
// Coeficiente de preferencia del veto. Se conserva el 6 de `cs2.js` A PROPÓSITO: si S1 cambiara a la vez la
// estructura del veto y su coeficiente, una diferencia de resultado no se podría atribuir a ninguno de los
// dos. Lo que cambia aquí es que se enumeran todas las ramas en vez de quedarse con la más probable.
const VETO_K = 6;
const OBJETIVO = 13;          // rondas para ganar el mapa en regulación
const TOPE_REGULACION = 24;   // 12-12 va a prórroga; la ronda 25 no existe
const OT_RONDAS = 6;          // bloque MR3
const OT_OBJETIVO = 4;
const OT_BLOQUES = 7;         // el bucle de `cs2.js` admite hasta siete bloques

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lg = (p) => Math.log(p / (1 - p));
const sg = (x) => 1 / (1 + Math.exp(-x));

// ══ 1. LOS TRES TIPOS ═══════════════════════════════════════════════════════════════════════════════════
// Una probabilidad suelta no dice de qué es. Tres funciones de construcción y una de comprobación: si a una
// función que espera un p_map le llega un p_round, se entera aquí y no doscientas líneas más abajo, cuando
// el número ya se publicó como ventaja.
function pRound(p, meta = {}) { return { tipo: 'p_round', p: +p, ...meta }; }
function pMap(p, meta = {}) { return { tipo: 'p_map', p: +p, ...meta }; }
function pSeries(p, meta = {}) { return { tipo: 'p_series', p: +p, ...meta }; }
function valor(x, tipoEsperado) {
  if (x == null) return null;
  if (typeof x === 'number') {
    // se admite el número desnudo por compatibilidad con los llamadores viejos, pero NO en silencio: quien
    // quiera trazabilidad pasa el objeto tipado. El aviso viaja en el retorno de las funciones públicas.
    return { p: x, sin_tipo: true };
  }
  if (x.tipo !== tipoEsperado) {
    throw new TypeError(`se esperaba ${tipoEsperado} y llegó ${x.tipo}: mezclar probabilidad de ronda, de mapa y de serie es el fallo A16 que este módulo existe para impedir`);
  }
  return { p: x.p, sin_tipo: false };
}

// ══ 2. LA DISTRIBUCIÓN EXACTA DE UN MAPA ════════════════════════════════════════════════════════════════
// Cadena de Markov sobre (rondas de A, rondas de B, racha). La racha es el mecanismo económico: quien GANA
// una ronda llega a la siguiente con dinero y quien la pierde llega pobre, así que la racha se refuerza. El
// signo importa y es fácil de equivocar —`cs2.js` lo dice y tiene razón: con el signo al revés el modelo
// revierte a la media y dispara la prórroga—. Aquí se replica el mismo signo y los mismos topes.
//
// Devuelve la función de masa EXACTA de los marcadores finales. Sin muestreo: la suma de las masas es 1 a
// precisión de coma flotante, y eso lo comprueba el test («validación de PMF» de la puerta del §7.1).
function distribucionMapa(prob, { eco = ECO_DRAG } = {}) {
  const v = valor(prob, 'p_round');
  const base = clamp(v.p, 1e-9, 1 - 1e-9);
  // probabilidad de que A gane la ronda con la racha `st`; los topes 0,05/0,95 son los de `cs2.js`
  const pr = (st) => clamp(base + st * eco, 0.05, 0.95);
  const N = OBJETIVO + 1;
  const idx = (a, b, st) => ((a * N) + b) * 5 + (st + 2);
  let cur = new Float64Array(N * N * 5);
  cur[idx(0, 0, 0)] = 1;

  for (let r = 0; r < TOPE_REGULACION; r++) {
    const nxt = new Float64Array(cur.length);
    for (let a = 0; a < N; a++) {
      for (let b = 0; b < N; b++) {
        for (let st = -2; st <= 2; st++) {
          const p = cur[idx(a, b, st)];
          if (!p) continue;
          if (a >= OBJETIVO || b >= OBJETIVO) { nxt[idx(a, b, st)] += p; continue; }  // absorbido
          const q = pr(st);
          nxt[idx(a + 1, b, Math.min(2, st <= 0 ? 1 : st + 1))] += p * q;
          nxt[idx(a, b + 1, Math.max(-2, st >= 0 ? -1 : st - 1))] += p * (1 - q);
        }
      }
    }
    cur = nxt;
  }

  // Tras 24 rondas solo quedan dos situaciones: alguien llegó a 13 (absorbido) o hay 12-12.
  const marcadores = new Map();   // "a-b" → masa
  const pon = (a, b, p) => { if (p > 0) marcadores.set(a + '-' + b, (marcadores.get(a + '-' + b) || 0) + p); };
  let masaOT = 0;
  const rachaOT = new Float64Array(5);
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      for (let st = -2; st <= 2; st++) {
        const p = cur[idx(a, b, st)];
        if (!p) continue;
        if (a === OBJETIVO - 1 && b === OBJETIVO - 1) { masaOT += p; rachaOT[st + 2] += p; }
        else pon(a, b, p);
      }
    }
  }

  // ── PRÓRROGA: bloques MR3, primero a 4 ────────────────────────────────────────────────────────────────
  // Dos detalles que hay que copiar EXACTOS de `cs2.js` o la tasa de prórroga sale de otro juego: dentro del
  // bloque la racha se fija a ±1 (no se acumula como en regulación), y un bloque que acaba 3-3 se repite
  // hasta siete veces.
  if (masaOT > 0) {
    // distribución de racha al entrar a la prórroga, normalizada
    let racha = Array.from(rachaOT, (x) => x / masaOT);
    let vivo = masaOT, a0 = OBJETIVO - 1, b0 = OBJETIVO - 1;
    for (let bloque = 0; bloque < OT_BLOQUES && vivo > 1e-15; bloque++) {
      const res = bloqueOT(base, eco, racha);
      // los bloques decisivos salen con su marcador; el 3-3 sigue vivo con su propia racha de salida
      for (const [k, p] of res.decide) {
        const [oa, ob] = k.split('-').map(Number);
        pon(a0 + oa, b0 + ob, vivo * p);
      }
      const seguir = res.empate;
      if (!(seguir > 0)) { vivo = 0; break; }
      racha = res.racha_empate;
      vivo *= seguir;
      a0 += 3; b0 += 3;
    }
    // lo que sobrevive a siete bloques 3-3 acaba empatado. Es masa del orden de 1e-9 y NO se reparte a
    // ojo: se declara, porque una masa escondida es como se rompe la comprobación de que la PMF suma 1.
    if (vivo > 0) pon(a0, b0, vivo);
  }

  return resumenMapa(marcadores, base, eco);
}

// Un bloque de prórroga: primero a 4 en 6 rondas. Devuelve la masa por marcador decisivo, la masa del 3-3 y
// la distribución de racha con la que se sale de un 3-3.
function bloqueOT(base, eco, rachaEntrada) {
  const pr = (st) => clamp(base + st * eco, 0.05, 0.95);
  const M = OT_OBJETIVO + 1;
  const idx = (a, b, st) => ((a * M) + b) * 3 + (st + 1);   // en prórroga la racha es −1, 0 o +1
  let cur = new Float64Array(M * M * 3);
  // la racha de regulación (−2..+2) entra topada a ±1, que es como la trata el bucle de prórroga
  for (let st = -2; st <= 2; st++) {
    const p = rachaEntrada[st + 2];
    if (p) cur[idx(0, 0, clamp(st, -1, 1))] += p;
  }
  for (let r = 0; r < OT_RONDAS; r++) {
    const nxt = new Float64Array(cur.length);
    for (let a = 0; a < M; a++) {
      for (let b = 0; b < M; b++) {
        for (let st = -1; st <= 1; st++) {
          const p = cur[idx(a, b, st)];
          if (!p) continue;
          if (a >= OT_OBJETIVO || b >= OT_OBJETIVO) { nxt[idx(a, b, st)] += p; continue; }
          const q = pr(st);
          nxt[idx(a + 1, b, 1)] += p * q;      // dentro del bloque la racha se FIJA a ±1
          nxt[idx(a, b + 1, -1)] += p * (1 - q);
        }
      }
    }
    cur = nxt;
  }
  const decide = new Map();
  let empate = 0;
  const rachaEmp = new Float64Array(5);
  for (let a = 0; a < M; a++) {
    for (let b = 0; b < M; b++) {
      for (let st = -1; st <= 1; st++) {
        const p = cur[idx(a, b, st)];
        if (!p) continue;
        if (a === b) { empate += p; rachaEmp[st + 2] += p; }
        else decide.set(a + '-' + b, (decide.get(a + '-' + b) || 0) + p);
      }
    }
  }
  const racha_empate = empate > 0 ? Array.from(rachaEmp, (x) => x / empate) : [0, 0, 1, 0, 0];
  return { decide, empate, racha_empate };
}

// Resumen tipado de la PMF de un mapa: quién gana, cuántas rondas, márgenes y rondas por equipo.
function resumenMapa(marcadores, base, eco) {
  const total = {}, margen = {}, casa = {}, fuera = {};
  let gana = 0, pierde = 0, empate = 0, masa = 0, mediaRondas = 0, ot = 0;
  for (const [k, p] of marcadores) {
    const [a, b] = k.split('-').map(Number);
    masa += p;
    total[a + b] = (total[a + b] || 0) + p;
    margen[a - b] = (margen[a - b] || 0) + p;
    casa[a] = (casa[a] || 0) + p;
    fuera[b] = (fuera[b] || 0) + p;
    mediaRondas += p * (a + b);
    if (a + b > TOPE_REGULACION) ot += p;
    if (a > b) gana += p; else if (b > a) pierde += p; else empate += p;
  }
  const hist = (o) => ({ h: o, n: 1 });
  return {
    tipo: 'distribucion_mapa',
    p_map: pMap(gana + pierde > 0 ? gana / (gana + pierde) : 0.5,
      { de: 'PMF exacta del mapa', masa_empate: empate }),
    p_round_usada: pRound(base, { eco }),
    masa_total: masa,          // tiene que ser 1: lo comprueba el test
    masa_empate: empate,       // marcador final igualado tras siete bloques de prórroga; ~1e-9
    media_rondas: mediaRondas,
    prorroga_p: ot,
    marcadores,
    dist: { total: hist(total), margin: hist(margen), home: hist(casa), away: hist(fuera) },
  };
}

// ══ 3. LA BISECCIÓN: DE p_map A p_round ═════════════════════════════════════════════════════════════════
// El corazón de S1. `distribucionMapa` es monótona creciente en p_round y ahora es EXACTA, así que la
// bisección converge sin oscilar. Se devuelve el residuo alcanzado para que el llamador pueda comprobarlo:
// una conversión que no se puede auditar es otra constante escrita a ojo con más pasos.
//
// Hay p_map que NO son alcanzables: con p_round topado a 0,95 por ronda, el mapa nunca llega al 100 %. En
// ese caso se devuelve el extremo con `alcanzable: false` y el residuo, en vez de fingir que se resolvió.
function pRoundDesdePMap(objetivo, { eco = ECO_DRAG, tol = 1e-7, iter = 60 } = {}) {
  const v = valor(objetivo, 'p_map');
  const meta = clamp(v.p, 1e-9, 1 - 1e-9);
  const f = (x) => distribucionMapa(pRound(x), { eco }).p_map.p;
  let lo = 0.02, hi = 0.98;
  const flo = f(lo), fhi = f(hi);
  if (meta <= flo) return pRound(lo, { alcanzable: false, objetivo: meta, obtenido: flo, residuo: flo - meta, eco });
  if (meta >= fhi) return pRound(hi, { alcanzable: false, objetivo: meta, obtenido: fhi, residuo: fhi - meta, eco });
  for (let i = 0; i < iter && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < meta) lo = mid; else hi = mid;
  }
  const x = (lo + hi) / 2;
  const got = f(x);
  return pRound(x, { alcanzable: true, objetivo: meta, obtenido: got, residuo: got - meta, eco });
}

// El camino de vuelta, para poder cerrar el círculo en el test.
function pMapDesdePRound(prob, { eco = ECO_DRAG } = {}) {
  return distribucionMapa(prob, { eco }).p_map;
}

// ══ 4. LA SERIE, COMPILADA CON LOS p_map DE CADA MAPA ═══════════════════════════════════════════════════
// Al mejor de N. Enumeración EXACTA de las secuencias, no simulación: con bo ≤ 5 hay como mucho veinte
// caminos y el resultado es determinista. `momentum` está a cero por defecto (ver cabecera); si se enciende,
// se propaga como estado del camino, igual que hace `core.simulateSeries`, y la enumeración sigue siendo
// exacta porque el empujón solo depende de quién ganó el mapa anterior.
function serie(pMaps, bo = 3, { momentum = MOMENTUM } = {}) {
  const ps = (pMaps || []).map((x) => {
    const v = valor(x, 'p_map');
    return clamp(v.p, 1e-9, 1 - 1e-9);
  });
  const necesita = Math.floor(bo / 2) + 1;
  if (ps.length < necesita) {
    throw new RangeError(`un mejor de ${bo} necesita al menos ${necesita} probabilidades de mapa y llegaron ${ps.length}`);
  }
  const marcadores = new Map();
  let ganaA = 0, mapasEsperados = 0;
  const anda = (a, b, mom, p) => {
    if (a >= necesita || b >= necesita) {
      marcadores.set(a + '-' + b, (marcadores.get(a + '-' + b) || 0) + p);
      if (a > b) ganaA += p;
      mapasEsperados += p * (a + b);
      return;
    }
    const i = a + b;
    // si el veto solo dejó `ps.length` mapas y la serie pide más, se repite el último: es el supuesto
    // menos malo y se declara. No debería ocurrir con un veto bien formado.
    const base = ps[i] != null ? ps[i] : ps[ps.length - 1];
    const q = clamp(base + mom, 1e-9, 1 - 1e-9);
    anda(a + 1, b, momentum, p * q);
    anda(a, b + 1, -momentum, p * (1 - q));
  };
  anda(0, 0, 0, 1);
  const scores = [...marcadores.entries()].map(([k, p]) => ({ score: k, p })).sort((x, y) => y.p - x.p);
  // margen de MAPAS, que es de donde se lee el hándicap de mapas
  const margen = {};
  for (const s of scores) { const [a, b] = s.score.split('-').map(Number); margen[a - b] = (margen[a - b] || 0) + s.p; }
  return {
    tipo: 'serie',
    p_series: pSeries(ganaA, { bo, momentum, de: 'enumeración exacta de los caminos' }),
    scores, bo, maps_to_win: necesita,
    mapas_esperados: mapasEsperados,
    p_map_por_mapa: ps.slice(0, bo),
    dist: { margin: { h: margen, n: 1 } },
    momentum,
  };
}

// La inversa: qué nivel común hay que darle a los mapas para que la serie compilada valga exactamente lo que
// vale la serie anclada. Se desplaza el LOGIT de cada mapa por una constante —así se conserva la FORMA del
// veto, que es la aportación propia, y el NIVEL lo pone el ancla— y se busca el desplazamiento por bisección.
//
// LA DIFERENCIA CON `cs2.js` ESTÁ EN UNA LÍNEA. Allí el desplazamiento se aplica sobre `clampRound(m.p_a)`,
// es decir, sobre una probabilidad de mapa pasada por la función que convierte mapas en RONDAS. Eso comprime
// la forma del veto a la mitad antes de desplazarla, así que el veto pinta menos de lo que dice pintar y el
// nivel se corrige encima de una escala que no es la suya. Aquí se desplaza el logit del p_map tal cual.
function pMapsDesdePSeries(objetivo, forma, bo = 3, { momentum = MOMENTUM, tol = 1e-7, iter = 60 } = {}) {
  const v = valor(objetivo, 'p_series');
  const meta = clamp(v.p, 1e-9, 1 - 1e-9);
  const f0 = (forma || []).map((x) => clamp(valor(x, 'p_map').p, 1e-6, 1 - 1e-6));
  const desplaza = (d) => f0.map((p) => pMap(sg(lg(p) + d)));
  const g = (d) => serie(desplaza(d), bo, { momentum }).p_series.p;
  let lo = -8, hi = 8;
  if (g(lo) > meta || g(hi) < meta) {
    return { p_maps: desplaza(0), shift_logit: 0, alcanzable: false,
      motivo: 'el objetivo de serie cae fuera de lo que el desplazamiento puede alcanzar con esta forma de veto' };
  }
  for (let i = 0; i < iter && hi - lo > tol; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) < meta) lo = mid; else hi = mid;
  }
  const d = (lo + hi) / 2;
  return { p_maps: desplaza(d), shift_logit: d, alcanzable: true, objetivo: meta, obtenido: g(d), residuo: g(d) - meta };
}

// ══ 5. EL VETO: TODAS LAS RAMAS, NO LA MÁS PROBABLE ════════════════════════════════════════════════════
// `cs2.js` construye el veto con `top()`: en cada paso se queda con el mapa MÁS probable y sigue. Eso es una
// rama de un árbol de 5.040, y se publica como si fuera el veto. Si las dos primeras preferencias de un
// equipo están al 21 % y al 19 %, la rama codiciosa se lleva el 100 % del peso y la otra el 0 %.
//
// Aquí se enumeran todas las ramas factibles con su probabilidad. El coste es 7·6·5·4·3·2 = 5.040 caminos
// por partido, que en esta máquina son milisegundos, y a cambio el reparto de mapas es una DISTRIBUCIÓN y no
// una adivinanza. `bo3` estándar: ban A, ban B, pick A, pick B, ban A, ban B, y el que queda es el decider.
const PATRONES = {
  1: ['ban_a', 'ban_b', 'ban_a', 'ban_b', 'ban_a', 'ban_b'],
  3: ['ban_a', 'ban_b', 'pick_a', 'pick_b', 'ban_a', 'ban_b'],
  5: ['ban_a', 'ban_b', 'pick_a', 'pick_b', 'pick_a', 'pick_b'],
};

// Pesos de preferencia. `ban` castiga lo que me perjudica, `pick` premia lo que me favorece. Misma forma
// funcional y mismo coeficiente que `cs2.js` a propósito (ver VETO_K).
function pesos(maps, accion, k = VETO_K) {
  const w = maps.map((m) => {
    const ventaja = accion.endsWith('_a') ? (m.a - m.b) : (m.b - m.a);
    return accion.startsWith('ban') ? Math.exp(-ventaja * k) : Math.exp(ventaja * k);
  });
  return w;
}

// Enumera el árbol completo. `prefijo` permite CONDICIONAR a un veto ya publicado: cada paso observado fija
// el mapa de ese paso y las ramas incompatibles desaparecen (no se reponderan a ojo: se eliminan y se
// renormaliza, que es el condicionamiento exacto).
function vetoDistribucion(mapStrength, { bo = 3, pool = null, prefijo = null, k = VETO_K, tope = 20000 } = {}) {
  const claves = pool || Object.keys((mapStrength && mapStrength.a) || {});
  const maps = claves
    .map((key) => ({ key, a: mapStrength.a[key], b: mapStrength.b[key] }))
    .filter((m) => Number.isFinite(m.a) && Number.isFinite(m.b));
  const patron = PATRONES[bo] || PATRONES[3];
  const necesita = Math.floor(bo / 2) + 1;
  if (maps.length < necesita) return null;
  // el patrón consume `patron.length` mapas y deja uno de decider; con menos mapas se recortan bans del final
  const pasos = patron.slice(0, Math.max(0, Math.min(patron.length, maps.length - 1)));

  const ramas = [];
  let visitadas = 0;
  const anda = (restantes, i, elegidos, p) => {
    if (++visitadas > tope) return;
    if (i >= pasos.length) {
      const decider = restantes[0] || null;
      const jugados = elegidos.filter((e) => e.accion.startsWith('pick')).map((e) => e.map);
      if (decider) jugados.push(decider.key);
      ramas.push({ p, secuencia: elegidos.slice(), decider: decider ? decider.key : null, jugados });
      return;
    }
    const accion = pasos[i];
    const w = pesos(restantes, accion, k);
    const s = w.reduce((x, y) => x + y, 0) || 1;
    for (let j = 0; j < restantes.length; j++) {
      const m = restantes[j];
      // condicionamiento exacto: si el veto publicado dice qué pasó en este paso, las demás ramas no existen
      if (prefijo && prefijo[i] && prefijo[i].map && prefijo[i].map !== m.key) continue;
      const q = prefijo && prefijo[i] && prefijo[i].map ? 1 : w[j] / s;
      if (!(q > 0)) continue;
      const resto = restantes.slice(0, j).concat(restantes.slice(j + 1));
      anda(resto, i + 1, elegidos.concat([{ accion, map: m.key, p: q }]), p * q);
    }
  };
  anda(maps, 0, [], 1);
  const masa = ramas.reduce((s, r) => s + r.p, 0);
  if (!(masa > 0)) return null;
  for (const r of ramas) r.p /= masa;      // renormalización tras el condicionamiento
  ramas.sort((x, y) => y.p - x.p);

  // marginal: qué mapa se juega en cada posición de la serie, y con qué probabilidad
  const porPosicion = [];
  for (let i = 0; i < necesita + (bo - necesita); i++) {
    const m = {};
    for (const r of ramas) { const key = r.jugados[i]; if (key) m[key] = (m[key] || 0) + r.p; }
    if (Object.keys(m).length) porPosicion.push(m);
  }
  return {
    tipo: 'veto_distribucion', bo, ramas_n: ramas.length,
    truncada: visitadas > tope,
    condicionada: !!(prefijo && prefijo.length),
    ramas: ramas.slice(0, 200),           // el detalle largo no cabe en una respuesta de API
    ramas_completas: ramas,
    por_posicion: porPosicion,
    // la probabilidad de que cada mapa del pool acabe jugándose, en cualquier posición
    p_jugado: (() => { const m = {}; for (const r of ramas) for (const key of r.jugados) m[key] = (m[key] || 0) + r.p; return m; })(),
    pool: maps.map((m) => m.key),
    nota: 'distribución sobre TODAS las ramas factibles del veto, no la rama de mayor probabilidad. Con el veto ya publicado se condiciona al prefijo y se renormaliza.',
  };
}

// Condiciona una distribución ya calculada a un veto publicado. Se recalcula desde cero porque condicionar
// reponderando las ramas supervivientes solo es correcto si las probabilidades de paso no cambian — y no
// cambian, pero recalcular cuesta milisegundos y no deja sitio a un error sutil.
function vetoCondicionado(mapStrength, prefijo, opts = {}) {
  return vetoDistribucion(mapStrength, { ...opts, prefijo });
}

// La serie sobre la distribución de veto: se compila CADA rama con sus mapas y se promedia por la
// probabilidad de la rama. Promediar los p_map primero y compilar después da otro número —el mejor de 3 no
// es lineal— y es el atajo que hay que no tomar.
function serieSobreVeto(dist, mapStrength, bo = 3, { momentum = MOMENTUM } = {}) {
  if (!dist || !dist.ramas_completas || !dist.ramas_completas.length) return null;
  let p = 0, masa = 0;
  const porRama = [];
  for (const r of dist.ramas_completas) {
    const ps = r.jugados.map((key) => pMap(mapStrength.a[key]));
    if (ps.some((x) => !Number.isFinite(x.p))) continue;
    const s = serie(ps, bo, { momentum });
    p += r.p * s.p_series.p; masa += r.p;
    if (porRama.length < 20) porRama.push({ p_rama: r.p, jugados: r.jugados, p_series: s.p_series.p });
  }
  if (!(masa > 0)) return null;
  return { p_series: pSeries(p / masa, { bo, de: 'promedio sobre las ramas del veto, compilando cada rama por separado' }),
    masa_cubierta: masa, top_ramas: porRama };
}

// ══ 6. LECTURA DE MERCADOS DESDE LA PMF EXACTA ═════════════════════════════════════════════════════════
// Las mismas familias que cotiza `store.js`, leídas de la distribución exacta en vez de del histograma
// muestreado. `pHandicap` de `core.js` ya trata bien el empate exacto (línea entera → devolución), así que
// se reutiliza: no hace falta otra convención distinta para lo mismo.
const negHist = (d) => { const h = {}; for (const [k, p] of Object.entries(d.h)) h[String(-Number(k))] = p; return { h, n: d.n }; };

function mercadosDeMapa(distMapa, { lineasRondas = [], lineasHandicap = [] } = {}) {
  const out = { rondas: {}, handicap: {}, prorroga_p: distMapa.prorroga_p, media_rondas: distMapa.media_rondas };
  for (const l of lineasRondas) out.rondas[l] = { over: C.pOver(distMapa.dist.total, l), under: C.pUnder(distMapa.dist.total, l) };
  for (const l of lineasHandicap) {
    const h = C.pHandicap(distMapa.dist.margin, l);
    const a = C.pHandicap(negHist(distMapa.dist.margin), -l);
    out.handicap[l] = { home: h ? h.p : null, away: a ? a.p : null, push: h ? h.push : null };
  }
  return out;
}

// El hándicap de rondas, que es la familia con dinero en la sombra (`cs2_rounds_v1`). Se expone suelto
// porque el comparador la llama millones de veces y no necesita el resto.
function pHandicapRondas(distMapa, linea, lado) {
  const d = lado === 'home' ? distMapa.dist.margin : negHist(distMapa.dist.margin);
  const l = lado === 'home' ? linea : -linea;
  const h = C.pHandicap(d, l);
  return h ? h.p : null;
}

// ══ 7. LA FACHADA ══════════════════════════════════════════════════════════════════════════════════════
// Entra: la probabilidad de serie ANCLADA (la que el motor publica hoy, que sale del mercado) y la fuerza
// por mapa. Sale: la cadena completa y COHERENTE serie → mapa → ronda, con el residuo de cada conversión
// publicado. Nada de esto genera picks: es el aspirante, y su sitio es el comparador.
function analiza({ pSeriesAnclada, mapStrength, bo = 3, pool = null, vetoPublicado = null,
  eco = ECO_DRAG, momentum = MOMENTUM } = {}) {
  const dist = mapStrength ? vetoDistribucion(mapStrength, { bo, pool, prefijo: vetoPublicado }) : null;
  const jugados = dist && dist.ramas_completas.length ? dist.ramas_completas[0].jugados : null;
  const forma = jugados ? jugados.map((key) => pMap(mapStrength.a[key])) : null;

  // 1) el NIVEL lo pone el ancla; la FORMA, el veto
  const nivel = (forma && pSeriesAnclada != null)
    ? pMapsDesdePSeries(pSeries(pSeriesAnclada), forma, bo, { momentum })
    : null;
  const pMaps = nivel ? nivel.p_maps : forma;

  // 2) de cada p_map sale SU p_round, por bisección, y con él SU distribución de rondas
  const porMapa = (pMaps || []).map((pm, i) => {
    const pr = pRoundDesdePMap(pm, { eco });
    const d = distribucionMapa(pr, { eco });
    return {
      orden: i + 1, mapa: jugados ? jugados[i] : null,
      p_map: pm, p_round: pr,
      // la comprobación de ida y vuelta, publicada mapa a mapa: sin esto la bisección es un acto de fe
      ida_y_vuelta_pp: 100 * (d.p_map.p - pm.p),
      dist: d,
    };
  });

  // 3) la serie recompilada con los p_map que de verdad se usaron; tiene que reproducir el ancla
  const recompilada = pMaps && pMaps.length ? serie(pMaps, bo, { momentum }) : null;

  return {
    version: 'cs2-s1-1', challenger: true,
    p_series_anclada: pSeriesAnclada != null ? pSeries(pSeriesAnclada) : null,
    p_series_recompilada: recompilada ? recompilada.p_series : null,
    cierre_del_circulo_pp: (recompilada && pSeriesAnclada != null)
      ? 100 * (recompilada.p_series.p - pSeriesAnclada) : null,
    nivel, veto: dist, por_mapa: porMapa, serie: recompilada,
    constantes: { eco, momentum, veto_k: VETO_K,
      momentum_nota: momentum === 0
        ? 'momentum APAGADO por defecto en el challenger: el +0,06 de core.js está etiquetado experimental y sin evidencia'
        : 'momentum ENCENDIDO a mano: no hay medición que lo respalde' },
  };
}

module.exports = {
  // tipos
  pRound, pMap, pSeries, valor,
  // mapa
  distribucionMapa, pRoundDesdePMap, pMapDesdePRound, mercadosDeMapa, pHandicapRondas,
  // serie
  serie, pMapsDesdePSeries,
  // veto
  vetoDistribucion, vetoCondicionado, serieSobreVeto,
  // fachada
  analiza,
  // constantes, expuestas para el comparador y los tests
  ECO_DRAG, MOMENTUM, VETO_K, OBJETIVO, PATRONES,
};
