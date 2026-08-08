// clubs-fotmob-backfill.js — EVENT DATA (FotMob shotmap con situación) por liga de clubes → alimenta el
// STYLE ENGINE (mismo fitStyles del Mundial) para el Perfil táctico del cockpit de club (F2.4).
// Patrón: fotmob.leagueFixtures(primaryId) → matchIds finished → fotmob.matchEvents(id) → shotmap con situación.
// Resuelve el NOMBRE de equipo de FotMob → tm_ id con los ratings de la liga (normName + fallback apellido/contains)
// y guarda homeCode/awayCode = tm_ para que fitStyles keye por tm_. Guarda a data/clubs/fotmob-<liga>.json en DISCO
// (subir a prod con upload-clubs-data.sh). Resumible (done[matchId]). Throttle: el provider ya espera 2.5s/req.
//   node scripts/clubs-fotmob-backfill.js [liga ...]   (sin args: todas las ligas con primaryId; LIMIT=n acota)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const fotmob = require(path.join(ROOT, 'data-providers', 'fotmob'));
const RT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'clubs', 'ratings.json'), 'utf8'));
const OUTDIR = path.join(ROOT, 'data', 'clubs');

// primaryIds de FotMob por liga (verificados vía /leagues?id=; j1/paraguay pendientes de verificar)
const FOTMOB = { brasileirao: 268, mls: 130, ligamx: 230, argentina: 112, colombia: 274, csl: 120, kleague: 9080, brasilb: 8814, chile: 273, noruega: 59, suecia: 67, finlandia: 51, irlanda: 126, dinamarca: 46, polonia: 196, rusia: 63, suiza: 69,
  // 8-ago (Europa despierta): ids VERIFICADOS contra /leagues?id= (nombre+país correctos los 23).
  // GOTCHA: superettan NO es 8815 (esa es la Super League 2 GRIEGA) — es 168.
  paraguay: 199, j1: 223, premier: 47, laliga: 87, bundesliga: 54, seriea: 55, ligue1: 53,
  liga3: 208, ligue2: 110, bundesliga2: 146, eredivisie: 57, superettan: 168, austria: 38, escocia: 64,
  championship: 48, league1: 108, league2: 109, serieb: 86, laliga2: 140, portugal: 61, belgica: 40, turquia: 71, grecia: 135 };

const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|sc|ec|ac|afc|cd|club|de|do|da)\b/g, ' ').replace(/\s+/g, ' ').trim();

// aliases de rename provider-agnósticos (nombre normalizado → nombre-ratings normalizado). FotMob suele usar
// nombres MÁS actuales que AF (ej. CSL: Chengdu Rongcheng, no "Better City"), pero comparten abreviados.
const ALIAS = {
  'atletico mg': 'atletico mineiro', 'atletico go': 'atletico goianiense', 'america mg': 'america mineiro',
  'red bull bragantino': 'red bull bragantino', 'rb bragantino': 'red bull bragantino', 'vasco': 'vasco da gama',
  'la galaxy': 'la galaxy', 'lafc': 'los angeles', 'new england revolution': 'new england',
  'ulsan hyundai': 'ulsan hd', 'jeju united': 'jeju sk',
  'shanghai sipg': 'shanghai port', 'hangzhou greentown': 'zhejiang', 'shandong luneng': 'shandong taishan',
  'tianjin teda': 'tianjin jinmen tiger', 'qingdao jonoon': 'qingdao hainiu',
  'newells old boys': 'newell s old boys', 'estudiantes l p': 'estudiantes la plata', 'gimnasia l p': 'gimnasia y esgrima',
  'argentinos jrs': 'argentinos juniors',
};
function resolverFor(league) {
  const L = RT.leagues[league] || {};
  const full = {}, last = {}, dup = {};
  for (const [id, t] of Object.entries(L.ratings || {})) {
    const n = normName(t.name); if (!n) continue;
    if (!full[n]) full[n] = id;
    const parts = n.split(' ').filter(Boolean); const ln = parts[parts.length - 1];
    if (ln && ln.length >= 3) { if (last[ln] && last[ln] !== id) { dup[ln] = 1; delete last[ln]; } else if (!dup[ln]) last[ln] = id; }
  }
  const names = Object.entries(L.ratings || {}).map(([id, t]) => ({ id, n: normName(t.name) }));
  return function (raw) {
    let n = normName(raw); if (!n) return null;
    n = ALIAS[n] || n;
    if (full[n]) return full[n];
    // contains en ambos sentidos (nombre de FotMob vs ratings)
    const hit = names.find(x => x.n && (x.n === n || x.n.indexOf(n) >= 0 || n.indexOf(x.n) >= 0));
    if (hit) return hit.id;
    const ln = n.split(' ').pop();
    if (ln && ln.length >= 4 && last[ln]) return last[ln];
    return null;
  };
}

(async () => {
  const only = process.argv.slice(2).filter(a => !a.includes('='));
  const LIMIT = Number(process.env.LIMIT || 0) || 0;
  const leagues = Object.keys(FOTMOB).filter(k => !only.length || only.includes(k));
  for (const lg of leagues) {
    const resolve = resolverFor(lg);
    const outFile = path.join(OUTDIR, `fotmob-${lg}.json`);
    const store = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { league: lg, primaryId: FOTMOB[lg], done: {}, matches: [] };
    console.log(`\n== ${lg} (primaryId ${FOTMOB[lg]}) — ${store.matches.length} ya guardados ==`);
    const fx = await fotmob.leagueFixtures(FOTMOB[lg]).catch(() => []);
    const finished = fx.filter(m => m.finished && !store.done[m.matchId]);
    console.log(`   fixtures ${fx.length}, finished pendientes ${finished.length}${LIMIT ? ` (cap ${LIMIT})` : ''}`);
    let added = 0, unmatched = 0, noshots = 0;
    const todo = LIMIT ? finished.slice(-LIMIT) : finished; // más recientes primero si hay cap
    for (const m of todo) {
      const ev = await fotmob.matchEvents(m.matchId).catch(() => null);
      store.done[m.matchId] = 1;
      if (!ev || !ev.shots || !ev.shots.length) { noshots++; continue; }
      const hc = resolve(ev.home), ac = resolve(ev.away);
      if (!hc || !ac) { unmatched++; continue; }
      store.matches.push({ matchId: ev.matchId, homeCode: hc, awayCode: ac, home: ev.home, away: ev.away, utc: ev.utc, shots: ev.shots });
      added++;
      if (added % 20 === 0) { fs.writeFileSync(outFile, JSON.stringify(store)); process.stdout.write(`   +${added} (unmatched ${unmatched}, sinShots ${noshots})\r`); }
    }
    fs.writeFileSync(outFile, JSON.stringify(store));
    const teams = new Set(); store.matches.forEach(x => { teams.add(x.homeCode); teams.add(x.awayCode); });
    console.log(`   OK ${lg}: +${added} partidos (total ${store.matches.length}), ${teams.size} equipos, unmatched ${unmatched}, sinShots ${noshots}`);
  }
  console.log('\nlisto. Subir a prod: GP_EXPORT_KEY=<key> scripts/upload-clubs-data.sh');
})();
