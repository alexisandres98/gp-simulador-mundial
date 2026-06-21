// database/logger.js — logging estructurado para la nueva capa de datos (Sprint 0).
// Emite JSON de una línea con campos consistentes. REDACTA cualquier secreto.
// No reemplaza el logging del resto de la app; es exclusivo de la plataforma v2.

'use strict';

// Claves que NUNCA deben aparecer en un log, ni siquiera por accidente.
const SECRET_KEYS = /(authorization|cookie|api[_-]?key|apikey|token|password|secret|database_url|connection[_-]?string|x-apisports-key)/i;

function redact(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (typeof value === 'string') {
    // si parece una URL de conexión con credenciales, no la imprimas
    if (/^[a-z]+:\/\/[^@/]*:[^@/]*@/i.test(value)) return '[redacted-url]';
    return value;
  }
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level, message, fields = {}) {
  const base = { ts: new Date().toISOString(), level, service: 'platform-v2', message };
  let line;
  try {
    line = JSON.stringify({ ...base, ...redact(fields) });
  } catch {
    line = JSON.stringify({ ...base, message: message + ' [unserializable fields]' });
  }
  // stderr para warn/error, stdout para el resto — compatible con la captura de logs de Render
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
  debug: (msg, fields) => { if (/^(1|true|debug)$/i.test(process.env.PLATFORM_LOG_DEBUG || '')) emit('debug', msg, fields); },
  redact,
};
