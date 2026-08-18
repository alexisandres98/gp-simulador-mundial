// scripts/esports-assets.js — LA IDENTIDAD VISUAL DE LOS ESPORTS (19-ago, pedido de Alexis).
//
// CS2 llegó con escudos porque su proveedor los publica; LoL, Valorant y Dota 2 se veían como una pila de
// texto gris. Esto los pone a la par y por encima:
//   · ESCUDOS de equipo (los tres juegos) por Liquipedia — la convención de nombres de archivo es estable
//     (`<Equipo> allmode.png` / darkmode / lightmode / `<Equipo>logo std.png`), así que se consulta por
//     LOTES de 45 títulos en una sola llamada de imageinfo y se descarga la miniatura de 200px.
//   · IDENTIDAD DE JUGADOR de Dota 2 por OpenDota /proPlayers: nombre real y avatar de Steam para 5.200
//     profesionales — de paso arregla los nicks "#518198" que enseñaba la ficha.
// Todo se AUTO-HOSPEDA en public/logos/es/<juego>/ (mismo criterio que los escudos de la CFL): el producto
// no depende de un hotlink que puede caerse, y el manifiesto viaja en data/esports/<juego>/assets.json.
//
// USO: node scripts/esports-assets.js [--game=lol|valorant|dota2|all] [--limit=400] [--players]
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const GAME = arg('game', 'all');
const LIMIT = +arg('limit', 400);
const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com) esports-asset-fetch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUTROOT = path.join(__dirname, '..', 'public', 'logos', 'es');

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function get(url, { json = true, tries = 5 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-encoding': 'gzip' }, signal: AbortSignal.timeout(35000) });
      if (r.status === 429 || r.status === 503) { console.log('  (limitado: espero 90 s)'); await sleep(90e3); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; await sleep(3000 * (i + 1)); }
  }
  throw last || new Error('agotado');
}

// candidatos de nombre de archivo para un equipo (la convención de Liquipedia, en orden de preferencia)
function candidates(name) {
  const n = String(name).replace(/_/g, ' ').trim();
  const variants = new Set([n]);
  const noSuffix = n.replace(/\s+(Esports|Esport|Gaming|Team|Club|eSports)$/i, '').trim();
  if (noSuffix && noSuffix !== n) variants.add(noSuffix);
  const noPrefix = n.replace(/^Team\s+/i, '').trim();
  if (noPrefix && noPrefix !== n) variants.add(noPrefix);
  const out = [];
  for (const v of variants) {
    // dos candidatos por variante: la convención cubre >90 % con allmode/darkmode y cada llamada de más
    // a Liquipedia cuesta 30 s de espera. Menos candidatos, más equipos por lote.
    out.push(`File:${v} allmode.png`, `File:${v} darkmode.png`);
  }
  return out;
}

// ── ESCUDOS por bo3.gg: el MISMO proveedor que ya viste en CS2, que resulta cubrir los cuatro juegos
// (disciplinas 1=CS2, 2=Valorant, 3=LoL, 4=Dota 2). Una sola paginación por juego y a casa: sin depender
// de un wiki que limita por IP, y con la clase de derechos que la casa ya tiene revisada para CS2.
const BO3_DISC = { valorant: 2, lol: 3, dota2: 4 };

async function teamLogos(game, teams) {
  const B = require(path.join(__dirname, '..', 'data-providers', 'esports', 'bo3.js'));
  const disc = BO3_DISC[game];
  const dir = path.join(OUTROOT, game);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(__dirname, '..', 'data', 'esports', game, 'assets.json');
  const prev = (() => { try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return {}; } })();
  const manifest = prev.teams || {};

  // 1) catálogo del proveedor: nombre normalizado → imagen
  const byName = new Map();
  let offset = 0, total = null;
  for (;;) {
    const j = await B.req(`/teams?page[limit]=100&page[offset]=${offset}&filter[teams.discipline_id][eq]=${disc}`);
    const rows = (j && j.results) || [];
    if (total == null) total = (j && j.total && j.total.count) || 0;
    if (!rows.length) break;
    for (const t of rows) {
      if (!t.image_url) continue;
      const k = slug(t.name);
      if (k && !byName.has(k)) byName.set(k, t.image_url);
    }
    offset += rows.length;
    if (offset >= total) break;
    await sleep(300);
  }
  console.log(`[assets:${game}] catálogo del proveedor: ${byName.size} equipos con escudo (de ${total})`);

  // 2) cruzar con nuestra base y auto-hospedar
  let saved = 0, miss = 0;
  for (const t of teams) {
    if (manifest[t.id]) continue;
    const cands = [slug(t.name), slug(String(t.name).replace(/\s+(Esports|Esport|Gaming|Team|Club)$/i, '')), slug(String(t.name).replace(/^Team\s+/i, ''))];
    let url = null;
    for (const c of cands) { if (c && byName.has(c)) { url = byName.get(c); break; } }
    if (!url) { manifest[t.id] = null; miss++; continue; }
    try {
      const buf = await get(url, { json: false, tries: 2 });
      if (buf && buf.length > 300) {
        const ext = /webp/i.test(url) ? 'webp' : /\.jpe?g/i.test(url) ? 'jpg' : 'png';
        fs.writeFileSync(path.join(dir, `${t.id}.${ext}`), buf);
        manifest[t.id] = `${t.id}.${ext}`; saved++;
      } else manifest[t.id] = null;
    } catch { manifest[t.id] = null; }
    await sleep(120);
  }
  console.log(`[assets:${game}] escudos guardados: ${saved} · sin coincidencia: ${miss} · manifiesto: ${Object.values(manifest).filter(Boolean).length}/${Object.keys(manifest).length}`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ ...prev, at: new Date().toISOString(),
    source: 'bo3.gg (mismo proveedor que los escudos de CS2) — auto-hospedados', teams: manifest }));
}

// ── Dota 2: escudos desde OpenDota (/api/teams trae logo_url para ~900 equipos, UNA sola llamada) ──────
async function dotaLogos(teams) {
  const all = await get('https://api.opendota.com/api/teams');
  const byId = new Map(all.map((t) => ['t' + t.team_id, t]));
  const dir = path.join(OUTROOT, 'dota2');
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(__dirname, '..', 'data', 'esports', 'dota2', 'assets.json');
  const prev = (() => { try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return {}; } })();
  const manifest = prev.teams || {};
  let saved = 0;
  for (const t of teams) {
    if (manifest[t.id]) continue;
    const od = byId.get(t.id);
    if (!od || !od.logo_url) { manifest[t.id] = null; continue; }
    try {
      const buf = await get(od.logo_url, { json: false, tries: 2 });
      if (buf && buf.length > 300) {
        const ext = /\.jpe?g($|\?)/i.test(od.logo_url) ? 'jpg' : 'png';
        fs.writeFileSync(path.join(dir, `${t.id}.${ext}`), buf);
        manifest[t.id] = `${t.id}.${ext}`; saved++;
      } else manifest[t.id] = null;
    } catch { manifest[t.id] = null; }
    await sleep(150);
  }
  console.log(`[assets:dota2] escudos guardados: ${saved} · manifiesto: ${Object.values(manifest).filter(Boolean).length}/${Object.keys(manifest).length}`);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ ...prev, at: new Date().toISOString(),
    source: 'OpenDota /api/teams (logo_url) — escudos de equipo auto-hospedados', teams: manifest }));
}

// ── Dota 2: identidad y avatar de jugador (OpenDota /proPlayers) ───────────────────────────────────────
async function dotaPlayers() {
  const pro = await get('https://api.opendota.com/api/proPlayers');
  const dir = path.join(OUTROOT, 'dota2', 'players');
  fs.mkdirSync(dir, { recursive: true });
  const PSp = path.join(__dirname, '..', 'data', 'esports', 'dota2', 'player-stats.json');
  const PS = JSON.parse(fs.readFileSync(PSp, 'utf8'));
  const mine = new Set(Object.keys(PS.players || {}));
  const idx = {}; let saved = 0, named = 0;
  for (const p of pro) {
    const id = String(p.account_id);
    if (!mine.has(id)) continue;
    const nick = p.name || p.personaname || null;
    if (nick) { idx[id] = { nick, country: p.country_code || null, team_id: p.team_id || null }; named++; }
    if (p.avatarfull) {
      try {
        const buf = await get(p.avatarfull, { json: false, tries: 2 });
        if (buf && buf.length > 300) { fs.writeFileSync(path.join(dir, id + '.jpg'), buf); (idx[id] = idx[id] || {}).photo = id + '.jpg'; saved++; }
      } catch { }
      await sleep(120);
    }
  }
  console.log(`[assets:dota2] jugadores con nombre real: ${named} · con avatar: ${saved} (de ${mine.size} en la base)`);
  const ap = path.join(__dirname, '..', 'data', 'esports', 'dota2', 'assets.json');
  const prev = (() => { try { return JSON.parse(fs.readFileSync(ap, 'utf8')); } catch { return {}; } })();
  fs.writeFileSync(ap, JSON.stringify({ ...prev, players_at: new Date().toISOString(),
    players_source: 'OpenDota /proPlayers (nombre y avatar de Steam)', players: idx }));
}

(async () => {
  const games = GAME === 'all' ? ['lol', 'valorant', 'dota2'] : [GAME];
  for (const g of games) {
    const D = require(path.join(__dirname, '..', 'esports-engine', `${g}-data.js`));
    const d = D.load();
    if (!d.available) { console.log(`[assets:${g}] base no disponible`); continue; }
    // LOS EQUIPOS QUE EL PRODUCTO ENSEÑA, no los que más filas tienen: el ranking del circuito principal
    // primero (ya viene filtrado por tier-1) y detrás los de más historial, sin repetir.
    const seen = new Set(); const teams = [];
    for (const r of ((d.rankings && d.rankings.rows) || [])) { if (!seen.has(r.id)) { seen.add(r.id); teams.push({ id: r.id, name: (r.team || {}).name || r.id }); } }
    for (const t of Object.values(d.teams).sort((a, b) => (b.n || 0) - (a.n || 0))) {
      if (teams.length >= LIMIT) break;
      if (!seen.has(t.id)) { seen.add(t.id); teams.push({ id: t.id, name: t.name }); }
    }
    await teamLogos(g, teams);
    // Dota 2 tiene DOS proveedores de escudo: bo3.gg cubre la mayoría y OpenDota completa los que faltan.
    if (g === 'dota2') await dotaLogos(teams);
  }
  if (process.argv.includes('--players') || GAME === 'all' || GAME === 'dota2') await dotaPlayers();
  console.log('[assets] LISTO');
})().catch((e) => { console.error('[assets] FALLO:', e.message); process.exit(1); });
