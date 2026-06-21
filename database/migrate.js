// database/migrate.js — runner de migraciones versionadas (Sprint 0).
// Uso:  node database/migrate.js up        (aplica pendientes)
//       node database/migrate.js status    (muestra estado)
//       node database/migrate.js rollback   (revierte la última aplicada)
//
// Convención de archivos: database/migrations/NNN_nombre.sql con dos secciones separadas por la línea
//   -- +migrate down
// Todo lo anterior a esa línea es UP; lo posterior es DOWN. Si no hay marcador, todo es UP (sin rollback).
// Cada migración se ejecuta dentro de una transacción y se registra en la tabla schema_migrations.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const client = require('./client');
const log = require('./logger');

const DIR = path.join(__dirname, 'migrations');
const DOWN_MARKER = /^--\s*\+migrate\s+down\s*$/im;

function listFiles() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
}

function parseFile(file) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const checksum = crypto.createHash('sha256').update(raw).digest('hex');
  const m = raw.split(DOWN_MARKER);
  return { version: file.split('_')[0], name: file, up: m[0], down: m[1] || null, checksum };
}

async function ensureTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function appliedSet() {
  const r = await client.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  return r.rows;
}

// Read-only: ¿existe la tabla de control? NO la crea (importante para que status()/health no
// modifiquen el esquema — ver sprint-0-1-hardening-audit A7).
async function migrationsTableExists() {
  const r = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'schema_migrations' LIMIT 1"
  );
  return r.rowCount > 0;
}

async function up() {
  requireDb();
  await ensureTable();
  const applied = new Set((await appliedSet()).map(r => r.version));
  const files = listFiles();
  let count = 0;
  for (const file of files) {
    const mig = parseFile(file);
    if (applied.has(mig.version)) continue;
    log.info('migrate: aplicando', { version: mig.version, name: mig.name });
    await client.withTransaction(async (c) => {
      await c.query(mig.up);
      await c.query('INSERT INTO schema_migrations(version, name, checksum) VALUES ($1,$2,$3)', [mig.version, mig.name, mig.checksum]);
    });
    count++;
  }
  log.info('migrate: completado', { applied: count, total: files.length });
  return { applied: count, total: files.length };
}

async function rollback() {
  requireDb();
  await ensureTable();
  const rows = await appliedSet();
  if (!rows.length) { log.info('migrate: nada que revertir'); return { rolledBack: null }; }
  const last = rows[rows.length - 1];
  const mig = parseFile(last.name);
  if (!mig.down) throw new Error(`la migración ${last.name} no define sección -- +migrate down`);
  log.info('migrate: revirtiendo', { version: last.version, name: last.name });
  await client.withTransaction(async (c) => {
    await c.query(mig.down);
    await c.query('DELETE FROM schema_migrations WHERE version = $1', [last.version]);
  });
  return { rolledBack: last.version };
}

// Devuelve el estado SIN modificar el esquema (lo usa también el health check). READ-ONLY:
// si la tabla de control no existe, lo reporta como "todo pendiente" pero NO la crea.
async function status() {
  if (!cfg.db.configured) return { configured: false, applied: [], pending: listFiles().map(f => f.split('_')[0]), upToDate: false };
  const files = listFiles();
  if (!(await migrationsTableExists())) {
    return { configured: true, applied: [], pending: files.map(f => f.split('_')[0]), upToDate: files.length === 0 };
  }
  const appliedRows = await appliedSet();
  const appliedVersions = new Set(appliedRows.map(r => r.version));
  const pending = files.filter(f => !appliedVersions.has(f.split('_')[0])).map(f => f.split('_')[0]);
  return {
    configured: true,
    applied: appliedRows.map(r => ({ version: r.version, name: r.name, applied_at: r.applied_at })),
    pending,
    upToDate: pending.length === 0,
  };
}

function requireDb() {
  if (!cfg.db.configured) {
    console.error('DATABASE_URL no está configurada. Define la variable de entorno antes de migrar.');
    process.exit(1);
  }
}

// CLI
if (require.main === module) {
  const cmd = (process.argv[2] || 'up').toLowerCase();
  (async () => {
    try {
      if (cmd === 'up' || cmd === 'migrate') { const r = await up(); console.log(`✅ Migraciones aplicadas: ${r.applied} (total ${r.total}).`); }
      else if (cmd === 'status') {
        const s = await status();
        if (!s.configured) { console.log('DATABASE_URL no configurada → la app actual funciona sin DB.'); }
        else {
          console.log(`Aplicadas: ${s.applied.length} · Pendientes: ${s.pending.length} · ${s.upToDate ? 'AL DÍA ✅' : 'HAY PENDIENTES ⚠️'}`);
          s.applied.forEach(a => console.log(`  ✓ ${a.version}  ${a.name}`));
          s.pending.forEach(v => console.log(`  · ${v}  (pendiente)`));
        }
      }
      else if (cmd === 'rollback' || cmd === 'down') { const r = await rollback(); console.log(r.rolledBack ? `✅ Revertida: ${r.rolledBack}` : 'Nada que revertir.'); }
      else { console.error(`Comando desconocido: ${cmd}. Usa: up | status | rollback`); process.exitCode = 1; }
    } catch (err) {
      console.error('❌ Error de migración:', err.message); // saneado por client.js
      process.exitCode = 1;
    } finally {
      await client.close();
    }
  })();
}

module.exports = { up, rollback, status, listFiles };
