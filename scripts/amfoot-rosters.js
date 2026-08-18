// scripts/amfoot-rosters.js — LOS JUGADORES DE COLLEGE Y LA CFL (19-ago, reporte de Alexis).
//
// La pestaña de Jugadores es COMPARTIDA con la NFL, y al cambiar de liga se quedaba vacía porque el motor
// de fútbol americano menor nunca tuvo capa de jugadores: ni datos, ni ruta, ni pantalla. Esto la crea.
//
// FUENTE: ESPN (site.api), que cubre college football y la CFL con plantilla COMPLETA y headshot por
// jugador — es la misma casa de la que ya salen los marcadores en vivo del producto.
//   · college-football → /teams/<id>/roster  (nombre, dorsal, posición, altura, peso, año, headshot)
//   · cfl              → /teams/<id>/roster  (ídem)
// Las fotos se AUTO-HOSPEDAN en public/logos/amfoot/<liga>/ con el mismo criterio que el resto de la casa:
// el producto no depende de un hotlink que puede caerse.
//
// ⚠️ CORRE EN RENDER, NO EN EL SANDBOX. ESPN (Akamai) devuelve 403 a esta IP — comprobado con fetch Y con
// curl, con user-agent de navegador. Desde Render responde igual que siempre. Por eso esto va encadenado
// como job (GP_AMF_ROSTERS=1), como ya se hizo con las cosechas de LoL y Valorant.
//
// USO: node scripts/amfoot-rosters.js [--league=ncaaf|cfl|all] [--teams=200] [--photos=1]
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const LG = arg('league', 'all');
const MAXT = +arg('teams', 200);
const PHOTOS = arg('photos', '1') !== '0';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUTROOT = path.join(__dirname, '..', 'public', 'logos', 'amfoot');
const DATA = path.join(__dirname, '..', 'data', 'amfoot');

const ESPN = { ncaaf: 'college-football', cfl: 'cfl' };

async function get(url, { json = true, tries = 4 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: json ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.status === 403) throw new Error('403 (ESPN bloquea esta IP: esto corre en Render)');
      if (r.status === 429) { await sleep(15000); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === tries - 1) throw e; await sleep(2500 * (i + 1)); }
  }
  return null;
}

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function savePhoto(url, lg, id) {
  if (!url) return null;
  try {
    const buf = await get(url, { json: false, tries: 2 });
    if (!buf || buf.length < 900) return null;
    const dir = path.join(OUTROOT, lg);
    fs.mkdirSync(dir, { recursive: true });
    const ext = /\.jpe?g/i.test(url) ? 'jpg' : 'png';
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), buf);
    return `${id}.${ext}`;
  } catch { return null; }
}

async function league(lg) {
  const sport = ESPN[lg];
  const list = await get(`https://site.api.espn.com/apis/site/v2/sports/football/${sport}/teams?limit=500`);
  const teams = (((list && list.sports) || [])[0] || {}).leagues ? list.sports[0].leagues[0].teams || [] : [];
  console.log(`[amf:${lg}] equipos en ESPN: ${teams.length}`);
  const out = { league: lg, at: new Date().toISOString(), source: 'ESPN site.api (plantillas y headshots)', teams: {}, players: {} };
  let nP = 0, nF = 0, nT = 0;
  for (const wrap of teams.slice(0, MAXT)) {
    const tm = wrap.team || {};
    const rs = await get(`https://site.api.espn.com/apis/site/v2/sports/football/${sport}/teams/${tm.id}/roster`).catch(() => null);
    await sleep(500);
    const groups = (rs && rs.athletes) || [];
    // ESPN agrupa por unidad (offense/defense/specialTeams) o devuelve la lista plana según deporte
    const flat = groups.length && groups[0].items ? groups.flatMap((g) => (g.items || []).map((x) => ({ ...x, unit: g.position || g.text || null })))
      : groups;
    if (!flat.length) continue;
    nT++;
    out.teams[tm.id] = { id: tm.id, name: tm.displayName, abbr: tm.abbreviation, slug: slug(tm.displayName), n: flat.length };
    for (const a of flat) {
      const pid = String(a.id || '');
      if (!pid) continue;
      const rec = {
        id: pid, team_id: tm.id, team: tm.displayName,
        name: a.fullName || a.displayName || null,
        jersey: a.jersey != null ? String(a.jersey) : null,
        pos: (a.position && (a.position.abbreviation || a.position.name)) || null,
        unit: a.unit || null,
        ht: a.displayHeight || null, wt: a.displayWeight || null,
        year: (a.experience && (a.experience.displayValue || a.experience.abbreviation)) || null,
        hometown: (a.birthPlace && [a.birthPlace.city, a.birthPlace.state].filter(Boolean).join(', ')) || null,
        photo: null,
      };
      if (PHOTOS && a.headshot && a.headshot.href) {
        const f = await savePhoto(a.headshot.href, lg, pid);
        if (f) { rec.photo = f; nF++; }
        await sleep(60);
      }
      out.players[pid] = rec; nP++;
    }
    if (nT % 10 === 0) {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(path.join(DATA, `roster-${lg}.json`), JSON.stringify(out));
      console.log(`[amf:${lg}] ${nT} equipos · ${nP} jugadores · ${nF} caras`);
    }
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, `roster-${lg}.json`), JSON.stringify(out));
  console.log(`[amf:${lg}] LISTO: ${nT} equipos · ${nP} jugadores · ${nF} caras`);
}

(async () => {
  for (const lg of (LG === 'all' ? ['ncaaf', 'cfl'] : [LG])) {
    try { await league(lg); } catch (e) { console.log(`[amf:${lg}] falla: ${e.message}`); }
  }
  console.log('[amf] rosters LISTO');
})().catch((e) => { console.error(e); process.exit(1); });
