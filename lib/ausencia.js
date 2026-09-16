// lib/ausencia.js — ¿LA AUSENCIA DE DATO SELECCIONA LA MUESTRA? (16-sep-2026)
//
// EL PROBLEMA QUE VIENE A RESOLVER, Y POR QUÉ NO SE RESUELVE CON UN UMBRAL.
// CS2 tiene 266 apuestas sin resultado localizable sobre 2.222 que deberían estar liquidadas: el 12,0 %.
// La puerta G0 pone el tope en el 5 %, así que CS2 no la pasa. Hasta aquí, todo correcto. El problema es
// que el tope, tal cual, es INAPELABLE: no existe ninguna acción que baje ese 12 % al 5 %.
//
//   · 167 de las 266 son partidos que bo3.gg marca `rejected` — no hay demo, o no la pudieron leer, y el
//     detalle POR MAPA no va a existir jamás. No es una cosecha incompleta: es una negativa del proveedor.
//   · 99 son partidos que la fuente nunca publicó, de torneos que no cubre (United21, Moscow Cyber Games).
//   · PandaScore, Liquipedia y OpenDota tampoco dan rondas por mapa de CS2 en plan libre — comprobado.
//
// O sea: mientras las familias de CS2 se liquiden por RONDAS DE UN MAPA, el ~10-12 % es el suelo físico de
// la fuente. Un tope del 5 % no es entonces un listón que se pueda cruzar trabajando: es un cierre. Y
// puede que cerrar sea la decisión correcta — pero hay que TOMARLA, no heredarla de un número redondo.
//
// LO QUE EL TOPE QUIERE PROTEGER, QUE NO ES LO MISMO QUE EL TOPE.
// El peligro real de un libro con huecos no es el tamaño del hueco: es que el hueco esté RELACIONADO CON EL
// RESULTADO. Si de cada cien apuestas desaparecieran justo las doce que perdieron, un ROI del +9 % sería
// pura ficción aunque el hueco fuera del 3 %. Y al revés: si las que faltan son indistinguibles de las que
// están, quitar el 12 % no sesga nada — encoge la muestra y ensancha el intervalo, que es un coste honesto
// y ya medido por el bootstrap.
//
// Eso SÍ se puede comprobar, y es lo que hace este módulo. No es una prueba de que la ausencia sea
// inocente —eso es indecidible sin ver el dato que falta—, es la prueba de que NO SE VE culpable en todo
// lo que sí se puede mirar. La diferencia importa y va escrita en el veredicto.
//
// LAS TRES COMPARACIONES, y las tres hacen falta:
//
//   1. COVARIABLES OBSERVABLES. Cuota, ventaja declarada, probabilidad del modelo, línea, hora. Se comparan
//      las liquidadas contra las ausentes con bootstrap POR RACIMOS DE EVENTO — los mapas de una misma
//      serie faltan juntos, así que contarlos como observaciones sueltas inflaría cualquier t.
//
//   2. EL PLACEBO QUE DE VERDAD PESA: `p_gp`. Es lo único correlacionado con el resultado que existe en las
//      dos mitades del libro. Si las ausentes tuvieran sistemáticamente más (o menos) probabilidad de ganar
//      según nuestro propio modelo, la ausencia estaría alineada con el resultado y el libro visible
//      estaría sesgado. Que este contraste salga plano es la evidencia más fuerte disponible.
//
//   3. LA COMPOSICIÓN. Familia, casa, competición. Aquí no se busca significación sino CONCENTRACIÓN: si
//      el 90 % de las ausencias sale de tres torneos, el libro visible no es el mismo producto que el libro
//      completo aunque cada covariable salga plana. Se mide con la cuota del torneo dominante y con la
//      distancia de variación total entre las dos composiciones.
//
// Y SOBRE TODO ELLO, BENJAMINI-HOCHBERG. Se contrastan seis o siete covariables a la vez; con ese número,
// una sale con p < 0,05 por puro mirar. Declarar "seleccionada" por ese hallazgo sería el mismo error que
// la auditoría señaló en las familias. El veredicto usa el umbral BH, no el 0,05 pelado.
//
// LO QUE ESTE MÓDULO NO HACE, Y ES DELIBERADO: NO ABRE NINGUNA PUERTA. No modifica `lib/puertas.js` ni
// relaja el tope del 5 %. Devuelve un veredicto y su evidencia para que la decisión —aceptar una familia
// con ausencia demostrablemente ignorable, o cerrarla— la tome Alexis con el número delante. Mover un
// listón del sistema es exactamente lo que la regla del dinero prohíbe hacer por iniciativa propia.
//
// Sin dependencias fuera de `lib/inferencia.js`. Aleatoriedad sembrada: el mismo libro da el mismo
// veredicto siempre.
'use strict';

const INF = require('./inferencia');

// El listón de concentración: por encima de esto, la composición del libro visible y la del libro completo
// son distintas aunque ninguna covariable mueva la aguja. 0,25 de distancia de variación total significa
// que una cuarta parte de la masa cambiaría de sitio al rellenar los huecos.
const LISTONES = {
  bh_q: 0.10,             // misma q que el resto del sistema
  tvd_max: 0.25,          // distancia de variación total entre composiciones
  cuota_torneo_max: 0.60, // qué parte de las ausencias puede salir de un solo torneo…
  exceso_min: 0.20,       // …Y cuánto más tiene que pesar ahí que entre las observadas para que signifique algo
  n_min_por_lado: 30,     // por debajo de esto no se contrasta nada: se declara insuficiente
};

// Covariables numéricas por defecto. Cada una con su nombre humano, porque el informe lo lee una persona.
const COVARIABLES = [
  { clave: 'odds', etiqueta: 'cuota de entrada', valor: (p) => Number(p.odds || p.best_odds) || null },
  { clave: 'p_gp', etiqueta: 'probabilidad del modelo (PLACEBO)', placebo: true,
    valor: (p) => (Number.isFinite(p.p_gp) ? p.p_gp : (Number.isFinite(p.model_prob) ? p.model_prob : null)) },
  { clave: 'edge_pp', etiqueta: 'ventaja declarada (pp)', valor: (p) => (Number.isFinite(p.edge_pp) ? p.edge_pp : null) },
  { clave: 'p_market', etiqueta: 'probabilidad implícita del precio', valor: (p) => (Number.isFinite(p.p_market) ? p.p_market : null) },
  { clave: 'stake_pct', etiqueta: 'tamaño propuesto (%)', valor: (p) => (Number.isFinite(p.stake_pct) ? p.stake_pct : null) },
  { clave: 'hora_utc', etiqueta: 'hora de inicio (UTC)',
    valor: (p) => { const d = Date.parse(p.start_at || 0); return Number.isFinite(d) ? new Date(d).getUTCHours() : null; } },
];

// Composiciones categóricas: aquí se mira concentración, no significación.
const COMPOSICIONES = [
  { clave: 'family', etiqueta: 'familia', valor: (p) => p.family || p.familia || '?' },
  { clave: 'book', etiqueta: 'casa', valor: (p) => p.book || p.casa || '?' },
  { clave: 'competition', etiqueta: 'competición', valor: (p) => p.competition || p.competicion || '?' },
];

const r = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);

// ── Distancia de variación total entre dos composiciones ────────────────────────────────────────────────
// ½·Σ|p_i − q_i|. Vale 0 si las dos mitades tienen la misma mezcla y 1 si no comparten ninguna categoría.
// Es la fracción de masa que habría que mover de una composición a la otra: se lee sin saber estadística.
function tvd(a, b) {
  const ca = cuenta(a), cb = cuenta(b);
  const na = suma(ca), nb = suma(cb);
  if (!na || !nb) return null;
  const claves = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  let d = 0;
  for (const k of claves) d += Math.abs((ca[k] || 0) / na - (cb[k] || 0) / nb);
  return d / 2;
}
const cuenta = (xs) => xs.reduce((m, x) => { const k = String(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const suma = (m) => Object.values(m).reduce((a, b) => a + b, 0);

// ── Contraste de dos medias con racimos ─────────────────────────────────────────────────────────────────
// No hay una función de dos muestras en `inferencia.js` y no hace falta: la diferencia de medias se obtiene
// remuestreando racimos de CADA lado por separado (los dos lados son disjuntos por construcción — una
// apuesta está liquidada o no lo está) y restando réplica a réplica. El error estándar de la diferencia es
// la desviación de esas restas, que es lo correcto justo porque los dos remuestreos son independientes.
function difMedias(obs, aus, valor, { replicas = 2000, semilla = 20260916, cluster } = {}) {
  const vo = obs.map(valor).filter(Number.isFinite);
  const va = aus.map(valor).filter(Number.isFinite);
  if (vo.length < 2 || va.length < 2) return { n_obs: vo.length, n_aus: va.length, dif: null, se: null, t: null, p: null };

  const bo = INF.bootstrapClusters(obs, { valor, cluster, replicas, semilla });
  const ba = INF.bootstrapClusters(aus, { valor, cluster, replicas, semilla: semilla + 1 });
  const mo = bo.media, ma = ba.media;
  if (!Number.isFinite(mo) || !Number.isFinite(ma)) return { n_obs: vo.length, n_aus: va.length, dif: null, se: null, t: null, p: null };

  const dif = ma - mo;                                   // ausentes menos observadas: signo legible
  const seo = Number.isFinite(bo.se) ? bo.se : 0;
  const sea = Number.isFinite(ba.se) ? ba.se : 0;
  const se = Math.sqrt(seo * seo + sea * sea);
  // la misma guarda relativa de `inferencia.js`: un error estándar de ruido numérico no es una certeza
  const escala = Math.max(Math.abs(dif), Math.abs(mo), 1e-12);
  const util = se > escala * 1e-9;
  const t = util ? dif / se : null;
  // GRADOS DE LIBERTAD: EL LADO PEQUEÑO MANDA (16-sep). `pDeT` los exige y aquí la unidad de información no
  // es el ticket sino el RACIMO — 266 apuestas ausentes son 62 series, no 266 observaciones. Se toma el
  // mínimo de los dos lados menos uno, que es la elección conservadora: con 62 racimos ausentes y 400
  // observados, el contraste no puede saber más de lo que sabe el lado corto.
  const gl = Math.max(0, Math.min(bo.n_clusters, ba.n_clusters) - 1);
  return {
    n_obs: vo.length, n_aus: va.length,
    media_obs: r(mo, 6), media_aus: r(ma, 6),
    dif: r(dif, 6), se: r(se, 6), t: r(t, 3), gl,
    p: t == null ? null : INF.pDeT(t, gl),
    racimos_obs: bo.n_clusters, racimos_aus: ba.n_clusters,
    ...(util ? {} : { aviso: 'sin variación entre racimos: el contraste no dice nada' }),
  };
}

// ── LA FUNCIÓN QUE IMPORTA ──────────────────────────────────────────────────────────────────────────────
// `libro` son TODAS las apuestas que deberían tener resultado: las liquidadas y las que se dieron por no
// resolubles. Las que siguen vivas (ACTIVE) no entran — todavía no falta su dato, solo no ha llegado.
function examina(libro, {
  observada,                    // (p) => bool · ¿tiene resultado?
  ausente,                      // (p) => bool · ¿se declaró sin resultado?
  evento,                       // (p) => clave de racimo
  motivo = (p) => p.unresolved_motivo || p.unsettleable_why || 'sin motivo declarado',
  covariables = COVARIABLES,
  composiciones = COMPOSICIONES,
  replicas = 2000, semilla = 20260916,
} = {}) {
  const todas = (libro || []).filter((p) => observada(p) || ausente(p));
  const obs = todas.filter(observada);
  const aus = todas.filter(ausente);
  const tasa = todas.length ? aus.length / todas.length : null;

  const base = {
    n_total: todas.length, n_observadas: obs.length, n_ausentes: aus.length,
    tasa_ausencia_pct: r(100 * tasa, 2),
    racimos_ausentes: new Set(aus.map(evento).map(String)).size,
    por_motivo: Object.entries(cuenta(aus.map(motivo))).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ motivo: k, n: v, pct: r(100 * v / (aus.length || 1), 1) })),
  };

  // "NINGUNA VENCIDA" NO ES "NINGUNA AUSENTE". Si el libro trae filas pero el accesor no reconoce ni una
  // como vencida, lo que falla es la lectura, no el libro — y decir "sin ausencias" ahí sería el mismo
  // error que este módulo persigue: un cero tranquilizador que en realidad significa "no miré".
  if (!todas.length) {
    return { ...base, veredicto: (libro || []).length ? 'libro_no_legible' : 'libro_vacio',
      razon: (libro || []).length
        ? `el libro trae ${(libro || []).length} apuestas pero ninguna se reconoce como vencida: `
          + 'el accesor no encaja con cómo este motor nombra el veredicto (¿`result` en vez de `result_code`?)'
        : 'el libro no trae ninguna apuesta',
      contrastes: [], composicion: [], concentracion: null };
  }
  if (!aus.length) {
    return { ...base, veredicto: 'sin_ausencias',
      razon: `las ${obs.length} apuestas vencidas tienen todas resultado`,
      contrastes: [], composicion: [], concentracion: null };
  }
  if (obs.length < LISTONES.n_min_por_lado || aus.length < LISTONES.n_min_por_lado) {
    return { ...base, veredicto: 'insuficiente',
      razon: `hacen falta ${LISTONES.n_min_por_lado} apuestas en cada lado para contrastar y hay ${obs.length} con resultado y ${aus.length} sin él`,
      contrastes: [], composicion: [], concentracion: null };
  }

  // 1 y 2 — las covariables, el placebo entre ellas
  const contrastes = [];
  for (const c of covariables) {
    const d = difMedias(obs, aus, c.valor, { replicas, semilla, cluster: evento });
    if (d.n_obs < LISTONES.n_min_por_lado || d.n_aus < LISTONES.n_min_por_lado) {
      contrastes.push({ ...c, valor: undefined, ...d, estado: 'sin_datos_suficientes' });
      continue;
    }
    contrastes.push({ clave: c.clave, etiqueta: c.etiqueta, placebo: !!c.placebo, ...d, estado: 'contrastada' });
  }

  // BH sobre los contrastes que sí dieron p. Se corrige por TODO lo que se miró, no por lo que salió mal.
  const conP = contrastes.filter((x) => Number.isFinite(x.p));
  const bh = conP.length ? INF.bh(conP.map((x) => x.p), LISTONES.bh_q) : null;
  // `bh.rechazadas` es una LISTA DE ÍNDICES, no un vector de booleanos: leerla como booleanos marcaría la
  // covariable nº 0 siempre que se rechazara cualquier otra. Se pasa por un Set.
  const rechazadas = new Set((bh && bh.rechazadas) || []);
  if (bh) conP.forEach((x, i) => {
    x.significativa_bh = rechazadas.has(i);
    x.umbral_bh = bh.umbral != null ? r(bh.umbral, 6) : null;
  });

  // 3 — la composición
  const composicion = composiciones.map((c) => {
    const vo = obs.map(c.valor), va = aus.map(c.valor);
    const d = tvd(vo, va);
    const ca = cuenta(va), co = cuenta(vo);
    const top = Object.entries(ca).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const cuotaAus = top[1] / aus.length;
    const cuotaObs = (co[top[0]] || 0) / (obs.length || 1);
    return { clave: c.clave, etiqueta: c.etiqueta, tvd: r(d, 4),
      dominante: top[0], dominante_n: top[1],
      dominante_cuota: r(cuotaAus, 4),
      // LA CUOTA SOLA NO DICE NADA, Y ESTO SALIÓ DE UN FALSO POSITIVO EN EL TEST (16-sep). En un libro de
      // una sola familia, el 100 % de las ausencias sale de esa familia por definición: informar de
      // "concentración del 100 %" ahí es ruido con pinta de hallazgo. Lo que importa es el EXCESO: cuánto
      // más pesa esa categoría entre lo que falta que entre lo que está. Si pesa igual, no hay
      // concentración aunque la cuota sea 1.
      dominante_cuota_observadas: r(cuotaObs, 4),
      dominante_exceso: r(cuotaAus - cuotaObs, 4),
      categorias_solo_en_ausentes: Object.keys(ca).filter((k) => !(k in co)).slice(0, 8) };
  });

  const peorTvd = composicion.reduce((m, x) => (Number.isFinite(x.tvd) && (!m || x.tvd > m.tvd) ? x : m), null);
  const peorCuota = composicion.reduce((m, x) => (Number.isFinite(x.dominante_exceso) && (!m || x.dominante_exceso > m.dominante_exceso) ? x : m), null);

  // ── EL VEREDICTO ──────────────────────────────────────────────────────────────────────────────────────
  // Tres motivos para declararla SELECCIONADA, y cualquiera basta:
  //   a) el placebo se mueve — lo más grave: la ausencia está alineada con el resultado esperado;
  //   b) alguna covariable se mueve pasando BH;
  //   c) la composición cambia demasiado, aunque cada covariable salga plana.
  const placebo = contrastes.find((x) => x.placebo && x.estado === 'contrastada');
  const placeboMueve = !!(placebo && placebo.significativa_bh);
  const covMueven = contrastes.filter((x) => x.significativa_bh && !x.placebo);
  const composicionCambia = !!(peorTvd && peorTvd.tvd > LISTONES.tvd_max);
  const concentrada = !!(peorCuota && peorCuota.dominante_cuota > LISTONES.cuota_torneo_max
    && peorCuota.dominante_exceso > LISTONES.exceso_min);

  let veredicto, razon;
  if (placeboMueve) {
    veredicto = 'seleccionada';
    razon = `LA MÁS GRAVE: la probabilidad del propio modelo difiere entre las que tienen resultado y las que no `
      + `(${r(100 * placebo.media_obs, 1)} % contra ${r(100 * placebo.media_aus, 1)} %, t ${placebo.t}). `
      + `La ausencia está alineada con el resultado esperado: el libro visible NO representa al completo.`;
  } else if (covMueven.length) {
    veredicto = 'seleccionada';
    razon = `${covMueven.length} covariable(s) difieren pasando Benjamini-Hochberg: `
      + covMueven.map((x) => `${x.etiqueta} (${x.media_obs} → ${x.media_aus}, t ${x.t})`).join('; ')
      + '. El placebo no se mueve, así que el sesgo puede no llegar al resultado, pero el libro visible es otro producto.';
  } else if (composicionCambia || concentrada) {
    veredicto = 'seleccionada_por_composicion';
    razon = (composicionCambia
      ? `la mezcla por ${peorTvd.etiqueta} cambia ${r(100 * peorTvd.tvd, 1)} % entre las dos mitades (tope ${100 * LISTONES.tvd_max} %)`
      : `el ${r(100 * peorCuota.dominante_cuota, 1)} % de las ausencias sale de una sola ${peorCuota.etiqueta} ("${peorCuota.dominante}"), `
        + `que entre las observadas solo pesa el ${r(100 * peorCuota.dominante_cuota_observadas, 1)} %`)
      + '. Ninguna covariable ni el placebo se mueven, así que la media visible probablemente no está sesgada, '
      + 'pero se está midiendo un subconjunto distinto del producto: la conclusión vale para ese subconjunto, no para la familia.';
  } else {
    veredicto = 'ignorable_en_lo_observable';
    razon = `Ni el placebo (${placebo ? 't ' + placebo.t : 'no contrastable'}) ni ninguna covariable difieren pasando BH, `
      + `y la composición se mantiene (peor distancia ${peorTvd ? r(100 * peorTvd.tvd, 1) + ' %' : '—'}). `
      + 'NO es prueba de que la ausencia sea inocente —eso exigiría ver el dato que falta— sino de que no se le ve '
      + 'ningún rastro en todo lo que sí se puede mirar. El coste de las ausencias queda entonces en muestra, '
      + 'no en sesgo: el intervalo se ensancha y el punto no se mueve.';
  }

  return {
    ...base,
    veredicto, razon,
    contrastes, composicion,
    concentracion: peorCuota ? { por: peorCuota.etiqueta, dominante: peorCuota.dominante, cuota: peorCuota.dominante_cuota } : null,
    umbral_bh: bh && bh.umbral != null ? r(bh.umbral, 6) : null,
    listones: LISTONES,
    // el aviso que no se debe borrar: esto NO abre la puerta G0
    no_abre_puerta: 'este veredicto es evidencia, no permiso: el tope del 5 % de G0 sigue mandando hasta que Alexis decida otra cosa',
  };
}

// Atajo para cualquiera de los libros de la casa.
//
// EL CERO QUE EN REALIDAD ERA "NO MIRÉ" (16-sep). La primera versión leía solo `result_code` y devolvía
// "0 sin resultado de 0" en tenis, tenis de mesa, dardos y NFL — cuatro motores con 1.400 apuestas
// liquidadas entre los cuatro. No estaban limpios: es que esos motores escriben el veredicto en `result` y
// no en `result_code`, así que el accesor no reconocía NINGUNA fila como vencida y el módulo informaba de
// un libro vacío. Un módulo que existe para detectar muestras seleccionadas no puede seleccionar la suya
// en silencio: ahora se leen los dos campos, y si un libro tiene picks pero ninguna se reconoce como
// vencida, se dice con esas palabras en vez de decir "sin ausencias".
const VEREDICTO = (p) => String(p.result_code || p.result || '').toUpperCase();

function examinaLibro(picks, opciones = {}) {
  return examina(picks, {
    observada: (p) => (p.status === 'SETTLED' || ['WIN', 'LOSS', 'VOID', 'PUSH'].includes(VEREDICTO(p)))
      && ['WIN', 'LOSS', 'VOID', 'PUSH'].includes(VEREDICTO(p)),
    ausente: (p) => VEREDICTO(p) === 'DATA_UNRESOLVED',
    evento: (p) => p.event_id || p.ceid || (p.event && (p.event.canonical_event_id || p.event.id)) || p.match || p.key || p.pick_id,
    ...opciones,
  });
}

module.exports = { examina, examinaLibro, difMedias, tvd, LISTONES, COVARIABLES, COMPOSICIONES };
