// scripts/tennis-aggregate.js — de los CSV crudos de Sackmann a LA BASE COMPACTA DE TENIS (blueprint 6.0 F1)
//
// Entrada:  GP_TEN_DIR (o data/tennis/raw) con atp/wta_matches_2015..2026.csv + atp/wta_players.csv
// Salida:   data/tennis/matches.json  — filas compactas (array de arrays + schema) ATP+WTA
//           data/tennis/players.json  — solo los jugadores que aparecen en la base
//           data/tennis/meta.json     — lineage, conteos y frescura (last_match_date por tour)
//
// La base cruda NO se versiona (RIGHTS.md): al repo entra esta derivada con atribución CC BY-NC-SA.
// Partidos: cuadro principal y qualy de ATP/WTA (niveles G,M,A,B,F,D,O). W/O y DEF se excluyen
// (no se jugó); RET se conserva con marca ret=1 (cuenta para Elo, no para stats de saque completas).
'use strict';

const fs = require('fs');
const path = require('path');

const RAW = process.env.GP_TEN_DIR || path.join(__dirname, '..', 'data', 'tennis', 'raw');
const OUT = path.join(__dirname, '..', 'data', 'tennis');

// CSV con comillas ocasionales en nombres de torneo
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
      else if (c === '"') inQ = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const SURF = { Hard: 0, Clay: 1, Grass: 2, Carpet: 3 };
const ROUND = { Q1: 0, Q2: 1, Q3: 2, Q4: 3, R128: 4, R64: 5, R32: 6, R16: 7, QF: 8, SF: 9, F: 10, RR: 5, BR: 9, ER: 4 };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : -1; };

// "6-4 3-6 7-6(5)" → { sets:[[6,4],[3,6],[7,6]], gW, gL, ret }
function parseScore(s) {
  s = String(s || '').trim();
  if (!s || /W\/O|walkover|DEF|Def\./i.test(s)) return null;
  const ret = /RET|ret\./i.test(s) ? 1 : 0;
  const sets = [];
  for (const tk of s.split(/\s+/)) {
    const m = tk.match(/^(\d+)-(\d+)(?:\(\d+\))?$/);
    if (m) sets.push([+m[1], +m[2]]);
  }
  if (!sets.length && !ret) return null;
  let gW = 0, gL = 0;
  for (const [a, b] of sets) { gW += a; gL += b; }
  return { sets, gW, gL, ret };
}

const SCHEMA = ['tour', 'date', 'tid', 'surface', 'level', 'best_of', 'round', 'wid', 'lid', 'sets_w', 'sets_l', 'games_w', 'games_l', 'ret', 'minutes', 'w_rank', 'l_rank',
  'w_ace', 'w_df', 'w_svpt', 'w_1stIn', 'w_1stWon', 'w_2ndWon', 'w_SvGms', 'w_bpSaved', 'w_bpFaced',
  'l_ace', 'l_df', 'l_svpt', 'l_1stIn', 'l_1stWon', 'l_2ndWon', 'l_SvGms', 'l_bpSaved', 'l_bpFaced', 'score'];

const tourneys = []; const tIdx = new Map();
const players = {}; const seen = new Set();
const rows = [];
let lastDate = { atp: 0, wta: 0 };

for (const tour of ['atp', 'wta']) {
  const tn = tour === 'atp' ? 0 : 1;
  for (let y = 2015; y <= 2026; y++) {
    const f = path.join(RAW, `${tour}_matches_${y}.csv`);
    if (!fs.existsSync(f)) continue;
    const csv = parseCsv(fs.readFileSync(f, 'utf8'));
    const H = csv[0]; const col = {}; H.forEach((h, i) => { col[h] = i; });
    for (let r = 1; r < csv.length; r++) {
      const c = csv[r]; if (c.length < H.length - 2) continue;
      const g = (k) => c[col[k]];
      const lvl = String(g('tourney_level') || '');
      // niveles reales por tour: ATP usa G/M/A/F/D/O; WTA usa G/PM/P/I/F/D/O/W (comprobado en la base)
      if (!/^(G|M|A|B|F|D|O|PM|P|I|W)$/.test(lvl)) continue; // fuera exhibiciones/desconocidos
      const sc = parseScore(g('score'));
      if (!sc) continue;                                  // W/O y DEF no se jugaron
      const surface = SURF[g('surface')] != null ? SURF[g('surface')] : -1;
      const name = String(g('tourney_name') || '').trim();
      const tkey = tn + '|' + name;
      let ti = tIdx.get(tkey);
      if (ti == null) { ti = tourneys.length; tourneys.push({ name, tour: tn }); tIdx.set(tkey, ti); }
      const date = int(g('tourney_date'));
      const wid = int(g('winner_id')), lid = int(g('loser_id'));
      if (wid < 0 || lid < 0) continue;
      let sw = 0, sl = 0;
      for (const [a, b] of sc.sets) { if (a > b) sw++; else if (b > a) sl++; }
      rows.push([tn, date, ti, surface, lvl, int(g('best_of')), ROUND[g('round')] != null ? ROUND[g('round')] : 6,
        wid, lid, sw, sl, sc.gW, sc.gL, sc.ret, int(g('minutes')), int(g('winner_rank')), int(g('loser_rank')),
        int(g('w_ace')), int(g('w_df')), int(g('w_svpt')), int(g('w_1stIn')), int(g('w_1stWon')), int(g('w_2ndWon')), int(g('w_SvGms')), int(g('w_bpSaved')), int(g('w_bpFaced')),
        int(g('l_ace')), int(g('l_df')), int(g('l_svpt')), int(g('l_1stIn')), int(g('l_1stWon')), int(g('l_2ndWon')), int(g('l_SvGms')), int(g('l_bpSaved')), int(g('l_bpFaced')),
        String(g('score') || '').trim()]);
      seen.add(tn + ':' + wid); seen.add(tn + ':' + lid);
      if (date > lastDate[tour]) lastDate[tour] = date;
      // nombre/mano por si el catálogo no trae al jugador
      for (const [pid, nm, hd] of [[wid, g('winner_name'), g('winner_hand')], [lid, g('loser_name'), g('loser_hand')]]) {
        const k = tn + ':' + pid;
        if (!players[k]) players[k] = { name: String(nm || '').trim(), hand: String(hd || 'U'), dob: null, country: null, ht: null };
      }
    }
    console.log(`[agg] ${tour} ${y}: acumulado ${rows.length} partidos`);
  }
  // catálogo oficial: completa dob/país/altura
  const pf = path.join(RAW, `${tour}_players.csv`);
  if (fs.existsSync(pf)) {
    const csv = parseCsv(fs.readFileSync(pf, 'utf8'));
    const H = csv[0]; const col = {}; H.forEach((h, i) => { col[h] = i; });
    for (let r = 1; r < csv.length; r++) {
      const c = csv[r]; const pid = int(c[col.player_id]);
      const k = tn + ':' + pid;
      if (!players[k]) continue;                          // solo los que aparecen en la base
      const p = players[k];
      const fn = String(c[col.name_first] || '').trim(), ln = String(c[col.name_last] || '').trim();
      if (fn || ln) p.name = (fn + ' ' + ln).trim();
      p.hand = String(c[col.hand] || p.hand || 'U');
      p.dob = int(c[col.dob]) > 0 ? int(c[col.dob]) : null;
      p.country = String(c[col.ioc] || '') || null;
      p.ht = int(c[col.height]) > 0 ? int(c[col.height]) : null;
    }
  }
}

// orden cronológico estable: fecha de torneo, torneo, ronda (qualy antes que cuadro), y orden de archivo
rows.sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]) || (a[6] - b[6]));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'matches.json'), JSON.stringify({ schema: SCHEMA, tourneys, rows }));
fs.writeFileSync(path.join(OUT, 'players.json'), JSON.stringify(players));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  source: 'Jeff Sackmann tennis_atp/tennis_wta (CC BY-NC-SA 4.0) — research/attribution, no comercial',
  built_at: new Date().toISOString(), rows: rows.length, players: Object.keys(players).length,
  tourneys: tourneys.length, last_match_date: lastDate, years: '2015-2026',
}, null, 1));
console.log(`[agg] LISTO: ${rows.length} partidos · ${Object.keys(players).length} jugadores · frescura atp=${lastDate.atp} wta=${lastDate.wta}`);
