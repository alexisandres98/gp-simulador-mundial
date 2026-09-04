// lib/jsonstore.js — lectura y escritura de almacenes JSON en disco, a prueba de dos fallos que ya
// costaron histórico en producción el 4-sep-2026.
//
// FALLO 1 — ESCRITURA NO ATÓMICA. Escribir con `writeFileSync` directamente encima del archivo bueno deja
// el archivo TRUNCADO si el proceso muere a mitad (un deploy manda SIGTERM y a los segundos SIGKILL). Así
// se perdió `db.json` entero. Aquí se escribe en un temporal y se RENOMBRA: el rename dentro del mismo
// sistema de archivos es atómico, así que el archivo solo puede estar en el estado de antes o en el de
// después, nunca a medias.
//
// FALLO 2 — UNA LECTURA FALLIDA CONVERTIDA EN ALMACÉN VACÍO. Éste es el que se llevó el track de esports de
// CS2, LoL y Valorant (207, 77 y 14 picks liquidadas el 21-ago → CERO el 4-sep, mientras Dota 2 sobrevivía
// con las suyas). El patrón era:
//
//     const st = rd(FICHERO) || { picks: {} };   // rd() se traga CUALQUIER error y devuelve null
//     ...                                        // el llamador cree de buena fe que no había nada
//     wr(FICHERO, st);                           // y escribe el almacén VACÍO encima del bueno
//
// Es decir: "no pude leer" se trataba igual que "no hay nada", y el siguiente guardado destruía el
// histórico para siempre. Un JSON roto, un pico de memoria, un descriptor de archivo agotado o un disco
// que tarda en montar bastan para dispararlo, y no deja rastro: el archivo queda perfectamente válido y
// perfectamente vacío.
//
// LA REGLA AQUÍ: **no existe** y **no se pudo leer** son cosas distintas y se tratan distinto.
//   · No existe (ENOENT)      → null. Es legítimamente vacío; escribir está bien.
//   · Existe pero no parsea   → se APARTA a `<fichero>.roto-<fecha>` (los bytes se conservan para poder
//                               rescatar algo) y se empieza de cero. Nunca se destruye en silencio.
//   · Cualquier otro error    → se BLOQUEA la escritura de ese fichero hasta que una lectura vuelva a ir
//     (permisos, memoria,       bien. Perder una pasada no cuesta nada; perder el histórico sí.
//      descriptores, disco)
'use strict';
const fs = require('fs');
const path = require('path');

// Ficheros que existen pero cuya última lectura falló por algo que NO es "no está": mientras estén aquí,
// escribir encima está prohibido. Se limpia solo en cuanto una lectura sale bien.
const BLOQUEADOS = new Set();

const clave = (dir, file) => path.join(dir, file);

// Lee un JSON del disco. Devuelve null si no hay nada que leer (o si no se pudo, ya avisando).
function readJson(dir, file, etiqueta) {
  const f = clave(dir, file);
  try {
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    BLOQUEADOS.delete(f);
    return v;
  } catch (e) {
    if (e.code === 'ENOENT') { BLOQUEADOS.delete(f); return null; } // no existe: vacío de verdad
    const tag = etiqueta || 'store';
    if (e instanceof SyntaxError) {
      // El archivo está roto. Se aparta con su contenido intacto y se empieza de cero: así el histórico
      // sigue existiendo en disco (recuperable a mano) en vez de desaparecer bajo el siguiente guardado.
      const muerto = `${f}.roto-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try { fs.renameSync(f, muerto); } catch { /* si no se puede apartar, mejor no tocar nada */ }
      console.error(`[${tag}] ${file} ILEGIBLE (${e.message}) — apartado en ${path.basename(muerto)} y se empieza de cero`);
      BLOQUEADOS.delete(f);
      return null;
    }
    // Fallo de entrada/salida: el archivo puede estar perfectamente bien. NO se escribe encima.
    BLOQUEADOS.add(f);
    console.error(`[${tag}] ${file} existe pero no se pudo leer (${e.code || e.message}) — escritura BLOQUEADA para no perder el histórico`);
    return null;
  }
}

// Escribe un JSON de forma atómica. Devuelve false (sin lanzar) si no se pudo o si está bloqueado.
function writeJson(dir, file, obj, etiqueta) {
  const f = clave(dir, file);
  if (BLOQUEADOS.has(f)) {
    console.error(`[${etiqueta || 'store'}] escritura de ${file} BLOQUEADA: la última lectura falló y guardar ahora borraría el histórico`);
    return false;
  }
  const tmp = path.join(dir, '.' + file + '.tmp');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, f);
    return true;
  } catch (e) {
    console.error(`[${etiqueta || 'store'}] no se pudo guardar ${file}: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch { /* puede no existir */ }
    return false;
  }
}

// Para sondas: qué ficheros están bloqueados ahora mismo.
const bloqueados = () => [...BLOQUEADOS];

module.exports = { readJson, writeJson, bloqueados };
