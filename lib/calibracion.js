// lib/calibracion.js — ¿LA PROBABILIDAD QUE DECIMOS ES LA QUE OCURRE? (16-sep-2026)
//
// DE DÓNDE SALE. A17 de la auditoría externa pedía revisar Valorant por miscalibración —«p ≥ 0,70 daba
// 74,5 % y ocurría 42,3 %»— y sugería que podía ser un problema de ORIENTACIÓN, o sea que estuviéramos
// liquidando el lado contrario. Medido sobre las 382 liquidadas, no lo es, y saberlo ahorra perseguir un
// fallo que no existe:
//
//     RONDAS_HANDICAP local     modelo 51,3 %  ocurre 32,6 %   se pasa +18,8 pp
//     RONDAS_HANDICAP visitante modelo 50,2 %  ocurre 36,6 %   se pasa +13,7 pp
//
// Un volteo de lado daría signos OPUESTOS en los dos lados: lo que uno se pasa, el otro se queda corto.
// Aquí los dos van en la misma dirección, y el cubo de p baja también (dice 39,1 % y ocurre 31,1 %). Eso no
// es orientación: es exceso de confianza.
//
// LA PIEZA QUE CONVIERTE ESTO EN UN DIAGNÓSTICO Y NO EN UNA QUEJA: **el precio como control**. Sobre esas
// MISMAS apuestas, la probabilidad implícita del mercado se desvía 2,2 pp donde el modelo se desvía 13,7.
// Con ese contraste la conclusión deja de ser "el modelo está mal calibrado" —que podría ser culpa de una
// muestra rara— y pasa a ser "el modelo está mal calibrado DONDE EL PRECIO NO LO ESTÁ", que ya señala al
// modelo. Y separa el caso importante: una familia donde LOS DOS se desvían igual no tiene un problema de
// modelo, tiene una muestra sesgada por cómo se eligen las picks.
//
// EL SESGO DE SELECCIÓN, QUE HAY QUE TENER PRESENTE AL LEER. Estas apuestas no son una muestra al azar de
// las predicciones: existen porque el modelo dijo más que el precio. Si el modelo tiene ruido, las picks
// con más ventaja declarada son aquellas donde el ruido salió más a favor, y regresan más. Por eso el sesgo
// crece con p —+18,8 pp en el cubo alto contra +7,9 en el bajo— y por eso la desviación medida aquí es un
// techo del error de calibración del modelo, no su medida limpia. Para la medida limpia haría falta el
// universo COMPLETO de predicciones, no solo las que pasaron el filtro. Va dicho en la salida.
//
// LO QUE ESTE MÓDULO NO HACE: no recalibra nada ni cambia ninguna probabilidad publicada. Cambiar cómo nace
// una pick es decisión de Alexis (regla del dinero, 13-sep). Esto mide y enseña.
//
// Sin dependencias fuera de `lib/inferencia.js`.
'use strict';

const INF = require('./inferencia');

// Cubos de probabilidad. Los extremos son anchos a propósito: con 382 apuestas, cortar fino arriba produce
// celdas de dos observaciones que solo dicen 0 % o 100 % y no significan nada.
const CUBOS = [[0, 0.40], [0.40, 0.50], [0.50, 0.55], [0.55, 0.60], [0.60, 0.65], [0.65, 0.70], [0.70, 0.80], [0.80, 1.0]];
const N_MIN_CUBO = 15;          // por debajo, el cubo se informa pero no entra al veredicto
const N_MIN_FAMILIA = 40;
const DESVIO_GRAVE_PP = 5;      // el suelo de ruido del método, de goal-engine/mitades.js (3,4 y 2,9 pp)

const r = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);
const pp = (x) => (Number.isFinite(x) ? +(100 * x).toFixed(1) : null);

// LOS TRECE MOTORES NOMBRAN LO MISMO DE SEIS MANERAS, y eso es historia, no diseño. Leer solo un nombre
// produce el peor resultado posible: un "no evaluable" tranquilizador en cuatro motores con 1.290 apuestas
// liquidadas entre ellos. Se leen todos los nombres conocidos, en orden de preferencia.
//   modelo: p_gp (esports, clubes) · p_model (tenis, TT, dardos, NFL) · model_prob (hoops) · model (mercados)
//   precio: p_market (esports) · p_implied (tenis, TT, dardos, NFL) · market_prob / market_fair_at_create (hoops) · fair
const num = (...xs) => { for (const x of xs) if (Number.isFinite(x)) return x; return null; };
const ACC = {
  gano: (p) => { const v = String(p.result_code || p.result || '').toUpperCase();
    return v === 'WIN' ? 1 : v === 'LOSS' ? 0 : null; },
  modelo: (p) => num(p.p_gp, p.p_model, p.model_prob, p.model),
  precio: (p) => num(p.p_market, p.p_implied, p.market_prob, p.market_fair_at_create, p.fair),
  familia: (p) => p.family || p.familia || '?',
  lado: (p) => p.side || p.lado || '?',
  evento: (p) => p.event_id || p.ceid || p.match || p.key || p.pick_id,
};

// Brier sobre las filas que tienen esa probabilidad. Devuelve null si no hay ninguna, nunca 0.
function brier(filas, prob, gano) {
  const s = filas.filter((x) => Number.isFinite(prob(x)) && gano(x) != null);
  return s.length ? s.reduce((a, x) => a + (prob(x) - gano(x)) ** 2, 0) / s.length : null;
}

// La desviación media con su incertidumbre POR RACIMOS DE EVENTO: dos mapas de la misma serie no son dos
// observaciones. Sin esto, cualquier t de una tabla de calibración de esports sale inflado.
function desvio(filas, prob, { gano = ACC.gano, evento = ACC.evento, replicas = 2000, semilla = 20260916 } = {}) {
  const s = filas.filter((x) => Number.isFinite(prob(x)) && gano(x) != null);
  if (s.length < 10) return { n: s.length, dif: null, t: null };
  const b = INF.bootstrapClusters(s, { valor: (x) => prob(x) - gano(x), cluster: evento, replicas, semilla });
  return { n: s.length, n_eventos: b.n_clusters, dif: r(b.media, 6), dif_pp: pp(b.media),
    se_pp: pp(b.se), ic_pp: [pp(b.ic[0]), pp(b.ic[1])], t: b.t };
}

// La tabla por cubos, que es como se lee de un vistazo.
function tabla(filas, prob, { gano = ACC.gano, cubos = CUBOS } = {}) {
  const out = [];
  for (const [lo, hi] of cubos) {
    const s = filas.filter((x) => { const p = prob(x); return Number.isFinite(p) && p >= lo && p < hi && gano(x) != null; });
    if (!s.length) continue;
    const dicho = s.reduce((a, x) => a + prob(x), 0) / s.length;
    const real = s.reduce((a, x) => a + gano(x), 0) / s.length;
    out.push({ desde: lo, hasta: hi, n: s.length, dice_pct: pp(dicho), ocurre_pct: pp(real),
      dif_pp: pp(dicho - real), se_pp: pp(Math.sqrt(real * (1 - real) / s.length)),
      suficiente: s.length >= N_MIN_CUBO });
  }
  return out;
}

// ── LA PRUEBA DE ORIENTACIÓN ────────────────────────────────────────────────────────────────────────────
// Un volteo de lado no produce "el modelo se pasa": produce que un lado se pase justo lo que el otro se
// queda corto. Si los dos lados de una familia se desvían en la MISMA dirección, la orientación no es el
// problema — y eso vale la pena poder afirmarlo, porque "arreglar" una orientación que está bien la rompe.
function pruebaDeOrientacion(filas, { modelo = ACC.modelo, gano = ACC.gano, familia = ACC.familia, lado = ACC.lado, evento = ACC.evento } = {}) {
  const porFam = {};
  for (const f of filas) { const k = familia(f); (porFam[k] = porFam[k] || []).push(f); }
  const out = [];
  for (const [fam, arr] of Object.entries(porFam)) {
    const porLado = {};
    for (const f of arr) { const k = lado(f); (porLado[k] = porLado[k] || []).push(f); }
    const lados = Object.entries(porLado).filter(([, a]) => a.length >= 20)
      .map(([k, a]) => ({ lado: k, ...desvio(a, modelo, { gano, evento }) }))
      .filter((x) => x.dif_pp != null);
    if (lados.length < 2) continue;
    // SIGNOS OPUESTOS NO BASTAN, Y ESTO SALIÓ DE UN FALSO POSITIVO (16-sep). La primera versión marcaba
    // "compatible con volteo" en cuanto dos lados tenían signo distinto, y así señaló el hándicap de
    // Valorant (−0,3 contra +3,6 pp) y el de baloncesto (−1,6 contra +7,7): diferencias que caben enteras
    // dentro del ruido. Perseguir un volteo que no existe es peor que no mirarlo — se acaba "arreglando"
    // una orientación que estaba bien.
    // La firma de un volteo de verdad es que los DOS lados se desvíen de forma GRANDE y en direcciones
    // contrarias: lo que uno se pasa, el otro se queda corto. Así que se exige, a cada lado, desviación
    // por encima del suelo de ruido del método Y un t que la distinga de cero.
    const fuertes = lados.filter((x) => Math.abs(x.dif_pp) > DESVIO_GRAVE_PP && Number.isFinite(x.t) && Math.abs(x.t) >= 2);
    const signos = new Set(fuertes.map((x) => Math.sign(x.dif_pp)));
    const opuestos = fuertes.length >= 2 && signos.size > 1;
    out.push({
      familia: fam, lados, lados_fuertes: fuertes.map((x) => x.lado),
      compatible_con_volteo: opuestos,
      lectura: opuestos
        ? `los lados se desvían FUERTE y en direcciones opuestas (${fuertes.map((x) => `${x.lado} ${x.dif_pp > 0 ? '+' : ''}${x.dif_pp} pp, t ${x.t}`).join('; ')}): `
          + 'es la firma de un volteo de orientación y hay que mirarlo.'
        : fuertes.length < 2
          ? `no hay dos lados con desviación por encima de ${DESVIO_GRAVE_PP} pp y t ≥ 2: `
            + `lo que se ve (${lados.map((x) => `${x.lado} ${x.dif_pp > 0 ? '+' : ''}${x.dif_pp} pp`).join(', ')}) cabe dentro del ruido y no dice nada sobre orientación.`
          : `los ${fuertes.length} lados con desviación fuerte van en la MISMA dirección (${fuertes.map((x) => `${x.lado} ${x.dif_pp > 0 ? '+' : ''}${x.dif_pp} pp`).join(', ')}): `
            + 'no es orientación. Un volteo haría que lo que un lado se pasa, el otro se quedara corto.',
    });
  }
  return out;
}

// ── LA FUNCIÓN QUE IMPORTA ──────────────────────────────────────────────────────────────────────────────
function examina(picks, opciones = {}) {
  const A = { ...ACC, ...opciones };
  const liq = (picks || []).filter((p) => A.gano(p) != null);
  if (!liq.length) return { n: 0, veredicto: 'sin_liquidadas' };

  const conAmbas = liq.filter((p) => Number.isFinite(A.modelo(p)) && Number.isFinite(A.precio(p)));
  const dModelo = desvio(liq, A.modelo, A);
  const dPrecio = conAmbas.length ? desvio(conAmbas, A.precio, A) : { n: 0, dif_pp: null, t: null };
  const dModeloMismas = conAmbas.length ? desvio(conAmbas, A.modelo, A) : dModelo;

  const porFamilia = {};
  const fams = {};
  for (const p of liq) { const k = A.familia(p); (fams[k] = fams[k] || []).push(p); }
  for (const [fam, arr] of Object.entries(fams)) {
    const amb = arr.filter((p) => Number.isFinite(A.modelo(p)) && Number.isFinite(A.precio(p)));
    const dm = desvio(arr, A.modelo, A);
    const dp = amb.length >= 20 ? desvio(amb, A.precio, A) : { n: amb.length, dif_pp: null, t: null };
    porFamilia[fam] = {
      n: arr.length, n_eventos: dm.n_eventos,
      modelo: dm, precio: dp,
      // el número que de verdad decide: cuánto se desvía el modelo MÁS que el precio en las mismas filas
      exceso_sobre_el_precio_pp: (dp.dif_pp != null && amb.length >= 20)
        ? +(Math.abs(desvio(amb, A.modelo, A).dif_pp) - Math.abs(dp.dif_pp)).toFixed(1) : null,
      brier_modelo: r(brier(amb.length ? amb : arr, A.modelo, A.gano), 5),
      brier_precio: amb.length ? r(brier(amb, A.precio, A.gano), 5) : null,
      tabla: tabla(arr, A.modelo, A),
      evaluable: arr.length >= N_MIN_FAMILIA,
    };
  }

  const orientacion = pruebaDeOrientacion(liq, A);
  const sospechosasDeVolteo = orientacion.filter((x) => x.compatible_con_volteo).map((x) => x.familia);

  // ── EL VEREDICTO ──────────────────────────────────────────────────────────────────────────────────────
  const peores = Object.entries(porFamilia)
    .filter(([, v]) => v.evaluable && v.exceso_sobre_el_precio_pp != null && v.exceso_sobre_el_precio_pp > DESVIO_GRAVE_PP)
    .sort((a, b) => b[1].exceso_sobre_el_precio_pp - a[1].exceso_sobre_el_precio_pp);

  let veredicto, razon;
  if (dModelo.dif_pp == null) { veredicto = 'no_evaluable'; razon = 'no hay suficientes liquidadas con probabilidad del modelo'; }
  else if (sospechosasDeVolteo.length) {
    veredicto = 'revisar_orientacion';
    razon = `en ${sospechosasDeVolteo.join(', ')} los lados se desvían en direcciones opuestas, que es la firma de un volteo de orientación.`;
  } else if (peores.length) {
    veredicto = 'modelo_descalibrado';
    razon = `${peores.length} familia(s) se desvían más que el precio en las MISMAS apuestas: `
      + peores.slice(0, 4).map(([f, v]) => `${f} (modelo ${v.modelo.dif_pp > 0 ? '+' : ''}${v.modelo.dif_pp} pp contra precio ${v.precio.dif_pp > 0 ? '+' : ''}${v.precio.dif_pp} pp)`).join('; ')
      + '. NO es orientación: los lados van en la misma dirección. Es exceso de confianza del modelo donde el precio acierta.';
  } else if (Math.abs(dModelo.dif_pp) > DESVIO_GRAVE_PP && dPrecio.dif_pp != null && Math.abs(dPrecio.dif_pp) > DESVIO_GRAVE_PP) {
    veredicto = 'muestra_sesgada';
    razon = `el modelo se desvía ${dModeloMismas.dif_pp} pp pero el precio también (${dPrecio.dif_pp} pp) en las mismas apuestas. `
      + 'Cuando los dos fallan igual, el problema no está en el modelo: está en cómo se eligen estas apuestas.';
  } else {
    veredicto = 'calibrado_dentro_del_ruido';
    razon = `la desviación media del modelo es ${dModelo.dif_pp} pp (t ${dModelo.t}), dentro del suelo de ruido de ${DESVIO_GRAVE_PP} pp del método.`;
  }

  return {
    n: liq.length, n_con_precio: conAmbas.length,
    veredicto, razon,
    modelo: dModelo, precio: dPrecio, modelo_en_las_mismas: dModeloMismas,
    brier_modelo: r(brier(conAmbas.length ? conAmbas : liq, A.modelo, A.gano), 5),
    brier_precio: conAmbas.length ? r(brier(conAmbas, A.precio, A.gano), 5) : null,
    tabla: tabla(liq, A.modelo, A),
    por_familia: porFamilia,
    orientacion,
    aviso_seleccion: 'Estas apuestas NO son una muestra al azar de las predicciones: existen porque el modelo '
      + 'dijo más que el precio. Con un modelo ruidoso, las de más ventaja declarada son donde el ruido salió '
      + 'más a favor, y regresan más — por eso la desviación crece con p. Lo de aquí es un TECHO del error de '
      + 'calibración, no su medida limpia; para eso haría falta el universo completo de predicciones.',
    no_recalibra: 'Este módulo mide. No cambia ninguna probabilidad publicada ni cómo nace una pick: eso lo decide Alexis.',
    listones: { n_min_cubo: N_MIN_CUBO, n_min_familia: N_MIN_FAMILIA, desvio_grave_pp: DESVIO_GRAVE_PP },
  };
}

module.exports = { examina, tabla, desvio, brier, pruebaDeOrientacion, CUBOS, ACC };
