// tennis-engine/store.js — EL TERMINAL DE TENIS (blueprint 6.0): agenda, mercado, sombra y catálogo
//
// Mecánica de la casa, calcada de NFL/amfoot: modelo market-blind POR CONSTRUCCIÓN (ninguna cuota
// entra a la probabilidad), TODAS las familias en SOMBRA, registro privado con CLV contra el cierre
// capturado, y catálogo servido solo con EVIDENCIA (caja negra: nada de constantes ni fórmulas).
// El calendario/las parejas salen del propio feed de cuotas (The Odds API publica por TORNEO, con
// descubrimiento dinámico de claves activas) + ESPN para agenda del día y liquidación.
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('./data.js');
const C = require('./compiler.js');

const DISK_DIR = fs.existsSync('/data') ? '/data/tennis' : path.join(__dirname, '..', 'data', 'tennis', 'disk');
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const G = { odds: null, sports: null, espn: {}, sb: {} };

const DOCTRINE = 'todas las familias de tenis están EN SOMBRA: el modelo (walk-forward 2015-2024, holdout 2025→) bate a ranking y Elo puro fuera de muestra, pero contra el MERCADO no hay prueba todavía — eso es exactamente lo que la sombra va a medir, familia por familia, con CLV contra el cierre capturado. El ganador se registra como familia de referencia (benchmark de calidad), jamás como pick. Base propia derivada del proyecto de Jeff Sackmann (CC BY-NC-SA 4.0): tenis es admin-only y sin uso comercial hasta que exista fuente licenciada.';

function rdD(f) { try { return JSON.parse(fs.readFileSync(path.join(DISK_DIR, f), 'utf8')); } catch { return null; } }
function wrD(f, obj) {
  try {
    fs.mkdirSync(DISK_DIR, { recursive: true });
    const tmp = path.join(DISK_DIR, '.' + f + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, path.join(DISK_DIR, f));
  } catch { }
}

// ── TORNEOS: superficie y formato por clave de The Odds API (fallback: dura, bo3) ────────────────────────
const SURF_BY_KEY = [
  [/french_open|monte_carlo|madrid|italian|barcelona|munich|hamburg|charleston|strasbourg|stuttgart/, 1],
  [/wimbledon|halle|queens|bad_homburg|german_open/, 2],
]; // el resto: dura (0)
const surfOfKey = (k) => { for (const [re, s] of SURF_BY_KEY) if (re.test(k)) return s; return 0; };
const bo5Keys = /tennis_atp_(aus_open|french_open|wimbledon|us_open)/;
const tourOfKey = (k) => (k.startsWith('tennis_wta') ? 1 : 0);

// ── CUOTAS: descubrimiento dinámico de torneos activos + 1 llamada por torneo ───────────────────────────
const ODDS_TTL = 30 * 60e3, SPORTS_TTL = 12 * 3600e3;
async function activeTennisKeys() {
  const key = process.env.SPORTSBOOK_PROVIDER_API_KEY || '';
  if (!key) return [];
  if (G.sports && Date.now() - G.sports.at < SPORTS_TTL) return G.sports.keys;
  const st = rdD('sports-cache.json');
  if (st && Date.now() - st.at < SPORTS_TTL) { G.sports = st; return st.keys; }
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${key}&all=true`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (!Array.isArray(j)) return (st || {}).keys || [];
    const keys = j.filter((s) => s.active && /^tennis_(atp|wta)_/.test(s.key)).map((s) => ({ key: s.key, title: s.title }));
    G.sports = { at: Date.now(), keys };
    wrD('sports-cache.json', G.sports);
    return keys;
  } catch { return (st || G.sports || {}).keys || []; }
}

async function refreshOdds({ force = false } = {}) {
  const key = process.env.SPORTSBOOK_PROVIDER_API_KEY || '';
  if (!key) return null;
  if (G.odds && !force && Date.now() - G.odds.at < ODDS_TTL) return G.odds;
  const keys = await activeTennisKeys();
  if (!keys.length) { G.odds = { at: Date.now(), rows: [] }; return G.odds; }
  const rows = [];
  for (const s of keys) {
    try {
      const r = await fetch(`https://api.the-odds-api.com/v4/sports/${s.key}/odds?apiKey=${key}&regions=eu,us&markets=h2h,totals,spreads&oddsFormat=decimal`, { signal: AbortSignal.timeout(20000) });
      try { if (global._oddsCredits) { const v = Number(r.headers.get('x-requests-remaining')); if (Number.isFinite(v)) { global._oddsCredits.remaining = v; global._oddsCredits.at = Date.now(); } } } catch { }
      const j = await r.json();
      if (Array.isArray(j)) for (const ev of j) { ev._tkey = s.key; ev._ttitle = s.title; rows.push(ev); }
    } catch { }
  }
  G.odds = { at: Date.now(), rows };
  snapshotCloses(rows);
  return G.odds;
}

// mercados de UN evento, fundidos por casa, con consenso sin vig y mejor precio ejecutable
function marketOf(ev) {
  const pa = ev.home_team, pb = ev.away_team; // "home"/"away" son etiquetas del proveedor, no localía
  const out = { books: 0, ml: [], total: [], spread: [] };
  for (const bk of ev.bookmakers || []) {
    for (const mk of bk.markets || []) {
      if (mk.key === 'h2h') {
        const a = (mk.outcomes || []).find((o) => o.name === pa), b = (mk.outcomes || []).find((o) => o.name === pb);
        if (a && b) out.ml.push({ book: bk.key, a: a.price, b: b.price });
      }
      if (mk.key === 'totals') {
        const o = (mk.outcomes || []).find((x) => x.name === 'Over'), u = (mk.outcomes || []).find((x) => x.name === 'Under');
        if (o && u && o.point != null) out.total.push({ book: bk.key, line: o.point, over: o.price, under: u.price });
      }
      if (mk.key === 'spreads') {
        const a = (mk.outcomes || []).find((o) => o.name === pa), b = (mk.outcomes || []).find((o) => o.name === pb);
        if (a && b && a.point != null) out.spread.push({ book: bk.key, line: a.point, a: a.price, b: b.price });
      }
    }
  }
  out.books = (ev.bookmakers || []).length;
  const med = (xs) => { const s = xs.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : null; };
  const novig = (a, b) => { const ia = 1 / a, ib = 1 / b; return ia / (ia + ib); };
  out.consensus = {
    ml_p_a: out.ml.length ? r3(novig(med(out.ml.map((x) => x.a)), med(out.ml.map((x) => x.b)))) : null,
    total_line: med(out.total.map((x) => x.line)),
    spread_line: med(out.spread.map((x) => x.line)),
    books: out.books,
  };
  const best = (rows, side) => rows.reduce((bst, x) => (!bst || (x[side] || 0) > (bst[side] || 0) ? x : bst), null);
  out.best = {
    ml_a: best(out.ml, 'a'), ml_b: best(out.ml, 'b'),
    total_over: best(out.total.filter((x) => x.line === out.consensus.total_line), 'over'),
    total_under: best(out.total.filter((x) => x.line === out.consensus.total_line), 'under'),
    spread_a: best(out.spread.filter((x) => x.line === out.consensus.spread_line), 'a'),
    spread_b: best(out.spread.filter((x) => x.line === out.consensus.spread_line), 'b'),
  };
  return out;
}

// cierres: el último snapshot antes del comienzo ES el cierre (misma mecánica que NFL/esports)
function snapshotCloses(rows) {
  const st = rdD('closes.json') || { closes: {} };
  const now = Date.now();
  let dirty = false;
  for (const ev of rows) {
    const t = Date.parse(ev.commence_time || 0);
    if (!(t > now - 3600e3)) continue;
    const mk = marketOf(ev);
    st.closes[ev.id] = {
      a: ev.home_team, b: ev.away_team, tkey: ev._tkey, commence: ev.commence_time, at: new Date().toISOString(),
      ml_p_a: mk.consensus.ml_p_a, ml_a: mk.best.ml_a ? mk.best.ml_a.a : null, ml_b: mk.best.ml_b ? mk.best.ml_b.b : null,
      total_line: mk.consensus.total_line, total_over: mk.best.total_over ? mk.best.total_over.over : null, total_under: mk.best.total_under ? mk.best.total_under.under : null,
      spread_line: mk.consensus.spread_line, spread_a: mk.best.spread_a ? mk.best.spread_a.a : null, spread_b: mk.best.spread_b ? mk.best.spread_b.b : null,
    };
    dirty = true;
  }
  // limpieza: cierres de hace más de 30 días fuera
  for (const [id, c] of Object.entries(st.closes)) if (Date.parse(c.commence) < now - 30 * 864e5) { delete st.closes[id]; dirty = true; }
  if (dirty) wrD('closes.json', st);
}

// ── EL MODELO SOBRE UN EVENTO: resolver jugadores, compilar el partido, comparar con el mercado ─────────
function eventModel(ev) {
  const tn = tourOfKey(ev._tkey), surf = surfOfKey(ev._tkey);
  const bo = bo5Keys.test(ev._tkey) ? 5 : 3;
  const A = D.resolvePlayer(tn, ev.home_team), B = D.resolvePlayer(tn, ev.away_team);
  if (!A || !B || A.id === B.id) return { available: false, why: 'jugador fuera de la base propia (aún sin historial suficiente)', a: ev.home_team, b: ev.away_team };
  const mp = D.matchProb(tn, A.id, B.id, surf);
  const cst = D.build().T[tn].cst;
  const md = C.matchDist(mp.paSrv, mp.pbSrv, bo, cst.shock || 0);
  // ganador: ensamble congelado (mezcla en logit del Elo mixto y el compilado)
  const logit = (p) => Math.log(p / (1 - p)), sg = (x) => 1 / (1 + Math.exp(-x));
  const clampP = (p) => Math.max(1e-4, Math.min(1 - 1e-4, p));
  const u = cst.ensembleU || 0;
  const pA = sg((1 - u) * logit(clampP(mp.pMix)) + u * logit(clampP(md.pA)));
  const cal = (cst.gamesCal || {})[bo === 5 ? 'bo5' : 'bo3'] || [0, 1];
  return {
    available: true, tour: tn, surface: surf, best_of: bo,
    a: { id: A.id, name: A.name, ref: ev.home_team }, b: { id: B.id, name: B.name, ref: ev.away_team },
    p_a: r3(pA), dist: md, exp_games: r2(cal[0] + cal[1] * md.expGames), tb_any: r3(md.tbAny),
    hold_a: r3(md.holdA), hold_b: r3(md.holdB), p_set_a: r3(md.pSetA),
    model_version: (D.build().priors || {}).model_version || 'tennis-sr-1',
  };
}

// P(juegos > linea) y P(margen A > -linea) desde las distribuciones compiladas + calibración de juegos
function distProbs(model, totalLine, spreadLineA) {
  const md = model.dist;
  const shift = model.exp_games - md.expGames; // la calibración desplaza la dist (misma forma)
  let pOver = null, pushT = 0, pCoverA = null, pushS = 0;
  if (totalLine != null) {
    let over = 0, push = 0;
    for (const [g, p] of md.totalGames) { const gs = g + shift; if (gs > totalLine + 1e-9) over += p; else if (Math.abs(gs - totalLine) < 0.5) { if (Math.abs(gs - totalLine) < 1e-9) push += p; } }
    pOver = over; pushT = push;
  }
  if (spreadLineA != null) {
    let cover = 0, push = 0;
    for (const [m, p] of md.margin) { const v = m + spreadLineA; if (v > 1e-9) cover += p; else if (Math.abs(v) < 1e-9) push += p; }
    pCoverA = cover; pushS = push;
  }
  return { pOver, pushT, pCoverA, pushS };
}

// EL RETRASO DE LA BASE, QUE NO ES LO MISMO QUE UN JUGADOR PARADO (19-ago). Los repos de Sackmann fueron
// retirados de GitHub y el espejo que los sustituye es una INSTANTÁNEA: su último partido es del 25 de mayo
// de 2026. Es decir, la base no avanza — y el motor está puntuando Cincinnati sin Roland Garros, sin
// Wimbledon y sin toda la gira de pista rápida. Eso no es un detalle de mantenimiento: es forma de tres
// meses que el modelo no ha visto, y tiene que entrar en la incertidumbre de cada tesis y decirse en voz
// alta, no quedarse en una nota de linaje que nadie abre.
// Se traduce a puntos con una regla declarada, no ajustada: un punto porcentual de incertidumbre extra por
// cada 30 días de retraso, con tope de 4. No pretende ser una medición —no hay muestra para medirla— sino
// un impuesto honesto y acotado sobre una ventaja que se calcula con información vieja.
function baseLagDays() {
  try {
    const d = D.build();
    // `last_match_date` es un objeto por circuito ({atp, wta}); manda el MÁS ANTIGUO, que es el que de
    // verdad limita: si la base de la WTA se queda atrás, el retraso de la casa es ése.
    const lm = (d.meta && d.meta.last_match_date) || null;
    const vals = lm && typeof lm === 'object' ? Object.values(lm).map(String) : [String(lm || '')];
    const ok = vals.filter((x) => x.length === 8).sort();
    if (!ok.length) return null;
    const last = ok[0];
    const t = Date.UTC(+last.slice(0, 4), +last.slice(4, 6) - 1, +last.slice(6, 8));
    return Math.max(0, Math.round((Date.now() - t) / 864e5));
  } catch { return null; }
}
const lagUncPp = (lag) => (lag == null ? 0 : Math.min(4, lag / 30));

function gate(c) {
  const edgePp = (c.p_model - c.p_implied) * 100;
  const gates = [];
  // la incertidumbre epistémica del ganador se aproxima por el desacuerdo entre las dos vistas del
  // ensamble (Elo mixto vs compilado): si discrepan, la ventaja tiene que superar ese desacuerdo.
  // Y encima, el impuesto por lo vieja que esté la base: no es desacuerdo interno, es información ausente.
  const uncPp = Math.min(10, Math.abs((c.unc_pp != null ? c.unc_pp : 2)) + lagUncPp(c.base_lag_days));
  gates.push({ gate: 'edge', pass: edgePp >= 3, detail: 'listón mínimo 3 pp (con signo: solo el lado +EV)' });
  gates.push({ gate: 'noise', pass: edgePp > uncPp, detail: `${edgePp.toFixed(1)} pp vs desacuerdo interno ${uncPp.toFixed(1)} pp` });
  gates.push({ gate: 'orthogonality', pass: true, detail: 'modelo market-blind por construcción: el precio objetivo jamás es input' });
  gates.push({ gate: 'push', pass: (c.push_p || 0) < 0.06, detail: `push ${(100 * (c.push_p || 0)).toFixed(1)}%` });
  gates.push({ gate: 'freshness', pass: !c.stale, detail: c.stale ? 'jugador con >120 días sin jugar ANTES del final de la base: no es que falte el dato, es que no compitió' : 'ambos jugadores activos hasta donde llega la base' });
  // La vejez de la base NO cierra la tesis: tenis entero está en sombra y cerrar familias antes de tener
  // muestra es justo lo que esta casa decidió no volver a hacer. Se cobra en incertidumbre —arriba— y se
  // publica aquí, para que la revisión sepa con qué información se decidió cada una.
  gates.push({ gate: 'base_al_dia', pass: true, informativo: true,
    detail: c.base_lag_days == null ? 'sin fecha de corte en la base'
      : c.base_lag_days <= 21 ? `base al día (corte hace ${c.base_lag_days} días)`
      : `la base va ${c.base_lag_days} días por detrás del calendario real: +${lagUncPp(c.base_lag_days).toFixed(1)} pp de incertidumbre y forma reciente no vista` });
  const pass = gates.every((x) => x.pass);
  return {
    family: c.family, side: c.side, line: c.line != null ? c.line : null, odds: c.odds, book: c.book,
    p_model: r3(c.p_model), p_implied: r3(c.p_implied), edge_pp: r2(edgePp), gates,
    base_lag_days: c.base_lag_days != null ? c.base_lag_days : null, unc_pp: r2(uncPp),
    verdict: pass ? 'SHADOW_PICK' : 'NO_PICK',
    no_pick_reason: pass ? null : (gates.find((x) => !x.pass) || {}).gate,
    benchmark: c.family === 'ML' || undefined,
  };
}

function evaluateEdges(model, mk) {
  const out = [];
  const dec2p = (d) => 1 / d;
  const d = D.build();
  // LA REFERENCIA ES EL FINAL DE LA BASE, NO HOY (19-ago). Esta puerta pregunta "¿este jugador lleva
  // meses sin competir?" y la respuesta se buscaba contra la fecha de hoy. Con la base congelada el 25 de
  // mayo eso mide otra cosa: mide lo vieja que está la base, y la mide igual para TODOS. El efecto es una
  // puerta que primero no salta nunca —a 86 días de retraso, nadie llega a los 124— y que a partir de
  // finales de septiembre saltará para el campo entero el mismo día, sin que ningún jugador haya cambiado
  // nada. Ninguno de los dos estados dice nada del jugador.
  // Contra el ÚLTIMO PARTIDO DE LA BASE la pregunta vuelve a ser la original: de todo el tenis que la base
  // sí vio, ¿cuánto se lo perdió este jugador? Eso sí distingue a un lesionado de un activo. Lo que la base
  // no ha visto de NADIE es un problema aparte y se cobra aparte, en la incertidumbre.
  const dayNum = (s) => String(s).slice(0, 4) * 372 + +String(s).slice(4, 6) * 31 + +String(s).slice(6, 8);
  const lmCut = (d.meta && d.meta.last_match_date) || null;
  const cutTour = lmCut && typeof lmCut === 'object' ? String(lmCut[model.tour === 1 ? 'wta' : 'atp'] || '') : String(lmCut || '');
  const cut = cutTour.length === 8 ? cutTour : new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const staleOf = (id, tn) => { const p = d.T[tn].prof.get(id); if (!p) return true; return dayNum(cut) - dayNum(p.lastDate) > 124; };
  const stale = staleOf(model.a.id, model.tour) || staleOf(model.b.id, model.tour);
  const lag = baseLagDays();
  const uncPp = Math.abs(model.dist.pA - model.p_a) * 100 + 2; // desacuerdo compilado-vs-ensamble + suelo
  // ML — familia de REFERENCIA (benchmark de calidad; en sombra como las demás, jamás pick pública)
  if (mk.best.ml_a && mk.best.ml_b) {
    for (const side of ['a', 'b']) {
      const b = side === 'a' ? mk.best.ml_a : mk.best.ml_b;
      const odds = side === 'a' ? b.a : b.b;
      out.push(gate({ family: 'ML', side, odds, book: b.book, p_model: side === 'a' ? model.p_a : 1 - model.p_a, p_implied: dec2p(odds), unc_pp: uncPp, stale, base_lag_days: lag }));
    }
  }
  const dp = distProbs(model, mk.consensus.total_line, mk.consensus.spread_line);
  if (dp.pOver != null && mk.best.total_over && mk.best.total_under) {
    for (const side of ['over', 'under']) {
      const b = side === 'over' ? mk.best.total_over : mk.best.total_under;
      const odds = side === 'over' ? b.over : b.under;
      out.push(gate({ family: 'TOTAL', side, line: mk.consensus.total_line, odds, book: b.book, p_model: side === 'over' ? dp.pOver : 1 - dp.pOver - dp.pushT, p_implied: dec2p(odds), push_p: dp.pushT, unc_pp: uncPp, stale, base_lag_days: lag }));
    }
  }
  if (dp.pCoverA != null && mk.best.spread_a && mk.best.spread_b) {
    for (const side of ['a', 'b']) {
      const b = side === 'a' ? mk.best.spread_a : mk.best.spread_b;
      const odds = side === 'a' ? b.a : b.b;
      out.push(gate({ family: 'SPREAD', side, line: mk.consensus.spread_line, odds, book: b.book, p_model: side === 'a' ? dp.pCoverA : 1 - dp.pCoverA - dp.pushS, p_implied: dec2p(odds), push_p: dp.pushS, unc_pp: uncPp, stale, base_lag_days: lag }));
    }
  }
  return out;
}

// ── EL TABLERO ───────────────────────────────────────────────────────────────────────────────────────────
async function board(tour) {
  const odds = await refreshOdds().catch(() => null);
  const rows = [];
  const now = Date.now();
  for (const ev of (odds && odds.rows) || []) {
    if (tour != null && tourOfKey(ev._tkey) !== tour) continue;
    const t = Date.parse(ev.commence_time || 0);
    if (!(t > now - 4 * 3600e3 && t < now + 9 * 864e5)) continue;
    const model = eventModel(ev);
    const mk = marketOf(ev);
    const row = {
      id: ev.id, tourney: ev._ttitle, tkey: ev._tkey, tour: tourOfKey(ev._tkey),
      surface: D.SURFACES[surfOfKey(ev._tkey)], best_of: bo5Keys.test(ev._tkey) ? 5 : 3,
      a: ev.home_team, b: ev.away_team, commence: ev.commence_time, books: mk.books,
      market: mk.consensus, available: model.available,
    };
    if (model.available) {
      row.gp = { p_a: model.p_a, exp_games: model.exp_games, tb_any: model.tb_any, hold_a: model.hold_a, hold_b: model.hold_b };
      row.photo_a = photoOf(model.tour, model.a.id);
      row.photo_b = photoOf(model.tour, model.b.id);
      row.candidates = evaluateEdges(model, mk);
      row.shadow_n = row.candidates.filter((c) => c.verdict === 'SHADOW_PICK').length;
      row.picks = row.candidates.filter((c) => c.verdict === 'SHADOW_PICK').map((c) => tenPickCard(c, row, model));
    } else row.why = model.why;
    rows.push(row);
  }
  rows.sort((x, y) => Date.parse(x.commence) - Date.parse(y.commence));
  return {
    rows, refreshed_at: odds ? new Date(odds.at).toISOString() : null, doctrine: DOCTRINE,
    note: rows.length ? null : 'sin torneos con cuotas activas en la ventana (The Odds API publica por torneo: se abren solos cuando arranca el siguiente)',
  };
}

// ── LA TESIS CON LA FORMA DE LA CARD DE LA CASA (19-ago) ────────────────────────────────────────────────
// Alexis: "el formato de las picks no es el que usamos". Cierto: el tenis se estaba pintando con una card
// propia. El usuario aprende a leer UNA pick —chip de familia, ticket, porqué, cuota con su casa, confianza,
// señales y calculadora de stake— y esa lectura le vale en los ocho deportes; una card distinta aquí no era
// personalidad, era deuda. Esto traduce la tesis a los campos EXACTOS que consume pickCard(), igual que ya
// hacen combate, baloncesto y esports.
const TEN_CARD_FAMILY = { ML: 'SOLID', TOTAL: 'TOTAL', SPREAD: 'SPREAD' };
const TEN_STAKE_CAP = 2;
function tenStake(p, odds) {
  if (!(p > 0 && odds > 1)) return null;
  const b = odds - 1, k = (p * b - (1 - p)) / b;         // Kelly completo
  if (!(k > 0)) return null;
  const raw = +(100 * k / 4).toFixed(2);                  // cuarto de Kelly, la doctrina de la casa
  return { pct: Math.min(TEN_STAKE_CAP, raw), raw, capped: raw > TEN_STAKE_CAP };
}
function tenSelectionName(c, row) {
  const who = c.side === 'a' ? row.a : c.side === 'b' ? row.b : null;
  if (c.family === 'ML') return `Gana ${who}`;
  if (c.family === 'SPREAD') return `${who} ${c.line > 0 ? '+' : ''}${c.line} juegos`;
  return `${c.side === 'over' ? 'Más' : 'Menos'} de ${c.line} juegos`;
}
function tenWhy(c, row, model) {
  const bits = [];
  const who = c.side === 'a' ? row.a : c.side === 'b' ? row.b : null;
  if (c.family === 'ML') {
    bits.push(`El compilador va punto a punto con la alternancia real del saque: con los porcentajes de saque y resto de este par en ${row.surface || 'esta superficie'}, ${who} gana ${(100 * c.p_model).toFixed(1)} % de las veces contra el ${(100 * c.p_implied).toFixed(1)} % que implica la cuota.`);
  } else if (c.family === 'TOTAL') {
    bits.push(`La duración no se estima con un promedio: sale de la distribución completa de juegos que produce el compilador (media ${model && model.exp_games != null ? model.exp_games.toFixed(1) : '—'}), y sobre esa curva el ${c.side === 'over' ? 'más' : 'menos'} de ${c.line} pesa ${(100 * c.p_model).toFixed(1)} %.`);
  } else {
    bits.push(`El hándicap se lee sobre la distribución de MARGEN de juegos del compilador, no sobre el ganador: ${who} cubre ${c.line > 0 ? '+' : ''}${c.line} en ${(100 * c.p_model).toFixed(1)} % de las simulaciones.`);
  }
  bits.push('Modelo market-blind por construcción: el precio no entra nunca al cálculo, así que la diferencia con la casa es una discrepancia real y no un eco de su propia línea.');
  bits.push('EN SOMBRA: todas las familias de tenis se anotan y se liquidan para acumular muestra, pero ninguna se publica como pick — contra el mercado todavía no hay prueba.');
  return bits.join(' ');
}
function tenPickCard(c, row, model) {
  const st = tenStake(c.p_model, c.odds);
  return {
    ...c,
    family: TEN_CARD_FAMILY[c.family] || 'TOTAL',
    family_raw: c.family,
    fam_label: c.family === 'ML' ? 'Ganador' : c.family === 'TOTAL' ? 'Juegos' : 'Hándicap',
    selection_name: tenSelectionName(c, row),
    home: row.a, away: row.b,
    home_team_id: null, away_team_id: null,
    ten_avas: { h: row.photo_a || null, a: row.photo_b || null },
    ten_hash: `tenmatch/${row.id}`,
    competition_name: row.tourney || null,
    kickoff: row.commence || null,
    confidence: c.p_model,
    model_prob: c.p_model, market_prob: c.p_implied,
    pick_id: `ten_${row.id}_${c.family}_${c.side}_${c.line != null ? c.line : 'x'}`,
    why_es: tenWhy(c, row, model),
    stake_pct: st ? st.pct : null,
    stake_raw_pct: st ? st.raw : null,
    stake_capped: !!(st && st.capped),
    shadow: true,
    signals: {
      win_prob: c.p_model,
      edge_pp: c.edge_pp,
      data_confidence: 'med',
      pick_quality: c.edge_pp >= 6 ? 'strong' : c.edge_pp >= 4 ? 'moderate' : 'marginal',
    },
  };
}

// ── LAS CARAS (19-ago) ──────────────────────────────────────────────────────────────────────────────────
// Manifiesto aparte, con procedencia y licencia por archivo: las imágenes son de Wikimedia Commons
// (CC BY-SA), elegidas por derechos —las de ATP/WTA son de sus federaciones y no se pueden auto-hospedar—.
let TAS = null;
function tenAssets() {
  if (TAS) return TAS;
  try { TAS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tennis', 'assets.json'), 'utf8')); }
  catch { TAS = { players: {} }; }
  return TAS;
}
function photoOf(tour, id) {
  const r = (tenAssets().players || {})[tour + ':' + id];
  return r && r.photo ? '/logos/tennis/' + r.photo : null;
}

// ── LA FICHA DE UN PARTIDO (19-ago) ─────────────────────────────────────────────────────────────────────
// El tablero enseñaba tarjetas que no se podían abrir: no había panel de inteligencia en tenis, que es
// justo donde vive lo único que este deporte tiene y ningún otro — el compilador EXACTO de puntuación.
// Esto reúne, para UN evento del mercado, todo lo que el motor ya calculaba por dentro: el duelo de saque
// y resto, la distribución de juegos, los marcadores de set, el h2h medido, las fichas de los dos y las
// tesis con su veredicto. No calcula nada nuevo; deja de esconderlo.
async function matchDetail(eventId) {
  const odds = await refreshOdds().catch(() => null);
  const ev = ((odds && odds.rows) || []).find((r) => String(r.id) === String(eventId));
  if (!ev) return { available: false, why: 'ese partido ya no está en la ventana de cuotas' };
  const model = eventModel(ev);
  const mk = marketOf(ev);
  const base = {
    id: ev.id, tourney: ev._ttitle, tour: tourOfKey(ev._tkey),
    surface: D.SURFACES[surfOfKey(ev._tkey)], best_of: bo5Keys.test(ev._tkey) ? 5 : 3,
    commence: ev.commence_time, books: mk.books, market: mk.consensus, best: mk.best,
    a_ref: ev.home_team, b_ref: ev.away_team, doctrine: DOCTRINE,
  };
  if (!model.available) return { ...base, available: false, why: model.why };
  const md = model.dist;
  const cst = D.build().T[model.tour].cst;
  const cal = (cst.gamesCal || {})[model.best_of === 5 ? 'bo5' : 'bo3'] || [0, 1];
  const shift = model.exp_games - md.expGames;
  const bucket = (arr) => arr.filter(([, p]) => p > 0.004).map(([g, p]) => [Math.round((g + shift) * 2) / 2, r3(p)]);
  return {
    ...base, available: true,
    a: { ...model.a, photo: photoOf(model.tour, model.a.id) },
    b: { ...model.b, photo: photoOf(model.tour, model.b.id) },
    p_a: model.p_a, p_set_a: model.p_set_a, exp_games: model.exp_games, tb_any: model.tb_any,
    duel: {
      hold_a: model.hold_a, hold_b: model.hold_b,
      break_a: r3(1 - model.hold_b), break_b: r3(1 - model.hold_a),
      tb_any: model.tb_any, exp_games: model.exp_games,
      set_scores: md.setScores, total_games: bucket(md.totalGames),
    },
    h2h: h2h(model.tour, model.a.id, model.b.id),
    profiles: { a: playerProfile(model.tour, model.a.id), b: playerProfile(model.tour, model.b.id) },
    candidates: evaluateEdges(model, mk),
    picks: evaluateEdges(model, mk).filter((c) => c.verdict === 'SHADOW_PICK')
      .map((c) => tenPickCard(c, { id: ev.id, a: model.a.name, b: model.b.name, tourney: ev._ttitle,
        commence: ev.commence_time, surface: D.SURFACES[surfOfKey(ev._tkey)],
        photo_a: photoOf(model.tour, model.a.id), photo_b: photoOf(model.tour, model.b.id) }, model)),
    model_version: model.model_version,
  };
}

// ── LA SOMBRA ────────────────────────────────────────────────────────────────────────────────────────────
async function recordShadow() {
  const b = await board();
  const st = rdD('picks.json') || { picks: [] };
  const have = new Set(st.picks.map((p) => p.key));
  let n = 0;
  for (const row of b.rows) {
    if (!row.available) continue;
    const start = Date.parse(row.commence);
    if (!(start > Date.now() && start - Date.now() < 6 * 864e5)) continue;
    for (const c of row.candidates || []) {
      if (c.verdict !== 'SHADOW_PICK') continue;
      const key = `${row.id}|${c.family}|${c.side}|${c.line}`;
      if (have.has(key)) continue;
      have.add(key); n++;
      st.picks.push({
        key, event_id: row.id, tkey: row.tkey, tourney: row.tourney, tour: row.tour, surface: row.surface, best_of: row.best_of,
        a: row.a, b: row.b, family: c.family, side: c.side, line: c.line, odds: c.odds, book: c.book,
        p_model: c.p_model, p_implied: c.p_implied, edge_pp: c.edge_pp, benchmark: !!c.benchmark,
        commence: row.commence, status: 'OPEN', created_at: new Date().toISOString(), regime: 'shadow',
      });
    }
  }
  if (n) wrD('picks.json', st);
  return { recorded: n, total: st.picks.length };
}

// liquidación por ESPN (marcadores finales por gira y día; se casan por apellidos normalizados)
async function espnDay(tn, day) {
  const key = tn + ':' + day;
  let sb = G.sb[key];
  if (sb && Date.now() - sb.at < 10 * 60e3) return sb.j;
  const lg = tn === 0 ? 'atp' : 'wta';
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${lg}/scoreboard?dates=${day}`, { signal: AbortSignal.timeout(15000) });
  // ERRORES CON NOMBRE (19-ago): un 403 devolvía HTML, `r.json()` reventaba con "Unexpected token <" y ese
  // error caía en el catch por-pick del liquidador, que hacía `continue` en silencio. Resultado: doce
  // partidos ya jugados sin liquidar y CERO pistas de por qué. Ahora el fallo se llama por su nombre.
  if (!r.ok) throw new Error(`espn ${lg} ${day}: HTTP ${r.status}`);
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`espn ${lg} ${day}: respuesta no-JSON (${txt.slice(0, 40).replace(/\s+/g, ' ')}…)`); }
  G.sb[key] = { at: Date.now(), j };
  return j;
}
function lastName(s) { const p = D.norm(s).split(' '); return p[p.length - 1] || ''; }

async function settleShadow() {
  const st = rdD('picks.json') || { picks: [] };
  const open = st.picks.filter((p) => p.status === 'OPEN' && Date.parse(p.commence) < Date.now() - 2 * 3600e3);
  if (!open.length) return { settled: 0, pending: 0, diag: {} };
  let settled = 0;
  // DIAGNÓSTICO DEL LIQUIDADOR: sin esto, "0 liquidadas" es indistinguible de "la fuente está caída".
  // Se cuenta por MOTIVO y viaja hasta la sonda, que es donde se mira cuando algo no cuadra.
  const diag = { vencidas: open.length, sin_fuente: 0, sin_cruce: 0, no_final: 0, sin_marcador: 0, ok: 0, void_tiempo: 0 };
  const errs = [];
  const closes = rdD('closes.json') || { closes: {} };
  for (const p of open) {
    try {
      if (Date.parse(p.commence) < Date.now() - 4 * 864e5) { p.status = 'SETTLED'; p.result = 'VOID'; p.units = 0; p.void_reason = 'sin resultado casado en 4 días (walkover/cambio de agenda probable)'; settled++; diag.void_tiempo++; continue; }
      const day = p.commence.slice(0, 10).replace(/-/g, '');
      const j = await espnDay(p.tour, day);
      // ESPN NO SIEMPRE CUELGA LOS EVENTOS EN LA RAÍZ (19-ago). El parte de la pasada anterior lo dejó
      // claro: `eventos: 0` con la fuente respondiendo bien. En tenis el marcador los anida bajo
      // sports[].leagues[].events —la misma forma que ya usa su endpoint de equipos— mientras que el
      // código solo miraba `j.events`. Se aceptan las dos formas y se anota cuál vino.
      const evs = [];
      const roots = [];
      if (j && Array.isArray(j.events)) roots.push(...j.events);
      for (const sp of (j && j.sports) || []) for (const lg of sp.leagues || []) if (Array.isArray(lg.events)) roots.push(...lg.events);
      for (const e of roots) {
        const comps = e.competitions || e.groupings || [];
        for (const comp of comps) {
          // en tenis una "grouping" agrupa partidos (individual masculino, dobles…): puede traer
          // competitions dentro en vez de competitors sueltos
          if (Array.isArray(comp.competitions)) { for (const c2 of comp.competitions) evs.push({ e, comp: c2 }); }
          else evs.push({ e, comp });
        }
      }
      const la = lastName(p.a), lb = lastName(p.b);
      // NOMBRES DEL MARCADOR: ESPN no siempre cuelga al jugador de `competitor.athlete`. Se recogen todas
      // las formas conocidas para que el cruce no dependa de una sola, y se guarda una muestra en el parte:
      // "sin_cruce" a secas no distingue entre "el día vino vacío" y "los nombres no casan".
      const nameOf = (x) => D.norm(
        (x.athlete && (x.athlete.displayName || x.athlete.shortName || x.athlete.fullName))
        || x.displayName || x.shortName
        || ((x.roster || []).map((r) => (r.athlete || {}).displayName || '').join(' '))
        || ''
      );
      const hit = evs.find(({ comp }) => {
        const names = (comp.competitors || []).map(nameOf);
        return names.some((n) => n.endsWith(la) || n.includes(la)) && names.some((n) => n.endsWith(lb) || n.includes(lb));
      });
      if (!hit) {
        diag.sin_cruce++;
        diag.eventos_vistos = (diag.eventos_vistos || 0) + evs.length;
        // una sola muestra basta para ver si el problema es el día vacío o la forma del nombre
        if (!diag.muestra) {
          diag.muestra = {
            buscaba: [la, lb], dia: day, eventos: evs.length,
            // las claves de la raíz dicen dónde vienen de verdad los partidos si siguen sin aparecer
            claves: j ? Object.keys(j).slice(0, 8) : null,
            n_raiz: roots.length,
            vistos: evs.slice(0, 3).flatMap(({ comp }) => (comp.competitors || []).map(nameOf)).slice(0, 6),
          };
        }
        continue;
      }
      const status = ((hit.e.status || {}).type || {}).name || ((hit.comp.status || {}).type || {}).name || '';
      if (!/FINAL|RETIRED|WALKOVER/i.test(status)) { diag.no_final++; continue; }
      const cs = hit.comp.competitors || [];
      const ca = cs.find((x) => { const n = nameOf(x); return n.endsWith(la) || n.includes(la); });
      const cb = cs.find((x) => { const n = nameOf(x); return n.endsWith(lb) || n.includes(lb); });
      if (!ca || !cb) { diag.sin_marcador++; continue; }
      const setsA = (ca.linescores || []).map((x) => +x.value), setsB = (cb.linescores || []).map((x) => +x.value);
      const gA = setsA.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0), gB = setsB.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
      const aWon = ca.winner === true || (ca.winner == null && gA > gB);
      const retired = /RETIRED|WALKOVER/i.test(status);
      let win = null;
      if (p.family === 'ML') win = retired ? null : (p.side === 'a' ? (aWon ? 1 : 0) : (aWon ? 0 : 1));
      if (p.family === 'TOTAL') { const total = gA + gB; win = retired ? null : (p.side === 'over' ? (total > p.line ? 1 : total === p.line ? null : 0) : (total < p.line ? 1 : total === p.line ? null : 0)); }
      if (p.family === 'SPREAD') { const v = (gA - gB) + p.line; win = retired ? null : (p.side === 'a' ? (v > 0 ? 1 : v === 0 ? null : 0) : (v < 0 ? 1 : v === 0 ? null : 0)); }
      p.status = 'SETTLED';
      p.result = retired ? 'VOID' : win == null ? 'PUSH' : win ? 'WIN' : 'LOSS';
      if (retired) p.void_reason = 'retiro/walkover: liquidación VOID por regla de sombra (las casas difieren; T-0442)';
      p.final = { games_a: gA, games_b: gB, sets_a: setsA, sets_b: setsB, status };
      p.units = win == null || retired ? 0 : win ? +(p.odds - 1).toFixed(3) : -1;
      const cl = closes.closes[p.event_id];
      if (cl) {
        let cp = null;
        if (p.family === 'ML') cp = p.side === 'a' ? cl.ml_a : cl.ml_b;
        if (p.family === 'TOTAL' && cl.total_line === p.line) cp = p.side === 'over' ? cl.total_over : cl.total_under;
        if (p.family === 'SPREAD' && cl.spread_line === p.line) cp = p.side === 'a' ? cl.spread_a : cl.spread_b;
        if (cp) { p.close_price = cp; p.clv_pct = +((p.odds / cp - 1) * 100).toFixed(2); }
      }
      p.settled_at = new Date().toISOString();
      settled++; diag.ok++;
    } catch (e) {
      // el fallo se ANOTA con su mensaje en vez de desaparecer: la primera pista de que la fuente cayó
      diag.sin_fuente++;
      if (errs.length < 3) errs.push(String(e && e.message || e).slice(0, 120));
    }
  }
  if (settled) wrD('picks.json', st);
  // el parte SIEMPRE se guarda, aunque no se liquide nada: es justo el caso en el que hace falta mirarlo
  try {
    const dg = rdD('settle-diag.json') || {};
    wrD('settle-diag.json', { ...dg, at: new Date().toISOString(), diag, errors: errs, settled });
  } catch { }
  return { settled, diag, errors: errs };
}

function track(tour) {
  const st = rdD('picks.json') || { picks: [] };
  const settleDiag = rdD('settle-diag.json') || null;
  const mine = st.picks.filter((p) => tour == null || p.tour === tour);
  const done = mine.filter((p) => p.status === 'SETTLED' && p.result !== 'VOID');
  const w = done.filter((p) => p.result === 'WIN').length, l = done.filter((p) => p.result === 'LOSS').length;
  const units = done.reduce((s, p) => s + (p.units || 0), 0);
  const clv = done.filter((p) => p.clv_pct != null);
  const clvSd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length;
    return r2(Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1))); };
  const byFam = {};
  for (const p of done) {
    const F = byFam[p.family] = byFam[p.family] || { n: 0, w: 0, units: 0, clv: [] };
    F.n++; if (p.result === 'WIN') F.w++; F.units += p.units || 0;
    if (p.clv_pct != null) F.clv.push(p.clv_pct);
  }
  return {
    regime: 'shadow', doctrine: DOCTRINE,
    open: mine.filter((p) => p.status === 'OPEN').length,
    settled: done.length, w, l, push: done.filter((p) => p.result === 'PUSH').length,
    voided: mine.filter((p) => p.result === 'VOID').length,
    units: r2(units), roi_pct: done.length ? r2(100 * units / done.length) : null,
    clv_avg_pct: clv.length ? r2(clv.reduce((s, p) => s + p.clv_pct, 0) / clv.length) : null, clv_n: clv.length,
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, F]) => [k, {
      n: F.n, hit_pct: F.n ? r2(100 * F.w / F.n) : null, units: r2(F.units),
      clv_avg_pct: F.clv.length ? r2(F.clv.reduce((a, b) => a + b, 0) / F.clv.length) : null,
      // la media del CLV sin su dispersión no se puede juzgar: +0,5 % sobre 30 picks con sd 8 es ruido y
      // sobre 300 con sd 2 es ventaja. El tablero de familias necesita las dos para calcular el estadístico.
      clv_n: F.clv.length, clv_sd: clvSd(F.clv),
      note: k === 'ML' ? 'familia de referencia (benchmark), jamás pick' : undefined,
    }])),
    recent: done.slice(-40).reverse(), open_list: mine.filter((p) => p.status === 'OPEN').slice(-30).reverse(),
    reading: done.length < 40 ? `con ${done.length} liquidadas TODO es ruido: esta pantalla acumula el registro, no se lee todavía.` : 'la vara es el CLV por familia, no el ROI.',
    // el parte del liquidador viaja con el track: "0 liquidadas" y "la fuente está caída" se parecen
    // demasiado como para dejarlos indistinguibles
    settle_diag: settleDiag,
  };
}

// ── AGENDA DEL DÍA (ESPN) ────────────────────────────────────────────────────────────────────────────────
async function agenda() {
  const out = { rows: [], espn_error: null };
  for (const tn of [0, 1]) {
    try {
      const j = await espnDay(tn, new Date().toISOString().slice(0, 10).replace(/-/g, ''));
      for (const e of (j && j.events) || []) {
        for (const comp of (e.competitions || []).slice(0, 40)) {
          const cs = comp.competitors || [];
          if (cs.length !== 2) continue;
          out.rows.push({
            tour: tn, tourney: e.name || '', status: ((comp.status || {}).type || {}).shortDetail || '',
            state: ((comp.status || {}).type || {}).state || '',
            a: (cs[0].athlete || {}).displayName || '', b: (cs[1].athlete || {}).displayName || '',
            score_a: (cs[0].linescores || []).map((x) => x.value).join('-'),
            score_b: (cs[1].linescores || []).map((x) => x.value).join('-'),
            winner: cs[0].winner ? 'a' : cs[1].winner ? 'b' : null,
          });
        }
      }
    } catch (e) { out.espn_error = e.message; }
  }
  return out;
}

// ── CATÁLOGO ─────────────────────────────────────────────────────────────────────────────────────────────
const ATTRIB = 'Base propia derivada del proyecto de Jeff Sackmann (CC BY-NC-SA 4.0) — uso interno de investigación, sin fines comerciales.';

function playersDirectory(tour, { q = '', limit = 80 } = {}) {
  const d = D.build(); const t = d.T[tour];
  const nq = D.norm(q);
  const rows = [];
  for (const [id, prof] of t.prof) {
    const p = d.players[tour + ':' + id];
    if (!p) continue;
    if (nq && !D.norm(p.name).includes(nq)) continue;
    if (prof.w + prof.l < 10) continue;
    rows.push({
      id, name: p.name, hand: p.hand, country: p.country, ht: p.ht, photo: photoOf(tour, id),
      elo: Math.round(t.elo.get(id) || 1500), rank: prof.rank, wl: prof.w + '-' + prof.l,
      last: prof.lastDate, inactive: prof.lastDate < +String(new Date(Date.now() - 150 * 864e5).toISOString().slice(0, 10).replace(/-/g, '')),
    });
  }
  rows.sort((x, y) => y.elo - x.elo);
  return { rows: rows.slice(0, limit), total: rows.length, attribution: ATTRIB, freshness: d.meta.last_match_date };
}

// ── CARGA Y DESCANSO (19-ago) ────────────────────────────────────────────────────────────────────────────
// Alexis pidió una sección destacada de datos y que mirara "qué busca siempre la gente que busca data de
// fútbol". En fútbol lo que siempre se mira antes de un partido es CÓMO LLEGA cada equipo: descanso desde
// el último partido, minutos en las piernas, congestión de calendario. En tenis eso pesa MÁS, no menos —no
// hay banquillo, no hay cambios, y el que jugó tres horas antesdeayer las lleva encima él solo— y no estaba
// en ninguna pantalla.
//
// Se calcula del registro propio de partidos, sin pedir nada nuevo: partidos de los últimos 7, 14 y 30
// días, sets y JUEGOS jugados (que es la unidad de desgaste real: un 7-6 7-6 cansa más que un 6-1 6-2 y
// dura el doble), días desde el último partido, retiros y abandonos, y si viene de cambiar de superficie.
//
// LO QUE ESTO NO ES: no es una señal del modelo ni entra en ninguna probabilidad. Es contexto medido, y va
// declarado como tal. Meterlo al modelo exige el peaje completo de validación; enseñarlo, no.
const JUEGOS_RE = /(\d+)\s*[-–]\s*(\d+)/g;
function cargaDeUnPartido(score) {
  // del marcador salen sets y juegos. Los tie-breaks entre paréntesis se ignoran a propósito: "7-6(4)" son
  // trece juegos, no diecisiete.
  const limpio = String(score || '').replace(/\([^)]*\)/g, ' ');
  let sets = 0, juegos = 0, m;
  JUEGOS_RE.lastIndex = 0;
  while ((m = JUEGOS_RE.exec(limpio))) { const a = +m[1], b = +m[2]; if (a > 15 || b > 15) continue; sets++; juegos += a + b; }
  return { sets, juegos };
}
const aFecha = (n) => { const s = String(n); return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); };

function loadBoard(tour, { limit = 60 } = {}) {
  const d = D.build(); const t = d.T[tour];
  if (!t) return { available: false, why: 'ese tour no está en la base propia' };
  // el "hoy" del tablero es la última fecha de la BASE, no la del reloj: si la cosecha va dos días por
  // detrás, contar desde hoy inventaría descanso que nadie ha tenido. Y `last_match_date` NO es un número:
  // es un objeto con una fecha POR TOUR ({atp, wta}) — pasarlo tal cual a la conversión daba NaN, y con
  // NaN todos los filtros de ventana pasan, así que el tablero salía lleno de jugadores retirados.
  const corte = (() => { const lm = d.meta.last_match_date;
    if (lm && typeof lm === 'object') return tour === 1 ? (lm.wta || lm.atp) : (lm.atp || lm.wta);
    return lm; })();
  const hoy = aFecha(corte);
  const rows = [];
  for (const [id, prof] of t.prof) {
    const p = d.players[tour + ':' + id];
    if (!p || prof.w + prof.l < 10) continue;
    const rec = (prof.recent || []).slice();
    if (!rec.length) continue;
    const ult = rec[rec.length - 1];
    const dias = Math.round((hoy - aFecha(ult.d)) / 864e5);
    if (dias > 45) continue;                       // fuera de circulación: su carga no dice nada de hoy
    const ventana = (n) => rec.filter((m) => (hoy - aFecha(m.d)) / 864e5 <= n);
    const suma = (arr) => arr.reduce((acc, m) => { const c = cargaDeUnPartido(m.score); acc.sets += c.sets; acc.juegos += c.juegos; return acc; }, { sets: 0, juegos: 0 });
    const v7 = ventana(7), v14 = ventana(14), v30 = ventana(30);
    const s14 = suma(v14);
    const ult5 = rec.slice(-5).map((m) => (m.won ? 'W' : 'L'));
    // cambio de superficie: la del último partido contra la que más jugó en los treinta días previos
    const porSup = {};
    for (const m of v30) porSup[m.surf] = (porSup[m.surf] || 0) + 1;
    const dominante = Object.entries(porSup).sort((a, b) => b[1] - a[1])[0];
    const cambio = dominante && +dominante[0] !== ult.surf;
    rows.push({
      id, name: p.name, country: p.country, photo: photoOf(tour, id),
      rank: prof.rank, elo: Math.round(t.elo.get(id) || 1500),
      days_off: dias,
      m7: v7.length, m14: v14.length, m30: v30.length,
      sets14: s14.sets, games14: s14.juegos,
      // el desgaste por partido, que es lo que distingue "jugó cuatro" de "jugó cuatro maratones"
      games_per_match: v14.length ? +(s14.juegos / v14.length).toFixed(1) : null,
      last_date: ult.d, last_surface: D.SURFACES[ult.surf] || null,
      surface_switch: !!cambio,
      retirements: rec.filter((m) => m.ret && (hoy - aFecha(m.d)) / 864e5 <= 60).length,
      form: ult5,
      streak: (() => { let n = 0; for (let i = rec.length - 1; i >= 0; i--) { if (i === rec.length - 1) { n = rec[i].won ? 1 : -1; continue; } if (rec[i].won === (n > 0)) n += n > 0 ? 1 : -1; else break; } return n; })(),
    });
  }
  // se ordena por CARGA, que es la pregunta de la pantalla: quién llega con más piernas gastadas
  rows.sort((a, b) => (b.games14 - a.games14) || (b.m14 - a.m14));
  const conJuego = rows.filter((r) => r.m14 > 0);
  return {
    available: rows.length > 0, tour, rows: rows.slice(0, limit), total: rows.length,
    as_of: corte,
    medians: conJuego.length ? {
      games14: conJuego.map((r) => r.games14).sort((a, b) => a - b)[conJuego.length >> 1],
      m14: conJuego.map((r) => r.m14).sort((a, b) => a - b)[conJuego.length >> 1],
    } : null,
    attribution: ATTRIB, freshness: d.meta.last_match_date,
    // EL RETRASO DE LA BASE VA EN PORTADA, no en una nota al pie. Esta pantalla se lee como "cómo llega
    // fulano HOY", y si el último partido cargado es de hace semanas eso es exactamente lo que NO dice.
    lag_days: baseLagDays(),
    seam: (() => { const t = d.meta.tail; return t ? { spine_until: t.spine_until, tail_from: t.from } : null; })(),
    note: 'contexto medido del registro propio, NO una señal del modelo: no entra en ninguna probabilidad. ' +
      'Los juegos son la unidad de desgaste —un 7-6 7-6 cansa el doble que un 6-1 6-2 y dura el doble— y el ' +
      'corte de fechas es el último partido de la base, no el reloj: contar desde hoy inventaría descanso que nadie tuvo.',
  };
}

function rankingBoard(tour) {
  const dir = playersDirectory(tour, { limit: 100 });
  const snap = rdD('rank-snap.json') || {};
  const prev = (snap[tour] || {}).order || [];
  const rows = dir.rows.filter((r) => !r.inactive).slice(0, 60).map((r, i) => {
    const was = prev.indexOf(r.id);
    return { pos: i + 1, ...r, move: was >= 0 ? was - i : null };
  });
  return {
    rows, snapshot_at: (snap[tour] || {}).at || null, attribution: ATTRIB, freshness: dir.freshness,
    note: 'ranking por Elo propio de GP validado fuera de muestra — no es el ranking oficial (que aparece al lado). La flecha compara contra la foto semanal anterior.',
  };
}

function snapshotRanks() {
  const snap = rdD('rank-snap.json') || {};
  const now = Date.now();
  let changed = false;
  for (const tn of [0, 1]) {
    const cur = snap[tn];
    if (cur && now - Date.parse(cur.at) < 6.5 * 864e5) continue;
    const dir = playersDirectory(tn, { limit: 100 });
    snap[tn] = { at: new Date().toISOString(), order: dir.rows.filter((r) => !r.inactive).slice(0, 60).map((r) => r.id) };
    changed = true;
  }
  if (changed) wrD('rank-snap.json', snap);
  return { changed };
}

function playerProfile(tour, id) {
  const d = D.build(); const t = d.T[tour];
  const p = d.players[tour + ':' + id], prof = t.prof.get(+id);
  if (!p || !prof) return { available: false, why: 'jugador fuera de la base propia' };
  const dev = (m) => { const o = m.get(+id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + t.cst.shrinkK)) : 0; };
  const idx = (v) => r2(100 + v * 1000); // índice 100 = media del tour (presentación, no la receta)
  return {
    available: true, id: +id, name: p.name, hand: p.hand, country: p.country, ht: p.ht,
    dob: p.dob, rank: prof.rank, wl: { w: prof.w, l: prof.l },
    elo: Math.round(t.elo.get(+id) || 1500),
    elo_surf: t.eloSurf.map((m, i) => ({ surface: D.SURFACES[i], elo: m.has(+id) ? Math.round(m.get(+id)) : null })),
    surf_wl: prof.surf.map((x, i) => ({ surface: D.SURFACES[i], w: x[0], l: x[1] })),
    serve_index: idx(dev(t.srv)), return_index: idx(dev(t.ret)),
    career_serve: prof.sv > 200 ? {
      ace_pct: r2(100 * prof.ace / prof.sv), df_pct: r2(100 * prof.df / prof.sv),
      first_in_pct: r2(100 * prof.in1 / prof.sv), spw_pct: r2(100 * prof.spwS / Math.max(1, prof.spwN)),
      bp_saved_pct: prof.bpF > 20 ? r2(100 * prof.bpS / prof.bpF) : null,
    } : null,
    recent: prof.recent.slice().reverse().map((m) => ({
      date: m.d, opp: (d.players[tour + ':' + m.opp] || {}).name || m.opp, won: m.won,
      score: m.score, surface: D.SURFACES[m.surf] || null, tourney: m.t, ret: m.ret,
    })),
    last_date: prof.lastDate,
    inactive_note: prof.lastDate < +String(new Date(Date.now() - 150 * 864e5).toISOString().slice(0, 10).replace(/-/g, '')) ? 'sin partidos recientes en la base: la incertidumbre del rating es alta' : null,
    attribution: ATTRIB, freshness: d.meta.last_match_date,
    index_note: 'índices de saque y resto: 100 = media del tour, ajustados por rival y validados fuera de muestra. La composición interna es reservada.',
  };
}

function h2h(tour, idA, idB) {
  const d = D.build(); const F = d.F;
  const rows = [];
  let wA = 0, wB = 0;
  for (const r of d.rows) {
    if (r[F.tour] !== tour) continue;
    const w = r[F.wid], l = r[F.lid];
    if (!((w === +idA && l === +idB) || (w === +idB && l === +idA))) continue;
    if (w === +idA) wA++; else wB++;
    rows.push({ date: r[F.date], winner: w === +idA ? 'a' : 'b', score: r[F.score], surface: D.SURFACES[r[F.surface]] || null, tourney: (d.tourneys[r[F.tid]] || {}).name });
  }
  return { w_a: wA, w_b: wB, rows: rows.slice(-12).reverse() };
}

// ── SIMULADOR / DUELO SAQUE-RESTO (el objeto firma del tenis) ────────────────────────────────────────────
function simMatch(tour, refA, refB, { surface = 0, bestOf = 3 } = {}) {
  const A = D.resolvePlayer(tour, refA), B = D.resolvePlayer(tour, refB);
  if (!A || !B) return { available: false, why: `no encuentro a ${!A ? refA : refB} en la base propia de ${tour === 0 ? 'ATP' : 'WTA'}` };
  if (A.id === B.id) return { available: false, why: 'los dos nombres resuelven al mismo jugador' };
  const mp = D.matchProb(tour, A.id, B.id, surface);
  const cst = D.build().T[tour].cst;
  const md = C.matchDist(mp.paSrv, mp.pbSrv, bestOf, cst.shock || 0);
  const logit = (p) => Math.log(p / (1 - p)), sg = (x) => 1 / (1 + Math.exp(-x));
  const clampP = (p) => Math.max(1e-4, Math.min(1 - 1e-4, p));
  const u = cst.ensembleU || 0;
  const pA = sg((1 - u) * logit(clampP(mp.pMix)) + u * logit(clampP(md.pA)));
  const cal = (cst.gamesCal || {})[bestOf === 5 ? 'bo5' : 'bo3'] || [0, 1];
  const shift = (cal[0] + cal[1] * md.expGames) - md.expGames;
  const bucket = (arr) => arr.filter(([, p]) => p > 0.004).map(([g, p]) => [Math.round((g + shift) * 2) / 2, r3(p)]);
  return {
    available: true, tour, surface: D.SURFACES[surface], best_of: bestOf,
    // el retrato viaja con el jugador: el simulador dibujaba iniciales de colores teniendo la foto a mano
    a: { id: A.id, name: A.name, hand: A.hand, country: A.country, photo: photoOf(tour, A.id) },
    b: { id: B.id, name: B.name, hand: B.hand, country: B.country, photo: photoOf(tour, B.id) },
    p_a: r3(pA), p_set_a: r3(md.pSetA),
    duel: {
      hold_a: r3(md.holdA), hold_b: r3(md.holdB), break_a: r3(1 - md.holdB), break_b: r3(1 - md.holdA),
      tb_any: r3(md.tbAny), exp_games: r2(md.expGames + shift),
      set_scores: md.setScores, total_games: bucket(md.totalGames),
    },
    h2h: h2h(tour, A.id, B.id),
    profiles: { a: playerProfile(tour, A.id), b: playerProfile(tour, B.id) },
    note: 'compilado punto→juego→set→partido con las reglas exactas del tenis: ganador, totales y probabilidad de tiebreak salen del mismo estado. Validado fuera de muestra; composición interna reservada. Estimaciones de un modelo estadístico — no consejo financiero.',
    attribution: ATTRIB,
  };
}

function modelCard() {
  const d = D.build();
  const H = (lbl) => ((d.priors.tours[lbl] || {}).holdout || {});
  return {
    name: 'Modelo de tenis GP', version: (d.priors || {}).model_version || 'tennis-sr-1',
    family: 'modelo propio de GP — composición reservada',
    doctrine: DOCTRINE,
    base: { matches: d.rows.length, players: Object.keys(d.players).length, window: d.meta.years, freshness: d.meta.last_match_date, source: 'derivada del proyecto de Jeff Sackmann (CC BY-NC-SA 4.0)',
      // LA BASE NO AVANZA, Y ESO SE DICE AQUÍ (19-ago). Los repos originales fueron retirados de GitHub y el
      // espejo que los reemplaza es una instantánea, no un flujo. Callarlo sería servir un modelo como si
      // estuviera al día cuando no lo está.
      lag_days: baseLagDays(),
      lag_note: (() => { const l = baseLagDays(); return l == null ? null : l <= 21
        ? 'la base llega hasta hace pocos días'
        : `la base se detiene ${l} días antes de hoy: la fuente pública original fue retirada y el espejo que la sustituye es una instantánea, no un flujo. El modelo no ha visto la forma de esos ${l} días y cada tesis lo paga en incertidumbre.`; })(),
      // LA COSTURA DE LA BASE, DICHA (20-ago). Desde que los repos originales desaparecieron, la base son
      // dos cosas pegadas: una ESPINA con saque, resto y break points hasta mayo, y una COLA diaria sacada
      // del marcador público que trae ganador, sets y juegos y NADA de saque. El Elo —que es lo que mueve
      // la probabilidad— se actualiza entero con la cola; los índices de saque y resto se quedan congelados
      // donde acabó la espina. Servir eso sin decirlo sería enseñar un índice de saque de agosto que en
      // realidad es de mayo.
      seam: (() => { const t = d.meta.tail; if (!t) return null;
        return { spine_until: t.spine_until, tail_from: t.from, tail_rows: t.rows,
          what_updates: 'Elo general y por superficie, forma, balance y racha',
          what_is_frozen: `índices de saque y resto, aces, dobles faltas y break points: congelados en ${t.spine_until}`,
          why: 'los repos públicos de Jeff Sackmann fueron retirados de GitHub; de ahí en adelante el dato viene del marcador público, que no publica estadística de saque.' }; })() },
    validation: {
      protocol: 'walk-forward estricto: constantes en desarrollo 2015-2024, holdout 2025→may-2026 evaluado UNA vez, ATP y WTA por separado; market-blind por construcción',
      atp: { n: (H('atp').ens || {}).n, skill_pct: r2((H('atp').ens || {}).skill_pct), auc: r3((H('atp').ens || {}).auc), games_mae: r2(H('atp').games_mae), games_mae_naive: r2(H('atp').games_mae_naive), tb_brier: r3(H('atp').tb_brier) },
      wta: { n: (H('wta').ens || {}).n, skill_pct: r2((H('wta').ens || {}).skill_pct), auc: r3((H('wta').ens || {}).auc), games_mae: r2(H('wta').games_mae), games_mae_naive: r2(H('wta').games_mae_naive), tb_brier: r3(H('wta').tb_brier) },
      note: 'skill = mejora del log-loss sobre la moneda; el ranking oficial se queda en ~8,8%. Skill ≠ rentabilidad: contra el mercado decide la sombra.',
    },
    families: { ML: 'referencia (benchmark), jamás pick', TOTAL: 'sombra', SPREAD: 'sombra' },
    disclaimer: 'estimaciones de un modelo estadístico, no consejo financiero.',
  };
}

async function modelSnapshot() {
  const d = D.build();
  const odds = G.odds;
  return {
    base: { rows: d.rows.length, players: Object.keys(d.players).length, freshness: d.meta.last_match_date },
    priors: d.priors.model_version, tours: Object.keys(d.priors.tours || {}),
    odds: odds ? { at: new Date(odds.at).toISOString(), events: odds.rows.length, tourneys: [...new Set(odds.rows.map((e) => e._tkey))] } : null,
    active_keys: await activeTennisKeys().catch(() => []),
    track: track(), disk: DISK_DIR,
  };
}

module.exports = { loadBoard, matchDetail,
  DISK_DIR, DOCTRINE, refreshOdds, board, agenda, recordShadow, settleShadow, track,
  playersDirectory, rankingBoard, snapshotRanks, playerProfile, h2h, simMatch, modelCard, modelSnapshot,
  eventModel, marketOf,
};
