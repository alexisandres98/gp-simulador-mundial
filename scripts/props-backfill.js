// scripts/props-backfill.js — Dataset histórico de PROPS del Mundial 2026 (córners/tarjetas/faltas + árbitro).
// Baja de API-Football las estadísticas de TODOS los partidos terminados y las guarda en data/props-history.json.
// Costo: 1 llamada (fixtures) + 1 por partido terminado (~100 max) → irrelevante vs cuota diaria 7500.
// Uso:  API_FOOTBALL_KEY=... node scripts/props-backfill.js
// Idempotente: re-corre completo y sobreescribe el archivo (fuente de verdad = API).
'use strict';
const fs = require('fs');
const path = require('path');
const { TEAMS } = require('../data/tournament');

const KEY = process.env.API_FOOTBALL_KEY || '';
if (!KEY) { console.error('Falta API_FOOTBALL_KEY'); process.exit(1); }
const HOST = 'v3.football.api-sports.io';
const LEAGUE = 1, SEASON = 2026;

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const ALIAS_TO_ID = {};
TEAMS.forEach(t => { [t.en, t.name, t.id, ...(t.aliases || [])].filter(Boolean).forEach(a => { ALIAS_TO_ID[norm(a)] = t.id; }); });
ALIAS_TO_ID[norm('Cape Verde Islands')] = 'CPV'; // nombre de API-Football que no está en los aliases del torneo

async function call(pathName, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://${HOST}/${pathName}?${qs}`, { headers: { 'x-apisports-key': KEY }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${pathName} HTTP ${r.status}`);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(`${pathName}: ${JSON.stringify(j.errors)}`);
  return j.response || [];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// statistics[] de API-Football → objeto plano por tipo
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

(async () => {
  const fixtures = await call('fixtures', { league: LEAGUE, season: SEASON });
  const done = fixtures.filter(f => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short));
  console.log(`fixtures totales: ${fixtures.length} · terminados: ${done.length}`);
  const rows = [];
  let calls = 0;
  for (const f of done) {
    const fid = f.fixture.id;
    let stats;
    try { stats = await call('fixtures/statistics', { fixture: fid }); calls++; }
    catch (e) { console.warn(`stats ${fid}: ${e.message}`); continue; }
    await sleep(140);
    const home = stats.find(s => s.team.id === f.teams.home.id), away = stats.find(s => s.team.id === f.teams.away.id);
    if (!home || !away) { console.warn(`stats ${fid}: incompletas`); continue; }
    const hCode = ALIAS_TO_ID[norm(f.teams.home.name)] || null, aCode = ALIAS_TO_ID[norm(f.teams.away.name)] || null;
    if (!hCode || !aCode) console.warn(`sin mapear: ${f.teams.home.name} / ${f.teams.away.name}`);
    rows.push({
      fixture_id: fid,
      date: f.fixture.date,
      round: (f.league && f.league.round) || null,
      referee: f.fixture.referee || null,
      status: f.fixture.status.short,               // FT | AET | PEN (AET/PEN: stats incluyen prórroga)
      et: f.fixture.status.short !== 'FT',
      home: { code: hCode, name: f.teams.home.name, goals: f.goals.home, ...statMap(home) },
      away: { code: aCode, name: f.teams.away.name, goals: f.goals.away, ...statMap(away) },
    });
    process.stdout.write(`\r${rows.length}/${done.length}  ${f.teams.home.name} - ${f.teams.away.name}          `);
  }
  console.log();
  rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  const out = { generated_at: new Date().toISOString(), league: LEAGUE, season: SEASON, matches: rows };
  const dest = path.join(__dirname, '..', 'data', 'props-history.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));
  console.log(`guardado ${dest} · ${rows.length} partidos · ${calls + 1} llamadas API`);
})().catch(e => { console.error(e); process.exit(1); });
