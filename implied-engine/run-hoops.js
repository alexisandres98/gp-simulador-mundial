// implied-engine/run-hoops.js — EL PROCESO IMPLÍCITO DE BALONCESTO, CABLEADO A LAS CUOTAS REALES (9-sep)
//
// Usa el mismo loader y agrupador que las picks de baloncesto (`basketball-engine/markets`): por casa y
// partido se toma el hándicap principal (la línea más cotizada del tablero, y de esa casa el precio de las dos
// patas), el ganador y el total principal, y se pasa por `hoops.analyzeGame`. La σ de referencia NO es la de
// la liga por decreto: es la mediana de las σ implícitas del tablero en la pasada (con memoria), para que un
// desajuste de forma no se lea como señal en todos los partidos a la vez.
'use strict';

const H = require('./hoops');
const S = require('./sombra');

const SPORT = 'hoops';
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);

const leagueOf = (key) => { const k = String(key || '').toLowerCase(); return /wnba/.test(k) ? 'wnba' : /wncaab/.test(k) ? 'ncaab' : /ncaab/.test(k) ? 'ncaab' : /nba/.test(k) ? 'nba' : /euro/.test(k) ? 'euroleague' : 'default'; };

// mkts (de MK.groupMarkets) → por ceid → por casa → { spread, ml, total }
function booksFrom(mkts) {
  const byEv = new Map();
  const mainLine = {};   // línea más cotizada por (ceid, fam) del tablero
  for (const m of mkts) {
    if (m.fam === 'match_winner') continue;
    const k = m.ceid + '|' + m.fam; const n = Math.min(m.q[m.sides[0]].length, m.q[m.sides[1]].length);
    if (!mainLine[k] || n > mainLine[k].n) mainLine[k] = { line: m.line, n };
  }
  for (const m of mkts) {
    const ev = byEv.get(m.ceid) || new Map(); byEv.set(m.ceid, ev);
    const isMain = m.fam === 'match_winner' || (mainLine[m.ceid + '|' + m.fam] && Math.abs(mainLine[m.ceid + '|' + m.fam].line - m.line) < 0.01);
    if (!isMain) continue;
    const a = m.q[m.sides[0]], b = m.q[m.sides[1]];
    for (const qa of a) {
      const qb = b.find((x) => x.book === qa.book); if (!qb) continue;
      const bk = ev.get(qa.book) || { code: qa.book }; ev.set(qa.book, bk);
      if (m.fam === 'match_winner') bk.ml = { home: qa.o, away: qb.o };
      else if (m.fam === 'spread') bk.spread = { line: m.line, home: qa.o, away: qb.o };
      else bk.total = { line: m.line, over: qa.o, under: qb.o };
    }
  }
  const out = new Map();
  for (const [ceid, ev] of byEv) { const books = [...ev.values()].filter((b) => b.spread || b.ml || b.total); if (books.length) out.set(ceid, books); }
  return out;
}

async function run({ dbc, evs = {}, MK, ahora = Date.now() } = {}) {
  const out = { sport: SPORT, eventos: 0, con_casas: 0, tesis_evaluadas: 0 };
  if (!dbc || !MK) return { ...out, why: 'sin base de cuotas' };
  const ceids = Object.keys(evs).filter((id) => { const k = Date.parse((evs[id] || {}).kickoff || 0); return Number.isFinite(k) && k > ahora; });
  out.eventos = ceids.length;
  if (!ceids.length) return { ...out, why: 'sin partidos futuros con cuotas' };
  const rows = await MK.loadQuotes(dbc, ceids, { minutes: 90 }).catch(() => []);
  const books = booksFrom(MK.groupMarkets(rows));
  out.con_casas = books.size;

  // 1) σ implícita cruda del tablero
  const sig = [];
  for (const [ceid, bks] of books) {
    const g = H.analyzeGame(bks, { league: leagueOf((evs[ceid] || {}).league) });
    for (const b of g.books) if (b.implied && Number.isFinite(b.implied.sigma) && b.implied.sigma > 4 && b.implied.sigma < 30) sig.push(b.implied.sigma);
  }
  const st = S.rd(SPORT);
  const base = S.updateBaseline(st, 'sigma_implied', sig);
  S.wr(SPORT, st);
  out.baseline = { sigma_implied: r4(base.value), n_obs: base.n_obs, fresh: base.fresh };

  // 2) tesis con la σ del tablero (o la de liga si aún no hay base)
  const theses = [];
  for (const [ceid, bks] of books) {
    const meta = evs[ceid] || {};
    const lg = leagueOf(meta.league);
    const g = H.analyzeGame(bks, { league: lg, sigma: base.value || undefined });
    const common = { ceid, league: meta.league || null, match: `${meta.home} vs ${meta.away}`, home: meta.home, away: meta.away, kickoff_at: meta.kickoff || null };
    // las tesis de incoherencia interna solo nacen con la σ del TABLERO ya estimada: con la σ de liga por decreto
    // un desajuste de forma sesgaría todas a la vez (la desviación frente al tablero, BOOK_DEV, no depende de σ)
    for (const b of (base.value != null ? g.books : [])) for (const t of b.theses) {
      if (!(t.odds > 1)) continue;
      theses.push({ ...common, key: `${ceid}|${t.family}|${b.code}|${t.side}|${t.line}`, book: b.code, family: t.family, side: t.side, line: t.line, odds: t.odds,
        p_coherent: t.p_coherent, p_market: t.p_market, edge_pp: t.edge_pp, basis: t.basis, n_books: g.consensus.n_books,
        meta: { sigma_used: b.sigma_league, sigma_implied: b.implied && b.implied.sigma, mu_spread: b.spread && b.spread.mu, mu_ml: b.ml && b.ml.mu, spread_line: b.spread && b.spread.line } });
    }
    for (const d of g.deviations) {
      if (!(d.odds > 1)) continue;
      theses.push({ ...common, key: `${ceid}|${d.family}|${d.code}|${d.side}|${d.line}`, book: d.code, family: d.family, side: d.side, line: d.line, odds: d.odds,
        p_coherent: d.p_coherent, p_market: d.p_market, edge_pp: d.edge_pp, basis: d.basis, n_books: d.n_books, meta: { consensus_mu: g.consensus.mu, consensus_total: g.consensus.total } });
    }
  }
  out.tesis_evaluadas = theses.length;
  out.record = S.record(SPORT, theses, { baseline: base.value, ahora });
  return out;
}

// ── CIERRES ─────────────────────────────────────────────────────────────────────────────────────────────
// Un solo lote de cuotas para todas las tesis vivas cercanas (no una consulta por tesis).
async function closesOnly({ dbc, MK, ahora = Date.now() } = {}) {
  if (!dbc || !MK) return { skipped: 'db_off' };
  const st = S.rd(SPORT);
  const vivas = Object.values(st.picks || {}).filter((p) => p.status === 'ACTIVE' && p.kickoff_at && (Date.parse(p.kickoff_at) - ahora) / 60000 <= 95 && (Date.parse(p.kickoff_at) - ahora) / 60000 > -3);
  if (!vivas.length) return { candidatas: 0 };
  const ceids = [...new Set(vivas.map((p) => p.ceid))];
  const rows = await MK.loadQuotes(dbc, ceids, { minutes: 30 }).catch(() => []);
  const mkts = MK.groupMarkets(rows);
  const quoteFor = async (p) => {
    const fam = /ML$/.test(p.family) ? 'match_winner' : /SPREAD$/.test(p.family) ? 'spread' : 'match_total';
    // la línea de la tesis está en convención del LOCAL para el hándicap (side away → línea espejo)
    const line = fam === 'spread' ? (p.side === 'home' ? p.line : -p.line) : p.line;
    const m = mkts.find((x) => x.ceid === p.ceid && x.fam === fam && (fam === 'match_winner' || Math.abs(x.line - line) < 0.01));
    if (!m) return null;
    const q = m.q[p.side] || [];
    if (!q.length) return null;
    const own = q.find((x) => x.book === p.book), pin = q.find((x) => x.book === 'pinnacle');
    const newest = q.reduce((mx, x) => (String(x.seen) > String(mx) ? x.seen : mx), '');
    return { own: own ? own.o : null, best: q.reduce((mx, x) => (x.o > mx ? x.o : mx), 0) || null, pinnacle: pin ? pin.o : null, age_min: newest ? Math.round((ahora - Date.parse(newest)) / 60000) : null };
  };
  return S.closes(SPORT, quoteFor, { ahora });
}

// ── LIQUIDACIÓN: scoreFor(p) → { home, away } puntos finales ────────────────────────────────────────────
function verdictFactory(scoreFor) {
  return (p) => {
    const sc = scoreFor ? scoreFor(p) : null;
    if (!sc || sc.home == null || sc.away == null) return null;
    const margin = +sc.home - +sc.away, total = +sc.home + +sc.away;
    if (/ML$/.test(p.family)) { if (margin === 0) return 'PUSH'; return (margin > 0) === (p.side === 'home') ? 'WIN' : 'LOSS'; }
    if (/SPREAD$/.test(p.family)) {
      // p.line ya viene desde el punto de vista del lado apostado: cubre si margen_lado + línea > 0
      const d = (p.side === 'home' ? margin : -margin) + +p.line;
      if (Math.abs(d) < 1e-9) return 'PUSH';
      return d > 0 ? 'WIN' : 'LOSS';
    }
    const d = total - +p.line;
    if (Math.abs(d) < 1e-9) return 'PUSH';
    return (d > 0) === (p.side === 'over') ? 'WIN' : 'LOSS';
  };
}

async function job({ dbc, evs, MK, scoreFor, ahora = Date.now() } = {}) {
  const out = {};
  out.run = await run({ dbc, evs, MK, ahora }).catch((e) => ({ error: e.message }));
  out.closes = await closesOnly({ dbc, MK, ahora }).catch((e) => ({ error: e.message }));
  out.settle = S.settle(SPORT, verdictFactory(scoreFor), { ahora });
  return out;
}
const track = () => S.track(SPORT);

module.exports = { SPORT, run, job, closesOnly, track, booksFrom, verdictFactory, leagueOf };
