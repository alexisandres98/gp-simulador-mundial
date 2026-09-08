// tt-engine/store.js — EL TERMINAL DE TENIS DE MESA (blueprint 9.0): agenda, mercado, sombra y catálogo
//
// Mecánica de la casa, calcada de dardos/tenis: modelo market-blind POR CONSTRUCCIÓN (ninguna cuota entra a
// la probabilidad), TODAS las familias en SOMBRA, registro privado con CLV contra el cierre capturado y
// catálogo servido solo con EVIDENCIA. Lo propio de este deporte: el compilador EXACTO punto → game →
// partido (una sola fuente para ganador, marcador, games, puntos, hándicaps y mercados del primer game), el
// mapa de INTEGRIDAD de competiciones (WTT/ITTF verificadas; ligas privadas de apuestas solo display) y la
// lectura del PROCESO IMPLÍCITO del mercado (qué probabilidad de punto está cotizando cada línea).
//
// Fuentes: WTT (eventos, agenda, match cards oficiales), ITTF (ranking e historial con puntos por game),
// Flashscore (vivo, display) y tres casas (Pinnacle referencia · Bovada superficie rica · Cloudbet
// ejecutable) — ver data/tt/RIGHTS.md.
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('./data');
const C = require('./compiler');
const R = require('./rules');
const WTT = require('../data-providers/tt/wtt');
const BOOKS = require('../data-providers/tt/books');
const FLASH = require('../data-providers/tt/flashscore');
const JS = require('../lib/jsonstore');

const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'tt');
const rd = (f) => JS.readJson(DISK_DIR, f, 'tt');
const wr = (f, o) => { try { fs.mkdirSync(DISK_DIR, { recursive: true }); } catch { } return JS.writeJson(DISK_DIR, f, o, 'tt'); };
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const norm = D.norm;
const clampP = (p) => Math.max(1e-4, Math.min(1 - 1e-4, p));
const trim = (pairs, eps = 0.002) => (pairs || []).filter(([, p]) => p > eps).map(([k, p]) => [k, r4(p)]);

const DOCTRINE = 'todas las familias de tenis de mesa están EN SOMBRA: el motor compila el partido punto a punto con las reglas exactas (11 puntos, dos de diferencia, saque en bloques de dos, alternancia desde 10–10), así que ganador, marcador, games, puntos y los mercados del primer game salen del MISMO estado y no pueden contradecirse; contra el MERCADO no hay prueba todavía — eso es lo que la sombra va a medir, familia por familia, con CLV contra el cierre capturado. El ganador se registra como referencia, jamás como pick. Solo competiciones VERIFICADAS (WTT/ITTF); las ligas privadas de apuestas se enseñan con aviso y nunca se modelan. Datos de la WTT y la ITTF: uso interno de investigación, admin-only.';
const ATTRIB = 'Calendario, resultados y match cards: World Table Tennis. Ranking e historial: ITTF. Uso interno de investigación, sin fines comerciales.';

// LAS FAMILIAS (blueprint bloque 9): totales y mercados del primer game son la hipótesis principal (la cola de
// deuce que un ganador calibrado no identifica); el ganador es referencia
const FAMILIES = {
  ML: { label: 'Ganador', card: 'SOLID', benchmark: true },
  GAMES_TOTAL: { label: 'Total de games', card: 'TOTAL' },
  GAMES_HCP: { label: 'Hándicap de games', card: 'SPREAD' },
  POINTS_TOTAL: { label: 'Total de puntos', card: 'TOTAL' },
  POINTS_HCP: { label: 'Hándicap de puntos', card: 'SPREAD' },
  CORRECT_SCORE: { label: 'Marcador exacto', card: 'COMBO', display_only: true },
  GAME_ML: { label: 'Ganador del 1er game', card: 'SOLID' },
  GAME_POINTS_TOTAL: { label: 'Puntos del 1er game', card: 'TOTAL' },
  GAME_POINTS_HCP: { label: 'Hándicap del 1er game', card: 'SPREAD' },
  GAME_DEUCE: { label: 'Deuce en el 1er game', card: 'TOTAL' },
};

const G = { events: null, slate: null, odds: null, tz: null, results: null, live: { at: 0, ids: new Map(), cards: new Map() } };

// ══ 1. AGENDA (WTT) ═════════════════════════════════════════════════════════════════════════════════════
const SLATE_TTL = 4 * 60e3;
const todayInt = () => +new Date().toISOString().slice(0, 10).replace(/-/g, '');
const dayInt = (iso) => +String(iso || '').slice(0, 10).replace(/-/g, '');
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const shortName = (name) => String(name || '').replace(/\s+(presented|powered)\s+by.*$/i, '').replace(/\s+-\s+president.*$/i, '').replace(/\s+\d{4}\s*$/, '').trim();
function tzStore() { if (!G.tz) G.tz = rd('tz.json') || { by: {} }; return G.tz; }
function resultsStore() { if (!G.results) G.results = rd('results.json') || { by: {} }; return G.results; }
// primer servidor observado en vivo (game 1 a 0–0): alimenta el compilador sin mezclar los dos sorteos
function firstsStore() { if (!G.firsts) G.firsts = rd('firsts.json') || { by: {} }; return G.firsts; }
function recordFirstServer(fixtureId, side) {
  const st = firstsStore();
  if (st.by[fixtureId]) return;
  st.by[fixtureId] = { side, at: new Date().toISOString() };
  for (const [k, v] of Object.entries(st.by)) if (Date.now() - Date.parse(v.at) > 45 * 864e5) delete st.by[k];
  wr('firsts.json', st);
}
const firstServerOf = (fixtureId) => ((firstsStore().by[fixtureId] || {}).side || null);
function offsetFor(ev, when) {
  const tz = tzStore().by[ev.id];
  if (tz && tz.offset_min != null) return { offset: tz.offset_min, certain: true, source: 'match card oficial (hora local y UTC)' };
  const off = WTT.tzOffsetMin(ev.country, ev.city, when || new Date());
  return { offset: off, certain: false, source: off == null ? 'sede sin zona conocida' : 'tabla de sedes (sin certificar)' };
}
// certifica el desplazamiento de un evento con un match card oficial (local − UTC)
function certifyTz(ev, card) {
  if (!card || !card.start_utc || !card.start_local) return;
  const loc = String(card.start_local).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!loc) return;
  const locMs = Date.UTC(+loc[3], +loc[1] - 1, +loc[2], +loc[4], +loc[5], +loc[6]);
  const off = Math.round((locMs - Date.parse(card.start_utc)) / 60e3);
  if (!Number.isFinite(off) || Math.abs(off) > 14 * 60) return;
  const tz = tzStore();
  if (!tz.by[ev.id] || tz.by[ev.id].offset_min !== off) { tz.by[ev.id] = { offset_min: off, at: new Date().toISOString(), name: ev.name }; wr('tz.json', tz); }
}
async function activeEvents({ daysAhead = 10, daysBack = 2 } = {}) {
  const ev = await WTT.events();
  G.events = ev;
  const lo = addDays(-daysBack), hi = addDays(daysAhead);
  return ev.filter((e) => e.start && e.end && e.start <= hi && e.end >= lo && !e.youth).sort((x, y) => x.start.localeCompare(y.start));
}
const statusOf = (s) => { const x = String(s || '').toLowerCase(); if (/official|unofficial|finish|complete/.test(x)) return 'final'; if (/running|live|progress/.test(x)) return 'live'; return 'scheduled'; };
function normFixture(u, ev) {
  const round = R.normalizeRound(u.label || u.round_code || u.draw);
  const tier = R.tierOf(ev.name);
  const off = offsetFor(ev, new Date());
  const start_at = WTT.localToUtc(u.start_local, off.offset);
  const pl = (s) => { const p = s && s.id ? D.playerOf(s.id) : null; return s && s.id ? { id: s.id, name: (p && p.name) || s.name, family: (p && p.family) || s.family, given: (p && p.given) || s.given, country: s.country || (p && p.country) || null, seed: s.seed, qualifier: s.qualifier, dob: s.dob || (p && p.dob) || null, photo: (p && p.photo) || null, rank: p ? p.rank : null, in_base: !!p && (p.n > 0) } : { id: null, name: s && s.name ? s.name : 'TBD', in_base: false }; };
  const fmt = D.formatFor(tier, round);
  return { id: u.id, event_id: ev.id, code: u.code, tournament: ev.name, tournament_short: shortName(ev.name), tier, tier_label: R.TIER_LABEL[tier] || tier, sub: u.sub, sub_name: u.sub_name, round, round_code: u.round_code, round_label: R.ROUND_LABEL[round] || u.label, label: u.label, table: u.table_name || u.table, venue: u.venue || ev.venue, city: ev.city, country: ev.country,
    start_at, start_local: u.start_local, tz_certain: off.certain, tz_source: off.source, status: statusOf(u.status), wtt_status: u.status, a: pl(u.a), b: pl(u.b), format: { kind: 'games', best_of: fmt.best_of, certified: false, source: fmt.source, share: fmt.share, n: fmt.n }, integrity: R.INTEGRITY.VERIFIED_SCOPE, circuit: 'wtt' };
}
let slateInflight = null;
async function slate({ force = false, daysAhead = 10, wait = false } = {}) {
  if (G.slate && !force && Date.now() - G.slate.at < SLATE_TTL) return G.slate;
  // stale-while-revalidate: con agenda en memoria se responde al instante y se renueva aparte
  if (!slateInflight) slateInflight = slateNow({ force, daysAhead }).catch(() => G.slate).finally(() => { slateInflight = null; });
  if (G.slate && !force && !wait) return G.slate;
  return slateInflight;
}
async function slateNow({ force = false, daysAhead = 10 } = {}) {
  const evs = await activeEvents({ daysAhead });
  const fixtures = [], tournaments = [];
  const prev = (G.slate && G.slate.fixtures) || [];
  for (const ev of evs) {
    let units = null;
    try { units = await WTT.schedule(ev.id, { force }); } catch { units = null; }
    if (!units) units = prev.filter((f) => f.event_id === ev.id).map((f) => f._unit).filter(Boolean);
    const rows = [];
    const seenPair = new Set();
    for (const u of units || []) {
      if (!(u.sub === 'MS' || u.sub === 'WS')) continue;
      const fx = normFixture(u, ev); fx._unit = u;
      // la agenda repite a veces la misma unidad con otro código (8-sep, Puerto Princesa): un solo partido por par y hora
      if (fx.a.id && fx.b.id) { const pk = [fx.a.id, fx.b.id].sort().join('-') + '|' + (fx.start_local || ''); if (seenPair.has(pk)) continue; seenPair.add(pk); }
      // resultado oficial en caché (lo trae el trabajo de liquidación / el detalle)
      const res = resultsStore().by[fx.id];
      if (res) { fx.result = res; fx.status = 'final'; if (res.best_of) fx.format = { ...fx.format, best_of: res.best_of, certified: true, source: 'match card oficial de la WTT' }; }
      rows.push(fx);
    }
    fixtures.push(...rows);
    const fin = rows.filter((r) => r.status === 'final').length;
    tournaments.push({ id: ev.id, name: ev.name, short: shortName(ev.name), tier: R.tierOf(ev.name), tier_label: R.TIER_LABEL[R.tierOf(ev.name)], tier_name: ev.tier_name, start: ev.start, end: ev.end, city: ev.city, country: ev.country, venue: ev.venue, logo: ev.logo, bg: ev.bg, color: ev.color, fixtures: rows.length, results: fin, subs: [...new Set(rows.map((r) => r.sub))], tz: offsetFor(ev), state: ev.start > addDays(0) ? 'upcoming' : ev.end >= addDays(0) ? 'live' : 'done', integrity: R.INTEGRITY.VERIFIED_SCOPE, circuit: 'wtt' });
  }
  fixtures.sort((a, b) => Date.parse(a.start_at || 0) - Date.parse(b.start_at || 0));
  G.slate = { at: Date.now(), fixtures, tournaments, events: evs };
  return G.slate;
}
// resultado oficial de un fixture (con caché en disco); certifica la zona horaria del evento de paso
async function fetchResult(fx) {
  const st = resultsStore();
  if (st.by[fx.id]) return st.by[fx.id];
  const card = await WTT.officialResult(fx.event_id, fx.code).catch(() => null);
  if (!card || card.status !== 'final' || !card.games.length) return null;
  const ev = (G.events || []).find((e) => e.id === fx.event_id) || { id: fx.event_id, name: fx.tournament };
  certifyTz(ev, card);
  // orientación: H/A del match card frente a a/b de la agenda
  const swapped = card.h.id && fx.a.id && card.h.id !== fx.a.id && card.a.id === fx.a.id;
  const games = swapped ? card.games.map(([h, a]) => [a, h]) : card.games;
  const out = { games, score_a: swapped ? card.score_a : card.score_h, score_b: swapped ? card.score_h : card.score_a, best_of: card.best_of, duration_min: card.duration_min != null ? r2(card.duration_min) : null, timeouts: { a: swapped ? card.a.timeouts : card.h.timeouts, b: swapped ? card.h.timeouts : card.a.timeouts }, start_utc: card.start_utc, at: new Date().toISOString(), source: 'wtt' };
  out.winner = out.score_a > out.score_b ? 'a' : 'b';
  out.points_a = games.reduce((s, g) => s + g[0], 0); out.points_b = games.reduce((s, g) => s + g[1], 0);
  st.by[fx.id] = out;
  // poda: resultados de más de 45 días
  for (const [k, v] of Object.entries(st.by)) if (v.at && Date.now() - Date.parse(v.at) > 45 * 864e5) delete st.by[k];
  wr('results.json', st);
  return out;
}

// ══ 2. MERCADO ══════════════════════════════════════════════════════════════════════════════════════════
const ODDS_TTL = 3 * 60e3;
// STALE-WHILE-REVALIDATE (8-sep, lección de prod): la primera pasada del tablero tardaba 39 s porque leía los
// 71 mercados de Cloudbet en serie DENTRO de la petición y el móvil corta a los 30. Ahora: si hay cuotas en
// memoria (aunque hayan vencido) se devuelven al instante y la renovación corre aparte; solo la primerísima
// lectura espera. Cloudbet se lee de 6 en 6 y con tope por pasada, los partidos más próximos primero.
let oddsInflight = null;
async function refreshOdds({ force = false, wait = false } = {}) {
  if (G.odds && !force && Date.now() - G.odds.at < ODDS_TTL) return G.odds;
  if (!oddsInflight) oddsInflight = refreshOddsNow().catch(() => G.odds).finally(() => { oddsInflight = null; });
  if (G.odds && !force && !wait) return G.odds; // lo que hay, ya; lo nuevo llega solo
  return oddsInflight;
}
const CB_MAX_PER_PASS = 60, CB_PAR = 6;
async function refreshOddsNow() {
  const [pin, bov, cbf] = await Promise.all([BOOKS.pinnacle().catch(() => ({ events: [], available: false })), BOOKS.bovada().catch(() => ({ events: [], available: false })), BOOKS.cloudbetFixtures().catch(() => ({ events: [], available: false }))]);
  const events = [...pin.events, ...bov.events];
  // Cloudbet: mercados solo para los eventos de competiciones VERIFICADAS que casan con la agenda (ahorra llamadas);
  // las ligas privadas cuentan para el mapa de integridad pero no se leen sus líneas
  const sl = G.slate || (await slate().catch(() => null));
  let cbKeys = new Set(), cbRead = 0;
  const toRead = [];
  for (const e of cbf.events || []) {
    const integ = R.integrityOf(e.competition);
    e.integrity = integ; e.rows = [];
    events.push(e);
    if (integ !== R.INTEGRITY.VERIFIED_SCOPE) continue;
    const fx = sl ? matchFixture(sl.fixtures, e) : null;
    if (fx) toRead.push(e);
  }
  toRead.sort((x, y) => Date.parse(x.start_at || 0) - Date.parse(y.start_at || 0));
  const prev = G.odds ? new Map(G.odds.events.filter((e) => e.book === 'cloudbet' && (e.rows || []).length).map((e) => [e.provider_id, e])) : new Map();
  const queue = toRead.slice(0, CB_MAX_PER_PASS);
  // lo que no entra en esta pasada conserva sus filas de la pasada anterior
  for (const e of toRead.slice(CB_MAX_PER_PASS)) { const p = prev.get(e.provider_id); if (p) { e.rows = p.rows; e.raw_keys = p.raw_keys; } }
  let qi = 0;
  const worker = async () => { while (qi < queue.length) { const e = queue[qi++]; const mk = await BOOKS.cloudbetMarkets(e.provider_id).catch(() => null); if (!mk) { const p = prev.get(e.provider_id); if (p) { e.rows = p.rows; e.raw_keys = p.raw_keys; } continue; } e.rows = mk.rows; e.raw_keys = mk.raw_keys; mk.raw_keys.forEach((k) => cbKeys.add(k)); cbRead++; } };
  await Promise.all(Array.from({ length: CB_PAR }, worker));
  for (const e of events) if (!e.integrity) e.integrity = R.integrityOf(e.competition);
  // el mapa de competiciones (blueprint bloque 7)
  const comps = {};
  for (const e of events) { const k = e.competition || '—'; const c = comps[k] = comps[k] || { name: k, integrity: e.integrity, books: {}, n: 0, lines: 0 }; c.n++; c.books[e.book] = (c.books[e.book] || 0) + 1; c.lines += (e.rows || []).length; }
  G.odds = { at: Date.now(), events, books: { pinnacle: pin.events.length, bovada: bov.events.length, cloudbet: (cbf.events || []).length, cloudbet_read: cbRead }, available: { pinnacle: pin.available, bovada: bov.available, cloudbet: cbf.available }, cloudbet_keys: [...cbKeys], competitions: Object.values(comps).sort((x, y) => y.n - x.n) };
  return G.odds;
}
// ¿el nombre de la casa es este jugador? familia completa + (nombre o inicial); apellidos compuestos exigen todos sus tokens
function nameIs(bookName, pl) {
  if (!pl || !pl.family) return false;
  const bt = norm(bookName).split(' ').filter(Boolean);
  const ft = norm(pl.family).split(' ').filter(Boolean);
  if (!ft.length || !ft.every((t) => bt.includes(t))) return false;
  const rest = bt.filter((t) => !ft.includes(t));
  const gt = norm(pl.given || '').split(' ').filter(Boolean);
  if (!gt.length || !rest.length) return true; // solo apellido en alguno de los dos lados
  if (rest.some((t) => gt.includes(t))) return true;
  if (rest.some((t) => t.length <= 2 && gt.some((g) => g[0] === t[0]))) return true;
  return false;
}
function matchFixture(fixtures, e) {
  const t = Date.parse(e.start_at || 0);
  for (const fx of fixtures) {
    if (!fx.a.id || !fx.b.id) continue;
    if (t && fx.start_at && Math.abs(Date.parse(fx.start_at) - t) > 36 * 3600e3) continue;
    if ((nameIs(e.a, fx.a) && nameIs(e.b, fx.b)) || (nameIs(e.a, fx.b) && nameIs(e.b, fx.a))) return fx;
  }
  return null;
}
// el mercado de un fixture: filas de todas las casas orientadas a (a, b), consenso sin margen y líneas
function marketFor(fx, odds) {
  const out = { rows: [], books: [], n_books: 0, consensus: { ml_p_a: null, ml_n: 0 }, lines: (fam) => [...new Set(out.rows.filter((r) => r.family === fam && !r.live && (fam.indexOf('GAME_') !== 0 || r.game === 1)).map((r) => r.line))].sort((x, y) => x - y), events: [] };
  if (!odds || !fx.a.id || !fx.b.id) return out;
  const t = Date.parse(fx.start_at || 0);
  for (const e of odds.events) {
    if (!(e.rows || []).length) continue;
    if (t && e.start_at && Math.abs(Date.parse(e.start_at) - t) > 36 * 3600e3) continue;
    let swap = null;
    if (nameIs(e.a, fx.a) && nameIs(e.b, fx.b)) swap = false; else if (nameIs(e.a, fx.b) && nameIs(e.b, fx.a)) swap = true;
    if (swap == null) continue;
    out.events.push({ book: e.book, provider_id: e.provider_id, competition: e.competition, swapped: swap, live: !!e.live });
    for (const r of e.rows) {
      const x = { ...r, book: e.book, live: !!r.live || !!e.live };
      if (swap) { if (x.side === 'a') x.side = 'b'; else if (x.side === 'b') x.side = 'a'; if (/HCP$/.test(x.family) && x.line != null) x.line = x.line; if (x.family === 'CORRECT_SCORE') x.side = String(x.side).split('-').reverse().join('-'); }
      // el hándicap ya viene expresado para el lado que lo toma: al voltear lados, la línea del nuevo "a" es la del viejo "b"
      out.rows.push(x);
    }
  }
  const bks = [...new Set(out.rows.map((r) => r.book))];
  out.books = bks; out.n_books = bks.length;
  // consenso ML: mediana de las probabilidades sin margen por casa
  const ps = [];
  for (const bk of bks) { const ra = out.rows.find((r) => r.book === bk && r.family === 'ML' && r.side === 'a' && !r.live), rb = out.rows.find((r) => r.book === bk && r.family === 'ML' && r.side === 'b' && !r.live); if (ra && rb && ra.odds > 1 && rb.odds > 1) { const ia = 1 / ra.odds, ib = 1 / rb.odds; ps.push(ia / (ia + ib)); } }
  if (ps.length) { ps.sort((x, y) => x - y); out.consensus = { ml_p_a: r4(ps[Math.floor(ps.length / 2)]), ml_n: ps.length, ml_spread_pp: r2(100 * (ps[ps.length - 1] - ps[0])) }; }
  return out;
}
// probabilidad implícita sin margen para una fila (con su pareja en la misma casa/línea) o cruda 1/cuota
function impliedOf(row, rows) {
  const pair = rows.find((x) => x.book === row.book && x.family === row.family && (x.game || null) === (row.game || null) && x !== row && x.live === row.live && (
    (row.side === 'a' && x.side === 'b') || (row.side === 'b' && x.side === 'a') || (row.side === 'over' && x.side === 'under') || (row.side === 'under' && x.side === 'over') || (row.side === 'yes' && x.side === 'no') || (row.side === 'no' && x.side === 'yes')) &&
    (row.line == null || x.line == null || Math.abs(Math.abs(x.line) - Math.abs(row.line)) < 1e-9));
  const i = 1 / row.odds;
  if (!pair || !(pair.odds > 1)) return { p: i, vig: null, devig: false };
  const j = 1 / pair.odds;
  return { p: i / (i + j), vig: r3(i + j - 1), devig: true };
}

// ══ 3. EL MODELO DE UN PARTIDO ══════════════════════════════════════════════════════════════════════════
function eventModel(fx, { first = null } = {}) {
  if (!fx.a.id || !fx.b.id) return { available: false, why: 'cuadro sin definir: falta un jugador' };
  const pa = D.playerOf(fx.a.id), pb = D.playerOf(fx.b.id);
  const missing = [fx.a, fx.b].filter((p) => { const q = D.playerOf(p.id); return !q || !(q.n > 0); }).map((p) => p.name || ('#' + p.id));
  if (missing.length) return { available: false, why: 'sin historial en la base propia: ' + missing.join(', '), unresolved: missing };
  if (fx.integrity && fx.integrity !== R.INTEGRITY.VERIFIED_SCOPE) return { available: false, why: `competición ${R.INTEGRITY_LABEL[fx.integrity] || fx.integrity}: el modelo no entra` };
  const m = D.matchModel(fx.a.id, fx.b.id, { best_of: fx.format.best_of, first: first || firstServerOf(fx.id) });
  return { available: true, ...m, a: { ...fx.a, ...(pa || {}) }, b: { ...fx.b, ...(pb || {}) }, format: fx.format, first_observed: firstServerOf(fx.id) };
}
const EDGE_MIN_PP = 3, ODDS_MAX = 6.5;
function gate(c, model, row) {
  const gates = [];
  const push = (gate, pass, detail, informativo) => gates.push({ gate, pass, detail, informativo: !!informativo });
  push('familia', !(FAMILIES[c.family] || {}).display_only, (FAMILIES[c.family] || {}).display_only ? 'familia solo display' : null);
  push('ventana', row.status === 'scheduled' && Date.parse(row.start_at || 0) > Date.now(), row.status !== 'scheduled' ? 'el partido ya empezó' : null);
  push('cuota', c.odds > 1.15 && c.odds <= ODDS_MAX, c.odds > ODDS_MAX ? 'cuota demasiado larga' : c.odds <= 1.15 ? 'cuota demasiado corta' : null);
  push('probabilidad', c.p_model > 0.05 && c.p_model < 0.95, 'fuera del rango que el modelo identifica');
  push('ventaja', c.edge_pp >= EDGE_MIN_PP, `edge ${c.edge_pp.toFixed(1)} pp < ${EDGE_MIN_PP}`);
  push('ruido', c.edge_pp >= 0.75 * model.unc_pp, `edge ${c.edge_pp.toFixed(1)} pp < 0,75 × incertidumbre ${model.unc_pp} pp`);
  push('muestra', !model.skills.a.cold && !model.skills.b.cold, 'jugador frío: menos de ' + (D.build().T.cst.warmN) + ' partidos');
  push('frescura', !model.skills.a.stale && !model.skills.b.stale, 'jugador sin partidos en 8 meses');
  const f = model.format || {};
  push('formato', !!(f.certified || (f.share != null && f.share >= 0.95 && f.n >= 30)), f.certified ? null : `formato no certificado (${f.source})`, false);
  push('primer game', c.family.indexOf('GAME_') !== 0 || c.game === 1, 'solo el primer game se anota antes del partido');
  push('vivo', !c.live, 'línea en vivo');
  return gates;
}
function evaluateEdges(model, mk, row) {
  const out = [];
  const mm = model.match;
  for (const r of mk.rows) {
    if (r.live) continue;
    const fam = FAMILIES[r.family]; if (!fam) continue;
    if (r.family.indexOf('GAME_') === 0 && r.game !== 1) continue;
    const pModel = r.family === 'ML' ? (r.side === 'a' ? model.p_a : r.side === 'b' ? 1 - model.p_a : null) : C.probOf(mm, r.family, r.side, r.line, r.game || 1);
    if (pModel == null || !Number.isFinite(pModel)) continue;
    const imp = impliedOf(r, mk.rows);
    const c = { family: r.family, side: r.side, line: r.line != null ? r.line : null, game: r.game || null, book: r.book, odds: r.odds, alt: !!r.alt, p_model: r4(pModel), p_implied: r4(imp.p), implied_devig: imp.devig, vig: imp.vig, edge_pp: r2(100 * (pModel - imp.p)), ev_pct: r2(100 * (pModel * r.odds - 1)), unc_pp: model.unc_pp, benchmark: !!fam.benchmark, live: !!r.live };
    c.gates = gate(c, model, row);
    const fail = c.gates.find((g) => !g.pass && !g.informativo);
    c.verdict = fail ? 'NO_PICK' : 'SHADOW_PICK';
    if (fail) c.no_pick_reason = fail.gate + (fail.detail ? ': ' + fail.detail : '');
    out.push(c);
  }
  // por familia+lado+línea: la mejor cuota manda (una candidata por selección)
  const best = new Map();
  for (const c of out) { const k = `${c.family}|${c.side}|${c.line}|${c.game}`; const b = best.get(k); if (!b || c.odds > b.odds) best.set(k, c); }
  return [...best.values()].sort((x, y) => (y.edge_pp || 0) - (x.edge_pp || 0));
}

// ── LA CARD DE LA CASA ───────────────────────────────────────────────────────────────────────────────────
const STAKE_CAP = 2;
function stakeOf(p, odds) {
  if (!(p > 0 && odds > 1)) return null;
  const b = odds - 1, k = (p * b - (1 - p)) / b;
  if (!(k > 0)) return null;
  const raw = +(100 * k / 4).toFixed(2);
  return { pct: Math.min(STAKE_CAP, raw), raw, capped: raw > STAKE_CAP };
}
const lastName = (s) => String(s || '').trim().split(/\s+/).slice(-1)[0];
function selectionName(c, row) {
  const who = c.side === 'a' ? row.a : c.side === 'b' ? row.b : null;
  const ou = c.side === 'over' ? 'Más de' : 'Menos de';
  switch (c.family) {
    case 'ML': return `Gana ${who}`;
    case 'GAMES_TOTAL': return `${ou} ${c.line} games`;
    case 'GAMES_HCP': return `${who} ${c.line > 0 ? '+' : ''}${c.line} games`;
    case 'POINTS_TOTAL': return `${ou} ${c.line} puntos en el partido`;
    case 'POINTS_HCP': return `${who} ${c.line > 0 ? '+' : ''}${c.line} puntos`;
    case 'CORRECT_SCORE': return `Marcador exacto ${c.side}`;
    case 'GAME_ML': return `${who} gana el 1er game`;
    case 'GAME_POINTS_TOTAL': return `${ou} ${c.line} puntos en el 1er game`;
    case 'GAME_POINTS_HCP': return `${who} ${c.line > 0 ? '+' : ''}${c.line} puntos en el 1er game`;
    case 'GAME_DEUCE': return c.side === 'yes' ? 'El 1er game llega a deuce (10–10)' : 'El 1er game no llega a deuce';
    default: return `${c.family} ${c.side}${c.line != null ? ' ' + c.line : ''}`;
  }
}
function whyOf(c, row, model) {
  const m = model.match; const bits = [];
  const who = c.side === 'a' ? row.a : c.side === 'b' ? row.b : null;
  const pct = (x) => (100 * x).toFixed(1) + ' %';
  const g1 = C.gameFor(m, 1);
  if (c.family === 'ML') bits.push(`El motor compila el partido punto a punto (al mejor de ${m.format.best_of}) desde la probabilidad de punto de cada uno: ${who} gana ${pct(c.p_model)} de las veces contra el ${pct(c.p_implied)} que implica la cuota.`);
  else if (c.family === 'GAMES_TOTAL') bits.push(`Los games no son un promedio: salen de la distribución completa del compilador (media ${m.exp_games.toFixed(2)}), que sabe cuánto pesa cada game en el marcador ${m.format.need}–x. Sobre esa curva el ${c.side === 'over' ? 'más' : 'menos'} de ${c.line} pesa ${pct(c.p_model)}.`);
  else if (c.family === 'GAMES_HCP') bits.push(`El hándicap se lee sobre la distribución del MARCADOR en games, no sobre el ganador: ${who} cubre ${c.line > 0 ? '+' : ''}${c.line} en ${pct(c.p_model)} de los partidos compilados.`);
  else if (c.family === 'POINTS_TOTAL') bits.push(`Los puntos totales acumulan game a game la cola de deuce (P(deuce por game) ${pct(g1.p_deuce)}, ${(20 + g1.deuce.exp_extra).toFixed(1)} puntos esperados si llega): media ${m.exp_points.toFixed(1)} en el partido; el ${c.side === 'over' ? 'más' : 'menos'} de ${c.line} pesa ${pct(c.p_model)}. Un ganador bien cotizado no fija esta curva.`);
  else if (c.family === 'POINTS_HCP') bits.push(`El margen de puntos del partido sale de la misma compilación que el ganador: ${who} cubre ${c.line > 0 ? '+' : ''}${c.line} puntos en ${pct(c.p_model)}.`);
  else if (c.family === 'GAME_ML') bits.push(`El primer game se compila con la alternancia real del saque (bloques de dos, punto a punto desde 10–10) sin saber quién sirve primero: se promedian los dos sorteos. ${who} lo gana ${pct(c.p_model)}.`);
  else if (c.family === 'GAME_POINTS_TOTAL') bits.push(`Un game no puede acabar 11–10 ni sumar 21 puntos: la curva de puntos del primer game tiene su masa en 11–x y una cola geométrica desde 10–10 (${pct(g1.p_deuce)} de llegar). El ${c.side === 'over' ? 'más' : 'menos'} de ${c.line} pesa ${pct(c.p_model)}.`);
  else if (c.family === 'GAME_POINTS_HCP') bits.push(`El margen de un game es 11−x antes del deuce y exactamente 2 después: ${who} cubre ${c.line > 0 ? '+' : ''}${c.line} en ${pct(c.p_model)} del primer game compilado.`);
  else if (c.family === 'GAME_DEUCE') bits.push(`La probabilidad de deuce sale de la recursión exacta del game (${pct(g1.p_deuce)}): equivale a "más de 20,5 puntos" y a "más de 21,5", que son la misma apuesta.`);
  else bits.push(`${pct(c.p_model)} del modelo contra ${pct(c.p_implied)} del precio.`);
  bits.push('Modelo market-blind por construcción: el precio no entra nunca al cálculo. El reparto saque/recepción es un prior de población (nivel L1: la fuente da puntos por game, no por saque) y así se declara.');
  bits.push('EN SOMBRA: todas las familias de tenis de mesa se anotan y se liquidan para acumular muestra, pero ninguna se publica como pick — contra el mercado todavía no hay prueba.');
  return bits.join(' ');
}
function pickCard(c, row, model) {
  const st = stakeOf(c.p_model, c.odds);
  const fam = FAMILIES[c.family] || { label: c.family, card: 'TOTAL' };
  return {
    ...c, family: fam.card, family_raw: c.family, fam_label: fam.label,
    selection_name: selectionName(c, row), home: row.a, away: row.b, home_team_id: null, away_team_id: null,
    tt_avas: { h: row.photo_a || null, a: row.photo_b || null }, tt_hash: `ttmatch/${row.id}`,
    competition_name: row.tournament_short || row.tournament || null, kickoff: row.start_at || null,
    confidence: c.p_model, model_prob: c.p_model, market_prob: c.p_implied,
    pick_id: `tt_${row.id}_${c.family}_${c.side}_${c.line != null ? c.line : 'x'}${c.game ? '_g' + c.game : ''}`,
    why_es: whyOf(c, row, model), stake_pct: st ? st.pct : null, stake_raw_pct: st ? st.raw : null, stake_capped: !!(st && st.capped), shadow: true,
    signals: { win_prob: c.p_model, edge_pp: c.edge_pp, data_confidence: model.skills.a.cold || model.skills.b.cold ? 'low' : 'med', pick_quality: c.edge_pp >= 6 ? 'strong' : c.edge_pp >= 4 ? 'moderate' : 'marginal', regime: 'monitor' },
  };
}

// ══ 4. EL TABLERO ═══════════════════════════════════════════════════════════════════════════════════════
const rowOf = (fx) => ({ id: fx.id, event_id: fx.event_id, tournament: fx.tournament, tournament_short: fx.tournament_short, tier: fx.tier, tier_label: fx.tier_label, sub: fx.sub, round: fx.round, round_label: fx.round_label, label: fx.label, table: fx.table, start_at: fx.start_at, start_local: fx.start_local, tz_certain: fx.tz_certain, status: fx.status, integrity: fx.integrity, circuit: 'wtt',
  a: fx.a.name, b: fx.b.name, a_id: fx.a.id, b_id: fx.b.id, a_country: fx.a.country, b_country: fx.b.country, a_seed: fx.a.seed, b_seed: fx.b.seed, a_rank: fx.a.rank, b_rank: fx.b.rank, photo_a: fx.a.photo || null, photo_b: fx.b.photo || null,
  result: fx.result ? { score_a: fx.result.score_a, score_b: fx.result.score_b, games: fx.result.games, winner: fx.result.winner, points_a: fx.result.points_a, points_b: fx.result.points_b, duration_min: fx.result.duration_min } : null, score_a: fx.result ? fx.result.score_a : null, score_b: fx.result ? fx.result.score_b : null, winner_id: fx.result ? (fx.result.winner === 'a' ? fx.a.id : fx.b.id) : null });
async function liveState(rows) {
  // 1) la WTT: ids en juego por evento y su match card en vivo (puntos del game en curso)
  const evIds = [...new Set(rows.filter((r) => r.status !== 'final').map((r) => r.event_id))];
  const now = Date.now();
  await Promise.all(evIds.map(async (ev) => {
    try {
      const c = G.live.ids.get(ev);
      if (!c || now - c.at > 30e3) G.live.ids.set(ev, { at: now, ids: await WTT.liveIds(ev) });
    } catch { /* sin vivo */ }
  }));
  for (const r of rows) {
    if (r.status === 'final') continue;
    const ids = (G.live.ids.get(r.event_id) || {}).ids || [];
    const hit = ids.find((x) => String(x.code).replace(/-+$/, '') === String(r.id.split(':')[1]).replace(/-+$/, ''));
    if (!hit) continue;
    let card = G.live.cards.get(r.id);
    if (!card || now - card.at > 8e3) { try { const k = await WTT.liveCard(r.event_id, hit.code); if (k) { card = { at: now, k }; G.live.cards.set(r.id, card); } } catch { /* sin card */ } }
    if (card && card.k) {
      const k = card.k; const swapped = k.h.id && r.a_id && k.h.id !== r.a_id && k.a.id === r.a_id;
      const games = swapped ? k.games.map(([h, a]) => [a, h]) : k.games;
      const cur = games.length ? games[games.length - 1] : null;
      r.live = { state: 'live', source: 'wtt', games_a: swapped ? k.score_a : k.score_h, games_b: swapped ? k.score_h : k.score_a, games, current: cur ? { game: games.length, a: cur[0], b: cur[1] } : null, server: k.server_side ? (swapped ? (k.server_side === 'h' ? 'b' : 'a') : (k.server_side === 'h' ? 'a' : 'b')) : null, best_of: k.best_of || null, timeouts: { a: swapped ? k.a.timeouts : k.h.timeouts, b: swapped ? k.h.timeouts : k.a.timeouts } };
      if (k.best_of) r.format = { ...r.format, best_of: k.best_of, certified: true, source: 'match card en vivo de la WTT' };
      r.status = 'live';
      // el PRIMER SERVIDOR del partido (game 1, 0–0) solo se ve aquí: se guarda para el modelo y para la muestra de saques
      if (cur && games.length === 1 && cur[0] === 0 && cur[1] === 0 && r.live.server) recordFirstServer(r.id, r.live.server);
    } else { r.live = { state: 'live', source: 'wtt', games_a: null, games_b: null, games: [], current: null }; r.status = 'live'; }
  }
  // 2) Flashscore (display) para lo que la WTT no marque
  try {
    const live = await FLASH.feed();
    for (const r of rows) {
      if (r.live || r.status === 'final') continue;
      const hit = FLASH.matchByFamilies(live, (D.playerOf(r.a_id) || {}).family || lastName(r.a), (D.playerOf(r.b_id) || {}).family || lastName(r.b), { startAt: r.start_at });
      if (hit && hit.state === 'live') { r.live = { state: 'live', source: 'flashscore', games_a: hit.swapped ? hit.games_b : hit.games_a, games_b: hit.swapped ? hit.games_a : hit.games_b, games: hit.swapped ? hit.games.map(([a, b]) => [b, a]) : hit.games, current: hit.current ? (hit.swapped ? { game: hit.current.game, a: hit.current.b, b: hit.current.a } : hit.current) : null }; r.status = 'live'; }
    }
  } catch { /* sin feed */ }
}
async function board({ daysAhead = 6, hoursBack = 10 } = {}) {
  const [sl, odds] = await Promise.all([slate(), refreshOdds().catch(() => null)]);
  const now = Date.now();
  const rows = [];
  // los partidos que ya debieron acabar y siguen "programados" en la agenda: se les pide el resultado oficial
  // (hasta 12 por pasada, de 4 en 4) para que el tablero no enseñe como pendiente lo que ya se jugó
  const pend = sl.fixtures.filter((fx) => { const t = Date.parse(fx.start_at || 0); return !fx.result && t < now - 45 * 60e3 && t > now - hoursBack * 3600e3; }).slice(0, 12);
  let pi = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (pi < pend.length) { const fx = pend[pi++]; const res = await fetchResult(fx).catch(() => null); if (res) { fx.result = res; fx.status = 'final'; if (res.best_of) fx.format = { ...fx.format, best_of: res.best_of, certified: true, source: 'match card oficial de la WTT' }; } } }));
  for (const fx of sl.fixtures) {
    const t = Date.parse(fx.start_at || 0);
    if (!(t > now - hoursBack * 3600e3 && t < now + daysAhead * 864e5)) continue;
    const row = rowOf(fx);
    row.format = fx.format;
    const mk = marketFor(fx, odds);
    row.market = { ...mk.consensus, n_books: mk.n_books, books: mk.books, lines_games: mk.lines('GAMES_TOTAL'), lines_points: mk.lines('POINTS_TOTAL'), lines_g1: mk.lines('GAME_POINTS_TOTAL'), has_g1: mk.rows.some((r) => /^GAME_/.test(r.family) && r.game === 1 && !r.live) };
    const model = eventModel(fx);
    row.available = model.available;
    if (model.available) {
      const g1 = C.gameFor(model.match, 1);
      row.gp = { p_a: model.p_a, p_a_elo: model.p_a_elo, p_a_compiled: model.p_a_compiled, p_point: model.p_point, exp_games: r2(model.match.exp_games), exp_points: r2(model.match.exp_points), p_deuce_g1: r3(g1.p_deuce), p_sweep: r3(C.at(model.match.score, `${model.match.format.need}-0`) + C.at(model.match.score, `0-${model.match.format.need}`)), unc_pp: model.unc_pp, cold: !!(model.skills.a.cold || model.skills.b.cold), elo_a: model.skills.a.elo, elo_b: model.skills.b.elo, n_a: model.skills.a.n_matches, n_b: model.skills.b.n_matches, resolution: model.resolution };
      row.candidates = fx.status === 'scheduled' && t > now ? evaluateEdges(model, mk, row) : [];
      const tesis = row.candidates.filter((c) => c.verdict === 'SHADOW_PICK' && !c.benchmark);
      row.shadow_n = tesis.length;
      row.picks = tesis.map((c) => pickCard(c, row, model));
    } else { row.why = model.why; row.unresolved = model.unresolved; }
    rows.push(row);
  }
  await liveState(rows);
  const proximo = (sl.tournaments || []).filter((t) => t.start > addDays(0)).sort((x, y) => x.start.localeCompare(y.start))[0] || null;
  return { rows, tournaments: sl.tournaments, refreshed_at: new Date(sl.at).toISOString(), odds_at: odds ? new Date(odds.at).toISOString() : null, books: odds ? odds.books : null, competitions: odds ? odds.competitions : [], doctrine: DOCTRINE, attribution: ATTRIB, proximo, note: rows.length ? null : 'sin partidos WTT en la ventana (la agenda se abre sola con el siguiente evento)' };
}

// ══ 5. LA FICHA DE UN PARTIDO (Visual OS) ═══════════════════════════════════════════════════════════════
function serviceBraid(a, b, first) {
  const out = [];
  for (let n = 0; n < 20; n++) { const s = R.serverAt(n, first); out.push({ n: n + 1, server: s, p_server_wins: r3(s === 'a' ? a : 1 - b) }); }
  return out;
}
// el proceso IMPLÍCITO del mercado: qué probabilidad de punto está cotizando cada línea (blueprint bloque 9)
function impliedProcess(mk, bestOf, delta) {
  const solve = (f, target, lo = 0.05, hi = 0.95) => { let a = lo, b = hi; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (f(m) < target) a = m; else b = m; } return (a + b) / 2; };
  const cmp = (p) => C.compileMatch(+Math.min(0.98, p + delta).toFixed(3), +Math.max(0.02, p - delta).toFixed(3), { best_of: bestOf });
  const out = {};
  if (mk.consensus.ml_p_a != null) out.from_ml = { p_point: r4(solve((p) => cmp(p).p_a, mk.consensus.ml_p_a)), target: mk.consensus.ml_p_a, note: 'probabilidad de punto que reproduce el consenso del ganador' };
  const lp = mk.lines('POINTS_TOTAL'); if (lp.length) { const line = lp[Math.floor(lp.length / 2)]; out.from_points_total = { p_point_gap: r4(Math.abs(solve((p) => -C.over(cmp(p).points_total, line), -0.5, 0.5, 0.95) - 0.5)), line, note: 'desigualdad de punto |p−0,5| que hace la línea de puntos una moneda al aire' }; }
  const lg = mk.lines('GAMES_TOTAL'); if (lg.length) { const line = lg[Math.floor(lg.length / 2)]; out.from_games_total = { p_point_gap: r4(Math.abs(solve((p) => -C.over(cmp(p).games_total, line), -0.5, 0.5, 0.95) - 0.5)), line, note: 'desigualdad de punto que hace la línea de games una moneda al aire' }; }
  if (out.from_ml && (out.from_points_total || out.from_games_total)) { const g = Math.abs(out.from_ml.p_point - 0.5); const o = out.from_points_total || out.from_games_total; out.gap_pp = r2(100 * (o.p_point_gap - g)); out.reading = out.gap_pp > 1 ? 'la línea de total cotiza un duelo MÁS desigual que el ganador: hay masa de puntos que el ML no identifica' : out.gap_pp < -1 ? 'la línea de total cotiza un duelo MÁS parejo que el ganador (cola de deuce cargada)' : 'ganador y totales cotizan el mismo proceso'; }
  return out;
}
async function matchDetail(fixtureId) {
  const [sl, odds] = await Promise.all([slate(), refreshOdds().catch(() => null)]);
  const fx = sl.fixtures.find((f) => String(f.id) === String(fixtureId));
  if (!fx) return { available: false, why: 'ese partido ya no está en la agenda' };
  if (fx.status !== 'scheduled' && !fx.result) { const res = await fetchResult(fx).catch(() => null); if (res) { fx.result = res; fx.status = 'final'; if (res.best_of) fx.format = { ...fx.format, best_of: res.best_of, certified: true, source: 'match card oficial de la WTT' }; } }
  const row = rowOf(fx);
  await liveState([row]);
  const mk = marketFor(fx, odds);
  const model = eventModel(fx);
  const base = { ...row, format: fx.format, market: { ...mk.consensus, n_books: mk.n_books, books: mk.books, events: mk.events }, market_rows: mk.rows.filter((r) => !r.live).map((r) => ({ book: r.book, family: r.family, side: r.side, line: r.line, odds: r.odds, game: r.game || null, alt: !!r.alt })), doctrine: DOCTRINE, attribution: ATTRIB,
    integrity: { state: fx.integrity, label: R.INTEGRITY_LABEL[fx.integrity], note: R.INTEGRITY_NOTE[fx.integrity] } };
  if (!model.available) return { ...base, available: false, why: model.why, unresolved: model.unresolved };
  const m = model.match, cst = D.build().T.cst;
  const gA = m.game_a, gB = m.game_b, g1 = C.gameFor(m, 1);
  const cands = evaluateEdges(model, mk, row);
  const lev = []; for (let ga = 0; ga < m.format.need; ga++) for (let gb = 0; gb < m.format.need; gb++) lev.push({ ga, gb, p_match: r4(m.match_lattice[ga][gb]), leverage: r4(m.match_lattice[ga + 1][gb] - m.match_lattice[ga][gb + 1]) });
  const pa = model.p_a;
  return {
    ...base, available: true,
    a: { id: model.a.id, name: model.a.name, photo: row.photo_a, country: row.a_country, seed: row.a_seed, rank: model.a.rank, dob: model.a.dob, hand: model.a.hand, grip: model.a.grip, style: model.a.style }, b: { id: model.b.id, name: model.b.name, photo: row.photo_b, country: row.b_country, seed: row.b_seed, rank: model.b.rank, dob: model.b.dob, hand: model.b.hand, grip: model.b.grip, style: model.b.style },
    p_a: pa, p_a_elo: model.p_a_elo, p_a_compiled: model.p_a_compiled, p_a_dist: model.p_a_dist, p_point: model.p_point, p_point_dist: model.p_point_dist, unc_pp: model.unc_pp, first: model.first, scenarios: m.scenarios,
    resolution: { level: 'L1', point_scores: true, serve_split: 'prior de población (δ = ' + cst.serveDelta + ')', serve_delta: cst.serveDelta, samples: { a: model.skills.a.n_matches, b: model.skills.b.n_matches }, points: { a: model.skills.a.n_points, b: model.skills.b.n_points }, format_certified: !!fx.format.certified, tz_certain: fx.tz_certain, note: 'la fuente entrega puntos por game, no por saque: a = p + δ y b = p − δ con δ de población; la mezcla saque/recepción (L2) no está identificada y se dice.' },
    game: { a: model.a_point != null ? model.a_point : m.a, b: m.b, p_a_first_a: r4(gA.p_a), p_a_first_b: r4(gB.p_a), exp_points_first_a: r3(gA.exp_points), exp_points_first_b: r3(gB.exp_points), p_deuce: r4(g1.p_deuce), deuce: { u: r4(gA.deuce.u), v: r4(gA.deuce.v), r: r4(gA.deuce.r), p_a: r4(gA.deuce.p_a), exp_extra: r3(gA.deuce.exp_extra) }, total: trim(g1.total, 0.0005), margin: trim(C.gameMargin(g1), 0.0005), lattice_first_a: gA.lattice.map((rw) => rw.map((v) => r3(v))), lattice_first_b: gB.lattice.map((rw) => rw.map((v) => r3(v))), braid_first_a: serviceBraid(m.a, m.b, 'a'), braid_first_b: serviceBraid(m.a, m.b, 'b'), eps: gA.eps },
    match: { best_of: m.format.best_of, need: m.format.need, exp_games: r3(m.exp_games), exp_points: r3(m.exp_points), score: m.score.map(([k, p]) => [k, r4(p)]), games_total: m.games_total.map(([k, p]) => [k, r4(p)]), games_margin: m.games_margin.map(([k, p]) => [k, r4(p)]), points_total: trim(m.points_total, 0.0003), points_margin: trim(m.points_margin, 0.0003), per_game: m.per_game.map((g) => ({ ...g, p_played: r4(g.p_played), p_a: r4(g.p_a), exp_points: r3(g.exp_points), p_deuce: r4(g.p_deuce) })), lattice: m.match_lattice.map((rw) => rw.map((v) => r4(v))), leverage: lev, eps: m.eps },
    equivalences: C.payoffEquivalences(m).map((e) => ({ ...e, p: e.p != null ? r4(e.p) : null })),
    implied: impliedProcess(mk, m.format.best_of, cst.serveDelta),
    h2h: D.h2h(model.a.id, model.b.id),
    profiles: { a: playerProfile(model.a.id, { brief: true }), b: playerProfile(model.b.id, { brief: true }) },
    candidates: cands,
    picks: cands.filter((c) => c.verdict === 'SHADOW_PICK' && !c.benchmark).map((c) => pickCard(c, row, model)),
    format_prism: [5, 7].map((bo) => { const x = C.compileMatch(m.a, m.b, { best_of: bo }); return { label: `BO${bo}`, best_of: bo, p_a: r4(x.p_a), exp_games: r3(x.exp_games), exp_points: r3(x.exp_points), p_sweep: r4(C.at(x.score, `${x.format.need}-0`) + C.at(x.score, `0-${x.format.need}`)), current: bo === m.format.best_of }; }),
    model_version: model.model_version,
  };
}

// ══ 6. LA SOMBRA ════════════════════════════════════════════════════════════════════════════════════════
const CLOSE_BUCKETS = [60, 30, 10, 5, 1];
function snapshotCloses(rows) {
  const st = rd('closes.json') || { closes: {} };
  const now = Date.now(); let dirty = false;
  for (const r of rows) {
    const t = Date.parse(r.start_at || 0);
    if (!(t > now - 3600e3) || !r.available) continue;
    const minsTo = (t - now) / 60e3;
    const c = st.closes[r.id] = st.closes[r.id] || { a: r.a, b: r.b, start_at: r.start_at, series: {} };
    const rows2 = (r._mk_rows || []).map((x) => ({ book: x.book, family: x.family, side: x.side, line: x.line, odds: x.odds, game: x.game || null }));
    c.at = new Date().toISOString(); c.rows = rows2;
    for (const bkt of CLOSE_BUCKETS) if (minsTo <= bkt && !c.series[bkt]) { c.series[bkt] = { at: c.at, rows: rows2 }; }
    dirty = true;
  }
  for (const [id, c] of Object.entries(st.closes)) if (Date.parse(c.start_at) < now - 30 * 864e5) { delete st.closes[id]; dirty = true; }
  if (dirty) wr('closes.json', st);
}
async function recordShadow() {
  const b = await board({ daysAhead: 6 });
  const odds = G.odds;
  const st = rd('picks.json') || { picks: [] };
  const have = new Set(st.picks.map((p) => p.key));
  let n = 0;
  const forClose = [];
  for (const row of b.rows) {
    if (!row.available) continue;
    const start = Date.parse(row.start_at);
    const fx = G.slate.fixtures.find((f) => String(f.id) === String(row.id));
    const mk = fx ? marketFor(fx, odds) : { rows: [] };
    forClose.push({ ...row, _mk_rows: mk.rows.filter((r) => !r.live) });
    if (!(start > Date.now() && start - Date.now() < 6 * 864e5)) continue;
    for (const c of row.candidates || []) {
      if (c.verdict !== 'SHADOW_PICK') continue;
      const key = `${row.id}|${c.family}|${c.side}|${c.line}|${c.game || ''}`;
      if (have.has(key)) continue;
      have.add(key); n++;
      st.picks.push({ key, event_id: row.id, tournament: row.tournament_short, tournament_id: row.event_id, tier: row.tier, sub: row.sub, round: row.round, format: row.format, a: row.a, b: row.b, a_id: row.a_id, b_id: row.b_id,
        family: c.family, side: c.side, line: c.line, game: c.game || null, odds: c.odds, book: c.book, p_model: c.p_model, p_implied: c.p_implied, edge_pp: c.edge_pp, unc_pp: c.unc_pp, benchmark: !!c.benchmark,
        start_at: row.start_at, status: 'OPEN', created_at: new Date().toISOString(), regime: 'shadow', era: process.env.GP_PICKS_ERA || 'tt-v1-2026-09-08', circuit: 'wtt', cold: !!(row.gp && row.gp.cold) || undefined, format_certified: !!(row.format && row.format.certified) });
    }
  }
  snapshotCloses(forClose);
  if (n) wr('picks.json', st);
  return { recorded: n, total: st.picks.length };
}
function settleOne(p, res) {
  const sa = res.score_a, sb = res.score_b, games = res.games || [];
  const aWon = res.winner === 'a';
  const pa = res.points_a, pb = res.points_b;
  const ou = (val, line, side) => (side === 'over' ? (val > line ? 1 : val === line ? null : 0) : (val < line ? 1 : val === line ? null : 0));
  const hcp = (margin, line, side) => { const v = (side === 'a' ? margin : -margin) + line; return v > 0 ? 1 : v === 0 ? null : 0; };
  const g1 = games[0];
  switch (p.family) {
    case 'ML': return p.side === 'a' ? (aWon ? 1 : 0) : (aWon ? 0 : 1);
    case 'GAMES_TOTAL': return ou(sa + sb, p.line, p.side);
    case 'GAMES_HCP': return hcp(sa - sb, p.line, p.side);
    case 'POINTS_TOTAL': return ou(pa + pb, p.line, p.side);
    case 'POINTS_HCP': return hcp(pa - pb, p.line, p.side);
    case 'CORRECT_SCORE': return `${sa}-${sb}` === String(p.side) ? 1 : 0;
    case 'GAME_ML': return g1 ? (p.side === 'a' ? (g1[0] > g1[1] ? 1 : 0) : (g1[1] > g1[0] ? 1 : 0)) : undefined;
    case 'GAME_POINTS_TOTAL': return g1 ? ou(g1[0] + g1[1], p.line, p.side) : undefined;
    case 'GAME_POINTS_HCP': return g1 ? hcp(g1[0] - g1[1], p.line, p.side) : undefined;
    case 'GAME_DEUCE': return g1 ? ((g1[0] + g1[1] >= 22) === (p.side === 'yes') ? 1 : 0) : undefined;
    default: return undefined;
  }
}
async function settleShadow({ voidDays = 10 } = {}) {
  const st = rd('picks.json') || { picks: [] };
  const open = st.picks.filter((p) => p.status === 'OPEN' && Date.parse(p.start_at) < Date.now() - 40 * 60e3);
  const diag = { vencidas: open.length, ok: 0, sin_resultado: 0, void_tiempo: 0, no_final: 0, sin_fuente: 0 };
  if (!open.length) return { settled: 0, diag };
  const sl = await slate().catch(() => G.slate);
  const closes = rd('closes.json') || { closes: {} };
  let settled = 0;
  for (const p of open) {
    try {
      if (Date.parse(p.start_at) < Date.now() - voidDays * 864e5) { p.status = 'SETTLED'; p.result = 'VOID'; p.units = 0; p.void_reason = `sin resultado oficial en ${voidDays} días`; p.settled_at = new Date().toISOString(); settled++; diag.void_tiempo++; continue; }
      const fx = (sl && sl.fixtures || []).find((f) => String(f.id) === String(p.event_id)) || { id: p.event_id, event_id: p.tournament_id, code: String(p.event_id).split(':')[1], a: { id: p.a_id }, b: { id: p.b_id }, tournament: p.tournament };
      const res = fx.result || await fetchResult(fx);
      if (!res) { diag.no_final++; continue; }
      const win = settleOne(p, res);
      if (win === undefined) { diag.sin_fuente++; continue; }
      p.status = 'SETTLED'; p.result = win == null ? 'PUSH' : win ? 'WIN' : 'LOSS';
      p.final = { score_a: res.score_a, score_b: res.score_b, games: res.games, points_a: res.points_a, points_b: res.points_b, winner: res.winner, source: 'wtt' };
      p.units = win == null ? 0 : win ? +(p.odds - 1).toFixed(3) : -1;
      const cl = closes.closes[p.event_id];
      if (cl) {
        const same = (cl.rows || []).filter((x) => x.family === p.family && x.side === p.side && (x.game || null) === (p.game || null) && (p.line == null || x.line === p.line));
        const best = same.reduce((b2, x) => (!b2 || x.odds > b2.odds ? x : b2), null);
        const pin = same.find((x) => x.book === 'pinnacle'); const own = same.find((x) => x.book === p.book);
        if (best) { p.close_price = best.odds; p.clv_pct = +((p.odds / best.odds - 1) * 100).toFixed(2); p.close_source = best.book; }
        if (pin) { p.close_pin = pin.odds; p.clv_pin_pct = +((p.odds / pin.odds - 1) * 100).toFixed(2); }
        if (own) { p.close_own = own.odds; p.clv_own_pct = +((p.odds / own.odds - 1) * 100).toFixed(2); }
        if (!best) p.close_missing = 'línea no cotizada al cierre';
        p.close_series = Object.fromEntries(Object.entries(cl.series || {}).map(([k, s]) => { const x = (s.rows || []).filter((y) => y.family === p.family && y.side === p.side && (y.game || null) === (p.game || null) && (p.line == null || y.line === p.line)).reduce((b2, y) => (!b2 || y.odds > b2.odds ? y : b2), null); return [k, x ? x.odds : null]; }));
      }
      p.settled_at = new Date().toISOString(); settled++; diag.ok++;
    } catch (e) { diag.error = String(e.message || e).slice(0, 120); }
  }
  if (settled) wr('picks.json', st);
  wr('settle-diag.json', { at: new Date().toISOString(), diag, settled });
  return { settled, diag };
}
function track({ limit = 40 } = {}) {
  const st = rd('picks.json') || { picks: [] };
  const settleDiag = rd('settle-diag.json') || null;
  const mine = st.picks;
  const done = mine.filter((p) => p.status === 'SETTLED' && p.result !== 'VOID');
  const w = done.filter((p) => p.result === 'WIN').length, l = done.filter((p) => p.result === 'LOSS').length;
  const units = done.reduce((s, p) => s + (p.units || 0), 0);
  const clv = done.filter((p) => p.clv_pct != null);
  const agg = (keyOf, extra) => { const o = {}; for (const p of done) { const k = keyOf(p); if (k == null) continue; const F = o[k] = o[k] || { n: 0, w: 0, units: 0, clv: [], clvOwn: [], ...(extra ? extra(p) : {}) }; F.n++; if (p.result === 'WIN') F.w++; F.units += p.units || 0; if (p.clv_pct != null) F.clv.push(p.clv_pct); if (p.clv_own_pct != null) F.clvOwn.push(p.clv_own_pct); } return o; };
  const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return r2(Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1))); };
  const mean = (a) => (a.length ? r2(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const fam = (o) => Object.fromEntries(Object.entries(o).map(([k, F]) => [k, { ...Object.fromEntries(Object.entries(F).filter(([kk]) => !['n', 'w', 'units', 'clv', 'clvOwn'].includes(kk))), n: F.n, hit_pct: F.n ? r2(100 * F.w / F.n) : null, units: r2(F.units), roi_pct: F.n ? r2(100 * F.units / F.n) : null, clv_avg_pct: mean(F.clv), clv_n: F.clv.length, clv_sd: sd(F.clv), clv_own_avg_pct: mean(F.clvOwn), note: k === 'ML' ? 'familia de referencia (benchmark), jamás pick' : undefined }]));
  return {
    regime: 'shadow', doctrine: DOCTRINE,
    open: mine.filter((p) => p.status === 'OPEN').length, open_list: mine.filter((p) => p.status === 'OPEN').slice(-Math.max(30, limit)).reverse(),
    settled: done.length, w, l, push: done.filter((p) => p.result === 'PUSH').length, voided: mine.filter((p) => p.result === 'VOID').length,
    units: r2(units), roi_pct: done.length ? r2(100 * units / done.length) : null,
    clv_avg_pct: clv.length ? r2(clv.reduce((s, p) => s + p.clv_pct, 0) / clv.length) : null, clv_n: clv.length,
    by_family: fam(agg((p) => p.family)), by_family_book: fam(agg((p) => p.family + ' · ' + (p.book || 'sin_casa'), (p) => ({ family: p.family, book: p.book || 'sin_casa' }))), by_tier: fam(agg((p) => p.tier || 'otro')), by_sub: fam(agg((p) => p.sub || '—')),
    recent: done.slice(-limit).reverse(),
    reading: done.length < 40 ? `con ${done.length} liquidadas TODO es ruido: esta pantalla acumula el registro, no se lee todavía.` : 'la vara es el CLV por familia y casa, no el ROI.',
    settle_diag: settleDiag,
  };
}

// ══ 7. CATÁLOGO ═════════════════════════════════════════════════════════════════════════════════════════
function playersDirectory({ q = '', limit = 80, minMatches = 10, gender = null } = {}) {
  const d = D.build(); const T = d.T;
  const nq = norm(q);
  const rows = [];
  const cutoff = +new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  for (const [id, prof] of T.prof) {
    const p = d.players[id]; if (!p) continue;
    if (gender && p.gender !== gender) continue;
    if (nq && !norm(p.name + ' ' + p.family + ' ' + p.given).includes(nq)) continue;
    if (prof.w + prof.l < minMatches) continue;
    const sk = D.skillOf(id);
    rows.push({ id, name: p.name, family: p.family, country: p.country, gender: p.gender, photo: p.photo || null, rank: p.rank || null, rank_prev: p.rank_prev || null, hand: p.hand || null, grip: p.grip || null, style: p.style || null,
      elo: sk.elo, point_share: sk.point_share, wl: prof.w + '-' + prof.l, games_pct: prof.gw + prof.gl ? r3(prof.gw / (prof.gw + prof.gl)) : null, point_pct: sk.point_pct, deuce_rate: sk.deuce_rate, n: prof.w + prof.l, cold: sk.cold, last: prof.lastDate, inactive: prof.lastDate < cutoff, titles: prof.titles });
  }
  rows.sort((x, y) => y.elo - x.elo);
  return { rows: rows.slice(0, limit), total: rows.length, attribution: ATTRIB, freshness: d.meta.last_match_date };
}
function rankingBoard({ gender = 'M' } = {}) {
  const dir = playersDirectory({ limit: 400, minMatches: 15, gender });
  const snap = rd(`rank-snap-${gender}.json`) || {};
  const prev = snap.order || [];
  const rows = dir.rows.filter((r) => !r.inactive).slice(0, 64).map((r, i) => { const was = prev.indexOf(r.id); return { pos: i + 1, ...r, move: was >= 0 ? was - i : null, vs_wtt: r.rank ? r.rank - (i + 1) : null }; });
  return { rows, gender, snapshot_at: snap.at || null, attribution: ATTRIB, freshness: dir.freshness, note: 'ranking por Elo propio de GP (todos los partidos de mayores con puntos por game) — no es el ranking WTT, que aparece al lado. La flecha compara contra la foto semanal anterior.' };
}
function snapshotRanks() {
  let changed = false;
  for (const g of ['M', 'W']) {
    const snap = rd(`rank-snap-${g}.json`) || {};
    if (snap.at && Date.now() - Date.parse(snap.at) < 6.5 * 864e5) continue;
    const dir = playersDirectory({ limit: 400, minMatches: 15, gender: g });
    wr(`rank-snap-${g}.json`, { at: new Date().toISOString(), order: dir.rows.filter((r) => !r.inactive).slice(0, 64).map((r) => r.id) }); changed = true;
  }
  return { changed };
}
function playerProfile(id, { brief = false } = {}) {
  const d = D.build(); const T = d.T;
  const p = d.players[String(id)], prof = T.prof.get(String(id));
  if (!p) return { available: false, why: 'jugador fuera de la base propia' };
  const sk = D.skillOf(id);
  const age = p.dob ? Math.floor((Date.now() - Date.parse(p.dob)) / (365.25 * 864e5)) : null;
  const recent = prof ? prof.recent.slice().reverse().map((m) => ({ date: m.d, dated: !!m.dated, opp: (d.players[String(m.opp)] || {}).name || m.opp, opp_id: String(m.opp), opp_elo: Math.round(T.elo.get(String(m.opp)) || 1500), won: m.won, score: m.score, games: m.games, tourney: shortName(m.t), tier: m.tier, round: m.round, bo: m.bo })) : [];
  const byYear = prof ? Object.entries(prof.byYear).sort().map(([y, v]) => ({ year: +y, w: v.w, l: v.l })) : [];
  const out = { available: true, id: String(id), name: p.name, family: p.family, given: p.given, country: p.country, gender: p.gender, photo: p.photo || null, rank: p.rank || null, rank_prev: p.rank_prev || null, rank_pts: p.rank_pts || null, dob: p.dob || null, age, hand: p.hand || null, grip: p.grip || null, style: p.style || null,
    elo: sk.elo, point_share: sk.point_share, cold: sk.cold, stale: sk.stale, n_matches: sk.n_matches, n_points: sk.n_points, wl: prof ? { w: prof.w, l: prof.l } : { w: 0, l: 0 }, games: prof ? { won: prof.gw, lost: prof.gl } : null, points: prof ? { won: prof.pw, lost: prof.pl, pct: sk.point_pct } : null, deuce_rate: sk.deuce_rate, titles: prof ? prof.titles : 0, tourneys: prof ? prof.tourneys.size : 0,
    recent: brief ? recent.slice(0, 8) : recent, by_year: byYear, last_date: prof ? prof.lastDate : null, first_date: prof ? prof.firstDate : null,
    inactive_note: sk.stale ? 'sin partidos recientes en la base: la incertidumbre del rating es alta' : null, attribution: ATTRIB, freshness: d.meta.last_match_date, level: 'L1 — puntos por game de cada partido; sin reparto saque/recepción' };
  if (!brief) out.solo = soloProfile(sk);
  return out;
}
// el jugador "contra la población": game y partido frente a un rival medio (θ = 0) y frente a un top-10
function soloProfile(sk) {
  const d = D.build(); const cst = d.T.cst;
  const vs = (thOpp, label) => { const p = 0.5 + cst.pointScaleDist * (D.sig(sk.theta - thOpp) - 0.5); const a = +Math.min(0.98, p + cst.serveDelta).toFixed(3), b = +Math.max(0.02, p - cst.serveDelta).toFixed(3); const m = C.compileMatch(a, b, { best_of: 5 }); const g = C.gameFor(m, 1); return { label, p_point: r4(p), p_game: r4(g.p_a), p_match_bo5: r4(m.p_a), p_deuce: r4(g.p_deuce), exp_points_game: r3(g.exp_points) }; };
  // solo jugadores activos con muestra: el "top" es de verdad el top
  const active = [...d.T.theta.entries()].filter(([id]) => (d.T.nMatch.get(id) || 0) >= 20 && (d.T.lastDate.get(id) || 0) >= todayInt() - 10000).map(([, th]) => th).sort((x, y) => y - x);
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  return [vs(avg(active.slice(0, 100)), 'rival del top-100 GP'), vs(avg(active.slice(0, 10)), 'rival del top-10 GP')];
}
function h2h(idA, idB) { return D.h2h(idA, idB); }

// ══ 8. TORNEOS ══════════════════════════════════════════════════════════════════════════════════════════
async function tournamentsList() {
  const ev = await WTT.events();
  const lo = addDays(-14), hi = addDays(45);
  const sl = G.slate || (await slate().catch(() => null));
  const rows = ev.filter((e) => e.start && e.end && e.end >= lo && e.start <= hi).sort((x, y) => x.start.localeCompare(y.start)).map((e) => {
    const t = sl && sl.tournaments.find((x) => x.id === e.id);
    return { id: e.id, name: e.name, short: shortName(e.name), tier: R.tierOf(e.name), tier_label: R.TIER_LABEL[R.tierOf(e.name)], tier_name: e.tier_name, youth: e.youth, start: e.start, end: e.end, city: e.city, country: e.country, venue: e.venue, logo: e.logo, bg: e.bg, color: e.color, fixtures: t ? t.fixtures : null, results: t ? t.results : null, state: e.start > addDays(0) ? 'upcoming' : e.end >= addDays(0) ? 'live' : 'done', integrity: R.INTEGRITY.VERIFIED_SCOPE, circuit: 'wtt', modeled: !e.youth };
  });
  return { rows, attribution: ATTRIB };
}
async function tournamentBoard(id) {
  const ev = (await WTT.events()).find((e) => e.id === String(id));
  if (!ev) return { available: false, why: 'evento no encontrado' };
  const units = await WTT.schedule(ev.id).catch(() => []);
  const odds = await refreshOdds().catch(() => null);
  const st = resultsStore();
  const fixtures = units.filter((u) => u.sub === 'MS' || u.sub === 'WS').map((u) => { const fx = normFixture(u, ev); const res = st.by[fx.id]; if (res) { fx.result = res; fx.status = 'final'; } return fx; });
  const bySub = {};
  for (const fx of fixtures) {
    const row = rowOf(fx); row.format = fx.format;
    if (fx.a.id && fx.b.id && fx.status !== 'final') { const m = eventModel(fx); row.available = m.available; if (m.available) row.gp = { p_a: m.p_a, exp_games: r2(m.match.exp_games), exp_points: r2(m.match.exp_points) }; else row.why = m.why; const mk = marketFor(fx, odds); row.market = { ml_p_a: mk.consensus.ml_p_a, n_books: mk.n_books }; }
    const S = bySub[fx.sub] = bySub[fx.sub] || { sub: fx.sub, name: fx.sub_name, rounds: {} };
    const rk = fx.round || 'OTR'; (S.rounds[rk] = S.rounds[rk] || []).push(row);
  }
  const subs = Object.values(bySub).map((S) => ({ sub: S.sub, name: S.name, rounds: Object.entries(S.rounds).sort((x, y) => R.ROUND_ORDER.indexOf(x[0]) - R.ROUND_ORDER.indexOf(y[0])).map(([round, rows]) => ({ round, label: R.ROUND_LABEL[round] || round, fixtures: rows.sort((x, y) => Date.parse(x.start_at || 0) - Date.parse(y.start_at || 0)) })), title: titleProbs(fixtures.filter((f) => f.sub === S.sub)) }));
  const fin = fixtures.filter((f) => f.status === 'final').length;
  return { available: true, id: ev.id, name: ev.name, short: shortName(ev.name), tier: R.tierOf(ev.name), tier_label: R.TIER_LABEL[R.tierOf(ev.name)], start: ev.start, end: ev.end, city: ev.city, country: ev.country, venue: ev.venue, logo: ev.logo, bg: ev.bg, color: ev.color, tz: offsetFor(ev), fixtures: fixtures.length, results: fin, subs, integrity: { state: R.INTEGRITY.VERIFIED_SCOPE, label: R.INTEGRITY_LABEL.VERIFIED_SCOPE }, attribution: ATTRIB, doctrine: DOCTRINE };
}
// probabilidad de título por subevento desde el cuadro conocido: los cruces jugados fijan al ganador; los
// pendientes reparten con el modelo; las rondas sin publicar se estiman emparejando por número de partido
function titleProbs(fixtures) {
  const ko = fixtures.filter((f) => ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'].includes(f.round));
  if (!ko.length) return null;
  const byRound = {}; for (const f of ko) (byRound[f.round] = byRound[f.round] || []).push(f);
  const order = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'].filter((r) => byRound[r]);
  const matchNo = (f) => { const m = String(f.code || '').match(/(\d{4})\d{2}-*$/); return m ? +m[1] : 0; };
  let slots = null;
  for (let ri = 0; ri < order.length; ri++) {
    const rows = byRound[order[ri]].slice().sort((x, y) => matchNo(x) - matchNo(y));
    const next = [];
    for (let i = 0; i < rows.length; i++) {
      const f = rows[i];
      let candA = f.a.id ? new Map([[f.a.id, 1]]) : (slots ? slots[2 * i] : null);
      let candB = f.b.id ? new Map([[f.b.id, 1]]) : (slots ? slots[2 * i + 1] : null);
      const out = new Map();
      if (f.result && f.result.winner) { out.set(f.result.winner === 'a' ? f.a.id : f.b.id, 1); next.push(out); continue; }
      if (!candA || !candB) { next.push(new Map()); continue; }
      for (const [pa, wa] of candA) for (const [pb, wb] of candB) {
        if (!(wa > 1e-4 && wb > 1e-4)) continue;
        let p = 0.5;
        try { const qa = D.playerOf(pa), qb = D.playerOf(pb); if (qa && qb && qa.n > 0 && qb.n > 0) p = D.matchModel(pa, pb, { best_of: f.format.best_of }).p_a; } catch { /* sin modelo */ }
        out.set(pa, (out.get(pa) || 0) + wa * wb * p); out.set(pb, (out.get(pb) || 0) + wa * wb * (1 - p));
      }
      next.push(out);
    }
    slots = next;
  }
  // si la última ronda publicada no es la final, se sigue emparejando por orden hasta quedar uno
  while (slots && slots.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < slots.length; i += 2) {
      const out = new Map();
      for (const [pa, wa] of slots[i]) for (const [pb, wb] of slots[i + 1]) { if (!(wa > 1e-4 && wb > 1e-4)) continue; let p = 0.5; try { const qa = D.playerOf(pa), qb = D.playerOf(pb); if (qa && qb && qa.n > 0 && qb.n > 0) p = D.matchModel(pa, pb, { best_of: 7 }).p_a; } catch { /* sin modelo */ } out.set(pa, (out.get(pa) || 0) + wa * wb * p); out.set(pb, (out.get(pb) || 0) + wa * wb * (1 - p)); }
      next.push(out);
    }
    if (slots.length % 2 === 1) next.push(slots[slots.length - 1]);
    slots = next;
  }
  const final = slots && slots[0];
  if (!final) return null;
  const d = D.build();
  return { estimated: order[order.length - 1] !== 'F', rows: [...final.entries()].filter(([, p]) => p > 0.002).sort((x, y) => y[1] - x[1]).slice(0, 16).map(([id, p]) => ({ id, name: (d.players[id] || {}).name || id, photo: (d.players[id] || {}).photo || null, country: (d.players[id] || {}).country || null, p: r3(p) })) };
}

// ══ 9. SIMULADOR · AGENDA · VIVO ═══════════════════════════════════════════════════════════════════════
function simMatch(refA, refB, { best_of = 5, first = null } = {}) {
  const A = D.resolvePlayer(refA), B = D.resolvePlayer(refB);
  if (!A || !B) return { available: false, why: `no encuentro a ${!A ? refA : refB} en la base propia` };
  if (A.id === B.id) return { available: false, why: 'los dos nombres resuelven al mismo jugador' };
  const bo = [5, 7].includes(+best_of) ? +best_of : 5;
  const model = D.matchModel(A.id, B.id, { best_of: bo, first });
  const m = model.match, gA = m.game_a, gB = m.game_b, g1 = C.gameFor(m, 1);
  return {
    available: true, format: { kind: 'games', best_of: bo, need: m.format.need }, first: model.first,
    a: { id: A.id, name: A.name, country: A.country, photo: A.photo || null, rank: A.rank || null }, b: { id: B.id, name: B.name, country: B.country, photo: B.photo || null, rank: B.rank || null },
    p_a: model.p_a, p_a_elo: model.p_a_elo, p_a_compiled: model.p_a_compiled, p_point: model.p_point, unc_pp: model.unc_pp, scenarios: m.scenarios,
    game: { p_a_first_a: r4(gA.p_a), p_a_first_b: r4(gB.p_a), p_deuce: r4(g1.p_deuce), exp_points: r3(g1.exp_points), deuce: { p_a: r4(gA.deuce.p_a), exp_extra: r3(gA.deuce.exp_extra) }, total: trim(g1.total, 0.0005), margin: trim(C.gameMargin(g1), 0.0005), lattice_first_a: gA.lattice.map((rw) => rw.map((v) => r3(v))), braid_first_a: serviceBraid(m.a, m.b, 'a') },
    match: { exp_games: r3(m.exp_games), exp_points: r3(m.exp_points), score: m.score.map(([k, p]) => [k, r4(p)]), games_total: m.games_total.map(([k, p]) => [k, r4(p)]), games_margin: m.games_margin.map(([k, p]) => [k, r4(p)]), points_total: trim(m.points_total, 0.0003), points_margin: trim(m.points_margin, 0.0003), per_game: m.per_game.map((g) => ({ ...g, p_played: r4(g.p_played), p_a: r4(g.p_a), exp_points: r3(g.exp_points), p_deuce: r4(g.p_deuce) })), lattice: m.match_lattice.map((rw) => rw.map((v) => r4(v))) },
    skills: { a: model.skills.a, b: model.skills.b },
    format_prism: [5, 7].map((b2) => { const x = C.compileMatch(m.a, m.b, { best_of: b2 }); return { label: `BO${b2}`, best_of: b2, p_a: r4(x.p_a), exp_games: r3(x.exp_games), exp_points: r3(x.exp_points), current: b2 === bo }; }),
    equivalences: C.payoffEquivalences(m).map((e) => ({ ...e, p: e.p != null ? r4(e.p) : null })),
    h2h: D.h2h(A.id, B.id),
    note: 'compilado punto → game → partido con las reglas exactas: ganador, marcador, games y puntos salen del mismo estado. Estimaciones de un modelo estadístico — no consejo financiero.', attribution: ATTRIB,
  };
}
async function agenda() {
  const sl = await slate();
  const now = Date.now();
  const rows = sl.fixtures.filter((f) => Math.abs(Date.parse(f.start_at || 0) - now) < 30 * 3600e3).map(rowOf);
  await liveState(rows);
  return { rows, at: new Date(sl.at).toISOString(), attribution: ATTRIB };
}
// probabilidad EN VIVO desde el estado (games, puntos del game en curso, servidor del punto)
function liveProb(fixtureId, { ga = 0, gb = 0, i = 0, j = 0, server = null } = {}) {
  const sl = G.slate; if (!sl) return null;
  const fx = sl.fixtures.find((f) => String(f.id) === String(fixtureId)); if (!fx) return null;
  const model = eventModel(fx); if (!model.available) return null;
  // servidor del punto actual → primer servidor del game (por el bloque en el que estamos)
  let first = null;
  if (server === 'a' || server === 'b') { const n = i + j; const blkFirst = R.serverAt(n, 'a') === 'a' ? 'a' : 'b'; first = blkFirst === 'a' ? server : R.other(server); }
  const p = C.liveProb(model.a_dist || model.match.a, model.match.b, { best_of: fx.format.best_of, ga, gb, i, j, first_this_game: first });
  return { p_a: r4(p), from: { ga, gb, i, j, server }, p_a_prematch: model.p_a, p_a_prematch_dist: model.p_a_dist };
}

// ══ 10. EL MOTOR (ficha) ════════════════════════════════════════════════════════════════════════════════
function modelCard() {
  const d = D.build(); const H = d.priors.holdout || null; const st = C.selfTest();
  return {
    name: 'Modelo de tenis de mesa GP', version: (d.priors || {}).model_version || 'tt-l1-0', family: 'modelo propio de GP — composición reservada', doctrine: DOCTRINE,
    base: { matches: d.rows_total || d.rows.length, players: Object.keys(d.players).length, tourneys: Object.keys(d.tourneys).length, window: d.meta.years, freshness: d.meta.last_match_date, dated: d.meta.dated, sources: ['WTT (worldtabletennis.com): eventos, agenda, match cards oficiales, retratos', 'ITTF: ranking semanal e historial de partidos por jugador con los puntos de cada game'], level: 'L1 — puntos por game de cada partido: rating de punto identificado; el reparto saque/recepción (L2) es un prior de población (blueprint §5.2)' },
    mechanism: { atom: 'un punto: P(A lo gana) depende de quién sirve (a si sirve A, b si sirve B); saque en bloques de dos y alternancia punto a punto desde 10–10', game: 'recursión exacta sobre el marcador con la cola de deuce analítica: u = ab, v = (1−a)(1−b), P(A | deuce) = u/(u+v), E[puntos extra] = 2/(u+v)', match: 'convolución de games al mejor de 5 o 7 con primer servidor alterno; por cada estado se llevan la distribución de puntos totales y la de margen', markets: Object.keys(FAMILIES), synthetic_check: st.ok ? 'la tabla sintética del blueprint (12.3) se reproduce a 6 decimales' : 'FALLA la tabla sintética' },
    validation: H ? { ...H, development: d.priors.development || null } : { status: 'pendiente', note: 'la validación walk-forward (Elo de partido vs compilador desde el rating de punto vs mezcla, con holdout intocable) se ejecuta con scripts/tt-fit.js y se congela en model-priors.json.' },
    families: Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, v.benchmark ? 'referencia (benchmark), jamás pick' : v.display_only ? 'solo display' : 'sombra'])),
    integrity: Object.entries(R.INTEGRITY_NOTE).map(([k, v]) => ({ state: k, label: R.INTEGRITY_LABEL[k], note: v })),
    known_gaps: ['saque/recepción no identificados: la fuente da puntos por game, no por saque (δ de población)', 'primer servidor del partido desconocido antes de empezar: se promedian los dos sorteos y se publican ambos', 'formatos de ronda no certificados hasta que la WTT publica el match card (se usa la frecuencia histórica por nivel × ronda y se dice)', 'ligas privadas de apuestas (Liga Pro, Setka Cup, TT Cup…) sin cuerpo oficial: solo display, jamás modelo', 'las fechas anteriores a 2021 son por año (la WTT no publica fecha de evento): el orden cronológico fino empieza en 2021'],
    disclaimer: 'estimaciones de un modelo estadístico, no consejo financiero.',
  };
}
async function modelSnapshot() {
  const d = D.build();
  const cb = G.odds ? G.odds.events.filter((e) => e.book === 'cloudbet' && (e.rows || []).length).slice(0, 2).map((e) => ({ a: e.a, b: e.b, start_at: e.start_at, competition: e.competition, raw_keys: e.raw_keys, rows: (e.rows || []).slice(0, 20).map((r) => ({ family: r.family, side: r.side, line: r.line, odds: r.odds, game: r.game, market_key: r.market_key, params: r.params })) })) : null;
  return { base: { rows: d.rows_total || d.rows.length, players: Object.keys(d.players).length, freshness: d.meta.last_match_date, built_at: d.meta.built_at, priors: d.priors.model_version }, slate: G.slate ? { at: new Date(G.slate.at).toISOString(), fixtures: G.slate.fixtures.length, tournaments: G.slate.tournaments.map((t) => `${t.short} (${t.fixtures}/${t.results})`) } : null, odds: G.odds ? { at: new Date(G.odds.at).toISOString(), events: G.odds.events.length, books: G.odds.books, available: G.odds.available, cloudbet_keys: G.odds.cloudbet_keys, competitions: G.odds.competitions.slice(0, 12), cloudbet_sample: cb } : null, tz: tzStore().by, results_cached: Object.keys(resultsStore().by).length, track: track({ limit: 5 }), disk: DISK_DIR };
}
function competitionMap() {
  const comps = (G.odds && G.odds.competitions) || [];
  const states = {};
  for (const c of comps) { const s = states[c.integrity] = states[c.integrity] || { state: c.integrity, label: R.INTEGRITY_LABEL[c.integrity], note: R.INTEGRITY_NOTE[c.integrity], competitions: [], events: 0 }; s.competitions.push({ name: c.name, n: c.n, books: c.books, lines: c.lines }); s.events += c.n; }
  return { at: G.odds ? new Date(G.odds.at).toISOString() : null, states: Object.values(states).sort((x, y) => Object.keys(R.INTEGRITY).indexOf(x.state) - Object.keys(R.INTEGRITY).indexOf(y.state)), doctrine: 'solo VERIFIED_SCOPE entra al modelo y a la sombra; el resto se enseña con su aviso.' };
}

module.exports = { DISK_DIR, DOCTRINE, ATTRIB, FAMILIES, slate, refreshOdds, marketFor, eventModel, evaluateEdges, board, matchDetail, recordShadow, settleShadow, track, playersDirectory, rankingBoard, snapshotRanks, playerProfile, h2h, tournamentsList, tournamentBoard, simMatch, agenda, liveProb, modelCard, modelSnapshot, competitionMap, fetchResult, nameIs };
