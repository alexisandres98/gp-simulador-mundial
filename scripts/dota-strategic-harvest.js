// scripts/dota-strategic-harvest.js — LA CAPA ESTRATÉGICA DE DOTA 2 (18-ago, blueprint 5.0).
//
// La base de matches (dota-harvest.js) da resultados; el blueprint pide el DRAFT y los JUGADORES.
// El Explorer de OpenDota (SQL público, D-0038: research accelerator) devuelve hasta 3.000 filas por
// consulta — se pagina por match_id ascendente y se corta en el último match COMPLETO de cada lote para
// no partir un draft por la mitad. Todo research_only (RIGHTS.md): rating interno, catálogo y sombra.
//
// TABLAS
//   drafts    picks_bans        → por partida: picks y bans por lado, en orden
//   players   player_matches    → por partida y jugador: héroe, K/D/A, GPM/XPM, lado
//   notables  notable_players   → account_id → nick y team_id (la identidad de los pro)
//   patches   match_patch       → match_id → parche (el corte del meta)
//   heroes    /api/constants    → hero_id → nombre (estático)
//
// USO
//   node scripts/dota-strategic-harvest.js                  # todas las tablas, reanudable
//   node scripts/dota-strategic-harvest.js --only=drafts
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_DOTA_DIR || path.join(__dirname, '..', 'data', 'esports', 'dota2');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const ONLY = arg('only', '');
const SLEEP = +arg('sleep', 1700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'GP-Simulador/1.0 (codigo@gpsimulador.com; cosecha lenta, contacto en el UA)';

let calls = 0;
async function explorer(sql) {
  const url = 'https://api.opendota.com/api/explorer?sql=' + encodeURIComponent(sql);
  let netTries = 0;
  for (let i = 0; i < 10; i++) {
    calls++;
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (r.status === 429) { console.log(`[dota] 429, espero 65s (${i + 1}/10)…`); await sleep(65000); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.err || j.error) throw new Error(String(j.err || j.error).slice(0, 120));
      return j.rows || [];
    } catch (e) { if (++netTries >= 6) throw e; await sleep(9000 * netTries); }
  }
  throw new Error('límite persistente en el Explorer');
}

const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => {
  fs.mkdirSync(DIR, { recursive: true });
  const p = path.join(DIR, f);
  fs.writeFileSync(p + '.tmp', JSON.stringify(o));
  fs.renameSync(p + '.tmp', p);
};

// paginación por match_id con corte en partido completo: si el lote vino lleno, el último match_id puede
// estar partido — sus filas se descartan y el cursor queda en él (se re-lee entero en el lote siguiente)
async function sweep({ file, table, fields, baseIds, minId, maxId, keyOf, groupOf }) {
  const st = rd(file) || { rights_class: 'research_only', source: `OpenDota Explorer (${table})`, rows: {}, cursor: null };
  st.rows = st.rows || {};
  let cursor = st.cursor != null ? st.cursor : minId - 1;
  while (cursor < maxId) {
    const sql = `select ${fields} from ${table} where match_id > ${cursor} order by match_id asc limit 3000`;
    const rows = await explorer(sql);
    if (!rows.length) break;
    const full = rows.length >= 3000;
    const lastId = +rows[rows.length - 1].match_id;
    const usable = full ? rows.filter((r) => +r.match_id < lastId) : rows;
    let added = 0;
    for (const r of usable) {
      const mid = +r.match_id;
      if (baseIds && !baseIds.has(mid)) continue;   // solo lo que la base de matches conoce
      const k = keyOf(r);
      if (!st.rows[k]) added++;
      st.rows[k] = groupOf(r);
    }
    cursor = full ? lastId - 1 : lastId;
    st.cursor = cursor; st.at = new Date().toISOString();
    wr(file, st);
    console.log(`[dota] ${table}: +${added} (total ${Object.keys(st.rows).length}) · cursor ${cursor} · ${calls} llamadas`);
    if (!full) break;
    await sleep(SLEEP);
  }
  console.log(`[dota] ${table} LISTO: ${Object.keys(st.rows).length} filas`);
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const M = rd('matches.json');
  if (!M || !M.matches || !Object.keys(M.matches).length) { console.error('[dota] no hay matches.json — corre dota-harvest primero'); process.exit(1); }
  const ids = Object.keys(M.matches).map(Number);
  const baseIds = new Set(ids);
  const minId = Math.min(...ids), maxId = Math.max(...ids);
  console.log(`[dota] base: ${ids.length} partidas · ids ${minId} → ${maxId}`);

  if (!ONLY || ONLY === 'heroes') {
    const r = await fetch('https://api.opendota.com/api/heroes', { headers: { 'user-agent': UA } });
    const hs = await r.json();
    wr('heroes.json', { at: new Date().toISOString(), rows: Object.fromEntries(hs.map((h) => [h.id, { name: h.localized_name, attr: h.primary_attr, roles: h.roles }])) });
    console.log(`[dota] heroes: ${hs.length}`);
    await sleep(SLEEP);
  }
  if (!ONLY || ONLY === 'notables') {
    // ~3k filas en total: se pagina por account_id
    const st = { rights_class: 'research_only', source: 'OpenDota Explorer (notable_players)', rows: {} };
    let cur = -1;
    while (true) {
      const rows = await explorer(`select account_id, name, team_id from notable_players where account_id > ${cur} order by account_id asc limit 3000`);
      if (!rows.length) break;
      for (const r of rows) st.rows[r.account_id] = { nick: r.name, team_id: r.team_id || null };
      cur = +rows[rows.length - 1].account_id;
      if (rows.length < 3000) break;
      await sleep(SLEEP);
    }
    st.at = new Date().toISOString(); wr('notables.json', st);
    console.log(`[dota] notables: ${Object.keys(st.rows).length}`);
  }
  if (!ONLY || ONLY === 'patches') {
    await sweep({ file: 'patches.json', table: 'match_patch', fields: 'match_id, patch', baseIds, minId, maxId,
      keyOf: (r) => r.match_id, groupOf: (r) => r.patch });
    // el nombre del parche: /api/constants/patch (id → name tipo "7.39")
    try {
      const r = await fetch('https://api.opendota.com/api/constants/patch', { headers: { 'user-agent': UA } });
      const ps = await r.json();
      wr('patch-names.json', { at: new Date().toISOString(), rows: ps });
    } catch { }
  }
  if (!ONLY || ONLY === 'drafts') {
    await sweep({ file: 'drafts.json', table: 'picks_bans', fields: 'match_id, hero_id, is_pick, team, ord', baseIds, minId, maxId,
      keyOf: (r) => `${r.match_id}|${r.ord}`,
      groupOf: (r) => ({ m: +r.match_id, h: +r.hero_id, p: r.is_pick === true || r.is_pick === 't' ? 1 : 0, t: +r.team, o: +r.ord }) });
  }
  if (!ONLY || ONLY === 'players') {
    await sweep({ file: 'players-raw.json', table: 'player_matches', fields: 'match_id, account_id, hero_id, kills, deaths, assists, gold_per_min, xp_per_min, player_slot', baseIds, minId, maxId,
      keyOf: (r) => `${r.match_id}|${r.account_id}`,
      groupOf: (r) => ({ m: +r.match_id, acc: +r.account_id, h: +r.hero_id, k: +r.kills, d: +r.deaths, a: +r.assists,
        gpm: +r.gold_per_min, xpm: +r.xp_per_min, radiant: +r.player_slot < 128 ? 1 : 0 }) });
  }
  const st = rd('state.json') || {};
  st[ONLY || 'all'] = { complete: true, at: new Date().toISOString(), calls };
  wr('state.json', st);
  console.log(`[dota] COSECHA ESTRATÉGICA COMPLETA (${ONLY || 'todo'}) · ${calls} llamadas`);
}

main();
