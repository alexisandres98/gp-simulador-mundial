// lib/libro.js — EL LIBRO QUE NO SE PUEDE REESCRIBIR (16-sep, R5 · E4)
//
// ── POR QUÉ ────────────────────────────────────────────────────────────────────────────────────────────
// Todo lo que este sistema decide descansa sobre un track, y un track es un archivo JSON que se reescribe
// entero en cada pasada. Eso significa que hoy **no hay forma de demostrar que una fila no se tocó después
// de conocer su resultado**. No hace falta mala fe: basta una migración, un backfill, un «arreglo» de un
// campo o un liquidador que cambia de criterio — y este año ha habido las cuatro cosas. Cuando el track y
// el dinero discrepan, la pregunta «¿esto se anotó antes o después?» no se puede contestar.
//
// Un libro append-only con la cadena de hashes la contesta. Cada asiento lleva el hash del anterior, así
// que cambiar uno obliga a recalcular todos los que vienen detrás: la manipulación deja de ser invisible y
// pasa a ser detectable con una pasada de verificación.
//
// ── LO QUE ESTO ES Y LO QUE NO ES ──────────────────────────────────────────────────────────────────────
// **Esto no es una base de datos ni sustituye a los tracks.** Los motores siguen escribiendo sus archivos
// igual que antes. El libro es un registro PARALELO de los hechos que importan para el dinero y para las
// decisiones: nació una señal, se colocó una orden, se liquidó, se cambió un interruptor. Se escribe una
// vez y no se toca más.
//
// **No demuestra que el dato sea correcto, solo que no cambió.** Si se anota mal, queda mal anotado para
// siempre — y eso también es información: la corrección es un asiento NUEVO que apunta al viejo, no una
// edición. Un libro donde los errores se borran no vale para nada, porque es indistinguible de uno donde
// se borran los resultados incómodos.
//
// **La cadena no protege contra quien reescriba el archivo entero.** Un atacante con acceso al disco puede
// regenerar toda la cadena. Contra eso protege el ANCLA: el hash de la cabeza publicado en un sitio que no
// controlamos nosotros (un correo al admin, un mensaje al canal). Se deja preparado y declarado; anclar de
// verdad es una decisión de operación.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = (() => {
  const base = path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json'));
  return path.join(base, 'libro');
})();
const ARCHIVO = 'libro.jsonl';
const GENESIS = '0'.repeat(64);

// Los tipos de asiento. Cerrado a propósito: un libro donde cualquiera inventa un tipo deja de ser legible
// dentro de seis meses, que es justo cuando hace falta.
const TIPOS = new Set([
  'senal',          // nació una señal / pick
  'orden',          // se envió una orden a la casa
  'fill',           // la casa la aceptó, con su precio real
  'liquidacion',    // se liquidó, con el resultado y lo que pagó
  'interruptor',    // se cambió una variable que afecta al dinero o a qué picks nacen
  'decision',       // una decisión humana con su motivo
  'correccion',     // corrige un asiento anterior SIN borrarlo, apuntando a su hash
  'ancla',          // se publicó el hash de la cabeza fuera de aquí
]);

const ruta = () => path.join(DIR, ARCHIVO);

// El hash cubre TODO el asiento menos su propio hash, e incluye el del anterior. La serialización es
// determinista (claves ordenadas): si dependiera del orden de inserción, el mismo asiento daría hashes
// distintos y la verificación sería inútil.
function canon(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canon).join(',') + ']';
  const ks = Object.keys(obj).sort();
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}';
}
function hashDe(asiento) {
  const { hash, ...resto } = asiento;                            // eslint-disable-line no-unused-vars
  return crypto.createHash('sha256').update(canon(resto)).digest('hex');
}

function leerCrudo() {
  try { return fs.readFileSync(ruta(), 'utf8').split('\n').filter((l) => l.trim()); } catch { return []; }
}
function leer() {
  const out = [];
  for (const l of leerCrudo()) { try { out.push(JSON.parse(l)); } catch { out.push({ __ilegible: l.slice(0, 120) }); } }
  return out;
}
function cabeza() {
  const ls = leerCrudo();
  if (!ls.length) return { hash: GENESIS, n: 0 };
  try { const u = JSON.parse(ls[ls.length - 1]); return { hash: u.hash || GENESIS, n: ls.length, at: u.at }; }
  catch { return { hash: GENESIS, n: ls.length, roto: true }; }
}

// ── ESCRIBIR ────────────────────────────────────────────────────────────────────────────────────────────
// Append de una línea. Nunca reescribe el archivo; si el disco falla, se devuelve el error y NO se finge
// que se escribió — un libro que miente sobre haberse escrito es peor que no tenerlo.
function anota(tipo, datos, { at = null } = {}) {
  if (!TIPOS.has(tipo)) return { ok: false, motivo: `tipo desconocido: ${tipo}. Los tipos están cerrados a propósito.` };
  const prev = cabeza();
  const asiento = { n: prev.n + 1, at: at || new Date().toISOString(), tipo, prev: prev.hash, datos: datos || {} };
  asiento.hash = hashDe(asiento);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(ruta(), JSON.stringify(asiento) + '\n');
  } catch (e) { return { ok: false, motivo: `no se pudo escribir: ${e.message}` }; }
  return { ok: true, asiento };
}

// Corregir NO es editar: es un asiento nuevo que apunta al viejo por su hash. El viejo se queda.
function corrige(hashViejo, motivo, datos) {
  if (!hashViejo || typeof hashViejo !== 'string') return { ok: false, motivo: 'hace falta el hash del asiento que se corrige' };
  return anota('correccion', { corrige: hashViejo, motivo: motivo || null, ...(datos || {}) });
}

// ── VERIFICAR ───────────────────────────────────────────────────────────────────────────────────────────
// Recorre la cadena entera. Devuelve el primer punto donde se rompe, que es lo único accionable: a partir
// de ahí todo está en duda, y antes de ahí nada lo está.
function verifica() {
  const filas = leer();
  if (!filas.length) return { ok: true, n: 0, vacio: true, cabeza: GENESIS };
  let prev = GENESIS;
  for (let i = 0; i < filas.length; i++) {
    const a = filas[i];
    if (a.__ilegible) return { ok: false, n: filas.length, rota_en: i + 1, motivo: 'línea ilegible', linea: a.__ilegible };
    if (a.prev !== prev) {
      return { ok: false, n: filas.length, rota_en: i + 1, motivo: 'el asiento no apunta al anterior',
        esperaba: prev, encontro: a.prev,
        lectura: 'alguien insertó, borró o reordenó asientos aquí. Todo lo anterior a este punto sigue siendo verificable.' };
    }
    const h = hashDe(a);
    if (h !== a.hash) {
      return { ok: false, n: filas.length, rota_en: i + 1, motivo: 'el contenido del asiento no coincide con su hash',
        esperaba: h, encontro: a.hash,
        lectura: 'este asiento se editó después de escribirse.' };
    }
    if (a.n !== i + 1) {
      return { ok: false, n: filas.length, rota_en: i + 1, motivo: 'el número de asiento no es correlativo', esperaba: i + 1, encontro: a.n };
    }
    prev = a.hash;
  }
  return { ok: true, n: filas.length, cabeza: prev, desde: filas[0].at, hasta: filas[filas.length - 1].at };
}

// ── RESUMEN PARA LA SONDA ───────────────────────────────────────────────────────────────────────────────
function estado() {
  const v = verifica();
  const filas = leer();
  const porTipo = {};
  for (const a of filas) if (a.tipo) porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1;
  const anclas = filas.filter((a) => a.tipo === 'ancla');
  return { ...v, archivo: ruta(), por_tipo: porTipo,
    ultima_ancla: anclas.length ? anclas[anclas.length - 1] : null,
    sin_ancla_desde: anclas.length ? filas.length - filas.lastIndexOf(anclas[anclas.length - 1]) - 1 : filas.length,
    que_protege: 'la cadena detecta que un asiento se editó, se borró o se insertó. NO protege contra quien reescriba el archivo entero: contra eso protege publicar el hash de la cabeza fuera de aquí (asiento `ancla`).',
    que_no_es: 'no demuestra que el dato sea correcto, solo que no cambió. Un error queda mal anotado para siempre y se corrige con un asiento NUEVO que apunta al viejo — un libro donde los errores se borran es indistinguible de uno donde se borran los resultados incómodos.' };
}

module.exports = { DIR, ARCHIVO, TIPOS, GENESIS, anota, corrige, verifica, estado, leer, cabeza, hashDe, canon };
