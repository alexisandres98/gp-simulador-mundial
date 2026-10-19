'use strict';
// ═══ HIBERNACIÓN (19-oct-2026, orden de Alexis) ══════════════════════════════════════════════════════════
// «Ponerla a hibernar»: apagar todo lo que cuesta, guardar absolutamente todo y que en unos meses sea poner
// una tarjeta y levantarla donde se dejó. Esta pieza es la que guarda y la que devuelve el DISCO PERSISTENTE
// entero (todo lo que cuelga de dirname(DB_FILE): db.json, real-ledger.json, clubs/, esports/, propfirm/,
// nfl/, amfoot/, tennis/, darts/, tt/, hoops/, f1/, lol-raw/, tt-raw/, implicito/, shadow/, backups/…) como UN
// SOLO fichero .tar.gz, sin dependencias npm, con un manifiesto (ruta, bytes, mtime, sha256) para comprobar
// que lo que se bajó es lo que había. La vuelta es el mismo tar subido por POST: se desempaqueta en un
// directorio de puesta en escena y se cambia de golpe, dejando lo que hubiera en `.hibernacion-previo-<ts>`.
//
// Formato: ustar (POSIX) con nombres largos en entradas GNU 'L' (LongLink); lo leen tar, bsdtar, 7-Zip y
// Windows. No hay enlaces simbólicos en el disco de Render; si aparece uno se salta y se anota.
//
// Nada de aquí toca db en memoria, la sombra, el ejecutor ni ninguna regla: solo bytes del disco.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');

const BLOCK = 512;
const STAGING_RE = /^\.hibernacion-/;

// ───────────────────────────── utilidades ─────────────────────────────
function esRutaSegura(rel) {
  if (!rel || typeof rel !== 'string') return false;
  if (rel.includes('\0')) return false;
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  const partes = norm.split('/').filter(Boolean);
  if (!partes.length) return false;
  for (const p of partes) { if (p === '..' || p === '.') return false; }
  return true;
}

function sha256Fichero(ruta) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(ruta).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

// Recorre `base` y devuelve [{ rel, abs, bytes, mtime, dir }] ordenado, saltando las carpetas de puesta en
// escena de una restauración anterior y, si se pide, las de primer nivel en `excluir`.
function recorrer(base, { excluir = [] } = {}) {
  const out = [];
  const ex = new Set(excluir.map((s) => String(s).replace(/\/+$/, '')));
  const walk = (dir, rel) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (!rel && (STAGING_RE.test(e.name) || ex.has(e.name))) continue;
      if (e.isSymbolicLink()) { out.push({ rel: r, abs: path.join(dir, e.name), symlink: true }); continue; }
      if (e.isDirectory()) { out.push({ rel: r, abs: path.join(dir, e.name), dir: true }); walk(path.join(dir, e.name), r); continue; }
      if (!e.isFile()) continue;
      let st; try { st = fs.statSync(path.join(dir, e.name)); } catch { continue; }
      out.push({ rel: r, abs: path.join(dir, e.name), bytes: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
    }
  };
  walk(base, '');
  return out;
}

async function manifiesto(base, { excluir = [], sha = false } = {}) {
  const lista = recorrer(base, { excluir });
  const ficheros = [];
  let total = 0, carpetas = 0, saltados = [];
  for (const e of lista) {
    if (e.symlink) { saltados.push(e.rel); continue; }
    if (e.dir) { carpetas++; continue; }
    total += e.bytes;
    const row = { ruta: e.rel, bytes: e.bytes, mtime: new Date(e.mtime * 1000).toISOString() };
    if (sha) { try { row.sha256 = await sha256Fichero(e.abs); } catch (err) { row.error = err.message; } }
    ficheros.push(row);
  }
  const porCarpeta = {};
  for (const f of ficheros) { const k = f.ruta.includes('/') ? f.ruta.split('/')[0] : '.'; porCarpeta[k] = porCarpeta[k] || { ficheros: 0, bytes: 0 }; porCarpeta[k].ficheros++; porCarpeta[k].bytes += f.bytes; }
  return { base, generado: new Date().toISOString(), ficheros: ficheros.length, carpetas, bytes: total, mb: +(total / 1048576).toFixed(1), excluidas: excluir, saltados, por_carpeta: porCarpeta, lista: ficheros };
}

// ───────────────────────────── escritura tar ─────────────────────────────
function octal(n, len) { // campo numérico ustar: len-1 dígitos octales + NUL
  const s = Math.max(0, Math.floor(n)).toString(8);
  return s.padStart(len - 1, '0').slice(-(len - 1)) + '\0';
}
function cabecera({ name, size, mtime, type, prefix = '' }) {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, 'utf8');
  h.write(type === '5' ? octal(0o755, 8) : octal(0o644, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(mtime, 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii'); // checksum en blanco para calcularlo
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write('gp', 265, 32, 'ascii');
  h.write('gp', 297, 32, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0; for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}
// Divide una ruta en (prefix, name) para ustar; si no cabe, devuelve null y se usa LongLink.
function partirNombre(rel) {
  const b = Buffer.byteLength(rel, 'utf8');
  if (b <= 100) return { name: rel, prefix: '' };
  const partes = rel.split('/');
  for (let i = partes.length - 1; i > 0; i--) {
    const prefix = partes.slice(0, i).join('/'), name = partes.slice(i).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  return null;
}
function* bloquesEntrada(rel, type, size, mtime) {
  const pn = partirNombre(type === '5' ? rel + '/' : rel);
  if (pn) { yield cabecera({ name: pn.name, prefix: pn.prefix, size, mtime, type }); return; }
  // GNU LongLink: entrada 'L' con el nombre completo como contenido, seguida de la cabecera real truncada
  const nombre = Buffer.from((type === '5' ? rel + '/' : rel) + '\0', 'utf8');
  yield cabecera({ name: '././@LongLink', size: nombre.length, mtime, type: 'L' });
  yield nombre; const pad = (BLOCK - (nombre.length % BLOCK)) % BLOCK; if (pad) yield Buffer.alloc(pad, 0);
  yield cabecera({ name: (type === '5' ? rel + '/' : rel).slice(0, 100), size, mtime, type });
}

// Generador asíncrono de trozos del tar (sin comprimir). `onEntrada` recibe cada fichero añadido.
async function* generarTar(base, { excluir = [], onEntrada } = {}) {
  const lista = recorrer(base, { excluir });
  for (const e of lista) {
    if (e.symlink) continue;
    if (e.dir) { for (const b of bloquesEntrada(e.rel, '5', 0, Math.floor(Date.now() / 1000))) yield b; continue; }
    // el tamaño se fija en la cabecera: si el fichero cambia mientras se lee (db.json puede), se rellena o
    // se trunca a ese tamaño para no corromper el archivo
    let st; try { st = fs.statSync(e.abs); } catch { continue; }
    const size = st.size;
    for (const b of bloquesEntrada(e.rel, '0', size, Math.floor(st.mtimeMs / 1000))) yield b;
    let enviados = 0;
    if (size > 0) {
      const rs = fs.createReadStream(e.abs);
      for await (const chunk of rs) {
        if (enviados >= size) break;
        const c = enviados + chunk.length > size ? chunk.subarray(0, size - enviados) : chunk;
        enviados += c.length; yield c;
      }
      if (enviados < size) yield Buffer.alloc(size - enviados, 0);
    }
    const pad = (BLOCK - (size % BLOCK)) % BLOCK; if (pad) yield Buffer.alloc(pad, 0);
    if (onEntrada) onEntrada({ rel: e.rel, bytes: size });
  }
  yield Buffer.alloc(BLOCK * 2, 0);
}

// Stream legible .tar.gz del disco. Úsese: streamTarGz(base, opts).pipe(res)
function streamTarGz(base, opts = {}) {
  const gz = zlib.createGzip({ level: Number(opts.nivel) || 6 });
  const src = Readable.from(generarTar(base, opts));
  src.on('error', (e) => gz.destroy(e));
  return src.pipe(gz);
}

// ───────────────────────────── lectura tar ─────────────────────────────
function leerCampo(h, off, len) { return h.subarray(off, off + len).toString('utf8').replace(/\0.*$/s, '').trim(); }
function leerOctal(h, off, len) { const s = leerCampo(h, off, len).replace(/[^0-7]/g, ''); return s ? parseInt(s, 8) : 0; }
function parsearCabecera(h) {
  let sum = 0; for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
  const chk = leerOctal(h, 148, 8);
  if (chk !== sum) return null;
  const name = leerCampo(h, 0, 100), prefix = leerCampo(h, 345, 155);
  const magic = h.subarray(257, 262).toString('ascii');
  const full = (magic === 'ustar' && prefix) ? prefix + '/' + name : name;
  return { name: full, size: leerOctal(h, 124, 12), mtime: leerOctal(h, 136, 12), type: String.fromCharCode(h[156] || 48) };
}

// Desempaqueta un stream tar (ya descomprimido) en `destino`. Devuelve {ficheros, carpetas, bytes, saltados}.
// Solo acepta rutas relativas sin '..'; ignora enlaces y tipos raros.
function desempaquetar(stream, destino) {
  return new Promise((resolve, reject) => {
    const res = { ficheros: 0, carpetas: 0, bytes: 0, saltados: [] };
    let resto = Buffer.alloc(0);
    let actual = null;      // { fd, restante, pad, rel } o { skip: n }
    let longName = null;    // nombre acumulado de una entrada 'L'
    let ceros = 0, terminado = false;
    const abrir = (ent) => {
      const rel = (longName || ent.name).replace(/\/+$/, '');
      longName = null;
      const pad = (BLOCK - (ent.size % BLOCK)) % BLOCK;
      if (ent.type === 'L') { actual = { longLink: Buffer.alloc(0), restante: ent.size, pad }; return; }
      if (!esRutaSegura(rel) || STAGING_RE.test(rel.split('/')[0])) { res.saltados.push(rel || '(vacío)'); actual = { skip: ent.size + pad }; return; }
      if (ent.type === '5') { fs.mkdirSync(path.join(destino, rel), { recursive: true }); res.carpetas++; actual = { skip: ent.size + pad }; return; }
      if (ent.type !== '0' && ent.type !== '\0' && ent.type !== '7') { res.saltados.push(rel + ' (tipo ' + ent.type + ')'); actual = { skip: ent.size + pad }; return; }
      const abs = path.join(destino, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const fd = fs.openSync(abs, 'w');
      actual = { fd, restante: ent.size, pad, rel, mtime: ent.mtime };
      res.ficheros++;
    };
    const consumir = () => {
      let off = 0;
      while (off < resto.length) {
        if (actual) {
          if (actual.skip != null) { const n = Math.min(actual.skip, resto.length - off); actual.skip -= n; off += n; if (!actual.skip) actual = null; continue; }
          if (actual.restante > 0) {
            const n = Math.min(actual.restante, resto.length - off);
            const c = resto.subarray(off, off + n);
            if (actual.longLink) actual.longLink = Buffer.concat([actual.longLink, c]);
            else { fs.writeSync(actual.fd, c); res.bytes += n; }
            actual.restante -= n; off += n; continue;
          }
          if (actual.pad > 0) { const n = Math.min(actual.pad, resto.length - off); actual.pad -= n; off += n; continue; }
          if (actual.longLink) { longName = actual.longLink.toString('utf8').replace(/\0.*$/s, ''); }
          else { fs.closeSync(actual.fd); try { fs.utimesSync(path.join(destino, actual.rel), actual.mtime || Date.now() / 1000, actual.mtime || Date.now() / 1000); } catch { /* da igual */ } }
          actual = null; continue;
        }
        if (resto.length - off < BLOCK) break;
        const h = resto.subarray(off, off + BLOCK);
        off += BLOCK;
        if (h.every((b) => b === 0)) { ceros++; if (ceros >= 2) { terminado = true; break; } continue; }
        ceros = 0;
        const ent = parsearCabecera(h);
        if (!ent) { reject(new Error('cabecera tar inválida (¿fichero corrupto o no es un tar?)')); stream.destroy(); return; }
        abrir(ent);
      }
      resto = off >= resto.length ? Buffer.alloc(0) : resto.subarray(off);
    };
    stream.on('data', (chunk) => { if (terminado) return; resto = resto.length ? Buffer.concat([resto, chunk]) : chunk; try { consumir(); } catch (e) { reject(e); stream.destroy(); } });
    stream.on('end', () => { try { if (actual && actual.fd != null) fs.closeSync(actual.fd); } catch { /* nada */ } if (!terminado && !res.ficheros && !res.carpetas) return reject(new Error('tar vacío')); resolve(res); });
    stream.on('error', reject);
  });
}

// Restauración completa: descomprime `reqStream` (gzip) en <base>/.hibernacion-restaurar-<ts>, y al acabar
// cambia de golpe: lo que había en base pasa a <base>/.hibernacion-previo-<ts>/ (salvo `backups`, que se
// conserva donde está si el tar no lo trae) y lo restaurado ocupa su sitio. No se borra nada.
async function restaurar(reqStream, base, { gzip = true } = {}) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(base, '.hibernacion-restaurar-' + ts);
  const previo = path.join(base, '.hibernacion-previo-' + ts);
  fs.mkdirSync(staging, { recursive: true });
  const src = gzip ? reqStream.pipe(zlib.createGunzip()) : reqStream;
  let r;
  try { r = await desempaquetar(src, staging); }
  catch (e) { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* nada */ } throw e; }
  const top = fs.readdirSync(staging);
  if (!top.length) { fs.rmSync(staging, { recursive: true, force: true }); throw new Error('el tar no trajo nada'); }
  fs.mkdirSync(previo, { recursive: true });
  const movidos = [], apartados = [];
  for (const name of top) {
    const dest = path.join(base, name);
    if (fs.existsSync(dest)) { fs.renameSync(dest, path.join(previo, name)); apartados.push(name); }
    fs.renameSync(path.join(staging, name), dest);
    movidos.push(name);
  }
  try { fs.rmdirSync(staging); } catch { /* quedó algo raro; se deja */ }
  return { ...r, restaurados: movidos, apartados_en: previo, apartados, marca: ts };
}

module.exports = { recorrer, manifiesto, streamTarGz, generarTar, desempaquetar, restaurar, esRutaSegura, sha256Fichero, parsearCabecera, cabecera, BLOCK };
