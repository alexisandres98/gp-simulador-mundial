// tests/observer-verify.test.js — partes PURAS de la verificación anti-clickbait (sin red).
'use strict';
const { decodeGoogleNewsUrl, htmlToText, safeUrl, privateHost } = require('../observer/verify');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('== SSRF guard ==');
t('localhost bloqueado', privateHost('localhost') && privateHost('127.0.0.1'));
t('rangos privados bloqueados', privateHost('10.0.0.5') && privateHost('192.168.1.1') && privateHost('172.16.0.1') && privateHost('169.254.169.254'));
t('host público pasa', !privateHost('bbc.co.uk'));
t('safeUrl exige http(s) y host público', safeUrl('https://bbc.co.uk/x') && !safeUrl('file:///etc/passwd') && !safeUrl('https://127.0.0.1/x'));

console.log('== decode Google News (formato viejo CBMi+URL) ==');
const inner = 'https://www.example.com/article-one';
const token = Buffer.from('"' + String.fromCharCode(inner.length) + inner, 'latin1').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
t('token con URL embebida se decodifica', decodeGoogleNewsUrl('https://news.google.com/rss/articles/' + token + '?oc=5') === inner);
t('URL directa (no google) pasa tal cual', decodeGoogleNewsUrl('https://marca.com/nota') === 'https://marca.com/nota');
t('token nuevo (AU_yqL, sin URL embebida) → null (va al resolver online)', decodeGoogleNewsUrl('https://news.google.com/rss/articles/CBMiAAU_yqLfake') === null);

console.log('== htmlToText ==');
const html = '<html><head><style>.x{}</style><script>var a=1;</script></head><body><nav>menu</nav>' +
  '<p>' + 'El jugador se pierde el partido por lesión confirmada. '.repeat(12) + '</p><p>Fuente oficial del club.</p></body></html>';
const text = htmlToText(html);
t('extrae párrafos sin tags ni scripts', text.includes('se pierde el partido') && !text.includes('var a=1') && !/[<>]/.test(text));
t('capado a 6KB', htmlToText('<p>' + 'x'.repeat(20000) + '</p>').length <= 6000);

console.log(`\n[observer-verify] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
