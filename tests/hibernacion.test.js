'use strict';
// Ida y vuelta del empaquetado de hibernación: un disco sintético → tar.gz → restauración en otro sitio →
// mismos bytes (sha256), rutas peligrosas rechazadas, nombres largos (LongLink) y ficheros vacíos intactos.
// Correr: node tests/hibernacion.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const H = require('../lib/hibernacion');

let fallos = 0;
function ok(cond, msg) { if (cond) console.log('  ✓', msg); else { fallos++; console.log('  ✗', msg); } }

async function main() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-hib-'));
  const base = path.join(raiz, 'data'), vuelta = path.join(raiz, 'vuelta');
  fs.mkdirSync(path.join(base, 'clubs'), { recursive: true });
  fs.mkdirSync(path.join(base, 'backups', 'almacenes', '2026-10-18'), { recursive: true });
  fs.mkdirSync(path.join(base, 'vacia'), { recursive: true });
  fs.mkdirSync(path.join(base, '.hibernacion-previo-viejo'), { recursive: true });
  fs.writeFileSync(path.join(base, '.hibernacion-previo-viejo', 'x.json'), '{}');
  const grande = Buffer.alloc(3 * 1048576 + 777); for (let i = 0; i < grande.length; i++) grande[i] = (i * 31 + 7) & 255;
  const largo = 'clubs/' + 'subcarpeta-con-nombre-muy-largo-'.repeat(4) + '/' + 'fichero-'.repeat(14) + 'final.json';
  fs.mkdirSync(path.dirname(path.join(base, largo)), { recursive: true });
  const ficheros = {
    'db.json': JSON.stringify({ users: { 'a@b.c': { createdAt: 1 } }, shadow: { bankroll: 1672.66 } }),
    'real-ledger.json': '{"bets":[]}',
    'clubs/results-premier.json': grande,
    'clubs/ñandú con espacios.json': '{"ok":true}',
    'backups/almacenes/2026-10-18/x.json.gz': zlib.gzipSync('{}'),
    'vacio.json': '',
    [largo]: '{"largo":true}',
  };
  for (const [rel, cont] of Object.entries(ficheros)) fs.writeFileSync(path.join(base, rel), cont);
  fs.utimesSync(path.join(base, 'db.json'), 1700000000, 1700000000);

  console.log('1. manifiesto');
  const man = await H.manifiesto(base, { sha: true });
  ok(man.ficheros === Object.keys(ficheros).length, `cuenta ${man.ficheros} ficheros (sin la carpeta de puesta en escena)`);
  ok(man.lista.every((f) => f.sha256 && f.sha256.length === 64), 'sha256 en todos');
  ok(man.saltados.length === 0, 'nada saltado');
  const manSin = await H.manifiesto(base, { excluir: ['backups'] });
  ok(manSin.ficheros === man.ficheros - 1 && !manSin.por_carpeta.backups, 'excluir=backups quita solo esa carpeta');

  console.log('2. tar.gz → fichero → tar del sistema lo lee');
  const tgz = path.join(raiz, 'disco.tar.gz');
  await new Promise((res, rej) => H.streamTarGz(base).pipe(fs.createWriteStream(tgz)).on('finish', res).on('error', rej));
  ok(fs.statSync(tgz).size > 1000, `tar.gz de ${fs.statSync(tgz).size} bytes`);
  let listado = null;
  try { listado = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }); } catch (e) { console.log('  (tar del sistema no disponible: se salta la comprobación externa)'); }
  if (listado != null) {
    ok(listado.includes('db.json') && listado.includes(largo), 'GNU tar lista db.json y el nombre largo');
    ok(!listado.includes('.hibernacion-previo-viejo'), 'la carpeta de puesta en escena vieja no viaja');
  }

  console.log('3. restauración en un disco vacío');
  fs.mkdirSync(vuelta, { recursive: true });
  fs.writeFileSync(path.join(vuelta, 'db.json'), '{"users":{}}'); // lo que habría en un disco recién creado
  const r = await H.restaurar(fs.createReadStream(tgz), vuelta);
  ok(r.ficheros === Object.keys(ficheros).length, `restauró ${r.ficheros} ficheros`);
  ok(r.apartados.includes('db.json') && fs.existsSync(path.join(r.apartados_en, 'db.json')), 'el db.json previo quedó apartado, no borrado');
  const man2 = await H.manifiesto(vuelta, { sha: true });
  const porRuta = Object.fromEntries(man.lista.map((f) => [f.ruta, f.sha256]));
  let iguales = 0;
  for (const f of man2.lista) if (porRuta[f.ruta] === f.sha256) iguales++;
  ok(iguales === man.lista.length && man2.ficheros === man.ficheros, `sha256 idéntico en ${iguales}/${man.lista.length}`);
  ok(fs.statSync(path.join(vuelta, 'vacio.json')).size === 0, 'fichero vacío sigue vacío');
  ok(fs.existsSync(path.join(vuelta, 'vacia')) && fs.statSync(path.join(vuelta, 'vacia')).isDirectory(), 'carpeta vacía restaurada');
  ok(Math.floor(fs.statSync(path.join(vuelta, 'db.json')).mtimeMs / 1000) === 1700000000, 'mtime conservado');
  ok(!fs.existsSync(path.join(vuelta, '.hibernacion-restaurar-' + r.marca)), 'puesta en escena recogida');

  console.log('4. seguridad de rutas');
  ok(!H.esRutaSegura('../etc/passwd') && !H.esRutaSegura('/etc/passwd') && !H.esRutaSegura('a/../../b') && H.esRutaSegura('clubs/a.json'), 'rechaza .. y absolutas');
  // tar artesanal con una entrada maliciosa: debe saltarse sin tocar fuera
  const malo = Buffer.concat([H.cabecera({ name: '../fuera.txt', size: 3, mtime: 0, type: '0' }), Buffer.from('mal'), Buffer.alloc(509, 0),
    H.cabecera({ name: 'bien.txt', size: 4, mtime: 0, type: '0' }), Buffer.from('bien'), Buffer.alloc(508, 0), Buffer.alloc(1024, 0)]);
  const dest2 = path.join(raiz, 'malo'); fs.mkdirSync(dest2);
  const { Readable } = require('stream');
  const r2 = await H.desempaquetar(Readable.from([malo]), dest2);
  ok(r2.saltados.length === 1 && r2.ficheros === 1 && !fs.existsSync(path.join(raiz, 'fuera.txt')) && fs.readFileSync(path.join(dest2, 'bien.txt'), 'utf8') === 'bien', 'entrada con .. saltada, la buena restaurada');

  console.log('5. tar corrupto, truncado y pax');
  let err = null;
  try { await H.desempaquetar(Readable.from([Buffer.from('esto no es un tar'.repeat(40))]), path.join(raiz, 'corrupto')); } catch (e) { err = e; }
  ok(err && /inválida/.test(err.message), 'rechaza un tar corrupto con error claro');
  err = null;
  const trunc = Buffer.concat([H.cabecera({ name: 'a.txt', size: 2000, mtime: 0, type: '0' }), Buffer.alloc(600, 65)]);
  try { await H.desempaquetar(Readable.from([trunc]), path.join(raiz, 'trunc')); } catch (e) { err = e; }
  ok(err && /truncado|cortada/.test(err.message), 'rechaza un tar cortado a mitad de fichero');
  err = null;
  const pax = Buffer.concat([H.cabecera({ name: 'PaxHeaders/x', size: 0, mtime: 0, type: 'x' }), Buffer.alloc(1024, 0)]);
  try { await H.desempaquetar(Readable.from([pax]), path.join(raiz, 'pax')); } catch (e) { err = e; }
  ok(err && /pax/.test(err.message), 'rechaza cabeceras pax con mensaje claro');
  err = null;
  try { H.cabecera({ name: 'x', size: 8 ** 11, mtime: 0, type: '0' }); } catch (e) { err = e; }
  ok(err && /desbordado/.test(err.message), 'un tamaño que no cabe en el campo no se recorta en silencio');

  console.log('6. tar por partes (&solo=) conserva el prefijo de la carpeta');
  const tgzSolo = path.join(raiz, 'solo-clubs.tar.gz');
  await new Promise((res, rej) => H.streamTarGz(base, { solo: 'clubs' }).pipe(fs.createWriteStream(tgzSolo)).on('finish', res).on('error', rej));
  const dest3 = path.join(raiz, 'solo'); fs.mkdirSync(dest3);
  const r3 = await H.restaurar(fs.createReadStream(tgzSolo), dest3);
  ok(r3.restaurados.length === 1 && r3.restaurados[0] === 'clubs' && fs.existsSync(path.join(dest3, 'clubs', 'results-premier.json')) && !fs.existsSync(path.join(dest3, 'db.json')), 'solo clubs/ viaja, y aterriza dentro de clubs/');
  const manSolo = await H.manifiesto(base, { solo: 'clubs' });
  ok(manSolo.ficheros === 3 && Object.keys(manSolo.por_carpeta).join() === 'clubs', 'manifiesto con solo=clubs');

  console.log('7. restauración que falla a mitad se deshace');
  const dest4 = path.join(raiz, 'rollback'); fs.mkdirSync(dest4);
  fs.writeFileSync(path.join(dest4, 'db.json'), '{"viejo":true}');
  fs.writeFileSync(path.join(dest4, 'real-ledger.json'), 'viejo');
  fs.writeFileSync(path.join(dest4, 'clubs'), 'soy un fichero, no una carpeta');
  err = null;
  // el gancho de test hace fallar el cambio al llegar a 'real-ledger.json' (db.json y backups ya movidos)
  try { await H.restaurar(fs.createReadStream(tgz), dest4, { _fallarEn: 'real-ledger.json' }); } catch (e) { err = e; }
  ok(err && err.estado && /deshecho/.test(err.message), 'error con estado y deshacer: ' + (err && err.message.slice(0, 80)));
  ok(fs.readFileSync(path.join(dest4, 'db.json'), 'utf8') === '{"viejo":true}' && fs.readFileSync(path.join(dest4, 'real-ledger.json'), 'utf8') === 'viejo' && fs.readFileSync(path.join(dest4, 'clubs'), 'utf8').startsWith('soy un fichero'), 'el disco queda exactamente como estaba');
  ok(!fs.readdirSync(dest4).some((n) => n.startsWith('.hibernacion-previo')), 'sin carpeta previo huérfana');

  fs.rmSync(raiz, { recursive: true, force: true });
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
  process.exit(fallos ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
