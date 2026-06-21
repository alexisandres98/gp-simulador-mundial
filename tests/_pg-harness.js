// tests/_pg-harness.js — arranque de PostgreSQL embebido para tests de integración (Sprint 1-4).
// Si DATABASE_URL ya está definido, usa esa base (externa) y no arranca nada. Si no, arranca
// embedded-postgres en un directorio temporal y define DATABASE_URL + DB_SSL=false.
// embedded-postgres se instala con `npm i --no-save embedded-postgres` y se poda después.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

async function boot() {
  if (process.env.DATABASE_URL) return { external: true, async stop() {} };
  let EmbeddedPostgres;
  try { EmbeddedPostgres = require('embedded-postgres').default; }
  catch { throw new Error('embedded-postgres no instalado. Corre: npm i --no-save embedded-postgres'); }

  const dir = path.join(os.tmpdir(), 'gpsim-pg-' + process.pid + '-' + Date.now());
  const port = 54000 + (process.pid % 1000);
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'gp', password: 'gp', port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('execdb');
  process.env.DATABASE_URL = `postgresql://gp:gp@localhost:${port}/execdb`;
  process.env.DB_SSL = 'false';
  return {
    external: false,
    async stop() {
      try { await pg.stop(); } catch { /* noop */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}

module.exports = { boot };
