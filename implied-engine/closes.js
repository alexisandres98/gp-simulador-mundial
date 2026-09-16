// implied-engine/closes.js — CIERRES POR CUBO Y CONTRA LA MISMA CASA, TRANSVERSAL (9-sep)
//
// De dónde viene. En tenis de mesa cada tesis guarda el precio en cinco momentos antes del saque (T−60, −30,
// −10, −5, −1 minutos) y en TRES referencias: la misma casa donde nació (`own`), la mejor del tablero (`best`) y
// Pinnacle (`pinnacle`). Con eso el CLV deja de ser un número y se vuelve una CURVA: dice cuándo existe el edge
// (en la apertura, a última hora, nunca) y si la casa que lo dio se mueve hacia nosotros. La autopsia del
// 2-sep dijo que donde ganamos "ganamos por precio y momento" (CS2 línea joven, cards under con cierre
// ineficiente) — eso solo se puede convertir en regla con la curva, no con un cierre único.
//
// Este módulo es PURO: no sabe de casas ni de deportes. Cada sombra le da sus tesis vivas y una función que
// devuelve el precio actual de (misma casa, mejor, pinnacle) para una tesis, y él decide en qué cubo va la
// lectura y la guarda una sola vez por cubo. La forma del registro es la de `tt-engine/store.js` para que el
// track de todos los deportes lea lo mismo.
'use strict';

// [clave, minutos_max, minutos_min] : la lectura entra en el primer cubo cuya ventana contiene los minutos
// que faltan para el inicio. Las ventanas son anchas a propósito: los barridos van cada 10-20 min y una lectura
// hecha a T−52 vale como T−60; lo que importa es que cada cubo tenga UNA lectura, la más tardía dentro de la
// ventana no hace falta porque la siguiente pasada cae en el cubo siguiente.
// EL SUELO DEL ÚLTIMO CUBO ES CERO, NO −2 (15-sep-2026, A11 de la auditoría externa). T1 aceptaba lecturas
// hasta DOS MINUTOS DESPUÉS del inicio, y un precio tomado con el partido rodando no es un cierre: es un
// precio en vivo. Con él, el CLV y el EV miden otra cosa —el mercado ya sabe cosas que nosotros no sabíamos
// al entrar— y encima hacia el lado que nos favorece, porque las líneas que se mueven rápido son justo las
// de los partidos que empiezan movidos. Cuesta cobertura (la ventana de T1 pasa de 5 a 3 minutos y con
// barridos de 10-20 min casi nunca cae ahí), y es el precio correcto: un cubo vacío se ve, uno contaminado no.
const BUCKETS = [
  ['T60', 90, 45],
  ['T30', 45, 20],
  ['T10', 20, 7],
  ['T5', 7, 3],
  ['T1', 3, 0],
];
const KEYS = BUCKETS.map((b) => b[0]);

function minutesToStart(startAt, now = Date.now()) {
  const s = typeof startAt === 'number' ? startAt : Date.parse(startAt || 0);
  if (!Number.isFinite(s)) return null;
  return (s - now) / 60000;
}

function bucketFor(startAt, now = Date.now()) {
  const m = minutesToStart(startAt, now);
  if (m == null) return null;
  for (const [k, hi, lo] of BUCKETS) if (m <= hi && m > lo) return k;
  return null;
}

// ══ EL INICIO REAL MANDA (15-sep-2026, A11) ═════════════════════════════════════════════════════════════
// "Prepartido" no es "antes de la hora del calendario": es antes de que la pelota (o el saque, o el primer
// dardo) eche a rodar. Los dos números se separan con facilidad —retrasos de televisión, un partido anterior
// que se alarga, un cambio de pista— y cuando se separan, todo lo capturado en medio se llamaba cierre
// siendo precio en vivo. Medido en el código antes de este cambio: fútbol admitía cotizaciones hasta
// KICKOFF+30 min como "cierre", esports hasta +15, y tenis/NFL/amfoot sobreescribían el cierre hasta +60.
//
// De dónde sale el inicio real: DEL MARCADOR, que es la única fuente que sabe si el partido empezó (ESPN en
// fútbol y baloncesto, WTT/Flashscore en tenis de mesa, Flashscore en dardos, la PDC en resultados). A veces
// llega como sello de tiempo (`started_at`) y a veces solo como estado ("live", "in", "Result"): las dos
// formas sirven, porque para excluir una lectura basta con saber que el partido YA había empezado cuando se
// tomó. Cuando el marcador no dice nada se usa el programado y **se marca** (`inicio_fuente: 'programado'`),
// que es distinto de saberlo: quien lea el track tiene que poder separar los dos casos.
const CAMPOS_PROGRAMADO = ['start_at', 'commence_time', 'commence', 'kickoff_at', 'kickoff', 'startAt', 'ko'];
const CAMPOS_REAL = ['started_at', 'actual_start_at', 'inicio_real', 'real_start_at', 'first_live_at', 'live_at'];
const ESTADO_EN_JUEGO = /^(live|in|in_play|inplay|post|final|finished|finish|result|running|progress|complete)/i;

const aMs = (x) => {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
};
const primerMs = (ev, campos) => { for (const c of campos) { const v = aMs(ev[c]); if (v != null) return v; } return null; };

// ¿el marcador dice que esto ya rueda AHORA? `live` puede venir como booleano o como el objeto del marcador
// (tenis de mesa y dardos lo traen así); `status`/`estado` cubren las fuentes que solo publican el estado.
function enJuegoAhora(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (ev.live === true || (ev.live && typeof ev.live === 'object')) return true;
  if (ev.completed === true || ev.in_play === true) return true;
  for (const c of ['status', 'estado', 'state', 'game_state']) if (ESTADO_EN_JUEGO.test(String(ev[c] || ''))) return true;
  return false;
}

// `ev` puede ser el evento entero, o directamente la hora programada (número o ISO) para los sitios que aún
// no tienen marcador. Devuelve SIEMPRE la fuente, porque un inicio supuesto y uno sabido no valen lo mismo.
function inicioDe(ev) {
  if (ev == null) return { ms: null, fuente: 'desconocido', en_juego: false, programado: null };
  if (typeof ev === 'number' || typeof ev === 'string') return { ms: aMs(ev), fuente: 'programado', en_juego: false, programado: aMs(ev) };
  const prog = primerMs(ev, CAMPOS_PROGRAMADO);
  const real = primerMs(ev, CAMPOS_REAL);
  const juego = enJuegoAhora(ev);
  if (real != null) return { ms: real, fuente: 'marcador', en_juego: juego, programado: prog };
  if (prog == null) return { ms: null, fuente: 'desconocido', en_juego: juego, programado: null };
  // sin sello real pero con el marcador diciendo que rueda: el inicio real es ≤ ahora, y eso ya basta
  return { ms: prog, fuente: juego ? 'marcador (estado, sin sello)' : 'programado', en_juego: juego, programado: prog };
}

// EL VEREDICTO DE UNA CAPTURA. `prepartido` es la única puerta que abren los motores: exige que el instante
// de captura sea ANTERIOR al inicio real cuando se conoce, y al programado cuando no, y en ese caso lo marca.
// Un evento sin ninguna hora no pasa (`sin_inicio`): no se puede afirmar que un precio sea prepartido si no
// se sabe cuándo empieza el partido.
function estadoCaptura(ev, now = Date.now()) {
  const ini = inicioDe(ev);
  const min = Number.isFinite(ini.ms) ? (ini.ms - now) / 60000 : null;
  const sinInicio = min == null;
  const inPlay = !sinInicio && (ini.en_juego || min <= 0);
  const prepartido = !sinInicio && !inPlay;
  return {
    inicio_ms: ini.ms, inicio_at: Number.isFinite(ini.ms) ? new Date(ini.ms).toISOString() : null,
    inicio_fuente: ini.fuente, inicio_conocido: ini.fuente === 'marcador' || ini.fuente === 'marcador (estado, sin sello)',
    en_juego: ini.en_juego, min_al_inicio: min == null ? null : Math.round(min * 10) / 10,
    in_play: inPlay, prepartido, sin_inicio: sinInicio,
    bucket: prepartido ? bucketFor(ini.ms, now) : null,
  };
}

// LA ETIQUETA QUE VIAJA EN EL ARCHIVO (15-sep). `estadoCaptura` devuelve un objeto con todo el detalle, pero
// lo que se guarda en cada cierre —y lo que después lee la vara— es UNA palabra de tres: `prepartido`,
// `in_play` o `desconocido`. Que sea la misma palabra en los ocho motores es el punto: si cada uno inventa
// su marca, los cierres vuelven a ser incomparables, que es justo lo que este cambio viene a arreglar.
function etiquetaCaptura(est) {
  if (!est) return 'desconocido';
  if (est.sin_inicio) return 'desconocido';
  return est.in_play ? 'in_play' : 'prepartido';
}

// EL CONTADOR, porque la cifra es un hallazgo en sí misma. Cada motor cuenta sus capturas con su nombre y
// `diagInPlay()` las publica; es por proceso (se reinicia con el deploy), así que el número duradero vive
// además en el propio almacén de cierres de cada motor (`in_play_visto`).
const _cuenta = {};
function cuenta(motor, est) {
  const c = _cuenta[motor] = _cuenta[motor] || { intentos: 0, prepartido: 0, in_play: 0, sin_inicio: 0, inicio_por_marcador: 0, inicio_por_programado: 0 };
  c.intentos++;
  if (est.sin_inicio) c.sin_inicio++;
  else if (est.in_play) c.in_play++;
  else c.prepartido++;
  if (est.inicio_conocido) c.inicio_por_marcador++; else if (!est.sin_inicio) c.inicio_por_programado++;
  return est;
}
function diagInPlay(motor) {
  if (motor) return _cuenta[motor] ? { ..._cuenta[motor] } : { intentos: 0, prepartido: 0, in_play: 0, sin_inicio: 0, inicio_por_marcador: 0, inicio_por_programado: 0 };
  return JSON.parse(JSON.stringify(_cuenta));
}

// ¿se puede VALORAR con esta lectura? Lo usan la liquidación y los resúmenes: una foto marcada `in_play`, o
// cuyo sello es posterior al inicio, no entra ni al CLV ni al EV. Se cuenta aparte, no se borra.
function cierreValorable(snap, inicioMs) {
  if (!snap) return false;
  if (snap.in_play === true) return false;
  const at = aMs(snap.at);
  if (at != null && Number.isFinite(inicioMs) && at >= inicioMs) return false;
  return true;
}

// rec: el registro de cierres de UNA tesis: { buckets: { T60: { at, own, best, pinnacle }, ... }, last: {...} }
// snap: { own, best, pinnacle } cuotas decimales (null si esa referencia no cotiza ahora).
// Devuelve el cubo escrito o null si el cubo ya tenía lectura o no hay cubo. `last` se refresca SIEMPRE:
// la última lectura antes del inicio sigue siendo el cierre clásico.
function record(rec, startAt, snap, now = Date.now()) {
  if (!rec) return null;
  rec.buckets = rec.buckets || {};
  const clean = { at: new Date(now).toISOString() };
  for (const k of ['own', 'best', 'pinnacle']) clean[k] = snap && snap[k] > 1 ? +Number(snap[k]).toFixed(3) : null;
  // edad de la cotización detrás de la lectura (minutos): un T−5 con precios de hace 15 min no es un T−5
  if (snap && Number.isFinite(snap.age_min)) clean.age_min = Math.round(snap.age_min);
  if (clean.own != null || clean.best != null || clean.pinnacle != null) rec.last = clean;
  const b = bucketFor(startAt, now);
  if (!b || rec.buckets[b]) return null;
  if (clean.own == null && clean.best == null && clean.pinnacle == null) return null;
  rec.buckets[b] = clean;
  return b;
}

// CLV en % de cuota: cuánto mejor (o peor) fue nuestro precio que el de referencia. +2 % = cerramos 2 % por
// encima del cierre. Es la vara de la casa, no el resultado.
function clvPct(entryOdds, closeOdds) {
  const e = Number(entryOdds), c = Number(closeOdds);
  if (!(e > 1) || !(c > 1)) return null;
  return +(100 * (e / c - 1)).toFixed(2);
}

// El resumen para el track: por cubo y referencia, media de CLV, n y % que batió al cierre.
// items: [{ odds, closes: rec }] — `odds` la cuota con la que nació la tesis.
function summarize(items) {
  const acc = {};
  for (const k of KEYS.concat(['last'])) acc[k] = { own: [], best: [], pinnacle: [] };
  for (const it of items || []) {
    const rec = it && it.closes; if (!rec) continue;
    const src = Object.assign({}, rec.buckets || {}, rec.last ? { last: rec.last } : {});
    for (const [k, snap] of Object.entries(src)) {
      if (!acc[k]) continue;
      for (const ref of ['own', 'best', 'pinnacle']) { const c = clvPct(it.odds, snap[ref]); if (c != null) acc[k][ref].push(c); }
    }
  }
  const out = {};
  for (const [k, refs] of Object.entries(acc)) {
    out[k] = {};
    for (const [ref, arr] of Object.entries(refs)) {
      out[k][ref] = arr.length ? { n: arr.length, avg_pct: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2), beat_pct: +(100 * arr.filter((x) => x > 0).length / arr.length).toFixed(1) } : { n: 0, avg_pct: null, beat_pct: null };
    }
  }
  return out;
}

// EL RESCATE DEL CLV (11-sep). Las sombras guardan DOS cosas en el archivo de cierres: los cubos, que se
// congelan, y `rows`, la última foto vista, que NO se congelaba y se seguía machacando hasta 60 min DESPUÉS
// del saque — es decir, con precios en vivo. La liquidación calculaba el CLV buscando la línea EXACTA de la
// tesis dentro de `rows`; en vivo esa línea ya no existe (un total de puntos se re-linea con cada punto), así
// que la familia entera se quedaba sin CLV. Se veía clarísimo en el reparto: las familias SIN línea sobrevivían
// (ML 16/35) y las que llevan línea se desplomaban (GAMES_HCP 0/26, POINTS_TOTAL 4/62) — con el precio ahí
// mismo, en el cubo congelado, para 23 y 40 de ellas.
//
// Este rescate lo reconstruye desde los cubos, que sí están bien: coge el más tardío con precio (T−1 primero,
// T−60 el último) y anota de qué cubo salió. Es retroactivo por construcción — `close_series` ya vive dentro
// de cada tesis — así que arregla el histórico sin re-liquidar nada ni tocar un solo resultado.
const RESCATE_ORD = ['T1', 'T5', 'T10', 'T30', 'T60'];
function rescatar(p) {
  const cs = p && p.close_series; if (!cs) return p;
  const busca = (ref) => { for (const k of RESCATE_ORD) { const b = cs[k]; if (b && Number(b[ref]) > 1) return { odds: +b[ref], bkt: k }; } return null; };
  const pon = (campoClv, campoCierre, ref) => {
    if (p[campoClv] != null) return null;
    const h = busca(ref); if (!h) return null;
    p[campoClv] = clvPct(p.odds, h.odds); p[campoCierre] = h.odds; return h.bkt;
  };
  const b1 = pon('clv_pct', 'close_price', 'best');
  const b2 = pon('clv_own_pct', 'close_own', 'own');
  const b3 = pon('clv_pin_pct', 'close_pin', 'pinnacle');
  const bkt = b1 || b2 || b3;
  if (bkt) { p.clv_rescatado = bkt; if (p.close_missing) p.close_missing = null; }
  return p;
}

// LA SALUD DEL REGISTRO DE CIERRES, para que la pantalla no presuma de una curva que no se puede leer.
// `cubos_en_bloque` cuenta las tesis con dos o más cubos escritos en la MISMA pasada: en ellas la curva no
// mide movimiento de precio, sino la misma foto repetida. Son las nacidas antes del arreglo del 11-sep.
function salud(items) {
  let n = 0, bloque = 0, rescatadas = 0, conClv = 0;
  for (const p of items || []) {
    n++;
    if (p.clv_pct != null) conClv++;
    if (p.clv_rescatado) rescatadas++;
    const cs = p.close_series || {};
    const ats = Object.values(cs).map((b) => b && b.at).filter(Boolean);
    if (ats.length > 1 && new Set(ats).size < ats.length) bloque++;
  }
  return { n, con_clv: conClv, rescatadas, cubos_en_bloque: bloque,
    lectura: bloque ? `${bloque} de ${n} tesis tienen cubos escritos en la misma pasada (antes del 11-sep): en esas la CURVA no se puede leer, el CLV sí.` : 'curva limpia: cada cubo, una lectura propia.' };
}


// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// LAS DOS CARAS DEL CIERRE (16-sep-2026)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
//
// EL PROBLEMA QUE RESUELVE. El replay del 15-sep (`docs/METRICAS_RECALCULADAS_2026-09.md` §5b) dejó a nueve
// motores de nueve con el veredicto «no se puede saber»: sin la cara CONTRARIA del cierre no se puede quitar
// el margen de la casa, y sin quitarlo no hay retorno esperado. Se anotó como la tarea que desbloquea todo
// lo demás.
//
// Y AL IR A ARREGLARLO RESULTÓ QUE EL DATO YA ESTABA. Los motores de esports, tenis de mesa y dardos guardan
// en su archivo de cierres las filas ENTERAS del mercado —las dos caras, por casa, de la misma pasada— y lo
// único que leían era el lado de la pick. No era un problema de captura: era un problema de lectura. Esto lo
// lee.
//
// POR QUÉ NO SIRVE CUALQUIER PAREJA. Para quitar el margen hacen falta las dos caras DEL MISMO CONTRATO, en
// la MISMA CASA y de la MISMA PASADA. Emparejar la mejor cuota de cada lado entre casas distintas da una Q
// menor que 1 —un arbitraje que no existió— y con ella el EV sale inflado hacia arriba, que es justo la
// dirección en la que este sistema ya se ha equivocado varias veces. Por eso se delega en `parContrario` de
// `lib/contrato.js`, que exige casa y momento, y por eso cuando no hay pareja legítima se devuelve el motivo
// en vez de una aproximación.
function carasDelCierre(objetivo, filas, { toleranciaMs = null } = {}) {
  const CT = require('../lib/contrato');
  if (!objetivo) return { propia: null, contraria: null, motivo: 'sin fila propia' };
  const opts = { detalle: true };
  if (toleranciaMs != null) opts.toleranciaMs = toleranciaMs;
  const r = CT.parContrario(objetivo, filas || [], opts);
  const contraria = r && r.fila ? r.fila : null;
  const cuotaDe = (f) => (f ? Number(f.cuota != null ? f.cuota : (f.odds != null ? f.odds : f.precio)) : null);
  const ca = cuotaDe(objetivo), cb = cuotaDe(contraria);
  const out = { propia: objetivo, contraria, cuota: ca, cuota_contraria: cb,
    casa: objetivo.book || objetivo.casa || null, motivo: contraria ? null : ((r && r.motivo) || 'sin cara contraria') };
  // ── LOS HÁNDICAPS Y LAS DOS CONVENCIONES DE SIGNO (16-sep) ──────────────────────────────────────────
  // `lib/contrato.js` normaliza asumiendo la convención estándar: la contraria de `home −2,5` es
  // `away +2,5`. Pero no todos los proveedores la siguen. Medido en el archivo de cierres de CS2, Bovada
  // publica las DOS caras con la MISMA línea —`home −2,5 @ 2,05` y `away −2,5 @ 1,741`— porque el signo lo
  // lleva implícito el lado. Esas dos filas SON la pareja buena: su Q es 1,062, o sea un margen del 3,1 %
  // por lado, que es exactamente el que tiene medido esa casa.
  //
  // Con la normalización estricta esa pareja no se encuentra, y en eventos con varias líneas el emparejado
  // acababa cogiendo otra fila y dando Q < 1. Así que para hándicaps se prueba también la otra convención,
  // y QUIEN DECIDE ES LA Q: un mercado de dos caras de una casa en un momento tiene siempre un margen
  // pequeño y positivo. Si ninguna candidata cae en ese rango, o si caen DOS, no se empareja y se dice —
  // preferimos un hueco declarado a un margen inventado, que es el error que infla el EV a nuestro favor.
  const esHandicap = /handicap|hcp|spread/i.test(String(objetivo.family || objetivo.familia || ''));
  if (!contraria && esHandicap) {
    const lado = String(objetivo.side != null ? objetivo.side : objetivo.lado).toLowerCase();
    const opuesto = { home: 'away', away: 'home', a: 'b', b: 'a', over: 'under', under: 'over' }[lado] || null;
    const casaObj = objetivo.book || objetivo.casa;
    const mismaLinea = (x, y) => Math.abs(Number(x) - Number(y)) < 0.01;
    const candidatas = (filas || []).filter((f) => f && f !== objetivo
      && String(f.side != null ? f.side : f.lado).toLowerCase() === opuesto
      && (f.book || f.casa) === casaObj
      && String(f.family || f.familia) === String(objetivo.family || objetivo.familia)
      && (f.map || null) === (objetivo.map || null)
      && (f.team || null) === (objetivo.team || null)
      && mismaLinea(f.line != null ? f.line : f.linea, objetivo.line != null ? objetivo.line : objetivo.linea));
    const plausibles = candidatas.filter((f) => {
      const c = Number(f.odds != null ? f.odds : (f.cuota != null ? f.cuota : f.precio));
      if (!(c > 1) || !(ca > 1)) return false;
      const Q = 1 / ca + 1 / c;
      return Q > 1.0005 && Q <= 1.15;      // los márgenes medidos de la casa van del 2,2 % al 3,5 % por lado
    });
    if (plausibles.length === 1) {
      out.contraria = plausibles[0];
      out.cuota_contraria = Number(plausibles[0].odds != null ? plausibles[0].odds : plausibles[0].cuota);
      out.convencion = 'misma_linea_los_dos_lados';
      out.motivo = null;
    } else if (plausibles.length > 1) {
      out.motivo = `${plausibles.length} candidatas a cara contraria con margen plausible: ambiguo, no se empareja`;
    }
  }
  const cb2 = out.cuota_contraria;
  if (ca > 1 && cb2 > 1 && out.contraria) { const cbX = cb2; const QX = 1 / ca + 1 / cbX;
    out.Q = +QX.toFixed(6); out.margen_lado_pct = +(100 * (QX - 1) / 2).toFixed(3);
    if (QX <= 1) { out.contraria = null; out.cuota_contraria = null; out.sospechosa = true;
      out.motivo = `Q = ${out.Q} ≤ 1: las dos caras no pueden ser del mismo mercado y el mismo momento en la misma casa`; }
    return out;
  }
  if (ca > 1 && cb > 1) {
    const Q = 1 / ca + 1 / cb;
    out.Q = +Q.toFixed(6);
    out.margen_lado_pct = +(100 * (Q - 1) / 2).toFixed(3);
    // UNA Q MENOR QUE 1 NO ES UNA GANGA, ES UN ERROR DE EMPAREJADO. Significa que las dos caras no son del
    // mismo mercado o no son del mismo momento; ninguna casa cotiza un arbitraje contra sí misma. Se rechaza
    // y se dice, porque tomarla por buena inflaría el EV de esa familia en la dirección que nos conviene.
    if (Q <= 1) { out.contraria = null; out.cuota_contraria = null; out.motivo = `Q = ${out.Q} ≤ 1: las dos caras no pueden ser del mismo mercado y el mismo momento en la misma casa`; out.sospechosa = true; }
  }
  return out;
}

module.exports = { BUCKETS, KEYS, bucketFor, minutesToStart, record, clvPct, summarize, rescatar, salud,
  // 15-sep (A11): el inicio REAL manda sobre el programado, y desde hoy está CONECTADO en los ocho sitios
  // que capturan cierres — fútbol derivadas, esports, tenis de mesa, dardos, baloncesto (las dos rutas del
  // server), NFL, amfoot y la sombra del proceso implícito. Cada uno marca su captura con `etiquetaCaptura`
  // (`prepartido` | `in_play` | `desconocido`) y cuenta con `cuenta()`; `lib/vara.js` excluye las `in_play`
  // del EV y las publica aparte en `cierres_in_play`. Se conectaron TODOS a la vez a propósito: hacerlo a
  // medias en unos motores y no en otros haría incomparables sus cierres.
  inicioDe, estadoCaptura, etiquetaCaptura, cuenta, diagInPlay, cierreValorable,
  // 16-sep: las dos caras del cierre, que en tres motores ya estaban guardadas y no se leían
  carasDelCierre };
