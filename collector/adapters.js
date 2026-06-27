// collector/adapters.js — Fase O.1 §4. Adapters de recolección (RSS/Atom/JSON) sobre el fetch endurecido.
// PURO el parseo (regex, sin deps). El fetch pasa por security (SSRF+allowlist). Devuelve items normalizados.
'use strict';
const sec = require('./security');

const dec = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')); return m ? dec(m[1]) : null; };

// parseRss(xml) → [{title, link, published_at, summary}]
function parseFeed(xml) {
  const out = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    let link = tag(b, 'link');
    if (isAtom && !link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : null; }
    const title = tag(b, 'title');
    const published = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const summary = sec.sanitizeHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || '', 4000);
    if (title || link) out.push({ title: title || '', link: link || null, published_at: published ? safeDate(published) : null, summary });
  }
  return out;
}
function safeDate(s) { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }

// fetchFeed(url, opts) → { ok, notModified?, items, etag, lastModified, status, contentHash, reason }
async function fetchFeed(url, { allowlist = [], etag = null, lastModified = null } = {}) {
  const r = await sec.safeFetch(url, { allowlist, etag, lastModified });
  if (!r.ok) return { ok: false, status: r.status, reason: r.reason };
  if (r.notModified) return { ok: true, notModified: true, items: [], etag: r.etag, lastModified: r.lastModified, status: 304 };
  const items = parseFeed(r.body || '');
  return { ok: true, items, etag: r.etag, lastModified: r.lastModified, status: r.status, contentHash: r.contentHash, contentType: r.contentType };
}

module.exports = { parseFeed, fetchFeed };
