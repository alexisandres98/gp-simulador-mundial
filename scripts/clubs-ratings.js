// scripts/clubs-ratings.js — FIT DE RATINGS POR LIGA (fase clubes). Lee data/history/*.json (backfill TSA),
// corre clubs-engine/ratings.fit por competición y escribe data/clubs/ratings.json (commiteable → prod lo
// sirve sin tocar la DB). Liga MX arranca temporada nueva (Apertura): sus ratings nacen del Clausura 2026
// completo y se irán actualizando con los partidos del Apertura a medida que se liquiden.
//
// Uso: node scripts/clubs-ratings.js
'use strict';
const fs = require('fs');
const path = require('path');
const { fit, backtest, goalsBacktest } = require('../clubs-engine/ratings');
const { matchProbs } = require('../engine');

const HIST = path.join(__dirname, '..', 'data', 'history');
const OUT = path.join(__dirname, '..', 'data', 'clubs');

// Registro de ligas de la fase 1 (LATAM en temporada + puente). key = slug estable de la plataforma.
// ratings_from: archivos de historial en orden cronológico (temporada previa primero).
const LEAGUES = [
  { key: 'ligamx', name: 'Liga MX · Apertura', country: 'México', comp: 'comp_298265', season: 'sn_2977262', ratings_from: ['comp_137103-sn_7293403', 'comp_298265-sn_2977262'], odds_key: 'soccer_mexico_ligamx' },
  { key: 'brasileirao', name: 'Brasileirão Série A', country: 'Brasil', comp: 'comp_4795', season: 'sn_8459352', ratings_from: ['comp_4795-sn_8459352'], odds_key: 'soccer_brazil_campeonato' },
  { key: 'mls', name: 'MLS', country: 'Estados Unidos y Canadá', comp: 'comp_9799', season: 'sn_8454787', ratings_from: ['comp_9799-sn_8454787'], odds_key: 'soccer_usa_mls' },
  { key: 'colombia', name: 'Primera A · Apertura', country: 'Colombia', comp: 'comp_720692', season: 'sn_5722143', ratings_from: ['comp_720692-sn_5722143'] },
  { key: 'paraguay', name: 'Primera División · Apertura', country: 'Paraguay', comp: 'comp_137809', season: 'sn_8453624', ratings_from: ['comp_137809-sn_8453624'] },
  { key: 'argentina', name: 'Liga Profesional', country: 'Argentina', comp: 'comp_4540', season: 'sn_5721417', ratings_from: ['comp_4540-sn_5721417'], odds_key: 'soccer_argentina_primera_division' },
  { key: 'csl', name: 'CFA Super League', country: 'China', comp: 'comp_7712', season: 'sn_7290909', ratings_from: ['comp_7712-sn_7290909'], odds_key: 'soccer_china_superleague' },
  { key: 'kleague', name: 'K League 1', country: 'Corea del Sur', comp: 'comp_1646', season: 'sn_6133361', ratings_from: ['comp_1646-sn_6133361'], odds_key: 'soccer_korea_kleague1' },
  { key: 'j1', name: 'J1 League', country: 'Japón', comp: 'comp_6240', season: 'sn_2960779', ratings_from: ['comp_6240-sn_2960779'] },
  // EXPANSIÓN 24-jul (decisión Alexis): ligas activas con cuotas en el proveedor + data TSA. Mitad de
  // temporada → fit de la temporada en curso; recién arrancadas (26/27) → fit temporada previa + actual, y
  // players_season = temporada previa (percentiles/scout con data real mientras la nueva acumula partidos).
  { key: 'brasilb', name: 'Brasileirão Série B', country: 'Brasil', comp: 'comp_1085', season: 'sn_1307939', ratings_from: ['comp_1085-sn_1307939'], odds_key: 'soccer_brazil_serie_b' },
  { key: 'chile', name: 'Primera División', country: 'Chile', comp: 'comp_573599', season: 'sn_5722124', ratings_from: ['comp_573599-sn_5722124'], odds_key: 'soccer_chile_campeonato' },
  { key: 'noruega', name: 'Eliteserien', country: 'Noruega', comp: 'comp_1992', season: 'sn_7293915', ratings_from: ['comp_1992-sn_7293915'], odds_key: 'soccer_norway_eliteserien' },
  { key: 'suecia', name: 'Allsvenskan', country: 'Suecia', comp: 'comp_1002', season: 'sn_4576877', ratings_from: ['comp_1002-sn_4576877'], odds_key: 'soccer_sweden_allsvenskan' },
  { key: 'finlandia', name: 'Veikkausliiga', country: 'Finlandia', comp: 'comp_2674', season: 'sn_1305664', ratings_from: ['comp_2674-sn_1305664'], odds_key: 'soccer_finland_veikkausliiga' },
  { key: 'irlanda', name: 'Premier Division', country: 'Irlanda', comp: 'comp_9788', season: 'sn_9618711', ratings_from: ['comp_9788-sn_9618711'], odds_key: 'soccer_league_of_ireland' },
  { key: 'dinamarca', name: 'Superliga', country: 'Dinamarca', comp: 'comp_7938', season: 'sn_4588672', players_season: 'sn_2957203', ratings_from: ['comp_7938-sn_2957203', 'comp_7938-sn_4588672'], odds_key: 'soccer_denmark_superliga' },
  { key: 'polonia', name: 'Ekstraklasa', country: 'Polonia', comp: 'comp_9711', season: 'sn_0833509', players_season: 'sn_3061308', ratings_from: ['comp_9711-sn_3061308', 'comp_9711-sn_0833509'], odds_key: 'soccer_poland_ekstraklasa' },
  { key: 'rusia', name: 'Premier League', country: 'Rusia', comp: 'comp_5824', season: 'sn_5749691', players_season: 'sn_9674388', ratings_from: ['comp_5824-sn_9674388', 'comp_5824-sn_5749691'], odds_key: 'soccer_russia_premier_league' },
  { key: 'suiza', name: 'Super League', country: 'Suiza', comp: 'comp_4084', season: 'sn_7250992', players_season: 'sn_9674311', ratings_from: ['comp_4084-sn_9674311', 'comp_4084-sn_7250992'], odds_key: 'soccer_switzerland_superleague' },
  // Las 5 grandes: temporada 2025-26 COMPLETA para ratings + backtest; arrancan la 26-27 a mediados de
  // agosto (starts la agrupa en la UI como pretemporada, sin próximos hasta que el proveedor los liste).
  { key: 'premier', name: 'Premier League', country: 'Inglaterra', comp: 'comp_3039', season: 'sn_6125938', ratings_from: ['comp_3039-sn_6125938'], starts: 'agosto', odds_key: 'soccer_epl' },
  { key: 'laliga', name: 'LaLiga', country: 'España', comp: 'comp_8814', season: 'sn_7246390', ratings_from: ['comp_8814-sn_7246390'], starts: 'agosto', odds_key: 'soccer_spain_la_liga' },
  { key: 'bundesliga', name: 'Bundesliga', country: 'Alemania', comp: 'comp_4643', season: 'sn_5789634', ratings_from: ['comp_4643-sn_5789634'], starts: 'agosto', odds_key: 'soccer_germany_bundesliga' },
  { key: 'seriea', name: 'Serie A', country: 'Italia', comp: 'comp_5840', season: 'sn_3061436', ratings_from: ['comp_5840-sn_3061436'], starts: 'agosto', odds_key: 'soccer_italy_serie_a' },
  { key: 'ligue1', name: 'Ligue 1', country: 'Francia', comp: 'comp_0256', season: 'sn_6120181', ratings_from: ['comp_0256-sn_6120181'], starts: 'agosto', odds_key: 'soccer_france_ligue_one' },
  // EXPANSIÓN 2-ago (descubiertas por el discovery, con el matcher ya arreglado: país + nivel + empate→null).
  // Todas con cuotas en el proveedor y stats de equipo en TSA. Las 26/27 arrancan ahora, así que el Elo nace
  // de la temporada previa y se actualiza con los partidos nuevos conforme liquiden; players_season apunta a
  // la previa para que percentiles y scout tengan data real mientras la nueva acumula.
  { key: 'liga3', name: '3. Liga', country: 'Alemania', comp: 'comp_2837', season: 'sn_9629107', players_season: 'sn_0815351', ratings_from: ['comp_2837-sn_0815351', 'comp_2837-sn_9629107'], starts: 'agosto', odds_key: 'soccer_germany_liga3' },
  { key: 'ligue2', name: 'Ligue 2', country: 'Francia', comp: 'comp_9777', season: 'sn_7255696', players_season: 'sn_3064056', ratings_from: ['comp_9777-sn_3064056', 'comp_9777-sn_7255696'], starts: 'agosto', odds_key: 'soccer_france_ligue_two' },
  { key: 'bundesliga2', name: '2. Bundesliga', country: 'Alemania', comp: 'comp_0406', season: 'sn_6190936', players_season: 'sn_0815700', ratings_from: ['comp_0406-sn_0815700', 'comp_0406-sn_6190936'], starts: 'agosto', odds_key: 'soccer_germany_bundesliga2' },
  { key: 'eredivisie', name: 'Eredivisie', country: 'Países Bajos', comp: 'comp_3809', season: 'sn_5744954', players_season: 'sn_9674249', ratings_from: ['comp_3809-sn_9674249', 'comp_3809-sn_5744954'], starts: 'agosto', odds_key: 'soccer_netherlands_eredivisie' },
  { key: 'superettan', name: 'Superettan', country: 'Suecia', comp: 'comp_6917', season: 'sn_0842342', ratings_from: ['comp_6917-sn_2998551', 'comp_6917-sn_0842342'], odds_key: 'soccer_sweden_superettan' },
  { key: 'austria', name: 'Bundesliga', country: 'Austria', comp: 'comp_4893', season: 'sn_5749764', players_season: 'sn_9673680', ratings_from: ['comp_4893-sn_9673680', 'comp_4893-sn_5749764'], starts: 'agosto', odds_key: 'soccer_austria_bundesliga' },
  { key: 'escocia', name: 'Premiership', country: 'Escocia', comp: 'comp_6387', season: 'sn_8406037', players_season: 'sn_8436747', ratings_from: ['comp_6387-sn_8436747', 'comp_6387-sn_8406037'], starts: 'agosto', odds_key: 'soccer_spl' },
  // EXPANSIÓN 5-ago (discovery del 5-ago: 9 ligas domésticas con cuotas activas en Odds API que no teníamos).
  // Bélgica/Portugal/Grecia venían RECHAZADAS por el matcher automático (nombres comerciales: "Pro League",
  // "Liga Portugal Betclic", "Stoiximan Super League") → comp verificado a MANO contra el catálogo TSA
  // (--info: país correcto en las 9). Mismo patrón del 2-ago: Elo nace de la 25/26 completa, players_season
  // apunta a la previa; las 9 con 0 finalizados en la 26/27 al alta (5-ago) → pretemporada 'agosto'.
  { key: 'championship', name: 'Championship', country: 'Inglaterra', comp: 'comp_8321', season: 'sn_3014533', players_season: 'sn_3064530', ratings_from: ['comp_8321-sn_3064530', 'comp_8321-sn_3014533'], starts: 'agosto', odds_key: 'soccer_efl_champ' },
  { key: 'league1', name: 'League One', country: 'Inglaterra', comp: 'comp_0196', season: 'sn_3014087', players_season: 'sn_9673094', ratings_from: ['comp_0196-sn_9673094', 'comp_0196-sn_3014087'], starts: 'agosto', odds_key: 'soccer_england_league1' },
  { key: 'league2', name: 'League Two', country: 'Inglaterra', comp: 'comp_4023', season: 'sn_8407455', players_season: 'sn_2951327', ratings_from: ['comp_4023-sn_2951327', 'comp_4023-sn_8407455'], starts: 'agosto', odds_key: 'soccer_england_league2' },
  { key: 'serieb', name: 'Serie B', country: 'Italia', comp: 'comp_5450', season: 'sn_3025358', players_season: 'sn_9686012', ratings_from: ['comp_5450-sn_9686012', 'comp_5450-sn_3025358'], starts: 'agosto', odds_key: 'soccer_italy_serie_b' },
  { key: 'laliga2', name: 'LaLiga 2', country: 'España', comp: 'comp_0976', season: 'sn_1368511', players_season: 'sn_8437950', ratings_from: ['comp_0976-sn_8437950', 'comp_0976-sn_1368511'], starts: 'agosto', odds_key: 'soccer_spain_segunda_division' },
  { key: 'portugal', name: 'Liga Portugal', country: 'Portugal', comp: 'comp_8385', season: 'sn_6190962', players_season: 'sn_6120591', ratings_from: ['comp_8385-sn_6120591', 'comp_8385-sn_6190962'], starts: 'agosto', odds_key: 'soccer_portugal_primeira_liga' },
  { key: 'belgica', name: 'Pro League', country: 'Bélgica', comp: 'comp_8531', season: 'sn_6195301', players_season: 'sn_1397734', ratings_from: ['comp_8531-sn_1397734', 'comp_8531-sn_6195301'], starts: 'agosto', odds_key: 'soccer_belgium_first_div' },
  { key: 'turquia', name: 'Süper Lig', country: 'Turquía', comp: 'comp_9235', season: 'sn_1361088', players_season: 'sn_4502189', ratings_from: ['comp_9235-sn_4502189', 'comp_9235-sn_1361088'], starts: 'agosto', odds_key: 'soccer_turkey_super_league' },
  { key: 'grecia', name: 'Super League', country: 'Grecia', comp: 'comp_4008', season: 'sn_7201312', players_season: 'sn_4504055', ratings_from: ['comp_4008-sn_4504055', 'comp_4008-sn_7201312'], starts: 'agosto', odds_key: 'soccer_greece_super_league' },
];

function loadMatches(files) {
  const all = [];
  for (const f of files) {
    const p = path.join(HIST, `${f}.json`);
    if (!fs.existsSync(p)) { console.log(`  (sin archivo ${f} — se salta)`); continue; }
    try { all.push(...(JSON.parse(fs.readFileSync(p, 'utf8')).matches || [])); } catch (e) { console.log(`  (error leyendo ${f}: ${e.message})`); }
  }
  return all;
}

fs.mkdirSync(OUT, { recursive: true });
// SEMILLA DE ASCENDIDOS (24-jul, bug Atlante): un equipo que entra a la liga esta temporada no está en los
// history files (no jugó) → quedaba FUERA de ratings (sin página, sin plantilla, known:false). Con la key de
// TSA se listan los equipos del calendario de la temporada ACTUAL (cualquier status) y los que falten se
// siembran con prior 1500/games 0 — su Elo real lo construye el overlay dinámico partido a partido.
const TSA_KEY = process.env.THESTATSAPI_KEY || '';
async function seasonTeams(comp, season) {
  if (!TSA_KEY) return {};
  const teams = {};
  for (let page = 1; page <= 4; page++) {
    try {
      const r = await fetch(`https://api.thestatsapi.com/api/football/matches?competition_id=${comp}&season_id=${season}&per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${TSA_KEY}` }, signal: AbortSignal.timeout(20000) });
      const j = r.ok ? await r.json().catch(() => null) : null;
      const rows = (j && j.data) || [];
      for (const m of rows) for (const t of [m.home_team, m.away_team]) if (t && t.id) teams[t.id] = t.name;
      const meta = (j && j.meta) || {};
      if (!rows.length || page >= (meta.total_pages || 1)) break;
      await new Promise(x => setTimeout(x, 1300));
    } catch { break; }
  }
  return teams;
}
(async () => {
const out = { _meta: { fitted_at: new Date().toISOString(), engine: 'clubs-elo-1.0.0' }, leagues: {} };
for (const L of LEAGUES) {
  const matches = loadMatches(L.ratings_from);
  const r = fit(matches);
  // siembra: equipos del calendario actual que el fit no vio (ascendidos/nuevos)
  try {
    const st = await seasonTeams(L.comp, L.season);
    const seeded = [];
    for (const [id, name] of Object.entries(st)) { if (!r.ratings[id]) { r.ratings[id] = { elo: 1500, name, games: 0 }; seeded.push(name); } }
    if (seeded.length) console.log(`  (${L.key}: sembrados ${seeded.length} ascendidos → ${seeded.join(', ')})`);
  } catch { /* sin key/red: fit puro */ }
  // GATE por liga (clubs-gate-1): backtest walk-forward del 1X2 con el modelo COMPLETO (Elo→matchProbs).
  // approved → la liga puede alimentar picks/value; shadow → cartelera con "en calibración".
  let bt = null;
  try { bt = backtest(matches, { probs: matchProbs }); } catch (e) { console.log(`  (backtest ${L.key}: ${e.message})`); }
  // GATE DE GOLES (F3.1, clubs-goals-gate-1): backtest walk-forward de la CALIBRACIÓN del goal engine en O/U 2.5.
  // Prerequisito duro para picks de GOLES: sin skill demostrado por liga NO se emiten (approved → habilita goles).
  let gbt = null;
  try { gbt = goalsBacktest(matches); } catch (e) { console.log(`  (goals-backtest ${L.key}: ${e.message})`); }
  // Tabla de posiciones de la temporada ACTUAL (último archivo = temporada en curso; para las de agosto es la 25-26 final)
  const seasonMatches = loadMatches(L.ratings_from.slice(-1));
  const st = {};
  for (const m of seasonMatches) {
    const hg = Number(m.home.goals), ag = Number(m.away.goals);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
    const H = st[String(m.home.id)] = st[String(m.home.id)] || { id: String(m.home.id), name: m.home.name, pts: 0, pj: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    const A = st[String(m.away.id)] = st[String(m.away.id)] || { id: String(m.away.id), name: m.away.name, pts: 0, pj: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    H.pj++; A.pj++; H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
    if (hg > ag) { H.w++; A.l++; H.pts += 3; } else if (hg < ag) { A.w++; H.l++; A.pts += 3; } else { H.d++; A.d++; H.pts++; A.pts++; }
  }
  const standings = Object.values(st).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf);
  out.leagues[L.key] = { ...L, ...r, backtest: bt, goals_backtest: gbt, standings };
  const top = Object.values(r.ratings).sort((a, b) => b.elo - a.elo).slice(0, 3).map(t => `${t.name} ${t.elo}`).join(' · ');
  console.log(`${L.key}: ${r.n_matches} partidos | hfa ${r.hfa} | ${bt ? `1X2 ${bt.status.toUpperCase()} (Brier ${bt.brier}, calErr ${bt.cal_err})` : 'sin bt'} | ${gbt ? `GOLES ${gbt.status.toUpperCase()} (skill ${gbt.over25 && gbt.over25.skill}, calErr ${gbt.over25 && gbt.over25.cal_err})` : 'sin gbt'}`);
  console.log(`  top: ${top}`);
}
fs.writeFileSync(path.join(OUT, 'ratings.json'), JSON.stringify(out));
console.log(`\n→ data/clubs/ratings.json (${Object.keys(out.leagues).length} ligas)`);
})();
