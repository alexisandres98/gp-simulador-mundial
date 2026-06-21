// platform-health-cli.js — imprime el snapshot de salud de la plataforma v2 por consola.
// Uso: npm run platform:health     (no expone secretos; cierra el pool al terminar)
'use strict';
const health = require('./health');
const client = require('./client');

(async () => {
  try {
    const snap = await health.snapshot();
    console.log(JSON.stringify(snap, null, 2));
    process.exitCode = snap.status === 'unavailable' ? 1 : 0;
  } catch (e) {
    console.error('health falló:', e.message);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
})();
