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

module.exports = { BUCKETS, KEYS, bucketFor, minutesToStart, record, clvPct, summarize };
