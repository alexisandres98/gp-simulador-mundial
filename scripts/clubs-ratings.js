// scripts/clubs-ratings.js — FIT DE RATINGS POR LIGA (fase clubes). Lee data/history/*.json (backfill TSA),
// corre clubs-engine/ratings.fit por competición y escribe data/clubs/ratings.json (commiteable → prod lo
// sirve sin tocar la DB). Liga MX arranca temporada nueva (Apertura): sus ratings nacen del Clausura 2026
// completo y se irán actualizando con los partidos del Apertura a medida que se liquiden.
//
// Uso: node scripts/clubs-ratings.js
'use strict';
const fs = require('fs');
const path = require('path');
const { fit } = require('../clubs-engine/ratings');

const HIST = path.join(__dirname, '..', 'data', 'history');
const OUT = path.join(__dirname, '..', 'data', 'clubs');

// Registro de ligas de la fase 1 (LATAM en temporada + puente). key = slug estable de la plataforma.
// ratings_from: archivos de historial en orden cronológico (temporada previa primero).
const LEAGUES = [
  { key: 'ligamx', name: 'Liga MX · Apertura', country: 'México', comp: 'comp_298265', season: 'sn_2977262', ratings_from: ['comp_137103-sn_7293403', 'comp_298265-sn_2977262'] },
  { key: 'brasileirao', name: 'Brasileirão Série A', country: 'Brasil', comp: 'comp_4795', season: 'sn_8459352', ratings_from: ['comp_4795-sn_8459352'] },
  { key: 'mls', name: 'MLS', country: 'Estados Unidos y Canadá', comp: 'comp_9799', season: 'sn_8454787', ratings_from: ['comp_9799-sn_8454787'] },
  { key: 'colombia', name: 'Primera A · Apertura', country: 'Colombia', comp: 'comp_720692', season: 'sn_5722143', ratings_from: ['comp_720692-sn_5722143'] },
  { key: 'paraguay', name: 'Primera División · Apertura', country: 'Paraguay', comp: 'comp_137809', season: 'sn_8453624', ratings_from: ['comp_137809-sn_8453624'] },
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
  out.leagues[L.key] = { ...L, ...r };
  const top = Object.values(r.ratings).sort((a, b) => b.elo - a.elo).slice(0, 3).map(t => `${t.name} ${t.elo}`).join(' · ');
  console.log(`${L.key}: ${r.n_matches} partidos | hfa ${r.hfa} | top: ${top}`);
}
fs.writeFileSync(path.join(OUT, 'ratings.json'), JSON.stringify(out));
console.log(`\n→ data/clubs/ratings.json (${Object.keys(out.leagues).length} ligas)`);
