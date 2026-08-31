// scripts/cfl-rosters.js — LAS PLANTILLAS DE LA CFL, DE LA FUENTE QUE SÍ LAS TIENE (31-ago, orden de Alexis:
// "vamos a buscar esa fuente y completar esa parte").
//
// ESPN lista los nueve equipos de la CFL y devuelve los grupos de posición VACÍOS en todos — ese es el gap
// documentado por scripts/amfoot-rosters.js. La fuente que sí publica plantilla completa son las webs
// OFICIALES de los nueve clubes (misma red de la liga, mismo CMS): /roster/ trae una tabla limpia con
// NO · NAME · POS · A/N/G (americano/nacional/global) · HT · WT · AGE · COLLEGE. Sin headshots (la tabla
// no los trae): la ficha cae a iniciales, como tenis sin foto.
//
// SALIDA: el MISMO roster-cfl.json que espera amfoot-engine/store.js (rosterOf/playersDirectory), con
// `players` keyed por id sintético estable y `team` con el nombre EXACTO del motor (para que la ficha
// cruce con teamsDirectory por nombre). Escribe en disco persistente si existe; si no, al repo.
//
// USO: node scripts/cfl-rosters.js
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DISK = process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : '';
const DATA = (DISK && fs.existsSync(DISK)) ? path.join(DISK, 'amfoot')
  : (fs.existsSync('/data') ? '/data/amfoot' : path.join(__dirname, '..', 'data', 'amfoot'));

// los nueve clubes: dominio oficial + nombre e id EXACTOS del motor (data/amfoot ratings)
const TEAMS = [
  { abbr: 'BC', name: 'BC Lions', url: 'https://www.bclions.com/roster/' },
  { abbr: 'CGY', name: 'Calgary Stampeders', url: 'https://www.stampeders.com/roster/' },
  { abbr: 'EDM', name: 'Edmonton Elks', url: 'https://www.goelks.com/roster/' },
  { abbr: 'SSK', name: 'Saskatchewan Roughriders', url: 'https://www.riderville.com/roster/' },
  { abbr: 'WPG', name: 'Winnipeg Blue Bombers', url: 'https://www.bluebombers.com/roster/' },
  { abbr: 'HAM', name: 'Hamilton Tiger-Cats', url: 'https://www.ticats.ca/roster/' },
  { abbr: 'TOR', name: 'Toronto Argonauts', url: 'https://www.argonauts.ca/roster/' },
  { abbr: 'OTT', name: 'Ottawa Redblacks', url: 'https://www.ottawaredblacks.com/roster/' },       // redblacks.com es un lander aparcado
  { abbr: 'MTL', name: 'Montreal Alouettes', url: 'https://www.montrealalouettes.com/alignement/' }, // la web de los Alouettes vive en francés
];

const NAT = { A: 'Americano', N: 'Nacional', G: 'Global' };
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&rsquo;/g, "'")
  .replace(/&quot;/g, '"').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// "AMOS, DaShaun" → "DaShaun Amos"; capitaliza el apellido que viene en mayúsculas sin romper "McX"/"O'X"
function fixName(raw) {
  const m = String(raw || '').match(/^\s*([^,]+),\s*(.+)$/);
  if (!m) return strip(String(raw || ''));
  const last = m[1].trim(), first = m[2].trim();
  const cap = (w) => w.length <= 2 && w === w.toUpperCase() && !/[.'-]/.test(w) ? w
    : w.replace(/(^|[-'\s]|Mc|Mac)([a-z])/g, (x, p, c) => p + c.toUpperCase())
      .replace(/^([A-Z])([A-Z'’-]*[A-Z][a-z]*)$/, (x) => x[0] + x.slice(1).toLowerCase())
      .replace(/^([A-Z][a-z]*)$/, (x) => x);
  const lastFixed = last.split(/\s+/).map((w) => (w === w.toUpperCase() ? cap(w[0] + w.slice(1).toLowerCase()) : w)).join(' ')
    .replace(/\bmc(\w)/gi, (x, c) => 'Mc' + c.toUpperCase())
    .replace(/\bo'(\w)/gi, (x, c) => "O'" + c.toUpperCase());
  return `${first} ${lastFixed}`;
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { if (i === tries - 1) throw e; await sleep(2500 * (i + 1)); }
  }
  return null;
}

// las páginas traen varias tablas (activos, práctica, lesionados…): se leen TODAS las filas con pinta de
// jugador (nº + "APELLIDO, Nombre" + posición) y se deduplica por nombre — un jugador listado dos veces
// es el mismo jugador.
function parseRoster(html) {
  const out = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(strip);
    if (cells.length < 4) continue;
    // forma canónica: [NO, foto?, NAME, POS, A/N/G, HT, WT, AGE, COLLEGE] — la col de foto puede no existir
    const cs = cells.filter((c, i) => !(i === 1 && c === ''));
    const no = cs[0];
    if (!/^\d{1,3}$/.test(no)) continue;
    const name = cs[1] || '';
    if (!/,/.test(name) || /^(NO|NAME)$/i.test(name)) continue;
    out.push({
      jersey: no, name: fixName(name), pos: cs[2] || null,
      nat: NAT[(cs[3] || '').toUpperCase()] || null,
      ht: cs[4] || null, wt: cs[5] || null, age: cs[6] || null, college: cs[7] || null,
    });
  }
  const seen = new Set(), ded = [];
  for (const p of out) { const k = slug(p.name); if (seen.has(k)) continue; seen.add(k); ded.push(p); }
  return ded;
}

// FALLBACK: la plantilla de Wikipedia (Template:<Equipo>_roster). Ottawa migró al CMS nuevo de la liga
// (Nuxt renderizado en cliente: la página llega sin tabla) y esta vía es node-pura y corre en Render.
// Formato: {{CFL player|NN|I/N/G|[[link|Nombre]]}} agrupado bajo '''Posición''' en negrita.
const WIKI_POS = { quarterbacks: 'QB', receivers: 'WR', 'running backs': 'RB', fullbacks: 'FB',
  'offensive linemen': 'OL', 'defensive linemen': 'DL', linebackers: 'LB', 'defensive backs': 'DB',
  kickers: 'K', punters: 'P', 'special teams': 'ST', 'long snappers': 'LS' };
const WIKI_NAT = { I: 'Americano', N: 'Nacional', G: 'Global' };
async function wikiRoster(teamName) {
  const title = `Template:${teamName.replace(/ /g, '_')}_roster`;
  const raw = await get(`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`);
  if (!raw) return [];
  const rows = [];
  let pos = null;
  for (const line of raw.split('\n')) {
    const h = line.match(/'''([A-Za-z ]+)'''/);
    if (h) { const k = h[1].trim().toLowerCase(); if (WIKI_POS[k]) pos = WIKI_POS[k]; }
    const m = line.match(/\{\{CFL player\|(?:&nbsp;)?\s*(\d{1,3})\|([INGX])\|\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/i);
    if (!m) continue;
    rows.push({ jersey: m[1], name: strip(m[3]), pos, nat: WIKI_NAT[m[2].toUpperCase()] || null,
      ht: null, wt: null, age: null, college: null });
  }
  return rows;
}

(async () => {
  const out = { league: 'cfl', at: new Date().toISOString(), source: 'webs oficiales de los 9 clubes de la CFL (+ Wikipedia donde el club migró al CMS nuevo)', teams: {}, players: {} };
  let nP = 0, fails = [];
  for (const T of TEAMS) {
    let html = null;
    try { html = await get(T.url); } catch (e) { html = null; }
    let rows = parseRoster(html || '');
    let via = 'club';
    if (!rows.length) {
      try { rows = await wikiRoster(T.name); via = 'wikipedia'; } catch { rows = []; }
    }
    if (!rows.length) { fails.push(`${T.abbr}: 0 filas (club y wikipedia)`); continue; }
    const tid = 'cfl-' + T.abbr.toLowerCase();
    out.teams[tid] = { id: tid, name: T.name, abbr: T.abbr, slug: slug(T.name), n: rows.length };
    for (const p of rows) {
      const pid = `${tid}-${slug(p.name)}`;
      out.players[pid] = {
        id: pid, team_id: tid, team: T.name,
        name: p.name, jersey: p.jersey, pos: p.pos,
        unit: p.nat,                       // americano/nacional/global — el dato propio de esta liga
        ht: p.ht, wt: p.wt,
        year: p.age ? `${p.age} años` : null,
        hometown: p.college || null,       // la tabla oficial trae el college, no la ciudad
        photo: null,                       // las webs de los clubes no exponen headshot en la tabla
      };
      nP++;
    }
    console.log(`[cfl] ${T.abbr}: ${rows.length} jugadores (${via})`);
    await sleep(700);
  }
  if (nP < 300 || Object.keys(out.teams).length < 7) {
    console.error(`[cfl] cosecha corta (${nP} jugadores, ${Object.keys(out.teams).length} equipos) — NO se escribe. Fallos: ${fails.join(' · ') || 'ninguno'}`);
    process.exit(1);
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'roster-cfl.json'), JSON.stringify(out));
  console.log(`[cfl] LISTO: ${Object.keys(out.teams).length} equipos · ${nP} jugadores → ${path.join(DATA, 'roster-cfl.json')}${fails.length ? ` · fallos: ${fails.join(' · ')}` : ''}`);
})();
