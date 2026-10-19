#!/usr/bin/env node
'use strict';
// ═══ HIBERNAR: sacar TODO de producción a una carpeta local, verificado ═════════════════════════════════
// Se corre desde un clon del repo, en el ordenador de Alexis, con Node >= 18 y sin instalar nada. Las claves
// van mejor por variables de entorno (no quedan en el historial del shell):
//
//   GP_EXPORT_KEY=… RENDER_API_KEY=… GP_ADMIN_TOKEN=… node scripts/hibernar.js --pg
//   (o con --key / --render / --token; --url https://gpsimulador.com; --out <carpeta>; --sin-extraer; --solo-disco)
//
// Qué hace, en orden, y qué deja en la carpeta de salida (CADA paso es de solo lectura y, si falla, se anota
// y se sigue con el siguiente: una descarga de una hora no se tira por un paso posterior):
//   1. health.json           versión que corre y hora
//   2. manifiesto.json       lista de TODO el disco persistente (sin sha: instantáneo) → conteos
//   3. disco.tar.gz          el disco entero (db.json, real-ledger, clubs, esports, propfirm, nfl, lol-raw…)
//   4. manifiesto-sha-*.json sha256 de todo el disco ANTES y DESPUÉS del tar; disco/ es el tar desempaquetado
//                            y comprobado fichero a fichero: un fichero vale si casa con el antes o el después
//   5. db-admin.json         db.json por la ruta de admin (si hay token): segunda copia independiente
//   6. sondas/*.json         shadow, real, vara, propfirm, polymm, puertas, ops… la foto final
//   7. render/*              (si hay RENDER_API_KEY) servicios, variables de entorno (paginadas), grupos de
//                            entorno, secret files, discos y Postgres tal como están. CONTIENE SECRETOS.
//   8. postgres.dump         (si --pg y hay pg_dump instalado) volcado de la base; si no, imprime el comando
//   9. RESUMEN.md            qué se bajó, cuánto pesa, qué cuadró y qué no
//
// TODA la carpeta es secreta (db.json lleva sesiones y correos; render/ lleva las claves): está en .gitignore
// y hay que guardarla cifrada o en un sitio privado. En Windows el chmod 600 no protege nada.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
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
const SOLO_DISCO = !!arg('solo-disco', false);

if (!KEY || KEY === true) { console.error('Falta GP_EXPORT_KEY (variable de entorno o --key). Está en Render → gp-simulador-mundial → Environment.'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const resumen = [];
const log = (s) => { console.log(s); resumen.push(s); };
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
const escribe = (nombre, obj, modo) => { const f = path.join(OUT, nombre); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); if (modo) { try { fs.chmodSync(f, modo); } catch { /* Windows */ } } return f; };
const enmascara = (u) => String(u).replace(/key=[^&]+/g, 'key=…').replace(/:\/\/([^:]+):[^@]+@/, '://$1:…@');
async function getJson(u, { headers = {}, timeoutMs = 120000 } = {}) {
  const r = await fetch(u, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${enmascara(u)}: ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { throw new Error('respuesta no JSON de ' + enmascara(u)); }
}
const HB = (extra = '') => `${URL_BASE}/api/internal/hibernar?${extra}`;
const HBH = { Authorization: 'Bearer ' + KEY }; // la clave de hibernar va por cabecera: no queda en los logs HTTP
const kq = (p, extra = '') => `${URL_BASE}${p}?key=${encodeURIComponent(KEY)}${extra}`;
let ok = { disco: null, sondas: null, render: null, pg: null };
const paso = async (n, fn) => { try { await fn(); } catch (e) { log(`${n}. ✗ ${e.message}`); } };

(async () => {
  log(`# Hibernación de GP Simulador — ${new Date().toISOString()}\n\nOrigen: ${URL_BASE}\nCarpeta: ${OUT}\n`);
  let health = null, man = null, hibernado = false;

  await paso(1, async () => {
    health = await getJson(`${URL_BASE}/api/health`);
    escribe('health.json', health);
    log(`1. health: ${health.status}, versión ${health.version} (${health.timestamp})`);
  });

  await paso(2, async () => {
    man = await getJson(HB(), { headers: HBH, timeoutMs: 20 * 60e3 });
    hibernado = !!man.hibernado;
    escribe('manifiesto.json', man);
    log(`2. manifiesto: ${man.ficheros} ficheros · ${man.carpetas} carpetas · ${man.mb} MB · servicio ${hibernado ? 'EN PAUSA (GP_HIBERNADO=1)' : 'vivo'} · db: ${man.db_file}`);
    for (const [k, v] of Object.entries(man.por_carpeta || {})) log(`   - ${k}: ${v.ficheros} ficheros, ${mb(v.bytes)}`);
    if (man.saltados && man.saltados.length) log(`   ⚠ saltados (enlaces): ${man.saltados.join(', ')}`);
  });
  if (!man) { log('\nSin manifiesto no se puede seguir: ¿clave correcta? ¿servicio vivo?'); escribe('RESUMEN.md', resumen.join('\n') + '\n'); process.exit(1); }

  const tgz = path.join(OUT, 'disco.tar.gz');
  let antes = null, despues = null, bajado = false;
  await paso(3, async () => {
    log('3. sha256 de todo el disco ANTES de bajarlo (tarda minutos; el servidor manda latidos)…');
    antes = await getJson(HB('sha=1'), { headers: HBH, timeoutMs: 3 * 3600e3 });
    escribe('manifiesto-sha-antes.json', antes);
    log(`   bajando el disco entero a ${tgz}…`);
    const r = await fetch(HB('tar=1'), { headers: HBH, signal: AbortSignal.timeout(12 * 3600e3) });
    if (!r.ok || !r.body) throw new Error('tar: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    let bajados = 0, ultimo = 0;
    const cuenta = new Transform({ transform(c, e, cb) { bajados += c.length; if (bajados - ultimo > 50 * 1048576) { ultimo = bajados; process.stdout.write(`   … ${mb(bajados)}\r`); } cb(null, c); } });
    await pipeline(Readable.fromWeb(r.body), cuenta, fs.createWriteStream(tgz));
    bajado = true;
    log(`   descargado: ${mb(bajados)} comprimidos`);
    try { execFileSync('gzip', ['-t', tgz], { stdio: 'ignore' }); log('   gzip -t: íntegro'); } catch { log('   (gzip no disponible para comprobar; se comprueba al desempaquetar)'); }
    log('   sha256 de todo el disco DESPUÉS de bajarlo…');
    despues = await getJson(HB('sha=1'), { headers: HBH, timeoutMs: 3 * 3600e3 });
    escribe('manifiesto-sha-despues.json', despues);
  });

  await paso(4, async () => {
    if (!bajado) { log('4. (sin tar bajado, no hay nada que comprobar)'); return; }
    if (SIN_EXTRAER) { log('4. (--sin-extraer: el tar queda sin comprobar fichero a fichero; en Windows abrirlo con 7-Zip o WSL)'); ok.disco = 'bajado sin verificar'; return; }
    const dir = path.join(OUT, 'disco');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    log('4. desempaquetando y comprobando sha256 fichero a fichero…');
    const r = await H.desempaquetar(fs.createReadStream(tgz).pipe(zlib.createGunzip()), dir);
    const local = await H.manifiesto(dir, { sha: true });
    escribe('manifiesto-local.json', local);
    const A = Object.fromEntries(((antes && antes.lista) || []).map((f) => [f.ruta, f]));
    const D = Object.fromEntries(((despues && despues.lista) || []).map((f) => [f.ruta, f]));
    const L = Object.fromEntries(local.lista.map((f) => [f.ruta, f]));
    const rutas = new Set([...Object.keys(A), ...Object.keys(D)]);
    const faltan = [], cambiaron = [], sinSha = [], nocuadran = [];
    let iguales = 0;
    for (const ruta of rutas) {
      const l = L[ruta]; if (!l) { if (D[ruta]) faltan.push(ruta); continue; } // si solo estaba en 'antes' y ya no existe, no falta
      const a = A[ruta] && A[ruta].sha256, d = D[ruta] && D[ruta].sha256;
      if ((A[ruta] && A[ruta].error) || (D[ruta] && D[ruta].error)) { sinSha.push(ruta); continue; }
      if (l.sha256 === a || l.sha256 === d) { iguales++; if (a !== d) cambiaron.push(ruta); }
      else nocuadran.push(`${ruta} (remoto ${(D[ruta] || A[ruta] || {}).bytes} B, local ${l.bytes} B)`);
    }
    log(`   ${r.ficheros} ficheros, ${mb(r.bytes)} · iguales al antes o al después: ${iguales}/${rutas.size}`);
    if (cambiaron.length) log(`   ⚠ cambiaron mientras se bajaba (esperado con el servicio vivo; el tar lleva una de las dos versiones): ${cambiaron.length} → ${cambiaron.slice(0, 8).join(', ')}${cambiaron.length > 8 ? '…' : ''}`);
    if (sinSha.length) log(`   ⚠ sin sha remoto (error al hashear en el servidor): ${sinSha.length}`);
    if (faltan.length) log(`   ✗ FALTAN en el tar: ${faltan.length} → ${faltan.slice(0, 10).join(', ')}${faltan.length > 10 ? '…' : ''}`);
    if (nocuadran.length) log(`   ✗ NO CUADRAN con ninguna versión: ${nocuadran.length} → ${nocuadran.slice(0, 10).join(', ')}`);
    ok.disco = (!faltan.length && !nocuadran.length) ? (cambiaron.length ? 'VERIFICADO (con ficheros vivos que cambiaron durante la bajada)' : 'VERIFICADO fichero a fichero') : 'CON DIFERENCIAS';
    try { const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); log(`   db.json: ${Object.keys(db.users || {}).length} usuarios · sombra ${db.shadow && db.shadow.bets ? db.shadow.bets.length : '?'} apuestas · grants ${Object.keys(db.premiumGrants || {}).length}`); } catch (e) { log('   ✗ db.json no se pudo leer: ' + e.message); ok.disco = 'CON DIFERENCIAS'; }
    try { const rl = JSON.parse(fs.readFileSync(path.join(dir, 'real-ledger.json'), 'utf8')); log(`   real-ledger.json: ${(rl.bets || []).length} filas`); } catch { log('   (real-ledger.json no está en el disco)'); }
  });

  if (SOLO_DISCO) log('5-6. (--solo-disco: se saltan la copia de admin y las sondas)');
  else {
    await paso(5, async () => {
      if (!TOKEN || TOKEN === true) { log('5. (sin GP_ADMIN_TOKEN/--token: no se baja db.json por la ruta de admin; el del disco ya está en disco/db.json)'); return; }
      const r = await fetch(`${URL_BASE}/api/admin/backup`, { headers: { Authorization: 'Bearer ' + TOKEN }, signal: AbortSignal.timeout(600000) });
      if (!r.ok) throw new Error('/api/admin/backup ' + r.status + ' ' + (await r.text()).slice(0, 120) + ' (el token wc_token se copia de la consola del navegador con sesión de admin)');
      const txt = await r.text(); escribe('db-admin.json', txt);
      let n = '?'; try { n = Object.keys(JSON.parse(txt).users || {}).length; } catch { }
      log(`5. db-admin.json: ${mb(txt.length)}, ${n} usuarios (copia por /api/admin/backup)`);
    });
    await paso(6, async () => {
      const sondas = ['shadow', 'real', 'vara', 'parada', 'puertas', 'propfirm', 'polymm', 'encogimiento', 'ops', 'llm', 'odds-gate', 'censo-tarjetas', 'cards-validation', 'esports', 'nfl', 'darts', 'tt', 'implicito', 'affiliates', 'fisicas', 'real-tt', 'real-amfoot', 'relay'];
      const errores = []; let okS = 0;
      for (const s of sondas) { try { escribe(`sondas/${s}.json`, await getJson(kq('/api/internal/' + s))); okS++; } catch (e) { errores.push(s + ': ' + e.message); } }
      for (const [n, q] of [['picks-export-shadow', '&shadow=1'], ['picks-export-real', '&real=1'], ['picks-export-poly1', '&poly=1'], ['picks-export-poly2', '&poly=2']]) { try { escribe(`sondas/${n}.json`, await getJson(kq('/api/internal/picks-export', q), { timeoutMs: 600000 })); okS++; } catch (e) { errores.push(n + ': ' + e.message); } }
      if (errores.length) escribe('sondas/_errores.txt', errores.join('\n') + '\n');
      ok.sondas = `${okS} guardadas, ${errores.length} fallaron`;
      log(`6. sondas: ${okS} guardadas en sondas/${errores.length ? ` · ${errores.length} fallaron (sondas/_errores.txt)` : ''}`);
    });
  }

  let pgConn = null;
  await paso(7, async () => {
    if (!RENDER || RENDER === true) { log('7. (sin RENDER_API_KEY/--render: no se capturan servicios ni variables de entorno; hacerlo a mano desde el dashboard ANTES de borrar nada)'); return; }
    const rh = { Authorization: 'Bearer ' + RENDER, Accept: 'application/json' };
    // la API de Render pagina a 100 como máximo, con cursor; nada se traga en silencio
    const pagina = async (base) => { let out = [], cursor = null; for (let i = 0; i < 50; i++) { const u = base + (base.includes('?') ? '&' : '?') + 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''); const j = await getJson(u, { headers: rh }); const arr = Array.isArray(j) ? j : []; out = out.concat(arr); if (arr.length < 100) break; cursor = arr[arr.length - 1].cursor; if (!cursor) break; } return out; };
    const servicios = await pagina('https://api.render.com/v1/services');
    escribe('render/servicios.json', servicios, 0o600);
    const fallos = [];
    for (const it of servicios) {
      const s = it.service || it; const id = s.id; if (!id) continue;
      const det = await getJson(`https://api.render.com/v1/services/${id}`, { headers: rh }).catch((e) => ({ error: e.message }));
      let env = null, secretos = null;
      try { env = await pagina(`https://api.render.com/v1/services/${id}/env-vars`); } catch (e) { fallos.push(`${s.name}: env-vars ${e.message}`); }
      try { secretos = await pagina(`https://api.render.com/v1/services/${id}/secret-files`); } catch (e) { secretos = { error: e.message }; }
      escribe(`render/servicio-${s.name || id}.json`, { servicio: det, env_vars: env, secret_files: secretos }, 0o600);
      if (env) { const lineas = env.map((e) => { const v = e.envVar || e; return `${v.key}=${v.value == null ? '' : v.value}`; }); escribe(`render/env-${s.name || id}.env`, lineas.join('\n') + '\n', 0o600); log(`7. Render · ${s.name || id} (${s.type || '?'}${det.suspended ? ', ' + det.suspended : ''}): ${lineas.length} variables · secret files: ${Array.isArray(secretos) ? secretos.length : '?'}`); }
      else log(`7. Render · ${s.name || id}: ✗ variables NO capturadas`);
    }
    try { const grupos = await pagina('https://api.render.com/v1/env-groups'); const detalle = []; for (const g of grupos) { const gg = g.envGroup || g; try { detalle.push(await getJson(`https://api.render.com/v1/env-groups/${gg.id}`, { headers: rh })); } catch (e) { detalle.push({ id: gg.id, error: e.message }); } } escribe('render/env-groups.json', detalle, 0o600); log(`   grupos de entorno: ${grupos.length}`); } catch (e) { fallos.push('env-groups: ' + e.message); }
    try { escribe('render/discos.json', await pagina('https://api.render.com/v1/disks'), 0o600); } catch (e) { fallos.push('discos: ' + e.message); }
    try {
      const pgs = await pagina('https://api.render.com/v1/postgres');
      escribe('render/postgres.json', pgs, 0o600);
      for (const it of pgs) {
        const p = it.postgres || it; if (!p.id) continue;
        const ci = await getJson(`https://api.render.com/v1/postgres/${p.id}/connection-info`, { headers: rh }).catch((e) => ({ error: e.message }));
        escribe(`render/postgres-${p.name || p.id}-conexion.json`, ci, 0o600);
        if (ci && ci.externalConnectionString) pgConn = ci.externalConnectionString;
        log(`   Postgres · ${p.name || p.id} (${p.plan || '?'}, ${p.status || '?'}, versión ${p.version || '?'}): ${ci && ci.externalConnectionString ? 'conexión externa guardada' : '✗ sin connection-info: ' + (ci && ci.error)}`);
      }
    } catch (e) { fallos.push('postgres: ' + e.message); }
    if (fallos.length) { escribe('render/_errores.txt', fallos.join('\n') + '\n'); log('   ✗ Render, fallos: ' + fallos.join(' · ')); }
    ok.render = fallos.length ? 'con fallos' : 'capturado';
    log('   ⚠ render/ contiene TODAS las claves de producción: gestor de contraseñas, nunca el repo.');
  });

  await paso(8, async () => {
    const conn = pgConn || process.env.DATABASE_URL_EXTERNA || null;
    if (!conn) { log('8. Postgres: sin cadena de conexión externa (RENDER_API_KEY o DATABASE_URL_EXTERNA); hacer el pg_dump a mano desde Render → base → Connect → External Database URL, o bajar la última exportación lógica desde Render → base → Recovery.'); return; }
    const url = conn.includes('sslmode') ? conn : conn + (conn.includes('?') ? '&' : '?') + 'sslmode=require';
    const dump = path.join(OUT, 'postgres.dump');
    const cmd = `pg_dump --no-owner --no-privileges -Fc -f "${dump}" "${enmascara(url)}"`;
    if (!PG) { log('8. Postgres: correr a mano (pg_dump de la misma versión mayor que la base; si Render tiene lista de IPs permitidas, añadir la tuya):\n   ' + cmd + '\n   (la cadena completa está en render/postgres-*-conexion.json)'); return; }
    const r = spawnSync('pg_dump', ['--no-owner', '--no-privileges', '-Fc', '-f', dump, url], { stdio: 'inherit' });
    if (r.status === 0) { ok.pg = 'volcado'; log(`8. postgres.dump: ${mb(fs.statSync(dump).size)}`); }
    else throw new Error(`pg_dump falló (código ${r.status}${r.error ? ', ' + r.error.message : ''}); repetir a mano: ${cmd}`);
  });

  log(`\n## Veredicto\n- disco: ${ok.disco || 'NO bajado'}\n- sondas: ${ok.sondas || (hibernado ? 'no pedidas' : 'no pedidas')}\n- Render: ${ok.render || 'no capturado'}\n- Postgres: ${ok.pg || 'sin volcar (ver 8)'}\n- tamaño total en ${OUT}: ${mb(tam(OUT))}\n- siguiente: copiar la carpeta ENTERA a dos sitios (disco externo + nube); solo entonces cancelar servicios.`);
  escribe('RESUMEN.md', resumen.join('\n') + '\n');
  console.log(`\nRESUMEN en ${path.join(OUT, 'RESUMEN.md')}`);
  process.exit(ok.disco && /VERIFICADO/.test(ok.disco) ? 0 : 1);
})().catch((e) => { console.error('\n✗', e.message); escribe('RESUMEN.md', resumen.join('\n') + '\n\n✗ ABORTADO: ' + e.message + '\n'); process.exit(1); });

function tam(dir) { let t = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) t += tam(f); else if (e.isFile()) t += fs.statSync(f).size; } return t; }
