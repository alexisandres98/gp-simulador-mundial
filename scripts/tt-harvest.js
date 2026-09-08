#!/usr/bin/env node
// scripts/tt-harvest.js — LA COSECHA DEL TENIS DE MESA: crudo de la WTT/ITTF → base compacta propia
//
//   node scripts/tt-harvest.js --rank --events --photos            # listas: ranking MS/WS, eventos, retratos
//   node scripts/tt-harvest.js --history=400 [--refresh=10]        # historial por jugador (ITTF), N por pasada,
//                                                                  #   y re-descarga de activos con crudo > 10 días
//   node scripts/tt-harvest.js --cards=300                         # ficha (mano, empuñadura, estilo) del top N
//   node scripts/tt-harvest.js --build [--gz]                      # compacto: matches, players, formats, meta
//   --raw=<dir>  crudo (por defecto GP_TT_RAW o <dir de db.json>/tt-raw)   --out=<dir>  compacto (disco o repo)
//
// El crudo NUNCA se versiona (queda en el disco persistente de Render o en el scratchpad); el compacto sí.
// Cada fila del compacto conserva el id del torneo y de los dos jugadores (trazabilidad, RIGHTS.md).
// En el sandbox: GP_FETCH_VIA_CURL=1 (el fetch de Node no atraviesa el proxy; curl sí).
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const W = require('../data-providers/tt/wtt');
const R = require('../tt-engine/rules');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const DB_DIR = path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json'));
const RAW = path.resolve(args.raw || process.env.GP_TT_RAW || path.join(DB_DIR, 'tt-raw'));
const REPO_OUT = path.join(__dirname, '..', 'data', 'tt');
const DISK_OUT = path.join(DB_DIR, 'tt');
const OUT = path.resolve(args.out || (fs.existsSync(DB_DIR) && process.env.DB_FILE ? DISK_OUT : REPO_OUT));
const CONC = Math.max(1, Math.min(12, +(process.env.GP_TT_CONC || args.conc || 4)));
const log = (...x) => console.log(new Date().toISOString().slice(11, 19), ...x);
const rj = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const wj = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(o)); fs.renameSync(tmp, p); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(RAW, 'players'), { recursive: true });

// ── LISTAS ──────────────────────────────────────────────────────────────────────────────────────────────
async function doRank() {
  for (const sub of ['MS', 'WS']) {
    const rows = await W.rankings(sub);
    if (rows.length) { wj(path.join(RAW, `rank_${sub}.json`), { at: new Date().toISOString(), rows }); log('ranking', sub, rows.length); }
    else log('ranking', sub, 'VACÍO (se conserva el anterior)');
  }
}
async function doEvents() {
  const ev = await W.events({ force: true });
  if (ev.length) { wj(path.join(RAW, 'events.json'), { at: new Date().toISOString(), rows: ev }); log('eventos', ev.length); } else log('eventos VACÍO');
}
async function doPhotos() {
  const m = await W.photos({ force: true });
  if (m.size) { wj(path.join(RAW, 'photos.json'), { at: new Date().toISOString(), map: Object.fromEntries(m) }); log('retratos', m.size); } else log('retratos VACÍO');
}
function rankedIds() {
  let ms = ((rj(path.join(RAW, 'rank_MS.json')) || {}).rows || []).map((r) => r.id);
  let ws = ((rj(path.join(RAW, 'rank_WS.json')) || {}).rows || []).map((r) => r.id);
  // sin ranking en crudo (la puerta ITTF puede fallar desde el servidor): la lista de ids sale del catálogo del
  // repo, que ya trae el ranking de la última cosecha buena — así el historial se baja igual
  if (!ms.length && !ws.length) {
    const pl = rj(path.join(REPO_OUT, 'players.json')) || rj(path.join(OUT, 'players.json')) || {};
    const ranked = Object.entries(pl).filter(([, p]) => p.rank).sort((a, b) => a[1].rank - b[1].rank);
    ms = ranked.filter(([, p]) => p.gender !== 'W').map(([id]) => id); ws = ranked.filter(([, p]) => p.gender === 'W').map(([id]) => id);
    if (ms.length || ws.length) log('ranking desde el catálogo del repo:', ms.length, 'MS ·', ws.length, 'WS');
  }
  const out = [], seen = new Set();
  for (let i = 0; i < Math.max(ms.length, ws.length); i++) for (const id of [ms[i], ws[i]]) if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}
// ── HISTORIAL POR JUGADOR ────────────────────────────────────────────────────────────────────────────────
async function doHistory(maxN, refreshDays) {
  const ids = rankedIds();
  if (!ids.length) { log('sin ranking en crudo: corre --rank primero'); return; }
  const now = Date.now();
  const todo = [];
  for (const id of ids) {
    const f = path.join(RAW, 'players', id + '.json');
    let st = null; try { st = fs.statSync(f); } catch { /* no existe */ }
    if (!st) todo.push(id);
    else if (refreshDays > 0 && now - st.mtimeMs > refreshDays * 864e5) todo.push(id);
    if (todo.length >= maxN) break;
  }
  log('historial: por bajar', todo.length, 'de', ids.length, 'concurrencia', CONC);
  let i = 0, ok = 0, fail = 0;
  const worker = async () => {
    while (i < todo.length) {
      const id = todo[i++];
      const rows = await W.history(id);
      if (Array.isArray(rows)) { wj(path.join(RAW, 'players', id + '.json'), rows); ok++; } else fail++;
      if ((ok + fail) % 50 === 0) log('historial', ok + fail, '/', todo.length, 'ok', ok, 'fail', fail);
      await sleep(150);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  log('historial fin ok', ok, 'fail', fail);
}
async function doCards(topN) {
  const ids = rankedIds().slice(0, topN);
  const cards = rj(path.join(RAW, 'cards.json')) || {};
  let n = 0;
  for (const id of ids) {
    if (cards[id] && cards[id].at && Date.now() - Date.parse(cards[id].at) < 60 * 864e5) continue;
    const c = await W.playerCard(id);
    cards[id] = { ...(c || { none: true }), at: new Date().toISOString() }; n++;
    if (n % 25 === 0) { wj(path.join(RAW, 'cards.json'), cards); log('fichas', n); }
    await sleep(120);
  }
  wj(path.join(RAW, 'cards.json'), cards); log('fichas fin', n);
}

// ── EL COMPACTO ─────────────────────────────────────────────────────────────────────────────────────────
const SCHEMA = ['date', 'dated', 'tid', 'sub', 'round', 'wid', 'lid', 'wg', 'lg', 'games', 'bo', 'ret'];
function subOfDesc(desc) {
  const x = String(desc || '').toLowerCase();
  if (/doubles|team|mixed/.test(x)) return 'X';
  if (/women|girls|\bws\b/.test(x)) return 'WS';
  if (/men|boys|\bms\b/.test(x)) return 'MS';
  return null;
}
function build({ gz = false } = {}) {
  const events = new Map(); for (const e of ((rj(path.join(RAW, 'events.json')) || {}).rows || [])) events.set(String(e.id), e);
  const photos = (rj(path.join(RAW, 'photos.json')) || {}).map || {};
  const cards = rj(path.join(RAW, 'cards.json')) || {};
  const rank = new Map();
  for (const sub of ['MS', 'WS']) for (const r of ((rj(path.join(RAW, `rank_${sub}.json`)) || {}).rows || [])) rank.set(String(r.id), r);
  const dir = path.join(RAW, 'players');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const players = {}, tourneys = {}, rows = [], seen = new Set(), formats = {};
  const gender = new Map(); // id → 'M'|'W' (del ranking o de las filas con sub explícito)
  for (const [id, r] of rank) gender.set(id, r.gender);
  const touch = (id, name, sub) => {
    if (!id) return;
    let p = players[id];
    if (!p) { const nm = W.parseName(name); p = players[id] = { name: nm.name, family: nm.family, given: nm.given, n: 0, first: null, last: null }; }
    if (sub === 'MS' || sub === 'WS') { const g = sub === 'MS' ? 'M' : 'W'; if (!gender.has(id)) gender.set(id, g); }
  };
  // primera pasada (solo género, sin retener filas: la base entera no cabe en la memoria del Starter de Render):
  // el género de cada jugador sale del ranking o de las filas con subevento explícito, y sirve para las filas
  // viejas ("Main Draw") que no lo traen
  for (const f of files) {
    const arr = rj(path.join(dir, f)); if (!Array.isArray(arr)) continue;
    for (const r of arr) { const s = subOfDesc(r.Desc); if (s === 'MS' || s === 'WS') { const g = s === 'MS' ? 'M' : 'W'; if (!gender.has(String(r.PlayerID))) gender.set(String(r.PlayerID), g); if (!gender.has(String(r.Oppn_PlayerId))) gender.set(String(r.Oppn_PlayerId), g); } }
  }
  let skipped = { test: 0, doubles: 0, nowin: 0, nogames: 0, dup: 0 };
  // segunda pasada: archivo a archivo, fila a fila
  const each = function* () { for (const f of files) { const arr = rj(path.join(dir, f)); if (!Array.isArray(arr)) continue; for (const r of arr) yield r; } };
  for (const r of each()) {
    const evName = String(r.Desc_L1 || '').trim();
    // eventos de prueba/simulación del sistema de la WTT ("TEST - …", "SIM - …", "PRODUCTION TEST - …"): fuera
    if (/^test\b|\btest\s*-|production test|^sim\b|\bsim\s*-|simulation/i.test(evName)) { skipped.test++; continue; }
    let sub = subOfDesc(r.Desc);
    if (sub === 'X') { skipped.doubles++; continue; }
    const pid = String(r.PlayerID || ''), oid = String(r.Oppn_PlayerId || '');
    if (!pid || !oid || pid === oid) { skipped.nowin++; continue; }
    if (!sub) { const g = gender.get(pid) || gender.get(oid); sub = g === 'W' ? 'WS' : g === 'M' ? 'MS' : null; }
    // OJO (8-sep): `OverallScore` viene REPETIDO en miles de filas (4–4, 3–3…): el ganador se deduce de los
    // PUNTOS de cada game, que sí son fiables; el marcador oficial solo se usa cuando no hay games.
    const sp = String(r.SplitResult || '').split(','), op = String(r.Oppn_SplitResult || '').split(',');
    const games = [];
    for (let i = 0; i < Math.max(sp.length, op.length); i++) {
      const a = sp[i] === '' || sp[i] == null ? NaN : +sp[i], b = op[i] === '' || op[i] == null ? NaN : +op[i];
      if (!Number.isFinite(a) && !Number.isFinite(b)) continue;
      const A = Number.isFinite(a) ? a : 0, B = Number.isFinite(b) ? b : 0;
      if (A + B === 0) continue;
      games.push([A, B]);
    }
    let gp = games.filter(([a, b]) => a > b).length, go = games.filter(([a, b]) => b > a).length;
    if (!games.length) {
      const os = r.OverallScore === '' || r.OverallScore == null ? NaN : +r.OverallScore, oo = r.Oppn_OverallScore === '' || r.Oppn_OverallScore == null ? NaN : +r.Oppn_OverallScore;
      if (!Number.isFinite(os) || !Number.isFinite(oo) || os === oo) { skipped.nowin++; continue; }
      gp = os; go = oo;
    }
    if (gp === go) { skipped.nowin++; continue; }
    const pWon = gp > go;
    const wid = pWon ? pid : oid, lid = pWon ? oid : pid;
    const wg = Math.max(gp, go), lg = Math.min(gp, go);
    const gs = games.map(([a, b]) => (pWon ? [a, b] : [b, a]));
    if (!gs.length) { skipped.nogames++; }
    const key = `${r.TourId}|${[pid, oid].sort().join('-')}|${pid < oid ? games.map((g) => g.join('-')).join(',') : games.map((g) => g[1] + '-' + g[0]).join(',')}`;
    if (seen.has(key)) { skipped.dup++; continue; }
    seen.add(key);
    const bo = R.bestOfFromScore(wg, lg);
    // retirada/incompleto: el ganador no cierra los games que dice el marcador, o algún game no es legal
    // (el ganador cierra siempre sus games por construcción; queda marcar games ilegales o partidos cortos)
    const legal = gs.every(([a, b]) => R.legalGameScore(a, b) || (a === 11 && b === 0) || (b === 11 && a === 0));
    const ret = gs.length && (!legal || wg < 3) ? 1 : 0;
    const tid = String(r.TourId || '');
    const ev = events.get(tid);
    const year = +r.Year || (ev ? +String(ev.start).slice(0, 4) : 0);
    const date = ev && ev.start ? +String(ev.start).replace(/-/g, '') : year ? year * 10000 + 701 : 0;
    const dated = ev && ev.start ? 1 : 0;
    if (!tourneys[tid]) tourneys[tid] = { name: (ev && ev.name) || evName, tier: R.tierOf((ev && ev.name) || evName), start: ev ? ev.start : null, end: ev ? ev.end : null, country: ev ? ev.country : null, city: ev ? ev.city : null, year, youth: ev ? !!ev.youth : /youth|junior|cadet/i.test(evName), n: 0 };
    tourneys[tid].n++;
    const round = R.normalizeRound(r.Desc);
    rows.push([date, dated, tid, sub, round, wid, lid, wg, lg, gs.map((g) => g.join('-')).join(','), bo, ret]);
    touch(wid, pWon ? r.PlayerName : r.Oppn_PlayerName, sub); touch(lid, pWon ? r.Oppn_PlayerName : r.PlayerName, sub);
    for (const id of [wid, lid]) { const p = players[id]; p.n++; if (date) { p.first = p.first ? Math.min(p.first, date) : date; p.last = Math.max(p.last || 0, date); } }
    if (bo && !ret && tourneys[tid].tier !== 'other') { const fk = tourneys[tid].tier + '|' + (round || 'OTR'); formats[fk] = formats[fk] || {}; formats[fk][bo] = (formats[fk][bo] || 0) + 1; }
  }
  rows.sort((a, b) => a[0] - b[0] || String(a[2]).localeCompare(String(b[2])));
  // CANDADO (8-sep, lección de prod): un compacto vacío o mucho más pequeño que el vigente NO se escribe jamás —
  // el compacto del disco pisa al del repo y una cosecha fallida dejaría la base en cero. Se aborta con error.
  const vigente = (() => { for (const base of [OUT, REPO_OUT]) { try { const mp = path.join(base, 'meta.json'); if (fs.existsSync(mp)) return JSON.parse(fs.readFileSync(mp, 'utf8')).rows || 0; } catch { /* sin meta */ } } return 0; })();
  if (rows.length < 1000 || rows.length < 0.7 * vigente) { const msg = `compacto RECHAZADO: ${rows.length} filas frente a ${vigente} vigentes (crudo: ${files.length} archivos)`; log(msg); throw new Error(msg); }
  // catálogo: ranking, país, género, retrato, ficha
  for (const [id, p] of Object.entries(players)) {
    const rk = rank.get(id);
    if (rk) { p.name = rk.name || p.name; p.family = rk.family || p.family; p.given = rk.given || p.given; p.country = rk.country; p.rank = rk.rank; p.rank_prev = rk.prev_rank; p.rank_pts = rk.points; p.sub = rk.sub; }
    p.gender = gender.get(id) || null;
    if (photos[id]) p.photo = photos[id];
    const c = cards[id]; if (c && !c.none) { if (c.hand) p.hand = c.hand; if (c.grip) p.grip = c.grip; if (c.style) p.style = c.style; if (c.dob) p.dob = String(c.dob).slice(0, 10); }
  }
  // jugadores del ranking sin historial todavía también entran al catálogo (para casar casas y agenda)
  for (const [id, rk] of rank) if (!players[id]) players[id] = { name: rk.name, family: rk.family, given: rk.given, country: rk.country, gender: rk.gender, rank: rk.rank, rank_prev: rk.prev_rank, rank_pts: rk.points, sub: rk.sub, photo: photos[id] || undefined, n: 0, first: null, last: null };
  const dated = rows.filter((r) => r[1]);
  const meta = { built_at: new Date().toISOString(), rows: rows.length, dated: dated.length, players: Object.keys(players).length, tourneys: Object.keys(tourneys).length, raw_files: files.length, ranked: rank.size, photos: Object.keys(photos).length,
    years: rows.length ? [Math.floor(rows[0][0] / 10000), Math.floor(rows[rows.length - 1][0] / 10000)] : null, last_match_date: dated.length ? dated[dated.length - 1][0] : null, skipped,
    sources: ['WTT (worldtabletennis.com): eventos, agenda, match cards, retratos', 'ITTF/WTT gateway: ranking semanal e historial de partidos por jugador con puntos por game'] };
  fs.mkdirSync(OUT, { recursive: true });
  const m = { schema: SCHEMA, tourneys, rows, built_at: meta.built_at };
  if (gz) { fs.writeFileSync(path.join(OUT, 'matches.json.gz'), zlib.gzipSync(JSON.stringify(m))); try { fs.unlinkSync(path.join(OUT, 'matches.json')); } catch { /* no había */ } }
  else wj(path.join(OUT, 'matches.json'), m);
  wj(path.join(OUT, 'players.json'), players);
  wj(path.join(OUT, 'formats.json'), { built_at: meta.built_at, by: formats });
  wj(path.join(OUT, 'meta.json'), meta);
  log('compacto →', OUT, JSON.stringify(meta));
  return meta;
}

(async () => {
  log('crudo', RAW, '· compacto', OUT);
  if (args.rank) await doRank();
  if (args.events) await doEvents();
  if (args.photos) await doPhotos();
  if (args.history) await doHistory(+args.history === 1 && args.history === true ? 400 : Math.max(1, +args.history || 400), +(args.refresh || 0));
  if (args.cards) await doCards(args.cards === true ? 300 : Math.max(1, +args.cards || 300));
  if (args.build) build({ gz: !!args.gz });
  if (!Object.keys(args).some((k) => ['rank', 'events', 'photos', 'history', 'cards', 'build'].includes(k))) console.log('nada que hacer: --rank --events --photos --history[=N] --cards[=N] --build [--gz]');
})().catch((e) => { console.error(e); process.exit(1); });
