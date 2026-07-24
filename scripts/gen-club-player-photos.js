// gen-club-player-photos.js — F0.2 del plan de extensión: FOTOS OFICIALES de jugadores de clubes.
// Mismo mecanismo del Mundial (API-Football photo map, hotlink a media.api-sports.io):
//   1) por liga: AF /teams?league=<af_id>&season=<Y> → matchear equipos AF ↔ nuestros tm_ (TSA) por nombre
//   2) por equipo: AF /players/squads?team=<af_id> → matchear jugador AF ↔ pl_ (TSA roster) por nombre
//   3) salida: data/clubs/player-photos.json  { pl_id: { photo, af_id } }  +  data/clubs/af-team-map.json
// Resumible e idempotente (re-corre solo lo que falta). Uso:
//   API_FOOTBALL_KEY=... THESTATSAPI_KEY=... node scripts/gen-club-player-photos.js [liga ...]
'use strict';
const fs = require('fs');
const path = require('path');

const AFK = process.env.API_FOOTBALL_KEY || '';
const TSA = process.env.THESTATSAPI_KEY || '';
if (!AFK || !TSA) { console.error('faltan API_FOOTBALL_KEY / THESTATSAPI_KEY'); process.exit(1); }

// liga nuestra → { af: league id de API-Football, season: temporada AF }
const AF_LEAGUE = {
  brasileirao: { af: 71, season: 2026 }, ligamx: { af: 262, season: 2026 }, mls: { af: 253, season: 2026 },
  argentina: { af: 128, season: 2026 }, colombia: { af: 239, season: 2026 }, paraguay: { af: 250, season: 2026 },
  csl: { af: 169, season: 2026 }, kleague: { af: 292, season: 2026 }, j1: { af: 98, season: 2026 },
  premier: { af: 39, season: 2026 }, laliga: { af: 140, season: 2026 }, bundesliga: { af: 78, season: 2026 },
  seriea: { af: 135, season: 2026 }, ligue1: { af: 61, season: 2026 },
  brasilb: { af: 72, season: 2026 }, chile: { af: 265, season: 2026 }, noruega: { af: 103, season: 2026 },
  suecia: { af: 113, season: 2026 }, finlandia: { af: 244, season: 2026 }, irlanda: { af: 357, season: 2026 },
  dinamarca: { af: 119, season: 2026 }, polonia: { af: 106, season: 2026 }, rusia: { af: 235, season: 2026 },
  suiza: { af: 207, season: 2026 },
};
function norm(s) {
  let n = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|cd|sc|ac|afc|ec|sad|club|de)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}
// nombre de persona → clave laxa (sin espacios; los rosters difieren en iniciales/orden)
function pkey(s) { return norm(s).replace(/ /g, ''); }
function pTokens(s) { return new Set(norm(s).split(' ').filter(x => x.length >= 3)); }

const ROOT = path.join(__dirname, '..');
const OUT_PHOTOS = path.join(ROOT, 'data', 'clubs', 'player-photos.json');
const OUT_MAP = path.join(ROOT, 'data', 'clubs', 'af-team-map.json');
const RT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'clubs', 'ratings.json'), 'utf8'));
const photos = fs.existsSync(OUT_PHOTOS) ? JSON.parse(fs.readFileSync(OUT_PHOTOS, 'utf8')) : {};
const teamMap = fs.existsSync(OUT_MAP) ? JSON.parse(fs.readFileSync(OUT_MAP, 'utf8')) : {};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function af(pathq) {
  const r = await fetch('https://v3.football.api-sports.io' + pathq, { headers: { 'x-apisports-key': AFK }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  return (j && j.response) || [];
}
async function tsa(pathq) {
  const r = await fetch('https://api.thestatsapi.com/api/football' + pathq, { headers: { Authorization: 'Bearer ' + TSA }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  return (j && j.data) || j || [];
}

(async () => {
  const only = process.argv.slice(2);
  const leagues = Object.keys(AF_LEAGUE).filter(k => (!only.length || only.includes(k)) && RT.leagues[k]);
  let mapped = 0, unmatchedPlayers = 0;
  for (const lg of leagues) {
    const { af: afLeague, season } = AF_LEAGUE[lg];
    const L = RT.leagues[lg];
    // 1) equipos AF de la liga → match a tm_
    teamMap[lg] = teamMap[lg] || {};
    if (!Object.keys(teamMap[lg]).length) {
      let afTeams = await af(`/teams?league=${afLeague}&season=${season}`);
      if (!afTeams.length) afTeams = await af(`/teams?league=${afLeague}&season=${season - 1}`); // MX/torneos partidos
      const idx = {}; for (const [tid, t] of Object.entries(L.ratings || {})) idx[norm(t.name)] = tid;
      for (const row of afTeams) {
        const nm = row.team && row.team.name; if (!nm) continue;
        const n = norm(nm);
        let tid = idx[n] || null;
        if (!tid) { for (const k in idx) { if (k && (k.includes(n) || n.includes(k))) { tid = idx[k]; break; } } }
        if (!tid) { // solape de tokens
          const ke = new Set(n.split(' ').filter(Boolean)); let best = null, bs = 0;
          for (const k in idx) { const kk = new Set(k.split(' ').filter(Boolean)); let ov = 0; ke.forEach(x => { if (kk.has(x)) ov++; }); const sc = ov / Math.max(1, new Set([...ke, ...kk]).size); if (ov >= 1 && sc >= 0.5 && ov > bs) { bs = ov; best = idx[k]; } }
          tid = best;
        }
        if (tid) teamMap[lg][tid] = { af_id: row.team.id, af_name: nm };
      }
      fs.writeFileSync(OUT_MAP, JSON.stringify(teamMap, null, 1));
      console.log(`[${lg}] equipos AF↔TSA: ${Object.keys(teamMap[lg]).length}/${Object.keys(L.ratings || {}).length}`);
      await sleep(300);
    }
    // 2) por equipo: squad AF (fotos) ↔ roster TSA (pl_ ids)
    for (const [tid, m] of Object.entries(teamMap[lg])) {
      const done = Object.values(photos).some(p => p.team === tid); // ya procesado este equipo
      if (done) continue;
      const [sq, roster] = [await af(`/players/squads?team=${m.af_id}`), await tsa(`/teams/${tid}/players?per_page=60`)];
      const afPlayers = (sq[0] && sq[0].players) || [];
      if (!afPlayers.length || !Array.isArray(roster) || !roster.length) { await sleep(5200); continue; }
      // índice AF por clave laxa + apellido
      const afIdx = afPlayers.map(p => ({ id: p.id, name: p.name, photo: p.photo, key: pkey(p.name), toks: pTokens(p.name) }));
      let teamMatched = 0;
      for (const rp of roster) {
        const names = [rp.name, rp.short_name, (rp.first_name || '') + ' ' + (rp.last_name || '')].filter(Boolean);
        let hit = null;
        for (const nm of names) {
          const k = pkey(nm); if (!k) continue;
          hit = afIdx.find(a => a.key === k) || afIdx.find(a => a.key.includes(k) || k.includes(a.key));
          if (hit) break;
        }
        if (!hit) { // solape de tokens (apellidos)
          const toks = pTokens(rp.name + ' ' + (rp.last_name || ''));
          let best = null, bs = 0;
          for (const a of afIdx) { let ov = 0; toks.forEach(x => { if (a.toks.has(x)) ov++; }); if (ov > bs && ov >= 1) { bs = ov; best = a; } }
          if (best && bs >= 1) hit = best;
        }
        if (hit && hit.photo) { photos[rp.id] = { photo: hit.photo, af_id: hit.id, team: tid, name: rp.name }; teamMatched++; mapped++; }
        else unmatchedPlayers++;
      }
      console.log(`  [${lg}] ${m.af_name}: ${teamMatched}/${roster.length} fotos`);
      fs.writeFileSync(OUT_PHOTOS, JSON.stringify(photos));
      await sleep(5200); // TSA 12/min manda el ritmo
    }
  }
  console.log(`\nTOTAL: ${Object.keys(photos).length} jugadores con foto (${unmatchedPlayers} sin match esta pasada)`);
})();
