// alerts/index.js — Sprint 8A §29-35. Fachada del motor de alertas de usuario. Genera (idempotente) y
// entrega (in-app + email/telegram opt-in). INERTE sin flags. El Alert Engine NO publica picks: solo
// consume eventos YA publicados (§35). NO envía PASS/WATCH/LEAN como pick.
'use strict';
const cfg = require('./config');
const defs = require('./definitions');
const { dedupKey } = require('./dedup');
const { canAlert } = require('./eligibility');
const quiet = require('./quietHours');
const repo = require('./repositories');
const db = require('../database/client');
const log = require('../database/logger');

// generate(event, recipients) → crea alertas para los usuarios elegibles (idempotente). recipients:
//   [{ userRef, prefs, timezone }]. event: ver eligibility.canAlert + { title, body, materialStateVersion }
async function generate(event, recipients = []) {
  if (!cfg.flags.generation || !db.isConfigured()) return { created: 0, skipped: 'inactive' };
  if (!defs.isValidType(event.type)) return { created: 0, skipped: 'unknown_type' };
  let created = 0, skipped = 0;
  const severity = defs.severityOf(event.type);
  const expiresAt = new Date(Date.now() + cfg.params.defaultExpiryMs).toISOString();
  for (const r of recipients) {
    const elig = canAlert(event, r.prefs || {});
    if (!elig.ok) { skipped++; continue; }
    const key = dedupKey({ userRef: r.userRef, type: event.type, entityType: event.entityType, entityId: event.entityId, materialStateVersion: event.materialStateVersion || '' });
    let res;
    try { res = await repo.create({ userRef: r.userRef, type: event.type, entityType: event.entityType, entityId: event.entityId, dedupKey: key, title: event.title, body: event.body, severity, expiresAt, metadata: event.metadata || {} }); }
    catch (e) { skipped++; continue; }
    if (res.created) { created++; if (cfg.flags.delivery) deliver(res.alert, r).catch(() => {}); }
  }
  return { created, skipped };
}

// deliver — in-app (siempre que esté on) + email/telegram opt-in respetando quiet hours. Retries idempotentes.
async function deliver(alert, recipient = {}) {
  if (!cfg.flags.delivery) return { delivered: false, reason: 'delivery_off' };
  const prefs = recipient.prefs || {};
  const channels = (prefs.alert_preferences && prefs.alert_preferences.channels) || {};
  const tz = recipient.timezone || prefs.timezone || 'UTC';
  const qh = (prefs.alert_preferences && prefs.alert_preferences.quiet_hours) || null;
  const now = new Date();
  const results = {};
  // in-app: la alerta ya existe en DB → "delivered" in-app inmediato
  if (cfg.flags.inApp) { await repo.recordDelivery(alert.id, { channel: 'in_app', status: 'delivered' }).catch(() => {}); results.in_app = 'delivered'; }
  // email (opt-in)
  if (cfg.flags.email && channels.email === true) {
    const decision = quiet.channelDecision({ channel: 'email', severity: alert.severity, date: now, timezone: tz, quiet: qh });
    if (decision === 'deferred') results.email = 'deferred';
    else { try { await sendEmail(recipient, alert); await repo.recordDelivery(alert.id, { channel: 'email', status: 'delivered' }); results.email = 'delivered'; } catch (e) { await repo.recordDelivery(alert.id, { channel: 'email', status: 'failed', safeError: 'send_failed' }); results.email = 'failed'; } }
  }
  // telegram (opt-in + vinculación)
  if (cfg.flags.telegram && channels.telegram === true && recipient.telegramChatId) {
    const decision = quiet.channelDecision({ channel: 'telegram', severity: alert.severity, date: now, timezone: tz, quiet: qh });
    if (decision === 'deferred') results.telegram = 'deferred';
    else { try { await sendTelegram(recipient, alert); await repo.recordDelivery(alert.id, { channel: 'telegram', status: 'delivered' }); results.telegram = 'delivered'; } catch { await repo.recordDelivery(alert.id, { channel: 'telegram', status: 'failed', safeError: 'send_failed' }); results.telegram = 'failed'; } }
  }
  const delivered = Object.values(results).some(v => v === 'delivered');
  await repo.setStatus(alert.id, delivered ? 'delivered' : (Object.keys(results).length ? 'pending' : 'failed')).catch(() => {});
  return { delivered, results };
}

// adapters: reutilizan la infraestructura legacy SIN romperla (gated). Inyectables en tests.
let _email = null, _telegram = null;
function setAdapters({ email, telegram }) { if (email) _email = email; if (telegram) _telegram = telegram; }
async function sendEmail(recipient, alert) {
  if (_email) return _email(recipient, alert);
  const mailer = require('../mailer'); if (!mailer.isConfigured || !mailer.isConfigured()) throw new Error('email_unconfigured');
  return mailer.sendMail({ to: recipient.email, subject: alert.title, text: alert.body || alert.title });
}
async function sendTelegram(recipient, alert) {
  if (_telegram) return _telegram(recipient, alert);
  throw new Error('telegram_unlinked'); // la vinculación de chat por usuario se construye en activación
}

module.exports = { cfg, generate, deliver, setAdapters, repo, dedupKey, canAlert, definitions: defs, quiet };
