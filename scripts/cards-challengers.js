#!/usr/bin/env node
// scripts/cards-challengers.js — T2.3 DE LA AUDITORÍA EXTERNA (15-sep-2026).
//
// LA PREGUNTA. `cards_under_v1` es la única familia con dinero real de verdad y la vara nueva no la
// declara invertible. Antes de tocar el stake hay que saber una cosa que nunca se midió: ¿el modelo de
// tarjetas que la genera es mejor que las alternativas obvias, o solo es el primero que escribimos?
//
// CÓMO SE RESPONDE. Cuatro aspirantes sobre LAS MISMAS FILAS, con validación hacia adelante y los
// hiperparámetros elegidos DENTRO del entrenamiento (nunca mirando el bloque que se evalúa):
//
//   T0   el modelo actual, íntegro: prop-engine con el props-history de la liga, TOTALS_DAMP = 0, es decir
//        el total ES la media de la liga por el multiplicador de paridad. Sin árbitro, exactamente como
//        sale hoy en producción (ese es el hallazgo A19: el árbitro se entrena y no se sirve).
//   T1   nivel dinámico por liga × temporada con decaimiento temporal y dispersión estimada en el mismo
//        estrato. Aquí compiten las CUATRO leyes de conteo de `lib/conteos.js` con la misma media.
//   T2a  T1 × fuerzas de equipo (a favor y provocadas) con encogimiento, y un exponente de amortiguación
//        que el propio entrenamiento elige: si las fuerzas de equipo son ruido a nivel total, el exponente
//        se irá a 0 solo y T2a colapsará sobre T1. Eso también es un resultado.
//   T2b  T2a × árbitro RESIDUAL: el multiplicador del árbitro se estima sobre lo que queda después de
//        descontar liga y equipos, no sobre el bruto. Un árbitro que solo pita en una liga violenta no
//        es un árbitro estricto, y el multiplicador bruto no sabe distinguirlo.
//
// CÓMO SE PUNTÚA. log-score y CRPS sobre el total, y calibración EN LAS LÍNEAS QUE DE VERDAD SE OFRECEN
// (4,5 · 5,5 · 6,5), no en 2,5/3,5. El under que pagamos vive en 5,5; una calibración excelente en 2,5 no
// dice nada sobre él.
//
// LO QUE ESTE SCRIPT NO HACE. No mide ventaja contra el mercado: no tenemos el cierre histórico de
// tarjetas de clubes fuera de línea. Mide únicamente cuál de los cuatro describe mejor el conteo. Un
// ganador aquí es condición necesaria y no suficiente para invertir — el listón sigue siendo `lib/vara.js`.
//
// Uso:
//   node scripts/cards-challengers.js --dir <carpeta con props-history-*.json> [--json <salida>] [--rapido]
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('../lib/conteos');
const INF = require('../lib/inferencia');

const DIA = 86400e3;

// ── ARGUMENTOS ────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const DIR = arg('--dir', process.env.GP_CLUB_DATA_DIR || path.join(__dirname, '..', 'data', 'clubs'));
const SALIDA = arg('--json', null);
const RAPIDO = flag('--rapido');   // salta COM-Poisson y el histograma: solo Poisson y NB (para iterar)
// CONTEO. `antiguo` = amarillas + rojas, lo que hace el modelo hoy. `casa` = la regla de Cloudbet, una roja
// vale dos (`prop-engine/conteo.js`). Toda la comparación corre sobre el conteo que se elija, incluido el
// ajuste de T0: si se cambia el conteo hay que reajustar TODO, no solo la evaluación, o se estaría midiendo
// un modelo entrenado en una escala contra resultados en otra.
const CONTEO = arg('--conteo', 'antiguo');
const CN = require('../prop-engine/conteo');

// ── CARGA ─────────────────────────────────────────────────────────────────────────────────────────────
// Una fila por partido terminado y sin prórroga, con tarjetas de los dos lados.
// TARJETAS = amarillas + rojas, que es lo que cuenta el modelo y lo que liquidamos hoy. OJO: si Cloudbet
// cuenta la segunda amarilla como UNA tarjeta y no como dos, todo este ejercicio mide el conteo
// equivocado. Esa comprobación es T2.1 y va aparte, contra 40 partidos con incidencias.
function carga() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => /^props-history-.*\.json$/.test(f)); } catch { files = []; }
  if (!files.length) { console.error(`No hay props-history-*.json en ${DIR}`); process.exit(1); }
  const filas = [];
  for (const f of files) {
    const liga = f.replace(/^props-history-/, '').replace(/\.json$/, '');
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
    for (const m of (j.matches || [])) {
      if (m.et) continue;                                   // la prórroga no son 90' y el mercado sí lo es
      if (!m.home || !m.away) continue;
      const hy = m.home.yellows, ay = m.away.yellows;
      if (hy == null && ay == null) continue;                // sin dato de tarjetas no hay nada que aprender
      const t = Date.parse(m.date || '');
      if (!isFinite(t)) continue;
      const am = (Number(hy) || 0) + (Number(ay) || 0);
      const ro = (Number(m.home.reds) || 0) + (Number(m.away.reds) || 0);
      const y = CONTEO === 'casa' ? CN.conteoCasa(am, ro) : CN.conteoAntiguo(am, ro);
      // T0 se ajusta con prop-engine, que lee `yellows`/`reds` del objeto crudo. Para que T0 vea la MISMA
      // escala que los demás, el crudo se reescribe: toda la roja se pasa a la casilla de amarillas cuando
      // el conteo es el de la casa. No hay otra forma de reajustarlo sin tocar el motor de producción.
      const crudo = CONTEO === 'casa'
        ? { ...m, home: { ...m.home, yellows: (Number(hy) || 0) + 2 * (Number(m.home.reds) || 0), reds: 0 },
            away: { ...m.away, yellows: (Number(ay) || 0) + 2 * (Number(m.away.reds) || 0), reds: 0 } }
        : m;
      filas.push({
        liga, temporada: String(j.season || ''), t, fecha: (m.date || '').slice(0, 10),
        local: m.home.code, visita: m.away.code, arbitro: m.referee || null,
        gl: Number(m.home.goals) || 0, gv: Number(m.away.goals) || 0,
        y, crudo,
      });
    }
  }
  filas.sort((a, b) => a.t - b.t);
  return filas;
}

// ── ELO EN EL MOMENTO (para la paridad que usa T0) ────────────────────────────────────────────────────
// Recorrido cronológico: se anota el Elo ANTES de actualizar, así que ninguna fila ve su propio resultado
// ni ninguno posterior. Constantes de producción (K=30, factor G por margen, localía 60).
function eloEnElMomento(filas) {
  const elo = {};                                   // liga|equipo → rating
  const get = (lg, id) => (elo[lg + '|' + id] != null ? elo[lg + '|' + id] : 1500);
  const HFA = 60, K = 30;
  for (const f of filas) {
    const eh = get(f.liga, f.local), ea = get(f.liga, f.visita);
    f.elo_local = eh; f.elo_visita = ea;
    const we = 1 / (1 + Math.pow(10, -((eh + HFA) - ea) / 400));
    const margen = Math.abs(f.gl - f.gv);
    const g = margen <= 1 ? 1 : margen === 2 ? 1.5 : (11 + margen) / 8;
    const W = f.gl > f.gv ? 1 : f.gl === f.gv ? 0.5 : 0;
    const d = K * g * (W - we);
    elo[f.liga + '|' + f.local] = eh + d;
    elo[f.liga + '|' + f.visita] = ea - d;
  }
}

// Paridad 1X2 como la calcula producción (engine.matchProbs sobre las λ de Elo). Se carga perezosamente
// porque engine.js arrastra los datos del Mundial y no queremos pagarlo si no hace falta.
let _engine = null;
function paridad(f) {
  if (!_engine) { try { _engine = require('../engine.js'); } catch { _engine = { matchProbs: null }; } }
  if (!_engine.matchProbs) return null;
  try { return _engine.matchProbs(f.elo_local + 60, f.elo_visita); } catch { return null; }
}

// ── T0: EL MODELO ACTUAL, ÍNTEGRO ─────────────────────────────────────────────────────────────────────
// prop-engine.fit sobre los partidos de ESA liga anteriores al bloque, project con la paridad del momento
// y sin árbitro (como producción). μ y r salen del propio motor; la ley es NB, que es la que usa.
const PE = require('../prop-engine/model');
function t0Predice(entreno, evalua) {
  const porLiga = {};
  for (const f of entreno) (porLiga[f.liga] || (porLiga[f.liga] = [])).push(f.crudo);
  const fits = {};
  const out = [];
  for (const f of evalua) {
    if (fits[f.liga] === undefined) {
      const ms = porLiga[f.liga] || [];
      fits[f.liga] = ms.length >= 20 ? (() => { try { return PE.fit(ms); } catch { return null; } })() : null;
    }
    const fit = fits[f.liga];
    if (!fit) { out.push(null); continue; }
    let proj; try { proj = PE.project(fit, { home: f.local, away: f.visita, closeness1x2: paridad(f) }); } catch { proj = null; }
    if (!proj || !(proj.cards.total > 0)) { out.push(null); continue; }
    out.push({ pmf: C.nb(proj.cards.total, proj.cards.r_total), mu: proj.cards.total, ley: 'nb' });
  }
  return out;
}

// ── T1 / T2a / T2b: EL NIVEL ──────────────────────────────────────────────────────────────────────────
// El nivel se construye por ESTRATO liga × temporada con decaimiento exponencial, encogido hacia el nivel
// de la liga y, en última instancia, hacia el global. La temporada importa: los repartos de tarjetas
// cambian de un año a otro con las instrucciones a los árbitros, y un nivel de liga sin temporada mezcla
// dos regímenes distintos como si fueran uno.
function construyeNivel(entreno, tRef, { vidaMedia, prior }) {
  const g = { s: 0, w: 0, sq: 0, sw2: 0 };
  const liga = {}, estrato = {};
  const dec = Math.log(2) / (vidaMedia * DIA);
  for (const f of entreno) {
    const w = Math.exp(-dec * Math.max(0, tRef - f.t));
    const acc = (o) => { o.s += w * f.y; o.w += w; o.sq += w * f.y * f.y; o.sw2 += w * w; };
    acc(g);
    acc(liga[f.liga] || (liga[f.liga] = { s: 0, w: 0, sq: 0, sw2: 0 }));
    const k = f.liga + '|' + f.temporada;
    acc(estrato[k] || (estrato[k] = { s: 0, w: 0, sq: 0, sw2: 0 }));
  }
  const media = (o) => (o.w > 0 ? o.s / o.w : 0);
  const varianza = (o) => {
    if (!(o.w > 0)) return 0;
    const m = o.s / o.w, nEf = (o.w * o.w) / (o.sw2 || 1);
    const v = Math.max(0, o.sq / o.w - m * m);
    return nEf > 1 ? v * (nEf / (nEf - 1)) : v;
  };
  const muG = media(g), varG = varianza(g);
  return {
    mu(f) {
      const L = liga[f.liga], E = estrato[f.liga + '|' + f.temporada];
      const muL = L ? (prior * muG + L.s) / (prior + L.w) : muG;
      return E ? (prior * muL + E.s) / (prior + E.w) : muL;
    },
    // La varianza se encoge igual que la media: con pocos partidos en un estrato, la varianza muestral es
    // tan ruidosa como la media y una dispersión mal estimada deforma justo la cola del under.
    varianza(f) {
      const L = liga[f.liga], E = estrato[f.liga + '|' + f.temporada];
      const vL = L ? (prior * varG + L.w * varianza(L)) / (prior + L.w) : varG;
      return E ? (prior * vL + E.w * varianza(E)) / (prior + E.w) : vL;
    },
    muGlobal: muG,
  };
}

// Fuerzas de equipo sobre el RESIDUO del nivel: cuánto se desvía cada equipo de lo que su estrato predice,
// separando lo que provoca en contra de lo que comete. Encogidas a 1 con `k` partidos equivalentes y
// elevadas a `damp`: damp = 0 apaga las fuerzas por completo (que es lo que el Mundial eligió con 102
// partidos), damp = 1 las usa enteras.
function construyeFuerzas(entreno, nivel, tRef, { vidaMedia, k }) {
  const dec = Math.log(2) / (vidaMedia * DIA);
  const eq = {};
  for (const f of entreno) {
    const mu = nivel.mu(f); if (!(mu > 0)) continue;
    const w = Math.exp(-dec * Math.max(0, tRef - f.t));
    const ratio = f.y / mu;
    for (const id of [f.liga + '|' + f.local, f.liga + '|' + f.visita]) {
      const o = eq[id] || (eq[id] = { s: 0, w: 0 });
      o.s += w * ratio; o.w += w;
    }
  }
  return (f, damp) => {
    if (!(damp > 0)) return 1;
    const s = (id) => { const o = eq[id]; if (!o || !(o.w > 0)) return 1; return (k + o.s) / (k + o.w); };
    // Cada equipo aporta la RAÍZ de su ratio: el partido es de dos, y multiplicar dos ratios enteros
    // duplicaría el efecto respecto de cómo se estimaron (cada ratio ya es "tarjetas del partido / μ").
    const m = Math.sqrt(s(f.liga + '|' + f.local) * s(f.liga + '|' + f.visita));
    return Math.pow(m, damp);
  };
}

// PARIDAD. El modelo actual multiplica el total por 1,06 − 0,25·|p_local − p_visita| (topado ±10 %): un
// partido parejo se pica más. Los aspirantes TIENEN QUE PODER USARLO TAMBIÉN. La primera corrida de este
// script no se lo daba y el resultado era tramposo en el sentido incómodo: T0 parecía ganar a T1 cuando lo
// que ganaba era una señal que a T1 se le había escondido. El interruptor entra a la rejilla y se decide
// dentro del entrenamiento como cualquier otro hiperparámetro.
function paridadMult(f, usar) {
  if (!usar) return 1;
  const pr = paridad(f);
  if (!pr || pr.home == null || pr.away == null) return 1;
  const gap = Math.abs(Number(pr.home) - Number(pr.away));
  return Math.max(0.9, Math.min(1.1, 1.06 - 0.25 * gap));
}

// Árbitro RESIDUAL: sobre lo que queda tras liga, temporada y equipos. Encogido a 1 y topado ±20 %, igual
// que el multiplicador actual — el tope no es cosmético: con 15 partidos por árbitro, sin tope el
// estimador persigue el ruido.
function construyeArbitros(entreno, muDe, tRef, { vidaMedia, prior, tope = 0.2 }) {
  const dec = Math.log(2) / (vidaMedia * DIA);
  const ref = {};
  for (const f of entreno) {
    if (!f.arbitro) continue;
    const mu = muDe(f); if (!(mu > 0)) continue;
    const w = Math.exp(-dec * Math.max(0, tRef - f.t));
    const o = ref[f.arbitro] || (ref[f.arbitro] = { s: 0, w: 0, n: 0 });
    o.s += w * (f.y / mu); o.w += w; o.n++;
  }
  return (f) => {
    if (!f.arbitro) return 1;
    const o = ref[f.arbitro]; if (!o || !(o.w > 0)) return 1;
    const m = (prior + o.s) / (prior + o.w);
    return Math.max(1 - tope, Math.min(1 + tope, m));
  };
}

// ── LEYES ─────────────────────────────────────────────────────────────────────────────────────────────
const comCache = new Map();
function comCacheado(mu, va) {
  const k = mu.toFixed(2) + '|' + va.toFixed(2);
  let v = comCache.get(k);
  if (!v) { v = C.comPoisson(mu, va); comCache.set(k, v); }
  return v;
}
function LEYES() { return RAPIDO ? ['poisson', 'nb'] : ['poisson', 'nb', 'com', 'hist']; }
function aplicaLey(ley, mu, va, muestrasHist) {
  if (ley === 'poisson') return C.poisson(mu);
  if (ley === 'nb') return C.nb(mu, C.rDeMomentos(mu, va));
  if (ley === 'com') return comCacheado(mu, va).pmf;
  return C.histograma(muestrasHist.v, { pesos: muestrasHist.w, mu });
}

// ── EL ASPIRANTE COMPLETO ─────────────────────────────────────────────────────────────────────────────
// hp = { vidaMedia, prior, vidaEq, k, damp, priorRef }. `usaEquipos` y `usaArbitro` deciden si es T1, T2a
// o T2b — los tres comparten TODO lo demás, que es justo lo que hace que la comparación mida una cosa.
function construye(entreno, tRef, hp, { usaEquipos, usaArbitro }) {
  const nivel = construyeNivel(entreno, tRef, hp);
  const fuerza = usaEquipos ? construyeFuerzas(entreno, nivel, tRef, { vidaMedia: hp.vidaEq, k: hp.k }) : null;
  const muSinRef = (f) => nivel.mu(f) * (fuerza ? fuerza(f, hp.damp) : 1) * paridadMult(f, hp.paridad);
  const arb = usaArbitro ? construyeArbitros(entreno, muSinRef, tRef, { vidaMedia: hp.vidaEq, prior: hp.priorRef }) : null;
  // Muestras para el histograma: las del estrato, con su peso. Se calculan una vez por estrato.
  const dec = Math.log(2) / (hp.vidaMedia * DIA);
  const hist = {};
  for (const f of entreno) {
    const k = f.liga + '|' + f.temporada;
    const o = hist[k] || (hist[k] = { v: [], w: [] });
    o.v.push(f.y); o.w.push(Math.exp(-dec * Math.max(0, tRef - f.t)));
  }
  const vacio = { v: [], w: [] };
  return {
    mu: (f) => muSinRef(f) * (arb ? arb(f) : 1),
    varianza: (f) => nivel.varianza(f),
    muestras: (f) => hist[f.liga + '|' + f.temporada] || hist[f.liga + '|'] || vacio,
    nivel,
  };
}

// ── SELECCIÓN DE HIPERPARÁMETROS DENTRO DEL ENTRENAMIENTO ─────────────────────────────────────────────
// El último 20 % del entrenamiento (por fecha) hace de validación interna. El bloque que se evalúa NO se
// toca aquí: ese es el punto entero del protocolo anidado de la auditoría (§4.4).
//
// Se elige con la ley NB fija y luego los hiperparámetros elegidos se aplican a las cuatro leyes. No es
// pereza: los hiperparámetros gobiernan la MEDIA y la ley gobierna la FORMA. Buscar las dos cosas a la vez
// sobre la misma validación interna sobreajusta el split y además deja sin respuesta la pregunta que
// interesa — cuál de las cuatro formas describe mejor la cola con el mismo nivel debajo.
const REJILLA = {
  vidaMedia: [90, 180, 365, 730],
  prior: [5, 20, 60],
  vidaEq: [180, 365],
  k: [5, 15, 40],
  damp: [0, 0.25, 0.5, 1],
  priorRef: [5, 15, 40],
  paridad: [false, true],
};
const HP_DEFECTO = { vidaMedia: 365, prior: 20, vidaEq: 365, k: 15, damp: 0, priorRef: 15, paridad: true };
function elige(entreno, opciones) {
  if (entreno.length < 400) return Object.assign({ elegido: 'por_defecto' }, HP_DEFECTO);
  const corte = entreno[Math.floor(entreno.length * 0.8)].t;
  const dentro = entreno.filter((f) => f.t < corte), fuera = entreno.filter((f) => f.t >= corte);
  if (dentro.length < 200 || fuera.length < 50) return Object.assign({ elegido: 'muestra_corta' }, HP_DEFECTO);
  const tRef = corte;
  let mejor = null;
  const damps = opciones.usaEquipos ? REJILLA.damp : [0];
  const ks = opciones.usaEquipos ? REJILLA.k : [15];
  const vidasEq = opciones.usaEquipos ? REJILLA.vidaEq : [365];
  const priorsRef = opciones.usaArbitro ? REJILLA.priorRef : [15];
  for (const vidaMedia of REJILLA.vidaMedia) for (const prior of REJILLA.prior)
    for (const vidaEq of vidasEq) for (const k of ks) for (const damp of damps) for (const priorRef of priorsRef)
      for (const par of REJILLA.paridad) {
        const hp = { vidaMedia, prior, vidaEq, k, damp, priorRef, paridad: par };
        const M = construye(dentro, tRef, hp, opciones);
        let s = 0, n = 0;
        for (const f of fuera) {
          const mu = M.mu(f); if (!(mu > 0)) continue;
          s += C.logScore(C.nb(mu, C.rDeMomentos(mu, M.varianza(f))), f.y); n++;
        }
        if (!n) continue;
        const score = s / n;
        if (!mejor || score < mejor.score) mejor = { score, hp };
      }
  return mejor ? Object.assign({ elegido: 'validacion_interna', score_interno: +mejor.score.toFixed(5) }, mejor.hp)
    : Object.assign({ elegido: 'sin_solucion' }, HP_DEFECTO);
}

// ── PUNTUACIÓN ────────────────────────────────────────────────────────────────────────────────────────
const LINEAS = [4.5, 5.5, 6.5];   // las que Cloudbet ofrece de verdad y en las que entra el dinero

// Se guarda UNA FILA POR PARTIDO Y ASPIRANTE, no un agregado. Sin las filas no hay comparación pareada, y
// sin comparación pareada la diferencia entre dos modelos se mide contra la varianza de los partidos en vez
// de contra la varianza de la DIFERENCIA, que es entre diez y cien veces menor. La auditoría insistió en
// esto (§2.3): el partido es el racimo, y dos modelos evaluados en el mismo partido comparten casi todo.
const registro = [];   // { clave, liga, fecha, y, por: { 'T2b|nb': { log, crps, under: {4.5:p,...} } } }
const porClave = new Map();
function anota(id, pmf, f) {
  const clave = f.liga + '|' + f.fecha + '|' + f.local + '|' + f.visita;
  let r = porClave.get(clave);
  if (!r) { r = { clave, liga: f.liga, fecha: f.fecha, y: f.y, por: {} }; porClave.set(clave, r); registro.push(r); }
  const under = {};
  for (const l of LINEAS) under[l] = 1 - C.pOver(pmf, l);
  r.por[id] = { log: C.logScore(pmf, f.y), crps: C.crps(pmf, f.y), under };
}
function agrega(id) {
  const fil = registro.filter((r) => r.por[id]);
  if (!fil.length) return null;
  const m = (g) => fil.reduce((s, r) => s + g(r.por[id], r), 0) / fil.length;
  const out = { n: fil.length, log_score: +m((p) => p.log).toFixed(5), crps: +m((p) => p.crps).toFixed(5), lineas: {} };
  for (const l of LINEAS) {
    const pm = m((p) => p.under[l]);
    const re = fil.filter((r) => r.y < l).length / fil.length;
    out.lineas[l] = {
      n: fil.length,
      brier: +m((p, r) => { const d = p.under[l] - (r.y < l ? 1 : 0); return d * d; }).toFixed(5),
      p_under_media: +pm.toFixed(4), under_real: +re.toFixed(4),
      error_calibracion_pp: +((pm - re) * 100).toFixed(2),
    };
  }
  return out;
}

// Diferencia pareada contra T0 con bootstrap POR PARTIDO (`lib/inferencia.js`). Solo sobre los partidos en
// los que AMBOS tienen predicción: si T0 no pudo proyectar una liga por falta de histórico, ese partido no
// entra en la comparación, porque compararía un modelo con un hueco.
function contra(idA, idBase, campo = 'log') {
  const pares = registro.filter((r) => r.por[idA] && r.por[idBase])
    .map((r) => ({ valor: r.por[idA][campo] - r.por[idBase][campo], racimo: r.clave }));
  if (pares.length < 30) return null;
  const ic = INF.bootstrapClusters(pares, { valor: (x) => x.valor, cluster: (x) => x.racimo, replicas: 2000, semilla: 20260915 });
  return { n: pares.length, n_racimos: ic.n_clusters, delta: ic.media, ic: ic.ic, ee: ic.se, t: ic.t,
    p: ic.t != null ? INF.pDeT(ic.t, Math.max(1, ic.n_clusters - 1)) : null };
}

// ── VALIDACIÓN HACIA ADELANTE ─────────────────────────────────────────────────────────────────────────
function main() {
  const filas = carga();
  eloEnElMomento(filas);
  const t0 = filas[0].t, tN = filas[filas.length - 1].t;
  console.log(`Partidos: ${filas.length}  ligas: ${new Set(filas.map((f) => f.liga)).size}  ` +
    `de ${new Date(t0).toISOString().slice(0, 10)} a ${new Date(tN).toISOString().slice(0, 10)}`);
  console.log(`Tarjetas por partido: media ${C.momentos(filas.map((f) => f.y)).media.toFixed(3)}  ` +
    `varianza ${C.momentos(filas.map((f) => f.y)).varianza.toFixed(3)}\n`);

  // Bloques mensuales sobre la segunda mitad del histórico: el primer bloque necesita entrenamiento detrás.
  const inicioEval = t0 + (tN - t0) * 0.45;
  const bloques = [];
  for (let b = inicioEval; b < tN; b += 30 * DIA) {
    const hasta = b + 30 * DIA;
    const ev = filas.filter((f) => f.t >= b && f.t < hasta);
    if (ev.length >= 40) bloques.push({ desde: b, hasta, ev });
  }
  console.log(`Bloques de evaluación: ${bloques.length} (mensuales, ${bloques.reduce((s, b) => s + b.ev.length, 0)} partidos)\n`);

  const ASPIRANTES = [
    { id: 'T0', nombre: 'actual (prop-engine, nivel de liga)', t0: true },
    { id: 'T1', nombre: 'nivel liga×temporada dinámico', usaEquipos: false, usaArbitro: false },
    { id: 'T2a', nombre: 'T1 + fuerzas de equipo', usaEquipos: true, usaArbitro: false },
    { id: 'T2b', nombre: 'T2a + árbitro residual', usaEquipos: true, usaArbitro: true },
  ];
  const hpPorBloque = [];
  const ids = ['T0|nb'];

  for (let i = 0; i < bloques.length; i++) {
    const B = bloques[i];
    const entreno = filas.filter((f) => f.t < B.desde);
    if (entreno.length < 300) continue;
    process.stdout.write(`  bloque ${i + 1}/${bloques.length} (${new Date(B.desde).toISOString().slice(0, 10)}, ${B.ev.length} partidos, entreno ${entreno.length})…`);
    const t1 = Date.now();

    const pr0 = t0Predice(entreno, B.ev);
    for (let j = 0; j < B.ev.length; j++) if (pr0[j]) anota('T0|nb', pr0[j].pmf, B.ev[j]);

    const hpBloque = { bloque: new Date(B.desde).toISOString().slice(0, 10) };
    for (const A of ASPIRANTES) {
      if (A.t0) continue;
      const opciones = { usaEquipos: A.usaEquipos, usaArbitro: A.usaArbitro };
      const hp = elige(entreno, opciones);
      hpBloque[A.id] = hp;
      const M = construye(entreno, B.desde, hp, opciones);
      for (const f of B.ev) {
        const mu = M.mu(f); if (!(mu > 0)) continue;
        const va = M.varianza(f), ms = M.muestras(f);
        for (const ley of LEYES()) {
          const id = A.id + '|' + ley;
          if (!ids.includes(id)) ids.push(id);
          anota(id, aplicaLey(ley, mu, va, ms), f);
        }
      }
    }
    hpPorBloque.push(hpBloque);
    console.log(` ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }

  // ── INFORME ─────────────────────────────────────────────────────────────────────────────────────────
  const resultados = {};
  for (const id of ids) resultados[id] = agrega(id);
  const tabla = ids.map((id) => ({ id, ...(resultados[id] || {}) })).filter((r) => r.n).sort((a, b) => a.log_score - b.log_score);

  console.log('\n══ LOG-SCORE Y CRPS (menor es mejor) ══');
  console.log('aspirante|ley           n     log-score   CRPS');
  for (const r of tabla) console.log(`${r.id.padEnd(20)} ${String(r.n).padStart(6)}   ${r.log_score.toFixed(5)}   ${r.crps.toFixed(5)}`);

  console.log('\n══ CALIBRACIÓN EN LAS LÍNEAS QUE SE OFRECEN (under) ══');
  console.log('aspirante|ley          línea    n   P(under) modelo   real    error pp   Brier');
  for (const r of tabla) for (const l of LINEAS) {
    const L = r.lineas[l]; if (!L) continue;
    console.log(`${r.id.padEnd(20)} ${String(l).padStart(5)} ${String(L.n).padStart(6)}        ${L.p_under_media.toFixed(4)}   ${L.under_real.toFixed(4)}    ${String(L.error_calibracion_pp).padStart(7)}   ${L.brier.toFixed(5)}`);
  }

  // Comparación pareada contra T0 y contra T2a, con bootstrap por partido y corrección BH: se están
  // haciendo una docena de comparaciones a la vez y sin corregir el umbral una saldría "buena" por azar.
  const comparaciones = {};
  console.log('\n══ CONTRA T0 (Δ log-score pareado; negativo = el aspirante gana) ══');
  console.log('aspirante|ley            n     Δlog        IC 95%                 t        p');
  const ps = [];
  for (const r of tabla) {
    if (r.id === 'T0|nb') continue;
    const c = contra(r.id, 'T0|nb'); if (!c) continue;
    comparaciones[r.id] = c;
    ps.push({ id: r.id, p: c.p });
    console.log(`${r.id.padEnd(20)} ${String(c.n).padStart(6)}  ${(c.delta >= 0 ? '+' : '') + c.delta.toFixed(5)}  ` +
      `[${c.ic[0].toFixed(5)}, ${c.ic[1].toFixed(5)}]  ${c.t == null ? '   —' : c.t.toFixed(2).padStart(6)}  ${c.p == null ? '  —' : c.p.toFixed(4)}`);
  }
  // Benjamini–Hochberg controla cuántas de las diferencias DECLARADAS son ruido, y es ciego al signo: una
  // familia que pierde de forma contundente también "pasa". Por eso el resultado se parte en dos — las que
  // ganan a T0 y las que le pierden —, que es lo que de verdad se quiere leer. Sin partirlo, la línea dice
  // que el histograma "sobrevive" cuando lo que hace es perder con claridad.
  const conP = ps.filter((x) => x.p != null);
  if (conP.length) {
    const r = INF.bh(conP.map((x) => x.p), 0.10);
    const pasa = r.umbral == null ? [] : conP.filter((x) => x.p <= r.umbral);
    const dir = (id) => (comparaciones[id].delta < 0 ? 'gana' : 'pierde');
    console.log(`\n  Benjamini–Hochberg al 10 % sobre ${conP.length} comparaciones: umbral ${r.umbral == null ? 'ninguna pasa' : r.umbral.toFixed(5)}`);
    const ganan = pasa.filter((x) => dir(x.id) === 'gana').map((x) => x.id);
    const pierden = pasa.filter((x) => dir(x.id) === 'pierde').map((x) => x.id);
    console.log(`    GANAN a T0 con la corrección aplicada: ${ganan.length ? ganan.join(', ') : 'ninguna'}`);
    console.log(`    PIERDEN contra T0 con la corrección aplicada: ${pierden.length ? pierden.join(', ') : 'ninguna'}`);
    const nada = conP.filter((x) => r.umbral == null || x.p > r.umbral).map((x) => x.id);
    console.log(`    Empate (no se distingue de T0): ${nada.length ? nada.join(', ') : 'ninguna'}`);
  }

  // El aislamiento del árbitro: T2b contra T2a comparte TODO menos el multiplicador residual del árbitro.
  const arb = contra('T2b|nb', 'T2a|nb');
  if (arb) {
    comparaciones['T2b|nb vs T2a|nb'] = arb;
    console.log(`\n  El árbitro, aislado (T2b|nb − T2a|nb): Δlog ${(arb.delta >= 0 ? '+' : '') + arb.delta.toFixed(5)} ` +
      `IC [${arb.ic[0].toFixed(5)}, ${arb.ic[1].toFixed(5)}]  t ${arb.t == null ? '—' : arb.t.toFixed(2)}  p ${arb.p == null ? '—' : arb.p.toFixed(4)}`);
  }

  console.log('\n══ HIPERPARÁMETROS ELEGIDOS POR BLOQUE ══');
  for (const h of hpPorBloque) {
    const d = (id) => h[id] ? `${id}: vm=${h[id].vidaMedia} pr=${h[id].prior} damp=${h[id].damp} k=${h[id].k} par=${h[id].paridad ? 'sí' : 'no'}` : '';
    console.log(`  ${h.bloque}   ${d('T1')} | ${d('T2a')} | ${d('T2b')}`);
  }
  const damps = hpPorBloque.map((h) => h.T2a && h.T2a.damp).filter((x) => x != null);
  if (damps.length) {
    const cero = damps.filter((d) => d === 0).length;
    console.log(`\n  La amortiguación de las fuerzas de equipo salió 0 en ${cero}/${damps.length} bloques` +
      `${cero === damps.length ? ' — el entrenamiento apaga las fuerzas solo, igual que en el Mundial.' : '.'}`);
  }
  const pars = hpPorBloque.map((h) => h.T1 && h.T1.paridad).filter((x) => x != null);
  if (pars.length) console.log(`  La paridad se eligió en ${pars.filter(Boolean).length}/${pars.length} bloques.`);

  if (SALIDA) {
    fs.writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toISOString(), dir: DIR, n_filas: filas.length,
      bloques: bloques.length, resultados, comparaciones, hiperparametros: hpPorBloque }, null, 1));
    console.log(`\nEscrito ${SALIDA}`);
  }
}

if (require.main === module) main();
module.exports = { carga, construyeNivel, construyeFuerzas, construyeArbitros, construye, elige, LINEAS };
