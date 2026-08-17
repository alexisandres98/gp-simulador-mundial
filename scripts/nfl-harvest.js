// scripts/nfl-harvest.js — LA FUNDACIÓN DE DATOS DE NFL (17-ago, blueprint V0).
//
// El blueprint lo dice sin rodeos: el moat es el estado histórico point-in-time y las features propias, no
// una API externa (NFL-0014). Este script construye esa base con las fuentes Tier 0 del propio documento
// (NFL-1061): nflverse para histórico y The Odds API/ESPN en el servidor para el presente.
//
// ── QUÉ BAJA Y QUÉ DERIVA ────────────────────────────────────────────────────────────────────────────────
//   1. games.csv (nflverse/nfldata, Lee Sharpe): 1999→hoy. Trae LO QUE NINGUNA API en vivo da: las LÍNEAS
//      DE CIERRE históricas (spread/total/moneyline), QB titular, coach, descanso, techo, superficie,
//      clima y árbitro de cada partido. Es la columna vertebral de la validación (NFL-0744: point-in-time
//      odds) y del pool de residuos del simulador.
//   2. stats_team_week_YYYY.csv (nflverse): EPA de pase y de carrera POR EQUIPO-SEMANA, CPOE, jugadas
//      explosivas, first downs. La defensa se deriva uniendo cada fila con la del RIVAL en el mismo
//      partido — la EPA ofensiva del rival ES la defensiva del equipo.
//
// ── CRUDO / AGREGADO, mismo contrato que CS2 ─────────────────────────────────────────────────────────────
//   · CRUDO     → `<disk>/nfl-raw/` (CSVs tal cual, re-derivables sin red)
//   · AGREGADO  → `data/nfl/` (versionado): games.json, team-weeks.json, meta.json
//
// LA REGLA DURA DEL BLUEPRINT QUE ESTE ARCHIVO RESPETA (NFL-0100): ningún agregado mezcla información
// posterior al corte — cada team-week lleva su (season, week) y quien consuma DEBE filtrar por fecha.
//
// Uso:
//   node scripts/nfl-harvest.js                  # baja todo (2016→hoy) y deriva
//   node scripts/nfl-harvest.js --aggregate-only # re-deriva desde el crudo, sin red
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AGG_DIR = path.join(ROOT, 'data', 'nfl');
const RAW_DIR = (() => {
  const d = path.join(path.dirname(process.env.DB_FILE || path.join(ROOT, 'db.json')), 'nfl-raw');
  try { fs.mkdirSync(d, { recursive: true }); return d; } catch { }
  const f = path.join(ROOT, 'data', 'nfl-raw');
  try { fs.mkdirSync(f, { recursive: true }); } catch { }
  return f;
})();
try { fs.mkdirSync(AGG_DIR, { recursive: true }); } catch { }

const log = (...a) => console.log(...a);
const ARG = Object.fromEntries(process.argv.slice(2).map((s) => {
  const m = s.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [s, true];
}));

const SEASONS_STATS = (() => { const out = []; for (let y = 2016; y <= new Date().getUTCFullYear(); y++) out.push(y); return out; })();

async function dl(url, file) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'GPSimulador/1.0 (+https://gpsimulador.com)' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(RAW_DIR, file), buf);
  return buf.length;
}

// CSV parser mínimo (los archivos de nflverse son CSV simples con comillas ocasionales)
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };

async function harvest() {
  log('▸ bajando games.csv (1999→hoy, con cierres históricos)…');
  const b1 = await dl('https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv', 'games.csv');
  log(`  games.csv: ${(b1 / 1024).toFixed(0)} KB`);
  for (const y of SEASONS_STATS) {
    try {
      const b = await dl(`https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${y}.csv`, `stats_team_week_${y}.csv`);
      log(`  stats_team_week_${y}: ${(b / 1024).toFixed(0)} KB`);
    } catch (e) { log(`  stats_team_week_${y}: no disponible (${e.message})`); }
    await new Promise((r) => setTimeout(r, 300));
  }
}

function aggregate() {
  // ── GAMES ──────────────────────────────────────────────────────────────────────────────────────────────
  const raw = parseCsv(fs.readFileSync(path.join(RAW_DIR, 'games.csv'), 'utf8'));
  const games = raw.map((g) => ({
    id: g.game_id, season: +g.season, week: +g.week, type: g.game_type,
    date: g.gameday, time: g.gametime || null,
    away: g.away_team, home: g.home_team,
    away_score: num(g.away_score), home_score: num(g.home_score),
    result: num(g.result),                 // home − away (convención nflverse)
    total: num(g.total),
    ot: g.overtime === '1' ? 1 : 0,
    // EL CIERRE HISTÓRICO — la vara de toda validación. spread_line es la línea del LOCAL (positiva = local favorito).
    spread_close: num(g.spread_line), total_close: num(g.total_line),
    ml_away: num(g.away_moneyline), ml_home: num(g.home_moneyline),
    rest_away: num(g.away_rest), rest_home: num(g.home_rest),
    div_game: g.div_game === '1' ? 1 : 0,
    roof: g.roof || null, surface: g.surface || null,
    temp: num(g.temp), wind: num(g.wind),
    qb_away: g.away_qb_name || null, qb_home: g.home_qb_name || null,
    coach_away: g.away_coach || null, coach_home: g.home_coach || null,
    referee: g.referee || null, stadium: g.stadium || null, stadium_id: g.stadium_id || null,
    espn: g.espn || null,                   // el id de ESPN — el puente hacia el marcador en vivo y la liquidación
    location: g.location || null,           // 'Neutral' para juegos internacionales
  }));
  const bySeason = {};
  for (const g of games) (bySeason[g.season] = bySeason[g.season] || []).push(g);
  const nowSeason = Math.max(...Object.keys(bySeason).map(Number));
  // el repo lleva 2016+ (los modelos modernos, NFL-0026); lo anterior queda en el crudo para investigación
  const kept = games.filter((g) => g.season >= 2016);
  fs.writeFileSync(path.join(AGG_DIR, 'games.json'), JSON.stringify({
    at: new Date().toISOString(), from: 2016, current_season: nowSeason, n: kept.length,
    note: 'games.csv de nflverse/nfldata (Lee Sharpe). spread_close es la línea del LOCAL al cierre; result = home − away. Uso de investigación/desarrollo (Tier 0 del blueprint, NFL-1061/1062): revisar derechos antes de redistribuir el dato crudo públicamente.',
    games: kept,
  }));
  log(`  games.json: ${kept.length} partidos (${nowSeason} incluido)`);

  // ── TEAM-WEEKS: ofensa propia + defensa derivada del rival ─────────────────────────────────────────────
  const tw = [];
  for (const y of SEASONS_STATS) {
    let rows;
    try { rows = parseCsv(fs.readFileSync(path.join(RAW_DIR, `stats_team_week_${y}.csv`), 'utf8')); } catch { continue; }
    const byGame = {};
    for (const r of rows) (byGame[r.game_id] = byGame[r.game_id] || []).push(r);
    for (const r of rows) {
      const opp = (byGame[r.game_id] || []).find((x) => x.team !== r.team) || null;
      const dropbacks = (num(r.attempts) || 0) + (num(r.sacks_suffered) || 0);
      const plays = dropbacks + (num(r.carries) || 0);
      const mk = (x) => {
        const db = (num(x.attempts) || 0) + (num(x.sacks_suffered) || 0);
        const pl = db + (num(x.carries) || 0);
        return {
          pass_epa: pl ? (num(x.passing_epa) || 0) / Math.max(1, db) : null,   // EPA/dropback
          rush_epa: pl ? (num(x.rushing_epa) || 0) / Math.max(1, num(x.carries) || 1) : null,
          plays: pl,
          pass_rate: pl ? db / pl : null,
          cpoe: num(x.passing_cpoe),
          expl_pass: db ? ((num(x.passing_20) || 0) + 0) / db : null,          // pases de 20+ por dropback
          expl_rush: (num(x.carries) || 0) ? ((num(x.rushing_10) || 0)) / (num(x.carries) || 1) : null,
          sacks_suffered: num(x.sacks_suffered) || 0,
          sacks_made: num(x.def_sacks) || 0,
        };
      };
      const own = mk(r);
      tw.push({
        season: +r.season, week: +r.week, type: r.season_type,
        team: r.team, opp: r.opponent_team, game_id: r.game_id,
        off: { pass_epa: own.pass_epa, rush_epa: own.rush_epa, plays: own.plays, pass_rate: own.pass_rate,
          cpoe: own.cpoe, expl_pass: own.expl_pass, expl_rush: own.expl_rush, sacks_suffered: own.sacks_suffered },
        // la defensa del equipo es la ofensa del rival en este mismo partido — con la presión propia
        def: opp ? (() => { const o = mk(opp); return { pass_epa_allowed: o.pass_epa, rush_epa_allowed: o.rush_epa,
          expl_pass_allowed: o.expl_pass, expl_rush_allowed: o.expl_rush, sacks_made: own.sacks_made }; })() : null,
      });
    }
    log(`  team-weeks ${y}: acumuladas`);
  }
  fs.writeFileSync(path.join(AGG_DIR, 'team-weeks.json'), JSON.stringify({
    at: new Date().toISOString(), n: tw.length,
    note: 'EPA/jugada ofensiva por equipo-semana (nflverse stats_team_week); la defensiva se deriva de la fila del rival en el mismo partido. Point-in-time por construcción: cada fila lleva (season, week) y el consumidor filtra por corte (NFL-0100).',
    rows: tw,
  }));
  log(`  team-weeks.json: ${tw.length} filas`);

  // ── META ───────────────────────────────────────────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(AGG_DIR, 'meta.json'), JSON.stringify({
    at: new Date().toISOString(), seasons: SEASONS_STATS.filter((y) => fs.existsSync(path.join(RAW_DIR, `stats_team_week_${y}.csv`))),
    sources: [
      { source: 'nflverse/nfldata games.csv', kind: 'histórico + cierres', rights: 'desarrollo/investigación (revisar antes de redistribuir crudo)' },
      { source: 'nflverse stats_team_week', kind: 'EPA equipo-semana', rights: 'desarrollo/investigación' },
    ],
  }));
  const sizes = ['games.json', 'team-weeks.json', 'meta.json']
    .map((f) => `${f} ${(fs.statSync(path.join(AGG_DIR, f)).size / 1024).toFixed(0)} KB`).join(' · ');
  log(`▸ agregados escritos en data/nfl/: ${sizes}`);
}

(async () => {
  const t0 = Date.now();
  if (!ARG['aggregate-only']) await harvest();
  else log('▸ solo agregados (sin red)');
  aggregate();
  log(`▸ listo en ${((Date.now() - t0) / 1000).toFixed(1)} s · crudo en ${RAW_DIR}`);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
