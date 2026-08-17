// nfl-engine/store.js — LA CAPA QUE SIRVE EL TERMINAL NFL (17-ago, blueprint V1).
//
// Junta la base propia (ratings + estados EPA point-in-time), el simulador conjunto, las casas y el clima,
// y arma los objetos que consumen las rutas /api/nfl/*. Server.js solo tiene rutas; aquí se razona.
//
// LAS DECISIONES QUE CONVIENE LEER ANTES DE TOCAR:
//   1. EL MODELO ES MARKET-BLIND POR CONSTRUCCIÓN (NFL-0521/0596/0522). Ninguna función de probabilidad
//      lee una cuota. La ortogonalidad no es un check: es que el camino de código no existe. El "edge" se
//      mide DESPUÉS, comparando la distribución con el precio — jamás al revés.
//   2. TODAS LAS FAMILIAS NACEN EN SOMBRA (NFL-0028/1125). La validación walk-forward dice que el modelo
//      está a ~0.45 puntos del cierre en margen: bueno para entender el partido, NO probado para batirlo.
//      Las picks se registran en privado con su snapshot, se liquidan y se mide CLV — y solo una familia
//      que lo gane fuera de muestra podrá subir de estado. Hoy: cero picks públicas, mucho registro.
//   3. SEPTIEMBRE ARRANCA SIN MUESTRA 2026 (NFL-0032): la incertidumbre por equipo depende de sus partidos
//      jugados esta temporada, y en Week 1 el listón del noise gate es casi infranqueable A PROPÓSITO.
//   4. Los cierres/picks viven en el DISCO PERSISTENTE (mismo criterio que esports): el repo se recrea en
//      cada deploy y un histórico que se borra no es un histórico.
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('./data');
const { simulate } = require('./simulate');

const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'nfl');
const ensure = () => { try { fs.mkdirSync(DISK_DIR, { recursive: true }); } catch { } };
const rdD = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DISK_DIR, f), 'utf8')); } catch { return null; } };
const wrD = (f, o) => { try { ensure(); fs.writeFileSync(path.join(DISK_DIR, f), JSON.stringify(o)); return true; } catch { return false; } };

const G = global._nfl = global._nfl || { odds: null, sb: {}, wx: {}, model: null };
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);

const DOCTRINE = 'todas las familias de NFL están EN SOMBRA: el modelo (walk-forward 2017-2025) queda a ~0.45 puntos del cierre en margen — excelente para entender el partido, no probado para batir al mercado. Se registra todo en privado, se mide CLV por familia, y solo la evidencia fuera de muestra puede subir una familia de estado (blueprint NFL-1125). El ganador (moneyline) además está cerrado por doctrina de la casa.';

// ── 1) MODELO DEL PARTIDO (market-blind) ─────────────────────────────────────────────────────────────────
function modelSnapshot() {
  const data = D.load();
  if (!data.available || !data.priors) return null;
  if (G.model && Date.now() - G.model.at < 10 * 60e3) return G.model;
  const R = D.ratings(data);
  const E = D.epaStates(data);
  const mu = D.leagueMeans(E);
  // base de anotación móvil: los últimos 200 partidos terminados
  const done = data.games.filter((g) => g.total != null);
  const base = done.slice(-200).reduce((s, g) => s + g.total, 0) / Math.max(1, Math.min(200, done.length));
  G.model = { at: Date.now(), data, R, E, mu, base };
  return G.model;
}

function gameModel(g, M) {
  const home = D.CUR(g.home), away = D.CUR(g.away);
  const rh = M.R.teams[home], ra = M.R.teams[away];
  const H = M.E.teams[home], A = M.E.teams[away];
  if (!rh || !ra) return null;
  const neutral = g.location === 'Neutral';
  const muMargin = rh.pts - ra.pts + (neutral ? 0 : M.data.priors.hfa);
  const pr = (t) => (t && t.pass_rate != null ? t.pass_rate : 0.58);
  const offT = (t) => t && t.pass_off != null ? (t.pass_off - M.mu.pass_off) * pr(t) + (t.rush_off - M.mu.rush_off) * (1 - pr(t)) : 0;
  const defT = (t) => t && t.pass_def != null ? (t.pass_def - M.mu.pass_def) * 0.58 + (t.rush_def - M.mu.rush_def) * 0.42 : 0;
  const x = offT(H) + offT(A) + defT(H) + defT(A);
  const muTotal = M.base + M.data.priors.k_total * x;
  // INCERTIDUMBRE EPISTÉMICA en puntos: sin partidos de la temporada DEL PARTIDO el rating es un prior
  // encogido y se dice. 4.2 pts con 0 partidos → ~1.5 con 8+. Ojo: si el partido es de una temporada que
  // aún no empieza (Week 1), la muestra es CERO aunque el rating traiga 17 partidos del año pasado.
  const gc = (M.R.season != null && g.season > M.R.season) ? 0 : Math.min(rh.games_cur, ra.games_cur);
  const uncPts = +(4.2 / Math.sqrt(1 + gc)).toFixed(2);
  // semilla determinista por partido + versión (NFL-0479)
  let seed = 7; for (const ch of String(g.id)) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const sim = simulate({ muMargin, muTotal, priors: M.data.priors, n: 20000, seed });
  return { home, away, neutral, muMargin: r2(muMargin), muTotal: r2(muTotal),
    rating: { home: rh, away: ra }, unc_pts: uncPts, games_cur: gc, sim,
    model_version: M.data.priors.model_version };
}

// ── 2) CASAS: The Odds API (una llamada cubre la liga entera; memo fuerte y contador de créditos) ────────
const ODDS_TTL = 30 * 60e3;
const NAME2ABBR = (() => {
  const m = {};
  for (const [abbr, [name]] of Object.entries(D.TEAMS)) m[name.toLowerCase()] = D.CUR(abbr);
  return m;
})();
async function refreshOdds({ force = false } = {}) {
  const key = process.env.SPORTSBOOK_PROVIDER_API_KEY || '';
  if (!key) return null;
  if (G.odds && !force && Date.now() - G.odds.at < ODDS_TTL) return G.odds;
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?apiKey=${key}&regions=eu,us&markets=h2h,spreads,totals&oddsFormat=decimal`,
      { signal: AbortSignal.timeout(20000) });
    // el contador global de créditos del server, si está: el gasto de NFL no puede ser invisible
    try { if (global._oddsCredits) { const v = Number(r.headers.get('x-requests-remaining')); if (Number.isFinite(v)) { global._oddsCredits.remaining = v; global._oddsCredits.at = Date.now(); } } } catch { }
    const j = await r.json();
    if (!Array.isArray(j)) return G.odds;
    G.odds = { at: Date.now(), rows: j };
    snapshotCloses(j);
    return G.odds;
  } catch { return G.odds; }
}

// mercados de UN partido, fundidos por casa y con consenso sin vig
function marketFor(g, odds) {
  if (!odds || !odds.rows) return null;
  const home = D.teamName(g.home), away = D.teamName(g.away);
  const ev = odds.rows.find((e) => e.home_team === home && e.away_team === away);
  if (!ev) return null;
  const out = { event_id: ev.id, commence: ev.commence_time, books: [], spread: {}, total: {}, ml: {} };
  for (const bk of ev.bookmakers || []) {
    const row = { book: bk.key, at: bk.last_update };
    for (const mk of bk.markets || []) {
      if (mk.key === 'h2h') {
        const h = (mk.outcomes || []).find((o) => o.name === home), a = (mk.outcomes || []).find((o) => o.name === away);
        if (h && a) { row.ml = { home: h.price, away: a.price }; (out.ml[bk.key] = row.ml); }
      }
      if (mk.key === 'spreads') {
        const h = (mk.outcomes || []).find((o) => o.name === home), a = (mk.outcomes || []).find((o) => o.name === away);
        if (h && a && h.point != null) { row.spread = { line: -h.point, home: h.price, away: a.price }; out.spread[bk.key] = row.spread; }
        // convención interna: línea POSITIVA = local favorito (la de games.csv); Odds API da el point del local con signo contrario
      }
      if (mk.key === 'totals') {
        const o = (mk.outcomes || []).find((x) => x.name === 'Over'), u = (mk.outcomes || []).find((x) => x.name === 'Under');
        if (o && u && o.point != null) { row.total = { line: o.point, over: o.price, under: u.price }; out.total[bk.key] = row.total; }
      }
    }
    out.books.push(row);
  }
  // consenso: mediana de líneas + probabilidad sin vig (proporcional a 2 vías) de la mediana de precios
  const med = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[(a.length - 1) >> 1] : null; };
  const novig2 = (pa, pb) => { const ia = 1 / pa, ib = 1 / pb; return ia / (ia + ib); };
  const sp = Object.values(out.spread), tt = Object.values(out.total), mls = Object.values(out.ml);
  out.consensus = {
    spread_line: med(sp.map((x) => x.line)),
    total_line: med(tt.map((x) => x.line)),
    ml_p_home: mls.length ? r3(novig2(med(mls.map((x) => x.home)), med(mls.map((x) => x.away)))) : null,
    books: out.books.length,
  };
  // mejor precio por lado (para medir edge contra lo EJECUTABLE, NFL-0613)
  const best = (rows, side) => rows.reduce((b, x) => (!b || (x[side] || 0) > (b[side] || 0) ? x : b), null);
  out.best = {
    spread_home: best(sp.map((x, i) => ({ ...x, book: Object.keys(out.spread)[i] })), 'home'),
    spread_away: best(sp.map((x, i) => ({ ...x, book: Object.keys(out.spread)[i] })), 'away'),
    total_over: best(tt.map((x, i) => ({ ...x, book: Object.keys(out.total)[i] })), 'over'),
    total_under: best(tt.map((x, i) => ({ ...x, book: Object.keys(out.total)[i] })), 'under'),
  };
  return out;
}

// ── 3) CIERRES: cada refresh sobreescribe el snapshot del partido; el último antes del kickoff ES el
// cierre (misma mecánica medida en esports; ventana amplia porque las pasadas son cada 30 min) ────────────
function snapshotCloses(rows) {
  const st = rdD('closes.json') || { closes: {} };
  const now = Date.now();
  for (const ev of rows) {
    const t = Date.parse(ev.commence_time || 0);
    if (!(t > now - 3600e3)) continue;                      // ya empezó hace más de 1h: el cierre ya quedó
    const med = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[(a.length - 1) >> 1] : null; };
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
  wrD('closes.json', st);
}

// ── 4) CLIMA: open-meteo (sin llave) para venues al aire libre a ≤8 días (NFL-0392+, Weather Lens) ───────
async function weatherFor(g) {
  const data = D.load();
  const v = data.venues[g.stadium_id];
  const kickoff = Date.parse(g.date + 'T' + (g.time || '17:00') + ':00Z');
  if (!v || !(kickoff > Date.now() - 4 * 3600e3) || kickoff - Date.now() > 8 * 864e5) return null;
  if (v.roof === 'dome' || v.roof === 'closed') return { roof: v.roof, note: 'techo cerrado: el clima no juega.' };
  const key = g.stadium_id + ':' + g.date;
  const c = G.wx[key];
  if (c && Date.now() - c.at < 3 * 3600e3) return c.data;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${v.lat}&longitude=${v.lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m&timezone=UTC&forecast_days=8`,
      { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const hrs = (j.hourly && j.hourly.time) || [];
    const target = new Date(kickoff).toISOString().slice(0, 13);
    let i = hrs.findIndex((h) => h.startsWith(target));
    if (i < 0) i = hrs.length - 1;
    const out = {
      roof: v.roof, at: new Date().toISOString(), valid: hrs[i] || null,
      temp_c: j.hourly.temperature_2m[i], precip_p: j.hourly.precipitation_probability[i],
      wind_kmh: j.hourly.wind_speed_10m[i], gust_kmh: j.hourly.wind_gusts_10m[i],
      horizon_h: Math.round((kickoff - Date.now()) / 3600e3),
      note: 'pronóstico open-meteo para la hora del kickoff; la incertidumbre cae conforme se acerca (NFL-0399). El clima se ENSEÑA, no mueve el modelo: "lluvia = under" no es un modelo (§15).',
    };
    G.wx[key] = { at: Date.now(), data: out };
    return out;
  } catch { return null; }
}

// ── 5) AGENDA / COMMAND CENTER ───────────────────────────────────────────────────────────────────────────
function upcoming(data, { days = 12 } = {}) {
  const now = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  const to = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  return data.games.filter((g) => g.season === data.currentSeason && g.date >= now && g.date <= to);
}
async function slate({ days = 12 } = {}) {
  const M = modelSnapshot();
  if (!M) return { available: false, why: 'los agregados de NFL no están cargados.' };
  const odds = await refreshOdds().catch(() => null);
  const rows = upcoming(M.data, { days });
  const out = [];
  for (const g of rows) {
    const model = gameModel(g, M);
    const mk = marketFor(g, odds);
    const gpSpread = model ? -model.muMargin : null;        // en formato de línea del local (negativa = favorito)... no: mantenemos margen
    out.push({
      id: g.id, espn: g.espn, week: g.week, date: g.date, time: g.time,
      home: { abbr: D.CUR(g.home), name: D.teamName(g.home), logo: D.teamLogo(g.home) },
      away: { abbr: D.CUR(g.away), name: D.teamName(g.away), logo: D.teamLogo(g.away) },
      neutral: g.location === 'Neutral', stadium: g.stadium, roof: g.roof,
      model: model ? { p_home: model.sim.p_home, mu_margin: model.muMargin, mu_total: model.muTotal, unc_pts: model.unc_pts } : null,
      market: mk ? { spread: mk.consensus.spread_line, total: mk.consensus.total_line, p_home: mk.consensus.ml_p_home, books: mk.consensus.books } : null,
      // los DELTAS GP vs mercado — la fila del Command Center (NFL-0822)
      delta: (model && mk && mk.consensus.spread_line != null)
        ? { spread: r2(model.muMargin - mk.consensus.spread_line), total: mk.consensus.total_line != null ? r2(model.muTotal - mk.consensus.total_line) : null }
        : null,
    });
  }
  out.sort((a, b) => String(a.date + (a.time || '')).localeCompare(String(b.date + (b.time || ''))));
  return {
    available: true, season: M.data.currentSeason, days,
    week: out.length ? out[0].week : null,
    games: out, books: odds ? [...new Set(odds.rows.flatMap((e) => (e.bookmakers || []).map((b) => b.key)))].length : 0,
    odds_at: odds ? new Date(odds.at).toISOString() : null,
    regime_note: out.length && out[0].week <= 4 ? 'primeras semanas: el rating es en gran parte el prior de 2025 encogido y la incertidumbre por equipo lo dice — el sistema prefiere NO PICK a fingir certeza (NFL-0032).' : null,
    doctrine: DOCTRINE, at: new Date().toISOString(),
  };
}

// ── 6) GAME INTELLIGENCE TERMINAL (§30): de la probabilidad al mecanismo, al mercado y a la decisión ────
async function gameIntel(id) {
  const M = modelSnapshot();
  if (!M) return null;
  const g = M.data.games.find((x) => x.id === id || String(x.espn) === String(id));
  if (!g) return null;
  const model = gameModel(g, M);
  const odds = await refreshOdds().catch(() => null);
  const mk = marketFor(g, odds);
  const wx = await weatherFor(g).catch(() => null);
  const home = D.CUR(g.home), away = D.CUR(g.away);
  const H = M.E.teams[home] || {}, A = M.E.teams[away] || {};
  // ADN de equipo: cada dimensión contra la media de liga (diverging bars, NFL-0130/0914)
  const dna = (t) => ({
    pass_off: t.pass_off != null ? r3(t.pass_off - M.mu.pass_off) : null,
    rush_off: t.rush_off != null ? r3(t.rush_off - M.mu.rush_off) : null,
    pass_def: t.pass_def != null ? r3(M.mu.pass_def - t.pass_def) : null,   // + = defensa mejor que la media
    rush_def: t.rush_def != null ? r3(M.mu.rush_def - t.rush_def) : null,
    pass_rate: t.pass_rate != null ? r3(t.pass_rate - M.mu.pass_rate) : null,
    plays: t.plays != null ? r2(t.plays - M.mu.plays) : null,
    expl_pass: t.expl_pass != null ? r3(t.expl_pass - M.mu.expl_pass) : null,
    cpoe: t.cpoe != null ? r2(t.cpoe - M.mu.cpoe) : null,
  });
  // forma y h2h desde la base (últimos cruces reales)
  const played = M.data.games.filter((x) => x.result != null);
  const form = (team) => played.filter((x) => D.CUR(x.home) === team || D.CUR(x.away) === team).slice(-5)
    .map((x) => {
      const isH = D.CUR(x.home) === team;
      return { date: x.date, vs: isH ? D.CUR(x.away) : D.CUR(x.home), home: isH,
        pts: isH ? x.home_score : x.away_score, opp_pts: isH ? x.away_score : x.home_score,
        w: (isH ? x.result > 0 : x.result < 0) ? 1 : 0 };
    });
  const h2h = played.filter((x) => (D.CUR(x.home) === home && D.CUR(x.away) === away) || (D.CUR(x.home) === away && D.CUR(x.away) === home))
    .slice(-6).reverse()
    .map((x) => ({ date: x.date, home: D.CUR(x.home), away: D.CUR(x.away), hs: x.home_score, as: x.away_score }));
  // LO QUE IMPORTA (NFL-0860): drivers medibles, cada uno con su número — nada de narrativa suelta
  const five = [];
  if (model) {
    const rd = model.rating.home.pts - model.rating.away.pts;
    five.push({ k: 'rating', txt: `Diferencia de rating: ${rd > 0 ? home : away} ${Math.abs(rd).toFixed(1)} pts mejor (opponent-adjusted, recency-weighted)`, val: r2(rd) });
    if (!model.neutral) five.push({ k: 'hfa', txt: `Ventaja de local ajustada de la liga: ${M.data.priors.hfa} pts`, val: M.data.priors.hfa });
    else five.push({ k: 'neutral', txt: 'Cancha neutral: sin ventaja de local', val: 0 });
    const dpo = (H.pass_off || 0) - M.mu.pass_off, dpd = M.mu.pass_def - (A.pass_def || 0);
    five.push({ k: 'pass_matchup', txt: `Pase de ${home} (${dpo >= 0 ? '+' : ''}${(dpo).toFixed(2)} EPA/db vs media) contra defensa aérea de ${away} (${dpd >= 0 ? '+' : ''}${dpd.toFixed(2)})`, val: r3(dpo + dpd) });
    if (g.rest_home != null && g.rest_away != null && g.rest_home !== g.rest_away)
      five.push({ k: 'rest', txt: `Descanso: ${home} ${g.rest_home}d vs ${away} ${g.rest_away}d`, val: g.rest_home - g.rest_away });
    five.push({ k: 'sample', txt: model.games_cur === 0 ? 'Cero partidos 2026: el rating es el prior 2025 encogido — incertidumbre máxima' : `${model.games_cur} partidos 2026 del equipo con menos muestra`, val: model.unc_pts });
  }
  const edges = model && mk ? evaluateEdges(g, model, mk) : { candidates: [], verdict_note: 'sin mercado abierto todavía.' };
  return {
    id: g.id, espn: g.espn, week: g.week, season: g.season, date: g.date, time: g.time,
    home: { abbr: home, name: D.teamName(g.home), logo: D.teamLogo(g.home), qb: g.qb_home, coach: g.coach_home, rest: g.rest_home },
    away: { abbr: away, name: D.teamName(g.away), logo: D.teamLogo(g.away), qb: g.qb_away, coach: g.coach_away, rest: g.rest_away },
    neutral: g.location === 'Neutral', stadium: g.stadium, roof: g.roof, surface: g.surface, referee: g.referee || null,
    venue: M.data.venues[g.stadium_id] || null,
    final: g.result != null ? { home: g.home_score, away: g.away_score, ot: g.ot } : null,
    model: model ? {
      p_home: model.sim.p_home, mu_margin: model.muMargin, mu_total: model.muTotal,
      fair_spread: r2(-model.muMargin), fair_total: model.muTotal,
      team_home_mu: model.sim.team_home_mu, team_away_mu: model.sim.team_away_mu,
      margin_q: model.sim.margin, total_q: model.sim.total,
      margin_hist: model.sim.margin_hist, total_hist: model.sim.total_hist,
      key_mass: model.sim.key_mass, unc_pts: model.unc_pts, games_cur: model.games_cur,
      rating: model.rating, seed: model.sim.seed, model_version: model.model_version,
      // ESCALERAS DE LÍNEAS ALTERNATIVAS (NFL-0464): toda la CDF al servicio de la UI interactiva — el
      // usuario mueve la línea y ve la probabilidad real de cubrir/pasar, con su push. Paso 0.5.
      spread_ladder: (() => {
        const c = Math.round(model.muMargin * 2) / 2;
        const out = [];
        for (let l = c - 9; l <= c + 9; l += 0.5) {
          const cv = model.sim.coverProb(l);
          out.push({ line: +l.toFixed(1), p_home: +cv.p.toFixed(4), push: cv.push });
        }
        return out;
      })(),
      total_ladder: (() => {
        const c = Math.round(model.muTotal * 2) / 2;
        const out = [];
        for (let l = c - 12; l <= c + 12; l += 0.5) {
          const ov = model.sim.overProb(l);
          out.push({ line: +l.toFixed(1), p_over: +ov.p.toFixed(4), push: ov.push });
        }
        return out;
      })(),
    } : null,
    five,
    dna: { home: dna(H), away: dna(A), note: 'EPA/jugada contra la media de liga (positivo = mejor). Proceso, no resultado (NFL-0131).' },
    form: { home: form(home), away: form(away) },
    h2h,
    weather: wx,
    market: mk,
    edges,
    provenance: [
      { source: 'Base propia GP: nflverse (games + stats_team_week), point-in-time', kind: 'derivado', at: M.data.at },
      mk ? { source: `Mercados: The Odds API (${mk.consensus.books} casas)`, kind: 'proveedor', at: odds ? new Date(odds.at).toISOString() : null } : null,
      wx && wx.at ? { source: 'Clima: open-meteo (pronóstico horario)', kind: 'proveedor', at: wx.at } : null,
    ].filter(Boolean),
    doctrine: DOCTRINE,
    at: new Date().toISOString(),
  };
}

// ── 7) EDGES + GATES (sombra): la cadena del §25 en su versión honesta de V1 ─────────────────────────────
function evaluateEdges(g, model, mk) {
  const out = [];
  const dec2p = (d) => 1 / d;
  // SPREAD: la línea de consenso, evaluada con la CDF real del simulador y el mejor precio por lado
  if (mk.consensus.spread_line != null && mk.best.spread_home && mk.best.spread_away) {
    const line = mk.consensus.spread_line;
    const cv = model.sim.coverProb(line);
    for (const side of ['home', 'away']) {
      const b = side === 'home' ? mk.best.spread_home : mk.best.spread_away;
      const pModel = side === 'home' ? cv.p : 1 - cv.p;
      const pImp = dec2p(b[side]);
      out.push(gate({ family: 'SPREAD', side, line, odds: b[side], book: b.book,
        p_model: pModel, p_implied: pImp, model, push_p: cv.push }));
    }
  }
  if (mk.consensus.total_line != null && mk.best.total_over && mk.best.total_under) {
    const line = mk.consensus.total_line;
    const ov = model.sim.overProb(line);
    for (const side of ['over', 'under']) {
      const b = side === 'over' ? mk.best.total_over : mk.best.total_under;
      const pModel = side === 'over' ? ov.p : 1 - ov.p;
      out.push(gate({ family: 'TOTAL', side, line, odds: b[side], book: b.book,
        p_model: pModel, p_implied: dec2p(b[side]), model, push_p: ov.push }));
    }
  }
  return {
    candidates: out,
    verdict_note: 'familias en SOMBRA: los veredictos se registran y se liquidan en privado; nada de esto es una pick pública (NFL-1125). El ganador (moneyline) ni se evalúa: doctrina de la casa.',
  };
}
function gate(c) {
  const edgePp = (c.p_model - c.p_implied) * 100;
  const gates = [];
  // Noise gate (NFL-0684): la ventaja debe dominar la incertidumbre epistémica. La incertidumbre en PUNTOS
  // se convierte a pp por la pendiente local de la CDF (~2.8 pp por punto alrededor del centro).
  const uncPp = c.model.unc_pts * 2.8;
  gates.push({ gate: 'noise', pass: Math.abs(edgePp) > uncPp, detail: `|${edgePp.toFixed(1)} pp| vs incertidumbre ${uncPp.toFixed(1)} pp` });
  gates.push({ gate: 'edge', pass: Math.abs(edgePp) >= 3, detail: 'listón mínimo 3 pp' });
  gates.push({ gate: 'orthogonality', pass: true, detail: 'modelo market-blind por construcción: el precio objetivo jamás es input' });
  gates.push({ gate: 'push', pass: (c.push_p || 0) < 0.06, detail: `push ${(100 * (c.push_p || 0)).toFixed(1)}%` });
  const pass = gates.every((x) => x.pass);
  return {
    family: c.family, side: c.side, line: c.line, odds: c.odds, book: c.book,
    p_model: r3(c.p_model), p_implied: r3(c.p_implied), edge_pp: r2(edgePp),
    gates, verdict: pass ? 'SHADOW_PICK' : 'NO_PICK',
    no_pick_reason: pass ? null : (gates.find((x) => !x.pass) || {}).gate,
  };
}

// ── 8) EL BUCLE DE SOMBRA: registrar, liquidar, medir (privado) ──────────────────────────────────────────
async function recordShadow() {
  const s = await slate({ days: 8 });
  if (!s.available) return { recorded: 0 };
  const M = modelSnapshot();
  const odds = await refreshOdds().catch(() => null);
  const st = rdD('picks.json') || { picks: [] };
  const have = new Set(st.picks.map((p) => p.key));
  let n = 0;
  for (const row of s.games) {
    const g = M.data.games.find((x) => x.id === row.id);
    const kickoff = Date.parse(g.date + 'T' + (g.time || '17:00') + ':00Z');
    if (!(kickoff > Date.now() && kickoff - Date.now() < 6 * 864e5)) continue;
    const model = gameModel(g, M);
    const mk = marketFor(g, odds);
    if (!model || !mk) continue;
    for (const c of evaluateEdges(g, model, mk).candidates) {
      if (c.verdict !== 'SHADOW_PICK') continue;
      const key = `${g.id}|${c.family}|${c.side}|${c.line}`;
      if (have.has(key)) continue;
      have.add(key); n++;
      st.picks.push({
        key, game_id: g.id, espn: g.espn, family: c.family, side: c.side, line: c.line,
        odds: c.odds, book: c.book, p_model: c.p_model, p_implied: c.p_implied, edge_pp: c.edge_pp,
        home: D.CUR(g.home), away: D.CUR(g.away), week: g.week, season: g.season, kickoff: new Date(kickoff).toISOString(),
        model_version: model.model_version, seed: model.sim.seed, unc_pts: model.unc_pts,
        status: 'OPEN', created_at: new Date().toISOString(), regime: 'shadow',
      });
    }
  }
  if (n) wrD('picks.json', st);
  return { recorded: n, total: st.picks.length };
}

async function settleShadow() {
  const st = rdD('picks.json') || { picks: [] };
  const open = st.picks.filter((p) => p.status === 'OPEN' && Date.parse(p.kickoff) < Date.now() - 3.2 * 3600e3);
  if (!open.length) return { settled: 0 };
  let settled = 0;
  const closes = rdD('closes.json') || { closes: {} };
  for (const p of open) {
    try {
      const day = p.kickoff.slice(0, 10).replace(/-/g, '');
      const key = 'sb:' + day;
      let sb = G.sb[key];
      if (!sb || Date.now() - sb.at > 10 * 60e3) {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}`, { signal: AbortSignal.timeout(15000) });
        sb = { at: Date.now(), j: await r.json() };
        G.sb[key] = sb;
      }
      const ev = ((sb.j && sb.j.events) || []).find((e) => String(e.id) === String(p.espn));
      if (!ev) continue;
      const comp = (ev.competitions || [])[0];
      if (!comp || !/final/i.test((ev.status && ev.status.type && ev.status.type.name) || '')) continue;
      const ch = (comp.competitors || []).find((x) => x.homeAway === 'home'), ca = (comp.competitors || []).find((x) => x.homeAway === 'away');
      const hs = +ch.score, as = +ca.score;
      const margin = hs - as, total = hs + as;
      let win = null;
      if (p.family === 'SPREAD') win = p.side === 'home' ? (margin > p.line ? 1 : margin === p.line ? null : 0) : (margin < p.line ? 1 : margin === p.line ? null : 0);
      if (p.family === 'TOTAL') win = p.side === 'over' ? (total > p.line ? 1 : total === p.line ? null : 0) : (total < p.line ? 1 : total === p.line ? null : 0);
      p.status = 'SETTLED';
      p.result = win == null ? 'PUSH' : win ? 'WIN' : 'LOSS';
      p.final = { home: hs, away: as, margin, total };
      p.units = win == null ? 0 : win ? +(p.odds - 1).toFixed(3) : -1;
      // CLV contra el cierre guardado (línea y precio de consenso)
      const cl = Object.values(closes.closes || {}).find((c) => c.home === D.teamName(p.home) && c.away === D.teamName(p.away));
      if (cl) {
        if (p.family === 'SPREAD' && cl.spread_line != null) p.close = { line: cl.spread_line, price: cl.spread_price };
        if (p.family === 'TOTAL' && cl.total_line != null) p.close = { line: cl.total_line, price: cl.total_price };
        if (p.close && p.close.price) p.clv_pct = +((p.odds / p.close.price - 1) * 100).toFixed(2);
      }
      p.settled_at = new Date().toISOString();
      settled++;
    } catch { /* siguiente pasada */ }
  }
  if (settled) wrD('picks.json', st);
  return { settled };
}

function track() {
  const st = rdD('picks.json') || { picks: [] };
  const done = st.picks.filter((p) => p.status === 'SETTLED');
  const w = done.filter((p) => p.result === 'WIN').length, l = done.filter((p) => p.result === 'LOSS').length;
  const units = done.reduce((s, p) => s + (p.units || 0), 0);
  const clv = done.filter((p) => p.clv_pct != null);
  const byFam = {};
  for (const p of done) {
    const F = byFam[p.family] = byFam[p.family] || { n: 0, w: 0, units: 0, clv: [], };
    F.n++; if (p.result === 'WIN') F.w++; F.units += p.units || 0;
    if (p.clv_pct != null) F.clv.push(p.clv_pct);
  }
  return {
    regime: 'shadow', doctrine: DOCTRINE,
    open: st.picks.filter((p) => p.status === 'OPEN').length,
    settled: done.length, w, l, push: done.length - w - l,
    units: r2(units), roi_pct: done.length ? r2(100 * units / done.length) : null,
    clv_avg_pct: clv.length ? r2(clv.reduce((s, p) => s + p.clv_pct, 0) / clv.length) : null, clv_n: clv.length,
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, F]) => [k, {
      n: F.n, hit_pct: F.n ? r2(100 * F.w / F.n) : null, units: r2(F.units),
      clv_avg_pct: F.clv.length ? r2(F.clv.reduce((a, b) => a + b, 0) / F.clv.length) : null,
    }])),
    recent: done.slice(-40).reverse(), open_list: st.picks.filter((p) => p.status === 'OPEN').slice(-30).reverse(),
    reading: done.length < 40 ? `con ${done.length} liquidadas TODO es ruido: esta pantalla existe para acumular el registro, no para leerlo todavía.` : 'la vara es el CLV por familia, no el ROI.',
  };
}

// ── 9) EQUIPOS / FICHA / MODEL CARD ──────────────────────────────────────────────────────────────────────
function teamsDirectory() {
  const M = modelSnapshot();
  if (!M) return { available: false };
  const season = M.data.currentSeason;
  const played = M.data.games.filter((g) => g.result != null && g.season === season - 0);
  const rows = Object.keys(D.TEAMS).filter((a) => !['OAK', 'SD', 'STL'].includes(a)).map((abbr) => {
    const t = D.CUR(abbr);
    const R = M.R.teams[t], E = M.E.teams[t] || {};
    let w = 0, l = 0, ti = 0;
    for (const g of played) {
      if (D.CUR(g.home) === t) { if (g.result > 0) w++; else if (g.result < 0) l++; else ti++; }
      else if (D.CUR(g.away) === t) { if (g.result < 0) w++; else if (g.result > 0) l++; else ti++; }
    }
    return { abbr: t, name: D.teamName(t), logo: D.teamLogo(t),
      rating: R ? R.pts : null,
      // si la temporada del producto aún no arranca, la muestra de ESTA temporada es cero aunque el rating
      // traiga los partidos del año pasado — decir 20 aquí sería mentir sobre lo que sabemos de 2026
      games_cur: R ? ((M.R.season != null && season > M.R.season) ? 0 : R.games_cur) : 0,
      record: `${w}-${l}${ti ? '-' + ti : ''}`,
      pass_off: E.pass_off != null ? r3(E.pass_off - M.mu.pass_off) : null,
      rush_off: E.rush_off != null ? r3(E.rush_off - M.mu.rush_off) : null,
      pass_def: E.pass_def != null ? r3(M.mu.pass_def - E.pass_def) : null,
      rush_def: E.rush_def != null ? r3(M.mu.rush_def - E.rush_def) : null,
    };
  }).sort((a, b) => (b.rating || -99) - (a.rating || -99)).map((t, i) => ({ rank: i + 1, ...t }));
  return { available: true, season, teams: rows,
    note: 'rating GP en PUNTOS (opponent-adjusted, recency-weighted, prior 2025 encogido mientras 2026 no tenga muestra) y EPA por dimensión contra la media de liga. Proceso y resultado separados (NFL-0131).',
    at: M.data.at };
}

async function teamProfile(abbr) {
  const M = modelSnapshot();
  if (!M) return { available: false };
  const t = D.CUR(String(abbr || '').toUpperCase());
  if (!D.TEAMS[t]) return { available: false, why: `no reconozco "${abbr}"` };
  const dirRow = teamsDirectory().teams.find((x) => x.abbr === t);
  const season = M.data.currentSeason;
  const sched = M.data.games.filter((g) => g.season === season && (D.CUR(g.home) === t || D.CUR(g.away) === t))
    .map((g) => ({ id: g.id, week: g.week, date: g.date, home: D.CUR(g.home) === t,
      vs: D.CUR(g.home) === t ? D.CUR(g.away) : D.CUR(g.home),
      vs_logo: D.teamLogo(D.CUR(g.home) === t ? g.away : g.home),
      final: g.result != null ? { pts: D.CUR(g.home) === t ? g.home_score : g.away_score, opp: D.CUR(g.home) === t ? g.away_score : g.home_score } : null }));
  const past = M.data.games.filter((g) => g.result != null && (D.CUR(g.home) === t || D.CUR(g.away) === t)).slice(-10).reverse()
    .map((g) => ({ date: g.date, home: D.CUR(g.home) === t, vs: D.CUR(g.home) === t ? D.CUR(g.away) : D.CUR(g.home),
      pts: D.CUR(g.home) === t ? g.home_score : g.away_score, opp_pts: D.CUR(g.home) === t ? g.away_score : g.home_score,
      w: (D.CUR(g.home) === t ? g.result > 0 : g.result < 0) ? 1 : 0 }));
  const lastG = M.data.games.filter((g) => g.result != null && (D.CUR(g.home) === t || D.CUR(g.away) === t)).slice(-1)[0];
  const E = M.E.teams[t] || {};
  return {
    available: true, team: dirRow, season,
    qb: lastG ? (D.CUR(lastG.home) === t ? lastG.qb_home : lastG.qb_away) : null,
    coach: lastG ? (D.CUR(lastG.home) === t ? lastG.coach_home : lastG.coach_away) : null,
    qb_note: 'QB/coach del ÚLTIMO partido jugado en la base — el estado 2026 real se confirma con la primera semana (sin feed licenciado de roster todavía, NFL-0069).',
    dna: { pass_off: dirRow.pass_off, rush_off: dirRow.rush_off, pass_def: dirRow.pass_def, rush_def: dirRow.rush_def,
      pass_rate: E.pass_rate != null ? r3(E.pass_rate - M.mu.pass_rate) : null,
      plays: E.plays != null ? r2(E.plays - M.mu.plays) : null,
      expl_pass: E.expl_pass != null ? r3(E.expl_pass - M.mu.expl_pass) : null,
      cpoe: E.cpoe != null ? r2(E.cpoe - M.mu.cpoe) : null },
    schedule: sched, recent: past,
    at: M.data.at,
  };
}

function modelCard() {
  const M = modelSnapshot();
  const p = M && M.data.priors;
  return {
    available: !!p,
    model_version: p ? p.model_version : null,
    spec: p ? p.spec : null,
    constants: p ? { hfa: p.hfa, k_total: p.k_total, sigma_extra_margin: p.sigma_extra_margin, sigma_extra_total: p.sigma_extra_total, resid_pool_n: (p.resid_pool || []).length } : null,
    validation: p ? p.validation : null,
    data: M ? { games: M.data.games.length, from: 2016, team_weeks: M.data.tw.length, at: M.data.at } : null,
    families: [
      { family: 'SPREAD', state: 'shadow', why: 'MAE 10.31 vs 9.86 del cierre: bueno, no probado superior. Acumula registro privado + CLV.' },
      { family: 'TOTAL', state: 'shadow', why: 'MAE 10.80 vs 10.51 del cierre: ídem.' },
      { family: 'MONEYLINE', state: 'closed', why: 'cerrado por doctrina de la casa (pérdidas medidas en dos deportes) y Brier 0.224 vs 0.210 del cierre.' },
      { family: 'PROPS', state: 'research', why: 'la matriz del blueprint las prioriza (recepciones/carreras), pero exigen el motor de oportunidad (V1.2) que aún no existe. No se finge.' },
    ],
    doctrine: DOCTRINE,
  };
}

// ── 10) JUGADORES (v2): directorio por posición con las dos últimas temporadas ───────────────────────────
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
function playersDirectory({ q = '', pos = 'all', limit = 80 } = {}) {
  const M = modelSnapshot();
  if (!M) return { available: false };
  const all = Object.values(M.data.players || {});
  if (!all.length) return { available: false, why: 'el directorio de jugadores no está derivado (corre nfl-harvest).' };
  const needle = norm(q);
  const GROUPS = { qb: ['QB'], rb: ['RB', 'FB'], wr: ['WR'], te: ['TE'] };
  const seasons = [...new Set(all.flatMap((p) => Object.keys(p.seasons)))].map(Number).sort((a, b) => b - a);
  const last = seasons[0];
  const rows = all
    .filter((p) => pos === 'all' || (GROUPS[pos] || []).includes(p.pos))
    .filter((p) => !needle || norm(p.name).indexOf(needle) >= 0 || norm(D.teamName(p.team)).indexOf(needle) >= 0 || norm(p.team).indexOf(needle) >= 0)
    .map((p) => {
      const s = p.seasons[last] || p.seasons[seasons[1]] || {};
      const yr = p.seasons[last] ? last : seasons[1];
      return {
        id: p.id, name: p.name, pos: p.pos, team: D.CUR(p.team || ''), team_name: D.teamName(p.team || ''),
        team_logo: D.teamLogo(p.team || ''), headshot: p.headshot,
        season: yr, g: s.g || 0,
        // por posición, lo que importa (por partido)
        pass: s.att >= 40 ? { att: +(s.att / s.g).toFixed(1), yds: +(s.pyds / s.g).toFixed(1), td: s.ptd, int: s.ints,
          cmp_pct: s.att ? +(100 * s.cmp / s.att).toFixed(1) : null, epa_db: (s.att + s.sacks) ? +(s.pepa / (s.att + s.sacks)).toFixed(3) : null } : null,
        rush: s.car >= 25 ? { car: +(s.car / s.g).toFixed(1), yds: +(s.ryds / s.g).toFixed(1), td: s.rtd,
          ypc: s.car ? +(s.ryds / s.car).toFixed(2) : null } : null,
        recv: s.tgt >= 20 ? { tgt: +(s.tgt / s.g).toFixed(1), rec: +(s.rec / s.g).toFixed(1), yds: +(s.recyds / s.g).toFixed(1),
          td: s.rectd, catch_pct: s.tgt ? +(100 * s.rec / s.tgt).toFixed(1) : null } : null,
        vol: (s.att || 0) * 2 + (s.car || 0) + (s.tgt || 0),
      };
    })
    .sort((a, b) => b.vol - a.vol)
    .slice(0, Math.max(1, Math.min(200, limit)));
  return { available: true, players: rows, total: all.length, season: last,
    note: 'totales y por-partido de la última temporada jugada (nflverse). El equipo/posición es el último visto: el roster 2026 real se confirma con la Semana 1. Las distribuciones de props por jugador llegan con el motor de oportunidad (V1.2 del blueprint) — hasta entonces esto es un directorio, no un modelo.',
    at: M.data.at };
}

// ── 11) BUSCADOR (v2): equipos + partidos + jugadores, SOLO NFL ──────────────────────────────────────────
function search(q) {
  const M = modelSnapshot();
  if (!M) return { teams: [], games: [], players: [] };
  const needle = norm(q);
  if (needle.length < 2) return { teams: [], games: [], players: [] };
  const teams = Object.keys(D.TEAMS).filter((a) => !['OAK', 'SD', 'STL'].includes(a))
    .filter((a) => norm(D.teamName(a)).indexOf(needle) >= 0 || norm(a).indexOf(needle) >= 0)
    .slice(0, 5).map((a) => ({ abbr: D.CUR(a), name: D.teamName(a), logo: D.teamLogo(a) }));
  const season = M.data.currentSeason;
  const games = M.data.games
    .filter((g) => g.season === season && (norm(D.teamName(g.home)).indexOf(needle) >= 0 || norm(D.teamName(g.away)).indexOf(needle) >= 0))
    .slice(0, 6).map((g) => ({ id: g.id, week: g.week, date: g.date, home: D.CUR(g.home), away: D.CUR(g.away),
      final: g.result != null ? { hs: g.home_score, as: g.away_score } : null }));
  const players = Object.values(M.data.players || {})
    .filter((p) => norm(p.name).indexOf(needle) >= 0)
    .sort((a, b) => { const v = (x) => Object.values(x.seasons).reduce((s, y) => s + (y.att || 0) * 2 + (y.car || 0) + (y.tgt || 0), 0); return v(b) - v(a); })
    .slice(0, 6).map((p) => ({ id: p.id, name: p.name, pos: p.pos, team: D.CUR(p.team || ''), headshot: p.headshot }));
  return { teams, games, players };
}

// ── 12) LESIONES (v2, mejor esfuerzo): ESPN core API, cacheado 6 h, SIEMPRE etiquetado ───────────────────
// El blueprint exige feed licenciado para producción (NFL-0069); esto es el Tier 0 honesto: lo que ESPN
// publica, con su fecha, marcado "mejor esfuerzo" — jamás se presenta como oficial (NFL-0080).
const ESPN_TEAM_IDS = { ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5, DAL: 6, DEN: 7,
  DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, KC: 12, LA: 14, LAC: 24, LV: 13, MIA: 15, MIN: 16, NE: 17,
  NO: 18, NYG: 19, NYJ: 20, PHI: 21, PIT: 23, SEA: 26, SF: 25, TB: 27, TEN: 10, WAS: 28 };
async function injuriesFor(abbr) {
  const t = D.CUR(abbr);
  const espnId = ESPN_TEAM_IDS[t];
  if (!espnId) return null;
  G.inj = G.inj || {};
  const c = G.inj[t];
  if (c && Date.now() - c.at < 6 * 3600e3) return c.data;
  try {
    const r = await fetch(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams/${espnId}/injuries?limit=12`, { signal: AbortSignal.timeout(12000) });
    const j = await r.json();
    const items = [];
    for (const it of (j.items || []).slice(0, 8)) {
      try {
        const d = await fetch(String(it.$ref).replace('http://', 'https://'), { signal: AbortSignal.timeout(8000) }).then((x) => x.json());
        const ath = d.athlete && d.athlete.$ref
          ? await fetch(String(d.athlete.$ref).replace('http://', 'https://'), { signal: AbortSignal.timeout(8000) }).then((x) => x.json()).catch(() => null)
          : null;
        items.push({
          player: ath ? ath.displayName : null, pos: ath && ath.position ? ath.position.abbreviation : null,
          status: d.status || null, date: d.date || null,
          detail: d.longComment || d.shortComment || (d.details && d.details.type && d.details.type.description) || null,
        });
      } catch { /* siguiente */ }
    }
    const data = { team: t, items: items.filter((x) => x.player), at: new Date().toISOString(),
      note: 'reporte de ESPN, mejor esfuerzo — NO es el injury report oficial de la liga y puede venir tarde. Se enseña con su fecha; la decisión del motor no lo consume todavía (eso exige feed licenciado y point-in-time, NFL-0069/0378).' };
    G.inj[t] = { at: Date.now(), data };
    return data;
  } catch { return c ? c.data : null; }
}

module.exports = {
  slate, gameIntel, teamsDirectory, teamProfile, modelCard, track,
  recordShadow, settleShadow, refreshOdds, modelSnapshot, weatherFor, DOCTRINE, DISK_DIR,
  playersDirectory, search, injuriesFor,
};
