// tests/libro.test.js — EL LIBRO QUE NO SE PUEDE REESCRIBIR (16-sep, R5 · E4)
//
// La cadena de hashes solo sirve si DETECTA las tres maneras de manipular un registro: editar un asiento,
// borrarlo y colar uno nuevo en medio. Si no detecta las tres, es decoración criptográfica. Lo que se fija
// aquí son esas tres, más la regla que hace honesto al libro: corregir es un asiento NUEVO, nunca una
// edición.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libro-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
const L = require('../lib/libro');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// ── 1. UN LIBRO VACÍO ES VÁLIDO ─────────────────────────────────────────────────────────────────────────
t('un libro vacío verifica', L.verifica().ok === true && L.verifica().vacio === true);
t('y su cabeza es el génesis', L.cabeza().hash === L.GENESIS);

// ── 2. ESCRIBIR ENCADENA ────────────────────────────────────────────────────────────────────────────────
const a1 = L.anota('senal', { familia: 'cards_under_v2', linea: 4.5, cuota: 1.91 });
const a2 = L.anota('orden', { ref: 'abc', stake: 40 });
const a3 = L.anota('liquidacion', { ref: 'abc', resultado: 'WIN', pago: 36.4 });
t('los tres asientos se escriben', a1.ok && a2.ok && a3.ok);
t('y cada uno apunta al anterior', a2.asiento.prev === a1.asiento.hash && a3.asiento.prev === a2.asiento.hash);
t('la numeración es correlativa', a1.asiento.n === 1 && a3.asiento.n === 3);
t('la cadena verifica entera', L.verifica().ok === true && L.verifica().n === 3, JSON.stringify(L.verifica()).slice(0, 90));

// ── 3. UN TIPO INVENTADO NO ENTRA ───────────────────────────────────────────────────────────────────────
// Los tipos están cerrados a propósito: un libro donde cualquiera inventa un tipo deja de ser legible
// dentro de seis meses, que es justo cuando hace falta.
const malo = L.anota('lo_que_sea', { x: 1 });
t('un tipo desconocido se rechaza', malo.ok === false && /cerrados a propósito/.test(malo.motivo), malo.motivo);
t('y no ensucia la cadena', L.verifica().n === 3);

// ── 4. LAS TRES MANERAS DE MANIPULAR, DETECTADAS ────────────────────────────────────────────────────────
const archivo = path.join(L.DIR, L.ARCHIVO);
const original = fs.readFileSync(archivo, 'utf8');

// (a) EDITAR un asiento — el caso real: cambiar un resultado después de conocerlo
{
  const ls = original.trim().split('\n');
  const j = JSON.parse(ls[2]); j.datos.resultado = 'LOSS';        // se toca el resultado, no el hash
  ls[2] = JSON.stringify(j);
  fs.writeFileSync(archivo, ls.join('\n') + '\n');
  const v = L.verifica();
  t('EDITAR un asiento se detecta', v.ok === false && v.rota_en === 3 && /no coincide con su hash/.test(v.motivo), v.motivo);
  t('y se dice que se editó después de escribirse', /se editó después de escribirse/.test(String(v.lectura)));
}

// (b) BORRAR un asiento del medio
{
  const ls = original.trim().split('\n');
  ls.splice(1, 1);
  fs.writeFileSync(archivo, ls.join('\n') + '\n');
  const v = L.verifica();
  t('BORRAR un asiento se detecta', v.ok === false && v.rota_en === 2, JSON.stringify(v).slice(0, 110));
}

// (c) COLAR uno nuevo en medio, bien formado por dentro
{
  const ls = original.trim().split('\n');
  const falso = { n: 2, at: new Date().toISOString(), tipo: 'orden', prev: JSON.parse(ls[0]).hash, datos: { colado: true } };
  falso.hash = L.hashDe(falso);                                    // su hash propio es correcto
  ls.splice(1, 0, JSON.stringify(falso));
  fs.writeFileSync(archivo, ls.join('\n') + '\n');
  const v = L.verifica();
  t('COLAR un asiento en medio se detecta aunque su hash propio sea válido', v.ok === false, JSON.stringify(v).slice(0, 110));
}

fs.writeFileSync(archivo, original);
t('restaurado el original, vuelve a verificar', L.verifica().ok === true);

// ── 5. CORREGIR ES UN ASIENTO NUEVO, NO UNA EDICIÓN ─────────────────────────────────────────────────────
// Es la regla que hace honesto al libro: si los errores se borraran, sería indistinguible de uno donde se
// borran los resultados incómodos.
const corr = L.corrige(a3.asiento.hash, 'el liquidador contaba la roja como una tarjeta', { resultado: 'LOSS' });
t('la corrección se escribe como asiento nuevo', corr.ok === true && corr.asiento.tipo === 'correccion');
t('y apunta al viejo por su hash', corr.asiento.datos.corrige === a3.asiento.hash);
t('el asiento viejo SIGUE ahí', L.leer().some((x) => x.hash === a3.asiento.hash));
t('y la cadena sigue válida', L.verifica().ok === true && L.verifica().n === 4);
t('corregir sin decir a quién se rechaza', L.corrige(null, 'x').ok === false);

// ── 6. EL ESTADO DICE LO QUE PROTEGE Y LO QUE NO ────────────────────────────────────────────────────────
const st = L.estado();
t('el estado cuenta por tipo', st.por_tipo.senal === 1 && st.por_tipo.correccion === 1, JSON.stringify(st.por_tipo));
t('avisa de que no protege contra reescribir el archivo entero',
  /NO protege contra quien reescriba el archivo entero/.test(st.que_protege));
t('y de que no demuestra que el dato sea correcto', /solo que no cambió/.test(st.que_no_es));
t('cuenta cuántos asientos van sin ancla', st.sin_ancla_desde === 4, String(st.sin_ancla_desde));
L.anota('ancla', { donde: 'correo al admin', hash: L.cabeza().hash });
t('tras anclar, el contador se reinicia', L.estado().sin_ancla_desde === 0, String(L.estado().sin_ancla_desde));

// ── 7. EL HASH ES DETERMINISTA AUNQUE CAMBIE EL ORDEN DE LAS CLAVES ─────────────────────────────────────
// Si dependiera del orden de inserción, el mismo asiento daría hashes distintos y verificar sería inútil.
t('la serialización ordena las claves',
  L.canon({ b: 1, a: 2 }) === L.canon({ a: 2, b: 1 }), L.canon({ b: 1, a: 2 }));
t('y anidadas también', L.canon({ x: { z: 1, y: 2 } }) === L.canon({ x: { y: 2, z: 1 } }));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
