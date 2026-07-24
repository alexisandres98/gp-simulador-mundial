// gen-club-logos.js — descarga los logos OFICIALES de clubes y ligas (ESPN CDN) y los self-hostea en
// public/logos/, MISMA línea que las banderas (/flags/) y las casas (/books/): tile cuadrado, cache inmutable.
// Club:  public/logos/<tm_id>.png   (nuestros ids de TheStatsAPI, matcheados por nombre a ESPN)
// Liga:  public/logos/league-<key>.png
// Uso:   node scripts/gen-club-logos.js            (todas las ligas)
//        node scripts/gen-club-logos.js brasileirao mls   (solo esas)
'use strict';
const fs = require('fs');
const path = require('path');

const CLUB_ESPN = { ligamx: 'mex.1', brasileirao: 'bra.1', mls: 'usa.1', argentina: 'arg.1', colombia: 'col.1', paraguay: 'par.1', csl: 'chn.1', kleague: 'kor.1', j1: 'jpn.1', premier: 'eng.1', laliga: 'esp.1', bundesliga: 'ger.1', seriea: 'ita.1', ligue1: 'fra.1', brasilb: 'bra.2', chile: 'chi.1', noruega: 'nor.1', suecia: 'swe.1', finlandia: 'fin.1', irlanda: 'irl.1', dinamarca: 'den.1', rusia: 'rus.1', suiza: 'sui.1' }; // polonia sin ESPN → pases 2/3 (search + FotMob)
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
  const leagues = Object.keys(RT.leagues).filter(k => (!only.length || only.includes(k))); // TODAS las ligas del fit (con o sin ESPN)
  let clubsOk = 0, clubsMiss = 0, lgsOk = 0;
  const missNames = [];
  for (const lgKey of leagues) {
    const code = CLUB_ESPN[lgKey], L = RT.leagues[lgKey];
    if (!code) { console.log(`  ${lgKey}: sin ESPN (pases 2/3)`); continue; }
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

  // ── PASE 2 (fallback, 18-jul): los equipos que NO están en la lista de primera de ESPN (descendidos/
  // ascendidos entre temporadas, o ligas sin lista como kor.1) se resuelven por el BUSCADOR de ESPN —
  // encuentra el equipo sin importar la división y el logo vive en el CDN por id. Overrides manuales para
  // nombres ambiguos. El logo de liga de kleague sale del scoreboard (kor.1 no está en LEAGUE_LOGO_ID).
  const SEARCH_ALIAS = {
    'Gimnasia y Esgrima': 'Gimnasia La Plata', 'Ulsan HD': 'Ulsan', 'Jeju SK': 'Jeju United',
    'Gimcheon Sangmu FC': 'Gimcheon Sangmu', 'Jeonbuk Hyundai Motors': 'Jeonbuk Motors',
    'Daejeon Hana Citizen': 'Daejeon Citizen', 'Bucheon FC 1995': 'Bucheon FC',
    'Shenzhen Peng City': 'Shenzhen Xinpengcheng', 'Chongqing Tonglianglong FC': 'Chongqing Tongliang',
    'Liaoning Tieren FC': 'Liaoning Tieren', "Borussia M'gladbach": 'Borussia Monchengladbach',
    '1. FC Heidenheim': 'Heidenheim', 'Red Star FC': 'Red Star Paris', 'Rodez AF': 'Rodez',
    'Wolverhampton': 'Wolverhampton Wanderers', 'Saint-Étienne': 'Saint-Etienne', 'Málaga': 'Malaga',
    'Lillestrøm SK': 'Lillestrom', 'Tromsø IL': 'Tromso', 'FC Fredericia': 'Fredericia',
    'Bruk-Bet Termalica Nieciecza': 'Termalica Nieciecza', 'MKS Korona Kielce': 'Korona Kielce',
    'KS Lechia Gdańsk': 'Lechia Gdansk', 'MZKS Arka Gdynia': 'Arka Gdynia',
    'Pari Nizhny Novgorod': 'Nizhny Novgorod', 'Ural Yekaterinburg': 'Ural',
    'Grasshopper Club Zürich': 'Grasshopper', 'FC Aarau': 'Aarau',
  };
  const searchLogo = async (name) => {
    const q = encodeURIComponent(SEARCH_ALIAS[name] || name);
    try {
      const r = await fetch(`https://site.web.api.espn.com/apis/common/v3/search?query=${q}&limit=5&type=team`, { signal: AbortSignal.timeout(15000) });
      const j = r.ok ? await r.json() : null;
      const items = ((j && (j.items || j.results)) || []).filter(x => x.type === 'team' && x.sport === 'soccer');
      return items.length ? `https://a.espncdn.com/i/teamlogos/soccer/500/${items[0].id}.png` : null;
    } catch { return null; }
  };
  let fillOk = 0; const fillMiss = [];
  for (const lgKey of leagues) {
    const L = RT.leagues[lgKey];
    for (const [tid, t] of Object.entries(L.ratings || {})) {
      if (fs.existsSync(path.join(OUT, tid + '.png'))) continue;
      const href = await searchLogo(t.name);
      if (href && await dl(href, path.join(OUT, tid + '.png'))) { fillOk++; console.log(`  fill: ${lgKey} ${t.name} ✓`); }
      else fillMiss.push(lgKey + ':' + t.name);
      await new Promise(r => setTimeout(r, 250));
    }
  }
  // logo de liga vía scoreboard (leagues[0].logos) para las que falten; sin ESPN → leaguelogo de FotMob
  const FM_LEAGUE_LOGO = { polonia: 196, finlandia: 51 };
  for (const lgKey of leagues) {
    const dest = path.join(OUT, 'league-' + lgKey + '.png');
    if (fs.existsSync(dest)) continue;
    try {
      const code = CLUB_ESPN[lgKey];
      let href = null;
      if (code) {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard`, { signal: AbortSignal.timeout(15000) });
        const j = r.ok ? await r.json() : null;
        href = j && j.leagues && j.leagues[0] && (j.leagues[0].logos || [])[0] && j.leagues[0].logos[0].href;
      } else if (FM_LEAGUE_LOGO[lgKey]) {
        href = `https://images.fotmob.com/image_resources/logo/leaguelogo/${FM_LEAGUE_LOGO[lgKey]}.png`;
      }
      if (href && await dl(href, dest)) console.log(`  fill: league-${lgKey} ✓`);
    } catch { /* sin logo de liga */ }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`\nFALLBACK: ${fillOk} rellenados · aún sin logo: ${fillMiss.length}${fillMiss.length ? ' → ' + fillMiss.join(', ') : ''}`);

  // ── PASE 3 (FotMob, 18-jul): lo que ESPN no tiene como asset (K-League/CSL devuelven 404 en su CDN y
  // logos:[] en el detalle; europeos fuera de las listas de primera). Dos caminos:
  //   (a) ligas CON corpus fotmob-<liga>.json: el corpus vincula matchId↔tm_ code → matchDetails da el id
  //       FotMob del equipo (general.homeTeam/awayTeam.id).
  //   (b) resto: searchapi/suggest → teamSuggest payload.id.
  // Logo: images.fotmob.com/image_resources/logo/teamlogo/<id>.png (mismo self-host, cache inmutable).
  const FM_HDRS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', Referer: 'https://www.fotmob.com/', Accept: 'application/json' };
  const fmLogo = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
  const clubDataDir = (f) => {
    const disk = process.env.CLUB_DATA_DISK || '/data/clubs';
    const p1 = path.join(disk, f), p2 = path.join(__dirname, '..', 'data', 'clubs', f);
    return fs.existsSync(p1) ? p1 : p2;
  };
  let fmOk = 0; const fmMiss = [];
  for (const lgKey of leagues) {
    const L = RT.leagues[lgKey];
    const missingIds = Object.keys(L.ratings || {}).filter(tid => !fs.existsSync(path.join(OUT, tid + '.png')));
    if (!missingIds.length) continue;
    const pending = new Set(missingIds);
    // (a) corpus de la liga → matchDetails
    try {
      const corp = JSON.parse(fs.readFileSync(clubDataDir(`fotmob-${lgKey}.json`), 'utf8')).matches || [];
      for (const m of corp) {
        if (!pending.size) break;
        if (!pending.has(m.homeCode) && !pending.has(m.awayCode)) continue;
        try {
          const r = await fetch(`https://www.fotmob.com/api/data/matchDetails?matchId=${m.matchId}`, { headers: FM_HDRS, signal: AbortSignal.timeout(15000) });
          const j = r.ok ? await r.json() : null;
          const g = (j && j.general) || {};
          for (const [code, side] of [[m.homeCode, g.homeTeam], [m.awayCode, g.awayTeam]]) {
            if (!pending.has(code) || !side || !side.id) continue;
            if (await dl(fmLogo(side.id), path.join(OUT, code + '.png'))) { pending.delete(code); fmOk++; console.log(`  fotmob: ${lgKey} ${(L.ratings[code] || {}).name} ✓`); }
          }
        } catch { /* siguiente match del corpus */ }
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch { /* liga sin corpus → suggest */ }
    // (b) suggest por nombre
    for (const tid of [...pending]) {
      const name = (L.ratings[tid] || {}).name || '';
      try {
        const r = await fetch(`https://apigw.fotmob.com/searchapi/suggest?term=${encodeURIComponent(SEARCH_ALIAS[name] || name)}&lang=en`, { headers: FM_HDRS, signal: AbortSignal.timeout(15000) });
        const j = r.ok ? await r.json() : null;
        const opt = (((j && j.teamSuggest) || [])[0] || {}).options || [];
        const id = opt.length && opt[0].payload && opt[0].payload.id;
        if (id && await dl(fmLogo(id), path.join(OUT, tid + '.png'))) { pending.delete(tid); fmOk++; console.log(`  fotmob(search): ${lgKey} ${name} ✓`); }
      } catch { /* sin resultado */ }
      await new Promise(r => setTimeout(r, 800));
    }
    pending.forEach(tid => fmMiss.push(lgKey + ':' + ((L.ratings[tid] || {}).name || tid)));
  }
  console.log(`\nFOTMOB: ${fmOk} rellenados · definitivamente sin logo: ${fmMiss.length}${fmMiss.length ? ' → ' + fmMiss.join(', ') : ''}`);
})();
