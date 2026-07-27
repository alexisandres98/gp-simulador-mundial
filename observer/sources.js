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

// IDIOMAS (26-jul): en ligas blandas la ventaja ES la información local — la prensa de Turku publica la
// lesión horas antes de que el mercado global la digiera, y casi nadie del mercado lee finés al minuto.
// Cada locale mapea a los parámetros hl/gl/ceid de Google News.
const LOCALES = {
  en: { hl: 'en-US', gl: 'US' }, es: { hl: 'es-419', gl: 'CO' },
  pt: { hl: 'pt-BR', gl: 'BR' }, fi: { hl: 'fi-FI', gl: 'FI' }, no: { hl: 'no-NO', gl: 'NO' },
  sv: { hl: 'sv-SE', gl: 'SE' }, da: { hl: 'da-DK', gl: 'DK' }, pl: { hl: 'pl-PL', gl: 'PL' },
  ru: { hl: 'ru-RU', gl: 'RU' }, de: { hl: 'de-DE', gl: 'DE' }, fr: { hl: 'fr-FR', gl: 'FR' },
  it: { hl: 'it-IT', gl: 'IT' },
};
// query ej: '"Spain national team" OR "seleccion espanola"' — lang: clave de LOCALES
async function googleNewsRss(query, lang) {
  const loc = LOCALES[lang] || LOCALES.en;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + ' when:2d')}&hl=${loc.hl}&gl=${loc.gl}&ceid=${loc.gl}:${lang}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`gnews rss HTTP ${r.status}`);
  return parseItems(await r.text());
}
// términos de búsqueda de bajas/lesiones por idioma (van en la QUERY; la extracción de señales tiene su
// propio vocabulario en extract.js)
const QUERY_TERMS = {
  en: '(injury OR doubt OR ruled out OR suspended OR illness OR lineup OR training)',
  es: '(lesion OR duda OR baja OR sancionado OR enfermo OR alineacion OR entrenamiento)',
  pt: '(lesao OR desfalque OR duvida OR suspenso OR machucado OR escalacao)',
  fi: '(loukkaantuminen OR sivussa OR kokoonpano OR sairastui)',
  no: '(skade OR skadet OR mister OR utestengt OR lagoppstilling)',
  sv: '(skada OR skadad OR missar OR avstangd OR startelva)',
  da: '(skade OR skadet OR misser OR karantaene OR startopstilling)',
  pl: '(kontuzja OR uraz OR nie zagra OR zawieszony OR sklad)',
  ru: '(травма OR не сыграет OR пропустит OR дисквалификация OR состав)',
  de: '(verletzt OR verletzung OR faellt aus OR gesperrt OR aufstellung)',
  fr: '(blesse OR blessure OR forfait OR suspendu OR compo)',
  it: '(infortunio OR squalificato OR in dubbio OR formazione OR indisponibile)',
};

// Queries por equipo: nombre EN para el feed EN y nombre ES para el feed ES, acotadas a selección.
function teamQueries(teamEn, teamEs) {
  return [
    { lang: 'en', q: `"${teamEn}" (injury OR doubt OR ruled out OR suspended OR illness OR lineup OR training) world cup` },
    { lang: 'es', q: `"${teamEs}" (lesion OR duda OR baja OR sancionado OR enfermo OR alineacion OR entrenamiento) mundial` },
  ];
}

// Queries por CLUB (F2.3, multiidioma 26-jul): EN + ES siempre + los idiomas LOCALES de la liga del club.
function clubQueries(name, extraLangs) {
  const langs = ['en', 'es'].concat((extraLangs || []).filter(l => QUERY_TERMS[l] && l !== 'en' && l !== 'es'));
  return langs.map(lang => ({ lang, q: `"${name}" ${QUERY_TERMS[lang]}` }));
}

module.exports = { googleNewsRss, teamQueries, clubQueries, parseItems, QUERY_TERMS, LOCALES };
