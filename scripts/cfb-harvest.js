// scripts/cfb-harvest.js — BASE HISTÓRICA DE COLLEGE FOOTBALL (18-ago, encargo de Alexis: "construye todo
// lo de fútbol americano").
//
// LA FUENTE. CollegeFootballData.com (CFBD) es el nflverse del college y da EN UNA SOLA API lo que a NFL
// le costó dos fuentes: historial de partidos, LÍNEAS DE CIERRE históricas (varios libros, consensus desde
// 2016) y métricas avanzadas. Free tier: 1.000 llamadas/mes — esta cosecha completa gasta ~25 llamadas
// (una por temporada y endpoint), así que cabe holgada; la incremental semanal gasta 2.
//
// LO QUE BAJA, en el MISMO espíritu slim de data/nfl/:
//   ncaaf-games.json  filas {id, season, week, type, date, home, away, hp, ap, neutral, spread_close,
//                     total_close, ml_home, ml_away} — la línea viene FUSIONADA en la fila del partido.
//   ncaaf-teams.json  equipos FBS 2026 con logo, abreviatura y conferencia (para la UI).
// Solo FBS: se guarda el partido si ALGÚN lado es FBS; los cruces con FCS quedan marcados (fcs_opp) porque
// el rating debe tratarlos distinto (el rival no tiene rating propio).
//
// CONVENCIÓN DE LÍNEA, verificada y no asumida (la lección NFL-1036): CFBD publica `spread` como la línea
// DEL LOCAL con signo de casa (local favorito = spread NEGATIVO, "Kansas State -2.5"). La casa GP usa
// "resultado = puntos local − puntos visita" y "spread_close = línea del local en la MISMA escala del
// resultado" (favorito local = positivo), así que aquí se INVIERTE el signo al guardar. cfb-fit lo
// verifica con el residuo medio, igual que hizo NFL.
//
// Prioridad de libro para el cierre: consensus → ESPN Bet → William Hill (NJ) → DraftKings → Bovada →
// Caesars → el primero que haya. El proveedor elegido queda en la fila (`line_src`).
//
// USO
//   CFBD_API_KEY=... node scripts/cfb-harvest.js                 # histórico completo 2014-2025 + 2026
//   CFBD_API_KEY=... node scripts/cfb-harvest.js --since=2026    # incremental (temporada en curso)
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'amfoot');
const KEY = process.env.CFBD_API_KEY || '';
if (!KEY) { console.error('falta CFBD_API_KEY'); process.exit(1); }
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let calls = 0;
async function api(pathq) {
  calls++;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://api.collegefootballdata.com' + pathq, {
        headers: { Authorization: 'Bearer ' + KEY, accept: 'application/json' },
        signal: AbortSignal.timeout(45000),
      });
      if (r.status === 429) { await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i === 2) throw e; await sleep(1500 * (i + 1)); }
  }
}

const PROVIDER_PRIORITY = ['consensus', 'ESPN Bet', 'William Hill (New Jersey)', 'DraftKings', 'Draft Kings', 'Bovada', 'Caesars', 'teamrankings', 'numberfire'];
function pickLine(lines) {
  if (!lines || !lines.length) return null;
  for (const prov of PROVIDER_PRIORITY) {
    const l = lines.find((x) => x.provider === prov && (x.spread != null || x.overUnder != null));
    if (l) return l;
  }
  return lines.find((x) => x.spread != null || x.overUnder != null) || null;
}

const slim = (g) => ({
  id: g.id, season: g.season, week: g.week,
  type: g.seasonType === 'postseason' ? 'POST' : 'REG',
  date: String(g.startDate || '').slice(0, 10), start: g.startDate || null,
  home: g.homeTeam, away: g.awayTeam,
  hp: g.homePoints != null ? g.homePoints : null, ap: g.awayPoints != null ? g.awayPoints : null,
  neutral: !!g.neutralSite,
  conf_h: g.homeConference || null, conf_a: g.awayConference || null,
  // cruce con no-FBS: el rival sin rating propio se modela con el prior de su división, no como un FBS malo
  fcs_opp: (g.homeClassification === 'fbs') !== (g.awayClassification === 'fbs'),
});

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const since = +arg('since', 2014);
  const GAMES_FILE = path.join(DIR, 'ncaaf-games.json');
  let store = { games: {} };
  try { store = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')); } catch { /* primera pasada */ }

  const thisYear = 2026;
  for (let y = since; y <= thisYear; y++) {
    // partidos (regular + post en dos llamadas: la API no acepta 'both' en /games)
    for (const st of ['regular', 'postseason']) {
      const rows = await api(`/games?year=${y}&seasonType=${st}`);
      let kept = 0;
      for (const g of rows || []) {
        if (g.homeClassification !== 'fbs' && g.awayClassification !== 'fbs') continue;
        store.games[g.id] = Object.assign(store.games[g.id] || {}, slim(g));
        kept++;
      }
      console.log(`[cfb] ${y} ${st}: ${(rows || []).length} filas, ${kept} FBS guardadas`);
      await sleep(600);
    }
    // líneas de cierre (desde 2016, que es donde consensus arranca; una llamada cubre regular+post)
    if (y >= 2016) {
      const lg = await api(`/lines?year=${y}&seasonType=both`);
      let joined = 0;
      for (const row of lg || []) {
        const g = store.games[row.id]; if (!g) continue;
        const l = pickLine(row.lines); if (!l) continue;
        // signo: CFBD trae la línea de casa (favorito local = NEGATIVO) → escala GP (favorito local = positivo)
        g.spread_close = l.spread != null ? +(-l.spread).toFixed(1) : null;
        g.total_close = l.overUnder != null ? +(+l.overUnder).toFixed(1) : null;
        g.ml_home = l.homeMoneyline != null ? l.homeMoneyline : null;
        g.ml_away = l.awayMoneyline != null ? l.awayMoneyline : null;
        g.line_src = l.provider;
        joined++;
      }
      console.log(`[cfb] ${y} líneas: ${(lg || []).length} partidos con libro, ${joined} fusionadas`);
      await sleep(600);
    }
  }
  fs.writeFileSync(GAMES_FILE, JSON.stringify(store));

  // equipos FBS de la temporada actual (logos y conferencias para la UI)
  const teams = await api(`/teams/fbs?year=${thisYear}`);
  fs.writeFileSync(path.join(DIR, 'ncaaf-teams.json'), JSON.stringify({
    at: new Date().toISOString(), season: thisYear,
    teams: (teams || []).map((t) => ({
      id: t.id, school: t.school, abbr: t.abbreviation || t.school, mascot: t.mascot || null,
      conference: t.conference || null, division: t.division || null,
      color: t.color || null, logo: (t.logos || [])[0] || null,
    })),
  }));

  const all = Object.values(store.games);
  const done = all.filter((g) => g.hp != null);
  const withLine = all.filter((g) => g.spread_close != null);
  console.log(`[cfb] LISTO · ${all.length} partidos (${done.length} con resultado, ${withLine.length} con cierre) · ${(teams || []).length} equipos FBS · ${calls} llamadas a CFBD`);
}

main().catch((e) => { console.error('[cfb] FALLO:', e.message); process.exit(1); });
