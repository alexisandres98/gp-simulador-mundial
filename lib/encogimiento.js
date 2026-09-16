// lib/encogimiento.js — ENCOGER LA PROBABILIDAD DEL MODELO HACIA EL PRECIO (16-sep, M1)
//
// ── POR QUÉ EXISTE ─────────────────────────────────────────────────────────────────────────────────────
// `docs/CALIBRACION_2026-09-16.md` midió lo mismo en doce motores: **el modelo se pasa entre 6 y 16 puntos
// porcentuales donde el precio acierta a 0-4**, y eso pasa en nueve de los doce. cs2 +10,2 contra +0,2 ·
// lol +13,4 contra −0,4 · tenis +10,6 contra −1,7 · TT +15,8 contra +4,4 · dota2 +14,9 contra +4,3.
// Publicar `p_gp` crudo es publicar un número que ya sabemos que está mal, y las picks nacen de comparar
// ESE número con el precio: si el número se pasa 12 pp, la «ventaja» que ve el sistema es sobre todo su
// propio error de calibración. No es que las picks sean pocas o malas: es que la cantidad que decide si
// nacen está medida y sesgada, siempre en la misma dirección.
//
// La autopsia del 2-sep ya había escrito la fórmula operativa. Esto la implementa:
//
//      p* = σ( logit(p_mercado_sin_margen) + c · [ logit(p_gp) − logit(p_mercado_sin_margen) ] )
//
// `c` es cuánto peso merece el modelo POR ENCIMA del precio, y se ajusta **hacia adelante** familia por
// familia. c = 0 significa «publica el precio, el modelo no aporta»; c = 1, «publica el modelo». Entre
// medias, el modelo solo mueve la probabilidad en la proporción que se ha ganado fuera de muestra.
//
// ── LAS CUATRO DECISIONES QUE HACEN QUE ESTO NO SEA UN ADORNO ───────────────────────────────────────────
//
// 1. **`c` SE AJUSTA FUERA DE MUESTRA, O NO VALE.** Ajustar `c` sobre los mismos datos con los que se
//    juzga siempre da c > 0, porque el modelo tiene información aunque esté descalibrado. La única
//    pregunta útil es si mejora en datos que no vio. Por eso el ajuste es walk-forward: se ajusta con lo
//    de antes y se puntúa con lo de después, bloque a bloque.
//
// 2. **SUELO c ≥ 0.** Un `c` negativo diría «el modelo acierta al revés, invierte su señal». Aunque los
//    datos lo pidieran, eso es sobreajuste con casi total seguridad, y operarlo significaría apostar
//    CONTRA nuestro propio modelo. Se recorta a 0: en el peor caso publicamos el precio.
//    Techo c ≤ 1 por la razón simétrica: c > 1 es extrapolar la señal del modelo MÁS ALLÁ de sí misma.
//
// 3. **EL PRECIO ENTRA SIN MARGEN, Y SI NO SE PUEDE, SE DICE.** `1/cuota` NO es la probabilidad del
//    mercado: lleva dentro la mitad del sobre-redondeo de la casa. Encoger hacia `1/cuota` es encoger
//    hacia un número inflado, y en la dirección de parecer que hay ventaja. Con las dos caras el margen
//    se quita exacto (`lib/ev.js`); con una sola cara se usa el margen MEDIDO de esa casa y familia
//    (`lib/margen.js`, corregido hoy); sin ninguna de las dos cosas la fila **no entra al ajuste**. No se
//    supone un margen: ése es justo el fallo que costó cinco días de márgenes falsos.
//
// 4. **SI NO MEJORA FUERA DE MUESTRA, c = 0.** No «el mejor c de la rejilla aunque empeore». La rejilla
//    se recorre entera, pero si ningún c > 0 bate a c = 0 en log-loss fuera de muestra, el veredicto es
//    que el modelo no aporta nada por encima del precio, y eso se publica tal cual.
//
// ── LO QUE ESTE MÓDULO NO HACE ─────────────────────────────────────────────────────────────────────────
// No decide si una familia es invertible: eso es `lib/vara.js` y las puertas. No cambia por sí solo qué
// picks nacen — quien lo llame decide cuándo aplicarlo, y el plan manda una DOBLE CORRIDA de 14 días con
// las dos versiones conviviendo en sombra antes de que la encogida pase a publicar.
'use strict';

const MG = require('./margen');
const INF = require('./inferencia');

// La rejilla de `c`. 21 valores es fino de sobra: con las muestras que tenemos, la diferencia de log-loss
// entre c = 0,35 y c = 0,40 está muy por debajo del ruido, y una rejilla más densa solo invita a creerse
// un decimal que no existe.
const REJILLA = Array.from({ length: 21 }, (_, i) => +(i / 20).toFixed(2));
// Mínimo para ajustar: por debajo de esto el `c` es ruido y se publica el precio (c = 0) diciéndolo.
const N_MIN_AJUSTE = 60;
// Cuántos bloques hacia adelante. Con pocas filas, menos bloques y más largos.
const BLOQUES = 4;
// Recorte de las probabilidades para que `logit` no se vaya a infinito con un 0 o un 1.
const EPS = 1e-6;

const clamp01 = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p) => { const q = clamp01(p); return Math.log(q / (1 - q)); };
const sigmoide = (x) => 1 / (1 + Math.exp(-x));
const esCuota = (x) => Number.isFinite(x) && x > 1;
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r6 = (x) => (Number.isFinite(x) ? +x.toFixed(6) : null);

// ── LA FÓRMULA ──────────────────────────────────────────────────────────────────────────────────────────
// Devuelve null si falta cualquiera de los dos ingredientes: encoger hacia un precio que no tenemos no es
// encoger, es inventar.
function encoger(pGp, pMkt, c) {
  if (!Number.isFinite(pGp) || !Number.isFinite(pMkt) || !Number.isFinite(c)) return null;
  if (!(pMkt > 0 && pMkt < 1)) return null;
  const cc = Math.min(1, Math.max(0, c));
  const lm = logit(pMkt);
  return sigmoide(lm + cc * (logit(pGp) - lm));
}

// ── LA PROBABILIDAD DEL MERCADO, SIN MARGEN ─────────────────────────────────────────────────────────────
// Tres caminos, en orden de calidad, y el tercero es no dar ninguno.
//   `exacta`  — las dos caras de la misma casa y la misma captura: el margen se quita sin suponer nada.
//   `medida`  — una sola cara, pero el margen de esa casa y familia está MEDIDO sobre el archivo de
//               cierres. Se reparte por igual entre los dos lados, que es la convención de `lib/margen.js`.
//   `null`    — ni una cosa ni la otra. La fila no entra.
function pMercado(fila, { margenLadoPct = null } = {}) {
  const cara = Number(fila.odds_mkt != null ? fila.odds_mkt : fila.odds);
  const contra = Number(fila.odds_contraria);
  if (esCuota(cara) && esCuota(contra)) {
    const ia = 1 / cara, ib = 1 / contra;
    return { p: ia / (ia + ib), fuente: 'exacta', margen_lado_pct: r4(100 * ((ia + ib) - 1) / 2) };
  }
  if (!esCuota(cara)) return null;
  if (!Number.isFinite(margenLadoPct)) return null;              // sin margen medido NO se supone uno
  // Q = 1 + 2·margen_lado; la implícita cruda se divide por Q para quitarle su parte
  const Q = 1 + 2 * margenLadoPct / 100;
  if (!(Q > 0)) return null;
  return { p: (1 / cara) / Q, fuente: 'medida', margen_lado_pct: r4(margenLadoPct) };
}

// ── LOG-LOSS ────────────────────────────────────────────────────────────────────────────────────────────
// Regla de puntuación propia: el mínimo se alcanza diciendo la probabilidad verdadera, así que no se puede
// mejorar mintiendo. El acierto a secas sí se puede.
function logLoss(ps, ys) {
  let s = 0, n = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = clamp01(ps[i]), y = ys[i];
    if (!Number.isFinite(p) || (y !== 0 && y !== 1)) continue;
    s += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); n++;
  }
  return n ? s / n : null;
}

// ── PREPARAR LAS FILAS ──────────────────────────────────────────────────────────────────────────────────
// Una fila sirve si tiene: probabilidad del modelo, probabilidad del mercado sin margen, resultado binario
// y fecha. Lo que no sirve se cuenta por motivo — un descarte silencioso convierte una muestra sesgada en
// una muestra pequeña, que parece lo mismo y no lo es.
function preparar(filas, { margenLadoPct = null, pGp, pMkt: pMktFn, gano, fecha, evento } = {}) {
  const out = [], motivos = {}, sinPrecio = [];
  const no = (k) => { motivos[k] = (motivos[k] || 0) + 1; };
  for (const f of (filas || [])) {
    const g = pGp ? pGp(f) : f.p_gp;
    if (!Number.isFinite(g) || g <= 0 || g >= 1) { no('sin_p_modelo'); continue; }
    const y = gano ? gano(f) : (f.result === 'WIN' ? 1 : f.result === 'LOSS' ? 0 : null);
    if (y !== 0 && y !== 1) { no('sin_resultado_binario'); continue; }
    const m = pMktFn ? pMktFn(f) : pMercado(f, { margenLadoPct });
    const t = fecha ? fecha(f) : Date.parse(f.settled_at || f.at || 0);
    if (!m || !(m.p > 0 && m.p < 1)) {
      no('sin_precio_sin_margen');
      // se guarda para poder preguntarle al hueco si es inocente (ver `huecoDelPrecio`)
      sinPrecio.push({ g, y, ev: evento ? evento(f) : (f.event_id || null) });
      continue;
    }
    if (!Number.isFinite(t) || t <= 0) { no('sin_fecha'); continue; }
    out.push({ g, m: m.p, y, t, fuente: m.fuente, ev: evento ? evento(f) : (f.event_id || null) });
  }
  out.sort((a, b) => a.t - b.t);
  return { filas: out, motivos, sin_precio: sinPrecio };
}

// ── ¿EL HUECO DEL PRECIO ES INOCENTE? ───────────────────────────────────────────────────────────────────
// En los libros reales falta la cara contraria del cierre en una fracción que llega al 40 %. Lo que importa
// de un hueco no es su tamaño: es si está RELACIONADO CON EL RESULTADO. Si las filas sin precio son las de
// probabilidad alta —o las que se ganaron—, el `c` se está ajustando sobre un trozo que no representa a la
// familia, y el número saldría limpio y sería falso.
//
// Se comparan las dos mitades en dos cosas que sí tenemos en las dos: la probabilidad del propio modelo
// (que hace de PLACEBO: si difiere, el hueco toca algo relacionado con el resultado) y la tasa de acierto.
// Remuestreo por racimos de evento, porque dos líneas del mismo partido no son dos observaciones.
function huecoDelPrecio(conPrecio, sinPrecio, { replicas = 1000, semilla = 42, nMin = 30 } = {}) {
  const A = conPrecio || [], B = sinPrecio || [];
  const tasa = A.length + B.length ? B.length / (A.length + B.length) : 0;
  const base = { n_con_precio: A.length, n_sin_precio: B.length, tasa_hueco_pct: r4(100 * tasa) };
  if (!B.length) return { ...base, veredicto: 'sin_hueco', razon: 'todas las filas tienen precio sin margen.' };
  if (A.length < nMin || B.length < nMin) {
    return { ...base, veredicto: 'insuficiente',
      razon: `hacen falta ${nMin} filas a cada lado para contrastar; hay ${A.length} y ${B.length}.` };
  }
  const contraste = (valor, nombre) => {
    const a = INF.bootstrapClusters(A, { valor, cluster: (x) => x.ev, replicas, semilla });
    const b = INF.bootstrapClusters(B, { valor, cluster: (x) => x.ev, replicas, semilla: semilla + 1 });
    if (!a || !b || !Number.isFinite(a.media) || !Number.isFinite(b.media)) return null;
    const se = Math.sqrt((a.se || 0) ** 2 + (b.se || 0) ** 2);
    // guarda de varianza cero: un se ridículo convierte cualquier diferencia en un t enorme
    if (!(se > Math.max(Math.abs(a.media - b.media), 1e-12) * 1e-9)) return null;
    const t = (b.media - a.media) / se;
    const gl = Math.max(0, Math.min(a.n_clusters, b.n_clusters) - 1);
    return { que: nombre, con_precio: r4(a.media), sin_precio: r4(b.media), t: r4(t), p: INF.pDeT(t, gl) };
  };
  const cs = [contraste((x) => x.g, 'probabilidad del propio modelo (placebo)'),
    contraste((x) => x.y, 'tasa de acierto')].filter(Boolean);
  const ps = cs.map((c) => c.p).filter((p) => Number.isFinite(p));
  const rech = ps.length ? new Set(INF.bh(ps, 0.10).rechazadas) : new Set();
  cs.forEach((c, i) => { c.significativa_bh = rech.has(i); });
  const malo = cs.filter((c) => c.significativa_bh);
  return { ...base, contrastes: cs,
    veredicto: malo.length ? 'hueco_seleccionado' : 'hueco_ignorable_en_lo_observable',
    razon: malo.length
      ? `el hueco NO es inocente: ${malo.map((c) => `${c.que} difiere (${c.con_precio} → ${c.sin_precio}, t ${c.t})`).join('; ')}. El c está ajustado sobre un trozo que no representa a la familia.`
      : 'ni la probabilidad del modelo ni el acierto difieren entre las filas con precio y sin él. No es prueba de que el hueco sea inocente: es que en lo observable no se le ve sesgo.' };
}

// ── EL AJUSTE HACIA ADELANTE ────────────────────────────────────────────────────────────────────────────
// Se parte la serie ordenada por fecha en bloques. Para cada bloque k ≥ 1: se elige el `c` que minimiza el
// log-loss en TODO lo anterior, y con ese `c` se puntúa el bloque k. La suma de esas puntuaciones es el
// log-loss fuera de muestra, que es el único que dice algo.
//
// El `c` que se PUBLICA es el ajustado con la serie entera — es el que usará la próxima pick, que también
// es «el futuro». Pero el veredicto de si sirve sale del fuera de muestra, no de ese ajuste.
function ajustarC(filas, { bloques = BLOQUES, nMin = N_MIN_AJUSTE } = {}) {
  const n = filas.length;
  if (n < nMin) {
    return { c: 0, n, suficiente: false, veredicto: 'muestra_corta',
      razon: `${n} filas utilizables, hacen falta ${nMin}. Con menos, el c es ruido: se publica el precio (c = 0).` };
  }
  const mejorC = (sub) => {
    let best = null;
    for (const c of REJILLA) {
      const l = logLoss(sub.map((x) => encoger(x.g, x.m, c)), sub.map((x) => x.y));
      if (l == null) continue;
      if (best == null || l < best.l - 1e-12) best = { c, l };
    }
    return best;
  };
  // bloques de tamaño parejo; el primero es solo entrenamiento
  const k = Math.max(2, Math.min(bloques, Math.floor(n / Math.max(20, Math.floor(nMin / 3)))));
  const corte = (i) => Math.floor((n * i) / k);
  const fuera = { p: [], y: [], pBase: [], pModelo: [] };
  const porBloque = [];
  for (let i = 1; i < k; i++) {
    const tr = filas.slice(0, corte(i)), te = filas.slice(corte(i), corte(i + 1));
    if (tr.length < 20 || !te.length) continue;
    const b = mejorC(tr);
    if (!b) continue;
    const pe = te.map((x) => encoger(x.g, x.m, b.c));
    const ys = te.map((x) => x.y);
    porBloque.push({ bloque: i, c_entrenado: b.c, n_train: tr.length, n_test: te.length,
      logloss_test: r6(logLoss(pe, ys)),
      logloss_precio: r6(logLoss(te.map((x) => x.m), ys)),
      logloss_modelo: r6(logLoss(te.map((x) => x.g), ys)) });
    fuera.p.push(...pe); fuera.y.push(...ys);
    fuera.pBase.push(...te.map((x) => x.m)); fuera.pModelo.push(...te.map((x) => x.g));
  }
  if (!fuera.y.length) {
    return { c: 0, n, suficiente: false, veredicto: 'sin_ventanas',
      razon: 'no se pudo partir la serie en bloques con entrenamiento y prueba suficientes.' };
  }
  const llEnc = logLoss(fuera.p, fuera.y);
  const llPre = logLoss(fuera.pBase, fuera.y);
  const llMod = logLoss(fuera.pModelo, fuera.y);
  // EL VEREDICTO SALE DE AQUÍ: ¿el encogido bate al precio fuera de muestra?
  const mejora = (llPre != null && llEnc != null) ? llPre - llEnc : null;
  const final = mejorC(filas);
  // Si fuera de muestra no mejora, `c` se publica en 0 aunque el ajuste final pida otra cosa. Publicar un
  // c > 0 que no ha demostrado nada es exactamente lo que este módulo existe para no hacer.
  const sirve = Number.isFinite(mejora) && mejora > 0;
  const c = sirve ? final.c : 0;
  return {
    c, c_ajuste_completo: final ? final.c : null, n, suficiente: true,
    veredicto: sirve ? 'el_modelo_aporta' : 'el_modelo_no_aporta',
    razon: sirve
      ? `fuera de muestra el encogido con c = ${final.c} mejora el log-loss del precio en ${r6(mejora)} sobre ${fuera.y.length} filas.`
      : `fuera de muestra NINGÚN c > 0 bate al precio (mejora ${r6(mejora)} ≤ 0): el modelo no aporta por encima del precio y se publica el precio.`,
    fuera_de_muestra: { n: fuera.y.length, logloss_encogido: r6(llEnc), logloss_precio: r6(llPre),
      logloss_modelo_crudo: r6(llMod), mejora_sobre_precio: r6(mejora),
      // cuánto peor es el modelo crudo que el precio: es el número del diagnóstico del 16-sep, aquí medido
      // con la misma vara y sobre las mismas filas
      penalizacion_del_modelo_crudo: r6(llMod != null && llPre != null ? llMod - llPre : null) },
    por_bloque: porBloque,
  };
}

// ── INCERTIDUMBRE DE `c` ────────────────────────────────────────────────────────────────────────────────
// Un `c` sin intervalo invita a leer 0,35 y 0,15 como cosas distintas cuando pueden ser la misma. Se
// remuestrea POR EVENTO —dos líneas del mismo partido no son dos observaciones— y se reajusta en cada
// réplica. Es caro, así que se hace con menos réplicas que el resto y se dice.
function icDeC(filas, { replicas = 300, semilla = 42, alfa = 0.05 } = {}) {
  if (filas.length < N_MIN_AJUSTE) return null;
  const grupos = new Map();
  for (const f of filas) {
    const k = f.ev == null ? `__solo_${grupos.size}` : String(f.ev);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }
  const claves = [...grupos.keys()];
  const rnd = INF.generador(semilla);
  const cs = [];
  for (let r = 0; r < replicas; r++) {
    const muestra = [];
    for (let i = 0; i < claves.length; i++) muestra.push(...grupos.get(claves[Math.floor(rnd() * claves.length)]));
    muestra.sort((a, b) => a.t - b.t);
    let best = null;
    for (const c of REJILLA) {
      const l = logLoss(muestra.map((x) => encoger(x.g, x.m, c)), muestra.map((x) => x.y));
      if (l == null) continue;
      if (best == null || l < best.l - 1e-12) best = { c, l };
    }
    if (best) cs.push(best.c);
  }
  if (cs.length < 30) return null;
  cs.sort((a, b) => a - b);
  const q = (p) => cs[Math.min(cs.length - 1, Math.max(0, Math.round(p * (cs.length - 1))))];
  return { replicas: cs.length, racimos: claves.length, c_p50: q(0.5), ic: [q(alfa / 2), q(1 - alfa / 2)],
    cuota_c_cero: r4(cs.filter((x) => x === 0).length / cs.length),
    metodo: 'bootstrap por racimos de evento, reajustando c en cada réplica' };
}

// ── LA ENTRADA DE ALTO NIVEL ────────────────────────────────────────────────────────────────────────────
// Recibe el libro de una familia y devuelve todo lo que hace falta para publicar la probabilidad encogida
// y para justificarla. `margenLadoPct` sale de `lib/margen.js` para esa casa y familia.
function paraFamilia(filas, opciones = {}) {
  const prep = preparar(filas, opciones);
  const aj = ajustarC(prep.filas, opciones);
  const ic = aj.suficiente && aj.c > 0 ? icDeC(prep.filas, opciones) : null;
  const fuentes = {};
  for (const f of prep.filas) fuentes[f.fuente] = (fuentes[f.fuente] || 0) + 1;
  return { ...aj,
    n_entradas: (filas || []).length, n_utilizables: prep.filas.length,
    descartes: prep.motivos, precio_sin_margen: fuentes, ic_de_c: ic,
    // el hueco del precio, interrogado: un c ajustado sobre una mitad seleccionada sale limpio y es falso
    hueco_del_precio: huecoDelPrecio(prep.filas, prep.sin_precio, opciones),
    formula: 'p* = σ( logit(p_mkt sin margen) + c · [logit(p_gp) − logit(p_mkt sin margen)] )',
    no_decide_dinero: 'Esto ajusta la probabilidad que se publica. Si una familia es invertible lo dicen lib/vara.js y las puertas, y hoy ninguna lo es.' };
}

module.exports = { encoger, pMercado, logLoss, preparar, ajustarC, icDeC, paraFamilia, huecoDelPrecio,
  logit, sigmoide, REJILLA, N_MIN_AJUSTE };
