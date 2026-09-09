// darts-engine/store.js — EL TERMINAL DE DARDOS (blueprint 8.0): agenda, mercado, sombra y catálogo
//
// Mecánica de la casa, calcada de tenis/NFL/amfoot: modelo market-blind POR CONSTRUCCIÓN (ninguna cuota
// entra a la probabilidad), TODAS las familias en SOMBRA, registro privado con CLV contra el cierre
// capturado, y catálogo servido solo con EVIDENCIA (caja negra: nada de constantes ni fórmulas).
//
// Fuentes: la API pública de la PDC (agenda, formato por ronda, resultados con legs), Darts Orakel (media,
// 180s y dobles por jugador en ventanas de fechas), Flashscore (legs en vivo, display) y cuatro casas/venues
// (Pinnacle referencia, Bovada 180s, Polymarket, Cloudbet ejecutable) — ver data/darts/RIGHTS.md.
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('./data');
const K = require('./kernel');
const C = require('./compiler');
const R = require('./rules');
const PDC = require('../data-providers/darts/pdc');
const BOOKS = require('../data-providers/darts/books');
const FLASH = require('../data-providers/darts/flashscore');
const JS = require('../lib/jsonstore');

const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'darts');
const rd = (f) => JS.readJson(DISK_DIR, f, 'darts');
const wr = (f, o) => { try { fs.mkdirSync(DISK_DIR, { recursive: true }); } catch { } return JS.writeJson(DISK_DIR, f, o, 'darts'); };
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const logitP = (p) => Math.log(p / (1 - p));
const sigm = (x) => 1 / (1 + Math.exp(-x));
const clampP = (p) => Math.max(1e-4, Math.min(1 - 1e-4, p));
const norm = D.norm;
const lastName = (s) => { const p = norm(s).split(' '); return p[p.length - 1] || ''; };

const DOCTRINE = 'todas las familias de dardos están EN SOMBRA: el motor compila el 501 visita a visita con reglas exactas (ganador, legs, sets, 180s y checkout salen del mismo estado), pero contra el MERCADO no hay prueba todavía — eso es lo que la sombra va a medir, familia por familia, con CLV contra el cierre capturado. El ganador se registra como familia de referencia, jamás como pick. Datos de la API pública de la PDC y de Darts Orakel: uso interno de investigación, admin-only.';
const ATTRIB = 'Resultados y calendario: API pública de la PDC. Estadística de jugador: Darts Orakel. Uso interno de investigación, sin fines comerciales.';

// LAS FAMILIAS (blueprint §22): las de 180s son la hipótesis principal (A01/A02/A05), los legs la más escalable (A03/A04)
const FAMILIES = {
  ML: { label: 'Ganador', card: 'SOLID', benchmark: true },
  LEGS_TOTAL: { label: 'Total de legs', card: 'TOTAL' },
  LEGS_HCP: { label: 'Hándicap de legs', card: 'SPREAD' },
  X180_TOTAL: { label: 'Total de 180s', card: 'TOTAL' },
  X180_MOST: { label: 'Más 180s', card: 'SOLID' },
  X180_PLAYER: { label: '180s del jugador', card: 'PLAYER' },
  X180_HCP: { label: 'Hándicap de 180s', card: 'SPREAD', display_only: true },
  CORRECT_SCORE: { label: 'Marcador exacto', card: 'COMBO', display_only: true },
  HIGHEST_CHECKOUT: { label: 'Checkout más alto', card: 'TOTAL', display_only: true },
  SETS_TOTAL: { label: 'Total de sets', card: 'TOTAL' },
  SETS_HCP: { label: 'Hándicap de sets', card: 'SPREAD' },
};

const G = { season: null, slate: null, odds: null, flash: null };

// EL CIRCUITO MODUS COMO SEGUNDA AGENDA (7-sep). La PDC deja días enteros sin cuadro definido; MODUS juega a
// diario y las casas lo cotizan. Sus fixtures nacen de los eventos de las casas ya descargados (G.odds) y se
// suman a la agenda de la PDC en TODOS los sitios que la leen, con su etiqueta `circuit: 'modus'`.
const MODUS = require('./modus');
const fixturesAll = (sl) => (sl && sl.fixtures ? sl.fixtures : []).concat(MODUS.fixturesFromOdds(G.odds));
const toursAll = (sl) => { const m = MODUS.summary(MODUS.fixturesFromOdds(G.odds)); return (sl && sl.tournaments ? sl.tournaments : []).concat(m ? [m] : []); };

// ══ 1. AGENDA (PDC) ═════════════════════════════════════════════════════════════════════════════════════
const SEASON = () => new Date().getUTCFullYear();
const SEASON_TTL = 6 * 3600e3, SLATE_TTL = 8 * 60e3;
async function seasonTournaments({ force = false } = {}) {
  if (G.season && !force && Date.now() - G.season.at < SEASON_TTL) return G.season.rows;
  const cached = rd('season.json');
  if (cached && !force && Date.now() - Date.parse(cached.at) < SEASON_TTL) { G.season = { at: Date.parse(cached.at), rows: cached.rows }; return cached.rows; }
  try {
    const rows = await PDC.tournaments(SEASON());
    // los primeros días de enero también interesa la temporada anterior (Mundial)
    if (new Date().getUTCMonth() === 0) { try { rows.push(...await PDC.tournaments(SEASON() - 1)); } catch { } }
    G.season = { at: Date.now(), rows };
    wr('season.json', { at: new Date().toISOString(), rows });
    return rows;
  } catch { return (cached && cached.rows) || (G.season && G.season.rows) || []; }
}
const isSecondary = (t) => /qualifying school|q-school|challenge tour|development tour|women'?s series|youth|junior|modus|academy|tour card holder qualifier/i.test(String(t.name || '')) || String(t.tournamentCategoryID) === '5';

// la agenda viva: torneos que empiezan en ≤ 10 días o acabaron hace ≤ 2, con sus stages y fixtures
async function slate({ force = false, daysAhead = 10 } = {}) {
  if (G.slate && !force && Date.now() - G.slate.at < SLATE_TTL) return G.slate;
  const tours = await seasonTournaments();
  const now = Date.now();
  const active = tours.filter((t) => { const s = Date.parse(t.startDate || 0), e = Date.parse(t.endDate || t.startDate || 0) + 864e5; return s < now + daysAhead * 864e5 && e > now - 2 * 864e5 && !isSecondary(t); });
  const details = [];
  const prev = (G.slate && G.slate.details) || [];
  for (const t of active) {
    const id = String(t.id || t.tournamentID);
    try { details.push(await PDC.tournament(id)); }
    catch { const old = prev.find((d) => String(d.id || d.tournamentID) === id); if (old) details.push(old); }
    await new Promise((r) => setTimeout(r, 150));
  }
  const fixtures = [];
  for (const t of details) {
    const tid = String(t.id || t.tournamentID);
    const tinfo = { tournamentID: tid, name: t.name, isTelevised: t.isTelevised, isRanked: t.isRanked, tournamentTypeID: t.tournamentTypeID, tournamentCategoryID: t.tournamentCategoryID, venue: t.venue, city: t.city, startDate: t.startDate, endDate: t.endDate, logo: PDC.IMG(t.tournamentLogo) };
    for (const st of t.stages || []) for (const fx of st.fixtures || []) fixtures.push(PDC.normFixture(fx, tinfo, st));
  }
  fixtures.sort((a, b) => Date.parse(a.start_at || 0) - Date.parse(b.start_at || 0));
  G.slate = { at: Date.now(), fixtures, details, tournaments: details.map((t) => tourSummary(t)) };
  return G.slate;
}
function tourSummary(t) {
  const fx = (t.stages || []).flatMap((s) => s.fixtures || []);
  const res = fx.filter((f) => f.status === 'Result').length;
  const fmts = (t.stages || []).map((s) => ({ stage: (s.stage || {}).name, sets: s.numberOfSets, legs: s.numberOfLegsPerSet, two_clear: !!s.twoClearLegsToWin, n: (s.fixtures || []).length }));
  return { id: String(t.id || t.tournamentID), name: t.name, venue: t.venue, city: t.city, start: t.startDate, end: t.endDate, tv: !!t.isTelevised, ranked: !!t.isRanked, logo: PDC.IMG(t.tournamentLogo), fixtures: fx.length, results: res, formats: fmts, double_in: /grand prix/i.test(String(t.name || '')), winner_id: t.winnerParticipantID ? String(t.winnerParticipantID) : null, certified_format: true, format_source: 'brief oficial de la PDC (stages del torneo)' };
}
// el formato de un fixture: del stage de la PDC (certificado) o de la plantilla histórica (no certificado)
function formatOf(fx) {
  const dbl = /grand prix/i.test(String(fx.tournament || ''));
  if (fx.format && fx.format.legs_per_set > 0) {
    const f = fx.format.sets > 1 ? R.setsFormat(fx.format.sets, fx.format.legs_per_set) : R.legsFormat(fx.format.legs_per_set, { twoClear: fx.format.two_clear });
    // el Matchplay y el último set del Mundial llevan extensión: la plantilla la conoce, el stage solo dice "dos legs de diferencia"
    if (fx.format.two_clear && f.kind === 'legs') f.max_legs = f.best_of + 6;
    if (f.kind === 'sets' && /world championship/i.test(String(fx.tournament || '')) && /final/i.test(String(fx.stage || '')) && !/semi|quarter/i.test(String(fx.stage || ''))) { f.final_set_two_clear = true; f.final_set_max_legs = 11; }
    return { ...f, double_in: dbl, certified: true, source: fx.circuit === 'modus' ? 'reglamento MODUS Super Series (primero a 4 legs)' : 'stage oficial de la PDC' };
  }
  const t = R.formatFor(fx.tournament, fx.stage);
  return { ...t.format, double_in: dbl, certified: false, source: t.source };
}

// ══ 2. MERCADO ══════════════════════════════════════════════════════════════════════════════════════════
const ODDS_TTL = 10 * 60e3;
async function refreshOdds({ force = false } = {}) {
  if (G.odds && !force && Date.now() - G.odds.at < ODDS_TTL) return G.odds;
  const [pin, bov, pm, cbf] = await Promise.all([
    BOOKS.pinnacle().catch(() => ({ events: [] })), BOOKS.bovada().catch(() => ({ events: [], outrights: [] })),
    BOOKS.polymarket().catch(() => ({ events: [] })), BOOKS.cloudbetFixtures().catch(() => ({ events: [], available: false })),
  ]);
  // Cloudbet: mercados de los eventos de los próximos 3 días (uno a uno, con pausa)
  const cbEvents = [];
  if (cbf.available) {
    for (const e of (cbf.events || []).filter((e) => Date.parse(e.start_at || 0) < Date.now() + 3 * 864e5).slice(0, 40)) {
      const mk = await BOOKS.cloudbetMarkets(e.provider_id).catch(() => ({ rows: [], raw_keys: [] }));
      cbEvents.push({ ...e, rows: mk.rows, raw_keys: mk.raw_keys });
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const events = [].concat(pin.events || [], bov.events || [], pm.events || [], cbEvents);
  G.odds = { at: Date.now(), events, outrights: { bovada: bov.outrights || [], kalshi: null }, books: { pinnacle: !!pin.available, bovada: !!bov.available, polymarket: !!pm.available, cloudbet: !!cbf.available }, cloudbet_keys: [...new Set(cbEvents.flatMap((e) => e.raw_keys || []))] };
  try { G.odds.outrights.kalshi = (await BOOKS.kalshi()).outrights; } catch { }
  return G.odds;
}
// eventos de casas casados a un fixture de la PDC: mismos apellidos (en cualquier orden) y ±36 h
function marketFor(fx, odds) {
  const la = lastName(fx.a.name), lb = lastName(fx.b.name);
  const t0 = Date.parse(fx.start_at || 0);
  const hits = [];
  for (const e of (odds && odds.events) || []) {
    const ea = lastName(e.a), eb = lastName(e.b);
    if (!ea || !eb) continue;
    let swapped = null;
    if (ea === la && eb === lb) swapped = false; else if (ea === lb && eb === la) swapped = true; else continue;
    const te = Date.parse(e.start_at || 0);
    if (Number.isFinite(t0) && Number.isFinite(te) && Math.abs(te - t0) > 36 * 3600e3) continue;
    hits.push({ e, swapped });
  }
  const rows = [];
  for (const { e, swapped } of hits) for (const r of e.rows || []) {
    const row = { ...r, book: e.book, live_quote: !!r.live };
    if (swapped) {
      if (row.side === 'a') row.side = 'b'; else if (row.side === 'b') row.side = 'a';
      if (row.participant === 'a') row.participant = 'b'; else if (row.participant === 'b') row.participant = 'a';
      if (row.family === 'LEGS_HCP' || row.family === 'SETS_HCP') row.line = row.line != null ? -row.line : row.line;
      if (row.family === 'CORRECT_SCORE' && /^\d+-\d+$/.test(row.side)) row.side = row.side.split('-').reverse().join('-');
    }
    rows.push(row);
  }
  // consenso del ganador: sin vig por casa, mediana entre CASAS (prematch). Polymarket queda fuera del
  // consenso y de la mejor cuota: con $25 de liquidez y 26 puntos de spread es un intervalo, no un precio
  // (blueprint §25); se enseña aparte.
  const isBook = (r) => r.book !== 'polymarket';
  const mls = {};
  for (const r of rows.filter((r) => r.family === 'ML' && !r.live_quote && isBook(r))) { mls[r.book] = mls[r.book] || {}; mls[r.book][r.side] = r.odds; }
  const pairs = Object.entries(mls).filter(([, v]) => v.a > 1 && v.b > 1).map(([bk, v]) => ({ book: bk, p_a: (1 / v.a) / (1 / v.a + 1 / v.b) }));
  const med = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
  const pin = pairs.find((p) => p.book === 'pinnacle');
  const best = (fam, side, line, participant) => rows.filter((r) => r.family === fam && r.side === side && !r.live_quote && isBook(r) && (line == null || Math.abs((r.line || 0) - line) < 1e-9) && (participant == null || r.participant === participant)).reduce((b, r) => (!b || r.odds > b.odds ? r : b), null);
  const lines = (fam, participant) => [...new Set(rows.filter((r) => r.family === fam && !r.live_quote && isBook(r) && r.line != null && (participant == null || r.participant === participant)).map((r) => r.line))].sort((x, y) => x - y);
  return {
    rows, books: [...new Set(hits.map((h) => h.e.book))], n_books: new Set(hits.map((h) => h.e.book)).size,
    consensus: { ml_p_a: pairs.length ? r3(med(pairs.map((p) => p.p_a))) : null, ml_p_a_pinnacle: pin ? r3(pin.p_a) : null, books: pairs.map((p) => p.book) },
    best, lines,
    polymarket: (hits.find((h) => h.e.book === 'polymarket') || {}).e || null,
    cloudbet: (hits.find((h) => h.e.book === 'cloudbet') || {}).e || null,
  };
}

// ══ 3. EL MODELO SOBRE UN FIXTURE ═══════════════════════════════════════════════════════════════════════
// la habilidad de un jugador HOY: ventanas de Orakel (90 d sobre 365 d) o, si no está, el EWMA de la base
let ORK = null;
function orakel() { if (ORK) return ORK; ORK = D.readOrakel(); return ORK; }
function resetOrakel() { ORK = null; CALIB.clear(); }
function skillOf(id) {
  const o = orakel(); const d = D.build(); const T = d.T;
  const latest = o.latest;
  const w365 = latest && o.windows[`${latest}|365`] ? o.windows[`${latest}|365`][String(id)] : null;
  const w90 = latest && o.windows[`${latest}|90`] ? o.windows[`${latest}|90`][String(id)] : null;
  const sv = D.skillVector(id);
  const out = { avg: sv.avg, per180Visit: null, checkoutPct: sv.checkoutPct, exposure_darts: 0, n: sv.n, source: 'base (EWMA de partidos)', cold: sv.cold, as_of: d.meta.last_match_date || null, windows: null };
  const pick = (w, key) => (w && w[key] ? w[key] : null);
  const a365 = pick(w365, '25'), a90 = pick(w90, '25'), x365 = pick(w365, '26'), x90 = pick(w90, '26'), c365 = pick(w365, '1053'), c90 = pick(w90, '1053');
  if (a365 && a365[1] > 300) {
    // media: 365 d como base, arrastrada hacia los 90 d según su exposición (en dardos); 3.000 dardos ≈ un par de meses de circuito
    const KD = 3000;
    const avg365 = a365[2], d90 = a90 ? a90[1] : 0;
    const avg = a90 && d90 > 200 ? (avg365 * KD + a90[2] * d90) / (KD + d90) : avg365;
    // 180s por visita: total de 180s / (dardos/3) de la misma ventana
    const v365 = x365 && x365[2] != null ? x365[2] / (a365[1] / 3) : null;
    const v90 = x90 && x90[2] != null && a90 && a90[1] > 200 ? x90[2] / (a90[1] / 3) : null;
    const per180Visit = v365 != null ? (v90 != null ? (v365 * KD + v90 * d90) / (KD + d90) : v365) : null;
    const co = c365 && c365[1] >= 40 ? (c90 && c90[1] >= 20 ? (c365[0] + c90[0]) / (c365[1] + c90[1]) : c365[0] / c365[1]) : null;
    Object.assign(out, { avg, per180Visit, checkoutPct: co != null ? Math.min(0.6, Math.max(0.15, co)) : T.popCo, exposure_darts: a365[1], source: 'Darts Orakel (365 d + 90 d)', cold: a365[1] < 1500, as_of: latest,
      windows: { avg_365: a365[2], avg_90: a90 ? a90[2] : null, darts_365: a365[1], darts_90: a90 ? a90[1] : null, x180_365: x365 ? x365[2] : null, x180_90: x90 ? x90[2] : null, co_365: c365 ? { hit: c365[0], att: c365[1], pct: c365[2] } : null, co_90: c90 ? { hit: c90[0], att: c90[1], pct: c90[2] } : null } });
  }
  out.elo = Math.round(D.eloOf(id));
  return out;
}
const CALIB = new Map();
function kernelOf(sk, doubleIn) {
  const key = [Math.round(sk.avg * 2) / 2, sk.per180Visit != null ? Math.round(sk.per180Visit * 200) / 200 : 'x', Math.round(sk.checkoutPct * 100) / 100, doubleIn ? 1 : 0].join('|');
  let c = CALIB.get(key);
  if (!c) { c = K.calibrate({ avg: sk.avg, per180Visit: sk.per180Visit, checkoutPct: sk.checkoutPct }, { doubleIn }); if (CALIB.size > 600) CALIB.clear(); CALIB.set(key, c); }
  return c;
}
// la incertidumbre epistémica en pp: poca exposición → más; jugador frío → más; la referencia es la distancia Elo-compilador
function uncertaintyPp(skA, skB, pElo, pComp) {
  const expo = (sk) => (sk.exposure_darts > 0 ? sk.exposure_darts : sk.n * 150);
  const thin = (e) => Math.min(6, 6 * Math.exp(-e / 2500));
  return Math.min(12, 1.5 + thin(expo(skA)) + thin(expo(skB)) + Math.abs(pElo - pComp) * 100 * 0.5 + (skA.cold ? 1.5 : 0) + (skB.cold ? 1.5 : 0));
}
function eventModel(fx, { starter = null } = {}) {
  const A = fx.a && fx.a.id, B = fx.b && fx.b.id;
  if (!A || !B) return { available: false, why: fx.unresolved && fx.unresolved.length ? `jugador fuera de la base propia: ${fx.unresolved.join(', ')}` : 'cruce sin definir (a la espera de la ronda anterior)' };
  const fmt = formatOf(fx);
  const skA = skillOf(A), skB = skillOf(B);
  const cA = kernelOf(skA, fmt.double_in), cB = kernelOf(skB, fmt.double_in);
  const m = C.compileMatch(cA.leg, cB.leg, fmt, { starter });
  const pElo = D.eloProb(A, B);
  const cst = D.build().T.cst;
  const u = cst.ensembleU != null ? cst.ensembleU : 0.5;
  const pA = sigm((1 - u) * logitP(clampP(pElo)) + u * logitP(clampP(m.p_a)));
  return {
    available: true, format: fmt, a: { id: String(A), name: fx.a.name }, b: { id: String(B), name: fx.b.name },
    p_a: r3(pA), p_a_compiled: r3(m.p_a), p_a_elo: r3(pElo), unc_pp: r2(uncertaintyPp(skA, skB, pElo, m.p_a)),
    skills: { a: skA, b: skB }, kernels: { a: { sk: cA.sk, fitted: cA.fitted, identified: cA.identified }, b: { sk: cB.sk, fitted: cB.fitted, identified: cB.identified } },
    match: m, model_version: (D.build().priors || {}).model_version || 'darts-l1-0',
  };
}

// ══ 4. LAS TESIS ════════════════════════════════════════════════════════════════════════════════════════
function gate(c) {
  const edgePp = (c.p_model - c.p_implied) * 100;
  const gates = [];
  const uncPp = Math.min(12, c.unc_pp != null ? c.unc_pp : 3);
  gates.push({ gate: 'edge', pass: edgePp >= 3, detail: 'listón mínimo 3 pp (con signo: solo el lado +EV)' });
  gates.push({ gate: 'noise', pass: edgePp > uncPp, detail: `${edgePp.toFixed(1)} pp vs incertidumbre ${uncPp.toFixed(1)} pp (exposición de los dos jugadores + desacuerdo Elo/compilador)` });
  gates.push({ gate: 'orthogonality', pass: true, detail: 'modelo market-blind por construcción: el precio objetivo jamás es input' });
  gates.push({ gate: 'push', pass: (c.push_p || 0) < 0.08, detail: `push ${(100 * (c.push_p || 0)).toFixed(1)} %` });
  gates.push({ gate: 'format', pass: !!c.format_certified, detail: c.format_certified ? 'formato certificado por el brief oficial de la ronda' : 'formato de plantilla, no certificado para esta edición: sin tesis' });
  // FRESHNESS PASA A INFORMATIVA (7-sep). La incertidumbre epistémica ya castiga al jugador frío (+1,5 pp cada
  // uno y hasta +6 pp por poca exposición) y la puerta `noise` la aplica; una segunda puerta que además
  // vetaba la tesis dejaba a cero circuitos enteros (MODUS) y no añadía información: la fila lleva la marca.
  gates.push({ gate: 'freshness', pass: !(c.cold_a || c.cold_b), informativo: true, detail: c.cold_a || c.cold_b ? 'jugador con poca exposición medida: la habilidad es un prior de población (la incertidumbre ya lo descuenta)' : 'los dos con exposición suficiente' });
  gates.push({ gate: 'settleable', pass: !c.unsettleable, informativo: true, detail: c.unsettleable ? 'sin fuente de liquidación fiable para esta familia fuera del Players Championship: se anota y se liquidará cuando exista' : 'liquidable con el resultado oficial' });
  const pass = gates.filter((g) => !g.informativo).every((x) => x.pass);
  return {
    family: c.family, side: c.side, line: c.line != null ? c.line : null, participant: c.participant || null, odds: c.odds, book: c.book,
    p_model: r3(c.p_model), p_implied: r3(c.p_implied), edge_pp: r2(edgePp), gates, unc_pp: r2(uncPp),
    verdict: pass ? 'SHADOW_PICK' : 'NO_PICK', no_pick_reason: pass ? null : (gates.find((x) => !x.pass && !x.informativo) || {}).gate,
    benchmark: c.family === 'ML' || undefined, unsettleable: !!c.unsettleable || undefined,
  };
}
function evaluateEdges(model, mk) {
  const out = [];
  if (!model.available) return out;
  const m = model.match; const inv = (o) => 1 / o;
  const base = { unc_pp: model.unc_pp, format_certified: !!model.format.certified, cold_a: model.skills.a.cold, cold_b: model.skills.b.cold };
  const push = (fam, side, line, pModel, pushP, participant, unsettleable) => {
    const b = mk.best(fam, side, line, participant);
    if (!b || !(b.odds > 1) || !(pModel > 0)) return;
    out.push(gate({ ...base, family: fam, side, line, participant, odds: b.odds, book: b.book, p_model: pModel, p_implied: inv(b.odds), push_p: pushP || 0, unsettleable }));
  };
  push('ML', 'a', null, model.p_a); push('ML', 'b', null, 1 - model.p_a);
  if (m.legs) {
    for (const line of mk.lines('LEGS_TOTAL')) { const ou = C.overUnder(m.legs.total, line); push('LEGS_TOTAL', 'over', line, ou.over, ou.push); push('LEGS_TOTAL', 'under', line, ou.under, ou.push); }
    for (const line of mk.lines('LEGS_HCP')) { const h = C.handicap(m.legs.margin, line); push('LEGS_HCP', 'a', line, h.cover, h.push); const hb = C.handicap(m.legs.margin.map(([k, p]) => [-k, p]), -line); push('LEGS_HCP', 'b', -line, hb.cover, hb.push); }
  }
  if (m.sets) {
    for (const line of mk.lines('SETS_TOTAL')) { const ou = C.overUnder(m.sets.total, line); push('SETS_TOTAL', 'over', line, ou.over, ou.push); push('SETS_TOTAL', 'under', line, ou.under, ou.push); }
    for (const line of mk.lines('SETS_HCP')) { const h = C.handicap(m.sets.margin, line); push('SETS_HCP', 'a', line, h.cover, h.push); const hb = C.handicap(m.sets.margin.map(([k, p]) => [-k, p]), -line); push('SETS_HCP', 'b', -line, hb.cover, hb.push); }
  }
  // 180s: solo liquidables donde Orakel publica el partido (Players Championship); en el resto van marcadas
  const settle180 = /players championship/i.test(String(model.tournament || ''));
  for (const line of mk.lines('X180_TOTAL')) { const ou = C.overUnder(m.x180.total, line); push('X180_TOTAL', 'over', line, ou.over, ou.push, null, !settle180); push('X180_TOTAL', 'under', line, ou.under, ou.push, null, !settle180); }
  push('X180_MOST', 'a', null, m.x180.most_a, 0, null, !settle180); push('X180_MOST', 'b', null, m.x180.most_b, 0, null, !settle180); push('X180_MOST', 'tie', null, m.x180.tie, 0, null, !settle180);
  for (const who of ['a', 'b']) for (const line of mk.lines('X180_PLAYER', who)) { const ou = C.overUnder(m.x180[who], line); push('X180_PLAYER', 'over', line, ou.over, ou.push, who, !settle180); push('X180_PLAYER', 'under', line, ou.under, ou.push, who, !settle180); }
  for (const line of mk.lines('HIGHEST_CHECKOUT')) { const over = C.checkoutOver(m.checkout_max.match, line); push('HIGHEST_CHECKOUT', 'over', line, over, 0, null, true); push('HIGHEST_CHECKOUT', 'under', line, 1 - over, 0, null, true); }
  return out.filter((c) => !(FAMILIES[c.family] || {}).display_only || c.verdict === 'NO_PICK');
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
function selectionName(c, row) {
  const who = c.side === 'a' ? row.a : c.side === 'b' ? row.b : null;
  const pl = c.participant === 'a' ? row.a : c.participant === 'b' ? row.b : null;
  switch (c.family) {
    case 'ML': return `Gana ${who}`;
    case 'LEGS_TOTAL': return `${c.side === 'over' ? 'Más' : 'Menos'} de ${c.line} legs`;
    case 'LEGS_HCP': return `${who} ${c.line > 0 ? '+' : ''}${c.line} legs`;
    case 'SETS_TOTAL': return `${c.side === 'over' ? 'Más' : 'Menos'} de ${c.line} sets`;
    case 'SETS_HCP': return `${who} ${c.line > 0 ? '+' : ''}${c.line} sets`;
    case 'X180_TOTAL': return `${c.side === 'over' ? 'Más' : 'Menos'} de ${c.line} 180s en el partido`;
    case 'X180_MOST': return c.side === 'tie' ? 'Empate en 180s' : `${who} tira más 180s`;
    case 'X180_PLAYER': return `${pl}: ${c.side === 'over' ? 'más' : 'menos'} de ${c.line} 180s`;
    case 'HIGHEST_CHECKOUT': return `Checkout más alto ${c.side === 'over' ? 'por encima' : 'por debajo'} de ${c.line}`;
    default: return `${c.family} ${c.side}${c.line != null ? ' ' + c.line : ''}`;
  }
}
function whyOf(c, row, model) {
  const m = model.match; const bits = [];
  const who = c.side === 'a' ? row.a : c.side === 'b' ? row.b : null;
  const pct = (x) => (100 * x).toFixed(1) + ' %';
  const fmtTxt = model.format.kind === 'sets' ? `al mejor de ${model.format.best_of_sets} sets` : `al mejor de ${model.format.best_of} legs${model.format.two_clear ? ' con dos de diferencia' : ''}`;
  if (c.family === 'ML') bits.push(`El motor compila el 501 visita a visita —precisión al triple, dobles y arrastre de cada uno— y corre el partido ${fmtTxt}: ${who} gana ${pct(c.p_model)} de las veces contra el ${pct(c.p_implied)} que implica la cuota.`);
  else if (c.family === 'LEGS_TOTAL' || c.family === 'SETS_TOTAL') bits.push(`La duración no es un promedio: sale de la distribución completa de ${c.family === 'SETS_TOTAL' ? 'sets' : 'legs'} del compilador (media ${(c.family === 'SETS_TOTAL' ? m.sets.exp_total : m.legs.exp_total).toFixed(1)}), que sabe que el que gana el leg deja de tirar y que salir primero vale ${pct(m.leg.hold_a)} contra ${pct(m.leg.break_a)}.`);
  else if (c.family === 'LEGS_HCP' || c.family === 'SETS_HCP') bits.push(`El hándicap se lee sobre la distribución de MARGEN del compilador, no sobre el ganador: ${who} cubre ${c.line > 0 ? '+' : ''}${c.line} en ${pct(c.p_model)} de los partidos compilados.`);
  else if (c.family === 'X180_TOTAL') bits.push(`Los 180s no son una tasa por leg multiplicada: se acumulan visita a visita con la duración del partido y con el hecho de que el que cierra el leg le quita visitas al otro. Media conjunta ${(m.x180.exp_a + m.x180.exp_b).toFixed(1)}; sobre esa curva el ${c.side === 'over' ? 'más' : 'menos'} de ${c.line} pesa ${pct(c.p_model)}.`);
  else if (c.family === 'X180_MOST') bits.push(`"Más 180s" se resuelve sobre la distribución CONJUNTA de los dos conteos, con su masa de empate (${pct(m.x180.tie)}) contada aparte: ${c.side === 'tie' ? 'el empate' : who} sale ${pct(c.p_model)}.`);
  else if (c.family === 'X180_PLAYER') bits.push(`Los 180s del jugador dependen de cuántas visitas de puntuación le deja el partido, no solo de su tasa: media ${(c.participant === 'a' ? m.x180.exp_a : m.x180.exp_b).toFixed(2)} en este formato y contra este rival.`);
  else bits.push(`${pct(c.p_model)} del modelo contra ${pct(c.p_implied)} del precio.`);
  bits.push('Modelo market-blind por construcción: el precio no entra nunca al cálculo, así que la diferencia con la casa es una discrepancia real y no un eco de su propia línea.');
  bits.push('EN SOMBRA: todas las familias de dardos se anotan y se liquidan para acumular muestra, pero ninguna se publica como pick — contra el mercado todavía no hay prueba.');
  if (c.unsettleable) bits.push('Esta familia solo se puede liquidar con estadística de partido, que hoy existe para el Players Championship: en el resto queda anotada a la espera de fuente.');
  return bits.join(' ');
}
function pickCard(c, row, model) {
  const st = stakeOf(c.p_model, c.odds);
  const fam = FAMILIES[c.family] || { label: c.family, card: 'TOTAL' };
  return {
    ...c,
    family: fam.card, family_raw: c.family, fam_label: fam.label,
    selection_name: selectionName(c, row),
    home: row.a, away: row.b, home_team_id: null, away_team_id: null,
    dt_avas: { h: row.photo_a || null, a: row.photo_b || null },
    dt_hash: `dtmatch/${row.id}`,
    competition_name: row.tournament || null, kickoff: row.start_at || null,
    confidence: c.p_model, model_prob: c.p_model, market_prob: c.p_implied,
    pick_id: `dt_${row.id}_${c.family}_${c.participant || ''}${c.side}_${c.line != null ? c.line : 'x'}`,
    why_es: whyOf(c, row, model),
    stake_pct: st ? st.pct : null, stake_raw_pct: st ? st.raw : null, stake_capped: !!(st && st.capped),
    shadow: true,
    signals: { win_prob: c.p_model, edge_pp: c.edge_pp, data_confidence: model.skills.a.cold || model.skills.b.cold ? 'low' : 'med', pick_quality: c.edge_pp >= 6 ? 'strong' : c.edge_pp >= 4 ? 'moderate' : 'marginal', regime: 'monitor' },
  };
}
function photoOf(id) { const p = D.playerOf(id); return p && p.photo ? p.photo : null; }

// ══ 5. EL TABLERO ═══════════════════════════════════════════════════════════════════════════════════════
const rowOf = (fx) => ({ id: fx.id, tournament: fx.tournament, tournament_id: fx.tournament_id, stage: fx.stage, start_at: fx.start_at, status: fx.status, board: fx.board, tv: fx.televised, circuit: fx.circuit || 'pdc', unresolved: fx.unresolved || undefined,
  a: fx.a.name, b: fx.b.name, a_id: fx.a.id, b_id: fx.b.id, a_country: fx.a.country, b_country: fx.b.country, photo_a: photoOf(fx.a.id), photo_b: photoOf(fx.b.id),
  score_a: fx.score_a, score_b: fx.score_b, winner_id: fx.winner_id });

async function board({ daysAhead = 6, hoursBack = 8 } = {}) {
  const [sl, odds] = await Promise.all([slate(), refreshOdds().catch(() => null)]);
  const now = Date.now();
  const rows = [];
  for (const fx of fixturesAll(sl)) {
    const t = Date.parse(fx.start_at || 0);
    if (!(t > now - hoursBack * 3600e3 && t < now + daysAhead * 864e5)) continue;
    const row = rowOf(fx);
    row.format = formatOf(fx);
    const mk = marketFor(fx, odds);
    row.market = { ...mk.consensus, n_books: mk.n_books, books: mk.books, has_180s: mk.rows.some((r) => /^X180/.test(r.family)), lines_legs: mk.lines('LEGS_TOTAL'), polymarket: mk.polymarket ? { p_a: mk.polymarket.rows.find((r) => r.side === 'a') ? mk.polymarket.rows.find((r) => r.side === 'a').prob : null, liquidity: mk.polymarket.liquidity, url: mk.polymarket.url } : null };
    const model = eventModel({ ...fx, tournament: fx.tournament });
    row.available = model.available;
    if (model.available) {
      model.tournament = fx.tournament;
      row.gp = { p_a: model.p_a, p_a_compiled: model.p_a_compiled, p_a_elo: model.p_a_elo, exp_legs: model.match.legs ? r2(model.match.legs.exp_total) : null, exp_sets: model.match.sets ? r2(model.match.sets.exp_total) : null, exp_180_a: r2(model.match.x180.exp_a), exp_180_b: r2(model.match.x180.exp_b), hold_a: r3(model.match.leg.hold_a), hold_b: r3(model.match.leg.hold_b), unc_pp: model.unc_pp, avg_a: r2(model.skills.a.avg), avg_b: r2(model.skills.b.avg), cold: !!(model.skills.a.cold || model.skills.b.cold), elo_a: model.skills.a.elo, elo_b: model.skills.b.elo };
      // tesis SOLO prematch: un partido jugado o en juego no tiene precio de apertura que comparar
      row.candidates = fx.status === 'Result' || t < now ? [] : evaluateEdges(model, mk);
      // el GANADOR es familia de referencia (benchmark): se registra en la sombra para medirlo, pero JAMÁS
      // sale como card de tesis (7-sep: la primera pasada de MODUS lo publicaba como pick)
      const tesis = row.candidates.filter((c) => c.verdict === 'SHADOW_PICK' && !c.benchmark);
      row.shadow_n = tesis.length;
      row.picks = tesis.map((c) => pickCard(c, row, model));
    } else row.why = model.why;
    rows.push(row);
  }
  // en vivo: legs de Flashscore casados por apellidos (display)
  try {
    const live = await FLASH.feed();
    for (const r of rows) {
      const hit = FLASH.matchByNames(live, r.a, r.b);
      if (hit && hit.state !== 'scheduled') r.live = { state: hit.state, legs_a: hit.swapped ? hit.legs_b : hit.legs_a, legs_b: hit.swapped ? hit.legs_a : hit.legs_b, best_of: hit.best_of, source: 'flashscore' };
    }
  } catch { }
  // el siguiente torneo de la PDC con fecha, para que el tablero vacío diga cuándo vuelve a haber cuadro
  const proximo = (sl.tournaments || []).filter((t) => Date.parse(t.start || 0) > now).sort((x, y) => Date.parse(x.start) - Date.parse(y.start))[0] || null;
  return { rows, tournaments: toursAll(sl), refreshed_at: new Date(sl.at).toISOString(), odds_at: odds ? new Date(odds.at).toISOString() : null, books: odds ? odds.books : null, doctrine: DOCTRINE, attribution: ATTRIB,
    proximo_pdc: proximo ? { id: proximo.id, name: proximo.name, start: proximo.start, end: proximo.end, tv: proximo.tv } : null,
    note: rows.length ? null : 'sin partidos con cuadro definido en la ventana (la agenda se abre sola con el siguiente torneo)' };
}

// ══ 6. LA FICHA DE UN PARTIDO ═══════════════════════════════════════════════════════════════════════════
async function matchDetail(fixtureId) {
  const [sl, odds] = await Promise.all([slate(), refreshOdds().catch(() => null)]);
  const fx = fixturesAll(sl).find((f) => String(f.id) === String(fixtureId));
  if (!fx) return { available: false, why: 'ese partido ya no está en la agenda' };
  const row = rowOf(fx);
  const mk = marketFor(fx, odds);
  const model = eventModel(fx);
  const base = { ...row, format: formatOf(fx), market: { ...mk.consensus, n_books: mk.n_books, books: mk.books }, market_rows: mk.rows.filter((r) => !r.live_quote).map((r) => ({ book: r.book, family: r.family, side: r.side, line: r.line, odds: r.odds, participant: r.participant })), polymarket: mk.polymarket ? { p_a: (mk.polymarket.rows.find((r) => r.side === 'a') || {}).prob, liquidity: mk.polymarket.liquidity, url: mk.polymarket.url } : null, doctrine: DOCTRINE, attribution: ATTRIB };
  if (!model.available) return { ...base, available: false, why: model.why };
  model.tournament = fx.tournament;
  const m = model.match;
  const trim = (pmf, eps = 0.002) => pmf.filter(([, p]) => p > eps).map(([k, p]) => [k, r3(p)]);
  const ck = (cdf) => [100, 110, 120, 130, 140, 150, 160, 170].map((c) => [c, r3(C.checkoutOver(cdf, c - 1))]);
  const kernelView = (kk, sk, LEG) => ({
    avg: r2(sk.avg), per180_visit: sk.per180Visit != null ? r3(sk.per180Visit) : null, checkout_pct: r3(sk.checkoutPct), exposure_darts: sk.exposure_darts, source: sk.source, cold: sk.cold, as_of: sk.as_of, windows: sk.windows, elo: sk.elo,
    identified: kk.identified, fitted: { avg3: r2(kk.fitted.avg3), x180_leg: r3(kk.fitted.exp180), darts_leg: r2(kk.fitted.expDarts) },
    // la diana: distribución de dobles con los que cierra y del valor del checkout (del kernel, no observado)
    doubles: LEG.dbl.slice(0, 8).map(([k, p]) => [k, r3(p)]), checkout_pmf: trim(LEG.checkout, 0.004), visits_pmf: Array.from(LEG.visits).map((p, i) => [i, r3(p)]).filter(([, p]) => p > 0.002),
    scoring_visit: (() => { const pol = K.policyFor(kk.sk); const t = K.visitKernel(400, kk.sk, pol); const acc = new Map(); for (const x of t) acc.set(400 - x.to, (acc.get(400 - x.to) || 0) + x.p); return [...acc.entries()].sort((p, q) => p[0] - q[0]).filter(([, p]) => p > 0.003).map(([s, p]) => [s, r3(p)]); })(),
  });
  const cA = kernelOf(model.skills.a, model.format.double_in), cB = kernelOf(model.skills.b, model.format.double_in);
  const cands = evaluateEdges(model, mk);
  return {
    ...base, available: true,
    a: { id: model.a.id, name: model.a.name, photo: row.photo_a, country: row.a_country }, b: { id: model.b.id, name: model.b.name, photo: row.photo_b, country: row.b_country },
    p_a: model.p_a, p_a_compiled: model.p_a_compiled, p_a_elo: model.p_a_elo, unc_pp: model.unc_pp,
    starter: m.starter, scenarios: m.scenarios, first_leg_p_a: r3(m.first_leg_p_a),
    leg: { hold_a: r3(m.leg.hold_a), hold_b: r3(m.leg.hold_b), break_a: r3(m.leg.break_a), break_b: r3(m.leg.break_b), exp_visits: r2(m.leg.exp_visits_start) },
    legs: m.legs ? { exp_total: r2(m.legs.exp_total), total: trim(m.legs.total), margin: trim(m.legs.margin), score: m.legs.score.filter(([, p]) => p > 0.005).map(([k, p]) => [k, r3(p)]) } : null,
    sets: m.sets ? { exp_total: r2(m.sets.exp_total), total: trim(m.sets.total), score: m.sets.score.filter(([, p]) => p > 0.005).map(([k, p]) => [k, r3(p)]) } : null,
    x180: { exp_a: r2(m.x180.exp_a), exp_b: r2(m.x180.exp_b), most_a: r3(m.x180.most_a), most_b: r3(m.x180.most_b), tie: r3(m.x180.tie), a: trim(m.x180.a), b: trim(m.x180.b), total: trim(m.x180.total) },
    checkout_max: { a: ck(m.checkout_max.a), b: ck(m.checkout_max.b), match: ck(m.checkout_max.match) },
    exp_visits: r2(m.exp_visits),
    kernels: { a: kernelView(cA, model.skills.a, cA.leg), b: kernelView(cB, model.skills.b, cB.leg) },
    format_prism: formatPrism(cA.leg, cB.leg, model.format),
    h2h: h2h(model.a.id, model.b.id),
    profiles: { a: playerProfile(model.a.id), b: playerProfile(model.b.id) },
    candidates: cands,
    // las mismas cards que el tablero: el GANADOR es referencia (benchmark) y no sale como tesis (7-sep)
    picks: cands.filter((c) => c.verdict === 'SHADOW_PICK' && !c.benchmark).map((c) => pickCard(c, row, model)),
    model_version: model.model_version,
  };
}
// el mismo duelo bajo otros formatos, con las mismas habilidades (bloque 16, Format Lens: contrafactual mecánico)
function formatPrism(LA, LB, fmt) {
  const out = [];
  const variants = fmt.kind === 'sets' ? [['BO3 sets', R.setsFormat(3)], ['BO7 sets', R.setsFormat(7)], ['BO11 sets', R.setsFormat(11)], ['BO13 sets (final)', R.setsFormat(13, 5, { finalSetTwoClear: true, finalSetMaxLegs: 11 })]]
    : [['BO7', R.legsFormat(7)], ['BO11', R.legsFormat(11)], ['BO19', R.legsFormat(19, { twoClear: true, maxLegs: 25 })], ['BO35', R.legsFormat(35, { twoClear: true, maxLegs: 41 })]];
  for (const [label, f] of variants) {
    const m = C.compileMatch(LA, LB, { ...f, double_in: !!fmt.double_in });
    out.push({ label, p_a: r3(m.p_a), exp_units: r2(m.legs ? m.legs.exp_total : m.sets.exp_total), exp_180_total: r2(m.x180.exp_a + m.x180.exp_b), current: (f.kind === fmt.kind) && ((f.best_of && f.best_of === fmt.best_of) || (f.best_of_sets && f.best_of_sets === fmt.best_of_sets)) });
  }
  return out;
}

// ══ 7. LA SOMBRA ════════════════════════════════════════════════════════════════════════════════════════
function snapshotCloses(rows) {
  const st = rd('closes.json') || { closes: {} };
  const now = Date.now(); let dirty = false;
  for (const r of rows) {
    const t = Date.parse(r.start_at || 0);
    if (!(t > now - 3600e3) || !r.available) continue;
    // todas las líneas cotizadas, con la mejor cuota por lado y casa (la liquidación busca la línea exacta)
    const rows2 = (r._mk_rows || []).map((x) => ({ book: x.book, family: x.family, side: x.side, line: x.line, odds: x.odds, participant: x.participant }));
    const c = st.closes[r.id] = st.closes[r.id] || { a: r.a, b: r.b, start_at: r.start_at, series: {} };
    c.at = new Date().toISOString(); c.rows = rows2;
    // 9-sep (traído de tenis de mesa): la primera lectura dentro de cada cubo T−60/−30/−10/−5/−1 se congela
    try { const CL = require('../implied-engine/closes'); const bkt = CL.bucketFor(r.start_at, now); c.series = c.series || {}; if (bkt && !c.series[bkt]) c.series[bkt] = { at: c.at, rows: rows2 }; } catch { }
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
    const fx = fixturesAll(G.slate).find((f) => String(f.id) === String(row.id));
    const mk = fx ? marketFor(fx, odds) : { rows: [] };
    forClose.push({ ...row, _mk_rows: mk.rows.filter((r) => !r.live_quote) });
    if (!(start > Date.now() && start - Date.now() < 6 * 864e5)) continue;
    for (const c of row.candidates || []) {
      if (c.verdict !== 'SHADOW_PICK') continue;
      const key = `${row.id}|${c.family}|${c.participant || ''}${c.side}|${c.line}`;
      if (have.has(key)) continue;
      have.add(key); n++;
      st.picks.push({ key, event_id: row.id, tournament: row.tournament, tournament_id: row.tournament_id, stage: row.stage, format: row.format, a: row.a, b: row.b, a_id: row.a_id, b_id: row.b_id,
        family: c.family, side: c.side, line: c.line, participant: c.participant || null, odds: c.odds, book: c.book, p_model: c.p_model, p_implied: c.p_implied, edge_pp: c.edge_pp, unc_pp: c.unc_pp, benchmark: !!c.benchmark, unsettleable: !!c.unsettleable,
        start_at: row.start_at, status: 'OPEN', created_at: new Date().toISOString(), regime: 'shadow', era: process.env.GP_PICKS_ERA || 'darts-v1-2026-09-06',
        // el circuito viaja en la pick: MODUS y PDC se miden por separado, jamás en la misma media
        circuit: row.circuit || 'pdc', cold: !!(row.gp && row.gp.cold) || undefined });
    }
  }
  snapshotCloses(forClose);
  if (n) wr('picks.json', st);
  return { recorded: n, total: st.picks.length };
}
// liquidación con el resultado oficial de la PDC (legs/sets) y, para 180s, con la estadística de Orakel (PC)
async function settleShadow({ voidDays = 12 } = {}) {
  const st = rd('picks.json') || { picks: [] };
  const open = st.picks.filter((p) => p.status === 'OPEN' && Date.parse(p.start_at) < Date.now() - 90 * 60e3);
  const diag = { vencidas: open.length, ok: 0, sin_resultado: 0, sin_stats: 0, void_tiempo: 0, no_final: 0 };
  if (!open.length) return { settled: 0, diag };
  const sl = await slate({ force: true }).catch(() => G.slate);
  const closes = rd('closes.json') || { closes: {} };
  const d = D.build(); const F = d.F;
  let settled = 0;
  for (const p of open) {
    try {
      if (Date.parse(p.start_at) < Date.now() - voidDays * 864e5) { p.status = 'SETTLED'; p.result = 'VOID'; p.units = 0; p.void_reason = p.unsettleable ? 'familia sin fuente de liquidación fuera del Players Championship' : `sin resultado casado en ${voidDays} días`; p.settled_at = new Date().toISOString(); settled++; diag.void_tiempo++; continue; }
      let fx;
      if (p.circuit === 'modus') {
        // MODUS: el marcador lo da Flashscore (la PDC no lo publica); la fila se construye con la misma forma
        const r = await MODUS.result(p);
        if (!r) { diag.sin_resultado++; continue; }
        if (r.pending) { diag.no_final++; continue; }
        fx = { id: p.event_id, status: 'Result', score_a: r.score_a, score_b: r.score_b, winner_id: null, a: { id: p.a_id }, b: { id: p.b_id }, start_at: p.start_at, _src: r.source };
      } else fx = (sl && sl.fixtures || []).find((f) => String(f.id) === String(p.event_id));
      if (!fx) { diag.sin_resultado++; continue; }
      if (fx.status !== 'Result') { diag.no_final++; continue; }
      const sa = +fx.score_a, sb = +fx.score_b;
      if (!Number.isFinite(sa) || !Number.isFinite(sb)) { diag.sin_resultado++; continue; }
      const aWon = fx.winner_id ? String(fx.winner_id) === String(fx.a.id) : sa > sb;
      let win = null;
      const isSets = p.format && p.format.kind === 'sets';
      if (p.family === 'ML') win = p.side === 'a' ? (aWon ? 1 : 0) : (aWon ? 0 : 1);
      else if (p.family === 'LEGS_TOTAL' && !isSets) { const tot = sa + sb; win = p.side === 'over' ? (tot > p.line ? 1 : tot === p.line ? null : 0) : (tot < p.line ? 1 : tot === p.line ? null : 0); }
      else if (p.family === 'LEGS_HCP' && !isSets) { const v = (sa - sb) + p.line; win = p.side === 'a' ? (v > 0 ? 1 : v === 0 ? null : 0) : ((sb - sa) + p.line > 0 ? 1 : (sb - sa) + p.line === 0 ? null : 0); }
      else if (p.family === 'SETS_TOTAL' && isSets) { const tot = sa + sb; win = p.side === 'over' ? (tot > p.line ? 1 : tot === p.line ? null : 0) : (tot < p.line ? 1 : tot === p.line ? null : 0); }
      else if (p.family === 'SETS_HCP' && isSets) { const v = (sa - sb) + p.line; win = p.side === 'a' ? (v > 0 ? 1 : v === 0 ? null : 0) : ((sb - sa) + p.line > 0 ? 1 : (sb - sa) + p.line === 0 ? null : 0); }
      else if (/^X180/.test(p.family)) {
        // 180s: de la base propia (Orakel PC) — la fila del partido con x180 de los dos
        const day = +String(fx.start_at).slice(0, 10).replace(/-/g, '');
        const row = d.rows.find((r) => r[F.fid] === String(fx.id) || (Math.abs(r[F.date] - day) <= 3 && ((r[F.wid] === String(fx.a.id) && r[F.lid] === String(fx.b.id)) || (r[F.wid] === String(fx.b.id) && r[F.lid] === String(fx.a.id)))));
        if (!row || row[F.w_x180] == null || row[F.l_x180] == null) { diag.sin_stats++; continue; }
        const xa = row[F.wid] === String(fx.a.id) ? row[F.w_x180] : row[F.l_x180], xb = row[F.wid] === String(fx.b.id) ? row[F.w_x180] : row[F.l_x180];
        if (p.family === 'X180_TOTAL') { const tot = xa + xb; win = p.side === 'over' ? (tot > p.line ? 1 : tot === p.line ? null : 0) : (tot < p.line ? 1 : tot === p.line ? null : 0); }
        else if (p.family === 'X180_MOST') win = p.side === 'tie' ? (xa === xb ? 1 : 0) : p.side === 'a' ? (xa > xb ? 1 : 0) : (xb > xa ? 1 : 0);
        else if (p.family === 'X180_PLAYER') { const x = p.participant === 'a' ? xa : xb; win = p.side === 'over' ? (x > p.line ? 1 : x === p.line ? null : 0) : (x < p.line ? 1 : x === p.line ? null : 0); }
        p.final_180 = { a: xa, b: xb };
      } else { diag.sin_stats++; continue; }
      p.status = 'SETTLED'; p.result = win == null ? 'PUSH' : win ? 'WIN' : 'LOSS';
      p.final = { score_a: sa, score_b: sb, winner: aWon ? 'a' : 'b', source: fx._src || 'pdc' };
      p.units = win == null ? 0 : win ? +(p.odds - 1).toFixed(3) : -1;
      const cl = closes.closes[p.event_id];
      if (cl) {
        const same = (cl.rows || []).filter((x) => x.family === p.family && x.side === p.side && (x.participant || null) === (p.participant || null) && (p.line == null || x.line === p.line));
        const best = same.reduce((b2, x) => (!b2 || x.odds > b2.odds ? x : b2), null);
        const pin = same.find((x) => x.book === 'pinnacle');
        if (best) { p.close_price = best.odds; p.clv_pct = +((p.odds / best.odds - 1) * 100).toFixed(2); p.close_source = best.book; }
        if (pin) { p.close_pin = pin.odds; p.clv_pin_pct = +((p.odds / pin.odds - 1) * 100).toFixed(2); }
        if (!best) p.close_missing = 'línea no cotizada al cierre';
        // 9-sep (traído de tenis de mesa): la MISMA casa de la pick y la curva por cubo (own/best/pinnacle)
        const own = same.find((x) => x.book === p.book);
        if (own) { p.close_own = own.odds; p.clv_own_pct = +((p.odds / own.odds - 1) * 100).toFixed(2); }
        if (cl.series) p.close_series = Object.fromEntries(Object.entries(cl.series).map(([k, s]) => {
          const s2 = (s.rows || []).filter((x) => x.family === p.family && x.side === p.side && (x.participant || null) === (p.participant || null) && (p.line == null || x.line === p.line));
          const bst = s2.reduce((b2, x) => (!b2 || x.odds > b2.odds ? x : b2), null), ownS = s2.find((x) => x.book === p.book), pinS = s2.find((x) => x.book === 'pinnacle');
          return [k, { at: s.at, own: ownS ? ownS.odds : null, best: bst ? bst.odds : null, pinnacle: pinS ? pinS.odds : null }];
        }));
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
  const byFam = {}, byFB = {}, byCirc = {};
  for (const p of done) {
    const Fm = byFam[p.family] = byFam[p.family] || { n: 0, w: 0, units: 0, clv: [], own: [] };
    Fm.n++; if (p.result === 'WIN') Fm.w++; Fm.units += p.units || 0; if (p.clv_pct != null) Fm.clv.push(p.clv_pct);
    if (p.clv_own_pct != null) Fm.own.push(p.clv_own_pct);   // 9-sep: CLV contra la misma casa
    // por circuito × familia: MODUS y PDC nunca en la misma media
    const ck = (p.circuit || 'pdc') + ' · ' + p.family;
    const Cc = byCirc[ck] = byCirc[ck] || { n: 0, w: 0, units: 0, clv: [], book: null, family: p.family, circuit: p.circuit || 'pdc' };
    Cc.n++; if (p.result === 'WIN') Cc.w++; Cc.units += p.units || 0; if (p.clv_pct != null) Cc.clv.push(p.clv_pct);
    const bk = p.book || 'sin_casa';
    const B = byFB[p.family + ' · ' + bk] = byFB[p.family + ' · ' + bk] || { n: 0, w: 0, units: 0, clv: [], book: bk, family: p.family };
    B.n++; if (p.result === 'WIN') B.w++; B.units += p.units || 0; if (p.clv_pct != null) B.clv.push(p.clv_pct);
  }
  const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return r2(Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1))); };
  const fam = (o) => Object.fromEntries(Object.entries(o).map(([k, Fm]) => [k, { ...(Fm.book ? { family: Fm.family, book: Fm.book } : {}), n: Fm.n, hit_pct: Fm.n ? r2(100 * Fm.w / Fm.n) : null, units: r2(Fm.units), clv_avg_pct: Fm.clv.length ? r2(Fm.clv.reduce((a, b) => a + b, 0) / Fm.clv.length) : null, clv_n: Fm.clv.length, clv_sd: sd(Fm.clv),
    ...(Fm.own ? { clv_own_avg_pct: Fm.own.length ? r2(Fm.own.reduce((a, b) => a + b, 0) / Fm.own.length) : null, clv_own_n: Fm.own.length } : {}),
    note: k === 'ML' ? 'familia de referencia (benchmark), jamás pick' : undefined }]));
  // 9-sep: la curva de cierre por cubo (own/best/pinnacle) por familia
  const clvCurve = (() => { try { const CL = require('../implied-engine/closes'); const byF = {}; for (const p of done) (byF[p.family] = byF[p.family] || []).push(p); return Object.fromEntries(Object.entries(byF).map(([f, l]) => [f, CL.summarize(l.filter((p) => p.close_series).map((p) => ({ odds: p.odds, closes: { buckets: p.close_series } })))])); } catch { return null; } })();
  return {
    regime: 'shadow', doctrine: DOCTRINE,
    open: mine.filter((p) => p.status === 'OPEN').length, open_list: mine.filter((p) => p.status === 'OPEN').slice(-Math.max(30, limit)).reverse(),
    settled: done.length, w, l, push: done.filter((p) => p.result === 'PUSH').length, voided: mine.filter((p) => p.result === 'VOID').length,
    units: r2(units), roi_pct: done.length ? r2(100 * units / done.length) : null,
    clv_avg_pct: clv.length ? r2(clv.reduce((s, p) => s + p.clv_pct, 0) / clv.length) : null, clv_n: clv.length,
    by_family: fam(byFam), by_family_book: fam(byFB), clv_curve: clvCurve,
    by_circuit: Object.fromEntries(Object.entries(byCirc).map(([k, Cc]) => [k, { circuit: Cc.circuit, family: Cc.family, n: Cc.n, hit_pct: Cc.n ? r2(100 * Cc.w / Cc.n) : null, units: r2(Cc.units), clv_avg_pct: Cc.clv.length ? r2(Cc.clv.reduce((a, b) => a + b, 0) / Cc.clv.length) : null, clv_n: Cc.clv.length, clv_sd: sd(Cc.clv) }])),
    open_by_circuit: mine.filter((p) => p.status === 'OPEN').reduce((m, p) => { const c = p.circuit || 'pdc'; m[c] = (m[c] || 0) + 1; return m; }, {}),
    recent: done.slice(-limit).reverse(),
    reading: done.length < 40 ? `con ${done.length} liquidadas TODO es ruido: esta pantalla acumula el registro, no se lee todavía.` : 'la vara es el CLV por familia, no el ROI.',
    settle_diag: settleDiag,
  };
}

// ══ 8. CATÁLOGO ═════════════════════════════════════════════════════════════════════════════════════════
function playersDirectory({ q = '', limit = 80, minMatches = 10 } = {}) {
  const d = D.build(); const T = d.T;
  const nq = norm(q);
  const rows = [];
  for (const [id, prof] of T.prof) {
    const p = d.players[id]; if (!p) continue;
    if (nq && !norm(p.name).includes(nq)) continue;
    if (prof.w + prof.l < minMatches) continue;
    const sk = skillOf(id);
    rows.push({ id, name: p.name, country: p.country, photo: p.photo || null, nickname: p.nickname || null, tour_card: !!p.tour_card, oom_rank: p.oom_rank || null,
      elo: Math.round(T.elo.get(id) || 1500), wl: prof.w + '-' + prof.l, avg: r2(sk.avg), per180_visit: sk.per180Visit != null ? r3(sk.per180Visit) : null, checkout_pct: r3(sk.checkoutPct), cold: sk.cold,
      last: prof.lastDate, inactive: prof.lastDate < +new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10).replace(/-/g, '') });
  }
  rows.sort((x, y) => y.elo - x.elo);
  return { rows: rows.slice(0, limit), total: rows.length, attribution: ATTRIB, freshness: d.meta.last_match_date };
}
function rankingBoard() {
  const dir = playersDirectory({ limit: 120, minMatches: 15 });
  const snap = rd('rank-snap.json') || {};
  const prev = snap.order || [];
  const rows = dir.rows.filter((r) => !r.inactive).slice(0, 64).map((r, i) => { const was = prev.indexOf(r.id); return { pos: i + 1, ...r, move: was >= 0 ? was - i : null }; });
  return { rows, snapshot_at: snap.at || null, attribution: ATTRIB, freshness: dir.freshness, note: 'ranking por Elo propio de GP (resultados de la PDC, todos los circuitos) — no es el Order of Merit, que aparece al lado. La flecha compara contra la foto semanal anterior.' };
}
function snapshotRanks() {
  const snap = rd('rank-snap.json') || {};
  if (snap.at && Date.now() - Date.parse(snap.at) < 6.5 * 864e5) return { changed: false };
  const dir = playersDirectory({ limit: 120, minMatches: 15 });
  wr('rank-snap.json', { at: new Date().toISOString(), order: dir.rows.filter((r) => !r.inactive).slice(0, 64).map((r) => r.id) });
  return { changed: true };
}
function playerProfile(id) {
  const d = D.build(); const T = d.T;
  const p = d.players[String(id)], prof = T.prof.get(String(id));
  if (!p || !prof) return { available: false, why: 'jugador fuera de la base propia' };
  const sk = skillOf(id);
  const kk = kernelOf(sk, false);
  const age = p.dob ? Math.floor((Date.now() - Date.parse(p.dob)) / (365.25 * 864e5)) : null;
  // los 12 meses de forma: la media por mes desde las ventanas históricas de Orakel (90 d), si existen
  const o = orakel();
  const form = Object.keys(o.windows || {}).filter((k) => k.endsWith('|90') && o.windows[k][String(id)] && o.windows[k][String(id)]['25']).sort().slice(-14).map((k) => ({ to: k.split('|')[0], avg: o.windows[k][String(id)]['25'][2], darts: o.windows[k][String(id)]['25'][1], x180: (o.windows[k][String(id)]['26'] || [])[2] || null }));
  return {
    available: true, id: String(id), name: p.name, country: p.country, photo: p.photo || null, nickname: p.nickname || null, dob: p.dob || null, age, hometown: p.hometown || null, darts: p.darts || null, dart_weight: p.dart_weight || null, started: p.started || null, tour_card: !!p.tour_card, oom_rank: p.oom_rank || null, prize: p.prize || null, nine_darters: p.nine_darters || null,
    elo: Math.round(T.elo.get(String(id)) || 1500), wl: { w: prof.w, l: prof.l }, legs: { won: prof.legsWon, lost: prof.legsLost }, titles: prof.titles, best_avg: r2(prof.bestAvg) || null, x180_total: prof.x180Total,
    skill: { avg: r2(sk.avg), per180_visit: sk.per180Visit != null ? r3(sk.per180Visit) : null, checkout_pct: r3(sk.checkoutPct), exposure_darts: sk.exposure_darts, source: sk.source, cold: sk.cold, as_of: sk.as_of, windows: sk.windows },
    kernel: { fitted: { avg3: r2(kk.fitted.avg3), x180_leg: r3(kk.fitted.exp180), darts_leg: r2(kk.fitted.expDarts) }, identified: kk.identified, doubles: kk.leg.dbl.slice(0, 8).map(([k, pr]) => [k, r3(pr)]), checkout_pmf: kk.leg.checkout.filter(([, pr]) => pr > 0.004).map(([k, pr]) => [k, r3(pr)]), visits_pmf: Array.from(kk.leg.visits).map((pr, i) => [i, r3(pr)]).filter(([, pr]) => pr > 0.002), nine_dart_pct: r3(100 * kk.leg.visits[3]),
      scoring_visit: (() => { const pol = K.policyFor(kk.sk); const t = K.visitKernel(400, kk.sk, pol); const acc = new Map(); for (const x of t) acc.set(400 - x.to, (acc.get(400 - x.to) || 0) + x.p); return [...acc.entries()].sort((p, q) => p[0] - q[0]).filter(([, pr]) => pr > 0.003).map(([s, pr]) => [s, r3(pr)]); })() },
    form,
    recent: prof.recent.slice().reverse().map((m) => ({ date: m.d, opp: (d.players[String(m.opp)] || {}).name || m.opp, opp_id: String(m.opp), won: m.won, score: m.score, avg: m.avg, x180: m.x180, co: m.co, hc: m.hc, tourney: m.t, round: m.round })),
    last_date: prof.lastDate, inactive_note: prof.lastDate < +new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10).replace(/-/g, '') ? 'sin partidos recientes en la base: la incertidumbre del rating es alta' : null,
    attribution: ATTRIB, freshness: d.meta.last_match_date,
    index_note: 'media, 180s por visita y % de dobles: medidos en ventanas de 365 y 90 días; el kernel se calibra sobre ellos y produce la distribución de dobles, checkouts y visitas por leg. Composición interna reservada.',
  };
}
function h2h(idA, idB) {
  const d = D.build(); const F = d.F;
  const rows = []; let wA = 0, wB = 0;
  for (const r of d.rows) {
    const w = r[F.wid], l = r[F.lid];
    if (!((w === String(idA) && l === String(idB)) || (w === String(idB) && l === String(idA)))) continue;
    if (w === String(idA)) wA++; else wB++;
    rows.push({ date: r[F.date], winner: w === String(idA) ? 'a' : 'b', score: r[F.unit] === 'sets' ? `${r[F.w_sets]}-${r[F.l_sets]} sets` : `${r[F.w_legs]}-${r[F.l_legs]}`, tourney: (d.tourneys[r[F.tid]] || {}).name, round: r[F.round], avg_w: r[F.w_avg], avg_l: r[F.l_avg] });
  }
  return { w_a: wA, w_b: wB, rows: rows.slice(-12).reverse() };
}

// ══ 9. TORNEOS: cuadro y probabilidades de título ══════════════════════════════════════════════════════
async function tournamentBoard(id) {
  const sl = await slate();
  // MODUS: no hay cuadro de la PDC; la ficha es la lista del día con el modelo y el mercado de cada cruce
  if (String(id) === MODUS.TID) {
    const odds = await refreshOdds().catch(() => null);
    const fxs = MODUS.fixturesFromOdds(odds);
    const summary = MODUS.summary(fxs);
    if (!summary) return { available: false, why: 'sin partidos MODUS en las casas ahora mismo' };
    const fixtures = fxs.map((fx) => { const row = rowOf(fx); row.format = formatOf(fx); if (fx.a.id && fx.b.id) { const m = eventModel(fx); row.available = m.available; if (m.available) row.gp = { p_a: m.p_a, exp_legs: m.match.legs ? r2(m.match.legs.exp_total) : null, exp_sets: null }; else row.why = m.why; const mk = marketFor(fx, odds); row.market = { ml_p_a: mk.consensus.ml_p_a, n_books: mk.n_books }; } else { row.available = false; row.why = 'jugador fuera de la base propia: ' + (fx.unresolved || []).join(', '); } return row; });
    return { available: true, ...summary, stages: [{ stage: 'Liga', sets: 1, legs: MODUS.BEST_OF, two_clear: false, fixtures }], title: null, outrights: [], attribution: ATTRIB + ' Circuito MODUS: fixtures de las casas, resultado por Flashscore.', doctrine: DOCTRINE };
  }
  let t = sl.details.find((x) => String(x.id || x.tournamentID) === String(id));
  if (!t) { try { t = await PDC.tournament(id); } catch { return { available: false, why: 'torneo no encontrado' }; } }
  const summary = tourSummary(t);
  const odds = await refreshOdds().catch(() => null);
  const stages = (t.stages || []).map((s) => ({ stage: (s.stage || {}).name, sets: s.numberOfSets, legs: s.numberOfLegsPerSet, two_clear: !!s.twoClearLegsToWin,
    fixtures: (s.fixtures || []).map((f) => { const fx = PDC.normFixture(f, { tournamentID: summary.id, name: t.name, isTelevised: t.isTelevised, isRanked: t.isRanked }, s); const row = rowOf(fx); row.format = formatOf(fx); if (fx.a.id && fx.b.id && fx.status !== 'Result') { const m = eventModel(fx); if (m.available) row.gp = { p_a: m.p_a, exp_legs: m.match.legs ? r2(m.match.legs.exp_total) : null, exp_sets: m.match.sets ? r2(m.match.sets.exp_total) : null }; const mk = marketFor(fx, odds); row.market = { ml_p_a: mk.consensus.ml_p_a, n_books: mk.n_books }; } return row; }) }));
  // orden natural del cuadro: de la ronda más temprana a la final
  const ORDER = ['First Round', 'Last 128', 'Last 64', 'Round 1', 'Round 2', 'Round 3', 'Round 4', 'Last 32', 'Last 16', 'Quarter-Final', 'Semi-Final', 'Final'];
  stages.sort((x, y) => ORDER.indexOf(x.stage) - ORDER.indexOf(y.stage));
  const title = titleProbs(stages);
  return { available: true, ...summary, stages, title, outrights: outrightsFor(t.name, odds), attribution: ATTRIB, doctrine: DOCTRINE };
}
// probabilidad de título: se simula el cuadro que queda (emparejando ganadores en el orden de la PDC) con
// las probabilidades del modelo; los cruces ya jugados fijan al ganador
function titleProbs(stages) {
  const rem = stages.filter((s) => s.fixtures.length);
  if (!rem.length) return null;
  // el "alimentador" de cada ronda: los ganadores de la ronda anterior, en orden, de dos en dos
  let dist = null; // Map(playerId → prob) por posición del cuadro
  let slots = null;
  for (let si = 0; si < rem.length; si++) {
    const s = rem[si];
    const nextSlots = [];
    for (let i = 0; i < s.fixtures.length; i++) {
      const f = s.fixtures[i];
      let candA = f.a_id ? new Map([[f.a_id, 1]]) : (slots ? slots[2 * i] : null);
      let candB = f.b_id ? new Map([[f.b_id, 1]]) : (slots ? slots[2 * i + 1] : null);
      const out = new Map();
      if (f.status === 'Result' && f.winner_id) { out.set(String(f.winner_id), 1); nextSlots.push(out); continue; }
      if (!candA || !candB) { nextSlots.push(new Map()); continue; }
      const fmt = f.format;
      for (const [pa, wa] of candA) for (const [pb, wb] of candB) {
        if (!(wa > 1e-4 && wb > 1e-4)) continue;
        let p = 0.5;
        try { const m = eventModel({ a: { id: pa, name: '' }, b: { id: pb, name: '' }, tournament: f.tournament, stage: f.stage, format: fmt && fmt.kind ? { sets: fmt.kind === 'sets' ? fmt.best_of_sets : 1, legs_per_set: fmt.kind === 'sets' ? fmt.legs_per_set : fmt.best_of, two_clear: !!fmt.two_clear } : null }); if (m.available) p = m.p_a; } catch { }
        out.set(pa, (out.get(pa) || 0) + wa * wb * p); out.set(pb, (out.get(pb) || 0) + wa * wb * (1 - p));
      }
      nextSlots.push(out);
    }
    slots = nextSlots;
  }
  const final = slots && slots[0];
  if (!final) return null;
  const d = D.build();
  return [...final.entries()].filter(([, p]) => p > 0.002).sort((x, y) => y[1] - x[1]).slice(0, 16).map(([id, p]) => ({ id, name: (d.players[id] || {}).name || id, photo: (d.players[id] || {}).photo || null, p: r3(p) }));
}
function outrightsFor(name, odds) {
  if (!odds) return null;
  const nm = norm(name).replace(/^\d{4}\s*/, '');
  const bov = (odds.outrights.bovada || []).filter((o) => norm(o.event).includes(nm.split(' ').slice(-2).join(' ')) || nm.includes(norm(o.event).slice(0, 12)));
  return bov.length ? bov.slice(0, 20).map((o) => ({ book: 'bovada', participant: o.participant, odds: o.odds })) : null;
}
async function tournamentsList() {
  const tours = await seasonTournaments();
  const now = Date.now();
  const rows = tours.filter((t) => !isSecondary(t) && Date.parse(t.endDate || t.startDate) > now - 30 * 864e5).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate)).slice(0, 40)
    .map((t) => ({ id: String(t.id || t.tournamentID), name: t.name, venue: t.venue, city: t.city, start: t.startDate, end: t.endDate, tv: !!t.isTelevised, ranked: !!t.isRanked, logo: PDC.IMG(t.tournamentLogo), fixtures: t.fixtureCount || null, double_in: /grand prix/i.test(String(t.name || '')), state: Date.parse(t.startDate) > now ? 'upcoming' : Date.parse(t.endDate || t.startDate) + 864e5 > now ? 'live' : 'done', circuit: 'pdc' }));
  const m = MODUS.summary(MODUS.fixturesFromOdds(G.odds));
  if (m) rows.unshift({ ...m, state: 'live' });
  return { rows, attribution: ATTRIB };
}

// ══ 10. SIMULADOR ═══════════════════════════════════════════════════════════════════════════════════════
function simMatch(refA, refB, { format = 'bo11', starter = null } = {}) {
  const A = D.resolvePlayer(refA), B = D.resolvePlayer(refB);
  if (!A || !B) return { available: false, why: `no encuentro a ${!A ? refA : refB} en la base propia` };
  if (A.id === B.id) return { available: false, why: 'los dos nombres resuelven al mismo jugador' };
  const fmt = parseFormat(format);
  const fx = { id: `sim-${A.id}-${B.id}`, a: { id: A.id, name: A.name }, b: { id: B.id, name: B.name }, tournament: fmt.double_in ? 'World Grand Prix (simulado)' : 'simulado', stage: null, format: { sets: fmt.kind === 'sets' ? fmt.best_of_sets : 1, legs_per_set: fmt.kind === 'sets' ? fmt.legs_per_set : fmt.best_of, two_clear: !!fmt.two_clear } };
  const model = eventModel(fx, { starter });
  if (!model.available) return { available: false, why: model.why };
  const m = model.match;
  const trim = (pmf, eps = 0.002) => pmf.filter(([, p]) => p > eps).map(([k, p]) => [k, r3(p)]);
  const cA = kernelOf(model.skills.a, fmt.double_in), cB = kernelOf(model.skills.b, fmt.double_in);
  return {
    available: true, format: { ...fmt, label: format }, starter: m.starter,
    a: { id: A.id, name: A.name, country: A.country, photo: A.photo || null }, b: { id: B.id, name: B.name, country: B.country, photo: B.photo || null },
    p_a: model.p_a, p_a_compiled: model.p_a_compiled, p_a_elo: model.p_a_elo, unc_pp: model.unc_pp, scenarios: m.scenarios,
    leg: { hold_a: r3(m.leg.hold_a), hold_b: r3(m.leg.hold_b), break_a: r3(m.leg.break_a), break_b: r3(m.leg.break_b) },
    legs: m.legs ? { exp_total: r2(m.legs.exp_total), total: trim(m.legs.total), margin: trim(m.legs.margin), score: m.legs.score.filter(([, p]) => p > 0.005).map(([k, p]) => [k, r3(p)]) } : null,
    sets: m.sets ? { exp_total: r2(m.sets.exp_total), total: trim(m.sets.total), score: m.sets.score.filter(([, p]) => p > 0.005).map(([k, p]) => [k, r3(p)]) } : null,
    x180: { exp_a: r2(m.x180.exp_a), exp_b: r2(m.x180.exp_b), most_a: r3(m.x180.most_a), most_b: r3(m.x180.most_b), tie: r3(m.x180.tie), total: trim(m.x180.total) },
    checkout_max: { match: [100, 120, 140, 160, 170].map((c) => [c, r3(C.checkoutOver(m.checkout_max.match, c - 1))]) },
    skills: { a: { avg: r2(model.skills.a.avg), per180_visit: r3(model.skills.a.per180Visit), checkout_pct: r3(model.skills.a.checkoutPct), elo: model.skills.a.elo }, b: { avg: r2(model.skills.b.avg), per180_visit: r3(model.skills.b.per180Visit), checkout_pct: r3(model.skills.b.checkoutPct), elo: model.skills.b.elo } },
    format_prism: formatPrism(cA.leg, cB.leg, fmt),
    h2h: h2h(A.id, B.id),
    sample_leg: K.sampleLeg(cA.sk, cB.sk, { starter: starter || 'a', doubleIn: fmt.double_in }),
    note: 'compilado visita → leg → set → partido con las reglas exactas del 501: ganador, legs, 180s y checkout salen del mismo estado. Estimaciones de un modelo estadístico — no consejo financiero.',
    attribution: ATTRIB,
  };
}
function parseFormat(s) {
  const x = String(s || 'bo11').toLowerCase();
  if (/^wgp|grand ?prix/.test(x)) { const m = x.match(/(\d+)/); return { ...R.setsFormat(m ? +m[1] : 5), double_in: true }; }
  if (/sets?/.test(x)) { const m = x.match(/(\d+)/); const n = m ? +m[1] : 7; return { ...R.setsFormat(n, 5, n >= 13 ? { finalSetTwoClear: true, finalSetMaxLegs: 11 } : {}), double_in: false }; }
  if (/matchplay|2clear|two/.test(x)) { const m = x.match(/(\d+)/); const n = m ? +m[1] : 19; return { ...R.legsFormat(n, { twoClear: true, maxLegs: n + 6 }), double_in: false }; }
  const m = x.match(/(\d+)/); return { ...R.legsFormat(m ? +m[1] : 11), double_in: false };
}

// ══ 11. AGENDA DEL DÍA (con vivo) ═══════════════════════════════════════════════════════════════════════
async function agenda() {
  const sl = await slate();
  const now = Date.now();
  const rows = fixturesAll(sl).filter((f) => Math.abs(Date.parse(f.start_at || 0) - now) < 30 * 3600e3).map(rowOf);
  try { const live = await FLASH.feed(); for (const r of rows) { const hit = FLASH.matchByNames(live, r.a, r.b); if (hit && hit.state !== 'scheduled') r.live = { state: hit.state, legs_a: hit.swapped ? hit.legs_b : hit.legs_a, legs_b: hit.swapped ? hit.legs_a : hit.legs_b, best_of: hit.best_of }; } } catch { }
  return { rows, at: new Date(sl.at).toISOString(), attribution: ATTRIB };
}
// probabilidad EN VIVO desde un marcador de legs (formato de legs): la misma carrera compilada desde el estado
function liveProb(fixtureId, { legs_a, legs_b, starter_next = null } = {}) {
  const sl = G.slate; if (!sl) return null;
  const fx = fixturesAll(sl).find((f) => String(f.id) === String(fixtureId)); if (!fx) return null;
  const model = eventModel(fx); if (!model.available || model.format.kind !== 'legs') return null;
  const cA = kernelOf(model.skills.a, model.format.double_in), cB = kernelOf(model.skills.b, model.format.double_in);
  const race = C.legRace(cA.leg, cB.leg);
  const run = (s) => C.summarize(C.runLegs(race, model.format, s, { la0: legs_a, lb0: legs_b }), model.format);
  const pa = starter_next ? run(starter_next).p_a : (run('a').p_a + run('b').p_a) / 2;
  return { p_a: r3(pa), from: { legs_a, legs_b }, p_a_prematch: model.p_a_compiled };
}

// ══ 12. EL MOTOR (ficha) ════════════════════════════════════════════════════════════════════════════════
function modelCard() {
  const d = D.build(); const H = d.priors.holdout || null;
  const o = orakel();
  return {
    name: 'Modelo de dardos GP', version: (d.priors || {}).model_version || 'darts-l1-0', family: 'modelo propio de GP — composición reservada', doctrine: DOCTRINE,
    base: { matches: d.rows.length, players: Object.keys(d.players).length, tourneys: Object.keys(d.tourneys).length, window: d.meta.years, freshness: d.meta.last_match_date, orakel_as_of: o.latest || null, sources: ['API pública de la PDC (calendario, formato por ronda, resultados)', 'Darts Orakel (media, 180s, dobles por ventana de fechas)'], level: 'L1 — estadística de partido: permite perfiles regularizados y kernels agregados; no reconstruye rutas ni misses (blueprint §5.1)' },
    mechanism: { atom: 'una decisión de objetivo y un resultado de lanzamiento; visita de hasta tres dardos con bust exacto (vuelta al inicio de la visita), double-out y double-in', leg: 'carrera alternada con absorción: P(A gana | A sale) = Σ P(T_A = k)·P(T_B ≥ k), con 180s y checkout llevados junto a T', match: 'compilador de legs y sets con saque alterno por leg y por set, dos legs de diferencia y muerte súbita', markets: Object.keys(FAMILIES) },
    validation: H ? H : { status: 'pendiente', note: 'la validación walk-forward (Elo cronológico vs compilador vs mezcla, con holdout intocable) se ejecuta con scripts/darts-fit.js y se congela en model-priors.json antes de cualquier lectura de la sombra.' },
    families: Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, v.benchmark ? 'referencia (benchmark), jamás pick' : v.display_only ? 'solo display' : 'sombra'])),
    known_gaps: ['180s y checkout solo liquidables donde Orakel publica el partido (Players Championship); en el resto la tesis se anota y queda a la espera de fuente', 'arrastre dentro de la visita (rho) identificado solo con tasa de 180s; sin ella, prior de población', 'el kernel regional sobreestima el 9-darter ~3×; no afecta a legs/ganador', 'orden de saque del primer leg desconocido: se publica la mezcla 50/50 y los dos escenarios'],
    disclaimer: 'estimaciones de un modelo estadístico, no consejo financiero.',
  };
}
async function modelSnapshot() {
  const d = D.build();
  // muestra cruda de Cloudbet (dos eventos con sus filas): la respuesta a "¿no cotiza o no leemos?"
  const cbSample = G.odds ? G.odds.events.filter((e) => e.book === 'cloudbet' && (e.rows || []).length).slice(0, 2).map((e) => ({ a: e.a, b: e.b, start_at: e.start_at, competition: e.competition, raw_keys: e.raw_keys, rows: (e.rows || []).slice(0, 24).map((r) => ({ family: r.family, side: r.side, line: r.line, odds: r.odds, participant: r.participant, market_key: r.market_key, params: r.params })) })) : null;
  return { base: { rows: d.rows.length, players: Object.keys(d.players).length, freshness: d.meta.last_match_date, orakel_as_of: orakel().latest }, slate: G.slate ? { at: new Date(G.slate.at).toISOString(), fixtures: G.slate.fixtures.length, tournaments: G.slate.tournaments.map((t) => t.name) } : null, odds: G.odds ? { at: new Date(G.odds.at).toISOString(), events: G.odds.events.length, books: G.odds.books, cloudbet_keys: G.odds.cloudbet_keys, cloudbet_sample: cbSample } : null, calib_cache: CALIB.size, track: track({ limit: 5 }), disk: DISK_DIR };
}

module.exports = { DISK_DIR, DOCTRINE, ATTRIB, FAMILIES, resetOrakel, slate, seasonTournaments, refreshOdds, marketFor, eventModel, evaluateEdges, board, matchDetail, recordShadow, settleShadow, track, playersDirectory, rankingBoard, snapshotRanks, playerProfile, h2h, tournamentBoard, tournamentsList, simMatch, agenda, liveProb, modelCard, modelSnapshot, skillOf, formatOf, parseFormat };
