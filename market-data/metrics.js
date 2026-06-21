// market-data/metrics.js — métricas internas en memoria (Sprint 1). No es un dashboard público.
// Acumula contadores por proveedor y calcula tasas/percentiles. Se resetea al reiniciar el proceso.

'use strict';

function blank() {
  return {
    requests: 0, retries: 0, rateLimited: 0, errors: 0,
    rawWritten: 0, normalizedWritten: 0, orderbookLevels: 0,
    rejected: 0, skippedByLock: 0, checksumRepeated: 0,
    marketsNoTimestamp: 0, marketsNoOrderbook: 0, rawBytes: 0, rawCount: 0,
    latencies: [], // ms
    lastRunStatus: null, lastStartedAt: null, lastFinishedAt: null, lastSuccessfulSnapshotAt: null,
    marketsTracked: 0,
  };
}

const store = Object.create(null);
function forProvider(p) { return store[p] || (store[p] = blank()); }

function record(provider, fields = {}) {
  const m = forProvider(provider);
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'latencies' && Array.isArray(v)) m.latencies.push(...v);
    else if (typeof v === 'number' && typeof m[k] === 'number') m[k] += v;
    else m[k] = v; // valores no acumulables (status, timestamps)
  }
  // acota memoria de latencias
  if (m.latencies.length > 5000) m.latencies = m.latencies.slice(-5000);
}

function p95(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}
function avg(arr) { return arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null; }

// snapshot(provider) → métricas calculadas (sin exponer secretos)
function snapshot(provider) {
  const m = forProvider(provider);
  const errorRate = m.requests ? +(m.errors / m.requests).toFixed(4) : 0;
  const retryRate = m.requests ? +(m.retries / m.requests).toFixed(4) : 0;
  const avgRawBytes = m.rawCount ? Math.round(m.rawBytes / m.rawCount) : null;
  return {
    provider,
    requests: m.requests, retries: m.retries, rateLimited: m.rateLimited, errors: m.errors,
    errorRate, retryRate,
    rawWritten: m.rawWritten, normalizedWritten: m.normalizedWritten, orderbookLevels: m.orderbookLevels,
    rejected: m.rejected, skippedByLock: m.skippedByLock, checksumRepeated: m.checksumRepeated,
    marketsNoTimestamp: m.marketsNoTimestamp, marketsNoOrderbook: m.marketsNoOrderbook,
    avgLatencyMs: avg(m.latencies), p95LatencyMs: p95(m.latencies), avgRawBytes,
    lastRunStatus: m.lastRunStatus, lastStartedAt: m.lastStartedAt, lastFinishedAt: m.lastFinishedAt,
    lastSuccessfulSnapshotAt: m.lastSuccessfulSnapshotAt, marketsTracked: m.marketsTracked,
  };
}

function reset() { for (const k of Object.keys(store)) delete store[k]; }

module.exports = { record, snapshot, reset, forProvider };
