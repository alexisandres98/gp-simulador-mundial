// scripts/lol-harvest.js — BASE HISTÓRICA PROPIA DE LoL vía Leaguepedia Cargo API (18-ago, blueprint 3.0).
//
// FASE 1 DEL BLUEPRINT ("build memory before intelligence"): sin base propia no hay rating, ni posterior
// de campeón por parche, ni mastery, ni draft engine — solo la agenda del proveedor de cuotas. La fuente
// de arranque es Leaguepedia (lol.fandom.com), que expone una Cargo API estructurada con TODO lo que la
// Fase 1 pide: partidas con parche y lado, scoreboard por jugador con campeón y rol, y picks/bans con
// ORDEN. Oracle's Elixir (la otra fuente de investigación que el blueprint nombra) tiene la cuota de
// descarga de Drive agotada — se intentó primero y quedó documentado.
//
// DERECHOS (LOL-0036/0038/0042, la regla crítica del blueprint): Leaguepedia es CC BY-SA — vale para
// INVESTIGACIÓN con atribución, NO es `betting_commercial_ok`. La base alimenta el rating, el catálogo y
// la sombra ADMIN-ONLY; ninguna pick pública puede nacer de aquí. El registro de derechos vive en
// data/esports/lol/RIGHTS.md y el flag viaja en el propio archivo (`rights_class`).
//
// DÓNDE CORRE. La IP del sandbox de desarrollo está limitada por Fandom (429 inmediato, verificado);
// Render no. Con GP_LOL_HARVEST=1 el server lo corre UNA vez por boot (patrón GP_BOXING_BACKFILL), a
// 1 req / 3,5 s con backoff — ~650 llamadas ≈ 40 min, y es REANUDABLE (pagina por fecha y funde por
// GameId). El resultado se recoge por /api/internal/lolraw y se versiona en el repo.
//
// QUÉ BAJA (tres tablas, cada una con su ventana):
//   games.json    ScoreboardGames  2020-01 →  equipo1/equipo2 (equipo1 = lado AZUL), ganador, fecha,
//                 parche, duración, kills/dragones/barones/torres por lado, torneo (OverviewPage).
//   players.json  ScoreboardPlayers 2023-01 → por partida y jugador: campeón, rol, K/D/A, CS, oro, lado.
//                 (ventana más corta a propósito: mastery y pools son features de RECENCIA.)
//   drafts.json   PicksAndBansS7   2024-01 → bans y picks CON ORDEN por partida (la materia prima del
//                 Draft Engine; S7 es el nombre histórico de la tabla, cubre el formato actual).
//
// USO
//   node scripts/lol-harvest.js                    # todo
//   node scripts/lol-harvest.js --only=games       # una tabla
//   node scripts/lol-harvest.js --sleep=3500       # throttle en ms (default 3500)
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'esports', 'lol');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const ONLY = arg('only', '');
const SLEEP = +arg('sleep', 3500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'GP-Simulador/1.0 (codigo@gpsimulador.com; cosecha lenta 1req/3.5s, contacto en el UA)';

let calls = 0;
async function cargo(params) {
  const qs = new URLSearchParams({ action: 'cargoquery', format: 'json', limit: '500', ...params });
  const url = 'https://lol.fandom.com/api.php?' + qs.toString();
  for (let i = 0; i < 6; i++) {
    calls++;
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(40000) });
      const j = await r.json();
      if (j.error && j.error.code === 'ratelimited') { console.log(`[lol] ratelimited, espero ${30 * (i + 1)}s…`); await sleep(30000 * (i + 1)); continue; }
      if (j.error) throw new Error(j.error.info || j.error.code);
      return (j.cargoquery || []).map((x) => x.title);
    } catch (e) { if (i === 5) throw e; await sleep(8000 * (i + 1)); }
  }
  return [];
}

const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, f), JSON.stringify(o)); };

// paginación por fecha ASC (offset grande en Cargo es lento y frágil): se avanza con el último timestamp
// visto y se funde por clave única — reanudable por construcción.
async function harvestTable({ file, table, fields, since, keyOf, slim, extraWhere = '', joinTables = null, joinOn = null, dateField = null }) {
  const st = rd(file) || { rights_class: 'research_attribution_ccbysa', source: 'Leaguepedia (lol.fandom.com) Cargo API', rows: {} };
  let cursor = st.cursor || since;
  let total = Object.keys(st.rows).length;
  console.log(`[lol] ${table}: reanudo desde ${cursor} · ${total} filas en disco`);
  let stall = 0;
  const df = dateField || `${table}.DateTime_UTC`;
  while (true) {
    // >= y dedupe por clave: con > estricto se perderían las filas que comparten el timestamp del corte
    // de página. Si una página entera no aporta filas nuevas y el cursor no avanza, se empuja 1 segundo
    // (imposible con partidas reales, pero un bucle infinito no se deja al azar).
    const where = `${df}>='${cursor}'${extraWhere}`;
    const q = { tables: joinTables || table, fields, where, order_by: `${df} ASC` };
    if (joinOn) q.join_on = joinOn;
    const rows = await cargo(q);
    if (!rows.length) break;
    let added = 0, maxDt = cursor;
    for (const row of rows) {
      const dt = row['DateTime UTC'] || row.DateTime_UTC || '';
      if (dt > maxDt) maxDt = dt;
      const k = keyOf(row);
      if (!k) continue;
      if (!st.rows[k]) added++;
      st.rows[k] = slim(row);
    }
    total = Object.keys(st.rows).length;
    if (maxDt === cursor && added === 0) {
      const t2 = new Date(Date.parse(cursor.replace(' ', 'T') + 'Z') + 1000);
      maxDt = t2.toISOString().slice(0, 19).replace('T', ' ');
    }
    cursor = maxDt;
    st.cursor = cursor; st.at = new Date().toISOString();
    wr(file, st);
    console.log(`[lol] ${table}: +${added} (total ${total}) · cursor ${cursor} · ${calls} llamadas`);
    if (added === 0) { stall++; if (stall >= 4) { console.log(`[lol] ${table}: 4 páginas sin filas nuevas — fin`); break; } }
    else stall = 0;
    if (rows.length < 480 && added === 0) break;
    if (rows.length < 480 && stall === 0) { /* última página con filas nuevas: una vuelta más confirma el fin */ }
    await sleep(SLEEP);
  }
  console.log(`[lol] ${table} LISTO: ${total} filas`);
}

const N = (x) => (x == null || x === '' ? null : +x);

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  if (!ONLY || ONLY === 'games') {
    await harvestTable({
      file: 'games.json', table: 'ScoreboardGames', since: '2020-01-01 00:00:00',
      fields: ['GameId', 'Team1', 'Team2', 'WinTeam', 'DateTime_UTC', 'Patch', 'Gamelength_Number',
        'Team1Kills', 'Team2Kills', 'Team1Dragons', 'Team2Dragons', 'Team1Barons', 'Team2Barons',
        'Team1Towers', 'Team2Towers', 'Team1Gold', 'Team2Gold', 'OverviewPage']
        .map((f) => 'ScoreboardGames.' + f).join(','),
      keyOf: (r) => r.GameId || null,
      // convención Leaguepedia: Team1 = lado AZUL, Team2 = lado ROJO (verificada contra partidas conocidas)
      slim: (r) => ({
        id: r.GameId, t1: r.Team1, t2: r.Team2, win: r.WinTeam,
        at: r['DateTime UTC'] || null, patch: r.Patch || null, len: N(r['Gamelength Number']),
        k1: N(r.Team1Kills), k2: N(r.Team2Kills), d1: N(r.Team1Dragons), d2: N(r.Team2Dragons),
        b1: N(r.Team1Barons), b2: N(r.Team2Barons), tw1: N(r.Team1Towers), tw2: N(r.Team2Towers),
        g1: N(r.Team1Gold), g2: N(r.Team2Gold), page: r.OverviewPage || null,
      }),
    });
  }
  if (!ONLY || ONLY === 'players') {
    await harvestTable({
      file: 'players.json', table: 'ScoreboardPlayers', since: '2023-01-01 00:00:00',
      fields: ['GameId', 'Link', 'Champion', 'Role', 'Kills', 'Deaths', 'Assists', 'CS', 'Gold',
        'Team', 'Side', 'PlayerWin', 'DateTime_UTC']
        .map((f) => 'ScoreboardPlayers.' + f).join(','),
      keyOf: (r) => (r.GameId && r.Link) ? `${r.GameId}|${r.Link}` : null,
      slim: (r) => ({
        g: r.GameId, p: r.Link, ch: r.Champion || null, role: r.Role || null,
        k: N(r.Kills), d: N(r.Deaths), a: N(r.Assists), cs: N(r.CS), gold: N(r.Gold),
        team: r.Team || null, side: r.Side || null, win: r.PlayerWin === 'Yes' ? 1 : r.PlayerWin === 'No' ? 0 : null,
        at: r['DateTime UTC'] || null,
      }),
    });
  }
  if (!ONLY || ONLY === 'drafts') {
    await harvestTable({
      file: 'drafts.json', table: 'PicksAndBansS7', since: '2024-01-01 00:00:00',
      joinTables: 'PicksAndBansS7,ScoreboardGames',
      joinOn: 'PicksAndBansS7.GameId=ScoreboardGames.GameId',
      dateField: 'ScoreboardGames.DateTime_UTC',
      fields: ['GameId', 'Team1Ban1', 'Team1Ban2', 'Team1Ban3', 'Team1Ban4', 'Team1Ban5',
        'Team2Ban1', 'Team2Ban2', 'Team2Ban3', 'Team2Ban4', 'Team2Ban5',
        'Team1Pick1', 'Team1Pick2', 'Team1Pick3', 'Team1Pick4', 'Team1Pick5',
        'Team2Pick1', 'Team2Pick2', 'Team2Pick3', 'Team2Pick4', 'Team2Pick5',
        'Team1PicksByRoleOrder', 'Team2PicksByRoleOrder']
        .map((f) => 'PicksAndBansS7.' + f).join(',') + ',ScoreboardGames.DateTime_UTC',
      keyOf: (r) => r.GameId || null,
      slim: (r) => ({
        g: r.GameId, at: r['DateTime UTC'] || null,
        b1: [r.Team1Ban1, r.Team1Ban2, r.Team1Ban3, r.Team1Ban4, r.Team1Ban5].filter(Boolean),
        b2: [r.Team2Ban1, r.Team2Ban2, r.Team2Ban3, r.Team2Ban4, r.Team2Ban5].filter(Boolean),
        p1: [r.Team1Pick1, r.Team1Pick2, r.Team1Pick3, r.Team1Pick4, r.Team1Pick5].filter(Boolean),
        p2: [r.Team2Pick1, r.Team2Pick2, r.Team2Pick3, r.Team2Pick4, r.Team2Pick5].filter(Boolean),
        r1: r.Team1PicksByRoleOrder || null, r2: r.Team2PicksByRoleOrder || null,
      }),
    });
  }
  console.log(`[lol] COSECHA COMPLETA · ${calls} llamadas totales`);
}

main().catch((e) => { console.error('[lol] FALLO:', e.message); process.exit(1); });
