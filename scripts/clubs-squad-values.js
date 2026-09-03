#!/usr/bin/env node
'use strict';
// scripts/clubs-squad-values.js — VALOR DE PLANTILLA por club para el prior de inicio de temporada (3-sep-2026).
//
// Peeters (IJF 2018): el valor de mercado de la plantilla predice mejor que el Elo. La plataforma ya expone el
// valor por jugador (TheStatsAPI, el mismo endpoint que clubRosterRows/`/api/clubs/squad` en server.js) pero
// SOLO valores ACTUALES. Este script: (1) mapea los nombres de football-data.co.uk (18 divisiones del backtest)
// a los equipos de data/clubs/ratings.json (ids tm_ de TSA) y escribe la cobertura; (2) con THESTATSAPI_KEY,
// baja el roster de cada equipo, suma `market_value` y escribe <out>/squad-values-<season>.json con la forma
// que consume `scripts/clubs-rating-backtest.js --squad`. Sin key solo escribe el mapa y dice qué falta.
//
// Uso: THESTATSAPI_KEY=… node scripts/clubs-squad-values.js [--out <dir>] [--season 2526] [--map-only]
// Cadencia: 1 llamada por equipo (≈ 420) con 1,3 s entre llamadas (límite compartido de TSA) ≈ 9 min.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = arg('--out', process.env.FD_DIR || path.join(process.env.SP || '/tmp', 'fd'));
const SEASON = arg('--season', '2526');
const MAP_ONLY = args.includes('--map-only');
const TSA_KEY = process.env.THESTATSAPI_KEY || '';
fs.mkdirSync(OUT, { recursive: true });

// división de football-data → liga de ratings.json
const FD_TO_LEAGUE = { E0: 'premier', E1: 'championship', E2: 'league1', E3: 'league2', D1: 'bundesliga', D2: 'bundesliga2', SP1: 'laliga', SP2: 'laliga2', I1: 'seriea', I2: 'serieb', F1: 'ligue1', F2: 'ligue2', N1: 'eredivisie', P1: 'portugal', B1: 'belgica', T1: 'turquia', G1: 'grecia', SC0: 'escocia' };

// alias football-data → nombre en ratings.json (lo que el normalizador no resuelve solo)
const ALIAS = {
  'Man City': 'Manchester City', 'Man United': 'Manchester United', "Nott'm Forest": 'Nottingham Forest', Wolves: 'Wolverhampton',
  'Sheffield Weds': 'Sheffield Wednesday', QPR: 'Queens Park Rangers', 'West Brom': 'West Bromwich Albion', Peterboro: 'Peterborough United',
  'Bristol Rvs': 'Bristol Rovers', 'Milton Keynes Dons': 'Milton Keynes Dons', 'Bayern Munich': 'FC Bayern München', 'Ein Frankfurt': 'Eintracht Frankfurt',
  'FC Koln': '1. FC Köln', "M'gladbach": "Borussia M'gladbach", Mainz: '1. FSV Mainz 05', Hamburg: 'Hamburger SV', 'St Pauli': 'FC St. Pauli',
  Bochum: 'VfL Bochum 1848', Dresden: 'SG Dynamo Dresden', 'Greuther Furth': 'SpVgg Greuther Fürth', Hertha: 'Hertha BSC', Karlsruhe: 'Karlsruher SC',
  Darmstadt: 'Darmstadt 98', 'Ath Bilbao': 'Athletic Club', 'Ath Madrid': 'Atlético Madrid', Betis: 'Real Betis', Celta: 'Celta Vigo', Espanol: 'Espanyol',
  Sociedad: 'Real Sociedad', Vallecano: 'Rayo Vallecano', Alaves: 'Deportivo Alavés', 'La Coruna': 'Deportivo La Coruña', Santander: 'Racing de Santander',
  'Sp Gijon': 'Sporting Gijón', 'Sociedad B': 'Real Sociedad B', Burgos: 'Burgos Club de Fútbol', Verona: 'Hellas Verona', 'Paris SG': 'Paris Saint-Germain',
  Marseille: 'Olympique de Marseille', Lyon: 'Olympique Lyonnais', Brest: 'Stade Brestois', Rennes: 'Stade Rennais', 'St Etienne': 'Saint-Étienne',
  Laval: 'Stade Lavallois', Reims: 'Stade de Reims', Boulogne: "US Boulogne Côte-d'Opale", Dunkerque: 'USL Dunkerque', Grenoble: 'Grenoble Foot 38',
  'For Sittard': 'Fortuna Sittard', Nijmegen: 'NEC Nijmegen', Zwolle: 'PEC Zwolle', 'Sp Lisbon': 'Sporting', 'Sp Braga': 'Sporting Braga',
  Guimaraes: 'Vitória SC', Estrela: 'CF Estrela Amadora', Nacional: 'CD Nacional', AVS: 'AVS - Futebol SAD', 'St. Gilloise': 'Royale Union Saint-Gilloise',
  'St Truiden': 'Sint-Truidense VV', Standard: 'Standard Liège', Waregem: 'SV Zulte Waregem', Antwerp: 'Royal Antwerp FC', Charleroi: 'RC Sporting Charleroi',
  Buyuksehyr: 'Başakşehir FK', Goztep: 'Göztepe', Karagumruk: 'Fatih Karagümrük', Rizespor: 'Çaykur Rizespor', AEK: 'AEK Athens', Aris: 'Aris Thessaloniki',
  'Asteras Tripolis': 'Asteras Aktor', Atromitos: 'Atromitos Athens', Levadeiakos: 'APO Levadiakos', Olympiakos: 'Olympiacos FC', 'Volos NFC': 'NPS Volos',
  Hearts: 'Heart of Midlothian', Dundee: 'Dundee FC', Leverkusen: 'Bayer 04 Leverkusen', Kasimpasa: 'Kasımpaşa',
};
// tokens sin información para emparejar (formas jurídicas, prefijos de ciudad)
const STOP = new Set(['fc', 'cf', 'sc', 'sv', 'ac', 'as', 'us', 'afc', 'cd', 'ad', 'ud', 'rc', 'kv', 'kvc', 'krc', 'kaa', 'rsc', 'fk', 'ss', 'club', 'de', 'la', 'the', 'city', 'town', 'united', 'utd', 'athletic', 'rovers', 'wanderers', 'county', 'albion', 'stanley', 'argyle', 'alexandra', 'real', 'sporting', 'sad', 'sk', 'vv', 'bsc', 'fsv', 'vfb', 'vfl', 'spvgg', 'tsg', 'sg', 'sc', 'sv', '1', '04', '05', '07', '96', '98', '1848', 'praia', 'foot', 'fk', 'nfc', 'aktor', 'mgs', 'nps', 'apo', 'ae', 'ps']);
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).join(' ').trim();
}

function loadFdTeams(div) {
  const teams = new Set();
  for (const f of fs.readdirSync(OUT)) {
    if (!f.endsWith(`-${div}.csv`) || !f.startsWith(SEASON)) continue;
    const lines = fs.readFileSync(path.join(OUT, f), 'utf8').split(/\r?\n/);
    const H = lines[0].replace(/^﻿/, '').split(','); const ih = H.indexOf('HomeTeam'), ia = H.indexOf('AwayTeam');
    for (const l of lines.slice(1)) { const c = l.split(','); if (c[ih]) teams.add(c[ih].trim()); if (c[ia]) teams.add(c[ia].trim()); }
  }
  return [...teams];
}

function buildMap() {
  const RT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clubs', 'ratings.json'), 'utf8'));
  const map = {}, report = [];
  for (const [div, lg] of Object.entries(FD_TO_LEAGUE)) {
    const L = RT.leagues[lg]; if (!L) { report.push(`${div}: liga ${lg} ausente en ratings.json`); continue; }
    // índice normalizado de la liga + de TODAS las ligas del país (ascendidos/descendidos viven en la vecina)
    const idx = {};
    const sameCountry = Object.entries(RT.leagues).filter(([, X]) => X.country && X.country === L.country);
    for (const [, X] of [[lg, L]].concat(sameCountry)) for (const [tid, t] of Object.entries(X.ratings || {})) { const n = norm(t.name); if (n && !idx[n]) idx[n] = { tid, name: t.name }; }
    const byExact = {}; for (const [, X] of [[lg, L]].concat(sameCountry)) for (const [tid, t] of Object.entries(X.ratings || {})) byExact[t.name] = { tid, name: t.name };
    map[div] = {}; const missing = [];
    for (const fd of loadFdTeams(div)) {
      let hit = ALIAS[fd] ? byExact[ALIAS[fd]] : null;
      if (!hit) hit = idx[norm(fd)];
      if (!hit) { const n = norm(fd); const cands = Object.keys(idx).filter((k) => k.includes(n) || n.includes(k)); if (cands.length === 1) hit = idx[cands[0]]; }
      if (hit) map[div][fd] = hit; else missing.push(fd);
    }
    report.push(`${div} → ${lg}: ${Object.keys(map[div]).length} emparejados, ${missing.length} sin par${missing.length ? ` (${missing.join(', ')})` : ''}`);
  }
  return { map, report };
}

async function fetchSquadValue(tid) {
  // MISMO endpoint que clubRosterRows (server.js): roster con market_value por jugador
  const r = await fetch(`https://api.thestatsapi.com/api/football/teams/${tid}/players?per_page=60`, { headers: { Authorization: `Bearer ${TSA_KEY}` }, signal: AbortSignal.timeout(15000) });
  if (r.status === 429 || r.status === 402) throw new Error(`TSA ${r.status} (límite)`);
  if (!r.ok) return { value: null, players: 0, with_value: 0, error: `http ${r.status}` };
  const j = await r.json().catch(() => null);
  const rows = (j && j.data) || j || [];
  let value = 0, n = 0;
  for (const p of rows) { const v = Number(p.market_value); if (Number.isFinite(v) && v > 0) { value += v; n++; } }
  return { value: n ? value : null, players: rows.length, with_value: n };
}

async function main() {
  const { map, report } = buildMap();
  console.log(report.join('\n'));
  fs.writeFileSync(path.join(OUT, 'squad-map.json'), JSON.stringify({ generated_at: new Date().toISOString(), season: SEASON, map, report }, null, 1));
  console.log(`→ ${path.join(OUT, 'squad-map.json')}`);
  if (MAP_ONLY) return;
  if (!TSA_KEY) {
    console.log('\nSIN THESTATSAPI_KEY: no se pueden bajar los valores de plantilla. Falta: la key de TheStatsAPI en el entorno');
    console.log('(la misma que usa el servidor para /api/clubs/squad). Con ella: THESTATSAPI_KEY=… node scripts/clubs-squad-values.js');
    return;
  }
  const values = {}, coverage = {};
  for (const [div, teams] of Object.entries(map)) {
    values[div] = {}; coverage[div] = { teams: Object.keys(teams).length, with_value: 0 };
    for (const [fd, t] of Object.entries(teams)) {
      try {
        const v = await fetchSquadValue(t.tid);
        if (v.value) { values[div][fd] = v.value; coverage[div].with_value++; }
        console.log(`  ${div} ${fd} → ${t.name} (${t.tid}): ${v.value ? (v.value / 1e6).toFixed(1) + ' M' : 'sin valor'} (${v.with_value}/${v.players} jugadores)`);
      } catch (e) { console.log(`  ${div} ${fd}: ${e.message} — se para para no quemar la cuota`); fs.writeFileSync(path.join(OUT, `squad-values-${SEASON}.partial.json`), JSON.stringify({ values, coverage }, null, 1)); return; }
      await new Promise((r) => setTimeout(r, 1300));
    }
  }
  const out = path.join(OUT, `squad-values-${SEASON}.json`);
  fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), season: SEASON, source: 'thestatsapi market_value (valores ACTUALES)', values, coverage }, null, 1));
  console.log(`→ ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
