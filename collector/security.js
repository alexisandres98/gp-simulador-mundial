// collector/security.js — Fase O §19. Seguridad/compliance del collector. PURO + fetch endurecido.
// SSRF guard (bloquea IPs privadas/locales/metadata, esquemas y puertos no permitidos), ALLOWLIST de dominios,
// sanitización de HTML (el texto externo es DATO no confiable, nunca instrucción → sin prompt injection), límites
// de tamaño, dedup por hash. NO sigue redirecciones a destinos privados. NO guarda cookies/secrets.
'use strict';
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const MAX_BYTES = 2 * 1024 * 1024;       // 2MB
const TIMEOUT_MS = 12000;

// hosts/IPs prohibidos (SSRF): privadas, loopback, link-local, metadata cloud.
function isBlockedHost(host) {
  const h = (host || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;             // link-local + metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
    if (a >= 224) return true;                            // multicast/reserved
  }
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true; // IPv6 priv/link-local
  return false;
}

// Valida una URL contra esquema/puerto/host + allowlist de dominios (sufijo). Devuelve {ok, reason, parsed}.
function validateUrl(url, allowlist = []) {
  let u; try { u = new URL(url); } catch { return { ok: false, reason: 'bad_url' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'bad_scheme' };
  if (u.port && !['', '80', '443'].includes(u.port)) return { ok: false, reason: 'bad_port' };
  if (isBlockedHost(u.hostname)) return { ok: false, reason: 'ssrf_blocked' };
  const host = u.hostname.toLowerCase();
  const allowed = allowlist.some(d => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()));
  if (allowlist.length && !allowed) return { ok: false, reason: 'not_in_allowlist' };
  return { ok: true, reason: 'ok', parsed: u };
}

// sanitiza HTML → texto plano seguro (sin <script>/<style>/tags); colapsa espacios; corta a maxLen.
function sanitizeHtml(html, maxLen = 20000) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
  s = s.replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, maxLen);
}
const contentHash = c => 'sha256:' + crypto.createHash('sha256').update(String(c || '')).digest('hex');

// fetch endurecido: valida URL+allowlist (también tras redirección), timeout, límite de bytes, ETag/If-Modified-Since.
function safeFetch(url, { allowlist = [], etag = null, lastModified = null, redirectsLeft = 2 } = {}) {
  return new Promise((resolve) => {
    const v = validateUrl(url, allowlist);
    if (!v.ok) return resolve({ ok: false, status: 0, reason: v.reason });
    const u = v.parsed;
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': 'GPSimuladorBot/1.0 (+https://gpsimulador.com)', 'Accept': 'application/rss+xml, application/atom+xml, application/json, text/html;q=0.8' };
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;
    const req = lib.get(u, { headers, timeout: TIMEOUT_MS }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (redirectsLeft <= 0 || !res.headers.location) return resolve({ ok: false, status: res.statusCode, reason: 'too_many_redirects' });
        const next = new URL(res.headers.location, u).toString();
        return resolve(safeFetch(next, { allowlist, etag, lastModified, redirectsLeft: redirectsLeft - 1 }));
      }
      if (res.statusCode === 304) { res.resume(); return resolve({ ok: true, status: 304, notModified: true, etag: res.headers.etag, lastModified: res.headers['last-modified'] }); }
      const ct = res.headers['content-type'] || '';
      if (/application\/(octet-stream|zip|pdf)|executable/i.test(ct)) { res.resume(); return resolve({ ok: false, status: res.statusCode, reason: 'blocked_content_type' }); }
      let len = 0; const chunks = [];
      res.on('data', c => { len += c.length; if (len > MAX_BYTES) { req.destroy(); resolve({ ok: false, status: res.statusCode, reason: 'too_large' }); } else chunks.push(c); });
      res.on('end', () => { const body = Buffer.concat(chunks).toString('utf8'); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body, contentType: ct, etag: res.headers.etag, lastModified: res.headers['last-modified'], bytes: len, contentHash: contentHash(body) }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, reason: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, status: 0, reason: 'error', error: e.message }));
  });
}

module.exports = { isBlockedHost, validateUrl, sanitizeHtml, contentHash, safeFetch, MAX_BYTES };
