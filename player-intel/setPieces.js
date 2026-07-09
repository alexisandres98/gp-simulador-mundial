// player-intel/setPieces.js — Roles de balón parado CURADOS (data/set-piece-roles.json).
// Fuente: investigación sobre lo ejecutado REALMENTE en el Mundial 2026 (conteos de córners del torneo,
// crónicas de cada partido) para las selecciones vivas. Se consulta por (equipo, nombre) con matching
// tolerante a acentos/orden. Alcance actual: 8 equipos de cuartos; post-Mundial esto se reemplaza por
// una fuente de datos por liga sin cambiar la interfaz.
'use strict';
const fs = require('fs');
const path = require('path');

let _table = null;
function table() {
  if (_table) return _table;
  try { _table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'set-piece-roles.json'), 'utf8')); }
  catch { _table = {}; }
  return _table;
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Matching tolerante: nombres del dataset ("Kylian Mbappé", "K. Mbappé", "Mbappé") vs curados.
// Regla: coinciden si comparten el apellido (última palabra) y, si ambos tienen más tokens, alguna
// inicial/palabra extra también coincide. Evita colisiones tipo Theo/Lucas Hernández.
function nameMatches(a, b) {
  const ta = norm(a).split(' ').filter(Boolean), tb = norm(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  if (ta.length === 1 || tb.length === 1) return true;
  const fa = ta[0], fb = tb[0];
  return fa === fb || fa[0] === fb[0];
}

// Devuelve los roles de balón parado de un jugador: { corners, freekicks, penalties } con
// { rank (1 = titular del rol), confidence } o null por rol. Null total si el equipo no está curado.
function rolesFor(teamId, playerName) {
  const team = table()[String(teamId || '').toUpperCase()];
  if (!team || !playerName) return null;
  const out = {};
  let any = false;
  for (const role of ['corners', 'freekicks', 'penalties']) {
    const list = team[role] || [];
    const idx = list.findIndex(x => nameMatches(x.name, playerName));
    if (idx >= 0) { out[role] = { rank: idx + 1, confidence: list[idx].confidence || 'media' }; any = true; }
    else out[role] = null;
  }
  return any ? out : null;
}

// Códigos de razón para player-intel (solo roles con peso real: titular del rol o nº2 con confianza alta).
function reasonsFor(teamId, playerName) {
  const r = rolesFor(teamId, playerName);
  if (!r) return [];
  const strong = x => x && (x.rank === 1 || (x.rank === 2 && x.confidence === 'alta'));
  const out = [];
  if (strong(r.penalties)) out.push('SET_PIECE_PEN');
  if (strong(r.freekicks)) out.push('SET_PIECE_FK');
  if (strong(r.corners)) out.push('SET_PIECE_CORNERS');
  return out;
}

module.exports = { rolesFor, reasonsFor, nameMatches, _norm: norm };
