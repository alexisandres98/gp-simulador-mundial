// alerts/config.js — Sprint 8A §29. Flags del motor de alertas de usuario. INERTE por defecto. NO reemplaza
// el legacy de alertas por email (db.json); este es el motor nuevo (in-app + canales opt-in).
'use strict';
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

function resolveFlags() {
  const enabled = bool(process.env.USER_ALERTS_ENABLED, false);
  return {
    enabled,
    generation: enabled && bool(process.env.USER_ALERTS_GENERATION_ENABLED, false),
    delivery: enabled && bool(process.env.USER_ALERTS_DELIVERY_ENABLED, false),
    inApp: enabled && bool(process.env.USER_ALERTS_IN_APP_ENABLED, false),
    email: enabled && bool(process.env.USER_ALERTS_EMAIL_ENABLED, false),       // opt-in
    telegram: enabled && bool(process.env.USER_ALERTS_TELEGRAM_ENABLED, false), // opt-in + vinculación
  };
}
module.exports = {
  LAYER_VERSION: 'alerts-1',
  get flags() { return resolveFlags(); },
  get params() { return { defaultExpiryMs: int(process.env.USER_ALERTS_EXPIRY_MS, 24 * 60 * 60 * 1000), maxDeliveryRetries: int(process.env.USER_ALERTS_MAX_RETRIES, 2) }; },
  bool, int,
};
