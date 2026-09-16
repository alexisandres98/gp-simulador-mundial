// tests/calibracion.test.js — LA PRUEBA DE ORIENTACIÓN NO PUEDE SER UN DETECTOR DE RUIDO (16-sep-2026)
//
// A17 de la auditoría pedía revisar Valorant por si el problema era un VOLTEO DE ORIENTACIÓN: liquidar el
// lado contrario. Este test fija las dos mitades de esa pregunta, y la segunda importa tanto como la
// primera:
//   · un volteo de verdad se detecta;
//   · una diferencia de tres puntos entre dos lados NO se llama volteo. La primera versión del módulo sí lo
//     hacía y señaló el hándicap de Valorant (−0,3 contra +3,6 pp) y el de baloncesto (−1,6 contra +7,7).
//     Perseguir un volteo que no existe acaba en "arreglar" una orientación que estaba bien, que es
//     exactamente el fallo que se quería evitar.
'use strict';
const CAL = require('../lib/calibracion');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// Un libro sintético: `p` es lo que dice el modelo, `real` lo que de verdad ocurre. Determinista.
function libro({ n = 200, familia = 'F', lados = { home: [0.60, 0.60], away: [0.60, 0.60] }, precio = null } = {}) {
  const out = [];
  let i = 0;
  for (const [lado, [pDicho, pReal]] of Object.entries(lados)) {
    for (let k = 0; k < n; k++, i++) {
      // jitter determinista para que haya varianza entre racimos (si no, el bootstrap devuelve t nulo)
      const j = ((i * 7919) % 41 - 20) / 1000;              // ±0,02
      // la secuencia de resultados reproduce pReal exactamente: los primeros round(n*pReal) ganan
      const gano = k < Math.round(n * pReal) ? 'WIN' : 'LOSS';
      out.push({ event_id: 'ev' + Math.floor(i / 2), family: familia, side: lado,
        p_gp: +(pDicho + j).toFixed(4),
        ...(precio == null ? {} : { p_market: +(precio + j).toFixed(4) }),
        status: 'SETTLED', result_code: gano, odds: 1.9 });
    }
  }
  return out;
}

// ── 1. UN VOLTEO DE VERDAD SE DETECTA ───────────────────────────────────────────────────────────────────
// El modelo dice 60 % en los dos lados. En el local ocurre el 40 % (se pasa +20 pp) y en el visitante el
// 80 % (se queda corto −20 pp). Eso es exactamente lo que produce liquidar con el lado cambiado.
const volteado = CAL.examina(libro({ lados: { home: [0.60, 0.40], away: [0.60, 0.80] } }));
const oV = (volteado.orientacion || [])[0];
t('un volteo con ±20 pp se detecta', !!(oV && oV.compatible_con_volteo), JSON.stringify(oV && oV.lados.map((x) => `${x.lado} ${x.dif_pp}`)));
t('y el veredicto manda a revisar la orientación', volteado.veredicto === 'revisar_orientacion', volteado.veredicto);

// ── 2. TRES PUNTOS DE DIFERENCIA NO SON UN VOLTEO ───────────────────────────────────────────────────────
const ruido = CAL.examina(libro({ lados: { home: [0.60, 0.58], away: [0.60, 0.62] } }));
const oR = (ruido.orientacion || [])[0];
t('±2 pp NO se llama volteo', !!(oR && !oR.compatible_con_volteo), JSON.stringify(oR && oR.lados.map((x) => `${x.lado} ${x.dif_pp}`)));
t('y la lectura dice que cabe en el ruido', /cabe dentro del ruido|misma dirección/i.test((oR || {}).lectura || ''), (oR || {}).lectura);

// ── 3. EXCESO DE CONFIANZA EN LOS DOS LADOS: NO ES ORIENTACIÓN ──────────────────────────────────────────
// Es el caso REAL de Valorant, CS2, LoL, Dota 2, tenis y TT: el modelo se pasa en los dos lados a la vez.
const pasado = CAL.examina(libro({ lados: { home: [0.60, 0.42], away: [0.60, 0.45] }, precio: 0.44 }));
const oP = (pasado.orientacion || [])[0];
t('cuando los dos lados se pasan, NO es orientación', !!(oP && !oP.compatible_con_volteo));
t('y la lectura lo explica', /misma dirección/i.test((oP || {}).lectura || ''), (oP || {}).lectura);
t('el veredicto es descalibrado, no orientación', pasado.veredicto === 'modelo_descalibrado', pasado.veredicto + ' · ' + String(pasado.razon).slice(0, 110));
t('y lo dice comparando con el precio en las MISMAS apuestas', /precio/i.test(pasado.razon));

// ── 4. SI EL PRECIO FALLA IGUAL, EL PROBLEMA NO ES EL MODELO ────────────────────────────────────────────
// Modelo y precio dicen lo mismo y los dos se pasan: eso no señala al modelo, señala a cómo se eligen estas
// apuestas. Distinguir los dos casos es la razón de ser del control de precio.
const sesgada = CAL.examina(libro({ lados: { home: [0.60, 0.42], away: [0.60, 0.43] }, precio: 0.595 }));
t('modelo y precio fallando igual se llama muestra sesgada', sesgada.veredicto === 'muestra_sesgada',
  sesgada.veredicto + ' · ' + String(sesgada.razon).slice(0, 120));

// ── 5. UN MODELO CALIBRADO SE DECLARA CALIBRADO ─────────────────────────────────────────────────────────
const bueno = CAL.examina(libro({ lados: { home: [0.60, 0.60], away: [0.60, 0.59] }, precio: 0.60 }));
t('un modelo que acierta se declara calibrado', bueno.veredicto === 'calibrado_dentro_del_ruido',
  bueno.veredicto + ' · ' + String(bueno.razon).slice(0, 100));

// ── 6. LOS SEIS NOMBRES DE LA MISMA COSA ────────────────────────────────────────────────────────────────
// Cuatro motores escriben `p_model`/`p_implied` y no `p_gp`/`p_market`. Leer solo un nombre daba "no
// evaluable" en tenis, TT, dardos y NFL — 1.290 apuestas liquidadas entre los cuatro.
for (const [m, pr] of [['p_gp', 'p_market'], ['p_model', 'p_implied'], ['model_prob', 'market_prob']]) {
  const filas = libro({ n: 60, lados: { home: [0.60, 0.45], away: [0.60, 0.46] } })
    .map((x) => { const y = { ...x, [m]: x.p_gp, [pr]: 0.5 }; if (m !== 'p_gp') delete y.p_gp; return y; });
  const r = CAL.examina(filas);
  t(`se lee un libro que nombra las probabilidades ${m}/${pr}`, r.n === 120 && r.n_con_precio === 120,
    `n ${r.n} con precio ${r.n_con_precio}`);
}

// ── 7. EL AVISO DE SELECCIÓN NO SE PUEDE PERDER ─────────────────────────────────────────────────────────
t('la salida avisa de que las picks no son una muestra al azar',
  /no son una muestra al azar/i.test(pasado.aviso_seleccion || ''), String(pasado.aviso_seleccion || '').slice(0, 70));
t('y de que el módulo no recalibra nada', /no cambia ninguna probabilidad/i.test(pasado.no_recalibra || ''));

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
