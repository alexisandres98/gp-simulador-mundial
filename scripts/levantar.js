#!/usr/bin/env node
'use strict';
// ═══ LEVANTAR: devolver el disco a un servicio nuevo tras la hibernación ═══════════════════════════════
// Se corre cuando el servicio nuevo de Render ya existe, con el repo desplegado, el disco montado en /data
// y la variable GP_HIBERNADO=1 puesta (así arranca quieto, sin trabajos, y acepta la restauración).
//
//   node scripts/levantar.js --carpeta gp-hibernacion-2026-10-19 --key <GP_EXPORT_KEY> [--url https://…onrender.com]
//
// Sube disco.tar.gz a POST /api/internal/hibernar?restaurar=1, espera a que el proceso vuelva, compara el
// manifiesto nuevo con el guardado y dice qué queda por hacer (quitar GP_HIBERNADO, Postgres, DNS).
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; };
const URL_BASE = String(arg('url', process.env.GP_URL || 'https://gpsimulador.com')).replace(/\/+$/, '');
const KEY = arg('key', process.env.GP_EXPORT_KEY);
const CARPETA = path.resolve(String(arg('carpeta', '.')));
if (!KEY || KEY === true) { console.error('Falta --key <GP_EXPORT_KEY> (la misma que tenía el servicio viejo, o una nueva puesta en el servicio nuevo).'); process.exit(2); }
const tgz = path.join(CARPETA, 'disco.tar.gz');
if (!fs.existsSync(tgz)) { console.error('No existe ' + tgz); process.exit(2); }
const kq = (p, extra = '') => `${URL_BASE}${p}?key=${encodeURIComponent(KEY)}${extra}`;
async function getJson(u, opts) { const r = await fetch(u, { signal: AbortSignal.timeout(120000), ...(opts || {}) }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 200)}`); return JSON.parse(t); }
const duerme = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const h = await getJson(`${URL_BASE}/api/health`);
  console.log(`servicio: ${URL_BASE} · versión ${h.version}`);
  const antes = await getJson(kq('/api/internal/hibernar'));
  if (!antes.hibernado) { console.error('⚠ El servicio NO está en GP_HIBERNADO=1. Ponlo (Environment → GP_HIBERNADO=1, deploy) y vuelve: si no, los trabajos escribirían encima de lo restaurado. Abortado.'); process.exit(3); }
  console.log(`disco actual: ${antes.ficheros} ficheros, ${antes.mb} MB (quedará apartado en .hibernacion-previo-<ts>)`);
  console.log(`subiendo ${(fs.statSync(tgz).size / 1048576).toFixed(1)} MB…`);
  const r = await fetch(kq('/api/internal/hibernar', '&restaurar=1&salir=1'), { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: fs.createReadStream(tgz), duplex: 'half', signal: AbortSignal.timeout(6 * 3600e3) });
  const t = await r.text();
  if (!r.ok) { console.error('✗ restauración rechazada: ' + t.slice(0, 500)); process.exit(1); }
  const res = JSON.parse(t);
  console.log(`restaurados ${res.ficheros} ficheros, ${(res.bytes / 1048576).toFixed(1)} MB · apartados: ${res.apartados.join(', ') || 'nada'} · ${res.nota}`);
  console.log('esperando a que el proceso vuelva…');
  let vivo = null;
  for (let i = 0; i < 60; i++) { await duerme(5000); try { vivo = await getJson(`${URL_BASE}/api/health`); break; } catch { process.stdout.write('.'); } }
  if (!vivo) { console.error('\n✗ el servicio no volvió en 5 minutos: mirar los logs en Render'); process.exit(1); }
  const despues = await getJson(kq('/api/internal/hibernar'));
  let guardado = null; try { guardado = JSON.parse(fs.readFileSync(path.join(CARPETA, 'manifiesto.json'), 'utf8')); } catch { }
  console.log(`\ndisco restaurado: ${despues.ficheros} ficheros, ${despues.mb} MB` + (guardado ? ` (guardado: ${guardado.ficheros} ficheros, ${guardado.mb} MB)` : ''));
  if (guardado && guardado.ficheros !== despues.ficheros) console.log('⚠ la cuenta de ficheros no coincide: comparar manifiesto.json con GET /api/internal/hibernar?sha=1 antes de seguir');
  console.log(`
Queda, en este orden (docs/HIBERNACION_2026-10-19.md §Levantar):
  1. Postgres: pg_restore --no-owner --no-privileges -d "<DATABASE_URL externa nueva>" postgres.dump   (o npm run db:migrate si se empieza vacía)
  2. Comprobar GET ${URL_BASE}/api/internal/hibernar?key=… → por_carpeta igual que en manifiesto.json
  3. Quitar GP_HIBERNADO del Environment y desplegar: el servicio arranca leyendo el db.json restaurado
  4. GET /api/health y /api/internal/ops?key= : usuarios, trabajos, memoria
  5. DNS en Namecheap de vuelta a Render (A @ → IP del servicio, CNAME www → <servicio>.onrender.com)`);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
