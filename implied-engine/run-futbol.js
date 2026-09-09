// implied-engine/run-futbol.js — EL PROCESO IMPLÍCITO DE FÚTBOL, CABLEADO A LAS CUOTAS REALES (9-sep)
//
// Lee de `sportsbook_goal_quote_current` el 1X2 (`match_winner`, lado home/draw/away) y los totales
// (`match_total`, línea + over/under) de cada casa para los partidos de clubes con saque en las próximas 48 h,
// los pasa por `football.analyzeMatch` y anota en la sombra las tesis que pasan la regla. Solo prepartido.
// `deps` inyecta lo que solo el servidor sabe (la conexión, el mapa de eventos, el marcador final) para que
// este módulo se pueda probar suelto, igual que `futbol-derivadas.js`.
'use strict';

const F = require('./football');
const S = require('./sombra');

const SPORT = 'futbol';
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const isHalf = (L) => Number.isFinite(L) && Math.abs(L * 2 - Math.round(L * 2)) < 1e-9 && Math.abs(L - Math.round(L)) > 1e-9;

// anula las tesis de total nacidas con línea entera o de cuarto antes de la regla de medias líneas (idempotente)
function voidNonHalf(ahora = Date.now()) {
  const st = S.rd(SPORT); let n = 0;
  for (const p of Object.values(st.picks || {})) {
    if (p.status !== 'ACTIVE' || p.family === 'IMPLIED_1X2' || isHalf(p.line)) continue;
    p.status = 'VOID'; p.result = 'VOID'; p.void_why = 'línea no .5: v1 solo mide medias líneas'; p.settled_at = new Date(ahora).toISOString(); n++;
  }
  if (n) S.wr(SPORT, st);
  return n;
}

async function loadBooks(dbc, ids) {
  const q = await dbc.query(
    `SELECT canonical_event_id ceid, lower(sportsbook_code) book, market_family fam, line::float line, lower(side) side,
            max(odds_decimal)::float o, max(observed_at) seen
       FROM sportsbook_goal_quote_current
      WHERE canonical_event_id = ANY($1) AND market_family IN ('match_winner','match_total')
        AND coalesce(quote_status,'open') = 'open' AND is_live = FALSE AND observed_at > now() - interval '6 hours'
      GROUP BY 1,2,3,4,5`, [ids]).catch(() => ({ rows: [] }));
  // por evento → por casa → { x2: {home,draw,away}, totals: {line: {over, under}} }
  const byEv = new Map();
  for (const r of q.rows) {
    if (!(r.o > 1)) continue;
    const ev = byEv.get(r.ceid) || new Map(); byEv.set(r.ceid, ev);
    const b = ev.get(r.book) || { code: r.book, x2: {}, totals: {}, seen: null }; ev.set(r.book, b);
    if (r.fam === 'match_winner') b.x2[r.side] = r.o;
    else if (Number.isFinite(r.line) && (r.side === 'over' || r.side === 'under')) (b.totals[r.line] = b.totals[r.line] || { line: r.line })[r.side] = r.o;
    if (!b.seen || String(r.seen) > String(b.seen)) b.seen = r.seen;
  }
  const out = new Map();
  for (const [ceid, ev] of byEv) {
    const books = [];
    for (const b of ev.values()) {
      // SOLO medias líneas (x,5) en v1: la entera devuelve en el empate y la de cuarto (x,25/x,75) reparte el stake
      // en dos líneas — el inversor calcula P(total > L) puro y la liquidación no sabe medias ganancias. La primera
      // pasada en prod nació con 2, 2,25, 3, 3,75… y esas tesis se anulan al arrancar (`voidNonHalf`).
      const totals = Object.values(b.totals).filter((t) => t.over > 1 && t.under > 1 && isHalf(t.line));
      if (!(b.x2.home > 1 && b.x2.draw > 1 && b.x2.away > 1) || !totals.length) continue;   // hacen falta los DOS mercados
      books.push({ code: b.code, x2: b.x2, totals, seen: b.seen });
    }
    if (books.length) out.set(ceid, books);
  }
  return out;
}

// ── PASADA ──────────────────────────────────────────────────────────────────────────────────────────────
async function run({ dbc, qevents = {}, ahora = Date.now(), horizonH = 48 } = {}) {
  const out = { sport: SPORT, eventos: 0, con_casas: 0, tesis_evaluadas: 0 };
  if (!dbc) return { ...out, why: 'sin base de cuotas' };
  try { out.anuladas_linea = voidNonHalf(ahora); } catch { out.anuladas_linea = null; }
  const ids = Object.keys(qevents).filter((id) => { const k = Date.parse((qevents[id] || {}).kickoff || 0); return Number.isFinite(k) && k > ahora && k < ahora + horizonH * 3600e3; });
  out.eventos = ids.length;
  if (!ids.length) return { ...out, why: 'sin partidos futuros con cuotas' };
  const books = await loadBooks(dbc, ids);
  out.con_casas = books.size;

  // 1) primera pasada sin línea de base: recoger las incoherencias crudas de todas las casas
  const raw = [];
  const analyzed = new Map();
  for (const [ceid, bks] of books) {
    const m = F.analyzeMatch(bks, { devig1x2: 'shin' });
    analyzed.set(ceid, m);
    for (const b of m.books) for (const t of b.totals) if (Number.isFinite(t.delta_goals)) raw.push(t.delta_goals);
  }
  const st = S.rd(SPORT);
  const base = S.updateBaseline(st, 'delta_goals', raw);
  S.wr(SPORT, st);
  out.baseline = { delta_goals: r4(base.value), n_obs: base.n_obs, fresh: base.fresh };

  // 2) segunda pasada con la línea de base descontada → tesis
  const theses = [];
  for (const [ceid, bks] of books) {
    const meta = qevents[ceid] || {};
    const m = base.value != null ? F.analyzeMatch(bks, { devig1x2: 'shin', deltaBaseline: base.value }) : analyzed.get(ceid);
    const common = { ceid, league: meta.league || null, match: `${meta.home} vs ${meta.away}`, home: meta.home, away: meta.away, kickoff_at: meta.kickoff || null };
    if (base.value != null) {
      for (const b of m.books) for (const t of b.theses) {
        theses.push({ ...common, key: `${ceid}|${t.family}|${b.code}|${t.side}|${t.line}`, book: b.code, family: t.family, side: t.side, line: t.line, odds: t.odds,
          p_coherent: t.p_coherent, p_market: t.p_market, edge_pp: t.edge_pp, basis: t.basis, n_books: m.consensus.n_books,
          meta: { lh: b.x2.lh, la: b.x2.la, total_1x2: b.x2.total, overround_1x2: b.x2.overround } });
      }
    }
    for (const d of m.deviations) {
      theses.push({ ...common, key: `${ceid}|${d.family}|${d.code}|${d.side}|${d.line}`, book: d.code, family: d.family, side: d.side, line: d.line, odds: d.odds,
        p_coherent: d.p_coherent, p_market: d.p_market, edge_pp: d.edge_pp, basis: d.basis, n_books: d.n_books, meta: { delta_goals: d.delta_goals } });
    }
  }
  out.tesis_evaluadas = theses.length;
  out.record = S.record(SPORT, theses.filter((t) => t.odds > 1), { baseline: base.value, ahora });
  return out;
}

// ── CIERRES: la misma casa, la mejor y Pinnacle para la selección exacta ────────────────────────────────
function quoteForFactory(dbc) {
  return async (p) => {
    const fam = p.family === 'IMPLIED_1X2' ? 'match_winner' : 'match_total';
    const params = fam === 'match_winner' ? [p.ceid, fam, p.side] : [p.ceid, fam, p.side, p.line];
    const sql = fam === 'match_winner'
      ? `SELECT lower(sportsbook_code) b, odds_decimal::float o, observed_at FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND lower(side)=$3 AND observed_at > now() - interval '45 minutes'`
      : `SELECT lower(sportsbook_code) b, odds_decimal::float o, observed_at FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND lower(side)=$3 AND line=$4 AND observed_at > now() - interval '45 minutes'`;
    const r = await dbc.query(sql, params).catch(() => ({ rows: [] }));
    if (!r.rows.length) return null;
    const own = r.rows.find((x) => x.b === p.book), pin = r.rows.find((x) => x.b === 'pinnacle');
    const best = r.rows.reduce((m, x) => (x.o > m ? x.o : m), 0);
    const newest = r.rows.reduce((m, x) => (String(x.observed_at) > String(m) ? x.observed_at : m), '');
    return { own: own ? own.o : null, best: best || null, pinnacle: pin ? pin.o : null, age_min: newest ? Math.round((Date.now() - Date.parse(newest)) / 60000) : null };
  };
}

// ── LIQUIDACIÓN: con el marcador (scoreFor devuelve { homeGoals, awayGoals }) ───────────────────────────
function verdictFactory(scoreFor) {
  return (p) => {
    const sc = scoreFor ? scoreFor(p) : null;
    if (!sc || sc.homeGoals == null || sc.awayGoals == null) return null;
    const h = +sc.homeGoals, a = +sc.awayGoals;
    if (p.family === 'IMPLIED_1X2') {
      const res = h > a ? 'home' : h < a ? 'away' : 'draw';
      return res === p.side ? 'WIN' : 'LOSS';
    }
    const tot = h + a, L = +p.line;
    if (tot === L) return 'PUSH';
    const over = tot > L;
    return (p.side === 'over') === over ? 'WIN' : 'LOSS';
  };
}

async function job({ dbc, qevents, scoreFor, ahora = Date.now() } = {}) {
  const out = {};
  out.run = await run({ dbc, qevents, ahora }).catch((e) => ({ error: e.message }));
  out.closes = dbc ? await S.closes(SPORT, quoteForFactory(dbc), { ahora }).catch((e) => ({ error: e.message })) : { skipped: 'db_off' };
  out.settle = S.settle(SPORT, verdictFactory(scoreFor), { ahora });
  return out;
}
// solo cierres (para un barrido fino cerca del saque, sin recalcular tesis)
async function closesOnly({ dbc, ahora = Date.now() } = {}) {
  if (!dbc) return { skipped: 'db_off' };
  return S.closes(SPORT, quoteForFactory(dbc), { ahora });
}
const track = () => S.track(SPORT);

module.exports = { SPORT, run, job, closesOnly, track, loadBooks, quoteForFactory, verdictFactory };
