#!/usr/bin/env node
// scripts/llm-smoke.js — LA PRUEBA QUE HABRÍA CAZADO EL BRIEF MUDO (21-ago)
//
// QUÉ PASÓ. Cuando entró el verificador, los nueve escritores pasaron a aceptar un tercer argumento (el
// aviso con los números señalados en el intento anterior). A `writeBrief` se le metió en el prompt pero no
// en la firma, así que `aviso` quedó como identificador libre y la función lanzaba ReferenceError en la
// primera línea. En TODOS los deportes. Y no se veía: el brief captura el error del redactor y pinta "la
// apertura narrada no se pudo escribir", que es exactamente lo que dice cuando el proveedor está caído.
// Un fallo de programación disfrazado de fallo de red.
//
// POR QUÉ ESTA PRUEBA Y NO OTRA. `node --check` no lo caza: sintácticamente el código es correcto, la
// variable simplemente no existe en tiempo de ejecución. Y no hace falta llamar a ningún proveedor para
// cazarlo: basta con INVOCAR cada escritor con el LLM apagado. Si la firma está mal, revienta antes de
// llegar a la puerta; si está bien, sale por el 'llm_disabled' de siempre. Cero coste, cero red.
//
// Uso:  node scripts/llm-smoke.js       (sale 1 si algún escritor tiene la firma rota)
'use strict';

process.env.GP_LLM_ENABLED = 'false';       // sin red: solo queremos ver si la función arranca
const llm = require('../llm');
llm.init({}, () => { });

// cada escritor con la forma REAL de su llamada (algunos llevan un extra entre el payload y el aviso)
const ESCRITORES = [
  ['writePickWhy', [{}, 'aviso']],
  ['writeFightRead', [{}, 'aviso']],
  ['writeFightPreview', [{}, 'aviso']],
  ['writeGameRead', [{}, 'aviso']],
  ['writeBrief', [{}, 'futbol', 'aviso']],
  ['writeNflRead', [{}, 'aviso']],
  ['writeCs2Read', [{}, 'aviso']],
  ['writeTennisRead', [{}, 'aviso']],
  ['writeF1Read', [{}, 'aviso']],
  ['writeAmfootRead', [{}, 'ncaaf', 'aviso']],
];

(async () => {
  const rotos = [];
  for (const [nombre, args] of ESCRITORES) {
    const fn = llm[nombre];
    if (typeof fn !== 'function') { rotos.push(`${nombre}: no está exportado`); continue; }
    try {
      await fn(...args);
      console.log(`  ${nombre.padEnd(18)} ok`);
    } catch (e) {
      // ReferenceError/TypeError = la firma o el cuerpo están mal. Cualquier otro error es la puerta
      // haciendo su trabajo (llm_disabled) y es lo que esperamos ver.
      if (e instanceof ReferenceError || e instanceof TypeError) rotos.push(`${nombre}: ${e.message}`);
      else console.log(`  ${nombre.padEnd(18)} ok (${e.message})`);
    }
  }
  // y el extractor, que comparte el mismo riesgo de firma
  try { await llm.extractSignals([{ subject: 'x', title: 'y' }], 'esports'); }
  catch (e) { if (e instanceof ReferenceError || e instanceof TypeError) rotos.push(`extractSignals: ${e.message}`); }
  // los dominios del extractor tienen que existir todos: un dominio sin entrada cae al de fútbol EN SILENCIO
  for (const d of ['futbol', 'combat', 'esports', 'tennis', 'amfoot']) {
    if (!llm.DOMINIOS[d]) rotos.push(`DOMINIOS.${d}: falta el vocabulario del deporte`);
  }
  // ── EL PARSEADOR, QUE ES POR DONDE SE PIERDEN LAS RESPUESTAS BUENAS ──────────────────────────────
  // Gemini flash-lite se atasca al cerrar el JSON y repite el final. La respuesta está completa y es
  // correcta; lo que sobra viene DETRÁS. Parseando el texto entero, 1 de cada 4 briefs se tiraba a la
  // basura y el usuario leía "no se pudo escribir la apertura" un día en que sí se había escrito.
  const CASOS = [
    ['basura repetida al final', '{"es":"hola","en":"hi"}\nmarkets."}\nthese specific markets."}', (j) => j && j.es === 'hola'],
    ['limpio', '{"es":"a","en":"b"}', (j) => j && j.en === 'b'],
    ['con fence', '```json\n{"es":"a","en":"b"}\n```', (j) => j && j.es === 'a'],
    ['array con basura detrás', '[{"i":0,"type":"OUT"}]\n]}basura', (j) => Array.isArray(j) && j.length === 1],
    ['llaves dentro de un string', '{"es":"usa } y { dentro","en":"b"}\nsobra"}', (j) => j && j.es === 'usa } y { dentro'],
    ['salto de línea literal dentro', '{"es":"linea1\nlinea2","en":"b"}', (j) => j && j.es.indexOf('\n') > 0],
    // este DEBE dar null: una respuesta cortada de verdad no se puede rescatar, y fingir que sí sería
    // peor que fallar — publicaríamos media frase como si fuera el texto completo
    ['truncado de verdad → null', '{"es":"sin cerrar', (j) => j === null],
  ];
  for (const [nombre, txt, comprueba] of CASOS) {
    let j = null;
    try { j = llm.jsonOf({ content: [{ type: 'text', text: txt }] }); } catch (e) { rotos.push(`jsonOf(${nombre}): lanzó ${e.message}`); continue; }
    if (!comprueba(j)) rotos.push(`jsonOf(${nombre}): devolvió ${JSON.stringify(j)}`);
    else console.log(`  jsonOf · ${nombre}`);
  }
  if (rotos.length) { console.error('\nROTO:\n  - ' + rotos.join('\n  - ')); process.exit(1); }
  console.log('\nlos 10 escritores, el extractor y el parseador funcionan.');
})();
