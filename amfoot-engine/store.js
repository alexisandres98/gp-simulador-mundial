// amfoot-engine/store.js — FÚTBOL AMERICANO MÁS ALLÁ DE LA NFL: NCAAF y CFL (18-ago).
//
// El encargo de Alexis: "no limitarnos a NFL — quizás en las ligas más chicas, al ser más ineficientes,
// haya edge; quiero TODO generando picks, todo al monitor privado". Este motor es la arquitectura de
// nfl-engine con una dimensión de LIGA, al estilo esports (un juego = su config, sin compartir supuestos):
//
//   · MISMA doctrina: market-blind por construcción, TODAS las familias en SOMBRA, moneyline cerrado.
//     La sombra SÍ genera picks — se registran en privado con su precio, se liquidan solas y se mide CLV.
//   · MISMOS DTOs que nfl-engine/store (slate/gameIntel/teams/track/modelCard): la UI de NFL rinde estas
//     ligas sin una card nueva. Lo que una liga no tiene viaja en null y la UI ya sabe decir "sin muestra".
//   · MISMO simulador conjunto (nfl-engine/simulate): mu propio de la liga + pool de residuos REALES de
//     esa liga contra su cierre (cosechado: CFBD para college, The Odds API historical para CFL).
//   · Ratings walk-forward con las constantes AJUSTADAS POR LIGA (scripts/amfoot-fit.js, validación
//     escrita en data/amfoot/priors-*.json). Nada heredado de NFL: un favorito de −40 no es NFL.
//
// LA DIFERENCIA HONESTA CON NFL: aquí no hay EPA. El total sale de base móvil de liga + tendencia de
// anotación de los equipos (medida, walk-forward, igual que en el fit). El ADN por dimensión viaja null.
//
// RESULTADOS EN CALIENTE: el repo se recongela en cada deploy, así que los marcadores de la temporada en
// curso llegan por un OVERLAY en disco persistente: CFBD (1 llamada, cache 6 h) para college; el JSON del
// scoreboard oficial de la CFL para la CFL. La liquidación lee ese overlay, no ESPN (que ya no tiene CFL).
'use strict';

const fs = require('fs');
const path = require('path');
const { simulate } = require('../nfl-engine/simulate');
const POST = require('../nfl-engine/posterior');

const REPO_DIR = path.join(__dirname, '..', 'data', 'amfoot');
const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'amfoot');
const ensure = () => { try { fs.mkdirSync(DISK_DIR, { recursive: true }); } catch { } };
const rdD = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DISK_DIR, f), 'utf8')); } catch { return null; } };
const wrD = (f, o) => { try { ensure(); fs.writeFileSync(path.join(DISK_DIR, f), JSON.stringify(o)); return true; } catch { return false; } };
const rdR = (f) => { try { return JSON.parse(fs.readFileSync(path.join(REPO_DIR, f), 'utf8')); } catch { return null; } };

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const med = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[(a.length - 1) >> 1] : null; };

const G = global._amfoot = global._amfoot || { odds: {}, model: {}, results: {} };
// normalización de identidad: minúsculas, sin acentos ni puntuación — "San José State" (CFBD) tiene que
// casar con "San Jose State Spartans" (Odds API) y "Ottawa Redblacks" con el "RedBlacks" del feed oficial
const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const LEAGUES = {
  ncaaf: {
    label: 'College Football', sport_key: 'americanfootball_ncaaf',
    gamesFile: 'ncaaf-games.json', priorsFile: 'priors-ncaaf.json', teamsFile: 'ncaaf-teams.json',
    season: 2026, kickoff: '2026-08-29',
    doctrine: 'College EN SOMBRA desde el día uno: el modelo walk-forward 2016-2025 queda a ~1.25 pts del cierre en margen y ~0.65 en total — la única familia cerca del breakeven en el backtest es TOTAL (52.9% con umbral 6, n=2.199, dentro del ruido). La tesis de las ligas menos cubiertas se MIDE en sombra con CLV, no se supone. Moneyline cerrado por doctrina.',
  },
  cfl: {
    label: 'CFL', sport_key: 'americanfootball_cfl',
    gamesFile: 'cfl-games.json', priorsFile: 'priors-cfl.json', teamsFile: null,
    season: 2026, kickoff: '2026-06-11',
    doctrine: 'CFL EN SOMBRA: el modelo queda a ~0.67 pts del cierre en margen y ~0.12 en total (2022-2026, n=249 cierres — cosechados del histórico de The Odds API, snapshot a kickoff−5min). El backtest de TOTAL da señal en muestras chicas (57-65% en n=43/26): exactamente lo que la sombra 2026 tiene que confirmar o matar. Moneyline cerrado por doctrina.',
  },
};

// abreviaturas CFL (para la UI, mismo rol que D.CUR en NFL)
const CFL_ABBR = { 'BC Lions': 'BC', 'Calgary Stampeders': 'CGY', 'Edmonton Elks': 'EDM', 'Saskatchewan Roughriders': 'SSK', 'Winnipeg Blue Bombers': 'WPG', 'Hamilton Tiger-Cats': 'HAM', 'Toronto Argonauts': 'TOR', 'Ottawa Redblacks': 'OTT', 'Montreal Alouettes': 'MTL' };

// ── identidad de equipo ──────────────────────────────────────────────────────────────────────────────────
function teamMeta(lg) {
  if (G['tm_' + lg]) return G['tm_' + lg];
  const out = { byName: new Map(), info: {} };
  if (lg === 'ncaaf') {
    const t = rdR(LEAGUES.ncaaf.teamsFile);
    for (const row of (t && t.teams) || []) {
      out.info[row.school] = { abbr: row.abbr || row.school, name: row.school, logo: row.logo, conference: row.conference };
      // The Odds API nombra "TCU Horned Frogs" (escuela + mascota); CFBD nombra "TCU"
      out.byName.set(nrm(row.school), row.school);
      if (row.mascot) out.byName.set(nrm(row.school + ' ' + row.mascot), row.school);
    }
  } else {
    for (const [name, abbr] of Object.entries(CFL_ABBR)) {
      // logos CFL servidos por la casa (18-ago, pedido de Alexis): /logos/cfl_<abbr>.png
      out.info[name] = { abbr, name, logo: '/logos/cfl_' + abbr.toLowerCase() + '.png', conference: null };
      out.byName.set(nrm(name), name);
    }
  }
  G['tm_' + lg] = out;
  return out;
}
const infoOf = (lg, team) => teamMeta(lg).info[team] || { abbr: team, name: team, logo: null };
function resolveOddsName(lg, oddsName) {
  const m = teamMeta(lg);
  const k = nrm(oddsName);
  if (m.byName.has(k)) return m.byName.get(k);
  // último recurso college: la escuela es prefijo del nombre del libro ("Miami (OH) RedHawks")
  for (const [name] of Object.entries(m.info)) if (k.startsWith(nrm(name))) return name;
  return null;
}

// ── datos + overlay de resultados en caliente ────────────────────────────────────────────────────────────
function load(lg) {
  const C = LEAGUES[lg]; if (!C) return null;
  const cached = G['data_' + lg];
  if (cached && Date.now() - cached.at < 5 * 60e3) return cached;
  const raw = rdR(C.gamesFile);
  const priors = rdR(C.priorsFile);
  if (!raw || !priors) return null;
  const games = Object.values(raw.games).filter((g) => g.date && g.home && g.away).sort((a, b) => (a.date < b.date ? -1 : 1));
  // overlay: resultados frescos + calendario futuro de la temporada en curso (disco persistente,
  // escrito por refreshResults) — la base del repo se congela en cada deploy y esto la mantiene viva
  const ov = rdD(`${lg}-results.json`);
  if (ov) {
    const idx = new Map(games.map((g) => [`${g.date}|${g.home}|${g.away}`, g]));
    for (const r of Object.values(ov.results || {})) {
      const k = `${r.date}|${r.home}|${r.away}`;
      const g = idx.get(k);
      if (g) { if (g.hp == null) { g.hp = r.hp; g.ap = r.ap; } }
      else { const row = { season: C.season, date: r.date, start: r.start || null, home: r.home, away: r.away, hp: r.hp, ap: r.ap, type: r.type || 'REG', src: 'overlay' }; games.push(row); idx.set(k, row); }
    }
    for (const s of Object.values(ov.schedule || {})) {
      const k = `${s.date}|${s.home}|${s.away}`;
      if (!idx.has(k)) { const row = { season: C.season, date: s.date, start: s.start || null, home: s.home, away: s.away, hp: null, ap: null, week: s.week || null, type: s.type || 'REG', src: 'overlay' }; games.push(row); idx.set(k, row); }
    }
    games.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const out = { at: Date.now(), games, priors, season: C.season };
  G['data_' + lg] = out;
  return out;
}

// overlay de resultados: CFBD (college, 1 llamada) / scoreboard oficial (CFL, sin llave)
async function refreshResults(lg, { force = false } = {}) {
  const C = LEAGUES[lg];
  const st = rdD(`${lg}-results.json`) || { results: {} };
  if (!force && st.at && Date.now() - Date.parse(st.at) < 6 * 3600e3) return { ok: true, cached: true, n: Object.keys(st.results).length };
  try {
    if (lg === 'cfl') {
      const r = await fetch('https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      const rounds = await r.json();
      st.schedule = {};   // la base histórica solo trae COMPLETADOS: el calendario futuro vive en este overlay
      for (const rd of rounds || []) {
        if (rd.type === 'PRE') continue;
        for (const t of rd.tournaments || []) {
          if (!t.homeSquad || !t.awaySquad) continue;
          const date = String(t.date).slice(0, 10);
          // el feed oficial escribe "RedBlacks": se canonicaliza a la identidad de la casa al ingerir
          const hN = resolveOddsName('cfl', t.homeSquad.name) || t.homeSquad.name;
          const aN = resolveOddsName('cfl', t.awaySquad.name) || t.awaySquad.name;
          const k = `${date}|${hN}|${aN}`;
          if (t.status === 'complete') {
            st.results[k] = { date, start: t.date, home: hN, away: aN,
              hp: t.homeSquad.score, ap: t.awaySquad.score, type: rd.type === 'REG' ? 'REG' : 'POST' };
          } else {
            st.schedule[k] = { date, start: t.date, home: hN, away: aN,
              week: rd.number || null, type: rd.type === 'REG' ? 'REG' : 'POST' };
          }
        }
      }
    } else {
      const key = process.env.CFBD_API_KEY || '';
      if (!key) return { ok: false, why: 'sin CFBD_API_KEY' };
      const r = await fetch(`https://api.collegefootballdata.com/games?year=${C.season}&seasonType=regular`,
        { headers: { Authorization: 'Bearer ' + key, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      const rows = await r.json();
      for (const g of rows || []) {
        if (g.homePoints == null) continue;
        if (g.homeClassification !== 'fbs' && g.awayClassification !== 'fbs') continue;
        const date = String(g.startDate || '').slice(0, 10);
        st.results[`${date}|${g.homeTeam}|${g.awayTeam}`] = {
          date, start: g.startDate, home: g.homeTeam, away: g.awayTeam,
          hp: g.homePoints, ap: g.awayPoints, type: g.seasonType === 'postseason' ? 'POST' : 'REG',
        };
      }
    }
    st.at = new Date().toISOString();
    wrD(`${lg}-results.json`, st);
    G['data_' + lg] = null;                                 // invalida el snapshot para que el rating vea lo nuevo
    return { ok: true, n: Object.keys(st.results).length };
  } catch (e) { return { ok: false, why: e.message }; }
}

// ── rating walk-forward (el mismo solucionador que el fit, con las constantes del fit) ──────────────────
function ratings(data, priors, { beforeDate = '9999-12-31' } = {}) {
  const use = data.games.filter((g) => g.hp != null && g.date < beforeDate);
  if (!use.length) return { teams: {}, n: 0 };
  const curSeason = Math.max(...use.map((g) => g.season));
  const perTeam = {}; const obs = [];
  for (const g of use) {
    const margin = Math.max(-priors.cap, Math.min(priors.cap, g.hp - g.ap));
    obs.push({ home: g.home, away: g.away, margin, season: g.season, neutral: !!g.neutral, fcs: !!g.fcs_opp });
    (perTeam[g.home] = perTeam[g.home] || []).push(obs.length - 1);
    (perTeam[g.away] = perTeam[g.away] || []).push(obs.length - 1);
  }
  for (const [team, idxs] of Object.entries(perTeam)) {
    for (let k = 0; k < idxs.length; k++) {
      const o = obs[idxs[k]];
      let w = Math.pow(0.5, (idxs.length - 1 - k) / priors.halflife);
      if (o.season < curSeason) w *= Math.pow(priors.carry, curSeason - o.season);
      obs[idxs[k]]['w_' + team] = w;
    }
  }
  const R = {}; for (const t of Object.keys(perTeam)) R[t] = 0;
  for (let it = 0; it < 30; it++) {
    const nxt = {};
    for (const [team, idxs] of Object.entries(perTeam)) {
      let sw = 0, sv = 0;
      for (const i of idxs) {
        const o = obs[i];
        const isHome = o.home === team;
        const opp = isHome ? o.away : o.home;
        const mAdj = (isHome ? o.margin : -o.margin) - (o.neutral ? 0 : (isHome ? priors.hfa : -priors.hfa));
        const oppR = o.fcs && !(perTeam[opp] && perTeam[opp].length >= 6) ? priors.fcs_prior : (R[opp] || 0);
        sw += o['w_' + team]; sv += o['w_' + team] * (mAdj + oppR);
      }
      nxt[team] = sv / (sw + priors.K);
    }
    Object.assign(R, nxt);
  }
  const curN = {};
  for (const [team, idxs] of Object.entries(perTeam)) curN[team] = idxs.filter((i) => obs[i].season === curSeason).length;
  const out = {};
  for (const t of Object.keys(R)) out[t] = { pts: +R[t].toFixed(2), games_cur: curN[t] || 0 };
  return { teams: out, n: use.length, season: curSeason };
}
function scoringTendency(data, priors) {
  const per = {};
  for (const g of data.games) {
    if (g.hp == null) continue;
    (per[g.home] = per[g.home] || []).push(g.hp + g.ap);
    (per[g.away] = per[g.away] || []).push(g.hp + g.ap);
  }
  const out = {};
  for (const [t, xs] of Object.entries(per)) {
    let sw = 0, sv = 0;
    for (let k = 0; k < xs.length; k++) { const w = Math.pow(0.5, (xs.length - 1 - k) / priors.halflife); sw += w; sv += w * xs[k]; }
    out[t] = { avg: sv / sw, n: xs.length };
  }
  return out;
}

function modelSnapshot(lg) {
  const data = load(lg);
  if (!data) return null;
  const c = G.model[lg];
  if (c && Date.now() - c.at < 10 * 60e3) return c;
  const R = ratings(data, data.priors);
  const T = scoringTendency(data, data.priors);
  const done = data.games.filter((g) => g.hp != null);
  const bw = data.priors.base_win || 300;
  const base = done.slice(-bw).reduce((s, g) => s + g.hp + g.ap, 0) / Math.max(1, Math.min(bw, done.length));
  const M = { at: Date.now(), lg, data, R, T, base, priors: data.priors };
  G.model[lg] = M;
  return M;
}

const gid = (g) => `${g.date}|${g.home}|${g.away}`;
function gameModel(g, M, { withFan = false } = {}) {
  const rh = M.R.teams[g.home], ra = M.R.teams[g.away];
  if (!rh || !ra) return null;
  const muMargin = rh.pts - ra.pts + (g.neutral ? 0 : M.priors.hfa);
  const th = M.T[g.home], ta = M.T[g.away];
  const muTotal = (th && ta && th.n >= 6 && ta.n >= 6)
    ? M.base + 0.5 * ((th.avg - M.base) + (ta.avg - M.base))
    : M.base;
  const gc = (g.season > M.R.season) ? 0 : Math.min(rh.games_cur, ra.games_cur);
  // misma forma de incertidumbre que NFL; la constante escala con la sigma del error propio de la liga
  const uncPts = +((M.priors.sigma_margin / 3.7) / Math.sqrt(1 + gc)).toFixed(2);
  let seed = 11; for (const ch of gid(g)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const sim = simulate({ muMargin, muTotal, priors: {
    resid_pool: M.priors.resid_pool, outcome_atlas: M.priors.outcome_atlas, sigma_extra_margin: M.priors.sigma_extra_margin, sigma_extra_total: M.priors.sigma_extra_total,
  }, n: 20000, seed });
  if (!sim) return null;
  // MISMO ABANICO QUE NFL (19-ago): la posterior sobre la probabilidad, calculada una vez por partido.
  // Solo donde hay atlas: sin él el simulador cae al método viejo y desplazar el centro sí sería válido,
  // pero prefiero no tener dos caminos de decisión distintos según la liga — CFL sigue con las reglas
  // viejas y lo dice, que es más honesto que fingir una posterior sobre una distribución que no la soporta.
  const pr = { resid_pool: M.priors.resid_pool, outcome_atlas: M.priors.outcome_atlas,
    sigma_extra_margin: M.priors.sigma_extra_margin, sigma_extra_total: M.priors.sigma_extra_total };
  // solo cuando hace falta: cuesta ~0,9 s por partido y el listado de la jornada no decide nada
  const fan = (withFan && (M.priors.outcome_atlas || []).length >= 900)
    ? POST.buildFan({ simulate, muMargin, muTotal, priors: pr,
      sigmaM: POST.epistemicSigma(M.priors.sigma_extra_margin, uncPts),
      sigmaT: POST.epistemicSigma(M.priors.sigma_extra_total, uncPts), seed: seed >>> 0 })
    : null;
  return { home: g.home, away: g.away, neutral: !!g.neutral, muMargin: r2(muMargin), muTotal: r2(muTotal),
    rating: { home: rh, away: ra }, unc_pts: uncPts, games_cur: gc, sim, fan,
    model_version: M.priors.model_version };
}

// ── casas (The Odds API, 1 llamada por liga) + cierres ───────────────────────────────────────────────────
const ODDS_TTL = 30 * 60e3;
async function refreshOdds(lg, { force = false } = {}) {
  const key = process.env.SPORTSBOOK_PROVIDER_API_KEY || '';
  if (!key) return null;
  const c = G.odds[lg];
  if (c && !force && Date.now() - c.at < ODDS_TTL) return c;
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${LEAGUES[lg].sport_key}/odds?apiKey=${key}&regions=eu,us&markets=h2h,spreads,totals&oddsFormat=decimal`,
      { signal: AbortSignal.timeout(25000) });
    try { if (global._oddsCredits) { const v = Number(r.headers.get('x-requests-remaining')); if (Number.isFinite(v)) { global._oddsCredits.remaining = v; global._oddsCredits.at = Date.now(); } } } catch { }
    const j = await r.json();
    if (!Array.isArray(j)) return c || null;
    G.odds[lg] = { at: Date.now(), rows: j };
    snapshotCloses(lg, j);
    return G.odds[lg];
  } catch { return c || null; }
}
function snapshotCloses(lg, rows) {
  const st = rdD(`${lg}-closes.json`) || { closes: {} };
  const now = Date.now();
  for (const ev of rows) {
    const t = Date.parse(ev.commence_time || 0);
    if (!(t > now - 3600e3)) continue;
    const sp = [], tt = [], mlh = [], mla = [];
    for (const bk of ev.bookmakers || []) for (const mk of bk.markets || []) {
      if (mk.key === 'spreads') { const h = (mk.outcomes || []).find((o) => o.name === ev.home_team); if (h && h.point != null) sp.push({ line: -h.point, price: h.price }); }
      if (mk.key === 'totals') { const o = (mk.outcomes || []).find((x) => x.name === 'Over'); if (o && o.point != null) tt.push({ line: o.point, price: o.price }); }
      if (mk.key === 'h2h') { const h = (mk.outcomes || []).find((o) => o.name === ev.home_team), a = (mk.outcomes || []).find((o) => o.name === ev.away_team); if (h) mlh.push(h.price); if (a) mla.push(a.price); }
    }
    st.closes[ev.id] = {
      home: ev.home_team, away: ev.away_team, commence: ev.commence_time, at: new Date().toISOString(),
      spread_line: med(sp.map((x) => x.line)), spread_price: med(sp.map((x) => x.price)),
      total_line: med(tt.map((x) => x.line)), total_price: med(tt.map((x) => x.price)),
      ml_home: med(mlh), ml_away: med(mla),
    };
  }
  st.at = new Date().toISOString();
  wrD(`${lg}-closes.json`, st);
}
function marketFor(lg, g, odds) {
  if (!odds || !odds.rows) return null;
  const ev = odds.rows.find((e) => resolveOddsName(lg, e.home_team) === g.home && resolveOddsName(lg, e.away_team) === g.away);
  if (!ev) return null;
  const out = { event_id: ev.id, commence: ev.commence_time, books: [], spread: {}, total: {}, ml: {} };
  for (const bk of ev.bookmakers || []) {
    const row = { book: bk.key, at: bk.last_update };
    for (const mk of bk.markets || []) {
      if (mk.key === 'h2h') {
        const h = (mk.outcomes || []).find((o) => o.name === ev.home_team), a = (mk.outcomes || []).find((o) => o.name === ev.away_team);
        if (h && a) { row.ml = { home: h.price, away: a.price }; out.ml[bk.key] = row.ml; }
      }
      if (mk.key === 'spreads') {
        const h = (mk.outcomes || []).find((o) => o.name === ev.home_team), a = (mk.outcomes || []).find((o) => o.name === ev.away_team);
        if (h && a && h.point != null) { row.spread = { line: -h.point, home: h.price, away: a.price }; out.spread[bk.key] = row.spread; }
      }
      if (mk.key === 'totals') {
        const o = (mk.outcomes || []).find((x) => x.name === 'Over'), u = (mk.outcomes || []).find((x) => x.name === 'Under');
        if (o && u && o.point != null) { row.total = { line: o.point, over: o.price, under: u.price }; out.total[bk.key] = row.total; }
      }
    }
    out.books.push(row);
  }
  const novig2 = (pa, pb) => { const ia = 1 / pa, ib = 1 / pb; return ia / (ia + ib); };
  const sp = Object.values(out.spread), tt = Object.values(out.total), mls = Object.values(out.ml);
  out.consensus = {
    spread_line: med(sp.map((x) => x.line)), total_line: med(tt.map((x) => x.line)),
    ml_p_home: mls.length ? r3(novig2(med(mls.map((x) => x.home)), med(mls.map((x) => x.away)))) : null,
    books: out.books.length,
  };
  const best = (rows, side, dict) => {
    let b = null;
    for (const [book, x] of Object.entries(dict)) if (x[side] != null && (!b || x[side] > b[side])) b = { ...x, book };
    return b;
  };
  out.best = {
    spread_home: best(sp, 'home', out.spread), spread_away: best(sp, 'away', out.spread),
    total_over: best(tt, 'over', out.total), total_under: best(tt, 'under', out.total),
  };
  return out;
}

// ── edges + sombra (la MISMA cadena de gates de NFL) ─────────────────────────────────────────────────────
function evaluateEdges(model, mk) {
  const out = [];
  if (mk.consensus.spread_line != null && mk.best.spread_home && mk.best.spread_away) {
    const line = mk.consensus.spread_line;
    const cv = model.sim.coverProb(line);
    for (const side of ['home', 'away']) {
      const b = side === 'home' ? mk.best.spread_home : mk.best.spread_away;
      out.push(gate({ family: 'SPREAD', side, line, odds: b[side], book: b.book,
        p_model: side === 'home' ? cv.p : 1 - cv.p, p_implied: 1 / b[side], model, push_p: cv.push }));
    }
  }
  if (mk.consensus.total_line != null && mk.best.total_over && mk.best.total_under) {
    const line = mk.consensus.total_line;
    const ov = model.sim.overProb(line);
    for (const side of ['over', 'under']) {
      const b = side === 'over' ? mk.best.total_over : mk.best.total_under;
      out.push(gate({ family: 'TOTAL', side, line, odds: b[side], book: b.book,
        p_model: side === 'over' ? ov.p : 1 - ov.p, p_implied: 1 / b[side], model, push_p: ov.push }));
    }
  }
  return { candidates: out, verdict_note: 'familias en SOMBRA: los veredictos se registran y liquidan en privado; nada de esto es una pick pública. El moneyline ni se evalúa (doctrina de la casa).' };
}
function gate(c) {
  const edgePp = (c.p_model - c.p_implied) * 100;
  // La conversión de puntos a pp se LEE de la distribución en ESTA línea, no de una pendiente fija.
  const uncPp = (() => {
    const u = c.model.unc_pts;
    if (!(u > 0)) return 0;
    const f = c.family === 'TOTAL' ? (c.model.sim && c.model.sim.overProb) : (c.model.sim && c.model.sim.coverProb);
    if (typeof f !== 'function') return u * 2.8;
    const lo = f(c.line - u), hi = f(c.line + u);
    if (!lo || !hi || lo.p == null || hi.p == null) return u * 2.8;
    return Math.abs(lo.p - hi.p) * 100 / 2;
  })();
  // LA POSTERIOR DECIDE donde hay abanico (College); donde no lo hay (CFL, muestra corta) siguen las reglas
  // viejas y el veredicto lo dice. Ver la nota larga en nfl-engine/posterior.js.
  const post = c.model.fan ? POST.edgePosterior({ fan: c.model.fan, family: c.family, line: c.line, side: c.side, odds: c.odds }) : null;
  const dec = POST.decide(post);
  const gates = [];
  if (post) { for (const x of dec.checks) gates.push({ gate: x.check, pass: x.pass, detail: x.detail }); }
  else {
    gates.push({ gate: 'noise', pass: edgePp > uncPp, detail: `sin posterior · ${edgePp.toFixed(1)} pp vs incertidumbre ${uncPp.toFixed(1)} pp` });
    gates.push({ gate: 'edge', pass: edgePp >= 3, detail: 'sin posterior · listón mínimo 3 pp (con signo)' });
  }
  gates.push({ gate: 'diagnostico_ventaja', pass: true, detail: `ventaja puntual ${edgePp.toFixed(1)} pp · incertidumbre ${uncPp.toFixed(1)} pp (informativo)` });
  gates.push({ gate: 'orthogonality', pass: true, detail: 'modelo market-blind por construcción' });
  gates.push({ gate: 'push', pass: (c.push_p || 0) < 0.06, detail: `push ${(100 * (c.push_p || 0)).toFixed(1)}%` });
  const pass = gates.every((x) => x.pass);
  return { family: c.family, side: c.side, line: c.line, odds: c.odds, book: c.book,
    p_model: r3(c.p_model), p_implied: r3(c.p_implied), edge_pp: r2(edgePp),
    posterior: post, posterior_governs: !!post,
    gates, verdict: pass ? 'SHADOW_PICK' : 'NO_PICK', no_pick_reason: pass ? null : (gates.find((x) => !x.pass) || {}).gate };
}


async function recordShadow(lg) {
  const M = modelSnapshot(lg);
  if (!M) return { recorded: 0 };
  const odds = await refreshOdds(lg).catch(() => null);
  if (!odds) return { recorded: 0 };
  const st = rdD(`${lg}-picks.json`) || { picks: [] };
  const have = new Set(st.picks.map((p) => p.key));
  let n = 0;
  for (const ev of odds.rows || []) {
    const home = resolveOddsName(lg, ev.home_team), away = resolveOddsName(lg, ev.away_team);
    if (!home || !away) continue;
    const kickoff = Date.parse(ev.commence_time || 0);
    if (!(kickoff > Date.now() && kickoff - Date.now() < 6 * 864e5)) continue;
    // el partido en la agenda propia (por fecha del kickoff, tolerando el día previo por husos)
    const dEv = String(ev.commence_time).slice(0, 10);
    const g = M.data.games.find((x) => (x.home === home && x.away === away) && (x.date === dEv || Math.abs(Date.parse(x.date) - Date.parse(dEv)) <= 864e5) && x.hp == null);
    if (!g) continue;
    const model = gameModel(g, M, { withFan: true });
    const mk = marketFor(lg, g, odds);
    if (!model || !mk) continue;
    for (const c of evaluateEdges(model, mk).candidates) {
      if (c.verdict !== 'SHADOW_PICK') continue;
      const key = `${gid(g)}|${c.family}|${c.side}|${c.line}`;
      if (have.has(key)) continue;
      have.add(key); n++;
      st.picks.push({
        key, league: lg, game_id: gid(g), family: c.family, side: c.side, line: c.line,
        odds: c.odds, book: c.book, p_model: c.p_model, p_implied: c.p_implied, edge_pp: c.edge_pp,
        home: infoOf(lg, g.home).abbr, away: infoOf(lg, g.away).abbr, home_full: g.home, away_full: g.away,
        week: g.week || null, season: g.season, kickoff: new Date(kickoff).toISOString(), odds_event: ev.id,
        model_version: model.model_version, seed: model.sim.seed, unc_pts: model.unc_pts,
        status: 'OPEN', created_at: new Date().toISOString(), regime: 'shadow',
      });
    }
  }
  if (n) wrD(`${lg}-picks.json`, st);
  return { recorded: n, total: st.picks.length };
}

async function settleShadow(lg) {
  const st = rdD(`${lg}-picks.json`) || { picks: [] };
  const open = st.picks.filter((p) => p.status === 'OPEN' && Date.parse(p.kickoff) < Date.now() - 4 * 3600e3);
  if (!open.length) return { settled: 0 };
  await refreshResults(lg, { force: true }).catch(() => null);
  const M = modelSnapshot(lg);
  const closes = rdD(`${lg}-closes.json`) || { closes: {} };
  let settled = 0;
  for (const p of open) {
    const g = M && M.data.games.find((x) => gid(x) === p.game_id && x.hp != null);
    if (!g) {
      // una semana sin resultado (partido movido/cancelado): VOID con motivo, no eternamente abierto
      if (Date.parse(p.kickoff) < Date.now() - 7 * 864e5) { p.status = 'SETTLED'; p.result = 'VOID'; p.units = 0; p.settled_at = new Date().toISOString(); settled++; }
      continue;
    }
    const margin = g.hp - g.ap, total = g.hp + g.ap;
    let win = null;
    if (p.family === 'SPREAD') win = p.side === 'home' ? (margin > p.line ? 1 : margin === p.line ? null : 0) : (margin < p.line ? 1 : margin === p.line ? null : 0);
    if (p.family === 'TOTAL') win = p.side === 'over' ? (total > p.line ? 1 : total === p.line ? null : 0) : (total < p.line ? 1 : total === p.line ? null : 0);
    p.status = 'SETTLED';
    p.result = win == null ? 'PUSH' : win ? 'WIN' : 'LOSS';
    p.final = { home: g.hp, away: g.ap, margin, total };
    p.units = win == null ? 0 : win ? +(p.odds - 1).toFixed(3) : -1;
    const cl = closes.closes[p.odds_event] || Object.values(closes.closes || {}).find((c) => c.home === p.home_full && c.away === p.away_full);
    if (cl) {
      if (p.family === 'SPREAD' && cl.spread_line != null) p.close = { line: cl.spread_line, price: cl.spread_price };
      if (p.family === 'TOTAL' && cl.total_line != null) p.close = { line: cl.total_line, price: cl.total_price };
      if (p.close && p.close.price) p.clv_pct = +((p.odds / p.close.price - 1) * 100).toFixed(2);
    }
    p.settled_at = new Date().toISOString();
    settled++;
  }
  if (settled) wrD(`${lg}-picks.json`, st);
  return { settled };
}

function track(lg) {
  const C = LEAGUES[lg];
  const st = rdD(`${lg}-picks.json`) || { picks: [] };
  const done = st.picks.filter((p) => p.status === 'SETTLED' && p.result !== 'VOID');
  const w = done.filter((p) => p.result === 'WIN').length, l = done.filter((p) => p.result === 'LOSS').length;
  const units = done.reduce((s, p) => s + (p.units || 0), 0);
  const clv = done.filter((p) => p.clv_pct != null);
  const byFam = {};
  for (const p of done) {
    const F = byFam[p.family] = byFam[p.family] || { n: 0, w: 0, units: 0, clv: [] };
    F.n++; if (p.result === 'WIN') F.w++; F.units += p.units || 0;
    if (p.clv_pct != null) F.clv.push(p.clv_pct);
  }
  return {
    regime: 'shadow', doctrine: C.doctrine, league: lg,
    open: st.picks.filter((p) => p.status === 'OPEN').length,
    settled: done.length, w, l, push: done.length - w - l,
    units: r2(units), roi_pct: done.length ? r2(100 * units / done.length) : null,
    clv_avg_pct: clv.length ? r2(clv.reduce((s, p) => s + p.clv_pct, 0) / clv.length) : null, clv_n: clv.length,
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, F]) => [k, {
      n: F.n, hit_pct: F.n ? r2(100 * F.w / F.n) : null, units: r2(F.units),
      clv_avg_pct: F.clv.length ? r2(F.clv.reduce((a, b) => a + b, 0) / F.clv.length) : null,
    }])),
    recent: done.slice(-40).reverse(), open_list: st.picks.filter((p) => p.status === 'OPEN').slice(-30).reverse(),
    reading: done.length < 40 ? `con ${done.length} liquidadas TODO es ruido: esta pantalla acumula registro, no se lee todavía.` : 'la vara es el CLV por familia, no el ROI.',
  };
}

// ── agenda / partido / equipos / model card — MISMAS FORMAS que nfl-engine/store ─────────────────────────
function upcoming(data, { days = 12 } = {}) {
  const now = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  return data.games.filter((g) => g.date >= now && g.date <= to && g.hp == null);
}
async function slate(lg, { days = 12 } = {}) {
  const C = LEAGUES[lg];
  const M = modelSnapshot(lg);
  if (!M) return { available: false, why: `los agregados de ${C ? C.label : lg} no están cargados.` };
  const odds = await refreshOdds(lg).catch(() => null);
  const rows = upcoming(M.data, { days });
  const out = [];
  for (const g of rows) {
    const model = gameModel(g, M);
    const mk = marketFor(lg, g, odds);
    const ih = infoOf(lg, g.home), ia = infoOf(lg, g.away);
    out.push({
      id: gid(g), espn: null, week: g.week || null, date: g.date, time: g.start ? String(g.start).slice(11, 16) : null,
      home: { abbr: ih.abbr, name: g.home, logo: ih.logo },
      away: { abbr: ia.abbr, name: g.away, logo: ia.logo },
      neutral: !!g.neutral, stadium: null, roof: null,
      model: model ? { p_home: model.sim.p_home, mu_margin: model.muMargin, mu_total: model.muTotal, unc_pts: model.unc_pts } : null,
      market: mk ? { spread: mk.consensus.spread_line, total: mk.consensus.total_line, p_home: mk.consensus.ml_p_home, books: mk.consensus.books } : null,
      delta: (model && mk && mk.consensus.spread_line != null)
        ? { spread: r2(model.muMargin - mk.consensus.spread_line), total: mk.consensus.total_line != null ? r2(model.muTotal - mk.consensus.total_line) : null }
        : null,
    });
  }
  out.sort((a, b) => String(a.date + (a.time || '')).localeCompare(String(b.date + (b.time || ''))));
  return {
    available: true, season: C.season, days, league: lg, label: C.label,
    week: out.length ? out[0].week : null, games: out,
    books: odds ? [...new Set(odds.rows.flatMap((e) => (e.bookmakers || []).map((b) => b.key)))].length : 0,
    odds_at: odds ? new Date(odds.at).toISOString() : null,
    regime_note: lg === 'ncaaf'
      ? 'college: 136 equipos FBS y portal de transferencias — el arrastre entre temporadas vale menos que en NFL (carry 0.5 medido) y las primeras semanas llevan la incertidumbre que corresponde.'
      : 'CFL: 9 equipos y ~85 partidos por temporada — la muestra anual es chica y el sistema lo dice en vez de disimularlo.',
    doctrine: C.doctrine, at: new Date().toISOString(),
  };
}

async function gameIntel(lg, id) {
  const C = LEAGUES[lg];
  const M = modelSnapshot(lg);
  if (!M) return null;
  const g = M.data.games.find((x) => gid(x) === id);
  if (!g) return null;
  const model = gameModel(g, M, { withFan: true });
  const odds = await refreshOdds(lg).catch(() => null);
  const mk = marketFor(lg, g, odds);
  const ih = infoOf(lg, g.home), ia = infoOf(lg, g.away);
  const played = M.data.games.filter((x) => x.hp != null);
  const form = (team) => played.filter((x) => x.home === team || x.away === team).slice(-5)
    .map((x) => { const isH = x.home === team; return { date: x.date, vs: infoOf(lg, isH ? x.away : x.home).abbr, home: isH,
      pts: isH ? x.hp : x.ap, opp_pts: isH ? x.ap : x.hp, w: (isH ? x.hp > x.ap : x.ap > x.hp) ? 1 : 0 }; });
  const h2h = played.filter((x) => (x.home === g.home && x.away === g.away) || (x.home === g.away && x.away === g.home))
    .slice(-6).reverse().map((x) => ({ date: x.date, home: infoOf(lg, x.home).abbr, away: infoOf(lg, x.away).abbr, hs: x.hp, as: x.ap }));
  const five = [];
  if (model) {
    const rd = model.rating.home.pts - model.rating.away.pts;
    five.push({ k: 'rating', txt: `Diferencia de rating: ${rd > 0 ? ih.abbr : ia.abbr} ${Math.abs(rd).toFixed(1)} pts mejor (opponent-adjusted, recency-weighted)`, val: r2(rd) });
    five.push(model.neutral ? { k: 'neutral', txt: 'Cancha neutral: sin ventaja de local', val: 0 }
      : { k: 'hfa', txt: `Ventaja de local ajustada de la liga: ${M.priors.hfa} pts`, val: M.priors.hfa });
    const th = M.T[g.home], ta = M.T[g.away];
    if (th && ta) five.push({ k: 'pace', txt: `Tendencia de anotación: ${ih.abbr} ${r2(th.avg)} · ${ia.abbr} ${r2(ta.avg)} pts/partido (media de liga ${r2(M.base)})`, val: r2((th.avg + ta.avg) / 2 - M.base) });
    if (g.fcs_opp) five.push({ k: 'fcs', txt: 'Cruce con equipo fuera de FBS: el rival se modela con el prior de su división, incertidumbre alta', val: null });
    five.push({ k: 'sample', txt: model.games_cur === 0 ? `Cero partidos ${C.season}: el rating es el prior encogido de temporadas anteriores — incertidumbre máxima` : `${model.games_cur} partidos ${C.season} del equipo con menos muestra`, val: model.unc_pts });
  }
  const edges = model && mk ? evaluateEdges(model, mk) : { candidates: [], verdict_note: 'sin mercado abierto todavía.' };
  return {
    id: gid(g), espn: null, week: g.week || null, season: g.season, date: g.date,
    time: g.start ? String(g.start).slice(11, 16) : null, league: lg,
    home: { abbr: ih.abbr, name: g.home, logo: ih.logo, qb: null, coach: null, rest: null, conference: ih.conference },
    away: { abbr: ia.abbr, name: g.away, logo: ia.logo, qb: null, coach: null, rest: null, conference: ia.conference },
    neutral: !!g.neutral, stadium: null, roof: null, surface: null, referee: null, venue: null,
    final: g.hp != null ? { home: g.hp, away: g.ap, ot: null } : null,
    model: model ? {
      p_home: model.sim.p_home, mu_margin: model.muMargin, mu_total: model.muTotal,
      fair_spread: r2(-model.muMargin), fair_total: model.muTotal,
      team_home_mu: model.sim.team_home_mu, team_away_mu: model.sim.team_away_mu,
      margin_q: model.sim.margin, total_q: model.sim.total,
      margin_hist: model.sim.margin_hist, total_hist: model.sim.total_hist,
      key_mass: model.sim.key_mass, unc_pts: model.unc_pts, games_cur: model.games_cur,
      rating: model.rating, seed: model.sim.seed, model_version: model.model_version,
      spread_ladder: (() => { const c = Math.round(model.muMargin * 2) / 2; const o = [];
        for (let l = c - 9; l <= c + 9; l += 0.5) { const cv = model.sim.coverProb(l); o.push({ line: +l.toFixed(1), p_home: +cv.p.toFixed(4), push: cv.push }); } return o; })(),
      total_ladder: (() => { const c = Math.round(model.muTotal * 2) / 2; const o = [];
        for (let l = c - 12; l <= c + 12; l += 0.5) { const ov = model.sim.overProb(l); o.push({ line: +l.toFixed(1), p_over: +ov.p.toFixed(4), push: ov.push }); } return o; })(),
    } : null,
    five,
    dna: { home: null, away: null, note: lg === 'ncaaf' ? 'sin EPA por dimensión en la base free de college todavía: el ADN llegará cuando entren los PPA de CFBD.' : 'la CFL no publica EPA: el ADN por dimensión no existe aquí y no se inventa.' },
    form: { home: form(g.home), away: form(g.away) },
    h2h, weather: null, market: mk, edges,
    provenance: [
      { source: lg === 'ncaaf' ? 'Base propia GP: CollegeFootballData (juegos + cierres históricos), point-in-time' : 'Base propia GP: ESPN 2021-22 + Wikipedia 2023-25 (doble testigo) + scoreboard oficial CFL; cierres del histórico de The Odds API', kind: 'derivado', at: new Date(M.at).toISOString() },
      mk ? { source: `Mercados: The Odds API (${mk.consensus.books} casas)`, kind: 'proveedor', at: odds ? new Date(odds.at).toISOString() : null } : null,
    ].filter(Boolean),
    doctrine: C.doctrine, at: new Date().toISOString(),
  };
}

// ── JUGADORES (19-ago) ──────────────────────────────────────────────────────────────────────────────────
// La pestaña de Jugadores es compartida con la NFL y al cambiar a College o CFL se quedaba vacía: este
// motor nunca tuvo capa de jugadores. La plantilla la cosecha `scripts/amfoot-rosters.js` desde ESPN
// (nombre, dorsal, posición, altura, peso, año, procedencia y headshot auto-hospedado) y aquí solo se
// sirve. Se dice SIEMPRE lo que es: una plantilla con identidad, no una medición por jugador — este modelo
// puntúa equipos, no jugadores, y fingir lo contrario sería inventarse un número.
const RST = {};
function rosterOf(lg) {
  if (RST[lg] !== undefined) return RST[lg];
  let j = null;
  for (const dir of [DISK_DIR, REPO_DIR]) {
    try { j = JSON.parse(fs.readFileSync(path.join(dir, `roster-${lg}.json`), 'utf8')); break; } catch { }
  }
  RST[lg] = j;
  return j;
}
const normName = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function playersDirectory(lg, { q = '', team = '', limit = 120 } = {}) {
  const R = rosterOf(lg);
  const C = LEAGUES[lg];
  if (!R || !R.players) {
    return { available: false, league: lg, label: C && C.label,
      why: 'la plantilla de esta liga todavía no está cosechada (corre en Render: ESPN bloquea la IP de desarrollo).' };
  }
  const nq = normName(q), nt = normName(team);
  const rows = Object.values(R.players).filter((p) => {
    if (nq && !normName(p.name).includes(nq)) return false;
    if (nt && !normName(p.team).includes(nt)) return false;
    return true;
  });
  rows.sort((a, b) => normName(a.team).localeCompare(normName(b.team)) || (+(a.jersey || 999) - +(b.jersey || 999)));
  return {
    available: true, league: lg, label: C && C.label,
    n: Object.keys(R.players).length, teams: Object.keys(R.teams || {}).length,
    rows: rows.slice(0, limit).map((p) => ({ ...p, photo: p.photo ? `/logos/amfoot/${lg}/${p.photo}` : null })),
    truncated: Math.max(0, rows.length - limit),
    at: R.at, source: R.source,
    note: 'plantilla e identidad; este modelo puntúa EQUIPOS, no jugadores — no hay rating individual y no se inventa.',
  };
}

function playerProfile(lg, id) {
  const R = rosterOf(lg);
  if (!R || !R.players || !R.players[id]) return { available: false, why: 'ese jugador no está en la plantilla cosechada' };
  const p = R.players[id];
  const mates = Object.values(R.players).filter((x) => x.team_id === p.team_id && x.id !== p.id)
    .sort((a, b) => (+(a.jersey || 999) - +(b.jersey || 999)))
    .slice(0, 60)
    .map((x) => ({ id: x.id, name: x.name, pos: x.pos, jersey: x.jersey, photo: x.photo ? `/logos/amfoot/${lg}/${x.photo}` : null }));
  // el equipo SÍ está medido, así que la ficha del jugador enseña el rating de SU equipo y dice que es eso
  let team = null;
  try { team = teamsDirectory(lg).rows.find((t) => normName(t.name) === normName(p.team)) || null; } catch { }
  return {
    available: true, league: lg, label: (LEAGUES[lg] || {}).label,
    player: { ...p, photo: p.photo ? `/logos/amfoot/${lg}/${p.photo}` : null },
    team, mates, at: R.at, source: R.source,
    note: 'lo medido aquí es el EQUIPO. La ficha da identidad de jugador y el rating del equipo al que pertenece; un rating individual exigiría una base por jugador que este modelo no tiene.',
  };
}

function teamsDirectory(lg) {
  const C = LEAGUES[lg];
  const M = modelSnapshot(lg);
  if (!M) return { available: false };
  const season = C.season;
  const played = M.data.games.filter((g) => g.hp != null && g.season === season);
  const meta = teamMeta(lg);
  const rows = Object.keys(meta.info).map((team) => {
    const R = M.R.teams[team];
    let w = 0, l = 0;
    for (const g of played) {
      if (g.home === team) { if (g.hp > g.ap) w++; else if (g.hp < g.ap) l++; }
      else if (g.away === team) { if (g.ap > g.hp) w++; else if (g.ap < g.hp) l++; }
    }
    const info = meta.info[team];
    return { abbr: info.abbr, name: team, logo: info.logo, conference: info.conference,
      rating: R ? R.pts : null,
      games_cur: R ? ((M.R.season != null && season > M.R.season) ? 0 : R.games_cur) : 0,
      record: `${w}-${l}`, pass_off: null, rush_off: null, pass_def: null, rush_def: null };
  }).filter((t) => t.rating != null)
    .sort((a, b) => (b.rating || -99) - (a.rating || -99)).map((t, i) => ({ rank: i + 1, ...t }));
  return { available: true, season, league: lg, teams: rows,
    note: `rating GP en PUNTOS (opponent-adjusted, recency-weighted; constantes ajustadas para ${C.label} por walk-forward). Sin EPA por dimensión en esta liga: las columnas de proceso viajan vacías y no se inventan.`,
    at: new Date(M.at).toISOString() };
}

async function teamProfile(lg, name) {
  const C = LEAGUES[lg];
  const M = modelSnapshot(lg);
  if (!M) return { available: false };
  const meta = teamMeta(lg);
  const team = meta.info[name] ? name : resolveOddsName(lg, name) || Object.keys(meta.info).find((t) => meta.info[t].abbr === name);
  if (!team) return { available: false, why: `no reconozco "${name}"` };
  const dirRow = teamsDirectory(lg).teams.find((x) => x.name === team);
  const season = C.season;
  const sched = M.data.games.filter((g) => g.season === season && (g.home === team || g.away === team))
    .map((g) => ({ id: gid(g), week: g.week || null, date: g.date, home: g.home === team,
      vs: g.home === team ? g.away : g.home, vs_logo: infoOf(lg, g.home === team ? g.away : g.home).logo,
      final: g.hp != null ? { pts: g.home === team ? g.hp : g.ap, opp: g.home === team ? g.ap : g.hp } : null }));
  const past = M.data.games.filter((g) => g.hp != null && (g.home === team || g.away === team)).slice(-10).reverse()
    .map((g) => ({ date: g.date, home: g.home === team, vs: infoOf(lg, g.home === team ? g.away : g.home).abbr,
      pts: g.home === team ? g.hp : g.ap, opp_pts: g.home === team ? g.ap : g.hp,
      w: (g.home === team ? g.hp > g.ap : g.ap > g.hp) ? 1 : 0 }));
  return { available: true, team: dirRow || { abbr: infoOf(lg, team).abbr, name: team, logo: infoOf(lg, team).logo, rating: null, games_cur: 0, record: '0-0' },
    season, league: lg, qb: null, coach: null, qb_note: '',
    dna: null, schedule: sched, recent: past, at: new Date(M.at).toISOString() };
}

function modelCard(lg) {
  const C = LEAGUES[lg];
  const data = load(lg);
  if (!data) return { available: false };
  const v = data.priors.validation || {};
  return {
    available: true, league: lg, label: C.label, model_version: data.priors.model_version,
    market_blind: true, families: [
      { family: 'SPREAD', state: 'shadow', why: (v.overall ? `MAE ${v.overall.mae_margen_modelo} vs ${v.overall.mae_margen_cierre} del cierre` : 'en sombra') + '. Acumula registro privado + CLV.' },
      { family: 'TOTAL', state: 'shadow', why: (v.overall ? `MAE ${v.overall.mae_total_modelo} vs ${v.overall.mae_total_cierre} del cierre` : 'en sombra') + '. La familia más cercana al breakeven en el backtest: la sombra decide.' },
      { family: 'MONEYLINE', state: 'closed', why: 'cerrado por doctrina de la casa (pérdidas medidas del ganador en dos deportes).' },
    ],
    // CAJA NEGRA (18-ago, orden de Alexis): la ficha enseña la EVIDENCIA (validación, MAE, muestras);
    // la receta (spec, HFA, constantes) es interna y no sale por la API.
    spec: 'modelo propio de GP — composición reservada; validado walk-forward contra el cierre',
    validation: v, doctrine: C.doctrine, at: data.priors.at,
  };
}

// ── SIMULADOR DE ENFRENTAMIENTO (18-ago): mismo contrato que nfl-engine.simMatch, para College y CFL
function simMatch(lg, homeRef, awayRef, { neutral = false } = {}) {
  const M = modelSnapshot(lg);
  if (!M) return { available: false, why: 'el modelo de la liga no está cargado.' };
  const meta = teamMeta(lg);
  const find = (ref) => {
    const k = nrm(ref);
    if (!k) return null;
    if (meta.byName.has(k)) return meta.byName.get(k);
    for (const name of Object.keys(meta.info)) if (k.length >= 4 && nrm(name).includes(k)) return name;
    return null;
  };
  const h = find(homeRef), a = find(awayRef);
  if (!h || !a) return { available: false, why: `no reconozco a ${!h ? homeRef : awayRef} en ${LEAGUES[lg] ? LEAGUES[lg].label : lg}.` };
  if (h === a) return { available: false, why: 'los dos nombres resuelven al mismo equipo.' };
  const seasonNow = new Date().getUTCFullYear();
  const model = gameModel({ date: 'sim', home: h, away: a, neutral, season: seasonNow }, M);
  if (!model) return { available: false, why: 'algún equipo no tiene rating todavía.' };
  const dir = teamsDirectory(lg);
  const row = (t) => ((dir && dir.teams) || []).find((x) => x.name === t) || { name: t, ...infoOf(lg, t) };
  return { available: true, neutral, league: lg, home: row(h), away: row(a),
    model: { muMargin: model.muMargin, muTotal: model.muTotal, unc_pts: model.unc_pts, sim: model.sim },
    note: 'proyección del modelo propio sin cuotas: en un partido real el mercado también habla.',
    at: new Date().toISOString() };
}

module.exports = { playersDirectory, playerProfile, LEAGUES, load, modelSnapshot, gameModel, refreshOdds, refreshResults, marketFor,
  slate, gameIntel, teamsDirectory, teamProfile, modelCard, recordShadow, settleShadow, track, DISK_DIR, simMatch };
