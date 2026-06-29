// Cliente SMTP mínimo sin dependencias (TLS implícito, puerto 465).
// Pensado para Gmail con contraseña de aplicación: SPF/DKIM los firma Google,
// que es lo más seguro contra spam sin dominio propio.
const tls = require('tls');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');

function sendMail({ to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (!user || !pass) return reject(new Error('SMTP no configurado'));
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const fromName = process.env.SMTP_FROM_NAME || 'GP Simulador del Mundial';

    const boundary = 'b' + crypto_rand();
    const msg = [
      `From: =?UTF-8?B?${b64(fromName)}?= <${user}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto_rand()}@${user.split('@')[1]}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(html),
      `--${boundary}--`,
    ].join('\r\n');

    // [código esperado, qué enviar al recibirlo]
    const seq = [
      [220, `EHLO gp-simulador\r\n`],
      [250, 'AUTH LOGIN\r\n'],
      [334, b64(user) + '\r\n'],
      [334, b64(pass) + '\r\n'],
      [235, `MAIL FROM:<${user}>\r\n`],
      [250, `RCPT TO:<${to}>\r\n`],
      [250, 'DATA\r\n'],
      [354, msg + '\r\n.\r\n'],
      [250, 'QUIT\r\n'],
    ];
    let i = 0, buf = '', settled = false;
    const fail = e => { if (!settled) { settled = true; reject(e); } try { socket.destroy(); } catch { } };

    const socket = tls.connect(465, host, { servername: host }, () => { });
    socket.setTimeout(20000, () => fail(new Error('SMTP timeout')));
    socket.on('error', fail);
    socket.on('data', d => {
      buf += d.toString();
      const lines = buf.trimEnd().split('\r\n');
      const last = lines[lines.length - 1];
      if (!/^\d{3} /.test(last)) return; // respuesta multilínea incompleta
      const code = parseInt(last.slice(0, 3), 10);
      buf = '';
      if (i >= seq.length) return;
      const [expect, send] = seq[i];
      if (code !== expect) return fail(new Error(`SMTP ${code} (esperaba ${expect}): ${last.slice(4, 120)}`));
      i++;
      socket.write(send);
      if (i === seq.length) { // QUIT enviado: el correo ya fue aceptado
        settled = true;
        resolve();
        socket.end();
      }
    });
  });
}

function crypto_rand() {
  return require('crypto').randomBytes(8).toString('hex');
}

// Relay por HTTPS (Google Apps Script): para hosts que bloquean puertos SMTP (Render free).
// El script corre como la cuenta Gmail del dueño → misma entregabilidad que Gmail puro.
async function sendViaWebhook({ to, subject, text, html }) {
  const r = await fetch(process.env.MAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: process.env.MAIL_WEBHOOK_TOKEN || '', to, subject, text, html }),
    signal: AbortSignal.timeout(20000),
    redirect: 'follow', // Apps Script responde con redirect 302
  });
  const body = await r.text();
  let j = {};
  try { j = JSON.parse(body); } catch { }
  if (!j.ok) throw new Error('relay: ' + (j.error || body.slice(0, 120) || r.status));
}

// Resend (HTTPS): envío desde el dominio propio (codigo@gpsimulador.com) con SPF/DKIM del dominio.
// opts.from: override del remitente (p.ej. nombre personal). opts.noListUnsub: omite el header List-Unsubscribe
// — ese header es señal de "correo masivo" y empuja a la pestaña Promociones; para correos de estilo PERSONAL
// (reactivación 1:1) conviene omitirlo y dejar la baja en el cuerpo, para que Gmail lo trate como Principal.
async function sendViaResend({ to, subject, text, html, from, noListUnsub }) {
  const payload = {
    from: from || process.env.MAIL_FROM || 'GP Simulador del Mundial <codigo@gpsimulador.com>',
    to: [to],
    reply_to: process.env.MAIL_REPLY_TO || undefined,
    subject, text, html,
  };
  if (!noListUnsub) {
    // List-Unsubscribe mejora la entregabilidad anti-spam (exigido a remitentes de gran volumen):
    payload.headers = {
      'List-Unsubscribe': `<mailto:${process.env.MAIL_REPLY_TO || 'codigo@gpsimulador.com'}?subject=baja>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error('resend ' + r.status + ': ' + body.slice(0, 150));
  }
}

async function send(opts) {
  if (process.env.RESEND_API_KEY) {
    try { await sendViaResend(opts); console.log('[mail] resend OK →', opts.to); return; }
    catch (e) {
      if (!process.env.MAIL_WEBHOOK_URL) throw e;
      console.error('[mail] resend falló, usando relay de respaldo:', e.message);
    }
  }
  if (process.env.MAIL_WEBHOOK_URL) { await sendViaWebhook(opts); console.log('[mail] relay GAS OK →', opts.to); return; }
  return sendMail(opts);
}

function isConfigured() {
  return !!(process.env.RESEND_API_KEY || process.env.MAIL_WEBHOOK_URL || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

module.exports = { sendMail: send, isConfigured };
