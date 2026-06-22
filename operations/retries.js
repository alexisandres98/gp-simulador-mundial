// operations/retries.js — política de reintentos con backoff exponencial y jitter DETERMINÍSTICO.
// Sin Math.random (reproducible y seguro para resume). El jitter deriva de (job + attempt).
'use strict';
const crypto = require('crypto');

// errores NO recuperables: no tiene sentido reintentar (auth, cuota agotada, response inválida, 4xx no-429).
const NON_RECOVERABLE = /auth|unauthorized|forbidden|quota_exhausted|invalid_response|bad_request|not_configured|400|401|403|404|422/i;

function isRecoverable(err) {
  const msg = String((err && (err.code || err.message)) || '');
  if (NON_RECOVERABLE.test(msg)) return false;
  return true; // timeouts, 5xx, ECONN*, errores transitorios → recuperables
}

// jitter determinístico en [0,1) desde una semilla estable.
function jitter01(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}

// backoff: base * 2^(attempt-1), con ±25% de jitter determinístico, tope 30s.
function backoffMs(attempt, baseMs, seed) {
  const exp = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  const j = (jitter01(seed + ':' + attempt) - 0.5) * 0.5; // ±0.25
  return Math.min(30000, Math.round(exp * (1 + j)));
}

// ¿debe reintentarse? (recuperable Y por debajo del máximo)
function shouldRetry(err, attempt, maxRetries) {
  return isRecoverable(err) && attempt <= maxRetries;
}

module.exports = { isRecoverable, backoffMs, jitter01, shouldRetry, NON_RECOVERABLE };
