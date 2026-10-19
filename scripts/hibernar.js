#!/usr/bin/env node
'use strict';
// ═══ HIBERNAR: sacar TODO de producción a una carpeta local, verificado ═════════════════════════════════
// Se corre desde un clon del repo, en el ordenador de Alexis, con Node >= 18 y sin instalar nada:
//
//   node scripts/hibernar.js --key <GP_EXPORT_KEY> [--token <wc_token admin>] [--render <RENDER_API_KEY>]
//                            [--url https://gpsimulador.com] [--out gp-hibernacion-2026-10-19] [--pg]
//
// Qué hace, en orden, y qué deja en la carpeta de salida:
//   1. health.json           versión que corre y hora
//   2. manifiesto.json       lista de TODO el disco persistente con sha256 (lo que hay, antes de bajarlo)
//   3. disco.tar.gz          el disco entero (db.json, real-ledger, clubs, esports, propfirm, nfl, lol-raw…)
//   4. disco/                el tar desempaquetado y COMPROBADO fichero a fichero contra el manifiesto
//   5. db-admin.json         db.json por la ruta de admin (si se da --token): segunda copia independiente
//   6. sondas/*.json         shadow, real, vara, propfirm, polymm, puertas, ops… para tener la foto final
//   7. render/*.json         (si se da --render) servicios, variables de entorno, discos y Postgres tal como
//                            están: es lo que hace falta para volver a crearlos. CONTIENE SECRETOS.
//   8. postgres.dump         (si --pg y hay pg_dump instalado) volcado de la base; si no, imprime el comando
//   9. RESUMEN.md            qué se bajó, cuánto pesa, qué cuadró y qué no
//
// Nada de esto toca producción: solo lee. Las claves no se escriben en ningún sitio salvo render/ (modo 600).

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { execFileSync, spawnSync } = require('child_process');
const H = require(path.join(__dirname, '..', 'lib', 'hibernacion'));

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const URL_BASE = String(arg('url', process.env.GP_URL || 'https://gpsimulador.com')).replace(/\/+$/, '');
const KEY = arg('key', process.env.GP_EXPORT_KEY);
const TOKEN = arg('token', process.env.GP_ADMIN_TOKEN);
const RENDER = arg('render', process.env.RENDER_API_KEY);
const OUT = path.resolve(String(arg('out', `gp-hibernacion-${new Date().toISOString().slice(0, 10)}`)));
const PG = !!arg('pg', false);
const SIN_EXTRAER = !!arg('sin-extraer', false);

if (!KEY || KEY === true) { console.error('Falta --key <GP_EXPORT_KEY> (está en Render → gp-simulador-mundial → Environment).'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const resumen = [];
const log = (s) => { console.log(s); resumen.push(s); };
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
const escribe = (nombre, obj, modo) => { const f = path.join(OUT, nombre); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); if (modo) fs.chmodSync(f, modo); return f; };
async function getJson(u, headers) { const r = await fetch(u, { headers: headers || {}, signal: AbortSignal.timeout(120000) }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${u.replace(/key=[^&]+/, 'key=…')}: ${t.slice(0, 200)}`); try { return JSON.parse(t); } catch { throw new Error('respuesta no JSON de ' + u.replace(/key=[^&]+/, 'key=…')); } }
const kq = (p, extra = '') => `${URL_BASE}${p}?key=${encodeURIComponent(KEY)}${extra}`;

(async () => {
  log(`# Hibernación de GP Simulador — ${new Date().toISOString()}\n\nOrigen: ${URL_BASE}\nCarpeta: ${OUT}\n`);

  // 1. salud
  const health = await getJson(`${URL_BASE}/api/health`);
  escribe('health.json', health);
  log(`1. health: ${health.status}, versión ${health.version} (${health.timestamp})`);

  // 2. manifiesto con sha256
  log('2. manifiesto del disco (con sha256; puede tardar un par de minutos)…');
  const man = await getJson(kq('/api/internal/hibernar', '&sha=1'));
  escribe('manifiesto.json', man);
  log(`   ${man.ficheros} ficheros · ${man.carpetas} carpetas · ${man.mb} MB · hibernado=${man.hibernado} · db: ${man.db_file}`);
  for (const [k, v] of Object.entries(man.por_carpeta || {})) log(`   - ${k}: ${v.ficheros} ficheros, ${mb(v.bytes)}`);
  if (man.saltados && man.saltados.length) log(`   ⚠ saltados (enlaces): ${man.saltados.join(', ')}`);

  // 3. el disco entero
  const tgz = path.join(OUT, 'disco.tar.gz');
  log(`3. bajando el disco entero a ${tgz}…`);
  {
    const r = await fetch(kq('/api/internal/hibernar', '&tar=1'), { signal: AbortSignal.timeout(6 * 3600e3) });
    if (!r.ok || !r.body) throw new Error('tar: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    let bajados = 0, ultimo = 0;
    const cuenta = new (require('stream').Transform)({ transform(c, e, cb) { bajados += c.length; if (bajados - ultimo > 50 * 1048576) { ultimo = bajados; process.stdout.write(`   … ${mb(bajados)}\r`); } cb(null, c); } });
    await pipeline(Readable.fromWeb(r.body), cuenta, fs.createWriteStream(tgz));
    log(`   descargado: ${mb(bajados)} comprimidos`);
  }
  // integridad gzip
  try { execFileSync('gzip', ['-t', tgz], { stdio: 'ignore' }); log('   gzip -t: íntegro'); } catch { log('   (gzip no disponible para comprobar; se comprueba al desempaquetar)'); }

  // 4. desempaquetar y comprobar sha256 contra el manifiesto remoto
  let cuadra = null;
  if (!SIN_EXTRAER) {
    const dir = path.join(OUT, 'disco');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    log('4. desempaquetando y comprobando sha256 fichero a fichero…');
    const r = await H.desempaquetar(fs.createReadStream(tgz).pipe(require('zlib').createGunzip()), dir);
    const local = await H.manifiesto(dir, { sha: true });
    const remoto = Object.fromEntries(man.lista.map((f) => [f.ruta, f]));
    const faltan = [], distintos = [], extra = [];
    for (const f of man.lista) { const l = local.lista.find((x) => x.ruta === f.ruta); if (!l) faltan.push(f.ruta); else if (l.sha256 !== f.sha256) distintos.push(f.ruta); }
    for (const l of local.lista) if (!remoto[l.ruta]) extra.push(l.ruta);
    cuadra = !faltan.length && !distintos.length;
    log(`   ${r.ficheros} ficheros, ${mb(r.bytes)} · iguales ${man.lista.length - faltan.length - distintos.length}/${man.lista.length}`);
    if (faltan.length) log(`   ✗ FALTAN ${faltan.length}: ${faltan.slice(0, 10).join(', ')}${faltan.length > 10 ? '…' : ''}`);
    if (distintos.length) log(`   ⚠ distintos ${distintos.length} (ficheros que cambiaron entre el manifiesto y la descarga; normal en db.json y almacenes vivos si el servicio no está en GP_HIBERNADO): ${distintos.slice(0, 10).join(', ')}`);
    if (extra.length) log(`   (extra en local: ${extra.length})`);
    try { const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); log(`   db.json: ${Object.keys(db.users || {}).length} usuarios · sombra ${db.shadow && db.shadow.bets ? db.shadow.bets.length : '?'} apuestas · grants ${Object.keys(db.premiumGrants || {}).length}`); } catch (e) { log('   ✗ db.json no se pudo leer: ' + e.message); cuadra = false; }
    try { const rl = JSON.parse(fs.readFileSync(path.join(dir, 'real-ledger.json'), 'utf8')); log(`   real-ledger.json: ${(rl.bets || []).length} filas`); } catch { log('   (real-ledger.json no está en el disco)'); }
    escribe('manifiesto-local.json', local);
  }

  // 5. db.json por la ruta de admin (copia independiente)
  if (TOKEN && TOKEN !== true) {
    try {
      const r = await fetch(`${URL_BASE}/api/admin/backup`, { headers: { Authorization: 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(300000) });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 120));
      const txt = await r.text(); escribe('db-admin.json', txt);
      let n = '?'; try { n = Object.keys(JSON.parse(txt).users || {}).length; } catch { }
      log(`5. db-admin.json: ${mb(txt.length)}, ${n} usuarios (copia por /api/admin/backup)`);
    } catch (e) { log('5. ✗ /api/admin/backup falló: ' + e.message + ' (el token wc_token se copia de la consola del navegador con sesión de admin)'); }
  } else log('5. (sin --token: no se baja db.json por la ruta de admin; el del disco ya está en disco/db.json)');

  // 6. sondas: la foto final en JSON
  const sondas = ['shadow', 'real', 'vara', 'parada', 'puertas', 'propfirm', 'polymm', 'encogimiento', 'ops', 'llm', 'odds-gate', 'censo-tarjetas', 'cards-validation', 'esports', 'nfl', 'darts', 'tt', 'implicito', 'affiliates', 'fisicas'];
  let okS = 0;
  for (const s of sondas) { try { const j = await getJson(kq('/api/internal/' + s)); escribe(`sondas/${s}.json`, j); okS++; } catch (e) { escribe(`sondas/${s}.error.txt`, String(e.message)); } }
  for (const [n, q] of [['picks-export-shadow', '&shadow=1'], ['picks-export-real', '&real=1'], ['picks-export-poly1', '&poly=1'], ['picks-export-poly2', '&poly=2']]) { try { escribe(`sondas/${n}.json`, await getJson(kq('/api/internal/picks-export', q))); okS++; } catch (e) { escribe(`sondas/${n}.error.txt`, String(e.message)); } }
  log(`6. sondas: ${okS} guardadas en sondas/ (las que fallaron tienen un .error.txt)`);

  // 7. Render: servicios, variables, discos, Postgres
  let pgConn = null;
  if (RENDER && RENDER !== true) {
    const rh = { Authorization: 'Bearer ' + RENDER, Accept: 'application/json' };
    try {
      const servicios = await getJson('https://api.render.com/v1/services?limit=100', rh);
      escribe('render/servicios.json', servicios, 0o600);
      for (const it of servicios) {
        const s = it.service || it; const id = s.id; if (!id) continue;
        const det = await getJson(`https://api.render.com/v1/services/${id}`, rh);
        const env = await getJson(`https://api.render.com/v1/services/${id}/env-vars?limit=200`, rh).catch(() => []);
        escribe(`render/servicio-${s.name || id}.json`, { servicio: det, env_vars: env }, 0o600);
        const lineas = (Array.isArray(env) ? env : []).map((e) => { const v = e.envVar || e; return `${v.key}=${v.value == null ? '' : v.value}`; });
        escribe(`render/env-${s.name || id}.env`, lineas.join('\n') + '\n', 0o600);
        log(`7. Render · ${s.name || id} (${s.type || '?'}, ${det.suspended || 'estado ?'}): ${lineas.length} variables guardadas`);
      }
      const discos = await getJson('https://api.render.com/v1/disks?limit=100', rh).catch(() => null);
      if (discos) escribe('render/discos.json', discos, 0o600);
      const pgs = await getJson('https://api.render.com/v1/postgres?limit=100', rh).catch(() => []);
      escribe('render/postgres.json', pgs, 0o600);
      for (const it of (Array.isArray(pgs) ? pgs : [])) {
        const p = it.postgres || it; if (!p.id) continue;
        const ci = await getJson(`https://api.render.com/v1/postgres/${p.id}/connection-info`, rh).catch(() => null);
        if (ci) { escribe(`render/postgres-${p.name || p.id}-conexion.json`, ci, 0o600); pgConn = ci.externalConnectionString || ci.external_connection_string || null; }
        log(`   Postgres · ${p.name || p.id} (${p.plan || '?'}, ${p.status || p.suspended || '?'}): ${ci ? 'conexión guardada' : 'sin connection-info'}`);
      }
      log('   ⚠ render/ contiene TODAS las claves de producción: guardar en un gestor de contraseñas, nunca en el repo.');
    } catch (e) { log('7. ✗ Render API: ' + e.message); }
  } else log('7. (sin --render: no se capturan servicios ni variables de entorno; hacerlo a mano desde el dashboard antes de borrar nada)');

  // 8. Postgres
  const conn = pgConn || process.env.DATABASE_URL_EXTERNA || null;
  if (conn) {
    const cmd = `pg_dump --no-owner --no-privileges -Fc -f "${path.join(OUT, 'postgres.dump')}" "${conn.includes('sslmode') ? conn : conn + (conn.includes('?') ? '&' : '?') + 'sslmode=require'}"`;
    if (PG) {
      const r = spawnSync('pg_dump', ['--no-owner', '--no-privileges', '-Fc', '-f', path.join(OUT, 'postgres.dump'), conn.includes('sslmode') ? conn : conn + (conn.includes('?') ? '&' : '?') + 'sslmode=require'], { stdio: 'inherit' });
      if (r.status === 0) log(`8. postgres.dump: ${mb(fs.statSync(path.join(OUT, 'postgres.dump')).size)}`); else log('8. ✗ pg_dump falló (código ' + r.status + '); comando para repetirlo a mano:\n   ' + cmd.replace(/:\/\/([^:]+):[^@]+@/, '://$1:…@'));
    } else log('8. Postgres: correr a mano (necesita pg_dump instalado):\n   ' + cmd.replace(/:\/\/([^:]+):[^@]+@/, '://$1:…@') + '\n   (la cadena completa está en render/postgres-*-conexion.json)');
  } else log('8. Postgres: sin cadena de conexión externa (dar --render o DATABASE_URL_EXTERNA); el pg_dump se hace a mano desde el dashboard (Connect → External).');

  // 9. resumen
  log(`\n## Veredicto\n- disco: ${cuadra == null ? 'bajado (sin verificar)' : cuadra ? 'VERIFICADO fichero a fichero' : 'bajado con DIFERENCIAS (ver arriba)'}\n- tamaño total en ${OUT}: ${mb(tam(OUT))}\n- siguiente: copiar la carpeta a dos sitios (disco externo + nube), y solo entonces cancelar servicios.`);
  escribe('RESUMEN.md', resumen.join('\n') + '\n');
  console.log(`\nRESUMEN en ${path.join(OUT, 'RESUMEN.md')}`);
})().catch((e) => { console.error('\n✗', e.message); escribe('RESUMEN.md', resumen.join('\n') + '\n\n✗ ABORTADO: ' + e.message + '\n'); process.exit(1); });

function tam(dir) { let t = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) t += tam(f); else if (e.isFile()) t += fs.statSync(f).size; } return t; }
