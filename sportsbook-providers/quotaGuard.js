// sportsbook-providers/quotaGuard.js — Sprint 8A §8,§23. Control de cuota + circuit breaker. PURO (sin DB):
// decide si se puede llamar al proveedor y deriva el estado a partir de las cuotas/errores observados.
'use strict';
const cfg = require('./config');

// ¿la cuota está crítica? (remaining bajo la reserva configurada). Si remaining desconocido → no bloquea.
function quotaCritical(remaining, used) {
  if (remaining == null) return false;
  const total = (remaining || 0) + (used || 0);
  if (total <= 0) return remaining <= 0;
  const reserve = cfg.params.quotaReservePercent / 100;
  return remaining <= Math.ceil(total * reserve);
}

// estado de proveedor derivado de cuota/circuit.
function deriveProviderStatus({ circuitState, remaining, used }) {
  if (circuitState === 'open') return 'down';
  if (remaining != null && remaining <= 0) return 'quota_critical';
  if (quotaCritical(remaining, used)) return 'degraded';
  return 'ok';
}

// transición del circuit breaker ante un resultado. Devuelve el nuevo estado del circuito.
// state: { circuit_state, consecutive_failures, circuit_opened_at }
function nextCircuit(state, { ok, errorCode = null, nowMs = null }) {
  const now = nowMs != null ? nowMs : Date.now();
  const P = cfg.params;
  let { circuit_state = 'closed', consecutive_failures = 0, circuit_opened_at = null } = state || {};

  if (ok) {
    // un éxito cierra el circuito (incluido desde half_open)
    return { circuit_state: 'closed', consecutive_failures: 0, circuit_opened_at: null };
  }
  // errores aislados no abren; auth/quota/5xx/timeout repetidos sí
  const counts = /auth|quota_exhausted|server_error|timeout|network/i.test(errorCode || '');
  consecutive_failures = counts ? consecutive_failures + 1 : consecutive_failures;
  // auth/quota agotada abren de inmediato (no insistir)
  if (/auth|quota_exhausted/i.test(errorCode || '')) return { circuit_state: 'open', consecutive_failures, circuit_opened_at: now };
  if (consecutive_failures >= P.circuitFailThreshold) return { circuit_state: 'open', consecutive_failures, circuit_opened_at: now };
  return { circuit_state, consecutive_failures, circuit_opened_at };
}

// ¿se puede llamar ahora? Considera el circuito (open con ventana vencida → half_open permite 1 intento).
function canCall(state, nowMs = null) {
  const now = nowMs != null ? nowMs : Date.now();
  const P = cfg.params;
  const cs = (state && state.circuit_state) || 'closed';
  if (cs === 'closed' || cs === 'half_open') return { allowed: true, circuit: cs };
  // open: ¿venció la ventana? → half_open (un intento de sondeo)
  const opened = state && state.circuit_opened_at ? +new Date(state.circuit_opened_at) : 0;
  if (now - opened >= P.circuitOpenMs) return { allowed: true, circuit: 'half_open' };
  return { allowed: false, circuit: 'open', reason: 'circuit_open' };
}

module.exports = { quotaCritical, deriveProviderStatus, nextCircuit, canCall };
