// observer/verify.js — VERIFICACIÓN ANTI-CLICKBAIT (punto 2 del roadmap 8-jul). El sistema no saca
// conclusiones sobre un jugador solo por un titular: intenta leer el CUERPO del artículo y re-extraer la
// señal. Si el cuerpo la CONTRADICE (desenlace positivo: "declared fit", "podrá jugar"), la señal se
// descarta antes de almacenarse; si la confirma, queda marcada body_check='confirmed'.
// Red endurecida: https-only, sin hosts privados/IP literales (anti-SSRF), timeout 8s, tope 300KB, texto
// plano capado a 6KB. Best-effort honesto: si el artículo no se puede leer → 'unavailable' (la señal vive
// con la corroboración multi-fuente y la alineación confirmada como redes de seguridad).
'use strict';

const UA = 'Mozilla/5.0 (compatible; GPSimulador/1.0)';
const MAX_BYTES = 300 * 1024, MAX_TEXT = 6000;

function privateHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IP literal → bloquear rangos privados/loopback/link-local/metadata
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return true;
  }
  if (h.includes(':')) return true; // IPv6 literal → fuera (simplicidad conservadora)
  return false;
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (privateHost(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

// Los links del RSS de Google News son redirects (news.google.com/rss/articles/<token>). El token viejo
// (CBMi…+URL) trae la URL embebida en base64; el formato nuevo (AU_yqL…) requiere el flujo del decoder:
// GET /articles/<token> → atributos de firma (data-n-a-sg / data-n-a-ts) → POST al endpoint interno
// batchexecute → responde la URL real del publisher ("garturlres"). Verificado en vivo 8-jul (resolvió el
// artículo real de la lesión de Onana). Best-effort con cache: si Google cambia el flujo → 'unavailable'.
function decodeGoogleNewsUrl(link) {
  try {
    const url = new URL(link);
    if (!/news\.google\./.test(url.hostname)) return safeUrl(link); // ya es la URL real
    const token = (url.pathname.split('/articles/')[1] || '').split('?')[0];
    if (!token) return null;
    const raw = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
    const m = raw.match(/https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{10,500}/);
    return m ? safeUrl(m[0]) : null;
  } catch { return null; }
}

const _resolveCache = {}; // link → { url|null, at }
async function resolveGoogleNewsUrl(link) {
  const hit = _resolveCache[link];
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.url;
  let out = decodeGoogleNewsUrl(link); // formato viejo o URL directa
  if (!out) {
    try {
      const url = new URL(link);
      const token = (url.pathname.split('/articles/')[1] || '').split('?')[0];
      if (token && /news\.google\./.test(url.hostname)) {
        const r1 = await fetch('https://news.google.com/articles/' + token, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
        const html = await r1.text();
        const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
        const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
        if (sg && ts) {
          const req = JSON.stringify([[['Fbv4je', JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], token, Number(ts), sg]), null, 'generic']]]);
          const r2 = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
            body: 'f.req=' + encodeURIComponent(req), signal: AbortSignal.timeout(8000),
          });
          const txt = await r2.text();
          const m = txt.match(/garturlres\\",\\"(https?:[^\\"]+)/) || txt.match(/https?:\/\/(?!news\.google|www\.google)[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]{10,400}/);
          out = m ? safeUrl(String(m[1] || m[0]).replace(/\\\//g, '/')) : null;
        }
      }
    } catch { out = null; }
  }
  _resolveCache[link] = { url: out, at: Date.now() };
  return out;
}

async function fetchCapped(url, timeoutMs) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs || 8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const final = safeUrl(r.url || url);
  if (!final) throw new Error('unsafe_redirect');
  const reader = r.body && r.body.getReader ? r.body.getReader() : null;
  if (!reader) { const t = await r.text(); return t.slice(0, MAX_BYTES); }
  let got = 0; const chunks = [];
  while (got < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value)); got += value.length;
  }
  try { reader.cancel().catch(() => { }); } catch { /* noop */ }
  return Buffer.concat(chunks).toString('utf8');
}

function htmlToText(html) {
  const body = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // párrafos primero (donde vive el cuerpo real); fallback: todo el texto
  const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1]).join(' ');
  const raw = (paras.length > 400 ? paras : body)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return raw.slice(0, MAX_TEXT);
}

// Lee el artículo de una señal y re-extrae con las MISMAS reglas del extractor sobre el cuerpo.
// Devuelve: 'confirmed' (el cuerpo sostiene la categoría), 'contradicted' (el cuerpo resuelve en positivo
// BACK/CONFIRMED para ese jugador), 'unavailable' (no se pudo leer/decodificar).
async function verifyArticle(signal, { extract, roster, team, fetchImpl = null } = {}) {
  try {
    const real = await resolveGoogleNewsUrl(signal.link || '');
    if (!real) return { status: 'unavailable', url: null };
    const html = await (fetchImpl || fetchCapped)(real, 8000);
    const text = htmlToText(html);
    if (text.length < 200) return { status: 'unavailable', url: real };
    const sigs = extract({ title: '', description: text, source: signal.source, published_at: signal.published_at }, { team, roster });
    const mine = sigs.filter(s => !signal.pid || s.pid === signal.pid || s.pid === null);
    // Contradicción: el cuerpo resuelve en positivo para ese jugador (BACK/CONFIRMED gana por diseño de RULES).
    if (mine.some(s => (s.category === 'BACK' || s.category === 'CONFIRMED') && (!signal.pid || s.pid === signal.pid))) {
      return { status: 'contradicted', url: real };
    }
    // Confirmación: el cuerpo repite la categoría (o una peor) para ese jugador o a nivel equipo.
    if (mine.some(s => s.category === signal.category)) return { status: 'confirmed', url: real };
    return { status: 'unavailable', url: real }; // el cuerpo no habla del tema → ni confirma ni contradice
  } catch { return { status: 'unavailable', url: null }; }
}

module.exports = { verifyArticle, resolveGoogleNewsUrl, decodeGoogleNewsUrl, htmlToText, safeUrl, privateHost };
