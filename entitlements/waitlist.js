// entitlements/waitlist.js — Sprint 8B §50,§51. Lista de interés GP Pro post-Mundial. SIN tarjeta, SIN
// checkout, SIN depósito. Solo intención + research de pricing. INERTE sin PRO_WAITLIST_ENABLED.
'use strict';
const db = require('../database/client');
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const flags = () => ({ enabled: bool(process.env.PRO_WAITLIST_ENABLED, false) });

const USE_CASES = ['picks', 'value', 'arbitrage', 'alerts', 'best_odds', 'history', 'api', 'b2b'];

function validate(p = {}) {
  if (typeof p !== 'object' || p === null) return { ok: false, error: 'invalid_payload' };
  if (p.primary_use_case && !USE_CASES.includes(p.primary_use_case)) return { ok: false, error: 'invalid_use_case' };
  // NUNCA aceptamos datos de pago
  for (const k of Object.keys(p)) if (/card|cvv|iban|stripe|payment|deposit/i.test(k)) return { ok: false, error: 'no_payment_data' };
  return { ok: true };
}

async function join(userRef, payload = {}) {
  if (!flags().enabled) return { ok: false, error: 'waitlist_disabled' };
  if (!db.isConfigured()) return { ok: false, error: 'no_db' };
  const v = validate(payload); if (!v.ok) return v;
  const r = await db.query(
    `INSERT INTO pro_waitlist (user_ref, email, country, preferred_plan, primary_use_case, desired_features, acceptable_price_range, contact_consent, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (user_ref) DO UPDATE SET email=EXCLUDED.email, country=EXCLUDED.country, preferred_plan=EXCLUDED.preferred_plan,
       primary_use_case=EXCLUDED.primary_use_case, desired_features=EXCLUDED.desired_features, acceptable_price_range=EXCLUDED.acceptable_price_range,
       contact_consent=EXCLUDED.contact_consent, status='joined' RETURNING *`,
    [userRef, payload.email || null, payload.country || null, payload.preferred_plan || null, payload.primary_use_case || null,
     JSON.stringify(payload.desired_features || []), payload.acceptable_price_range || null, !!payload.contact_consent, payload.source || null]);
  return { ok: true, entry: r.rows[0] };
}
async function get(userRef) {
  if (!flags().enabled || !db.isConfigured()) return null;
  const r = await db.query(`SELECT * FROM pro_waitlist WHERE user_ref=$1`, [userRef]);
  return r.rows[0] || null;
}
async function leave(userRef) {
  if (!db.isConfigured()) return { ok: false };
  await db.query(`DELETE FROM pro_waitlist WHERE user_ref=$1`, [userRef]);
  return { ok: true };
}

module.exports = { flags, validate, join, get, leave, USE_CASES };
