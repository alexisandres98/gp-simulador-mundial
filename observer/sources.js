// observer/sources.js — Fuentes de la capa de observación: Google News RSS por equipo (EN + ES).
// SIN KEY y gratis (es un feed RSS público). Se es EDUCADO con la fuente: el server la consulta cada
// ~3h por equipo VIVO (≤8 equipos en eliminatorias → ~130 requests/día en total) y cachea en db.json.
// Parser RSS mínimo por regex (Node puro, sin dependencias, como todo el repo).
'use strict';

const UA = 'Mozilla/5.0 (compatible; GPSimulador/1.0)';

function parseItems(xml) {
  const items = [];
  const blocks = String(xml || '').split(/<item>/).slice(1);
  const grab = (b, tag) => { const m = b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')); return m ? m[1].trim() : null; };
  const clean = s => String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
  for (const b of blocks.slice(0, 30)) {
    items.push({
      title: clean(grab(b, 'title')),
      link: clean(grab(b, 'link')),
      source: clean(grab(b, 'source')),
      description: clean(grab(b, 'description')),
      published_at: (() => { const d = clean(grab(b, 'pubDate')); const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toISOString() : null; })(),
    });
  }
  return items.filter(i => i.title);
}

// query ej: '"Spain national team" OR "seleccion espanola"' — lang 'en' | 'es'
async function googleNewsRss(query, lang) {
  const hl = lang === 'es' ? 'es-419' : 'en-US';
  const gl = lang === 'es' ? 'CO' : 'US';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:2d')}&hl=${hl}&gl=${gl}&ceid=${gl}:${lang}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`gnews rss HTTP ${r.status}`);
  return parseItems(await r.text());
}

// Queries por equipo: nombre EN para el feed EN y nombre ES para el feed ES, acotadas a selección.
function teamQueries(teamEn, teamEs) {
  return [
    { lang: 'en', q: `"${teamEn}" (injury OR doubt OR ruled out OR suspended OR illness OR lineup OR training) world cup` },
    { lang: 'es', q: `"${teamEs}" (lesion OR duda OR baja OR sancionado OR enfermo OR alineacion OR entrenamiento) mundial` },
  ];
}

// Queries por CLUB (F2.3): nombre universal, EN + ES, sin el sufijo "world cup"/"mundial" (es liga de clubes).
function clubQueries(name) {
  return [
    { lang: 'en', q: `"${name}" (injury OR doubt OR ruled out OR suspended OR illness OR lineup OR training)` },
    { lang: 'es', q: `"${name}" (lesion OR duda OR baja OR sancionado OR enfermo OR alineacion OR entrenamiento)` },
  ];
}

module.exports = { googleNewsRss, teamQueries, clubQueries, parseItems };
