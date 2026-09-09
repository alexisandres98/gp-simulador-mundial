// scripts/i18n-darts-tt.js — ¿cuánto del español de dardos y tenis de mesa tapa la red de seguridad?
//
// La red de seguridad de idioma que vive al final de public/premium.js es un parche y nadie lo ha
// negado nunca: seis deportes nacieron admin-only con el texto en español clavado en el render, y en
// lugar de reescribir cada plantilla se optó por traducir los nodos de texto del DOM justo después de
// pintarlos. El parche funciona mientras alguien lo mantenga al día, y ahí está el problema: los dos
// motores nuevos —darts-engine/store.js y tt-engine/store.js— devuelven al navegador motivos de
// puerta, narrativas de tesis, notas de ficha, etiquetas de familia, textos de billete y la doctrina
// entera, todo en español, y ninguna de esas frases aparece en el mapa a menos que alguien se acuerde
// de añadirla. Un usuario con el idioma en inglés ve español y nadie se entera hasta que lo reporta.
//
// Este script es el medidor que faltaba. Saca del código de los dos motores todos los literales de
// cadena destinados al usuario, los pasa por la MISMA función enTxt del frontend —extraída y evaluada
// tal cual, no reimplementada, porque una copia se desincroniza el primer día— y cuenta cuántos salen
// traducidos y cuántos siguen en español. Sale con código 1 si queda alguno pendiente, así que sirve
// de comprobación junto a `node --check` antes de un deploy. Que dé cero no significa que la
// traducción sea buena, solo que la red cubre lo que el servidor manda; sigue siendo un parche.
//
// Uso: node scripts/i18n-darts-tt.js [--list]
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREMIUM = path.join(ROOT, 'public', 'premium.js');
const ENGINES = [
  { id: 'dardos', file: path.join(ROOT, 'darts-engine', 'store.js') },
  { id: 'tenis de mesa', file: path.join(ROOT, 'tt-engine', 'store.js') },
];

// ── 1. LA RED DE SEGURIDAD, TAL CUAL ESTÁ EN EL FRONTEND ────────────────────────────────────────────
// Se recorta el bloque que va de `var EN_X = {` hasta justo antes de enPass (donde acaba enTxt) y se
// evalúa en un contexto aislado con new Function. Nada de reimplementar la lógica: si mañana cambia el
// orden de EN_FRAG o se añade una regex, este medidor lo ve sin tocarlo.
function loadNet() {
  const src = fs.readFileSync(PREMIUM, 'utf8');
  const ini = src.indexOf('var EN_X = {');
  const fin = src.indexOf('function enPass(');
  if (ini < 0 || fin < 0 || fin < ini) throw new Error('no encuentro la red de seguridad de idioma en public/premium.js');
  const body = src.slice(ini, fin) + '\nreturn { EN_X, EN_FRAG, EN_RX, EN_MARK, enTxt };';
  return new Function(body)();
}

// ── 2. LITERALES DE CADENA DE UN FICHERO JS ─────────────────────────────────────────────────────────
// Un recorrido a mano por el fuente: salta comentarios de línea y de bloque, distingue una barra de
// división de una expresión regular por el token anterior, y devuelve cada literal con su línea, su
// tipo de comilla y el contexto inmediato (el carácter significativo de antes y el de después), que es
// lo que permite descartar después las claves de objeto.
function stringLiterals(src) {
  const out = [];
  let line = 1;
  let prevSig = '';           // último carácter significativo fuera de cadenas y comentarios
  let prevWord = '';          // última palabra (para require, y para el heurístico de la regex)
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const c = src[i];
    if (c === '\n') { line++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; line++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i++;
      continue;
    }
    if (c === '/' && !/[\w$)\]]/.test(prevSig)) {   // expresión regular: se salta entera con su clase [...]
      let j = i + 1, klass = false;
      for (; j < n; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === '[') klass = true;
        else if (src[j] === ']') klass = false;
        else if (src[j] === '/' && !klass) break;
        else if (src[j] === '\n') break;
      }
      if (src[j] === '/') { i = j; prevSig = '/'; prevWord = ''; continue; }
    }
    if (c === '"' || c === "'" || c === '`') {
      const startLine = line;
      let raw = '';
      let j = i + 1;
      let depth = 0;                                 // ${ ... } anidado dentro de una plantilla
      for (; j < n; j++) {
        const d = src[j];
        if (d === '\\') { raw += d + (src[j + 1] || ''); if (src[j + 1] === '\n') line++; j++; continue; }
        if (d === '\n') { line++; if (c !== '`') break; }
        if (c === '`') {
          if (d === '$' && src[j + 1] === '{') { depth++; raw += '${'; j++; continue; }
          if (d === '}' && depth > 0) { depth--; raw += '}'; continue; }
          if (depth > 0) { raw += d; continue; }
        }
        if (d === c) break;
        raw += d;
      }
      let k = j + 1;
      while (k < n && /\s/.test(src[k])) k++;
      out.push({ raw, quote: c, line: startLine, before: prevSig, before_word: prevWord, after: src[k] || '' });
      i = j;
      prevSig = c;
      prevWord = '';
      continue;
    }
    if (/\s/.test(c)) continue;
    if (/[\w$]/.test(c)) prevWord = /[\w$]/.test(prevSig) ? prevWord + c : c;
    else prevWord = '';
    prevSig = c;
  }
  return out;
}

// ── 3. QUÉ ES TEXTO PARA EL USUARIO Y QUÉ NO ────────────────────────────────────────────────────────
// El filtro de verdad es el propio EN_MARK del frontend: si la red no reconocería la frase como
// española, tampoco la miraría en el DOM. Antes de eso se van las claves de objeto, las rutas de
// require, las URLs, los ficheros y los identificadores de un solo token, que casan con EN_MARK por
// accidente ('de' dentro de una ruta) pero nunca se pintan.
const TECNICO = [
  /^https?:\/\//i,
  /^\.?\.?\/[\w.\-]/,                         // ./modus, ../data-providers/..., /api/darts

  /^[\w.\-]+\.(json|js|md|png|svg|csv|html)$/i,
  /^[\w$-]+$/,                                // un solo token: campo, id, clase, familia
  /^[A-Z0-9_]+$/,
  /^[\w-]+(\.[\w-]+)+$/,                      // a.b.c
  /^[\w-]+(,\s*[\w-]+)+$/i,                   // listas de campos
  /^\s*$/,
];
function esTecnico(s) { return TECNICO.some((rx) => rx.test(s)); }

function esClaveDeObjeto(lit) {
  return lit.after === ':' && (lit.before === '{' || lit.before === ',' || lit.before === '' || lit.before === ';');
}

// Los huecos de una plantilla parten el literal: lo que se juzga son los trozos fijos de más de 12
// caracteres, que es donde vive la frase; lo de menos son pegamento (' · ', ' de ') que la red trata
// dentro de la frase completa del nodo, no por separado. El trozo se juzga CON sus espacios, porque
// la red los usa: 'no encuentro a ' lleva el espacio final a propósito y sin él no casaría.
function trozosDePlantilla(raw) {
  const out = [];
  let buf = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1, j = i + 2;
      for (; j < raw.length && depth > 0; j++) {
        if (raw[j] === '{') depth++;
        else if (raw[j] === '}') depth--;
      }
      out.push(buf); buf = ''; i = j - 1;
      continue;
    }
    buf += raw[i];
  }
  out.push(buf);
  return out.filter((s) => s.trim().length > 12);
}

// Traducido de verdad o a medias. enTxt devuelve la frase cambiada o null, pero puede haber tocado
// solo una parte; para saberlo se mira el RESIDUO, un detector deliberadamente más corto que EN_MARK:
// solo marcas que en inglés no existen. EN_MARK sirve para encontrar español, no para certificar
// inglés — 'no', 'son' o 'un' son palabras de los dos idiomas y darían falsos positivos.
const RESIDUO = /[áéíóúñÁÉÍÓÚÑ¿¡«]|\b(el|la|los|las|de|del|una|que|con|sin|por|para|se|ya|hay|hoy|desde|cada|sobre|entre|jugador|jugadores|partido|partidos|puntos|casas|cuota|sombra|ganador|muestra|ventaja|liquidadas)\b/i;

function desescapar(raw, quote) {
  if (quote === '`') return raw;
  return raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(['"\\])/g, '$1');
}

// ── 4. EL RECUENTO ──────────────────────────────────────────────────────────────────────────────────
function main() {
  const net = loadNet();
  const listar = process.argv.includes('--list');
  const resumen = [];
  let pendientesTotal = 0;

  for (const eng of ENGINES) {
    const src = fs.readFileSync(eng.file, 'utf8');
    const rel = path.relative(ROOT, eng.file);
    const frases = [];
    const vistas = new Set();

    for (const lit of stringLiterals(src)) {
      if (esClaveDeObjeto(lit)) continue;
      if (lit.before_word === 'require') continue;
      const texto = desescapar(lit.raw, lit.quote);
      const cand = lit.quote === '`' ? trozosDePlantilla(texto) : [texto.trim()];
      for (const c of cand) {
        if (!c.trim() || esTecnico(c.trim())) continue;
        if (!net.EN_MARK.test(c)) continue;
        const clave = c + '@@' + lit.line;
        if (vistas.has(clave)) continue;
        vistas.add(clave);
        const en = net.enTxt(c);
        const estado = en == null ? 'sin traducir' : RESIDUO.test(en) ? 'a medias' : 'traducido';
        frases.push({ texto: c, linea: lit.line, estado, en });
      }
    }

    const traducidos = frases.filter((f) => f.estado === 'traducido').length;
    const pendientes = frases.filter((f) => f.estado !== 'traducido');
    pendientesTotal += pendientes.length;
    resumen.push({ id: eng.id, rel, total: frases.length, traducidos, pendientes });
  }

  console.log('RED DE SEGURIDAD DE IDIOMA · cobertura de dardos y tenis de mesa');
  console.log('');
  for (const r of resumen) {
    const pct = r.total ? Math.round((r.traducidos / r.total) * 100) : 100;
    console.log(`  ${r.id.padEnd(14)} ${r.rel.padEnd(24)} total ${String(r.total).padStart(4)} · traducidos ${String(r.traducidos).padStart(4)} (${pct}%) · pendientes ${String(r.pendientes.length).padStart(4)}`);
  }
  const total = resumen.reduce((a, r) => a + r.total, 0);
  const trad = resumen.reduce((a, r) => a + r.traducidos, 0);
  console.log('');
  console.log(`  TOTAL          ${String(total).padStart(28)} · traducidos ${String(trad).padStart(4)} · pendientes ${String(pendientesTotal).padStart(4)}`);

  if (listar && pendientesTotal) {
    console.log('');
    console.log('PENDIENTES');
    for (const r of resumen) {
      for (const f of r.pendientes) {
        console.log(`  ${r.rel}:${f.linea} [${f.estado}] ${JSON.stringify(f.texto)}`);
        if (f.estado === 'a medias') console.log(`      queda: ${JSON.stringify(f.en)}`);
      }
    }
  } else if (pendientesTotal && !listar) {
    console.log('');
    console.log('  (usa --list para verlas una por línea)');
  }

  process.exit(pendientesTotal ? 1 : 0);
}

main();
