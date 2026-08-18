// scripts/esports-rosters.js — LAS CARAS DE LoL Y VALORANT (19-ago).
//
// Por qué existe aparte de esports-assets.js: el endpoint /players de bo3.gg ignora el filtro de disciplina
// (devuelve la MISMA tabla plana de 20.289 filas para LoL y para Valorant) y trae `team_id: null` en la
// mayoría de las filas. Es inservible para plantillas — comprobado, no supuesto. Cada juego necesita SU
// fuente:
//   · LoL      → API oficial de LoL Esports (esports-api.lolesports.com). Una llamada: 1.570 equipos con
//                plantilla completa, foto, rol y nombre real. Es la fuente que usa lolesports.com.
//   · Valorant → vlr.gg. No hay API: se lee el ranking por región para descubrir equipos (id+slug+escudo)
//                y luego la ficha de cada equipo para su plantilla (nick, nombre real, país, foto).
// Todo se AUTO-HOSPEDA en public/logos/es/<juego>/players/ y el manifiesto viaja en
// data/esports/<juego>/assets.json — mismo criterio que los escudos.
//
// USO: node scripts/esports-rosters.js [--game=lol|valorant|all] [--teams=200]
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const GAME = arg('game', 'all');
const TEAMS = +arg('teams', 240);
const UA = 'Mozilla/5.0 (compatible; GPSimulador/1.0; +https://gpsimulador.com)';
const LOL_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z'; // clave pública del portal de LoL Esports
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUTROOT = path.join(__dirname, '..', 'public', 'logos', 'es');

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '').replace(/^-|-$/g, '');

// variantes de nombre para cruzar catálogos distintos ("Team Liquid" ↔ "Liquid", "Gen.G" ↔ "geng")
function keys(name) {
  const n = String(name || '').trim();
  if (!n) return [];
  const out = new Set([slug(n)]);
  const noSuf = n.replace(/\s+(Esports|Esport|Gaming|Team|Club|eSports|E-Sports)$/i, '').trim();
  if (noSuf) out.add(slug(noSuf));
  const noPre = n.replace(/^(Team|TEAM)\s+/i, '').trim();
  if (noPre) out.add(slug(noPre));
  return [...out].filter(Boolean);
}

async function req(url, { json = true, tries = 4, headers = {} } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-encoding': 'gzip', ...headers },
        signal: AbortSignal.timeout(35000),
      });
      if (r.status === 429 || r.status === 503) { await sleep(45e3); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (json) return await r.json();
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; await sleep(2000 * (i + 1)); }
  }
  if (last) console.log('  (falla: ' + last.message + ' — ' + url.slice(0, 70) + ')');
  return null;
}

function loadManifest(game) {
  const p = path.join(__dirname, '..', 'data', 'esports', game, 'assets.json');
  try { return { p, m: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch { return { p, m: {} }; }
}

// los equipos que de verdad importan: los más activos del modelo, no los 5.294 del histórico
function myTeams(game, n) {
  const D = require(path.join(__dirname, '..', 'esports-engine', `${game}-data.js`));
  const M = D.load();
  const T = (M && M.teams) || {};
  return Object.values(T).filter((t) => t && t.name).sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, n);
}

async function savePhoto(url, dir, id) {
  if (!url) return null;
  const u = /^\/\//.test(url) ? 'https:' + url : url.replace(/^http:\/\//, 'https://');
  const buf = await req(u, { json: false, tries: 2 });
  if (!buf || buf.length < 700) return null;                    // los placeholders de 1x1 pesan menos
  const ext = /\.webp/i.test(u) ? 'webp' : /\.jpe?g/i.test(u) ? 'jpg' : 'png';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
  return `${id}.${ext}`;
}

// ─────────────────────────────────────────────────────────── LoL: API oficial
async function lol() {
  const teams = myTeams('lol', TEAMS);
  const idx = new Map();                                        // clave de nombre → equipo nuestro
  for (const t of teams) for (const k of keys(t.name)) if (!idx.has(k)) idx.set(k, t);

  const j = await req('https://esports-api.lolesports.com/persisted/gw/getTeams?hl=en-US', { headers: { 'x-api-key': LOL_KEY } });
  const src = (j && j.data && j.data.teams) || [];
  console.log(`[rosters:lol] catálogo oficial: ${src.length} equipos · míos a cubrir: ${teams.length}`);

  const { p, m } = loadManifest('lol');
  const players = m.players || {};
  const tlogos = m.teams || {};
  const dirP = path.join(OUTROOT, 'lol', 'players');
  const dirT = path.join(OUTROOT, 'lol');
  let nT = 0, nP = 0, nFace = 0, nCrest = 0;

  for (const s of src) {
    if (!s || !s.players || !s.players.length) continue;
    let mine = null;
    for (const k of [...keys(s.name), ...keys(s.code)]) if (idx.has(k)) { mine = idx.get(k); break; }
    if (!mine) continue;
    nT++;
    // escudo, si al nuestro le faltaba
    if (!tlogos[mine.id] && s.image) {
      const f = await savePhoto(s.image, dirT, mine.id);
      if (f) { tlogos[mine.id] = f; nCrest++; }
    }
    for (const pl of s.players.slice(0, 8)) {
      const id = String(pl.id || slug(pl.summonerName));
      if (!id) continue;
      const real = [pl.firstName, pl.lastName].filter(Boolean).join(' ') || null;
      const rec = players[id] = players[id] || {};
      rec.nick = pl.summonerName || rec.nick || ('#' + id);
      rec.team = mine.id; rec.role = pl.role || rec.role || null;
      if (real) rec.real = real;
      nP++;
      if (!rec.photo && pl.image) {
        const f = await savePhoto(pl.image, dirP, id);
        if (f) { rec.photo = f; nFace++; }
        await sleep(70);
      }
    }
  }
  fs.writeFileSync(p, JSON.stringify({ ...m, teams: tlogos, players,
    players_source: 'LoL Esports (esports-api.lolesports.com) — plantilla, rol, nombre real y foto' }));
  console.log(`[rosters:lol] equipos cruzados: ${nT} · jugadores: ${nP} · caras nuevas: ${nFace} · escudos nuevos: ${nCrest}`);
}

// ─────────────────────────────────────────────────────────── Valorant: vlr.gg
// No hay API. El ranking mundial trae, en una sola fila, el id del equipo, su nombre exacto y su escudo
// (`<td data-sort-value="NOMBRE" class="rank-item-team">`), así que se descubre desde ahí y sólo se abre la
// ficha de los equipos que SÍ cruzan con los nuestros. Ojo: el slug de la URL no es fiable (vlr sirve la
// ficha por id y reescribe el slug), por eso el cruce va por el nombre de la fila, nunca por la URL.
function vlrRows(html) {
  const s = html.toString('utf8');
  const out = [];
  // vlr sirve DOS maquetados de la misma tabla: el mundial la arma con <td data-sort-value class=...> y el
  // de cada región con <a href data-sort-value class=...>. En vez de una regex por maquetado, se busca la
  // marca `rank-item-team` y se lee la ventana alrededor: id, nombre y escudo están siempre ahí.
  const rx = /rank-item-team/g;
  let m;
  while ((m = rx.exec(s))) {
    const w = s.slice(Math.max(0, m.index - 420), m.index + 420);
    const id = (w.match(/href="\/team\/(\d+)\//) || [])[1];
    const name = (w.match(/data-sort-value="([^"]{2,})"/) || [])[1];
    const crest = (w.match(/<img[^>]+src="([^"]+)"/) || [])[1];
    if (!id || !name) continue;
    if (/^\d+(\.\d+)?$/.test(name)) continue;                     // el data-sort-value del rating, no el del equipo
    out.push({ id, name: name.replace(/&amp;/g, '&').trim(), crest: crest || null });
  }
  return out;
}

async function vlrDiscover() {
  const pages = ['', '/europe', '/north-america', '/asia-pacific', '/korea', '/brazil', '/china', '/japan', '/oceania', '/mena', '/game-changers', '/collegiate'];
  const found = new Map();
  for (const q of pages) {
    const html = await req(`https://www.vlr.gg/rankings${q}`, { json: false });
    if (html) for (const r of vlrRows(html)) if (!found.has(r.id)) found.set(r.id, r);
    await sleep(900);
  }
  console.log(`[rosters:valorant] ranking mundial: ${found.size} equipos con id, nombre y escudo`);
  return [...found.values()];
}

function parseRoster(html) {
  const s = html.toString('utf8');
  const title = (s.match(/<h1 class="wf-title"[^>]*>([^<]+)<\/h1>/) || [])[1];
  const crest = (s.match(/team-header-logo"[\s\S]{0,120}?<img[^>]+src="([^"]+)"/) || [])[1];
  // sólo la sección "players": lo que viene después de la etiqueta "staff" son entrenadores y managers
  const staffAt = s.search(/wf-module-label[^>]*>\s*staff/i);
  const body = staffAt > 0 ? s.slice(0, staffAt) : s;
  const out = [];
  const rx = /<div class="team-roster-item">([\s\S]*?)<\/a>\s*<\/div>/g;
  const txt = (v) => (v ? v.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null);
  let m;
  while ((m = rx.exec(body))) {
    const blk = m[1];
    const id = (blk.match(/href="\/player\/(\d+)\//) || [])[1];
    const alias = txt((blk.match(/team-roster-item-name-alias"[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
    if (!id || !alias) continue;
    const img = (blk.match(/<img[^>]+src="([^"]+)"/) || [])[1];
    const flag = (blk.match(/class="flag mod-([a-z]{2})"/) || [])[1];
    out.push({
      id, nick: alias,
      real: txt((blk.match(/team-roster-item-name-real"[^>]*>([\s\S]*?)<\/div>/) || [])[1]),
      role: txt((blk.match(/team-roster-item-name-role"[^>]*>([\s\S]*?)<\/div>/) || [])[1]),
      country: flag ? flag.toUpperCase() : null,
      img: img && !/owl_default|placeholder|\/base\//i.test(img) ? img : null,
    });
  }
  return { name: title && title.trim(), crest: crest || null, players: out };
}

async function valorant() {
  const teams = myTeams('valorant', TEAMS);
  const idx = new Map();
  for (const t of teams) for (const k of keys(t.name)) if (!idx.has(k)) idx.set(k, t);

  const disc = await vlrDiscover();
  const { p, m } = loadManifest('valorant');
  const players = m.players || {};
  const tlogos = m.teams || {};
  const link = m.vlr_team || {};
  const dirP = path.join(OUTROOT, 'valorant', 'players');
  const dirT = path.join(OUTROOT, 'valorant');
  let nT = 0, nP = 0, nFace = 0, nCrest = 0;

  const save = () => fs.writeFileSync(p, JSON.stringify({ ...m, teams: tlogos, players, vlr_team: link,
    players_source: 'vlr.gg (ficha de equipo) — plantilla, rol, nombre real, país y foto' }));

  const hits = disc.map((d) => {
    let mine = null;
    for (const k of keys(d.name)) if (idx.has(k)) { mine = idx.get(k); break; }
    return mine ? { d, mine } : null;
  }).filter(Boolean);
  console.log(`[rosters:valorant] cruzan con mi catálogo: ${hits.length} equipos · míos a cubrir: ${teams.length}`);

  for (const { d, mine } of hits) {
    if (!tlogos[mine.id] && d.crest) { const f = await savePhoto(d.crest, dirT, mine.id); if (f) { tlogos[mine.id] = f; nCrest++; } }
    const html = await req(`https://www.vlr.gg/team/${d.id}/-`, { json: false });
    await sleep(800);
    if (!html) continue;
    const r = parseRoster(html);
    if (!r.players.length) continue;
    nT++; link[mine.id] = d.id;
    for (const pl of r.players.slice(0, 8)) {
      const rec = players[pl.id] = players[pl.id] || {};
      rec.nick = pl.nick; rec.team = mine.id;
      if (pl.real) rec.real = pl.real;
      if (pl.role) rec.role = pl.role;
      if (pl.country) rec.country = pl.country;
      nP++;
      if (!rec.photo && pl.img) { const f = await savePhoto(pl.img, dirP, pl.id); if (f) { rec.photo = f; nFace++; } await sleep(110); }
    }
    if (nT % 15 === 0) { save(); console.log(`[rosters:valorant] ${nT} equipos · ${nP} jugadores · ${nFace} caras`); }
  }
  save();
  console.log(`[rosters:valorant] equipos: ${nT} · jugadores: ${nP} · caras nuevas: ${nFace} · escudos nuevos: ${nCrest}`);
}

(async () => {
  if (GAME === 'lol' || GAME === 'all') await lol();
  if (GAME === 'valorant' || GAME === 'all') await valorant();
  console.log('[rosters] LISTO');
})().catch((e) => { console.error(e); process.exit(1); });
