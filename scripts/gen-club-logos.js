// gen-club-logos.js — descarga los logos OFICIALES de clubes y ligas (ESPN CDN) y los self-hostea en
// public/logos/, MISMA línea que las banderas (/flags/) y las casas (/books/): tile cuadrado, cache inmutable.
// Club:  public/logos/<tm_id>.png   (nuestros ids de TheStatsAPI, matcheados por nombre a ESPN)
// Liga:  public/logos/league-<key>.png
// Uso:   node scripts/gen-club-logos.js            (todas las ligas)
//        node scripts/gen-club-logos.js brasileirao mls   (solo esas)
'use strict';
const fs = require('fs');
const path = require('path');

const CLUB_ESPN = { ligamx: 'mex.1', brasileirao: 'bra.1', mls: 'usa.1', argentina: 'arg.1', colombia: 'col.1', paraguay: 'par.1', csl: 'chn.1', kleague: 'kor.1', j1: 'jpn.1', premier: 'eng.1', laliga: 'esp.1', bundesliga: 'ger.1', seriea: 'ita.1', ligue1: 'fra.1' };
// logo de LIGA por código ESPN (leaguelogos id) — del scoreboard; fijos para no depender de una ventana con partidos
const LEAGUE_LOGO_ID = { 'bra.1': 85, 'mex.1': 22, 'usa.1': 19, 'arg.1': 1, 'col.1': 1543, 'par.1': 1892, 'chn.1': 2350, 'jpn.1': 2199, 'eng.1': 23, 'esp.1': 15, 'ger.1': 10, 'ita.1': 12, 'fra.1': 9 };
const CLUB_ALIAS = { 'athletico pr': 'athletico paranaense', 'atletico mg': 'atletico mineiro', 'atletico go': 'atletico goianiense', 'red bull new york': 'new york red bulls', 'lafc': 'los angeles', 'dc united': 'd c united', 'atletico junior': 'junior', 'bayern munich': 'bayern munchen', 'cologne': 'koln', 'hamburg sv': 'hamburger sv', 'monchengladbach': 'borussia monchengladbach' };
function clubNorm(s) {
  let n = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|cd|sc|ac|afc|ec|sad)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return CLUB_ALIAS[n] || n;
}
const OUT = path.join(__dirname, '..', 'public', 'logos');
fs.mkdirSync(OUT, { recursive: true });
const RT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clubs', 'ratings.json'), 'utf8'));

async function dl(url, dest) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200) return false; // placeholder/roto
    fs.writeFileSync(dest, buf);
    return true;
  } catch { return false; }
}

(async () => {
  const only = process.argv.slice(2);
  const leagues = Object.keys(CLUB_ESPN).filter(k => (!only.length || only.includes(k)) && RT.leagues[k]);
  let clubsOk = 0, clubsMiss = 0, lgsOk = 0;
  const missNames = [];
  for (const lgKey of leagues) {
    const code = CLUB_ESPN[lgKey], L = RT.leagues[lgKey];
    // logo de liga
    const lid = LEAGUE_LOGO_ID[code];
    if (lid && await dl(`https://a.espncdn.com/i/leaguelogos/soccer/500/${lid}.png`, path.join(OUT, 'league-' + lgKey + '.png'))) lgsOk++;
    // índice nombre → tm_id
    const idx = {};
    for (const [tid, t] of Object.entries(L.ratings || {})) idx[clubNorm(t.name)] = tid;
    const matchId = (name) => {
      const n = clubNorm(name);
      if (idx[n]) return idx[n];
      for (const k in idx) { if (k && (k === n || k.includes(n) || n.includes(k))) return idx[k]; }
      const ke = new Set(n.split(' ').filter(Boolean)); let best = null, bs = 0;
      for (const k in idx) { const kk = new Set(k.split(' ').filter(Boolean)); let ov = 0; ke.forEach(x => { if (kk.has(x)) ov++; }); const sc = ov / Math.max(1, new Set([...ke, ...kk]).size); if (ov >= 1 && sc >= 0.5 && ov > bs) { bs = ov; best = idx[k]; } }
      return best;
    };
    let teams = [];
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/teams`, { signal: AbortSignal.timeout(15000) });
      const j = r.ok ? await r.json() : null;
      teams = ((j && j.sports && j.sports[0].leagues && j.sports[0].leagues[0].teams) || []).map(x => x.team);
    } catch { /* liga sin datos */ }
    const seen = new Set();
    for (const t of teams) {
      const tid = matchId(t.displayName) || matchId(t.name || '');
      const href = (t.logos || [])[0] && (t.logos || [])[0].href;
      if (!tid || !href || seen.has(tid)) { if (!tid) { clubsMiss++; missNames.push(lgKey + ':' + t.displayName); } continue; }
      seen.add(tid);
      if (await dl(href, path.join(OUT, tid + '.png'))) clubsOk++; else clubsMiss++;
    }
    console.log(`  ${lgKey}: ${seen.size} clubes con logo (${teams.length} en ESPN)`);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\nLIGAS: ${lgsOk}/${leagues.length} logos · CLUBES: ${clubsOk} ok, ${clubsMiss} sin match`);
  if (missNames.length) console.log('sin match:', missNames.slice(0, 30).join(', '));
})();
