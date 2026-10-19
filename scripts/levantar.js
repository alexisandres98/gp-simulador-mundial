#!/usr/bin/env node
'use strict';
// ═══ LEVANTAR: devolver el disco a un servicio nuevo tras la hibernación ═══════════════════════════════
// Se corre cuando el servicio nuevo de Render ya existe, con el repo desplegado, un disco VACÍO montado en
// /data de al menos 2× el tamaño del manifiesto, y la variable GP_HIBERNADO=1 puesta (así arranca quieto,
// sin trabajos, y acepta la restauración).
//
//   GP_EXPORT_KEY=… node scripts/levantar.js --carpeta gp-hibernacion-2026-10-19 --url https://<servicio>.onrender.com
//
// Sube disco.tar.gz a POST /api/internal/hibernar?restaurar=1 (una petición larga; el servidor en pausa no la
// corta), compara el manifiesto nuevo con el guardado carpeta a carpeta y dice qué queda por hacer. NO
// reinicia el proceso: el db.json en memoria queda congelado y el deploy que quita GP_HIBERNADO arranca
// leyendo el disco restaurado. Si la subida entera es demasiado grande para tu conexión, el manual §6.2
// explica cómo restaurar carpeta a carpeta con los tars de &solo=.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const URL_BASE = String(arg('url', process.env.GP_URL || '')).replace(/\/+$/, '');
const KEY = arg('key', process.env.GP_EXPORT_KEY);
const CARPETA = path.resolve(String(arg('carpeta', '.')));
if (!URL_BASE || URL_BASE === 'true') { console.error('Falta --url https://<servicio>.onrender.com (la URL del servicio NUEVO; gpsimulador.com apunta a la página de pausa mientras dura la hibernación).'); process.exit(2); }
if (!KEY || KEY === true) { console.error('Falta GP_EXPORT_KEY (la que tiene el servicio nuevo en Environment).'); process.exit(2); }
const tgz = path.join(CARPETA, 'disco.tar.gz');
if (!fs.existsSync(tgz)) { console.error('No existe ' + tgz); process.exit(2); }
const HBH = { Authorization: 'Bearer ' + KEY };
async function getJson(u, opts) { const r = await fetch(u, { signal: AbortSignal.timeout(20 * 60e3), ...(opts || {}) }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 200)}`); try { return JSON.parse(t); } catch { throw new Error('respuesta no JSON (¿la URL es la del servicio y no la del dominio en pausa?): ' + t.slice(0, 80)); } }
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

(async () => {
  const h = await getJson(`${URL_BASE}/api/health`);
  if (h.status !== 'ok') throw new Error('health no responde ok: ' + JSON.stringify(h).slice(0, 120));
  console.log(`servicio: ${URL_BASE} · versión ${h.version}`);
  const antes = await getJson(`${URL_BASE}/api/internal/hibernar?`, { headers: HBH });
  if (!antes.hibernado) { console.error('⚠ El servicio NO está en GP_HIBERNADO=1. Ponlo (Environment → GP_HIBERNADO=1, deploy) y vuelve: si no, los trabajos escribirían encima de lo restaurado. Abortado.'); process.exit(3); }
  let guardado = null; try { guardado = JSON.parse(fs.readFileSync(path.join(CARPETA, 'manifiesto.json'), 'utf8')); } catch { }
  console.log(`disco actual: ${antes.ficheros} ficheros, ${antes.mb} MB (quedará apartado en .hibernacion-previo-<ts>)` + (guardado ? ` · guardado: ${guardado.ficheros} ficheros, ${guardado.mb} MB` : ''));
  const total = fs.statSync(tgz).size;
  console.log(`subiendo ${mb(total)}… (la respuesta llega al terminar; con 1 MB/s de subida, ${Math.ceil(total / 1048576 / 60)} min aprox.)`);
  let subidos = 0, ultimo = 0;
  const { Transform } = require('stream');
  const cuenta = new Transform({ transform(c, e, cb) { subidos += c.length; if (subidos - ultimo > 25 * 1048576) { ultimo = subidos; process.stdout.write(`   … ${mb(subidos)} de ${mb(total)}\r`); } cb(null, c); } });
  const bytes = guardado ? guardado.bytes : 0;
  const r = await fetch(`${URL_BASE}/api/internal/hibernar?restaurar=1&bytes=${bytes}`, { method: 'POST', headers: { ...HBH, 'Content-Type': 'application/gzip' }, body: fs.createReadStream(tgz).pipe(cuenta), duplex: 'half' });
  const t = await r.text();
  if (!r.ok) { console.error('\n✗ restauración rechazada: ' + t.slice(0, 600)); process.exit(1); }
  const res = JSON.parse(t);
  console.log(`\nrestaurados ${res.ficheros} ficheros, ${mb(res.bytes)} · apartados: ${res.apartados.join(', ') || 'nada'} · ${res.nota}`);
  const despues = await getJson(`${URL_BASE}/api/internal/hibernar?`, { headers: HBH });
  console.log('\ncarpeta           guardado (ficheros · MB)     restaurado (ficheros · MB)');
  const claves = new Set([...Object.keys((guardado && guardado.por_carpeta) || {}), ...Object.keys(despues.por_carpeta || {})]);
  let mal = 0;
  for (const k of [...claves].sort()) {
    if (k === 'backups') continue; // el servicio escribe una copia al arrancar: no se compara
    const g = (guardado && guardado.por_carpeta && guardado.por_carpeta[k]) || { ficheros: 0, bytes: 0 };
    const d = (despues.por_carpeta && despues.por_carpeta[k]) || { ficheros: 0, bytes: 0 };
    const igual = g.ficheros === d.ficheros && g.bytes === d.bytes; if (!igual) mal++;
    console.log(`${(igual ? '  ' : '✗ ') + k.padEnd(16)} ${String(g.ficheros).padStart(7)} · ${mb(g.bytes).padStart(10)}      ${String(d.ficheros).padStart(7)} · ${mb(d.bytes).padStart(10)}`);
  }
  console.log(mal ? `\n⚠ ${mal} carpetas no cuadran: comparar manifiesto.json con GET /api/internal/hibernar?sha=1 antes de seguir` : '\n✓ todas las carpetas cuadran con el manifiesto guardado');
  console.log(`
Queda, en este orden (docs/HIBERNACION_2026-10-19.md §6):
  1. Postgres: pg_restore --no-owner --no-privileges -d "<DATABASE_URL externa nueva>" postgres.dump   (o npm run db:migrate si se empieza vacía)
  2. Quitar GP_HIBERNADO del Environment y desplegar: el servicio arranca leyendo el db.json restaurado
  3. GET /api/health y /api/internal/ops?key= (usuarios, trabajos, memoria) y /api/internal/shadow?key= (el banco donde se dejó)
  4. DNS en Namecheap de vuelta a Render (A @ → IP del servicio, CNAME www → <servicio>.onrender.com); quitar el dominio de GitHub Pages
  5. Borrar /data/.hibernacion-previo-* cuando todo cuadre (ocupa el doble del disco mientras exista)`);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
