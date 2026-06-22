// user-preferences/index.js — Sprint 8A §36-38. Preferencias de usuario + onboarding. Validación ESTRICTA.
// NO mezcla billing. Aislamiento por usuario (cada quien solo toca lo suyo — el server pasa el user_ref).
// INERTE sin USER_PREFERENCES_ENABLED (lecturas devuelven defaults; escrituras no persisten).
'use strict';
const db = require('../database/client');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const flags = () => ({ enabled: bool(process.env.USER_PREFERENCES_ENABLED, false), onboarding: bool(process.env.ONBOARDING_V2_ENABLED, false) });

const ODDS_FORMATS = ['decimal', 'american', 'fractional', 'probability'];
const LANGS = ['es', 'en', 'pt'];
const MAX_ARRAY = 200;

function validTimezone(tz) { try { Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
function clampArray(a) { return Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, MAX_ARRAY) : undefined; }

// valida un patch de preferencias → { ok, value | error }. Solo campos permitidos; rechaza payloads enormes.
function validate(patch = {}) {
  if (typeof patch !== 'object' || patch === null) return { ok: false, error: 'invalid_payload' };
  if (JSON.stringify(patch).length > 20000) return { ok: false, error: 'payload_too_large' };
  const out = {};
  if (patch.language != null) { if (!LANGS.includes(patch.language)) return { ok: false, error: 'invalid_language' }; out.language = patch.language; }
  if (patch.timezone != null) { if (!validTimezone(patch.timezone)) return { ok: false, error: 'invalid_timezone' }; out.timezone = patch.timezone; }
  if (patch.country != null) { if (typeof patch.country !== 'string' || patch.country.length > 4) return { ok: false, error: 'invalid_country' }; out.country = patch.country.toUpperCase(); }
  if (patch.preferred_odds_format != null) { if (!ODDS_FORMATS.includes(patch.preferred_odds_format)) return { ok: false, error: 'invalid_odds_format' }; out.preferred_odds_format = patch.preferred_odds_format; }
  for (const k of ['competitions', 'teams', 'providers']) if (patch[k] != null) { const v = clampArray(patch[k]); if (v === undefined) return { ok: false, error: 'invalid_' + k }; out[k] = v; }
  for (const k of ['signal_filters', 'alert_preferences', 'accessibility']) if (patch[k] != null) { if (typeof patch[k] !== 'object' || Array.isArray(patch[k])) return { ok: false, error: 'invalid_' + k }; out[k] = patch[k]; }
  return { ok: true, value: out };
}

const DEFAULTS = {
  language: 'es', timezone: 'UTC', country: null, preferred_odds_format: 'decimal',
  competitions: [], teams: [], providers: [], signal_filters: {},
  // defaults conservadores (§32): in-app on; email/telegram off hasta opt-in
  alert_preferences: { channels: { in_app: true, email: false, telegram: false }, quiet_hours: null, types: [] }, accessibility: {},
};

async function get(userRef) {
  if (!flags().enabled || !db.isConfigured()) return { ...DEFAULTS, user_ref: userRef, source: 'defaults' };
  const r = await db.query(`SELECT * FROM user_preferences WHERE user_ref=$1`, [userRef]);
  return r.rows[0] || { ...DEFAULTS, user_ref: userRef, source: 'defaults' };
}

async function update(userRef, patch) {
  if (!flags().enabled) return { ok: false, error: 'preferences_disabled' };
  if (!db.isConfigured()) return { ok: false, error: 'no_db' };
  const v = validate(patch);
  if (!v.ok) return v;
  const cols = Object.keys(v.value);
  if (!cols.length) return { ok: true, value: await get(userRef) };
  const setSql = cols.map((c, i) => `${c}=$${i + 2}`).join(', ');
  const vals = cols.map(c => (['competitions', 'teams', 'providers', 'signal_filters', 'alert_preferences', 'accessibility'].includes(c)) ? JSON.stringify(v.value[c]) : v.value[c]);
  const insCols = ['user_ref', ...cols].join(', ');
  const insVals = ['$1', ...cols.map((c, i) => `$${i + 2}`)].join(', ');
  await db.query(`INSERT INTO user_preferences (${insCols}) VALUES (${insVals}) ON CONFLICT (user_ref) DO UPDATE SET ${setSql}`, [userRef, ...vals]);
  return { ok: true, value: await get(userRef) };
}

// ---- onboarding (§38) ----
const ONBOARDING_STEPS = 9;
async function getOnboarding(userRef) {
  if (!flags().onboarding || !db.isConfigured()) return { user_ref: userRef, status: 'not_started', current_step: 0, version: 'onboarding-v1', total_steps: ONBOARDING_STEPS };
  const r = await db.query(`SELECT * FROM user_onboarding_state WHERE user_ref=$1`, [userRef]);
  return r.rows[0] ? { ...r.rows[0], total_steps: ONBOARDING_STEPS } : { user_ref: userRef, status: 'not_started', current_step: 0, version: 'onboarding-v1', total_steps: ONBOARDING_STEPS };
}
async function updateOnboarding(userRef, { action, step } = {}) {
  if (!flags().onboarding) return { ok: false, error: 'onboarding_disabled' };
  if (!db.isConfigured()) return { ok: false, error: 'no_db' };
  const valid = ['start', 'advance', 'skip', 'complete', 'restart'];
  if (!valid.includes(action)) return { ok: false, error: 'invalid_action' };
  const cur = await getOnboarding(userRef);
  let status = cur.status, current = cur.current_step;
  if (action === 'start') { status = 'started'; }
  else if (action === 'advance') { status = 'started'; current = Math.max(0, Math.min(ONBOARDING_STEPS, step != null ? step : current + 1)); }
  else if (action === 'skip') { status = 'skipped'; }
  else if (action === 'complete') { status = 'completed'; current = ONBOARDING_STEPS; }
  else if (action === 'restart') { status = 'started'; current = 0; }
  await db.query(
    `INSERT INTO user_onboarding_state (user_ref, status, current_step, started_at, completed_at)
     VALUES ($1,$2,$3, CASE WHEN $2='started' THEN now() ELSE NULL END, CASE WHEN $2='completed' THEN now() ELSE NULL END)
     ON CONFLICT (user_ref) DO UPDATE SET status=$2, current_step=$3,
       started_at=COALESCE(user_onboarding_state.started_at, CASE WHEN $2 IN ('started') THEN now() ELSE NULL END),
       completed_at=CASE WHEN $2='completed' THEN now() ELSE user_onboarding_state.completed_at END`,
    [userRef, status, current]
  );
  return { ok: true, value: await getOnboarding(userRef) };
}

module.exports = { flags, validate, get, update, getOnboarding, updateOnboarding, DEFAULTS, ODDS_FORMATS, ONBOARDING_STEPS };
