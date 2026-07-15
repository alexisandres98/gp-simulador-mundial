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
const FOTMOB = { brasileirao: 268, mls: 130, ligamx: 230, argentina: 112, colombia: 274, csl: 120, kleague: 9080 };

const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|sc|ec|ac|afc|cd|club|de|do|da)\b/g, ' ').replace(/\s+/g, ' ').trim();

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
    const n = normName(raw); if (!n) return null;
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
