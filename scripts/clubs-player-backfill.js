// clubs-player-backfill.js — F0.1 del plan de extensión: HISTORIAL JUGADOR-PARTIDO por liga de clubes.
// Mismo patrón que player-props-backfill del Mundial: TSA matches status=finished de la season →
// /matches/{id}/player-stats → filas normalizadas (min, titular, goles, remates, SOT, xG, npxG, xA,
// pases clave, asistencias, tarjetas, rating). Alimenta: stats/90 + radar + arquetipo del perfil de
// jugador de club (F2.2), Match Intel de clubes (anotadores probables) y el futuro modelo de props.
// RESUMIBLE (checkpoint por match id) e idempotente. Throttle 12 req/min de TSA.
// Uso: THESTATSAPI_KEY=... node scripts/clubs-player-backfill.js [liga ...]
//      (sin args: todas las ligas con season en ratings.json, activas primero)
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
  // activas primero (tienen partidos frescos), pretemporada después (su season pasada también sirve para percentiles)
  const keys = Object.keys(RT.leagues).sort((a, b) => (RT.leagues[a].starts ? 1 : 0) - (RT.leagues[b].starts ? 1 : 0));
  const leagues = keys.filter(k => !only.length || only.includes(k));
  for (const lg of leagues) {
    const L = RT.leagues[lg];
    if (!L.comp || !L.season) continue;
    const outFile = path.join(OUTDIR, `player-history-${lg}.json`);
    const H = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { league: lg, comp: L.comp, season: L.season, done: {}, rows: [] };
    // 1) listar TODOS los finished de la season (paginado)
    const matches = [];
    for (let page = 1; page <= 20; page++) {
      const j = await tsa(`/matches?competition_id=${L.comp}&season_id=${L.season}&status=finished&per_page=50&page=${page}`);
      const rows = (j && j.data) || [];
      matches.push(...rows);
      const meta = (j && j.meta) || {};
      await sleep(5200);
      if (!rows.length || page >= (meta.total_pages || 1)) break;
    }
    const pending = matches.filter(m => !H.done[m.id]);
    console.log(`[${lg}] finished: ${matches.length} · ya bajados: ${matches.length - pending.length} · pendientes: ${pending.length}`);
    // 2) player-stats por match pendiente
    let got = 0;
    for (const m of pending) {
      const j = await tsa(`/matches/${m.id}/player-stats`);
      const rows = (j && j.data) || [];
      if (Array.isArray(rows) && rows.length) {
        for (const p of rows) {
          const sh = p.shooting || {}, pa = p.passing || {}, ge = p.general || {};
          H.rows.push({
            match: m.id, date: m.utc_date, league: lg,
            pid: p.player_id, name: p.player_name, team: p.team_id, pos: p.position || null,
            min: num(p.minutes_played) || 0, started: !!p.started, rating: num(p.rating),
            goals: num(sh.goals) || 0, shots: num(sh.total_shots) || 0, sot: num(sh.shots_on_target) || 0,
            xg: num(sh.expected_goals), npxg: num(sh.np_expected_goals), xa: num(sh.expected_assists),
            big_chances: num(sh.big_chances_created) || 0,
            assists: num(pa.assists) || 0, key_passes: num(pa.key_passes) || 0,
            passes: num(pa.total_passes) || 0, passes_acc: num(pa.accurate_passes) || 0,
            crosses: num(pa.total_crosses) || 0,
            touches: num(ge.touches) || 0, fouls: num(ge.fouls) || 0,
            yc: num(ge.yellow_cards) || 0, rc: num(ge.red_cards) || 0,
          });
        }
        got++;
      }
      H.done[m.id] = true; // aunque venga vacío: no reintentar en loop (re-forzable borrando la key)
      if (got % 10 === 0) fs.writeFileSync(outFile, JSON.stringify(H));
      await sleep(5200);
    }
    fs.writeFileSync(outFile, JSON.stringify(H));
    console.log(`[${lg}] listo: ${H.rows.length} filas jugador-partido (${Object.keys(H.done).length} partidos)`);
  }
  console.log('backfill completo');
})();
