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
//
// ══ CORRECCIÓN DEL 15-SEP-2026 (auditoría externa, hallazgo A06) ═══════════════════════════════════════
// La tercera pieza de arriba —restar el margen por lado a la media del CLV— ESTABA MAL. No es un ajuste
// impreciso: son dos magnitudes en unidades distintas y su resta no es el retorno esperado de nada.
//
//     cierre 1,904762 / 1,904762 (Q = 1,05) · entrada aceptada a 1,97
//     CLV bruto +3,425 %  −  margen por lado 2,5 %  =  +0,925 %   → la regla vieja decía INVERTIBLE
//     probabilidad justa del cierre 0,50 → EV = 1,97 × 0,50 − 1  =  −1,50 %   → se pierde dinero
//
// Y el t se calculaba sobre el CLV bruto, no sobre la magnitud aprobada: un CLV de 3,01 % con coste 3 %
// puede tener un t enorme contra cero sin que el excedente de 0,01 % se distinga del ruido.
//
// Desde hoy manda `lib/ev.js`: el retorno esperado a la CUOTA ACEPTADA contra la probabilidad SIN MARGEN
// del cierre, calculado ticket a ticket y agregado después, con su propio t y con la incertidumbre por
// CLUSTERS de evento cuando el llamador dice cuál es el evento. El CLV recortado se conserva como
// diagnóstico de movimiento de línea. `cierreAporta()` deja de ser un interruptor y pasa a informar: que
// el cierre no prediga mejor que la entrada (|t| < 2) es ausencia de evidencia, no prueba de equivalencia.
// Y si no hay cierres con las dos caras ni Q medida, el veredicto es `sin_cierre_valorable`: no se sabe.
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

// ══ ¿SIRVE EL CLV EN ESTE MERCADO? (11-sep, objeción de Alexis) ════════════════════════════════════════
// El CLV vale como vara SOLO si el cierre es mejor estimador de la verdad que el precio que tomamos. Esa
// suposición es razonable en fútbol de primera división y es FALSA en un mercado que no se mueve: si la
// cuota de cierre es la misma con la que entramos —y lo es en el 78,8 % de los totales de tenis de mesa, el
// 60 % de los hándicaps de bovada y el 55 % de los kills— el CLV es cero por construcción y no mide nada.
// Peor: condenar una familia por tener CLV bajo cuando el cierre no sabe nada es condenarla por una prueba
// que no se le puede aplicar. Eso es exactamente lo que hacía la primera versión de este módulo.
//
// La prueba es directa: se compara el error (Brier) del precio de ENTRADA con el del CIERRE sobre las mismas
// apuestas liquidadas, pareado. Si el cierre no gana de forma significativa, no incorporó información entre
// nuestra apuesta y el saque, y el CLV de esa familia no es evidencia ni a favor ni en contra.
function cierreAporta(items, { odds, cierre, gano, overPct = 0 } = {}) {
  const dv = (o) => Math.min(0.999, Math.max(0.001, (1 / o) / (1 + overPct / 100)));
  const d = [];
  let quietas = 0, n = 0;
  for (const it of items || []) {
    const g = gano(it); if (g == null) continue;
    const oe = odds(it), oc = cierre(it);
    if (!(oe > 1) || !(oc > 1)) continue;
    n++; if (Math.abs(oe - oc) < 1e-9) quietas++;
    const y = g ? 1 : 0;
    d.push((dv(oe) - y) ** 2 - (dv(oc) - y) ** 2);   // > 0 ⇒ el cierre acertó más
  }
  if (d.length < 40) return { n: d.length, aporta: null, t: null, sin_mover_pct: null, lectura: 'muestra corta para saberlo' };
  const t = tDe(d);
  return { n: d.length, t: r2(t), sin_mover_pct: r2(100 * quietas / n), aporta: Math.abs(t) >= MIN_T && t > 0,
    lectura: Math.abs(t) < MIN_T
      ? `el cierre NO predice mejor que nuestra entrada (t ${r2(t)}): el CLV no mide nada en esta familia`
      : (t > 0 ? `el cierre predice mejor (t ${r2(t)}): el CLV vale como vara` : `nuestra entrada predice MEJOR que el cierre (t ${r2(t)}): el mercado se mueve en contra de la verdad`) };
}

// LA VARA DE REPUESTO, para cuando el CLV no aplica: ¿la probabilidad del modelo acierta más que la del
// precio? Mismo test pareado, sobre las mismas liquidadas. Aquí NO hay que restar margen: el ROI y el acierto
// ya están medidos contra lo que de verdad pasó y contra las cuotas que de verdad nos pagaron.
function modeloContraPrecio(items, { odds, pModelo, gano } = {}) {
  const d = [], u = [];
  for (const it of items || []) {
    const g = gano(it); if (g == null) continue;
    const o = odds(it), pm = pModelo(it);
    if (!(o > 1) || !(pm > 0 && pm < 1)) continue;
    const y = g ? 1 : 0;
    d.push((1 / o - y) ** 2 - (pm - y) ** 2);        // > 0 ⇒ el modelo acertó más que el precio
    u.push(y ? o - 1 : -1);
  }
  if (d.length < 40) return { n: d.length, t: null, roi_pct: null, t_roi: null, lectura: 'muestra corta' };
  const t = tDe(d), tr = tDe(u);
  return { n: d.length, t: r2(t), roi_pct: r2(100 * media(u)), t_roi: r2(tr),
    lectura: t >= MIN_T ? `el modelo acierta más que el precio (t ${r2(t)})`
      : (t <= -MIN_T ? `el PRECIO acierta más que el modelo (t ${r2(t)}): esta familia hay que cerrarla`
        : `modelo y precio empatan (t ${r2(t)}): no hay evidencia de ventaja`) };
}

// ══ EL VEREDICTO ═══════════════════════════════════════════════════════════════════════════════════════
// Escrito como regla, no como juicio, para que no dependa de quién lo lea ni de qué día sea. Los umbrales
// son los que acordamos el 11-sep: sin margen medido no se invierte (no se puede saber), y con margen medido
// hace falta CLV NETO positivo, significativo (t ≥ 2) y con muestra (n ≥ 100).
const MIN_N = 100, MIN_T = 2;
// ── LA CORRECCIÓN DEL 15-SEP (auditoría externa, hallazgo A06) ──────────────────────────────────────────
// Hasta hoy el veredicto restaba el margen por lado a la media del CLV y llamaba "neto" al resultado. Son
// unidades distintas y la resta no es el retorno esperado de nada: con cierre 1,905/1,905 (Q = 1,05) y
// entrada a 1,97, el CLV es +3,425 %, la resta daba +0,925 % y el retorno esperado real es −1,50 %. Una
// familia con esperanza negativa salía APROBADA. Además el t se calculaba sobre el CLV bruto, no sobre la
// magnitud que se estaba aprobando: un CLV de 3,01 % con coste 3 % puede tener un t enorme contra cero sin
// que el excedente de 0,01 % sea distinguible del ruido.
// Ahora manda `ev` —el retorno esperado a la cuota aceptada contra la probabilidad SIN MARGEN del cierre,
// calculado ticket a ticket y agregado después— con su propio t. El CLV se conserva como diagnóstico de
// movimiento de línea, nunca como veredicto. `clv_neto_pct` sigue publicándose SOLO para poder comparar con
// el histórico, marcado como obsoleto.
function veredicto({ clvRecortadoPct, tRecortada, n, margenLadoPct, nMargen, cierre, directo, ev = null }) {
  const neto = (clvRecortadoPct != null && margenLadoPct != null) ? +(clvRecortadoPct - margenLadoPct).toFixed(2) : null;
  const base = { clv_recortado_pct: r2(clvRecortadoPct), t_recortada: r2(tRecortada), n,
    margen_lado_pct: r2(margenLadoPct), n_margen: nMargen || 0,
    clv_neto_pct_OBSOLETO: neto,
    clv_neto_nota: 'CLV menos margen NO es el retorno esperado; se conserva solo para comparar con el histórico anterior al 15-sep',
    ev: ev || null, cierre_aporta: cierre || null, modelo_vs_precio: directo || null };
  // ── EL CAMINO NUEVO: el retorno esperado al cierre ────────────────────────────────────────────────────
  if (ev && ev.n != null && ev.ev_medio_pct != null) {
    const razonEv = `EV ${ev.ev_medio_pct > 0 ? '+' : ''}${ev.ev_medio_pct} % a la cuota aceptada contra la probabilidad sin margen del cierre, t ${ev.t} sobre ${ev.n_clusters != null ? `${ev.n_clusters} eventos (${ev.n} tickets)` : `${ev.n} tickets`}${ev.aproximado ? ` · ${ev.aproximado}` : ''}`;
    if (ev.n < MIN_N) return { ...base, veredicto: 'muestra_corta', razon: `${razonEv}. Hacen falta ${MIN_N} tickets con cierre valorable.` };
    if (ev.t != null && ev.t <= -MIN_T && ev.ev_medio_pct < 0) {
      return { ...base, veredicto: 'cerrar', razon: `${razonEv}. El precio le gana al modelo de forma significativa.` };
    }
    if (ev.ev_medio_pct <= 0) return { ...base, veredicto: 'no_invertible', razon: `${razonEv}. Ganarle al cierre no basta si la casa cobra más que la ventaja.` };
    if (ev.t == null || ev.t < MIN_T) return { ...base, veredicto: 'en_observacion', razon: `${razonEv}. Positivo, pero no se distingue del ruido (hace falta t ${MIN_T}).` };
    return { ...base, veredicto: 'invertible', razon: `${razonEv}.`, ventaja_para_kelly_pct: ev.ev_medio_pct,
      kelly_nota: `el tamaño sale del EV, no del CLV: ¼ Kelly sobre ${ev.ev_medio_pct} %.` };
  }
  // Sin cierre valorable NO se cae al camino viejo: se dice que no se puede saber, y se mira la prueba
  // directa, que no necesita cierre porque compara modelo contra precio sobre resultados reales.
  if (ev && ev.n === 0) {
    if (directo && directo.t != null && directo.t <= -MIN_T) {
      return { ...base, veredicto: 'cerrar',
        razon: `no hay cierres con las dos caras para valorar el EV (${ev.descartados ? JSON.stringify(ev.descartados) : 'sin detalle'}), pero en la prueba directa ${directo.lectura}. ROI ${directo.roi_pct} % (t ${directo.t_roi}).` };
    }
    if (directo && directo.t >= MIN_T && directo.roi_pct > 0 && directo.t_roi >= MIN_T) {
      return { ...base, veredicto: 'invertible_por_acierto',
        razon: `no hay cierres con las dos caras para valorar el EV, pero la prueba directa sí concluye: ${directo.lectura} y el ROI es ${directo.roi_pct} % con t ${directo.t_roi}. El ROI ya viene neto de margen: nos pagaron esas cuotas de verdad.`,
        ventaja_para_kelly_pct: directo.roi_pct };
    }
    return { ...base, veredicto: 'sin_cierre_valorable',
      razon: 'el archivo de cierres no guarda las dos caras del mismo contrato en la misma casa, así que no se puede calcular el retorno esperado. Sin eso, de esta familia NO SABEMOS NADA: el CLV a secas no es evidencia.' };
  }
  // PRIMERO SE PREGUNTA SI LA VARA SIRVE. Si el cierre no predice mejor que nuestra entrada, el CLV de esta
  // familia no es evidencia de nada y juzgarla por él es un error de método: se pasa a la prueba directa.
  if (cierre && cierre.aporta === false) {
    if (!directo || directo.t == null) {
      return { ...base, veredicto: 'clv_no_aplica',
        razon: `${cierre.lectura}${cierre.sin_mover_pct != null ? ` (la línea no se mueve en el ${cierre.sin_mover_pct} % de las apuestas)` : ''}. Y no hay muestra para la prueba directa, así que de esta familia NO SABEMOS NADA todavía.` };
    }
    if (directo.t <= -MIN_T) {
      return { ...base, veredicto: 'cerrar',
        razon: `el CLV no aplica aquí, y en la prueba directa ${directo.lectura}. ROI ${directo.roi_pct} % (t ${directo.t_roi}).` };
    }
    if (directo.t >= MIN_T && directo.roi_pct > 0 && directo.t_roi >= MIN_T) {
      return { ...base, veredicto: 'invertible_por_acierto',
        razon: `el CLV no aplica (${cierre.lectura}), pero la prueba directa sí: ${directo.lectura} y el ROI es ${directo.roi_pct} % con t ${directo.t_roi}. El ROI ya viene neto de margen — nos pagaron esas cuotas de verdad.`,
        // el tamaño sale del ROI observado, no del CLV, porque es el ROI lo que está medido
        ventaja_para_kelly_pct: directo.roi_pct };
    }
    return { ...base, veredicto: 'sin_evidencia',
      razon: `el CLV no aplica (${cierre.lectura}). En la prueba directa, ${directo.lectura}; ROI ${directo.roi_pct} % (t ${directo.t_roi}).` };
  }
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
  // NINGUNA FAMILIA SE APRUEBA POR ESTE CAMINO (15-sep). Llegar hasta aquí significa que el llamador no
  // aportó lo necesario para calcular el retorno esperado, y el cálculo viejo —CLV menos margen— ya está
  // medido como capaz de aprobar esperanzas negativas. Se devuelve lo que se sabe, sin veredicto de
  // inversión, y se dice qué falta para poder darlo.
  return { ...base, veredicto: 'falta_ev',
    razon: `el CLV recortado es ${r2(clvRecortadoPct)} % con t ${r2(tRecortada)} sobre ${n} cierres y la casa cobra ${r2(margenLadoPct)} % por lado, pero eso NO es un retorno esperado. Para juzgar esta familia hace falta el cierre valorado ticket a ticket (lib/ev.js): la cuota aceptada contra la probabilidad sin margen del cierre.`,
    falta: 'cierres con las dos caras del mismo contrato y la misma casa, o al menos la Q medida de esa casa y familia' };
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

// ── EL EV DE UNA FAMILIA ────────────────────────────────────────────────────────────────────────────────
// Dos caminos, en este orden de preferencia, y siempre declarando cuál se usó:
//   1. la cara contraria del cierre, del MISMO contrato y la MISMA casa → EV exacto por ticket;
//   2. la Q medida de esa casa y familia (`lib/margen.js`) → misma fórmula, Q mediana, aproximado.
// Si no hay ninguna de las dos, `n: 0`: no se inventa un margen ni se cae al CLV a secas.
function evDeFamilia(items, { odds, cierre, cierreContraria, margenLadoPct, evento, costes = 0 }) {
  let EV = null; try { EV = require('./ev'); } catch { return null; }
  if (!odds || !cierre || !Array.isArray(items) || !items.length) return { n: 0, descartados: { sin_entrada_o_cierre: (items || []).length } };
  const Q = EV.QDeMargenLado(margenLadoPct);
  const filas = [], descartados = { sin_cierre: 0, sin_contraria_ni_Q: 0, sin_entrada: 0 };
  let aproximados = 0;
  for (const x of items) {
    const entrada = odds(x), cie = cierre(x);
    if (!(entrada > 1)) { descartados.sin_entrada++; continue; }
    if (!(cie > 1)) { descartados.sin_cierre++; continue; }
    const contra = cierreContraria ? cierreContraria(x) : null;
    let r = null;
    if (contra > 1) r = EV.evDeTicket({ entrada, cierre: cie, cierreContraria: contra, costes });
    else if (Q > 0) { r = EV.evDesdeMargen({ entrada, cierre: cie, Q }); if (r.ok) { r.ev_pct = +(r.ev_pct - 100 * costes).toFixed(2); aproximados++; } }
    if (!r || !r.ok) { descartados.sin_contraria_ni_Q++; continue; }
    filas.push({ ev_pct: r.ev_pct, _evento: evento ? evento(x) : null });
  }
  const ag = EV.agrega(filas, { cluster: evento ? ((f) => f._evento) : null });
  return { ...ag, descartados: { ...descartados, ...(ag.descartados || {}) },
    aproximado: aproximados ? `${aproximados} de ${filas.length} valorados con la Q mediana de la familia, no con la cara contraria del propio partido` : null };
}

// El informe completo de UNA familia: serie, semanas, rodante y veredicto, en una sola llamada.
function familia(items, { fecha, clv, margenLadoPct = null, nMargen = 0, cuotaMedia = 2, bankroll = null, recorte = 0.10,
  odds = null, cierre = null, gano = null, pModelo = null, cierreContraria = null, evento = null, costes = 0 } = {}) {
  const vals = (items || []).map(clv).filter((x) => Number.isFinite(x));
  const s = serie(vals, { recorte });
  // las dos pruebas de método: ¿sirve el CLV aquí? y, si no, ¿acierta el modelo más que el precio?
  const ca = (odds && cierre && gano) ? cierreAporta(items, { odds, cierre, gano, overPct: margenLadoPct != null ? margenLadoPct * 2 : 0 }) : null;
  const mp = (odds && pModelo && gano) ? modeloContraPrecio(items, { odds, pModelo, gano }) : null;
  // EL RETORNO ESPERADO AL CIERRE, TICKET A TICKET (15-sep). Con la cara contraria se calcula exacto; sin
  // ella, con la Q medida de esa casa y familia, aproximado y declarado. Sin ninguna de las dos, `n: 0` y
  // el veredicto dice que de esta familia no se puede saber — que es la verdad y antes se ocultaba.
  const ev = evDeFamilia(items, { odds, cierre, cierreContraria, margenLadoPct, evento, costes });
  const v = veredicto({ clvRecortadoPct: s.media_recortada_pct, tRecortada: s.t_recortada, n: s.n, margenLadoPct, nMargen, cierre: ca, directo: mp, ev });
  const ventaja = v.ventaja_para_kelly_pct != null ? v.ventaja_para_kelly_pct : v.clv_neto_pct;
  if (bankroll) v.tamano = tamano({ bankroll, ventajaPct: ventaja, cuotaMedia });
  return { ...s, semanas: semanal(items, { fecha, clv, recorte }), rodante: rodante(items, { fecha, clv, recorte }),
    ...v };
}

module.exports = { serie, semanal, rodante, veredicto, tamano, familia, evDeFamilia, cierreAporta, modeloContraPrecio, media, sd, tDe, recorta, MIN_N, MIN_T };
