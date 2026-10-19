#!/usr/bin/env node
'use strict';
// ═══ Restaurar Postgres desde el volcado NDJSON de la hibernación ════════════════════════════════════════
//   DATABASE_URL=postgres://… node scripts/pg-restaurar.js gp-postgres-2026-10-19.ndjson.gz [--truncar] [--solo tabla,tabla]
// Requisitos: el esquema ya creado (`npm run db:migrate` contra la base nueva) y el paquete pg (ya en el repo).
// Mete las filas en lotes de 1.000 con json_populate_recordset(null::tabla, …) y ON CONFLICT DO NOTHING (así se
// puede repetir sin duplicar); al final pone las secuencias con setval. Las tablas que no existan en el esquema
// nuevo se saltan y se listan.
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');

const args = process.argv.slice(2);
const fichero = args.find((a) => !a.startsWith('--'));
const truncar = args.includes('--truncar');
const soloI = args.indexOf('--solo'); const solo = soloI >= 0 ? String(args[soloI + 1] || '').split(',').filter(Boolean) : [];
if (!fichero || !process.env.DATABASE_URL) { console.error('uso: DATABASE_URL=… node scripts/pg-restaurar.js <volcado.ndjson.gz> [--truncar] [--solo a,b]'); process.exit(2); }

(async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: /sslmode=disable/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false } });
  await c.connect(); await c.query('SET statement_timeout = 0');
  const existen = new Set((await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map((r) => r.table_name));
  const src = fichero.endsWith('.gz') ? fs.createReadStream(fichero).pipe(zlib.createGunzip()) : fs.createReadStream(fichero);
  const rl = readline.createInterface({ input: src, crlfDelay: Infinity });
  const lotes = {}; const metidas = {}; const saltadas = new Set(); const truncadas = new Set(); let cabecera = null, fin = null; const secuencias = [];
  const vuelca = async (t) => {
    const filas = lotes[t]; if (!filas || !filas.length) return; lotes[t] = [];
    const q = '"' + t.replace(/"/g, '""') + '"';
    const r = await c.query(`INSERT INTO ${q} SELECT * FROM json_populate_recordset(NULL::${q}, $1::json) ON CONFLICT DO NOTHING`, [JSON.stringify(filas)]);
    metidas[t] = (metidas[t] || 0) + r.rowCount;
  };
  for await (const linea of rl) {
    if (!linea.trim()) continue;
    const o = JSON.parse(linea);
    if (o.tipo === 'cabecera') { cabecera = o; console.log(`volcado del ${o.generado} · ${o.tablas.length} tablas · origen ${String(o.version || '').slice(0, 40)}`); continue; }
    if (o.tipo === 'secuencia') { secuencias.push(o); continue; }
    if (o.tipo === 'fin') { fin = o; continue; }
    const t = o.t; if (solo.length && !solo.includes(t)) continue;
    if (!existen.has(t)) { saltadas.add(t); continue; }
    if (truncar && !truncadas.has(t)) { await c.query(`TRUNCATE "${t.replace(/"/g, '""')}" CASCADE`); truncadas.add(t); }
    (lotes[t] = lotes[t] || []).push(o.r);
    if (lotes[t].length >= 1000) { await vuelca(t); if ((metidas[t] || 0) % 100000 < 1000) process.stdout.write(`  ${t}: ${metidas[t]}\r`); }
  }
  for (const t of Object.keys(lotes)) await vuelca(t);
  for (const s of secuencias) { if (s.valor == null) continue; try { await c.query(`SELECT setval($1, $2, true)`, [s.nombre, s.valor]); } catch (e) { console.log('  secuencia ' + s.nombre + ': ' + e.message); } }
  console.log('\nfilas insertadas por tabla:');
  for (const [t, n] of Object.entries(metidas)) console.log(`  ${t}: ${n}${fin && fin.filas && fin.filas[t] != null ? ' / ' + fin.filas[t] + ' en el volcado' : ''}`);
  if (saltadas.size) console.log('tablas del volcado que NO existen en el esquema nuevo (saltadas): ' + [...saltadas].join(', '));
  if (!fin) console.log('⚠ el volcado no tiene línea de fin: puede estar truncado');
  await c.end();
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
