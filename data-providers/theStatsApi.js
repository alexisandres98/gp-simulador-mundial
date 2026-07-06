// theStatsApi.js — Provider server-side de TheStatsAPI (xG observado, stats y shotmap por partido).
// USO ACOTADO: el plan es 12 req/min → este provider SOLO se usa para partidos TERMINADOS y el resultado
// se cachea PERMANENTE en db.json (1 fetch por partido en toda la vida del server; el índice de partidos se
// refresca cada 6h como mucho). La key vive en env THESTATSAPI_KEY; sin key todo devuelve null sin romper.
'use strict';
const { TEAMS } = require('../data/tournament');

const BASE = 'https://api.thestatsapi.com/api/football';
const COMP = 'comp_6107'; // FIFA World Cup

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const ALIAS_TO_ID = {};
TEAMS.forEach(t => { [t.en, t.name, t.id, ...(t.aliases || [])].filter(Boolean).forEach(a => { ALIAS_TO_ID[norm(a)] = t.id; }); });
ALIAS_TO_ID[norm('Cape Verde Islands')] = 'CPV';

function key() { return process.env.THESTATSAPI_KEY || ''; }
function configured() { return !!key(); }

async function call(path, params) {
  if (!configured()) return null;
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const r = await fetch(`${BASE}/${path}${qs}`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`thestatsapi ${path} HTTP ${r.status}`);
  const j = await r.json();
  return j && j.data != null ? j.data : null;
}

// Índice de partidos TERMINADOS del Mundial por par de equipos (nuestros códigos). Cache 6h en memoria.
let _idx = { at: 0, byPair: {} };
async function ensureIndex() {
  if (Date.now() - _idx.at < 6 * 3600 * 1000 && Object.keys(_idx.byPair).length) return _idx;
  const data = await call('matches', { competition_id: COMP, status: 'finished', date_from: '2026-06-01', date_to: '2026-08-01', per_page: 100 });
  if (!data) return _idx;
  const byPair = {};
  for (const m of data) {
    const h = ALIAS_TO_ID[norm(m.home_team.name)], a = ALIAS_TO_ID[norm(m.away_team.name)];
    if (h && a) byPair[h + '~' + a] = { id: m.id, date: m.utc_date };
  }
  _idx = { at: Date.now(), byPair };
  return _idx;
}

// Reporte de xG del partido (post-partido): xG total/por mitades + big chances + remates. null si no está.
async function xgReport(homeCode, awayCode) {
  const idx = await ensureIndex();
  const hit = idx.byPair[homeCode + '~' + awayCode];
  if (!hit) return null;
  const st = await call(`matches/${hit.id}/stats`);
  const ov = st && st.overview;
  if (!ov || !ov.expected_goals) return null;
  const pick = (obj, half) => (obj && obj[half]) ? { home: obj[half].home, away: obj[half].away } : null;
  return {
    match_id: hit.id, date: hit.date,
    xg: pick(ov.expected_goals, 'all'),
    xg_h1: pick(ov.expected_goals, 'first_half'),
    xg_h2: pick(ov.expected_goals, 'second_half'),
    big_chances: pick(ov.big_chances, 'all'),
    shots: pick(ov.total_shots || ov.shots, 'all'),
  };
}

// Shotmap del partido (para contenido): remates con x/y, xG, resultado. null si no está.
async function shotmap(homeCode, awayCode) {
  const idx = await ensureIndex();
  const hit = idx.byPair[homeCode + '~' + awayCode];
  if (!hit) return null;
  const shots = await call(`matches/${hit.id}/shotmap`);
  return shots ? { match_id: hit.id, date: hit.date, shots } : null;
}

module.exports = { configured, xgReport, shotmap };
