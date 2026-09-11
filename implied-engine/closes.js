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
const BUCKETS = [
  ['T60', 90, 45],
  ['T30', 45, 20],
  ['T10', 20, 7],
  ['T5', 7, 3],
  ['T1', 3, -2],
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

module.exports = { BUCKETS, KEYS, bucketFor, minutesToStart, record, clvPct, summarize, rescatar, salud };
