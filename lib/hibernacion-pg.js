'use strict';
// ═══ HIBERNACIÓN · Postgres (19-oct-2026) ═══════════════════════════════════════════════════════════════
// El volcado de la base cuando pg_dump no está al alcance: ni desde el sandbox (el puerto 5432 no sale) ni
// con la exportación lógica de Render (devolvió 500). Esta pieza recorre TODAS las tablas del esquema public
// con el driver pg que ya usa la plataforma y escribe un NDJSON (una fila por línea, `row_to_json`) que
// `scripts/pg-restaurar.js` vuelve a meter con `json_populate_recordset` sobre el esquema que crean las
// migraciones. Paginación por `ctid` (sin depender de claves primarias; un escaneo secuencial por rangos),
// sin timeout de sentencia en la sesión, y con las secuencias al final para `setval`.
//
// Formato, línea a línea:
//   {"tipo":"cabecera","generado":…,"version":…,"tablas":[{"nombre","columnas":[{nombre,tipo}],"filas_est"}]}
//   {"t":"<tabla>","r":{…}}                       (una por fila)
//   {"tipo":"secuencia","nombre":…,"valor":…}
//   {"tipo":"fin","filas":{"<tabla>":n,…}}
const LOTE = 20000;

async function cliente() {
  const DBC = require('../database/client');
  const pool = DBC.getPool();
  if (!pool) throw new Error('base de datos no configurada (DATABASE_URL)');
  const c = await pool.connect();
  await c.query('SET statement_timeout = 0');
  return c;
}

async function tablas(c) {
  const t = await c.query(`SELECT c.relname AS nombre, c.reltuples::bigint AS filas_est
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  const out = [];
  for (const row of t.rows) {
    const cols = await c.query(`SELECT column_name AS nombre, data_type AS tipo FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [row.nombre]);
    out.push({ nombre: row.nombre, filas_est: Number(row.filas_est), columnas: cols.rows });
  }
  return out;
}

async function secuencias(c) {
  const s = await c.query(`SELECT sequencename AS nombre, last_value AS valor FROM pg_sequences WHERE schemaname='public'`);
  return s.rows.map((r) => ({ nombre: r.nombre, valor: r.valor == null ? null : Number(r.valor) }));
}

// Generador de líneas NDJSON. `solo` = lista de tablas (vacía = todas). `onProgreso(tabla, filas)`.
async function* volcar({ solo = [], onProgreso } = {}) {
  const c = await cliente();
  try {
    const todas = await tablas(c);
    const elegidas = solo.length ? todas.filter((t) => solo.includes(t.nombre)) : todas;
    let v = null; try { v = (await c.query('SELECT version()')).rows[0].version; } catch { /* nada */ }
    yield JSON.stringify({ tipo: 'cabecera', generado: new Date().toISOString(), version: v, tablas: elegidas }) + '\n';
    const filas = {};
    for (const t of elegidas) {
      const q = '"' + t.nombre.replace(/"/g, '""') + '"';
      let ultimo = '(0,0)', n = 0;
      for (;;) {
        const r = await c.query(`SELECT ctid::text AS __ctid, row_to_json(t) AS r FROM ${q} t WHERE ctid > $1::tid ORDER BY ctid LIMIT ${LOTE}`, [ultimo]);
        if (!r.rows.length) break;
        let buf = '';
        for (const row of r.rows) { buf += JSON.stringify({ t: t.nombre, r: row.r }) + '\n'; }
        yield buf;
        n += r.rows.length; ultimo = r.rows[r.rows.length - 1].__ctid;
        if (onProgreso) onProgreso(t.nombre, n);
        if (r.rows.length < LOTE) break;
      }
      filas[t.nombre] = n;
    }
    for (const s of await secuencias(c)) yield JSON.stringify({ tipo: 'secuencia', ...s }) + '\n';
    yield JSON.stringify({ tipo: 'fin', filas, generado: new Date().toISOString() }) + '\n';
  } finally { c.release(); }
}

async function resumen() {
  const c = await cliente();
  try { return { tablas: await tablas(c), secuencias: await secuencias(c) }; } finally { c.release(); }
}

module.exports = { volcar, resumen, LOTE };
