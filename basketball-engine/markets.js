// basketball-engine/markets.js — OPORTUNIDADES DE BALONCESTO (15-ago).
//
// Las cuotas de las 8 claves de baloncesto de The Odds API entran al mismo almacén que el fútbol
// (sportsbook_goal_quote_current) pero NO pueden compartir superficie con él: el 1X2 de fútbol es un
// mercado de tres salidas y el ganador de baloncesto es de DOS. Mezclarlos rompe el de-vig (repartir
// el margen entre tres salidas cuando hay dos infla la probabilidad justa) y por tanto rompe el
// arbitraje. Por eso este módulo es propio y no reusa el loader de clubes.
//
// Cuatro superficies, las mismas que fútbol y combate:
//   VALUE      — mejor precio vs consenso sin margen (line shopping). NO depende del modelo: es una
//                discrepancia REAL entre casas, y por eso se puede publicar aunque el modelo todavía
//                no bata al cierre. El número del modelo viaja al lado como referencia (GP Take).
//   ARBITRAJE  — las dos patas de un mercado de dos salidas en casas distintas con suma < 1.
//   CAÍDAS     — la línea de las casas afiladas se movió y alguna casa lenta quedó atrás.
//   MIDDLES    — Over en una línea baja + Under en una alta: si el resultado cae en el medio, cobran las dos.
//
// Todo lo que sale de acá está ANCLADO A PRECIOS OBSERVADOS. El modelo nunca crea una oportunidad:
// solo comenta la que el mercado ya creó.
'use strict';

// Claves de The Odds API por liga del modelo. Euroliga/NBL no tienen dataset propio todavía: aparecen
// igual en las superficies de mercado (arbitrar no necesita modelo) bajo la pestaña "Todas".
const LEAGUE_KEYS = {
  nba: ['basketball_nba', 'basketball_nba_preseason', 'basketball_nba_summer_league'],
  wnba: ['basketball_wnba'],
  ncaam: ['basketball_ncaab'],
  ncaaw: ['basketball_wncaab'],
  euro: ['basketball_euroleague', 'basketball_nbl'],
};
const KEY_LABEL = {
  basketball_nba: 'NBA', basketball_nba_preseason: 'NBA pretemporada', basketball_nba_summer_league: 'NBA Summer League',
  basketball_wnba: 'WNBA', basketball_ncaab: 'NCAA masculino', basketball_wncaab: 'NCAA femenino',
  basketball_euroleague: 'Euroliga', basketball_nbl: 'NBL',
};
const ALL_KEYS = Object.values(LEAGUE_KEYS).flat();
// Casas que mueven la línea: cuando ELLAS se mueven, es información; cuando se mueve una casa lenta, es ruido.
const SHARP_BOOKS = ['pinnacle', 'cloudbet', 'betfair_ex_eu', 'betfair_ex_uk', 'betfair_ex_au', 'matchbook', 'polymarket', 'kalshi', 'novig', 'prophetx'];

const FAMS = ['match_winner', 'match_total', 'spread'];
const famLabel = (f) => (f === 'match_winner' ? 'Ganador' : f === 'spread' ? 'Hándicap' : 'Total de puntos');

// Eventos de baloncesto del mapa del scanner, acotados a una liga (o a todas) y a la ventana útil.
function hoopsEvents(evMap, { league = 'all', now = Date.now(), pastH = 3, futureH = 240 } = {}) {
  const keys = league === 'all' ? ALL_KEYS : (LEAGUE_KEYS[league] || []);
  const out = {};
  for (const [ceid, m] of Object.entries(evMap || {})) {
    if (!m || m.sport !== 'basketball') continue;
    if (keys.length && keys.indexOf(m.league) < 0) continue;
    const k = m.kickoff ? +new Date(m.kickoff) : NaN;
    if (!Number.isFinite(k)) continue;
    if (k < now - pastH * 3600e3 || k > now + futureH * 3600e3) continue;
    out[ceid] = m;
  }
  return out;
}
// Lo contrario: el mapa SIN baloncesto, para que las superficies de fútbol no se contaminen.
function nonHoopsEvents(evMap) {
  const out = {};
  for (const [ceid, m] of Object.entries(evMap || {})) if (!m || m.sport !== 'basketball') out[ceid] = m;
  return out;
}

const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const r2 = (x) => +Number(x).toFixed(2);

// ── CUOTAS ACTUALES ─────────────────────────────────────────────────────────────────────────────
// Una query por lotes de ceids (el statement con 300 ids muere por timeout, lección del 12-ago).
async function loadQuotes(dbc, ceids, { minutes = 75 } = {}) {
  const rows = [];
  let err = null;
  for (let i = 0; i < ceids.length; i += 80) {
    const r = await dbc.query(
      `SELECT canonical_event_id ceid, lower(sportsbook_code) book, market_family fam,
              line::float line, lower(side) side, max(odds_decimal)::float o,
              max(max_stake)::float max_stake, max(observed_at) seen
         FROM sportsbook_goal_quote_current
        WHERE canonical_event_id = ANY($1) AND market_family = ANY($2)
          AND coalesce(quote_status,'open') = 'open' AND is_live = FALSE
          AND observed_at > now() - interval '${minutes} minutes'
        GROUP BY 1,2,3,4,5`,
      [ceids.slice(i, i + 80), FAMS]).catch((e) => { err = e; return { rows: [] }; });
    rows.push(...r.rows);
  }
  if (err) console.error('[hoops-markets] query de cuotas falló (parcial=' + rows.length + '):', err.message);
  return rows;
}

// Agrupa por MERCADO. Un mercado de baloncesto es de dos salidas: (ganador local/visitante),
// (hándicap en una línea) o (total en una línea). La clave incluye la línea porque -5.5 y -6.5 son
// mercados distintos y compararlos sería comparar peras con manzanas.
function groupMarkets(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!(r.o > 1)) continue;
    const two = r.fam === 'match_winner' ? ['home', 'away'] : r.fam === 'spread' ? ['home', 'away'] : ['over', 'under'];
    if (two.indexOf(r.side) < 0) continue;
    // El hándicap se cuelga con la línea del LOCAL: la fila del visitante trae la línea espejo, así que
    // se normaliza a la del local para que las dos patas caigan en el mismo mercado.
    const line = r.fam === 'match_winner' ? null : (r.fam === 'spread' ? (r.side === 'home' ? r.line : -r.line) : r.line);
    if (r.fam !== 'match_winner' && !Number.isFinite(line)) continue;
    const key = r.ceid + '|' + r.fam + '|' + (line == null ? '' : line.toFixed(1));
    if (!by.has(key)) by.set(key, { ceid: r.ceid, fam: r.fam, line, sides: two, q: { [two[0]]: [], [two[1]]: [] } });
    by.get(key).q[r.side].push({ book: r.book, o: r.o, max: r.max_stake, seen: r.seen });
  }
  return [...by.values()];
}

// Probabilidad JUSTA de un mercado de dos salidas: mediana de la implícita entre casas por lado y
// normalización a 1 (así se quita el margen). La mediana, no la media, porque una casa con un precio
// disparatado no debe mover el consenso.
function fairTwoWay(m) {
  const a = median(m.q[m.sides[0]].map((x) => 1 / x.o));
  const b = median(m.q[m.sides[1]].map((x) => 1 / x.o));
  if (!(a > 0) || !(b > 0)) return null;
  const s = a + b;
  return { [m.sides[0]]: a / s, [m.sides[1]]: b / s, vig_pct: +((s - 1) * 100).toFixed(2) };
}
const bestOf = (arr) => arr.reduce((best, x) => (!best || x.o > best.o ? x : best), null);

// ── LAS CUATRO SUPERFICIES ──────────────────────────────────────────────────────────────────────
function buildSurfaces(mkts, evs, { minBooks = 3, minEv = 2 } = {}) {
  const value = [], arbs = [];
  const totalsByEvent = new Map(), spreadsByEvent = new Map();
  for (const m of mkts) {
    const ev = evs[m.ceid]; if (!ev) continue;
    const nA = m.q[m.sides[0]].length, nB = m.q[m.sides[1]].length;
    const books = Math.min(nA, nB);
    const evInfo = { home: ev.home, away: ev.away, league: ev.league, league_name: KEY_LABEL[ev.league] || ev.league, kickoff: ev.kickoff };

    if (books >= minBooks) {
      const fair = fairTwoWay(m);
      if (fair) {
        for (const side of m.sides) {
          const b = bestOf(m.q[side]); if (!b) continue;
          const evPct = (b.o * fair[side] - 1) * 100;
          if (evPct >= minEv) {
            value.push({
              ceid: m.ceid, fam: m.fam, fam_label: famLabel(m.fam), line: m.line, side,
              label: sideLabel(m, side, ev), event: evInfo,
              odds: r2(b.o), book: b.book, max_stake: b.max != null ? Math.round(b.max) : null,
              fair: +fair[side].toFixed(4), fair_odds: r2(1 / fair[side]),
              ev_pct: +evPct.toFixed(2), books, vig_pct: fair.vig_pct,
            });
          }
        }
      }
    }
    // ARBITRAJE: las dos patas al mejor precio, en casas distintas y con suma de implícitas < 1.
    const bA = bestOf(m.q[m.sides[0]]), bB = bestOf(m.q[m.sides[1]]);
    if (bA && bB && bA.book !== bB.book) {
      const inv = 1 / bA.o + 1 / bB.o;
      if (inv < 1) {
        const cap = [bA, bB].every((x) => x.max != null) ? Math.round(Math.min(bA.max * bA.o, bB.max * bB.o)) : null;
        arbs.push({
          ceid: m.ceid, fam: m.fam, fam_label: famLabel(m.fam), line: m.line, event: evInfo,
          a: { side: m.sides[0], label: sideLabel(m, m.sides[0], ev), odds: r2(bA.o), book: bA.book, stake_pct: +(100 * (1 / bA.o) / inv).toFixed(1), max_stake: bA.max != null ? Math.round(bA.max) : null },
          b: { side: m.sides[1], label: sideLabel(m, m.sides[1], ev), odds: r2(bB.o), book: bB.book, stake_pct: +(100 * (1 / bB.o) / inv).toFixed(1), max_stake: bB.max != null ? Math.round(bB.max) : null },
          profit_pct: +((1 / inv - 1) * 100).toFixed(2),
          executable: cap != null && cap >= 50, max_payout: cap,
        });
      }
    }
    if (m.fam === 'match_total') { if (!totalsByEvent.has(m.ceid)) totalsByEvent.set(m.ceid, []); totalsByEvent.get(m.ceid).push(m); }
    if (m.fam === 'spread') { if (!spreadsByEvent.has(m.ceid)) spreadsByEvent.set(m.ceid, []); spreadsByEvent.get(m.ceid).push(m); }
  }

  // MIDDLES. En baloncesto el hueco útil es más ancho que en fútbol (un total de 215 no es un total de
  // 2.5 goles): se exige ≥2 puntos de hueco en totales y ≥2 en hándicap, y coste ≤ 6% del riesgo.
  const middles = [];
  const addMiddles = (byEv, kind) => {
    for (const [ceid, list] of byEv) {
      const ev = evs[ceid]; if (!ev) continue;
      const lowSide = kind === 'total' ? 'over' : 'home', highSide = kind === 'total' ? 'under' : 'away';
      const bestByLine = (side) => { const o = {}; for (const m of list) { const b = bestOf(m.q[side]); if (b && (!o[m.line] || b.o > o[m.line].o)) o[m.line] = { ...b, line: m.line }; } return o; };
      const lo = bestByLine(lowSide), hi = bestByLine(highSide);
      for (const a of Object.values(lo)) for (const b of Object.values(hi)) {
        if (a.book === b.book) continue;                    // el middle vive ENTRE casas
        // DÓNDE GANAN LAS DOS PATAS. Hay que ser exacto o se publican pares que no son middles:
        //  total:    Over L1 gana si total > L1;  Under L2 gana si total < L2  → zona (L1, L2), hueco L2−L1.
        //  hándicap: `line` está normalizada al HÁNDICAP DEL LOCAL. El local con hándicap Lh cubre si el
        //            margen supera −Lh; la pata visitante de un mercado cuyo hándicap local es La cubre si
        //            el margen es menor que −La. Las dos ganan en (−Lh, −La), o sea hueco Lh − La.
        //            (La versión anterior sumaba Lh + La y publicaba pares donde las dos patas PIERDEN
        //            juntas — el reverso exacto de un middle.)
        const gap = kind === 'total' ? b.line - a.line : a.line - b.line;
        if (!(gap >= 2)) continue;
        const zLo = kind === 'total' ? a.line : -a.line;
        const zHi = kind === 'total' ? b.line : -b.line;
        const cost = (1 / a.o + 1 / b.o - 1) * 100;
        if (cost > 6) continue;
        middles.push({
          ceid, kind, fam_label: kind === 'total' ? 'Total de puntos' : 'Hándicap',
          event: { home: ev.home, away: ev.away, league: ev.league, league_name: KEY_LABEL[ev.league] || ev.league, kickoff: ev.kickoff },
          low: { line: a.line, odds: r2(a.o), book: a.book, label: kind === 'total' ? 'Over ' + a.line : ev.home + ' ' + fmtSpread(a.line) },
          high: { line: b.line, odds: r2(b.o), book: b.book, label: kind === 'total' ? 'Under ' + b.line : ev.away + ' ' + fmtSpread(-b.line) },
          gap: +gap.toFixed(1), cost_pct: +cost.toFixed(2),
          zone: kind === 'total' ? `${Math.ceil(zLo)}–${Math.floor(zHi)} puntos` : `margen del local entre ${fmtSpread(Math.ceil(zLo))} y ${fmtSpread(Math.floor(zHi))}`,
        });
      }
    }
  };
  addMiddles(totalsByEvent, 'total');
  addMiddles(spreadsByEvent, 'spread');

  value.sort((a, b) => b.ev_pct - a.ev_pct);
  arbs.sort((a, b) => (b.executable - a.executable) || (b.profit_pct - a.profit_pct));
  middles.sort((a, b) => a.cost_pct - b.cost_pct);
  return { value, arbs, middles };
}
const fmtSpread = (x) => (x > 0 ? '+' + x : String(x));
function sideLabel(m, side, ev) {
  if (m.fam === 'match_winner') return side === 'home' ? ev.home : ev.away;
  if (m.fam === 'spread') return (side === 'home' ? ev.home + ' ' + fmtSpread(m.line) : ev.away + ' ' + fmtSpread(-m.line));
  return (side === 'over' ? 'Over ' : 'Under ') + m.line;
}

// ── CAÍDAS DE CUOTA ─────────────────────────────────────────────────────────────────────────────
// La línea afilada de ahora vs la de hace unas horas. Si cayó ≥5% es que entró dinero informado; las
// casas que todavía no la movieron ("rezagadas") son donde queda el precio viejo.
async function dropping(dbc, evs, { minutes = 75, fromH = 9, toH = 3 } = {}) {
  const ceids = Object.keys(evs); if (!ceids.length) return [];
  const rows = [];
  for (let i = 0; i < ceids.length; i += 80) {
    const r = await dbc.query(
      `SELECT canonical_event_id ceid, market_family fam, line::float line, lower(side) side,
              avg(odds_decimal) FILTER (WHERE observed_at > now() - interval '${minutes} minutes' AND lower(sportsbook_code) = ANY($2))::float sharp_now,
              avg(odds_decimal) FILTER (WHERE observed_at BETWEEN now() - interval '${fromH} hours' AND now() - interval '${toH} hours' AND lower(sportsbook_code) = ANY($2))::float sharp_before
         FROM sportsbook_goal_quote_current
        WHERE canonical_event_id = ANY($1) AND market_family = ANY($3)
          AND observed_at > now() - interval '${fromH} hours' AND is_live = FALSE
        GROUP BY 1,2,3,4`, [ceids.slice(i, i + 80), SHARP_BOOKS, FAMS]).catch(() => ({ rows: [] }));
    rows.push(...r.rows);
  }
  const flagged = rows.filter((r) => r.sharp_now > 1 && r.sharp_before > 1 && r.sharp_now < r.sharp_before * 0.95)
    .sort((a, b) => (b.sharp_before / b.sharp_now) - (a.sharp_before / a.sharp_now)).slice(0, 60);
  if (!flagged.length) return [];
  const cur = await loadQuotes(dbc, [...new Set(flagged.map((r) => r.ceid))], { minutes });
  const curBy = {};
  for (const r of cur) (curBy[`${r.ceid}|${r.fam}|${r.line}|${r.side}`] = curBy[`${r.ceid}|${r.fam}|${r.line}|${r.side}`] || []).push(r);
  const isSharp = (b) => SHARP_BOOKS.some((s) => String(b).indexOf(s) >= 0);
  const out = [];
  for (const r of flagged) {
    const ev = evs[r.ceid]; if (!ev) continue;
    if (ev.kickoff && Date.parse(ev.kickoff) < Date.now()) continue;
    const stale = (curBy[`${r.ceid}|${r.fam}|${r.line}|${r.side}`] || [])
      .filter((x) => !isSharp(x.book) && x.o >= r.sharp_before * 0.985)
      .sort((a, b) => b.o - a.o).slice(0, 5).map((x) => ({ book: x.book, o: r2(x.o) }));
    out.push({
      ceid: r.ceid, fam: r.fam, fam_label: famLabel(r.fam), line: r.line, side: r.side,
      event: { home: ev.home, away: ev.away, league: ev.league, league_name: KEY_LABEL[ev.league] || ev.league, kickoff: ev.kickoff },
      sharp_before: r2(r.sharp_before), sharp_now: r2(r.sharp_now),
      drop_pct: +((1 - r.sharp_now / r.sharp_before) * 100).toFixed(1),
      move_pp: +(((1 / r.sharp_now) - (1 / r.sharp_before)) * 100).toFixed(1),
      stale,
    });
  }
  out.sort((a, b) => (b.stale.length - a.stale.length) || (b.drop_pct - a.drop_pct));
  return out.slice(0, 30);
}

// ── EL MODELO COMO REFERENCIA (GP Take) ─────────────────────────────────────────────────────────
// Resuelve los nombres del mercado contra los equipos del dataset y adjunta la probabilidad del
// simulador a cada fila de value. Nunca crea filas: solo anota las que el mercado ya generó. Si el
// nombre no resuelve (NCAA, equipos nuevos), la fila sale igual sin GP Take.
const normTeam = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
function teamIndex(C) {
  const idx = {};
  for (const [id, t] of Object.entries(C.teams || {})) {
    for (const n of [t.name, t.short, t.location && t.short ? t.location + ' ' + t.short : null, t.abbr]) {
      if (n) idx[normTeam(n)] = id;
    }
  }
  return idx;
}
function attachModel(rows, C, { simulate, markets, cache = new Map() } = {}) {
  if (!C || !C.fit || !simulate) return rows;
  const idx = teamIndex(C);
  for (const row of rows) {
    const h = idx[normTeam(row.event.home)], a = idx[normTeam(row.event.away)];
    if (!h || !a || !C.fit.off[h] || !C.fit.off[a]) continue;
    const ck = h + ':' + a;
    if (!cache.has(ck)) {
      const sim = simulate(C.fit, h, a, { n: 12000, seed: 7 });
      cache.set(ck, sim ? { sim, mk: markets(sim) } : null);
    }
    const got = cache.get(ck); if (!got) continue;
    const { sim, mk } = got;
    let p = null;
    if (row.fam === 'match_winner') p = row.side === 'home' ? sim.win.home : sim.win.away;
    else if (row.fam === 'match_total') {
      const hit = mk.total.find((t) => Math.abs(t.line - row.line) < 0.01)
        || { over: probTotalOver(sim, row.line), under: 1 - probTotalOver(sim, row.line) };
      p = row.side === 'over' ? hit.over : hit.under;
    } else if (row.fam === 'spread') {
      const pm = probMarginGT(sim, -row.line);           // el local cubre -X si el margen supera X
      p = row.side === 'home' ? pm : 1 - pm;
    }
    if (p == null || !(p > 0) || !(p < 1)) continue;
    row.model = +p.toFixed(4);
    row.model_odds = +(1 / p).toFixed(2);
    row.model_ev_pct = +((row.odds * p - 1) * 100).toFixed(2);
    row.model_vs_market_pp = +((p - row.fair) * 100).toFixed(1);
    row.model_conf = sim.conf;
  }
  return rows;
}
const probTotalOver = (sim, line) => (sim.total_hist || []).filter(([t]) => t > line).reduce((s, [, p]) => s + p, 0);
const probMarginGT = (sim, line) => (sim.margin_hist || []).filter(([m]) => m > line).reduce((s, [, p]) => s + p, 0);

module.exports = { LEAGUE_KEYS, KEY_LABEL, ALL_KEYS, SHARP_BOOKS, hoopsEvents, nonHoopsEvents, loadQuotes, groupMarkets, buildSurfaces, dropping, attachModel, famLabel };
