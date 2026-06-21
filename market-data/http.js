// market-data/http.js — cliente HTTP resiliente para collectors (Sprint 1).
// timeout, retries con backoff + jitter, respeta 429 Retry-After. Reintenta solo errores transitorios
// (timeout, 5xx, 429); NO reintenta 400/401/403/404 ni payload inválido permanente. No registra credenciales
// (estos endpoints son públicos y no enviamos auth). Devuelve métricas por intento.

'use strict';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

// fetchJson(url, opts) → { ok, status, json, latencyMs, attempts, retryCount, rateLimited, error }
async function fetchJson(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 15000;
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : 2;
  const backoffMs = opts.backoffMs || 500;
  const rand = opts.rand || Math.random; // inyectable para tests
  let attempt = 0, retryCount = 0, rateLimited = 0, lastErr = null;
  const t0 = Date.now();
  for (;;) {
    attempt++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      if (res.ok) {
        const json = await res.json();
        return { ok: true, status: res.status, json, latencyMs: Date.now() - t0, attempts: attempt, retryCount, rateLimited, error: null };
      }
      if (res.status === 429) rateLimited++;
      const transient = TRANSIENT.has(res.status);
      if (transient && retryCount < maxRetries) {
        retryCount++;
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffMs * Math.pow(2, retryCount - 1) * (0.5 + rand()); // backoff exponencial + jitter
        await sleep(Math.min(wait, 30000));
        continue;
      }
      return { ok: false, status: res.status, json: null, latencyMs: Date.now() - t0, attempts: attempt, retryCount, rateLimited, error: `HTTP ${res.status}` };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e.name === 'AbortError' ? 'timeout' : (e.message || 'fetch_error');
      const transient = e.name === 'AbortError' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network/i.test(lastErr);
      if (transient && retryCount < maxRetries) {
        retryCount++;
        await sleep(Math.min(backoffMs * Math.pow(2, retryCount - 1) * (0.5 + rand()), 30000));
        continue;
      }
      return { ok: false, status: 0, json: null, latencyMs: Date.now() - t0, attempts: attempt, retryCount, rateLimited, error: lastErr };
    }
  }
}

module.exports = { fetchJson, TRANSIENT };
