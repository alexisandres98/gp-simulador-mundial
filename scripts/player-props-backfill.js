// scripts/player-props-backfill.js — Dataset de PROPS DE JUGADOR del Mundial 2026 desde TheStatsAPI.
// Por partido terminado: stats por jugador (minutos/titular/posición/remates/al arco/goles/xG/npxG/xA/faltas/
// tarjetas) → data/player-props-history.json (filas compactas, solo lo que usa el modelo).
// Rate limit del plan: 12 req/min → throttle 5.5s (~11/min). 92 partidos ≈ 9 min. Idempotente e INCREMENTAL:
// si el archivo existe, solo baja los partidos que falten (clave para el pase diario post-jornada).
// Uso: THESTATSAPI_KEY=... node scripts/player-props-backfill.js
'use strict';
const fs = require('fs');
const path = require('path');
const { TEAMS } = require('../data/tournament');

const KEY = process.env.THESTATSAPI_KEY || '';
if (!KEY) { console.error('Falta THESTATSAPI_KEY'); process.exit(1); }
const BASE = 'https://api.thestatsapi.com/api/football';
const COMP = 'comp_6107'; // FIFA World Cup
const DEST = path.join(__dirname, '..', 'data', 'player-props-history.json');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const ALIAS_TO_ID = {};
TEAMS.forEach(t => { [t.en, t.name, t.id, ...(t.aliases || [])].filter(Boolean).forEach(a => { ALIAS_TO_ID[norm(a)] = t.id; }); });
ALIAS_TO_ID[norm('Cape Verde Islands')] = 'CPV';
ALIAS_TO_ID[norm('Bosnia & Herzegovina')] = 'BIH';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(pathName, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${BASE}/${pathName}${qs}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) });
    if (r.status === 429) { await sleep(20000); continue; } // ventana agotada → esperar y reintentar
    if (!r.ok) throw new Error(`${pathName} HTTP ${r.status}`);
    return (await r.json());
  }
  throw new Error(`${pathName}: rate limit persistente`);
}

(async () => {
  const prev = fs.existsSync(DEST) ? JSON.parse(fs.readFileSync(DEST, 'utf8')) : { matches: [] };
  const have = new Set(prev.matches.map(m => m.match_id));

  const ml = await call('matches', { competition_id: COMP, status: 'finished', date_from: '2026-06-01', date_to: '2026-07-31', per_page: 100 });
  const finished = ml.data || [];
  console.log(`terminados: ${finished.length} · ya en dataset: ${have.size}`);
  const pending = finished.filter(m => !have.has(m.id));

  for (const m of pending) {
    await sleep(5500); // 12 req/min del plan
    let rows;
    try { rows = (await call(`matches/${m.id}/player-stats`)).data || []; }
    catch (e) { console.warn(`${m.id}: ${e.message}`); continue; }
    const teamCode = {};
    teamCode[m.home_team.id] = ALIAS_TO_ID[norm(m.home_team.name)] || m.home_team.name;
    teamCode[m.away_team.id] = ALIAS_TO_ID[norm(m.away_team.name)] || m.away_team.name;
    const players = rows.filter(p => p.played).map(p => ({
      pid: p.player_id, name: p.player_name, team: teamCode[p.team_id] || p.team_id,
      pos: p.position || null, started: !!p.started, min: p.minutes_played || 0,
      goals: (p.shooting && p.shooting.goals) || 0,
      shots: (p.shooting && p.shooting.total_shots) || 0,
      sot: (p.shooting && p.shooting.shots_on_target) || 0,
      xg: (p.shooting && p.shooting.expected_goals) != null ? p.shooting.expected_goals : null,
      npxg: (p.shooting && p.shooting.np_expected_goals) != null ? p.shooting.np_expected_goals : null,
      xa: (p.shooting && p.shooting.expected_assists) != null ? p.shooting.expected_assists : null,
      assists: (p.passing && p.passing.assists) || 0,
      fouls: (p.general && p.general.fouls) || 0,
      yc: (p.general && p.general.yellow_cards) || 0,
      rc: (p.general && p.general.red_cards) || 0,
    }));
    prev.matches.push({
      match_id: m.id, date: m.utc_date,
      home: teamCode[m.home_team.id], away: teamCode[m.away_team.id],
      home_tsa: m.home_team.id, away_tsa: m.away_team.id,
      players,
    });
    process.stdout.write(`\r${prev.matches.length}/${finished.length}  ${m.home_team.name} - ${m.away_team.name}        `);
  }
  console.log();
  prev.matches.sort((a, b) => new Date(a.date) - new Date(b.date));
  prev.generated_at = new Date().toISOString();
  prev.competition = COMP;
  fs.writeFileSync(DEST, JSON.stringify(prev));
  const np = prev.matches.reduce((x, m) => x + m.players.length, 0);
  console.log(`guardado ${DEST} · ${prev.matches.length} partidos · ${np} filas de jugador`);
})().catch(e => { console.error(e); process.exit(1); });
