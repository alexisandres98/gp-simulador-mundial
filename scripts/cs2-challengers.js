#!/usr/bin/env node
// scripts/cs2-challengers.js — E3 / T2.8 DE LA AUDITORÍA EXTERNA (15-sep-2026).
//
// ── LA PREGUNTA ─────────────────────────────────────────────────────────────────────────────────────────
// `cs2_rounds_v1` es la familia de esports con más muestra de la casa (541 apuestas en la sombra, 1.128
// picks en el motor) y la que la auditoría señala como fallo de mecanismo: la probabilidad de ronda, la de
// mapa y la de serie se mezclan sin tipar, y la conversión mapa→ronda es una constante escrita a ojo que no
// cierra el círculo (A16, medido y documentado en `esports-engine/cs2-s1.js`).
//
// La pregunta que este script contesta es exactamente la del plan: sobre **las mismas series, los mismos
// mapas y las mismas líneas**, ¿el modelo actual le gana al challenger S1 y al competidor trivial `p = 0,5`?
// Y por separado en Pinnacle y en Cloudbet, porque mezclar casas ya costó caro: la única familia de CS2 con
// CLV positivo y significativo vivía en Pinnacle, y su retorno esperado real es −3,28 %.
//
// ── LOS TRES ASPIRANTES ─────────────────────────────────────────────────────────────────────────────────
//   T0    el motor congelado tal cual salió en producción. NO se recalcula: su probabilidad es la que quedó
//         escrita en cada apuesta (`model_prob`). Es el único aspirante que no se puede falsear.
//   S1    el challenger de `esports-engine/cs2-s1.js`: mismo p_map, misma mecánica de ronda, mismo arrastre
//         económico, y la conversión mapa→ronda resuelta por bisección en vez de por constante.
//   MON   la moneda literal: `p = 0,5` en toda apuesta. Es el competidor trivial que pide el plan, y su
//         log-score es exactamente ln 2 = 0,69315. Un modelo que no le gana a esto no está informando de
//         nada sobre sus propias apuestas.
//   MAP50 el mapa es una moneda (p_map = 0,5) y de ahí sale la distribución de margen de rondas. Sabe la
//         ESTRUCTURA del juego (cuánto se separan los marcadores) y nada de los equipos. Separa las dos
//         preguntas: cuánto aporta saber cómo se reparten las rondas y cuánto aporta saber quién juega.
//
// ── CÓMO SE RECONSTRUYE EL p_map DE CADA APUESTA (y por qué es legítimo) ───────────────────────────────
// El libro de la sombra guarda la probabilidad publicada del modelo, no sus entradas. Pero el camino del
// motor congelado es determinista e invertible:
//
//     p_map (anclado al mercado) → clampRound → p_round → simulación de rondas → P(hándicap en la línea)
//
// Así que de `model_prob`, la línea y el lado se recupera por bisección el p_round que el motor usó, y de
// ahí el p_map que le habían dado (invirtiendo `clampRound`, que es lineal en el tramo que se cotiza). Ese
// p_map es el MISMO para los tres aspirantes: es lo que garantiza que se comparan tres lecturas del mismo
// partido y no tres partidos distintos. La reconstrucción se audita fila a fila con su residuo, y la fila
// que no se puede recuperar se descarta CONTADA, nunca rellenada.
//
// La simulación de rondas de S1 es exacta (programación dinámica) y reproduce el Monte Carlo del motor
// congelado dentro del error de muestreo — lo comprueba `tests/cs2-s1.test.js` §9—, así que la diferencia
// entre T0 y S1 es la conversión y solo la conversión.
//
// ── LO QUE ESTE SCRIPT **NO** PUEDE HACER, Y HAY QUE DECIRLO ANTES QUE NADA ────────────────────────────
// El universo son las apuestas que el motor CONGELADO decidió hacer. El archivo de cierres con el menú
// completo de líneas vive en el disco persistente de Render y no sale por ninguna ruta de exportación, así
// que **no se puede preguntar qué habría apostado S1 que T0 no apostó**: solo qué habría dejado de apostar.
// La comparación es honesta en un sentido (S1 no puede inventarse aciertos) y está sesgada en el otro (S1
// no puede lucirse con lo que T0 se perdió). Va escrito en el documento y no se disimula.
//
// ── CÓMO SE PUNTÚA ──────────────────────────────────────────────────────────────────────────────────────
//   · DISCRIMINACIÓN — log-score y Brier de cada aspirante contra el resultado real de la MISMA apuesta.
//     Diferencias pareadas, incertidumbre por bootstrap de RACIMOS DE SERIE (`lib/inferencia.js`): los dos
//     mapas de una serie los juega el mismo equipo el mismo día y no son dos observaciones.
//   · ECONOMÍA — `EV_cierre` por contrato con `lib/ev.js`. El archivo de cierres no guarda la cara contraria
//     accesible desde fuera, así que se usa `evDesdeMargen` con la Q MEDIDA de cada casa y familia
//     (`lib/margen.js` sobre el archivo de cierres, publicada en `docs/METRICAS_RECALCULADAS_2026-09.md`).
//     Es una aproximación declarada —Q típica de la familia, no la del partido— pero es la FÓRMULA correcta:
//     la diferencia con restar el margen al CLV no es de precisión, es de significado.
//   · SELECCIÓN — con el mismo listón de ventaja para los tres, cuántas apuestas sobreviven bajo cada uno y
//     qué EV_cierre y qué ROI realizado tiene el subconjunto que cada uno conserva.
//
// Sobre las doce comparaciones declaradas se aplica Benjamini-Hochberg al 10 % (`INF.bh`).
//
// Uso:
//   node scripts/cs2-challengers.js --libro <cs2-shadow.json> [--json <salida>] [--eco 0.055] [--bar 3]
'use strict';

const fs = require('fs');
const S1 = require('../esports-engine/cs2-s1');
const EV = require('../lib/ev');
const INF = require('../lib/inferencia');
const CT = require('../lib/contrato');

// ── ARGUMENTOS ────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIBRO = arg('--libro', null);
const SALIDA = arg('--json', null);
const ECO = Number(arg('--eco', S1.ECO_DRAG));
const BARRAS = String(arg('--bar', '3,5,8')).split(',').map(Number);
const FAMILIA = arg('--familia', 'RONDAS_HANDICAP');
if (!LIBRO) { console.error('falta --libro <fichero del libro de la sombra>'); process.exit(1); }

// ── EL MARGEN MEDIDO DE CADA CASA ─────────────────────────────────────────────────────────────────────
// Medido por `lib/margen.js` emparejando las DOS caras del mismo mercado en el archivo de cierres de esports
// y publicado en `docs/METRICAS_RECALCULADAS_2026-09.md` (§2). No se supone ninguno: una casa sin margen
// medido se queda SIN EV y se cuenta aparte, que es la disciplina de `lib/margen.js` y de `lib/ev.js`.
const MARGEN_LADO_PCT = {
  'pinnacle|RONDAS_HANDICAP': 2.21,
  'cloudbet|RONDAS_HANDICAP': 3.13,
  'bovada|RONDAS_HANDICAP': 3.02,
  'pinnacle|RONDAS': 2.72,
  'cloudbet|RONDAS': null,          // el archivo de cierres no empareja las dos caras: no se inventa
  'bovada|RONDAS': 3.33,
};

// ══ 1. LA MECÁNICA DE RONDA, MEMORIZADA ════════════════════════════════════════════════════════════════
// La distribución exacta de un mapa cuesta unos milisegundos; con 541 apuestas y dos bisecciones por
// apuesta salen decenas de miles de llamadas. Se memoriza sobre una rejilla de 1e-4 en p_round, que es la
// misma resolución con la que el libro guarda `model_prob` (cuatro decimales): pedir más precisión que la
// del dato de entrada sería precisión fingida.
const REJILLA = 1e-4;
const _memo = new Map();
function dist(pr) {
  const k = Math.round(pr / REJILLA);
  if (_memo.has(k)) return _memo.get(k);
  const d = S1.distribucionMapa(S1.pRound(k * REJILLA), { eco: ECO });
  _memo.set(k, d);
  return d;
}
const H = (pr, linea, lado) => S1.pHandicapRondas(dist(pr), linea, lado);
const pMapDe = (pr) => dist(pr).p_map.p;

// `clampRound` del motor congelado, copiada aquí porque es la pieza que se está juzgando: importarla de
// `cs2.js` obligaría a exportarla y a tocar un archivo congelado.
const clampRoundT0 = (pm) => Math.max(0.32, Math.min(0.68, 0.5 + (pm - 0.5) * 0.42));
const inversaClampRound = (pr) => 0.5 + (pr - 0.5) / 0.42;

// Recupera el p_round que el motor congelado usó, por bisección sobre su propia salida. La función es
// monótona en p_round, pero el SENTIDO depende del lado: para el visitante la probabilidad baja cuando el
// local se fortalece. Se detecta el sentido en vez de suponerlo — suponerlo es como `marketAnchor` acabó
// resolviendo "local +1,5" donde el mercado decía "local −1,5".
function recuperaPRound(p, linea, lado) {
  const f = (x) => H(x, linea, lado);
  let lo = 0.30, hi = 0.70;                    // el rango que `clampRound` puede producir es [0,32; 0,68]
  const flo = f(lo), fhi = f(hi);
  if (flo == null || fhi == null) return null;
  const creciente = fhi > flo;
  const min = Math.min(flo, fhi), max = Math.max(flo, fhi);
  if (p < min - 5e-3 || p > max + 5e-3) return { fuera: true, min, max };
  for (let i = 0; i < 40 && hi - lo > REJILLA / 4; i++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if (creciente ? v < p : v > p) lo = mid; else hi = mid;
  }
  const x = (lo + hi) / 2;
  return { p_round: x, residuo: f(x) - p, fuera: false };
}

// ══ 2. CARGA DEL LIBRO ═════════════════════════════════════════════════════════════════════════════════
// El racimo es la SERIE. El identificador de la pick lo trae dentro:
//   es_cs2_cs2:2026-09-14:bushido-wildcats-cs~enjoy_RONDAS_HANDICAP_home_-3.5_1
//              └──────────── serie ────────────┘                          └ mapa
function parseaPick(id) {
  const m = String(id || '').match(/^es_cs2_(cs2:\d{4}-\d{2}-\d{2}:[^_]+)_([A-Z_]+)_([a-z]+)_(-?[\d.]+)_(\d+)$/);
  if (!m) return null;
  return { serie: m[1], familia: m[2], lado: m[3], linea: Number(m[4]), mapa: Number(m[5]) };
}

function carga() {
  const j = JSON.parse(fs.readFileSync(LIBRO, 'utf8'));
  const filas = [];
  const descartes = { otra_familia: 0, sin_resultado: 0, sin_cuota: 0, id_ilegible: 0 };
  for (const b of j.bets || []) {
    if (b.family !== FAMILIA) { descartes.otra_familia++; continue; }
    if (b.result !== 'WIN' && b.result !== 'LOSS') { descartes.sin_resultado++; continue; }
    if (!(b.odds > 1) || !(b.model_prob > 0 && b.model_prob < 1)) { descartes.sin_cuota++; continue; }
    const pk = parseaPick(b.pick_id);
    if (!pk) { descartes.id_ilegible++; continue; }
    filas.push({
      id: b.id, serie: pk.serie, mapa: pk.mapa, lado: b.side, linea: b.line,
      casa: String(b.book || '').toLowerCase(), liga: b.league, partido: b.match,
      entrada: b.odds, cierre: b.closing != null ? b.closing : null,
      p_t0: b.model_prob, y: b.result === 'WIN' ? 1 : 0,
      stake: b.stake, pnl: b.pnl, at: b.placed_at, saque: b.kickoff_at,
      // LA TUPLA DEL CONTRATO, no una cuota suelta (`lib/contrato.js`, A01): selección, línea y cuota
      // viajan juntas. Aquí solo se usa para la clave canónica del dedupe y para el informe, pero se
      // construye igual: el día que haya menú completo, el emparejado ya está escrito.
      clave: CT.clave({ deporte: 'cs2', competicion: b.league, evento: pk.serie, periodo: `mapa ${pk.mapa}`,
        familia: FAMILIA, seleccion: b.side, linea: b.line, casa: b.book, tipoLinea: 'handicap' }),
    });
  }
  return { filas, descartes, total: (j.bets || []).length };
}

// ══ 3. LOS TRES ASPIRANTES SOBRE LA MISMA FILA ═════════════════════════════════════════════════════════
function evalua(f) {
  const rec = recuperaPRound(f.p_t0, f.linea, f.lado);
  if (!rec || rec.fuera) return { ...f, recuperada: false, motivo: rec ? 'la probabilidad publicada cae fuera de lo que la simulación puede producir en esa línea' : 'la línea no produce una función monótona utilizable' };
  const prT0 = rec.p_round;
  // el p_map que el motor tenía delante: se invierte `clampRound`. Si el p_round recuperado toca el tope,
  // el p_map NO está identificado (la constante satura) y la fila se marca.
  const saturada = prT0 <= 0.3205 || prT0 >= 0.6795;
  const pmap = Math.max(1e-4, Math.min(1 - 1e-4, inversaClampRound(prT0)));
  // S1: el MISMO p_map, con la conversión resuelta por bisección
  const prS1 = S1.pRoundDesdePMap(S1.pMap(pmap), { eco: ECO });
  const pS1 = H(prS1.p, f.linea, f.lado);
  // MAP50: el mapa es una moneda. p_map = 0,5 ⇒ p_round = 0,5 exacta.
  const p50 = H(0.5, f.linea, f.lado);
  return {
    ...f, recuperada: true, saturada,
    p_round_t0: prT0, residuo_t0: rec.residuo, p_map: pmap,
    p_map_que_t0_jugaba: pMapDe(prT0),       // el p_map que la simulación de T0 de verdad implicaba
    p_round_s1: prS1.p, p_s1: pS1, p_50: p50, p_mon: 0.5,
    // la distancia entre lo que T0 decía creer y lo que su simulación jugaba, en puntos
    incoherencia_pp: 100 * (pMapDe(prT0) - pmap),
  };
}

// ══ 4. PUNTUACIÓN ══════════════════════════════════════════════════════════════════════════════════════
const EPS = 1e-6;
const logScore = (p, y) => { const q = Math.min(1 - EPS, Math.max(EPS, p)); return -(y * Math.log(q) + (1 - y) * Math.log(1 - q)); };
const brier = (p, y) => (p - y) ** 2;

// Diferencia pareada con bootstrap por racimos de SERIE. Positivo = el aspirante puntúa PEOR que T0 (los
// dos marcadores son de pérdida: menos es mejor).
function pareada(filas, fp, fq, etiqueta) {
  const items = filas.map((f) => ({ serie: f.serie, d: fq(f) - fp(f) }));
  const b = INF.bootstrapClusters(items, { valor: (x) => x.d, cluster: (x) => x.serie, replicas: 4000, semilla: 815 });
  const p = b.t != null ? INF.pDeT(b.t, Math.max(3, b.n_clusters - 1)) : null;
  return { etiqueta, n: b.n_items, racimos: b.n_clusters, delta: b.media, ic: b.ic, se: b.se, t: b.t, p };
}

// ══ 5. ECONOMÍA: EV_cierre POR CONTRATO ════════════════════════════════════════════════════════════════
function evDeFila(f) {
  const margen = MARGEN_LADO_PCT[`${f.casa}|${FAMILIA}`];
  if (margen == null) return { ok: false, motivo: 'la casa no tiene margen medido para esta familia' };
  if (!(f.cierre > 1)) return { ok: false, motivo: 'sin cierre guardado' };
  const Q = EV.QDeMargenLado(margen);
  return EV.evDesdeMargen({ entrada: f.entrada, cierre: f.cierre, Q });
}

// Lo que cada aspirante conservaría con un listón común de ventaja. `p − 1/cuota` en puntos.
const ventajaPp = (p, cuota) => 100 * (p - 1 / cuota);

function bloqueSeleccion(filas, campo, bar) {
  const sel = filas.filter((f) => ventajaPp(f[campo], f.entrada) >= bar);
  const conEv = sel.map((f) => ({ ...f, ev: evDeFila(f) })).filter((x) => x.ev.ok);
  const ev = INF.bootstrapClusters(conEv, { valor: (x) => x.ev.ev_pct, cluster: (x) => x.serie, replicas: 4000, semilla: 815 });
  const roi = INF.roiIC(sel, {
    beneficio: (f) => (f.y ? f.entrada - 1 : -1), stake: () => 1,
    cluster: (f) => f.serie, replicas: 4000, semilla: 815,
  });
  return {
    n: sel.length, racimos_sel: roi.n_clusters, cobertura_ev: conEv.length,
    ev_medio_pct: ev.media, ev_ic: ev.ic, ev_t: ev.t,
    roi_pct: roi.roi_pct, roi_ic: roi.ic_pct, roi_t: roi.t,
    aciertos: sel.filter((f) => f.y).length,
  };
}

// ══ 6. LA CORRIDA ══════════════════════════════════════════════════════════════════════════════════════
function main() {
  const { filas, descartes, total } = carga();
  console.log(`Libro: ${LIBRO}`);
  console.log(`  ${total} apuestas · ${filas.length} utilizables de ${FAMILIA} (liquidadas WIN/LOSS con cuota y probabilidad)`);
  console.log(`  descartes: ${JSON.stringify(descartes)}`);

  // ── DEDUPE POR CONTRATO CANÓNICO ────────────────────────────────────────────────────────────────────
  // No para filtrar (el libro es el libro) sino para saber cuánta correlación hay dentro del racimo. La
  // doctrina del ejecutor real ya midió lo que cuesta apilar líneas del mismo partido: −17,63 % de ROI con
  // dos y −45,83 % con tres. Aquí se cuenta cuántas apuestas comparten serie y cuántas comparten incluso
  // serie + lado, que es el racimo de verdad.
  const porSerie = {}, porSerieLado = {}, porClave = {};
  for (const f of filas) {
    porSerie[f.serie] = (porSerie[f.serie] || 0) + 1;
    porSerieLado[`${f.serie}|${f.lado}`] = (porSerieLado[`${f.serie}|${f.lado}`] || 0) + 1;
    porClave[f.clave] = (porClave[f.clave] || 0) + 1;
  }
  const apiladas = Object.values(porSerieLado).filter((n) => n > 1).length;
  console.log(`  series distintas: ${Object.keys(porSerie).length} · contratos canónicos distintos: ${Object.keys(porClave).length}` +
    ` · racimos serie+lado con más de una apuesta: ${apiladas}` +
    ` · mayor racimo: ${Math.max(...Object.values(porSerie))} apuestas en una serie`);

  const ev0 = Date.now();
  const filasE = filas.map(evalua);
  const ok = filasE.filter((f) => f.recuperada);
  const noRec = filasE.filter((f) => !f.recuperada);
  console.log(`  reconstruidas: ${ok.length} · no reconstruibles: ${noRec.length} · saturadas (p_map no identificado): ${ok.filter((f) => f.saturada).length}`);
  console.log(`  residuo máximo de la reconstrucción: ${Math.max(...ok.map((f) => Math.abs(f.residuo_t0))).toExponential(2)}`);
  console.log(`  (${((Date.now() - ev0) / 1000).toFixed(1)} s, ${_memo.size} distribuciones exactas calculadas)`);

  // ── La incoherencia del motor congelado, medida sobre las apuestas de verdad ────────────────────────
  const inc = ok.map((f) => f.incoherencia_pp);
  const incIC = INF.bootstrapClusters(ok, { valor: (f) => f.incoherencia_pp, cluster: (f) => f.serie, replicas: 4000, semilla: 815 });
  console.log('\n══ LA INCOHERENCIA, MEDIDA SOBRE EL LIBRO REAL ══');
  console.log(`  El motor decía creer un p_map y su simulación jugaba otro. Diferencia media: ${incIC.media.toFixed(2)} pp`);
  console.log(`  IC 95 % por racimos de serie: [${incIC.ic.map((x) => x.toFixed(2)).join(', ')}]  ·  t ${incIC.t}`);
  console.log(`  rango: ${Math.min(...inc).toFixed(2)} a ${Math.max(...inc).toFixed(2)} pp · |desvío| > 3 pp en ${ok.filter((f) => Math.abs(f.incoherencia_pp) > 3).length} de ${ok.length}`);
  const desplaza = ok.map((f) => 100 * (f.p_s1 - f.p_t0));
  const despIC = INF.bootstrapClusters(ok, { valor: (f) => 100 * (f.p_s1 - f.p_t0), cluster: (f) => f.serie, replicas: 4000, semilla: 815 });
  console.log(`  Efecto sobre la probabilidad publicada (S1 − T0): media ${despIC.media.toFixed(2)} pp, IC [${despIC.ic.map((x) => x.toFixed(2)).join(', ')}]`);
  console.log(`  a favor de T0 en ${desplaza.filter((x) => x < 0).length} filas y en contra en ${desplaza.filter((x) => x > 0).length}`);

  // ── Por casa ────────────────────────────────────────────────────────────────────────────────────────
  const casas = [...new Set(ok.map((f) => f.casa))].sort();
  const comparaciones = [];
  const salida = { libro: LIBRO, familia: FAMILIA, eco: ECO, generado: new Date().toISOString(),
    n_total: total, n_utilizables: filas.length, n_reconstruidas: ok.length, descartes,
    incoherencia: { media_pp: incIC.media, ic: incIC.ic, t: incIC.t, n: incIC.n_items, racimos: incIC.n_clusters },
    desplazamiento_s1: { media_pp: despIC.media, ic: despIC.ic, t: despIC.t },
    por_casa: {} };

  for (const casa of casas) {
    const fc = ok.filter((f) => f.casa === casa);
    if (fc.length < 20) { console.log(`\n── ${casa}: ${fc.length} filas, muestra insuficiente para juzgar ──`); continue; }
    console.log(`\n══════ ${casa.toUpperCase()} · ${fc.length} apuestas · ${new Set(fc.map((f) => f.serie)).size} series ══════`);
    const base = (fp) => ({
      log: fc.reduce((a, f) => a + logScore(fp(f), f.y), 0) / fc.length,
      brier: fc.reduce((a, f) => a + brier(fp(f), f.y), 0) / fc.length,
      p_media: fc.reduce((a, f) => a + fp(f), 0) / fc.length,
    });
    const CAMPOS = [['T0', 'p_t0'], ['S1', 'p_s1'], ['MON', 'p_mon'], ['MAP50', 'p_50']];
    const g = {};
    for (const [k, campo] of CAMPOS) g[k] = base((f) => f[campo]);
    const tasa = fc.filter((f) => f.y).length / fc.length;
    console.log(`  tasa de acierto real: ${(100 * tasa).toFixed(1)} %  ·  ln 2 = 0,69315 es el log-score de la moneda`);
    console.log('  aspirante | p media | log-score | Brier');
    for (const [k] of CAMPOS) {
      console.log(`  ${k.padEnd(9)} | ${g[k].p_media.toFixed(4)}  | ${g[k].log.toFixed(5)}   | ${g[k].brier.toFixed(5)}`);
    }
    // LAS DOCE COMPARACIONES DECLARADAS: tres aspirantes contra T0, dos métricas, dos casas. Se declaran
    // TODAS antes de mirar, que es lo que permite corregir por comparaciones múltiples sin hacer trampa.
    const cmpL = [], cmpB = [];
    for (const [k, campo] of CAMPOS.slice(1)) {
      cmpL.push(pareada(fc, (f) => logScore(f.p_t0, f.y), (f) => logScore(f[campo], f.y), `${casa} · log-score ${k}−T0`));
      cmpB.push(pareada(fc, (f) => brier(f.p_t0, f.y), (f) => brier(f[campo], f.y), `${casa} · Brier ${k}−T0`));
    }
    console.log('  diferencias pareadas (negativo = el aspirante puntúa MEJOR que T0):');
    for (const c of cmpL.concat(cmpB)) {
      console.log(`   ${c.etiqueta.padEnd(30)} Δ ${String(c.delta).padStart(10)} IC [${c.ic.map((x) => (x == null ? 'n/d' : x.toFixed(5))).join(', ')}] t ${c.t} p ${c.p}`);
      comparaciones.push(c);
    }

    // ── economía ──────────────────────────────────────────────────────────────────────────────────────
    const conEv = fc.map((f) => ({ ...f, ev: evDeFila(f) }));
    const sinEv = conEv.filter((x) => !x.ev.ok);
    const evAll = INF.bootstrapClusters(conEv.filter((x) => x.ev.ok), { valor: (x) => x.ev.ev_pct, cluster: (x) => x.serie, replicas: 4000, semilla: 815 });
    console.log(`  EV_cierre del libro entero (${conEv.length - sinEv.length}/${fc.length} con cierre y margen medido): ` +
      `${evAll.media != null ? evAll.media.toFixed(2) : 'n/d'} % IC [${(evAll.ic || []).map((x) => (x == null ? 'n/d' : x.toFixed(2))).join(', ')}] t ${evAll.t}`);
    if (sinEv.length) {
      const motivos = {}; for (const x of sinEv) motivos[x.ev.motivo] = (motivos[x.ev.motivo] || 0) + 1;
      console.log(`    fuera del EV: ${JSON.stringify(motivos)}`);
    }

    console.log('  selección con listón común (cuántas sobreviven bajo cada aspirante):');
    const sel = {};
    for (const bar of BARRAS) {
      sel[bar] = {};
      console.log(`   listón ${bar} pp:`);
      for (const [k, campo] of [['T0', 'p_t0'], ['S1', 'p_s1'], ['MAP50', 'p_50']]) {
        const r = bloqueSeleccion(fc, campo, bar);
        sel[bar][k] = r;
        console.log(`     ${k.padEnd(4)} n ${String(r.n).padStart(4)} · aciertos ${String(r.aciertos).padStart(3)} · ` +
          `EV ${r.ev_medio_pct != null ? r.ev_medio_pct.toFixed(2) : ' n/d'} % IC [${(r.ev_ic || []).map((x) => (x == null ? 'n/d' : x.toFixed(2))).join(', ')}]` +
          ` · ROI ${r.roi_pct != null ? r.roi_pct.toFixed(2) : ' n/d'} % IC [${(r.roi_ic || []).map((x) => (x == null ? 'n/d' : x.toFixed(2))).join(', ')}]`);
      }
    }
    salida.por_casa[casa] = { n: fc.length, series: new Set(fc.map((f) => f.serie)).size, tasa_acierto: tasa,
      marcadores: g, comparaciones: cmpL.concat(cmpB), ev_libro: { media: evAll.media, ic: evAll.ic, t: evAll.t, n: conEv.length - sinEv.length },
      seleccion: sel };
  }

  // ══ BENJAMINI-HOCHBERG SOBRE TODAS LAS COMPARACIONES DECLARADAS ═════════════════════════════════════
  const ps = comparaciones.map((c) => c.p).filter((x) => x != null);
  const bh = INF.bh(comparaciones.map((c) => (c.p == null ? 1 : c.p)), 0.10);
  console.log('\n══ CORRECCIÓN POR COMPARACIONES MÚLTIPLES ══');
  console.log(`  ${comparaciones.length} comparaciones declaradas · umbral BH al 10 %: ${bh.umbral}`);
  for (const i of bh.rechazadas) console.log(`  sobrevive: ${comparaciones[i].etiqueta} (p ${comparaciones[i].p})`);
  if (!bh.rechazadas.length) console.log('  ninguna comparación sobrevive al umbral: nada que declarar');
  salida.bh = { m: comparaciones.length, umbral: bh.umbral, rechazadas: bh.rechazadas.map((i) => comparaciones[i].etiqueta) };
  salida.p_valores = ps;

  if (SALIDA) { fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 1)); console.log(`\nSalida: ${SALIDA}`); }
}

main();
