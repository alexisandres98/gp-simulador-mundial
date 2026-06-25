// sportsbook-providers/ingestion.js — Sprint 8A §6-10. Orquesta un ciclo de ingesta de cuotas 1X2 prematch:
// descubre competiciones (Mundial) → eventos → cuotas h2h → valida → persiste. Respeta cuota, reserva,
// circuit breaker y el límite de requests por ciclo. INERTE sin flags/key. No expone la API key.
'use strict';
const cfg = require('./config');
const { createProvider } = require('./theOddsApiProvider');
const normalizer = require('./normalizer');
const quotaGuard = require('./quotaGuard');
const repo = require('./repositories');
const persistence = require('./persistence');
const db = require('../database/client');
const log = require('../database/logger');

// aborto cooperativo (Bloque C): el orquestador pasa un AbortSignal; lo chequeamos en los límites del loop
// (entre competiciones y antes de persistir) para detener la ejecución de verdad tras un timeout.
function throwIfAborted(signal) {
  if (signal && signal.aborted) { const e = new Error('cancelled'); e.code = 'cancelled'; throw e; }
}

// runOnce({ provider?, now?, signal? }) — un ciclo. provider inyectable para tests (sin red/key).
async function runOnce({ provider = null, now = null, signal = null } = {}) {
  const flags = cfg.flags;
  if (!flags.enabled) return { status: 'disabled' };
  const prov = provider || createProvider();
  if (!provider && !flags.hasKey) return { status: 'no_key', reason: 'no_authorized_sportsbook_provider_key' };

  const providerName = cfg.params.providerName;
  const write = flags.write && db.isConfigured();
  const nowMs = now != null ? +new Date(now) : Date.now();

  // circuit breaker: ¿podemos llamar?
  let state = null;
  if (write) { try { state = await repo.getState(providerName); } catch { /* sin estado aún */ } }
  const gate = quotaGuard.canCall(state, nowMs);
  if (!gate.allowed) return { status: 'skipped', reason: gate.reason, circuit: gate.circuit };

  const catalog = write ? await repo.loadSourceCatalog(providerName).catch(() => ({})) : {};
  let requests = 0, lastQuota = null, lastError = null;
  const summary = { status: 'ok', events: 0, books_complete: 0, books_incomplete: 0, quotes: 0, rejected: 0, requests: 0, competitions: 0,
                    inserted: 0, updated: 0, unchanged: 0, rejected_rows: 0, history_written: 0 };
  let runId = null, hb = null;

  try {
    if (write) {
      const r = await repo.startRun({ provider: providerName, regions: cfg.params.regions });
      runId = r.id;
      // heartbeat del run (Bloque D): mantiene heartbeat_at fresco para que la reconciliación no lo marque huérfano
      hb = setInterval(() => { repo.heartbeatRun(runId).catch(() => {}); }, 10000);
      if (hb.unref) hb.unref();
    }

    const comps = await prov.discoverCompetitions();         // gratis (no cuenta cuota)
    summary.competitions = comps.length;
    // capabilities (Bloque E): saltar sport keys ya marcadas incompatibles (sin h2h) → no se reconsultan.
    const caps = write ? await repo.loadCapabilities(providerName).catch(() => ({})) : {};
    summary.skipped_incompatible = 0;
    for (const sport of comps) {
      throwIfAborted(signal);  // cancelación cooperativa entre competiciones
      if (caps[sport.key] && caps[sport.key].is_active === false) { summary.skipped_incompatible++; continue; }
      if (requests >= cfg.params.maxRequestsPerRun) { summary.status = 'partial'; summary.reason = 'max_requests_per_run'; break; }
      // cuota crítica → detener ingesta (§8)
      if (lastQuota && quotaGuard.quotaCritical(lastQuota.remaining, lastQuota.used)) { summary.status = 'partial'; summary.reason = 'quota_reserve'; break; }
      let res;
      try { res = await prov.fetchQuotes(sport.key, {}); requests++; }
      catch (e) {
        // errores GLOBALES (auth/cuota agotada) → detener todo.
        if (/auth|quota_exhausted/i.test(e.code || '')) { lastError = e; break; }
        // sport key incompatible (bad_request / sin h2h) → DESACTIVARLA en el catálogo (no es un error de run;
        // deja de reconsultarse y un ciclo normal puede terminar 'success' en vez de 'partial' perpetuo).
        if (/bad_request|no_h2h|unknown_sport|invalid_market|unprocessable|422|400/i.test(e.code || '')) {
          if (write) { try { await repo.recordCapability(providerName, sport.key, { sportTitle: sport.title, sportGroup: sport.group, ok: false, status: 'no_h2h', errorCode: e.code, reason: 'sport key sin mercado h2h', disable: true }); } catch { /* noop */ } }
          summary.disabled_sport_keys = (summary.disabled_sport_keys || 0) + 1;
          if (e.quota) lastQuota = e.quota;
          continue;
        }
        // otro error transitorio de UNA competición → registrar y seguir (resiliencia §22).
        lastError = e;
        summary.competition_errors = (summary.competition_errors || 0) + 1;
        if (e.quota) lastQuota = e.quota;
        continue;
      }
      // éxito: confirmar capability h2h (resetea contador de errores)
      if (write) { try { await repo.recordCapability(providerName, sport.key, { sportTitle: sport.title, sportGroup: sport.group, ok: true, status: 'ok' }); } catch { /* noop */ } }
      lastQuota = res.quota || lastQuota;

      const rows = [];
      for (const ev of (res.events || [])) {
        summary.events++;
        const { sets, rejected } = normalizer.buildSetsForEvent(prov.normalizeEvent ? { ...ev } : ev, { catalog, now: nowMs, dataProvider: providerName });
        summary.books_complete += sets.length;
        summary.books_incomplete += rejected.length;
        summary.rejected += rejected.length;
        rows.push(...normalizer.setsToQuoteRows(sets, runId));
      }
      if (write && rows.length) {
        // Bloque A: persistencia BATCH en current/history (sin N+1, idempotente por identidad natural).
        const pm = await persistence.persistCurrentBatch(rows, runId);
        summary.inserted += pm.inserted; summary.updated += pm.updated; summary.unchanged += pm.unchanged;
        summary.rejected_rows += pm.rejected; summary.history_written += pm.history_written;
        summary.quotes += pm.inserted + pm.updated;  // "quotes" = filas con cambio material persistido
        // raw legacy (snapshots completos) queda DESACTIVADO por defecto: era la causa del bloat (R2).
        if (cfg.bool(process.env.SPORTSBOOK_RAW_LEGACY_WRITE_ENABLED, false)) { try { await repo.insertQuotes(rows); } catch { /* legacy best-effort */ } }
      } else if (!write) {
        summary.quotes += rows.length; // dry-run: cuenta sin persistir
      }
    }

    summary.requests = requests;
    // actualizar estado de cuota + circuit
    const circuit = quotaGuard.nextCircuit(state, { ok: !lastError, errorCode: lastError && lastError.code, nowMs });
    const provStatus = quotaGuard.deriveProviderStatus({ circuitState: circuit.circuit_state, remaining: lastQuota && lastQuota.remaining, used: lastQuota && lastQuota.used });
    if (write) {
      await repo.upsertState(providerName, {
        requests_used: lastQuota && lastQuota.used, requests_remaining: lastQuota && lastQuota.remaining, requests_last_cost: lastQuota && lastQuota.lastCost,
        last_success_at: lastError ? null : new Date(nowMs).toISOString(), last_error_at: lastError ? new Date(nowMs).toISOString() : null,
        last_error_code: lastError && lastError.code, provider_status: provStatus, ...circuit,
      });
      if (runId) await repo.finishRun(runId, { status: lastError ? 'partial' : summary.status, quotes: summary.quotes, complete: summary.books_complete, incomplete: summary.books_incomplete, errors: lastError ? 1 : 0 });
    }
    // estado final honesto: si una competición falló pero otras dieron datos → 'partial', no 'error'.
    if (lastError) {
      const hadData = summary.books_complete > 0 || summary.quotes > 0;
      summary.status = hadData ? (summary.status === 'ok' ? 'partial' : summary.status) : 'error';
      summary.error_code = lastError.code || 'error';
    }
    return summary;
  } catch (e) {
    const cancelled = (e && e.code) === 'cancelled';
    if (!cancelled) log.error('sportsbook: error de ingesta', { error: prov._redactKey ? prov._redactKey(e.message) : 'error' });
    // aborto cooperativo → run 'cancelled' (no 'failed'): la ejecución se detuvo a propósito tras un timeout.
    if (write && runId) { try { await repo.finishRun(runId, { status: cancelled ? 'cancelled' : 'failed', errors: cancelled ? 0 : 1 }); } catch { /* noop */ } }
    const err = new Error((e && e.code) || 'ingestion_error'); err.code = (e && e.code) || 'ingestion_error'; throw err;
  } finally {
    if (hb) clearInterval(hb);
  }
}

module.exports = { runOnce };
