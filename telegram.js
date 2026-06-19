// telegram.js — publica mensajes al canal de Telegram vía Bot API (HTTPS, sin dependencias).
// Variables de entorno:
//   TELEGRAM_BOT_TOKEN  — token del bot creado con @BotFather
//   TELEGRAM_CHANNEL    — @usuario del canal público (p.ej. @gpsimulador) o id numérico -100...
// Si faltan, todas las funciones son no-op (la app sigue igual). Nunca lanza.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL = process.env.TELEGRAM_CHANNEL || '';

function configured() { return !!(TOKEN && CHANNEL); }

// Publica un mensaje (HTML básico de Telegram: <b>, <i>, <a href>). Devuelve true/false.
async function post(text, { preview = true } = {}) {
  if (!configured()) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL, text, parse_mode: 'HTML',
        disable_web_page_preview: !preview,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) console.warn('[telegram]', j.description || ('HTTP ' + r.status));
    return !!j.ok;
  } catch (e) { console.warn('[telegram] error:', e.message); return false; }
}

module.exports = { configured, post };
