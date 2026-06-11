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

function isConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

module.exports = { sendMail, isConfigured };
