// lib/vara.js — LA VARA: CLV RECORTADO, POR SEMANA, NETO DE MARGEN, CON LÍNEA DE PARADA (11-sep)
//
// Por qué existe. El 11-sep el CLV crudo de CS2 en Pinnacle decía que el edge había muerto: de +2,82 % en
// agosto a +0,05 % las dos últimas semanas. Recortando el 10 % de cada cola la misma serie decía otra cosa:
// +2,04 → +1,80 → +0,68 → +0,55, con t entre 2,7 y 4,5 TODAS las semanas. La media cruda la destrozaban
// cuatro cierres disparatados (hay un CLV de +148 % en cloudbet, que es un cierre roto, no una ganancia).
// Las dos lecturas no se parecen y la decisión de meter dinero dependía de cuál mirabas.
//
// Tres piezas, y las tres hacen falta:
//   · RECORTE — la media recortada al 10 % tira las colas y deja de mentir. Aquí sube el t en vez de bajarlo,
//     que es la firma de que las colas eran ruido de captura y no señal.
//   · SEMANA — un promedio histórico esconde una caída. La serie semanal es la que dice si el edge vive HOY.
//   · NETO — el CLV se mide contra un cierre que lleva el margen dentro (ver `lib/margen.js`). Restarle el
//     margen por lado es lo único que convierte "le gano al cierre" en "gano dinero".
//
// El veredicto no es una opinión: es una regla escrita. Si el CLV neto recortado no es positivo y
// significativo, la familia no es invertible por mucho ROI que enseñe — el ROI es lo último en enterarse.
'use strict';

const M = require('./margen');

const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function sd(a) { if (a.length < 2) return null; const m = media(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
function tDe(a) { const m = media(a), s = sd(a); return (m != null && s) ? m / (s / Math.sqrt(a.length)) : null; }
function recorta(a, p) { const b = a.slice().sort((x, y) => x - y); const k = Math.floor(b.length * p); return k > 0 ? b.slice(k, b.length - k) : b; }
const r2 = (x) => (x == null ? null : +Number(x).toFixed(2));

// El resumen de una serie de CLV: crudo y recortado, con su t. Se dan los dos para que la diferencia entre
// ellos sea visible — cuando el recortado y el crudo se separan mucho, el archivo de cierres tiene basura.
function serie(valores, { recorte = 0.10 } = {}) {
  const a = (valores || []).filter((x) => Number.isFinite(x));
  if (!a.length) return { n: 0, media_pct: null, t: null, media_recortada_pct: null, t_recortada: null, mediana_pct: null };
  const t10 = recorta(a, recorte);
  return { n: a.length, media_pct: r2(media(a)), t: r2(tDe(a)),
    media_recortada_pct: r2(media(t10)), t_recortada: r2(tDe(t10)), n_recortada: t10.length,
    mediana_pct: r2(M.mediana(a)), recorte_pct: recorte * 100 };
}

function lunesDe(ms) { const d = new Date(ms); const l = new Date(d); l.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); l.setUTCHours(0, 0, 0, 0); return l.toISOString().slice(0, 10); }

// La serie por semana. `fecha` y `clv` son funciones para no atar el módulo a la forma de ninguna sombra.
function semanal(items, { fecha, clv, recorte = 0.10 } = {}) {
  const s = {};
  for (const it of items || []) {
    const v = clv(it); const f = fecha(it);
    if (!Number.isFinite(v) || !Number.isFinite(f) || f <= 0) continue;
    (s[lunesDe(f)] = s[lunesDe(f)] || []).push(v);
  }
  return Object.keys(s).sort().map((k) => ({ semana: k, ...serie(s[k], { recorte }) }));
}

// La rodante: la que contesta "¿sigue vivo?" sin esperar al lunes. Devuelve una ventana por paso para no
// escupir mil puntos, más la última ventana entera, que es la que manda.
function rodante(items, { fecha, clv, ventana = 100, pasos = 8, recorte = 0.10 } = {}) {
  const a = (items || []).map((it) => ({ f: fecha(it), v: clv(it) }))
    .filter((x) => Number.isFinite(x.v) && Number.isFinite(x.f) && x.f > 0)
    .sort((x, y) => x.f - y.f).map((x) => x.v);
  if (a.length < ventana) return { ventana, n: a.length, puntos: [], ultima: null, suficiente: false };
  const paso = Math.max(1, Math.floor((a.length - ventana) / Math.max(1, pasos - 1)) || 1);
  const puntos = [];
  for (let i = ventana; i <= a.length; i += paso) puntos.push(r2(media(recorta(a.slice(i - ventana, i), recorte))));
  const ult = recorta(a.slice(-ventana), recorte);
  return { ventana, n: a.length, puntos, ultima: r2(media(ult)), t_ultima: r2(tDe(ult)), suficiente: true };
}

// ══ EL VEREDICTO ═══════════════════════════════════════════════════════════════════════════════════════
// Escrito como regla, no como juicio, para que no dependa de quién lo lea ni de qué día sea. Los umbrales
// son los que acordamos el 11-sep: sin margen medido no se invierte (no se puede saber), y con margen medido
// hace falta CLV NETO positivo, significativo (t ≥ 2) y con muestra (n ≥ 100).
const MIN_N = 100, MIN_T = 2;
function veredicto({ clvRecortadoPct, tRecortada, n, margenLadoPct, nMargen }) {
  const neto = (clvRecortadoPct != null && margenLadoPct != null) ? +(clvRecortadoPct - margenLadoPct).toFixed(2) : null;
  const base = { clv_recortado_pct: r2(clvRecortadoPct), t_recortada: r2(tRecortada), n,
    margen_lado_pct: r2(margenLadoPct), n_margen: nMargen || 0, clv_neto_pct: neto };
  if (margenLadoPct == null) {
    return { ...base, veredicto: 'sin_margen_medido',
      razon: 'no hay las dos caras del mercado guardadas, así que no se puede saber cuánto cobra la casa. Sin eso el CLV no dice si hay dinero.' };
  }
  if (n < MIN_N) return { ...base, veredicto: 'muestra_corta', razon: `${n} cierres medidos, hacen falta ${MIN_N}.` };
  if (neto <= 0) {
    return { ...base, veredicto: 'no_invertible',
      razon: `le ganamos ${r2(clvRecortadoPct)} % al cierre pero la casa cobra ${r2(margenLadoPct)} % por lado: el neto es ${neto} %. Ganar al cierre no es ganar dinero.` };
  }
  if (tRecortada == null || tRecortada < MIN_T) {
    return { ...base, veredicto: 'en_observacion',
      razon: `el neto es +${neto} % pero con t ${r2(tRecortada)} no se distingue del ruido (hace falta ${MIN_T}).` };
  }
  return { ...base, veredicto: 'invertible',
    razon: `neto +${neto} % con t ${r2(tRecortada)} sobre ${n} cierres: le gana al cierre Y al margen.`,
    // el tamaño que sale de la propia ventaja, para que nadie tenga que calcularlo a ojo
    kelly_nota: 'el tamaño sale de la ventaja: ¼ Kelly sobre una ventaja del ' + neto + ' %. Ver `tamano()`.' };
}

// ¼ Kelly en dólares, para que la conversación sobre tamaño deje de ser una intuición. `ventajaPct` es el
// CLV neto (en % de cuota, que a estos tamaños aproxima bien la ventaja en probabilidad).
function tamano({ bankroll, ventajaPct, cuotaMedia = 2, fraccion = 0.25 }) {
  if (!(bankroll > 0) || !(cuotaMedia > 1) || ventajaPct == null || ventajaPct <= 0) return { stake_usd: 0, nota: 'sin ventaja neta positiva no hay tamaño que calcular' };
  const b = cuotaMedia - 1;
  const f = (ventajaPct / 100) / b;                 // Kelly completo con ventaja expresada sobre la cuota
  const stake = bankroll * f * fraccion;
  return { bankroll, ventaja_pct: r2(ventajaPct), cuota_media: cuotaMedia, kelly_pct: r2(100 * f),
    fraccion, stake_usd: +stake.toFixed(2),
    nota: `${(fraccion * 100).toFixed(0)} % de Kelly sobre una ventaja del ${r2(ventajaPct)} % a cuota ${cuotaMedia}` };
}

// El informe completo de UNA familia: serie, semanas, rodante y veredicto, en una sola llamada.
function familia(items, { fecha, clv, margenLadoPct = null, nMargen = 0, cuotaMedia = 2, bankroll = null, recorte = 0.10 } = {}) {
  const vals = (items || []).map(clv).filter((x) => Number.isFinite(x));
  const s = serie(vals, { recorte });
  const v = veredicto({ clvRecortadoPct: s.media_recortada_pct, tRecortada: s.t_recortada, n: s.n, margenLadoPct, nMargen });
  return { ...s, semanas: semanal(items, { fecha, clv, recorte }), rodante: rodante(items, { fecha, clv, recorte }),
    ...v, tamano: bankroll ? tamano({ bankroll, ventajaPct: v.clv_neto_pct, cuotaMedia }) : null };
}

module.exports = { serie, semanal, rodante, veredicto, tamano, familia, media, sd, tDe, recorta, MIN_N, MIN_T };
