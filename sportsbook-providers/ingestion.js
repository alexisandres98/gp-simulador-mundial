// sportsbook-providers/ingestion.js — Sprint 8A §6-10. Orquesta un ciclo de ingesta de cuotas 1X2 prematch:
// descubre competiciones (Mundial) → eventos → cuotas h2h → valida → persiste. Respeta cuota, reserva,
// circuit breaker y el límite de requests por ciclo. INERTE sin flags/key. No expone la API key.
'use strict';
const cfg = require('./config');
const { createProvider } = require('./theOddsApiProvider');
const normalizer = require('./normalizer');
const quotaGuard = require('./quotaGuard');
const repo = require('./repositories');
const db = require('../database/client');
const log = require('../database/logger');

// runOnce({ provider?, now? }) — un ciclo. provider inyectable para tests (sin red/key).
async function runOnce({ provider = null, now = null } = {}) {
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
  const summary = { status: 'ok', events: 0, books_complete: 0, books_incomplete: 0, quotes: 0, rejected: 0, requests: 0, competitions: 0 };
  let runId = null;

  try {
    if (write) { const r = await repo.startRun({ provider: providerName, regions: cfg.params.regions }); runId = r.id; }

    const comps = await prov.discoverCompetitions();         // gratis (no cuenta cuota)
    summary.competitions = comps.length;
    for (const sport of comps) {
      if (requests >= cfg.params.maxRequestsPerRun) { summary.status = 'partial'; summary.reason = 'max_requests_per_run'; break; }
      // cuota crítica → detener ingesta (§8)
      if (lastQuota && quotaGuard.quotaCritical(lastQuota.remaining, lastQuota.used)) { summary.status = 'partial'; summary.reason = 'quota_reserve'; break; }
      let res;
      try { res = await prov.fetchQuotes(sport.key, {}); requests++; }
      catch (e) {
        lastError = e;
        // errores GLOBALES (auth/cuota agotada) → detener todo. Error de UNA competición (p.ej. bad_request
        // de una sport key sin cuotas h2h ahora) → registrar y seguir con la siguiente (resiliencia §22).
        if (/auth|quota_exhausted/i.test(e.code || '')) break;
        summary.competition_errors = (summary.competition_errors || 0) + 1;
        if (e.quota) lastQuota = e.quota;
        continue;
      }
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
      if (write && rows.length) summary.quotes += await repo.insertQuotes(rows);
      else if (!write) summary.quotes += rows.length; // dry-run: cuenta sin persistir
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
    log.error('sportsbook: error de ingesta', { error: prov._redactKey ? prov._redactKey(e.message) : 'error' });
    if (write && runId) { try { await repo.finishRun(runId, { status: 'failed', errors: 1 }); } catch { /* noop */ } }
    const err = new Error((e && e.code) || 'ingestion_error'); err.code = (e && e.code) || 'ingestion_error'; throw err;
  }
}

module.exports = { runOnce };
