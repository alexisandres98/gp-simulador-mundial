// scripts/multi-comp-backfill.js — INFRA DE HISTORIAL MULTI-COMPETICIÓN (TheStatsAPI, post-Mundial).
// La misma tubería que alimentó los engines de props/jugador del Mundial, generalizada a las 80+ ligas del
// plan ya pagado. RESUMIBLE con checkpoint (12 req/min = backfills largos sobreviven cortes), idempotente,
// un archivo por (competición, temporada) en data/history/. Equipos y jugadores van con ids/nombres del
// proveedor (los códigos de 3 letras son del Mundial; el mapeo por liga se decide al integrar cada liga).
//
// Uso:
//   node scripts/multi-comp-backfill.js --list [--q premier]        # catálogo de competiciones
//   node scripts/multi-comp-backfill.js --info comp_XXXX             # detalle (current_season_id, xG disponible)
//   node scripts/multi-comp-backfill.js --comp comp_XXXX --season sn_YYYY [--limit N] [--players]
//     → data/history/comp_XXXX-sn_YYYY.json  (partidos + stats por equipo; --players agrega player-stats)
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.thestatsapi.com/api/football';
const KEY = process.env.THESTATSAPI_KEY || 'fapi_Tn5isXyR7Pn1587zrAKLbI7xJ2C4Bv7R';
const OUT_DIR = path.join(__dirname, '..', 'data', 'history');
const THROTTLE_MS = 5200; // 12 req/min con margen

let _last = 0;
async function call(p, params) {
  const wait = Math.max(0, _last + THROTTLE_MS - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  _last = Date.now();
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${BASE}/${p}${qs}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (r && r.status === 429) { await new Promise(x => setTimeout(x, 15000)); continue; }
    if (!r || !r.ok) { if (i === 2) return null; await new Promise(x => setTimeout(x, 3000)); continue; }
    const j = await r.json().catch(() => null);
    return j && j.data != null ? j.data : j;
  }
  return null;
}

const args = process.argv.slice(2);
const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const has = k => args.includes(k);

(async () => {
  if (has('--list')) {
    const q = (arg('--q') || '').toLowerCase();
    let page = 1, shown = 0;
    while (page <= 5) {
      const rows = await call('competitions', { per_page: 100, page });
      if (!rows || !rows.length) break;
      for (const r of rows) {
        const name = `${r.name} ${(r.country && r.country.name) || ''}`.toLowerCase();
        if (!q || name.includes(q)) { console.log(r.id, '|', r.name, '|', (r.country && r.country.name) || ''); shown++; }
      }
      if (rows.length < 100) break;
      page++;
    }
    console.log(`(${shown} competiciones)`);
    return;
  }
  if (has('--info')) {
    const d = await call(`competitions/${arg('--info')}`);
    console.log(JSON.stringify(d, null, 1));
    return;
  }

  const comp = arg('--comp'), season = arg('--season');
  if (!comp || !season) { console.log('uso: --list [--q texto] | --info comp_X | --comp comp_X --season sn_Y [--limit N] [--players]'); return; }
  const limit = Number(arg('--limit') || 0);
  const wantPlayers = has('--players');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${comp}-${season}.json`);
  let store = { _meta: { competition_id: comp, season_id: season, source: 'thestatsapi' }, matches: [] };
  if (fs.existsSync(outFile)) { try { store = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* re-crear */ } }
  const have = new Set(store.matches.map(m => m.id));

  // Índice de partidos terminados de la temporada (paginado).
  let page = 1; const index = [];
  while (page <= 20) {
    const rows = await call('matches', { competition_id: comp, season_id: season, status: 'finished', per_page: 100, page });
    if (!rows || !rows.length) break;
    index.push(...rows);
    if (rows.length < 100) break;
    page++;
  }
  console.log(`índice: ${index.length} partidos terminados de ${comp}/${season}`);

  let done = 0;
  for (const m of index) {
    if (have.has(m.id)) continue;
    if (limit && done >= limit) break;
    const row = {
      id: m.id, utc: m.utc_date, round: m.round || null, referee: m.referee || null,
      home: { id: m.home_team && m.home_team.id, name: m.home_team && m.home_team.name, goals: m.score && m.score.home },
      away: { id: m.away_team && m.away_team.id, name: m.away_team && m.away_team.name, goals: m.score && m.score.away },
      regulation: (m.score && m.score.regulation) || null, et: !!(m.score && m.score.went_to_extra_time), pens: !!(m.score && m.score.went_to_penalties),
    };
    if (wantPlayers) {
      const ps = await call(`matches/${m.id}/player-stats`);
      if (ps) row.players = ps.filter(p => p.played).map(p => ({
        pid: p.player_id, name: p.player_name, team: p.team_id, pos: p.position, min: p.minutes_played || 0,
        started: !!p.started,
        goals: (p.shooting && p.shooting.goals) || 0, shots: (p.shooting && p.shooting.total_shots) || 0,
        sot: (p.shooting && p.shooting.shots_on_target) || 0,
        xg: p.shooting && p.shooting.expected_goals, npxg: p.shooting && p.shooting.non_penalty_expected_goals,
        xa: p.shooting && p.shooting.expected_assists, assists: (p.passing && p.passing.assists) || 0,
        fouls: (p.discipline && p.discipline.fouls_committed) || 0,
        yc: (p.discipline && p.discipline.yellow_cards) || 0, rc: (p.discipline && p.discipline.red_cards) || 0,
      }));
    }
    store.matches.push(row); have.add(m.id); done++;
    fs.writeFileSync(outFile, JSON.stringify(store)); // checkpoint por partido
    console.log(`  ✓ ${row.home.name} ${row.home.goals}-${row.away.goals} ${row.away.name}${row.players ? ` (${row.players.length} jugadores)` : ''}`);
  }
  store._meta.updated_at = new Date().toISOString();
  store._meta.matches = store.matches.length;
  fs.writeFileSync(outFile, JSON.stringify(store));
  console.log(`\nmulti-comp-backfill: +${done} nuevos, total ${store.matches.length} → ${outFile}`);
})();
