// clubs-props-backfill.js — PROPS-HISTORY por liga de clubes (córners/tarjetas/faltas + árbitro por partido).
// MISMO patrón/shape que scripts/props-backfill.js del Mundial: API-Football fixtures terminados de la season
// → /fixtures/statistics → matches [{date, referee, home:{code:tm_,corners,yellows,reds,fouls,...}, away:{...}}].
// El code es el tm_ id de TSA (resuelto vía data/clubs/af-team-map.json af_id→tm_, fallback por nombre vs
// ratings) → prop-engine/model.fit() sirve TAL CUAL con estos rows (es puro y keyea por code).
// Guarda a data/clubs/props-history-<liga>.json en DISCO (subir a prod con upload-clubs-data.sh).
// Resumible (done[fixture_id]); idempotente por fixture. Uso:
//   API_FOOTBALL_KEY=... node scripts/clubs-props-backfill.js [liga ...]   (sin args: ligas activas con af-map)
'use strict';
const fs = require('fs');
const path = require('path');

const KEY = process.env.API_FOOTBALL_KEY || '';
if (!KEY) { console.error('falta API_FOOTBALL_KEY'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const RT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'clubs', 'ratings.json'), 'utf8'));
const OUTDIR = path.join(ROOT, 'data', 'clubs');
// af-team-map puede vivir en el repo o en el disco (clubDataFile del server); en local está en data/clubs/
let AFMAP = {};
try { AFMAP = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'af-team-map.json'), 'utf8')); } catch { console.error('sin af-team-map.json'); process.exit(1); }

// ids de liga de API-Football (docs/plan-extension-clubes.md, verificados en el build de alineaciones)
const AF_LEAGUE = { brasileirao: 71, ligamx: 262, mls: 253, argentina: 128, colombia: 239, paraguay: 250, csl: 169, kleague: 292, j1: 98, premier: 39, laliga: 140, bundesliga: 78, seriea: 135, ligue1: 61, brasilb: 72, chile: 265, noruega: 103, suecia: 113, finlandia: 244, irlanda: 357, dinamarca: 119, polonia: 106, rusia: 235, suiza: 207,
  // 8-ago (Europa despierta): ids canónicos de API-Football; un id malo se ve solo (0 fixtures en el log).
  // Las 26/27 recién arrancan → correr una pasada con AF_SEASON=2025 (la 25/26 completa, base de percentiles)
  // y otra con 2026 (incremental, la que mantiene el pase diario).
  liga3: 80, ligue2: 62, bundesliga2: 79, eredivisie: 88, superettan: 114, austria: 218, escocia: 179,
  championship: 40, league1: 41, league2: 42, serieb: 136, laliga2: 141, portugal: 94, belgica: 144, turquia: 203, grecia: 197 };
const SEASON = Number(process.env.AF_SEASON || 2026);

const HOST = 'v3.football.api-sports.io';
async function call(pathName, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://${HOST}/${pathName}?${qs}`, { headers: { 'x-apisports-key': KEY }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${pathName} HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(`${pathName}: ${JSON.stringify(j.errors)}`);
  return j.response || [];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// statistics[] de API-Football → objeto plano (MISMO statMap del Mundial)
function statMap(entry) {
  const out = {};
  for (const s of (entry.statistics || [])) out[s.type] = s.value;
  const num = v => (v == null ? null : Number(String(v).replace('%', '')) || 0);
  return {
    corners: num(out['Corner Kicks']),
    yellows: num(out['Yellow Cards']),
    reds: num(out['Red Cards']),
    fouls: num(out['Fouls']),
    shots: num(out['Total Shots']),
    shots_on: num(out['Shots on Goal']),
    possession: num(out['Ball Possession']),
    xg: out['expected_goals'] != null ? Number(out['expected_goals']) : null,
  };
}
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|sc|ec|ac|afc|cd|club|de|do|da)\b/g, ' ').replace(/\s+/g, ' ').trim();
// alias nombre-AF(normalizado) → nombre-ratings(normalizado): AF usa sufijos de estado/marca en Brasil y
// abreviados en otras ligas (mismo problema resuelto con CLUB_ALIAS para ESPN en el server).
const AF_ALIAS = {
  // Brasil
  'atletico mg': 'atletico mineiro', 'athletico pr': 'athletico', 'atletico paranaense': 'athletico',
  'rb bragantino': 'red bull bragantino', 'bragantino': 'red bull bragantino', 'atletico go': 'atletico goianiense',
  'vasco': 'vasco da gama', 'america mg': 'america mineiro',
  // MLS
  'lafc': 'los angeles', 'los angeles galaxy': 'la galaxy', 'dc united': 'd c united', 'st louis city': 'st louis',
  'new england revolution': 'new england', 'ny red bulls': 'new york red bulls',
  // Colombia
  'atletico junior': 'junior', 'independiente medellin': 'medellin', 'deportivo cali': 'cali',
  // Argentina (nombres AF verificados vs ratings)
  'newells old boys': 'newell s old boys', 'estudiantes l p': 'estudiantes la plata', 'gimnasia l p': 'gimnasia y esgrima',
  'gimnasia m': 'gimnasia y esgrima mendoza', 'independ rivadavia': 'independiente rivadavia',
  'argentinos jrs': 'argentinos juniors', 'defensa y justicia': 'defensa justicia',
  // K-League (renames)
  'ulsan hyundai': 'ulsan hd', 'jeju united': 'jeju sk',
  // CSL (API-Football usa nombres HISTÓRICOS — renames documentados/conocidos)
  'hangzhou greentown': 'zhejiang', 'shanghai sipg': 'shanghai port', 'shandong luneng': 'shandong taishan',
  'tianjin teda': 'tianjin jinmen tiger', 'qingdao jonoon': 'qingdao hainiu', 'qingdao youth island': 'qingdao west coast',
  'chengdu better city': 'chengdu rongcheng', 'henan jianye': 'henan jiuzu dukang', 'chongqing tongliang long': 'chongqing tonglianglong',
};

function resolverFor(league) {
  const inv = {}; // af_id → tm_
  for (const [tm, v] of Object.entries(AFMAP[league] || {})) if (v && v.af_id != null) inv[v.af_id] = tm;
  const names = Object.entries((RT.leagues[league] || {}).ratings || {}).map(([id, t]) => ({ id, n: normName(t.name) }));
  return function (afId, afName) {
    if (inv[afId]) return inv[afId];
    let n = normName(afName); if (!n) return null;
    n = AF_ALIAS[n] || n;
    const exact = names.find(x => x.n === n); if (exact) return exact.id;
    const hit = names.find(x => x.n && (x.n.indexOf(n) >= 0 || n.indexOf(x.n) >= 0));
    return hit ? hit.id : null;
  };
}

(async () => {
  const only = process.argv.slice(2).filter(a => !a.includes('='));
  const leagues = Object.keys(AF_LEAGUE)
    .filter(k => RT.leagues[k] && AFMAP[k]) // solo ligas con ratings y af-map
    .filter(k => !only.length || only.includes(k));
  for (const lg of leagues) {
    const resolve = resolverFor(lg);
    const outFile = path.join(OUTDIR, `props-history-${lg}.json`);
    const store = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { league: lg, af_league: AF_LEAGUE[lg], season: SEASON, done: {}, matches: [] };
    let fixtures = [];
    try { fixtures = await call('fixtures', { league: AF_LEAGUE[lg], season: SEASON }); }
    catch (e) { console.log(`== ${lg}: fixtures ERR ${e.message}`); continue; }
    const done = fixtures.filter(f => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short) && !store.done[f.fixture.id]);
    console.log(`\n== ${lg} (AF ${AF_LEAGUE[lg]}) — ${store.matches.length} guardados, ${done.length} pendientes de ${fixtures.length} fixtures ==`);
    let added = 0, unmatched = 0, nostats = 0;
    for (const f of done) {
      const fid = f.fixture.id;
      // resolver ANTES de gastar la llamada de stats; unmatched NO se marca done (un resolver mejor lo retoma)
      const hCode = resolve(f.teams.home.id, f.teams.home.name), aCode = resolve(f.teams.away.id, f.teams.away.name);
      if (!hCode || !aCode) { unmatched++; if (process.env.DEBUG) console.log('   unmatched:', f.teams.home.name, '/', f.teams.away.name); continue; }
      let stats;
      try { stats = await call('fixtures/statistics', { fixture: fid }); } catch { nostats++; store.done[fid] = 1; continue; }
      await sleep(160);
      store.done[fid] = 1;
      const home = stats.find(s => s.team.id === f.teams.home.id), away = stats.find(s => s.team.id === f.teams.away.id);
      if (!home || !away) { nostats++; continue; }
      store.matches.push({
        fixture_id: fid, date: f.fixture.date, round: (f.league && f.league.round) || null,
        referee: f.fixture.referee || null, status: f.fixture.status.short, et: f.fixture.status.short !== 'FT',
        home: { code: hCode, name: f.teams.home.name, goals: f.goals.home, ...statMap(home) },
        away: { code: aCode, name: f.teams.away.name, goals: f.goals.away, ...statMap(away) },
      });
      added++;
      if (added % 25 === 0) { store.matches.sort((a, b) => new Date(a.date) - new Date(b.date)); fs.writeFileSync(outFile, JSON.stringify(store)); process.stdout.write(`   +${added} (unmatched ${unmatched}, sinStats ${nostats})\r`); }
    }
    store.matches.sort((a, b) => new Date(a.date) - new Date(b.date));
    fs.writeFileSync(outFile, JSON.stringify(store));
    console.log(`   OK ${lg}: +${added} (total ${store.matches.length}), unmatched ${unmatched}, sinStats ${nostats}`);
  }
  console.log('\nlisto. Subir a prod: GP_EXPORT_KEY=<key> scripts/upload-clubs-data.sh');
})().catch(e => { console.error(e); process.exit(1); });
