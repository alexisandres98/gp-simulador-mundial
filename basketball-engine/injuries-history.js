// basketball-engine/injuries-history.js — BAJAS HISTÓRICO PARA EL BACKTEST (2-sep, backtests §5.5).
//
// EL HUECO QUE TAPA. El backtest de estrategia corre la capa de plantilla SIN ausencias porque no hay
// parte de bajas histórico: la corrida `stack` es idéntica a `base` y la capa RAPM que corre en producción
// nunca se evaluó. El parte de ESPN vive hoy en tres sitios y ninguno sirve tal cual para un backtest:
//   · `db.hoopsObs[liga:partido]` — el ÚLTIMO parte por partido (se sobrescribe; cache 30 min).
//   · data-fabric dominio `injuries` — eventos por jugador cuando CAMBIA el estado (appendIfChanged).
//   · `injuries_seen` dentro de los congelados de predicción (data-fabric/snapshots.js) — solo cuando se
//     congela una predicción, no por partido.
// Acá se vuelca UNA FILA POR EQUIPO Y DÍA con los jugadores fuera, en un JSONL en el disco persistente
// (misma raíz que `db.json`, como hace esports), que es el formato que el backtest puede leer directo.
//
// PURO salvo el archivo: no toca db ni red. Idempotente: la clave es día|liga|partido|equipo|hash(fuera).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'injuries-history.jsonl';
const dirOf = (root) => path.join(root, 'hoops');

// De `db.hoopsObs` (mapa liga:partido → { at, league, game_id, teams[{team_id, items[{id,name,status}]}] })
// a filas planas. `OUT` = fuera seguro; `doubtful` va aparte porque el backtest querrá distinguirlos.
const OUT_STATUS = new Set(['out', 'injured reserve', 'suspension', 'suspended']);
function rowsFromObs(obs, { date = null } = {}) {
  const rows = [];
  for (const o of Object.values(obs || {})) {
    if (!o || !o.at || !Array.isArray(o.teams)) continue;
    const day = date || new Date(o.at).toISOString().slice(0, 10);
    for (const t of o.teams) {
      const outs = (t.items || []).filter((i) => OUT_STATUS.has(String(i.status || '').toLowerCase()));
      const doubt = (t.items || []).filter((i) => String(i.status || '').toLowerCase() === 'doubtful');
      rows.push({ date: day, league: o.league, game_id: String(o.game_id), team: String(t.team_id),
        players_out: outs.map((i) => ({ id: String(i.id), name: i.name || null, detail: i.detail || null })).sort((a, b) => a.id.localeCompare(b.id)),
        players_doubtful: doubt.map((i) => ({ id: String(i.id), name: i.name || null })).sort((a, b) => a.id.localeCompare(b.id)),
        observed_at: new Date(o.at).toISOString() });
    }
  }
  return rows;
}
const keyOf = (r) => [r.date, r.league, r.game_id, r.team,
  crypto.createHash('sha1').update(JSON.stringify([r.players_out.map((p) => p.id), r.players_doubtful.map((p) => p.id)])).digest('hex').slice(0, 10)].join('|');

function readKeys(file) {
  const keys = new Set();
  try {
    for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (r && r.key) keys.add(r.key); } catch { /* línea rota: se ignora */ }
    }
  } catch { /* primera vez */ }
  return keys;
}

// Anexa las filas nuevas. Devuelve { appended, skipped, file }.
function record(root, rows) {
  const dir = dirOf(root); const file = path.join(dir, FILE);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ya existe */ }
  const have = readKeys(file);
  let appended = 0, skipped = 0, buf = '';
  for (const r of rows || []) {
    const key = keyOf(r);
    if (have.has(key)) { skipped++; continue; }
    have.add(key);
    buf += JSON.stringify({ key, ...r }) + '\n'; appended++;
  }
  if (buf) fs.appendFileSync(file, buf);
  return { appended, skipped, file };
}

function readAll(root) {
  const file = path.join(dirOf(root), FILE);
  try { return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

module.exports = { FILE, dirOf, rowsFromObs, keyOf, record, readAll };
