// exec-opportunities/analytics.js — Sprint 4 §27. Analítica de producto MÍNIMA. Best-effort, nunca lanza.
// NO guarda: capital introducido, bankroll, saldos, ni datos financieros sensibles.
// Puede registrar rangos anónimos del capital (0-100 / 100-500 / 500+) — preferimos no guardar cantidades.
'use strict';

const cfg = require('./config');

const ALLOWED_EVENTS = new Set([
  'opportunity_view', 'detail_open', 'calculator_used', 'deep_link_clicked',
  'expired_before_click', 'jurisdiction_blocked',
]);

// Campos de props permitidos. Cualquier otro se descarta (defensa en profundidad).
const ALLOWED_PROPS = new Set(['public_id', 'provider', 'jurisdiction_status', 'classification', 'calculator_range', 'verified']);
// Campos PROHIBIDOS: si aparecen, se omiten silenciosamente (nunca persistir dinero).
const FORBIDDEN = /capital|bankroll|balance|amount|saldo|patrimonio|income|ingreso/i;

function bucketCapital(capital) {
  const c = parseFloat(capital);
  if (!Number.isFinite(c)) return null;
  if (c < 100) return '0-100';
  if (c < 500) return '100-500';
  return '500+';
}

function sanitizeProps(props = {}) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN.test(k)) continue;            // nunca dinero
    if (!ALLOWED_PROPS.has(k)) continue;        // lista blanca
    if (typeof v === 'object') continue;        // solo escalares
    out[k] = v;
  }
  return out;
}

// record(event, props, opts) → Promise<bool>. No bloquea ni lanza.
async function record(event, props = {}, opts = {}) {
  try {
    if (!ALLOWED_EVENTS.has(event)) return false;
    if (!cfg.platform.db.configured) return false;
    const clean = sanitizeProps(props);
    const repo = require('./repositories/analyticsRepository');
    await repo.insert({ event, props: clean, sessionRef: opts.sessionRef || null });
    return true;
  } catch { return false; }
}

module.exports = { record, sanitizeProps, bucketCapital, ALLOWED_EVENTS };
