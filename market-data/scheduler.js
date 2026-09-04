// market-data/scheduler.js — planificador de ciclos de ingesta (Sprint 1).
// start/stop/runOnce/status. Intervalos por proveedor. ANTI-SOLAPE: si un ciclo tarda más que el
// intervalo, no se inicia otro idéntico (se registra como omitido). No dispersa setInterval por server.js.

'use strict';
const cfg = require('./config');
const pipeline = require('./pipeline');
const metrics = require('./metrics');
const log = require('../database/logger');

const state = { started: false, timers: {}, running: {}, lastSkip: {}, lastRunAt: {},
  memSkips: {}, memSkipsSeguidos: {}, lastMemSkip: {}, ultimoRssMb: null };

// ── FRENO DE MEMORIA ANTES DE CADA CICLO (4-sep-2026) ───────────────────────────────────────────────────
// POR QUÉ. El 4-sep a las 18:11 el contenedor murió por falta de memoria (límite 4 GiB) y Render lo
// reinició. El vigía que se instrumentó el 28-ago —puesto precisamente por "los picos de 2,5 GB que matan
// el proceso"— ya había señalado al dueño: `ingesta: ciclo con salto de memoria · provider: polymarket`.
// La curva fue de 714 MB a 3.382 MB en tres minutos, con este ciclo corriendo cada 30 s.
// No es un caso raro: 3 muertes por memoria en 36 horas.
//
// LO QUE ESTE FRENO ARREGLA Y LO QUE NO. NO arregla la fuga —eso es otra tarea, y ahora con el culpable
// señalado—. Lo que hace es convertir una MUERTE en una PASADA SALTADA: la plataforma ya tenía guardia de
// memoria, pero solo miraba los trabajos que se lanzan como proceso hijo (`opsMemOk` en server.js); las
// ingestas en línea, que corren dentro del propio proceso, no pasaban por ningún control. Justo las que
// reventaron.
//
// POR QUÉ ESTO IMPORTA MÁS QUE UN REINICIO FEO. Una muerte por memoria es un SIGKILL: sin apagado
// ordenado y sin oportunidad de guardar. Es exactamente la clase de evento que deja un fichero a medias, y
// esta misma mañana costó la base entera. Saltarse una pasada de cuotas cuesta 30 segundos de frescura.
//
// EL TECHO. 1.700 MB de RSS por defecto, sobre un límite de contenedor de 4.096. En operación normal el
// RSS ronda los 900-1.000 MB, así que este freno NO toca el funcionamiento sano: solo entra cuando la cosa
// ya va mal, y deja 2,3 GB de margen para el ciclo que esté en vuelo (que no se puede parar a mitad).
const TECHO_MB = (() => { const n = parseInt(process.env.GP_INGESTA_TECHO_MB, 10); return Number.isFinite(n) && n > 0 ? n : 1700; })();
const rssMb = () => { try { return Math.round(process.memoryUsage().rss / 1048576); } catch { return 0; } };

async function tick(provider, opts = {}) {
  if (state.running[provider]) {
    state.lastSkip[provider] = new Date().toISOString();
    metrics.record(provider, { /* overlap */ });
    log.warn('scheduler: ciclo omitido por solape', { provider });
    return { provider, skipped: 'overlap' };
  }
  // el freno va ANTES de marcar el ciclo como en curso: una pasada saltada no ocupa el hueco de la siguiente
  const rss = rssMb();
  state.ultimoRssMb = rss;
  if (rss > TECHO_MB) {
    const n = (state.memSkips[provider] = (state.memSkips[provider] || 0) + 1);
    const seg = (state.memSkipsSeguidos[provider] = (state.memSkipsSeguidos[provider] || 0) + 1);
    state.lastMemSkip[provider] = new Date().toISOString();
    // no se grita cada 30 s: la primera vez que se entra en el estado, y luego de diez en diez. Un aviso
    // repetido 120 veces por hora deja de ser un aviso y pasa a ser ruido que tapa lo que sí importa.
    if (seg === 1 || seg % 10 === 0) {
      log.warn('ingesta: ciclo SALTADO por memoria alta', { provider, rss_mb: rss, techo_mb: TECHO_MB, seguidos: seg, total: n });
    }
    metrics.record(provider, { /* memoria */ });
    return { provider, skipped: 'memoria', rss_mb: rss, techo_mb: TECHO_MB, seguidos: seg };
  }
  if (state.memSkipsSeguidos[provider]) {
    log.info('ingesta: memoria recuperada, se reanuda', { provider, rss_mb: rss, saltados_seguidos: state.memSkipsSeguidos[provider] });
    state.memSkipsSeguidos[provider] = 0;
  }
  state.running[provider] = true;
  // vigilancia de memoria (28-ago): los picos de 2.5 GB que matan el proceso llegan SIN etiqueta de trabajo.
  // Cada ciclo mide su heap antes y despues; un delta grande se loguea con su dueño y deja de ser anonimo.
  const _h0 = Math.round(process.memoryUsage().heapUsed / 1048576);
  try {
    const res = await pipeline.runProviderCycle(provider, opts);
    state.lastRunAt[provider] = new Date().toISOString();
    const _h1 = Math.round(process.memoryUsage().heapUsed / 1048576);
    if (_h1 - _h0 > 200) log.warn('ingesta: ciclo con salto de memoria', { provider, heap_antes_mb: _h0, heap_despues_mb: _h1 });
    return res;
  } catch (e) {
    log.error('scheduler: error en ciclo', { provider, error: e.message });
    return { provider, status: 'failed', error: 'cycle_error' };
  } finally {
    state.running[provider] = false;
  }
}

function start() {
  if (state.started) return { started: true, alreadyRunning: true };
  state.started = true;
  for (const p of cfg.PROVIDERS) {
    const interval = cfg.intervals[p] || 30000;
    state.timers[p] = setInterval(() => { tick(p).catch(() => {}); }, interval);
    if (state.timers[p].unref) state.timers[p].unref(); // no bloquear el cierre del proceso
  }
  log.info('scheduler: iniciado', { providers: cfg.PROVIDERS, intervals: cfg.intervals });
  return { started: true };
}

function stop() {
  for (const p of Object.keys(state.timers)) { clearInterval(state.timers[p]); delete state.timers[p]; }
  state.started = false;
  log.info('scheduler: detenido');
  return { started: false };
}

// runOnce(provider, opts) → resultado de un ciclo controlado (no inicia el scheduler permanente).
async function runOnce(provider, opts = {}) { return tick(provider, opts); }

function status() {
  return {
    started: state.started,
    providers: cfg.PROVIDERS.map(p => ({
      provider: p, running: !!state.running[p], intervalMs: cfg.intervals[p],
      lastRunAt: state.lastRunAt[p] || null, lastSkippedOverlapAt: state.lastSkip[p] || null,
      enabled: cfg.providerEnabled(p),
      // saltos por memoria: si esto sube y no baja, la fuga está ganando y la ingesta se está quedando
      // parada — que es degradado pero vivo. Un indicador que no se ve no sirve de nada.
      memSkips: state.memSkips[p] || 0,
      memSkipsSeguidos: state.memSkipsSeguidos[p] || 0,
      lastMemSkipAt: state.lastMemSkip[p] || null,
    })),
    memoria: { techo_mb: TECHO_MB, ultimo_rss_mb: state.ultimoRssMb },
  };
}

module.exports = { start, stop, runOnce, status };
