// clubs-results-backfill.js — resultados (score por partido) por liga, para Recent form + Results del equipo.
// Ligero: solo matches status=finished con score (NO player-stats). Reusa la season de ratings.json.
// Salida: data/clubs/results-<liga>.json = { league, rows:[{id,date,home_id,away_id,hg,ag,winner}] }
// Uso: THESTATSAPI_KEY=... node scripts/clubs-results-backfill.js [liga ...]
'use strict';
const fs = require('fs');
const path = require('path');
const KEY = process.env.THESTATSAPI_KEY || '';
if (!KEY) { console.error('falta THESTATSAPI_KEY'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const RT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'clubs', 'ratings.json'), 'utf8'));
const OUTDIR = path.join(ROOT, 'data', 'clubs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function tsa(pathq, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch('https://api.thestatsapi.com/api/football' + pathq, { headers: { Authorization: 'Bearer ' + KEY }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429) { await sleep(15000); continue; }
      if (!r.ok) return null;
      return await r.json().catch(() => null);
    } catch { await sleep(4000); }
  }
  return null;
}
const num = (v) => (v == null || !isFinite(Number(v))) ? null : Number(v);
(async () => {
  const only = process.argv.slice(2);
  const keys = Object.keys(RT.leagues).sort((a, b) => (RT.leagues[a].starts ? 1 : 0) - (RT.leagues[b].starts ? 1 : 0));
  for (const lg of keys.filter(k => !only.length || only.includes(k))) {
    const L = RT.leagues[lg]; if (!L.comp || !L.season) continue;
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const j = await tsa(`/matches?competition_id=${L.comp}&season_id=${L.season}&status=finished&per_page=50&page=${page}`);
      const data = (j && j.data) || [];
      for (const m of data) {
        const s = m.score || {};
        const hId = String(m.home_team && m.home_team.id), aId = String(m.away_team && m.away_team.id);
        rows.push({ id: m.id, date: m.utc_date, home_id: hId, away_id: aId, hg: num(s.home), ag: num(s.away), winner: s.winner || null });
      }
      const meta = (j && j.meta) || {};
      await sleep(5200);
      if (!data.length || page >= (meta.total_pages || 1)) break;
    }
    fs.writeFileSync(path.join(OUTDIR, `results-${lg}.json`), JSON.stringify({ league: lg, rows }));
    console.log(`[${lg}] ${rows.length} resultados`);
  }
  console.log('listo');
})();
