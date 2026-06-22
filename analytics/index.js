// analytics/index.js — Sprint 8A §41-46. Analítica de producto first-party (provider-agnostic). Event
// schema registry (rechaza nombres arbitrarios del frontend), ingest validado, funnel y retención.
// PRIVACIDAD (§43): NUNCA bankroll/stakes/contraseñas/API keys/tarjetas. INERTE sin flags.
'use strict';
const db = require('../database/client');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const flags = () => ({ enabled: bool(process.env.PRODUCT_ANALYTICS_ENABLED, false), write: bool(process.env.PRODUCT_ANALYTICS_ENABLED, false) && bool(process.env.PRODUCT_ANALYTICS_WRITE_ENABLED, false) });

// event schema registry (§42): solo estos nombres se aceptan. Lista blanca explícita.
const ALLOWED_EVENTS = new Set([
  'page_viewed', 'simulation_run', 'value_signal_opened', 'pick_opened', 'arb_opened', 'filter_applied',
  'alert_created', 'alert_opened', 'event_followed', 'methodology_viewed', 'registry_verified',
  'pro_waitlist_joined', 'referral_shared', 'referral_converted', 'account_created', 'onboarding_started',
  'onboarding_completed', 'first_return_visit',
]);
// claves prohibidas en properties (§43)
const FORBIDDEN_KEYS = /bankroll|stake|password|api[_-]?key|card|cvv|ssn|secret|token/i;

function validate(eventName, properties = {}) {
  if (!ALLOWED_EVENTS.has(eventName)) return { ok: false, error: 'unknown_event' };
  if (properties && typeof properties === 'object') {
    if (JSON.stringify(properties).length > 8000) return { ok: false, error: 'properties_too_large' };
    for (const k of Object.keys(properties)) if (FORBIDDEN_KEYS.test(k)) return { ok: false, error: 'forbidden_property' };
  }
  return { ok: true };
}

// record(event) — best-effort, validado. event: { event_name, user_ref?, anonymous_id?, session_id?, properties?, context? }
async function record(event = {}) {
  if (!flags().write || !db.isConfigured()) return { recorded: false, skipped: 'inactive' };
  const v = validate(event.event_name, event.properties || {});
  if (!v.ok) return { recorded: false, error: v.error };
  try {
    await db.query(
      `INSERT INTO product_events (event_name, event_version, user_ref, anonymous_id, session_id, occurred_at, properties, context)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), $7, $8)`,
      [event.event_name, event.event_version || 'v1', event.user_ref || null, event.anonymous_id || null, event.session_id || null,
       event.occurred_at || null, JSON.stringify(event.properties || {}), JSON.stringify(event.context || {})]
    );
    return { recorded: true };
  } catch { return { recorded: false, error: 'write_failed' }; }
}

// overview admin: conteos por evento últimos N días (sin PII).
async function overview({ days = 7 } = {}) {
  if (!db.isConfigured()) return { events: [] };
  const r = await db.query(
    `SELECT event_name, count(*)::int n, count(DISTINCT user_ref)::int users
       FROM product_events WHERE occurred_at > now() - ($1::int || ' days')::interval
       GROUP BY event_name ORDER BY n DESC`, [days]);
  return { events: r.rows, days };
}

// funnel: cuántos usuarios distintos pasaron por cada paso (en orden), últimos N días.
async function funnel({ steps = ['account_created', 'onboarding_completed', 'simulation_run', 'alert_created', 'first_return_visit'], days = 30 } = {}) {
  if (!db.isConfigured()) return { steps: [] };
  const out = [];
  for (const step of steps) {
    const r = await db.query(`SELECT count(DISTINCT user_ref)::int n FROM product_events WHERE event_name=$1 AND occurred_at > now()-($2::int||' days')::interval`, [step, days]);
    out.push({ step, users: r.rows[0].n });
  }
  return { steps: out, days };
}

module.exports = { flags, validate, record, overview, funnel, ALLOWED_EVENTS, FORBIDDEN_KEYS };
