// database/client.js — capa centralizada de acceso a PostgreSQL (Sprint 0).
// - Un único pool (nunca una conexión por request).
// - 'pg' se carga de forma PEREZOSA: si no hay DATABASE_URL, este módulo nunca requiere 'pg',
//   así la app actual arranca aunque 'pg' no esté instalado y los flags estén en false.
// - SSL configurable, timeouts, retry controlado, cierre limpio en SIGTERM/SIGINT.
// - Errores SIN exponer secretos (vía logger con redacción). Queries SIEMPRE parametrizadas.

'use strict';

const cfg = require('./config');
const log = require('./logger');

let pool = null;            // instancia única
let pgLib = null;           // módulo 'pg' cargado perezosamente
let shutdownHooked = false;
let lastError = null;       // último error de conexión (mensaje saneado), para health

function pgAvailable() {
  if (pgLib) return true;
  try { pgLib = require('pg'); return true; }
  catch { return false; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Crea (una sola vez) el pool. Devuelve null si no hay DATABASE_URL o no está 'pg' instalado.
function getPool() {
  if (pool) return pool;
  if (!cfg.db.configured) return null;
  if (!pgAvailable()) {
    lastError = "driver 'pg' no instalado";
    log.error('db: driver pg ausente', { hint: 'npm install pg' });
    return null;
  }
  const { Pool } = pgLib;
  pool = new Pool({
    connectionString: cfg.db.url,
    ssl: cfg.db.ssl ? { rejectUnauthorized: false } : false,
    max: cfg.db.poolMax,
    connectionTimeoutMillis: cfg.db.connectionTimeoutMs,
    idleTimeoutMillis: 30_000,
    statement_timeout: cfg.db.statementTimeoutMs,
  });
  // Un error en un cliente idle no debe tumbar el proceso.
  pool.on('error', (err) => { lastError = saneError(err); log.error('db: error en cliente idle del pool', { error: lastError }); });
  hookShutdown();
  log.info('db: pool inicializado', { db: cfg.redactedDbInfo() });
  return pool;
}

// Mensaje de error saneado (sin URL/credenciales).
function saneError(err) {
  const msg = (err && err.message) || String(err);
  return msg.replace(/postgres(?:ql)?:\/\/[^\s]*/gi, '[redacted-url]');
}

// Ejecuta una query parametrizada. Lanza si falla (el llamador decide cómo manejarlo).
// Reintenta SOLO ante errores transitorios de conexión, nunca ante errores SQL deterministas.
async function query(text, params = [], { retries = 1 } = {}) {
  const p = getPool();
  if (!p) throw new Error('base de datos no configurada');
  let attempt = 0;
  for (;;) {
    try {
      return await p.query(text, params);
    } catch (err) {
      const transient = /ECONNREFUSED|ETIMEDOUT|terminat|Connection terminated|timeout|ENOTFOUND|EAI_AGAIN/i.test(err.message || '');
      lastError = saneError(err);
      if (transient && attempt < retries) {
        attempt++;
        await sleep(cfg.db.connectionTimeoutMs ? Math.min(1000, 200 * attempt) : 200);
        log.warn('db: reintento por error transitorio', { attempt, error: lastError });
        continue;
      }
      // re-lanza un error saneado para que nunca llegue una URL con credenciales al frontend
      const e = new Error(saneError(err)); e.code = err.code; throw e;
    }
  }
}

// Ejecuta fn(client) dentro de una transacción (BEGIN/COMMIT/ROLLBACK) sobre una conexión dedicada.
// Lo usa el runner de migraciones. client.query es parametrizado igual que el del pool.
async function withTransaction(fn) {
  const p = getPool();
  if (!p) throw new Error('base de datos no configurada');
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    const e = new Error(saneError(err)); e.code = err.code; throw e;
  } finally {
    c.release();
  }
}

// Sonda de salud: { configured, connected, latencyMs, error }
async function healthProbe() {
  if (!cfg.db.configured) return { configured: false, connected: false, latencyMs: null, error: null };
  const t0 = Date.now();
  try {
    await query('SELECT 1', [], { retries: 0 });
    return { configured: true, connected: true, latencyMs: Date.now() - t0, error: null };
  } catch (err) {
    return { configured: true, connected: false, latencyMs: null, error: saneError(err) };
  }
}

// Cierre limpio del pool. Idempotente.
async function close() {
  if (!pool) return;
  const p = pool; pool = null;
  try { await p.end(); log.info('db: pool cerrado limpiamente'); }
  catch (err) { log.warn('db: error al cerrar el pool', { error: saneError(err) }); }
}

// Registra el cierre limpio SOLO si llegamos a crear un pool (no afecta a la app sin DB).
function hookShutdown() {
  if (shutdownHooked) return;
  shutdownHooked = true;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      log.info('db: señal recibida, cerrando pool', { signal: sig });
      await close();
      // Re-emite la señal por defecto para no bloquear la terminación del proceso.
      process.kill(process.pid, sig);
    });
  }
}

module.exports = { query, withTransaction, getPool, healthProbe, close, isConfigured: () => cfg.db.configured, lastError: () => lastError };
