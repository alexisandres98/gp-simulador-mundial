// alerts/quietHours.js — Sprint 8A §33. Quiet hours + timezone IANA. PURO (usa Intl, sin libs externas).
// Durante quiet hours: la alerta in-app se mantiene; email/telegram NO crítico se retrasa. Las excepciones
// (p.ej. pick próxima al kickoff) deben ser explícitas por el caller.
'use strict';

// hora local (0-23) en una timezone IANA. Si la tz es inválida, cae a UTC.
function localHour(date, timezone) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', hour: 'numeric', hour12: false }).format(date);
    const h = parseInt(s, 10); return Number.isFinite(h) ? (h % 24) : date.getUTCHours();
  } catch { return date.getUTCHours(); }
}

// ¿estamos en quiet hours? quiet = { start, end } en horas locales [0-23]. Soporta envoltura (22→7).
function inQuietHours(date, timezone, quiet) {
  if (!quiet || quiet.start == null || quiet.end == null || quiet.start === quiet.end) return false;
  const h = localHour(date, timezone);
  const { start, end } = quiet;
  return start < end ? (h >= start && h < end) : (h >= start || h < end); // envoltura nocturna
}

// decide el canal efectivo para una alerta dada la política de quiet hours.
// crítica o canal in-app → siempre se entrega; email/telegram no crítico en quiet hours → 'deferred'.
function channelDecision({ channel, severity, date, timezone, quiet, isException = false }) {
  if (channel === 'in_app') return 'deliver';
  if (severity === 'critical' || isException) return 'deliver';
  return inQuietHours(date, timezone, quiet) ? 'deferred' : 'deliver';
}

module.exports = { localHour, inQuietHours, channelDecision };
