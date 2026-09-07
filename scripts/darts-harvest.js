#!/usr/bin/env node
// scripts/darts-harvest.js — LA COSECHA DE LA BASE PROPIA DE DARDOS (blueprint 8.0, fases 1-2)
//
//   node scripts/darts-harvest.js --pdc [--seasons=2023,2024,2025,2026]   torneos + stages + fixtures (crudo)
//   node scripts/darts-harvest.js --orakel                                  leaderboards por ventana + partidos PC
//   node scripts/darts-harvest.js --build                                   crudo → data/darts/{matches,players,meta,orakel}.json
//
// Lo crudo va a un directorio fuera del repo (GP_DARTS_RAW, o /data/darts-raw en Render, o el scratchpad
// local); lo compacto se versiona. Escritura atómica. Reanudable: lo ya bajado no se vuelve a pedir salvo
// --refresh (para la temporada en curso).
'use strict';
const fs = require('fs');
const path = require('path');
const PDC = require('../data-providers/darts/pdc');
const ORK = require('../data-providers/darts/orakel');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] == null ? true : m[2]] : [a, true]; }));
const RAW = process.env.GP_DARTS_RAW || (fs.existsSync('/data') ? '/data/darts-raw' : path.join(__dirname, '..', '..', 'darts-raw'));
// el compacto se escribe en el DISCO PERSISTENTE cuando lo hay (Render) y en el repo en local. La base del
// repo es la LÍNEA DE BASE: lo que el crudo no trae (temporadas viejas que la cola diaria no vuelve a bajar)
// se conserva de ahí, y lo que sí trae la sobreescribe. Sin esto, la cola en Render —que solo refresca la
// temporada en curso— habría reconstruido una base con un solo año y perdido 2023-2025.
const REPO_OUT = path.join(__dirname, '..', 'data', 'darts');
const OUT = process.env.GP_DARTS_OUT || (fs.existsSync('/data') ? '/data/darts' : REPO_OUT);
const log = (...x) => console.log('[darts-harvest]', new Date().toISOString().slice(11, 19), ...x);
const zlib = require('zlib');
const wr = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, f); };
// los dos compactos grandes (partidos y ventanas) viajan comprimidos en el repo: 27 MB en claro son 4 MB en gz
const wrBig = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const gz = f + '.gz', tmp = gz + '.tmp'; fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 })); fs.renameSync(tmp, gz); try { fs.unlinkSync(f); } catch { } };
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f + '.gz')).toString('utf8')); } catch { return null; } } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PDC ──────────────────────────────────────────────────────────────────────────────────────────────────
async function harvestPdc() {
  const seasons = String(args.seasons || '2023,2024,2025,2026').split(',').map((s) => +s.trim()).filter(Boolean);
  const refresh = !!args.refresh;
  for (const season of seasons) {
    const listF = path.join(RAW, 'pdc', `tournaments-${season}.json`);
    let list = refresh ? null : rd(listF);
    if (!list) { list = await PDC.tournaments(season); wr(listF, list); }
    log(`temporada ${season}: ${list.length} torneos`);
    let n = 0;
    for (const t of list) {
      const id = String(t.id || t.tournamentID);
      const f = path.join(RAW, 'pdc', 'tournaments', `${id}.json`);
      const have = rd(f);
      // la temporada en curso se refresca si el torneo no ha terminado hace más de 3 días
      const ended = t.endDate && Date.parse(t.endDate) < Date.now() - 3 * 864e5;
      if (have && (ended || !refresh)) continue;
      try { const det = await PDC.tournament(id); wr(f, det); n++; }
      catch (e) { log(`  torneo ${id} (${t.name}): ${e.message}`); }
      await sleep(350);
    }
    log(`  bajados ${n} detalles nuevos`);
  }
  // rankings (Order of Merit y ProTour) — foto de hoy
  try {
    const keys = await PDC.rankings();
    wr(path.join(RAW, 'pdc', 'rankings-index.json'), keys);
    for (const k of ['2YEAR', '1YEAR']) { try { wr(path.join(RAW, 'pdc', `ranking-${k}.json`), await PDC.ranking(k)); } catch (e) { log(`ranking ${k}: ${e.message}`); } await sleep(300); }
  } catch (e) { log('rankings:', e.message); }
}

// ── PARTICIPANTES (fecha de nacimiento, foto, tarjeta): solo los que aparecen en la base ─────────────────
async function harvestParticipants(ids) {
  let n = 0;
  for (const id of ids) {
    const f = path.join(RAW, 'pdc', 'participants', `${id}.json`);
    if (rd(f)) continue;
    try { wr(f, await PDC.participant(id)); n++; } catch (e) { log(`  participante ${id}: ${e.message}`); }
    await sleep(300);
  }
  log(`participantes bajados: ${n}`);
}

// ── ORAKEL ───────────────────────────────────────────────────────────────────────────────────────────────
const KEYS_WINDOW = [ORK.RANK.AVG, ORK.RANK.X180, ORK.RANK.CHECKOUT_PCT, ORK.RANK.HIGHEST_CHECKOUT, ORK.RANK.FIRST9];
function monthEnds(fromY, fromM) {
  const out = [];
  const now = new Date();
  for (let y = fromY, m = fromM; ; m++) {
    if (m > 12) { m = 1; y++; }
    const end = new Date(Date.UTC(y, m, 0)); // último día del mes m
    if (end > now) break;
    out.push(end.toISOString().slice(0, 10));
  }
  out.push(now.toISOString().slice(0, 10));
  return out;
}
const shiftDays = (iso, d) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);

async function harvestOrakel() {
  const ends = monthEnds(2023, 12);
  const refresh = !!args.refresh;
  let n = 0;
  for (const end of ends) {
    for (const win of [365, 90]) {
      const from = shiftDays(end, -win);
      for (const rk of KEYS_WINDOW) {
        const f = path.join(RAW, 'orakel', 'windows', `${rk}-${win}-${end}.json`);
        const isToday = end === new Date().toISOString().slice(0, 10);
        if (rd(f) && !(isToday && refresh)) continue;
        try { wr(f, await ORK.leaderboard(rk, from, end, { minMatches: 3 })); n++; }
        catch (e) { log(`  ventana ${rk} ${win}d ${end}: ${e.message}`); }
        await ORK.sleep(350);
      }
    }
  }
  log(`ventanas bajadas: ${n}`);
  // partidos por jugador (Players Championship): los del leaderboard de 365 días de hoy con ≥5 partidos
  const today = new Date().toISOString().slice(0, 10);
  const lb = rd(path.join(RAW, 'orakel', 'windows', `${ORK.RANK.AVG}-365-${today}.json`));
  const keys = ((lb && lb.rows) || []).filter((r) => r.den > 0).slice(0, +(args.maxPlayers || 400)).map((r) => r.key);
  log(`jugadores para partidos PC: ${keys.length}`);
  let m = 0;
  for (const k of keys) {
    for (const year of [2024, 2025, 2026]) {
      for (const rk of [ORK.RANK.AVG, ORK.RANK.X180, ORK.RANK.CHECKOUT_PCT]) {
        const f = path.join(RAW, 'orakel', 'matches', `${k}-${rk}-${year}.json`);
        const cur = year === new Date().getUTCFullYear();
        if (rd(f) && !(cur && refresh)) continue;
        try { wr(f, await ORK.playerMatches(k, rk, `${year}-01-01`, `${year}-12-31`)); m++; }
        catch (e) { log(`  partidos ${k} ${rk} ${year}: ${e.message}`); }
        await ORK.sleep(350);
      }
    }
  }
  log(`ficheros de partidos bajados: ${m}`);
}

// ── CONSTRUCCIÓN DE LA BASE COMPACTA ─────────────────────────────────────────────────────────────────────
const SCHEMA = ['date', 'seq', 'tid', 'round', 'wid', 'lid', 'w_legs', 'l_legs', 'w_sets', 'l_sets', 'unit', 'bo', 'two_clear', 'w_avg', 'l_avg', 'w_x180', 'l_x180', 'w_co_hit', 'w_co_att', 'l_co_hit', 'l_co_att', 'w_hc', 'l_hc', 'cat', 'tv', 'fid', 'w_first', 'a_is_w'];
const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ymd = (iso) => +String(iso).slice(0, 10).replace(/-/g, '');

function build() {
  const dir = path.join(RAW, 'pdc', 'tournaments');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const tourneys = {}, players = {}, rows = [];
  let nFix = 0, nRes = 0;
  // línea de base: el compacto del repo (o del disco), para los torneos que el crudo no trae
  const baseM = rd(path.join(REPO_OUT, 'matches.json')) || (OUT !== REPO_OUT ? rd(path.join(OUT, 'matches.json')) : null);
  const baseP = rd(path.join(REPO_OUT, 'players.json')) || (OUT !== REPO_OUT ? rd(path.join(OUT, 'players.json')) : null) || {};
  const baseO = rd(path.join(REPO_OUT, 'orakel.json')) || (OUT !== REPO_OUT ? rd(path.join(OUT, 'orakel.json')) : null);
  const rawTids = new Set(files.map((f) => f.replace(/\.json$/, '')));
  if (baseM && Array.isArray(baseM.rows) && baseM.schema && baseM.schema.join() === SCHEMA.join()) {
    const Fb = {}; baseM.schema.forEach((k, i) => { Fb[k] = i; });
    let kept = 0;
    for (const r of baseM.rows) { if (rawTids.has(String(r[Fb.tid]))) continue; rows.push(r.slice()); kept++; nRes++; }
    for (const [tid, t] of Object.entries(baseM.tourneys || {})) if (!rawTids.has(String(tid))) tourneys[tid] = t;
    for (const [id, p] of Object.entries(baseP)) players[id] = { ...p, n: 0 };
    for (const r of rows) { for (const id of [r[Fb.wid], r[Fb.lid]]) if (players[id]) players[id].n++; }
    log(`línea de base: ${kept} resultados y ${Object.keys(tourneys).length} torneos conservados del compacto anterior`);
  }
  const pname = (p) => (p && (p.name || [p.firstName, p.lastName].filter(Boolean).join(' '))) || null;
  for (const f of files) {
    const t = rd(path.join(dir, f)); if (!t) continue;
    const tid = String(t.id || t.tournamentID);
    const cat = PDC.CATEGORY_LABEL[t.tournamentCategoryID] || 'other';
    // Q-School, Challenge/Development/Women/Youth: se guardan aparte para no ensuciar el Elo principal
    const nm = String(t.name || '');
    const sec = /qualifying school|q-school|challenge tour|development tour|women'?s series|youth|junior|modus|academy/i.test(nm) || cat === 'secondary';
    tourneys[tid] = { name: nm, season: t.seasonID, start: t.startDate, end: t.endDate, venue: t.venue || null, city: t.city || null, ranked: !!t.isRanked, tv: !!t.isTelevised, cat, secondary: sec, logo: PDC.IMG(t.tournamentLogo), type_id: t.tournamentTypeID || null, category_id: t.tournamentCategoryID || null, dartconnect: t.dartConnectID || null };
    for (const st of t.stages || []) {
      const fmt = { sets: st.numberOfSets, legs: st.numberOfLegsPerSet, two: !!st.twoClearLegsToWin };
      const stageName = (st.stage && st.stage.name) || '';
      for (const fx of st.fixtures || []) {
        nFix++;
        if (fx.status !== 'Result') continue;
        const p1 = fx.participant1 || {}, p2 = fx.participant2 || {};
        if (!p1.participantID || !p2.participantID) continue;
        const s1 = +fx.participant1Score, s2 = +fx.participant2Score;
        if (!Number.isFinite(s1) || !Number.isFinite(s2) || s1 === s2) continue;
        const aWon = fx.winnerParticipantID ? String(fx.winnerParticipantID) === String(p1.participantID) : s1 > s2;
        const W = aWon ? p1 : p2, L = aWon ? p2 : p1;
        const ws = aWon ? s1 : s2, ls = aWon ? s2 : s1;
        for (const p of [p1, p2]) {
          const id = String(p.participantID);
          if (!players[id]) players[id] = { name: pname(p), country: p.countryCode || null, n: 0 };
          if (!players[id].name) players[id].name = pname(p);
          players[id].n++;
        }
        const unit = fmt.sets > 1 ? 'sets' : 'legs';
        const date = ymd(fx.startDate);
        const seq = fx.startTime ? +String(fx.startTime).slice(0, 5).replace(':', '') : 0;
        rows.push([date, seq, tid, stageName, String(W.participantID), String(L.participantID),
          unit === 'legs' ? ws : null, unit === 'legs' ? ls : null, unit === 'sets' ? ws : null, unit === 'sets' ? ls : null,
          unit, unit === 'sets' ? fmt.sets : fmt.legs, fmt.two ? 1 : 0,
          null, null, null, null, null, null, null, null, null, null,
          sec ? 'sec' : cat, tourneys[tid].tv ? 1 : 0, String(fx.fixtureID || fx.id), null, aWon ? 1 : 0]);
        nRes++;
      }
    }
  }
  // participantes con ficha (dob, foto, tarjeta)
  const pdir = path.join(RAW, 'pdc', 'participants');
  if (fs.existsSync(pdir)) for (const f of fs.readdirSync(pdir)) {
    const p = rd(path.join(pdir, f)); if (!p) continue;
    const id = String(p.id || p.participantID);
    if (!players[id]) continue;
    const prof = (p.media || []).find((m) => m.type === 'profile');
    Object.assign(players[id], { dob: p.dob || null, nickname: p.nickname || null, slug: p.participantSlug || null, photo: prof ? PDC.IMG(prof.image) : null, tour_card: !!p.isCurrentTourCardHolder, oom_rank: p.ranking || null, prize: p.prizeMoney || null, hometown: (p.meta || {}).homeTown || null, darts: (p.meta || {}).makeOfDart || null, dart_weight: (p.meta || {}).weightOfDart || null, started: (p.meta || {}).startedPlayingYear || null, nine_darters: (p.statistics || {}).nineDartCount || null });
  }
  // ORAKEL → estadística por partido (Players Championship) casada por nombres + fecha + marcador
  const F = {}; SCHEMA.forEach((k, i) => { F[k] = i; });
  const byName = new Map(); for (const [id, p] of Object.entries(players)) byName.set(normName(p.name), id);
  const idx = new Map(); // `${wid}|${lid}|${date}` → row
  for (const r of rows) idx.set(`${r[F.wid]}|${r[F.lid]}|${r[F.date]}`, r);
  const mdir = path.join(RAW, 'orakel', 'matches');
  let joined = 0, seen = new Set(), orakelKeys = {};
  if (fs.existsSync(mdir)) for (const f of fs.readdirSync(mdir)) {
    const m = f.match(/^(\d+)-(\d+)-(\d{4})\.json$/); if (!m) continue;
    const rk = +m[2];
    const j = rd(path.join(mdir, f)); if (!j) continue;
    for (const x of j.rows || []) {
      const wid = byName.get(normName(x.winner)), lid = byName.get(normName(x.loser));
      if (!wid || !lid) continue;
      orakelKeys[x.winner_key] = wid; orakelKeys[x.loser_key] = lid;
      // la fecha de Orakel es la del torneo (día); la de la PDC la del partido: se admite ±3 días
      let row = null;
      for (let dd = 0; dd <= 3 && !row; dd++) for (const sgn of dd ? [1, -1] : [1]) {
        const d = ymd(new Date(Date.parse(x.date) + sgn * dd * 864e5).toISOString());
        row = idx.get(`${wid}|${lid}|${d}`) || null; if (row) break;
      }
      if (!row) continue;
      const mine = +m[1] === x.winner_key ? 'w_' : +m[1] === x.loser_key ? 'l_' : null;
      if (!mine) continue;
      if (rk === ORK.RANK.AVG && x.stat != null) row[F[mine + 'avg']] = x.stat;
      if (rk === ORK.RANK.X180 && x.stat1 != null) row[F[mine + 'x180']] = x.stat1;
      if (rk === ORK.RANK.CHECKOUT_PCT && x.stat1 != null && x.stat2 != null) { row[F[mine + 'co_hit']] = x.stat1; row[F[mine + 'co_att']] = x.stat2; }
      const k2 = `${row[F.fid]}|${mine}|${rk}`;
      if (!seen.has(k2)) { seen.add(k2); joined++; }
    }
  }
  // ventanas de Orakel: la foto de habilidad por jugador y fecha de corte (se guarda compacta)
  // Cada ventana trae ~7.500 jugadores (todo el mundo que Orakel registra): se guardan SOLO los que están en
  // la base PDC, y en las fotos históricas (fin de mes, para la validación) solo los que tienen ≥10 partidos.
  // La foto MÁS RECIENTE se guarda entera para los jugadores de la base (es la que alimenta el tablero).
  const wdir = path.join(RAW, 'orakel', 'windows');
  // línea de base de ventanas: las del compacto anterior; el crudo las sobreescribe por clave
  const windows = (baseO && baseO.windows) ? JSON.parse(JSON.stringify(baseO.windows)) : {};
  let latestEnd = (baseO && baseO.latest) || null;
  if (fs.existsSync(wdir)) {
    const files = fs.readdirSync(wdir).map((f) => f.match(/^(\d+)-(\d+)-(\d{4}-\d{2}-\d{2})\.json$/)).filter(Boolean);
    const rawLatest = files.map((m) => m[3]).sort().pop() || null;
    if (rawLatest && (!latestEnd || rawLatest > latestEnd)) latestEnd = rawLatest;
    // la foto "más reciente" anterior deja de serlo: se recorta a los jugadores con base (≥25) como las históricas
    if (baseO && baseO.latest && baseO.latest !== latestEnd) for (const w of ['365', '90']) { const k = `${baseO.latest}|${w}`; if (windows[k]) for (const id of Object.keys(windows[k])) { if ((players[id] || {}).n < 25) delete windows[k][id]; else for (const rk of Object.keys(windows[k][id])) if (!['25', '26', '1053'].includes(rk)) delete windows[k][id][rk]; } }
    for (const m of files) {
      const j = rd(path.join(wdir, m[0])); if (!j) continue;
      const isLatest = m[3] === latestEnd;
      const key = `${m[3]}|${m[2]}`;
      windows[key] = windows[key] || {};
      // fotos históricas: solo media, 180s y dobles (lo que entra al kernel) y solo jugadores con ≥25
      // partidos en la base; sin este recorte el compacto pasaba de 50 MB
      if (!isLatest && !['25', '26', '1053'].includes(m[1])) continue;
      for (const r of j.rows || []) {
        const id = byName.get(normName(r.name));
        if (!id) continue;
        if (!isLatest && (players[id].n || 0) < 25) continue;
        const o = windows[key][id] = windows[key][id] || {};
        o[String(m[1])] = [r.num, r.den, r.stat];
      }
    }
  }
  rows.sort((a, b) => a[F.date] - b[F.date] || a[F.seq] - b[F.seq]);
  const dates = rows.map((r) => r[F.date]);
  fs.mkdirSync(OUT, { recursive: true });
  wrBig(path.join(OUT, 'matches.json'), { schema: SCHEMA, tourneys, rows });
  wr(path.join(OUT, 'players.json'), players);
  wrBig(path.join(OUT, 'orakel.json'), { keys: ORK.RANK, latest: latestEnd, windows, player_keys: orakelKeys, note: 'ventanas [fecha de corte|días] → jugador → rankKey → [numerador, denominador, stat]. Fuente: Darts Orakel, uso interno de investigación.' });
  wr(path.join(OUT, 'meta.json'), { built_at: new Date().toISOString(), fixtures_seen: nFix, results: nRes, players: Object.keys(players).length, tourneys: Object.keys(tourneys).length, first_match_date: dates[0] || null, last_match_date: dates[dates.length - 1] || null, years: dates.length ? `${String(dates[0]).slice(0, 4)}→${String(dates[dates.length - 1]).slice(0, 4)}` : null, orakel_joined_fields: joined, orakel_windows: Object.keys(windows).length, sources: ['pdc-api-v2', 'dartsorakel'] });
  log(`base: ${nRes} resultados de ${nFix} fixtures, ${Object.keys(players).length} jugadores, ${Object.keys(tourneys).length} torneos; orakel: ${joined} campos casados, ${Object.keys(windows).length} ventanas`);
  return { players };
}

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  log('crudo en', RAW);
  if (args.pdc) await harvestPdc();
  if (args.orakel) await harvestOrakel();
  if (args.participants) {
    const m = rd(path.join(OUT, 'players.json')) || {};
    const ids = Object.entries(m).filter(([, p]) => p.n >= +(args.minN || 15)).map(([id]) => id);
    log(`participantes a bajar: ${ids.length}`);
    await harvestParticipants(ids);
  }
  if (args.build) build();
  log('fin');
})().catch((e) => { console.error(e); process.exit(1); });
