#!/usr/bin/env node
'use strict';
// ═══ Restaurar Postgres desde el volcado NDJSON de la hibernación ════════════════════════════════════════
//   DATABASE_URL=postgres://… node scripts/pg-restaurar.js gp-postgres-2026-10-19.ndjson.gz [--truncar] [--solo tabla,tabla]
// Requisitos: el esquema ya creado (`npm run db:migrate` contra la base nueva) y el paquete pg (ya en el repo).
//
// Cómo lo hace (ensayado el 19-oct sobre un Postgres local con el volcado real):
//   1. Reparte el volcado en un fichero temporal por tabla (el volcado viene en orden alfabético y las claves
//      foráneas exigen que los padres entren antes que los hijos).
//   2. Lee las claves foráneas del esquema y ordena las tablas por dependencias (padres primero).
//   3. Mete cada tabla en lotes de 1.000 con json_populate_recordset + ON CONFLICT DO NOTHING (se puede repetir
//      sin duplicar). Un lote que falla se reintenta fila a fila; las filas que siguen fallando (referencias a
//      sí mismas, ciclos) se guardan y se reintentan en rondas al final hasta que no haya progreso.
//   4. Pone las secuencias con setval. Las tablas que no existan en el esquema nuevo se saltan y se listan.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const args = process.argv.slice(2);
const fichero = args.find((a) => !a.startsWith('--'));
const truncar = args.includes('--truncar');
const soloI = args.indexOf('--solo'); const solo = soloI >= 0 ? String(args[soloI + 1] || '').split(',').filter(Boolean) : [];
if (!fichero || !process.env.DATABASE_URL) { console.error('uso: DATABASE_URL=… node scripts/pg-restaurar.js <volcado.ndjson.gz> [--truncar] [--solo a,b]'); process.exit(2); }
const q = (t) => '"' + String(t).replace(/"/g, '""') + '"';

(async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /sslmode=disable/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  await c.connect(); await c.query('SET statement_timeout = 0');
  const existen = new Set((await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r) => r.table_name));

  // 1. repartir por tabla
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-pg-restaurar-'));
  const src = fichero.endsWith('.gz') ? fs.createReadStream(fichero).pipe(zlib.createGunzip()) : fs.createReadStream(fichero);
  const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
  const fds = {}, enVolcado = {}, saltadas = new Set(), secuencias = []; let cabecera = null, fin = null;
  for await (const linea of rl) {
    if (!linea.trim()) continue;
    const o = JSON.parse(linea);
    if (o.tipo === 'cabecera') { cabecera = o; console.log(`volcado del ${o.generado} · ${o.tablas.length} tablas · origen ${String(o.version || '').slice(0, 40)}`); continue; }
    if (o.tipo === 'secuencia') { secuencias.push(o); continue; }
    if (o.tipo === 'fin') { fin = o; continue; }
    const t = o.t; if (solo.length && !solo.includes(t)) continue;
    if (!existen.has(t)) { saltadas.add(t); continue; }
    if (!fds[t]) fds[t] = fs.openSync(path.join(tmp, t + '.ndjson'), 'w');
    fs.writeSync(fds[t], JSON.stringify(o.r) + '\n'); enVolcado[t] = (enVolcado[t] || 0) + 1;
  }
  for (const t of Object.keys(fds)) fs.closeSync(fds[t]);
  if (!fin) console.log('⚠ el volcado no tiene línea de fin: puede estar truncado');

  // 2. orden por dependencias (padres primero); las referencias a sí misma se ignoran aquí
  const fk = await c.query(`SELECT DISTINCT tc.table_name AS hijo, ccu.table_name AS padre
    FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name <> ccu.table_name`);
  const tablas = Object.keys(fds).sort();
  const padres = {}; for (const t of tablas) padres[t] = new Set();
  for (const r of fk.rows) if (padres[r.hijo] && tablas.includes(r.padre)) padres[r.hijo].add(r.padre);
  const orden = []; const hechas = new Set();
  while (orden.length < tablas.length) {
    const listas = tablas.filter((t) => !hechas.has(t) && [...padres[t]].every((p) => hechas.has(p)));
    if (!listas.length) { for (const t of tablas) if (!hechas.has(t)) { orden.push(t); hechas.add(t); } break; } // ciclo: el resto en orden alfabético
    for (const t of listas) { orden.push(t); hechas.add(t); }
  }

  // 3. insertar
  const metidas = {}, pendientes = {};
  const inserta = async (t, filas) => { const r = await c.query(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(NULL::${q(t)}, $1::json) ON CONFLICT DO NOTHING`, [JSON.stringify(filas)]); return r.rowCount; };
  const lote = async (t, filas) => {
    try { metidas[t] = (metidas[t] || 0) + await inserta(t, filas); return; } catch { /* fila a fila */ }
    for (const f of filas) { try { metidas[t] = (metidas[t] || 0) + await inserta(t, [f]); } catch { (pendientes[t] = pendientes[t] || []).push(f); } }
  };
  for (const t of orden) {
    if (truncar) await c.query(`TRUNCATE ${q(t)} CASCADE`);
    const rl2 = readline.createInterface({ input: fs.createReadStream(path.join(tmp, t + '.ndjson')), crlfDelay: Infinity });
    let filas = [];
    for await (const l of rl2) { if (!l) continue; filas.push(JSON.parse(l)); if (filas.length >= 1000) { await lote(t, filas); filas = []; process.stdout.write(`  ${t}: ${metidas[t] || 0}/${enVolcado[t]}\r`); } }
    if (filas.length) await lote(t, filas);
    process.stdout.write(`  ${t}: ${metidas[t] || 0}/${enVolcado[t]}${(pendientes[t] || []).length ? ' (' + pendientes[t].length + ' pendientes)' : ''}\n`);
  }
  // rondas para lo pendiente (referencias a sí misma, ciclos)
  for (let ronda = 1; ronda <= 20; ronda++) {
    const antes = Object.values(pendientes).reduce((a, b) => a + b.length, 0); if (!antes) break;
    for (const t of Object.keys(pendientes)) { const otra = pendientes[t]; pendientes[t] = []; for (const f of otra) { try { metidas[t] = (metidas[t] || 0) + await inserta(t, [f]); } catch { pendientes[t].push(f); } } }
    const despues = Object.values(pendientes).reduce((a, b) => a + b.length, 0);
    console.log(`  ronda ${ronda}: pendientes ${antes} → ${despues}`); if (despues === antes) break;
  }

  // 4. secuencias y resumen
  for (const s of secuencias) { if (s.valor == null) continue; try { await c.query(`SELECT setval($1, $2, true)`, [s.nombre, s.valor]); } catch (e) { console.log('  secuencia ' + s.nombre + ': ' + e.message); } }
  let total = 0, totalVolcado = 0, faltan = 0;
  for (const t of tablas) { total += metidas[t] || 0; totalVolcado += enVolcado[t] || 0; faltan += (pendientes[t] || []).length; }
  console.log(`\ninsertadas ${total} de ${totalVolcado} filas del volcado en ${tablas.length} tablas` + (faltan ? ` · ✗ ${faltan} filas NO entraron (listadas abajo)` : ' · todas dentro'));
  for (const t of tablas) if ((pendientes[t] || []).length) console.log(`  ✗ ${t}: ${pendientes[t].length} filas sin meter (primera: ${JSON.stringify(pendientes[t][0]).slice(0, 160)})`);
  if (saltadas.size) console.log('tablas del volcado que NO existen en el esquema nuevo (saltadas): ' + [...saltadas].join(', '));
  fs.rmSync(tmp, { recursive: true, force: true });
  await c.end();
  process.exit(faltan ? 1 : 0);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
