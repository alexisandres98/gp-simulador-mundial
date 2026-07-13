// scripts/clubs-ratings.js — FIT DE RATINGS POR LIGA (fase clubes). Lee data/history/*.json (backfill TSA),
// corre clubs-engine/ratings.fit por competición y escribe data/clubs/ratings.json (commiteable → prod lo
// sirve sin tocar la DB). Liga MX arranca temporada nueva (Apertura): sus ratings nacen del Clausura 2026
// completo y se irán actualizando con los partidos del Apertura a medida que se liquiden.
//
// Uso: node scripts/clubs-ratings.js
'use strict';
const fs = require('fs');
const path = require('path');
const { fit, backtest } = require('../clubs-engine/ratings');
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
  { key: 'csl', name: 'CFA Super League', country: 'China', comp: 'comp_7712', season: 'sn_7290909', ratings_from: ['comp_7712-sn_7290909'] },
  { key: 'kleague', name: 'K League 1', country: 'Corea del Sur', comp: 'comp_1646', season: 'sn_6133361', ratings_from: ['comp_1646-sn_6133361'] },
  { key: 'j1', name: 'J1 League', country: 'Japón', comp: 'comp_6240', season: 'sn_2960779', ratings_from: ['comp_6240-sn_2960779'] },
  // Las 5 grandes: temporada 2025-26 COMPLETA para ratings + backtest; arrancan la 26-27 a mediados de
  // agosto (starts la agrupa en la UI como pretemporada, sin próximos hasta que el proveedor los liste).
  { key: 'premier', name: 'Premier League', country: 'Inglaterra', comp: 'comp_3039', season: 'sn_6125938', ratings_from: ['comp_3039-sn_6125938'], starts: 'agosto', odds_key: 'soccer_epl' },
  { key: 'laliga', name: 'LaLiga', country: 'España', comp: 'comp_8814', season: 'sn_7246390', ratings_from: ['comp_8814-sn_7246390'], starts: 'agosto', odds_key: 'soccer_spain_la_liga' },
  { key: 'bundesliga', name: 'Bundesliga', country: 'Alemania', comp: 'comp_4643', season: 'sn_5789634', ratings_from: ['comp_4643-sn_5789634'], starts: 'agosto', odds_key: 'soccer_germany_bundesliga' },
  { key: 'seriea', name: 'Serie A', country: 'Italia', comp: 'comp_5840', season: 'sn_3061436', ratings_from: ['comp_5840-sn_3061436'], starts: 'agosto', odds_key: 'soccer_italy_serie_a' },
  { key: 'ligue1', name: 'Ligue 1', country: 'Francia', comp: 'comp_0256', season: 'sn_6120181', ratings_from: ['comp_0256-sn_6120181'], starts: 'agosto', odds_key: 'soccer_france_ligue_one' },
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
const out = { _meta: { fitted_at: new Date().toISOString(), engine: 'clubs-elo-1.0.0' }, leagues: {} };
for (const L of LEAGUES) {
  const matches = loadMatches(L.ratings_from);
  const r = fit(matches);
  // GATE por liga (clubs-gate-1): backtest walk-forward del 1X2 con el modelo COMPLETO (Elo→matchProbs).
  // approved → la liga puede alimentar picks/value; shadow → cartelera con "en calibración".
  let bt = null;
  try { bt = backtest(matches, { probs: matchProbs }); } catch (e) { console.log(`  (backtest ${L.key}: ${e.message})`); }
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
  out.leagues[L.key] = { ...L, ...r, backtest: bt, standings };
  const top = Object.values(r.ratings).sort((a, b) => b.elo - a.elo).slice(0, 3).map(t => `${t.name} ${t.elo}`).join(' · ');
  console.log(`${L.key}: ${r.n_matches} partidos | hfa ${r.hfa} | ${bt ? `gate ${bt.status.toUpperCase()} (n=${bt.n}, Brier ${bt.brier} vs 0.667 uniforme, calErr ${bt.cal_err})` : 'sin backtest'}`);
  console.log(`  top: ${top}`);
}
fs.writeFileSync(path.join(OUT, 'ratings.json'), JSON.stringify(out));
console.log(`\n→ data/clubs/ratings.json (${Object.keys(out.leagues).length} ligas)`);
