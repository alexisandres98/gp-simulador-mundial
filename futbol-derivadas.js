// futbol-derivadas.js — LAS FAMILIAS QUE LA CASA YA COTIZABA Y NO LEÍAMOS (20-ago)
//
// POR QUÉ EXISTE Y POR QUÉ VIVE APARTE. Midiendo Cloudbet salió que en los partidos que el colector
// descartaba la casa cotizaba entre 14 y 25 mercados. Cuatro de ellos —doble oportunidad, empate no válido,
// hándicap asiático de goles y totales de equipo— los sabe valorar el motor de goles SIN medir nada nuevo,
// porque salen de la misma matriz de marcador que ya calcula. Es inventario ejecutable que estábamos tirando.
//
// Pero una familia nueva no entra al feed público por el hecho de ser calculable. Entra a la SOMBRA, acumula
// muestra y la juzga el tablero de familias con la misma vara que a todas: el CLV y su estadístico. Por eso
// esto vive en su propio archivo y su propio almacén, y no toca `db.clubDailyPicks` ni `curate`: si algo aquí
// se rompe, el feed que ven los usuarios no se entera.
//
// LO QUE NO ENTRA, A PROPÓSITO: los mercados por MITADES (primer tiempo, segundo tiempo). Repartir el gol
// entre los dos tiempos es una suposición que GP no ha medido, y una familia sin estructura medida no se
// apuesta — la misma regla que mantiene cerradas las rondas de Valorant sin perfil medido.
'use strict';

const fs = require('fs');
const path = require('path');
const dist = require('./goal-engine/distribution');
const mk = require('./goal-engine/markets');
const noVig = require('./goal-engine/noVig');
const settlement = require('./goal-engine/settlement');

// ── LA REGLA, CONGELADA ─────────────────────────────────────────────────────────────────────────────────
// Mismo criterio que `cards_under_v1` y `props_cs2_v2`: se escribe, se fecha y no se toca mientras se
// acumula muestra. Cambiarla a mitad de la ventana destruye lo único que la ventana produce.
const RULE = {
  version: 'derivadas_v1',
  frozen_at: '2026-08-20',
  edge_min: 0.03,        // 3 pp sobre el precio sin vig
  edge_cap: 0.15,        // por encima, la ventaja es NUESTRO error, no del mercado
  books_min: 1,          // estas líneas cotizan en 1-2 casas hoy; el conteo viaja en la tesis
  familias: ['double_chance', 'draw_no_bet', 'asian_handicap', 'team_total', 'btts'],
  note: 'sombra desde 3 pp contra el precio sin vig; veto por encima de 15 pp. Las probabilidades de empate-no-válido y de hándicap entero son CONDICIONALES (descuentan la devolución), que es la única forma de compararlas con un precio que devuelve.',
};

const DISK = () => {
  const base = path.dirname(process.env.DB_FILE || path.join(__dirname, 'db.json'));
  const d = path.join(base, 'derivadas');
  try { fs.mkdirSync(d, { recursive: true }); } catch { }
  return d;
};
const FILE = () => path.join(DISK(), 'futbol-derivadas.json');
const rd = () => { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return { picks: {}, at: null, rule: RULE.version }; } };
const wr = (o) => { try { const f = FILE(); fs.writeFileSync(f + '.tmp', JSON.stringify(o)); fs.renameSync(f + '.tmp', f); } catch { } };

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

// El par complementario de cada mercado: para el precio sin vig hacen falta los DOS lados.
function contrario(id) {
  let m = id.match(/^DRAW_NO_BET_(HOME|AWAY)$/);
  if (m) return 'DRAW_NO_BET_' + (m[1] === 'HOME' ? 'AWAY' : 'HOME');
  m = id.match(/^AH_(HOME|AWAY)_(M|P)(\d+)(?:_(\d+))?$/);
  if (m) {
    const otro = m[1] === 'HOME' ? 'AWAY' : 'HOME';
    const signo = m[2] === 'M' ? 'P' : 'M';                      // el espejo de −0,5 es +0,5
    return `AH_${otro}_${signo}${m[3]}${m[4] != null ? '_' + m[4] : ''}`;
  }
  m = id.match(/^(HOME|AWAY)_TEAM_TOTAL_(OVER|UNDER)_(.+)$/);
  if (m) return `${m[1]}_TEAM_TOTAL_${m[2] === 'OVER' ? 'UNDER' : 'OVER'}_${m[3]}`;
  if (id === 'BTTS_YES') return 'BTTS_NO';
  if (id === 'BTTS_NO') return 'BTTS_YES';
  // la doble oportunidad no tiene complementario de dos vías (su contrario es el 1X2 restante): se valora
  // contra el precio de la propia casa con el margen que traiga, y eso se DICE en la tesis.
  return null;
}

// ── REGISTRO ────────────────────────────────────────────────────────────────────────────────────────────
// `deps` inyecta lo que solo el servidor sabe: los eventos con cuotas, cómo sacar las lambdas de un cruce y
// cómo resolver un equipo. Así este módulo no depende de `db` y se puede probar suelto.
async function record(deps = {}) {
  const { dbc, qevents = {}, lambdasFor, ahora = Date.now() } = deps;
  const out = { evaluadas: 0, nuevas: 0, sin_lambdas: 0, sin_par: 0, bajo_listón: 0, vetadas: 0, por_familia: {} };
  if (!dbc || typeof lambdasFor !== 'function') return { ...out, why: 'faltan dependencias' };
  const ids = Object.keys(qevents).filter((id) => {
    const k = Date.parse((qevents[id] || {}).kickoff || 0);
    return Number.isFinite(k) && k > ahora;                      // solo prepartido
  });
  if (!ids.length) return { ...out, why: 'sin eventos futuros con cuotas' };
  const q = await dbc.query(
    `SELECT canonical_event_id, market_family, market_id, line::float, side, sportsbook_code, odds_decimal::float o
       FROM sportsbook_goal_quote_current
      WHERE canonical_event_id = ANY($1) AND market_family = ANY($2)
        AND coalesce(quote_status,'open') = 'open' AND observed_at > now() - interval '6 hours'`,
    [ids, RULE.familias]).catch(() => ({ rows: [] }));
  if (!q.rows.length) return { ...out, why: 'sin cuotas de estas familias' };

  // índice por mercado, y cache de la matriz por evento (calcularla una vez por partido, no por línea)
  const porMercado = new Map();
  for (const r of q.rows) {
    const k = r.canonical_event_id + '|' + r.market_id;
    if (!porMercado.has(k)) porMercado.set(k, []);
    porMercado.get(k).push(r);
  }
  const matriz = new Map();
  const st = rd();
  st.picks = st.picks || {};

  for (const [k, filas] of porMercado) {
    const [ceid, marketId] = k.split('|');
    const meta = qevents[ceid]; if (!meta) continue;
    if (!matriz.has(ceid)) {
      let m = null;
      try { const l = lambdasFor(ceid, meta); if (l && l[0] > 0 && l[1] > 0) m = dist.buildMatrix(l[0], l[1]).matrix; } catch { m = null; }
      matriz.set(ceid, m);
    }
    const M = matriz.get(ceid);
    if (!M) { out.sin_lambdas++; continue; }
    const fila = mk.extendedMarkets(M).find((x) => x.market_id === marketId)
      || dist.marketProbabilities(M).find((x) => x.market_id === marketId);
    if (!fila) continue;
    out.evaluadas++;

    const best = filas.slice().sort((a, b) => b.o - a.o)[0];
    const casas = new Set(filas.map((x) => x.sportsbook_code)).size;
    // precio sin vig: con el complementario cuando existe; sin él, el implícito crudo y se declara
    const opId = contrario(marketId);
    let pMercado = null, comoMercado = 'implícita de la casa (sin complementario cotizado)';
    if (opId) {
      const op = porMercado.get(ceid + '|' + opId);
      if (op && op.length) {
        const bop = op.slice().sort((a, b) => b.o - a.o)[0];
        const nv = noVig.twoWayNoVig(best.o, bop.o);
        if (nv && nv.a != null) { pMercado = nv.a; comoMercado = 'sin vig contra el lado contrario'; }
      }
    }
    if (pMercado == null) pMercado = 1 / best.o;
    if (!opId) out.sin_par++;

    const edge = fila.probability - pMercado;
    const fam = filas[0].market_family;
    out.por_familia[fam] = out.por_familia[fam] || { evaluadas: 0, nuevas: 0 };
    out.por_familia[fam].evaluadas++;
    if (edge > RULE.edge_cap) { out.vetadas++; continue; }
    if (edge < RULE.edge_min || casas < RULE.books_min) { out.bajo_listón++; continue; }

    const key = ceid + '|' + marketId;
    if (st.picks[key]) continue;
    st.picks[key] = {
      key, ceid, market_id: marketId, family: fam,
      league: meta.league || null, match: `${meta.home} vs ${meta.away}`,
      home: meta.home, away: meta.away, kickoff_at: meta.kickoff || null,
      line: filas[0].line != null ? filas[0].line : null, side: filas[0].side || null,
      odds: best.o, book: best.sportsbook_code, books: casas,
      p_gp: r4(fila.probability), p_market: r4(pMercado), edge_pp: r2(100 * edge),
      market_basis: comoMercado,
      rule_version: RULE.version, rule_edge_min: RULE.edge_min,
      born_at: new Date().toISOString(), status: 'ACTIVE',
      close_odds: null, close_at: null, clv_pct: null, result: null, settled_at: null,
    };
    out.nuevas++; out.por_familia[fam].nuevas++;
  }
  if (out.nuevas) { st.at = new Date().toISOString(); wr(st); }
  return out;
}

// ── CIERRE ──────────────────────────────────────────────────────────────────────────────────────────────
// El cierre es el precio que la casa tenía al arrancar el partido. Se refresca en cada pasada mientras el
// partido no haya empezado: la última lectura antes del saque ES el cierre. Sin esto no hay CLV, y sin CLV
// esta familia no se puede juzgar — es la vara de la casa.
async function closes(deps = {}) {
  const { dbc, ahora = Date.now() } = deps;
  const st = rd();
  const vivas = Object.values(st.picks || {}).filter((p) => p.status === 'ACTIVE' && Date.parse(p.kickoff_at || 0) > ahora);
  if (!dbc || !vivas.length) return { actualizados: 0 };
  const ids = [...new Set(vivas.map((p) => p.ceid))];
  const q = await dbc.query(
    `SELECT canonical_event_id, market_id, max(odds_decimal::float) o
       FROM sportsbook_goal_quote_current
      WHERE canonical_event_id = ANY($1) AND market_family = ANY($2)
        AND coalesce(quote_status,'open') = 'open' AND observed_at > now() - interval '3 hours'
      GROUP BY 1,2`, [ids, RULE.familias]).catch(() => ({ rows: [] }));
  const idx = new Map(q.rows.map((r) => [r.canonical_event_id + '|' + r.market_id, r.o]));
  let n = 0;
  for (const p of vivas) {
    const o = idx.get(p.ceid + '|' + p.market_id);
    if (!(o > 1)) continue;
    p.close_odds = o; p.close_at = new Date().toISOString();
    p.clv_pct = r2(100 * (p.odds / o - 1));
    n++;
  }
  if (n) { st.at = new Date().toISOString(); wr(st); }
  return { actualizados: n };
}

// ── LIQUIDACIÓN ─────────────────────────────────────────────────────────────────────────────────────────
// El liquidador del motor de goles ya sabe resolver estas familias, incluidas devoluciones y cuartos de
// línea. Aquí solo hay que traer el marcador y traducir su veredicto a unidades.
const UNIDADES = { won: (o) => o - 1, lost: () => -1, push: () => 0, half_won: (o) => (o - 1) / 2, half_lost: () => -0.5, void: () => 0 };
function settle(deps = {}) {
  const { scoreFor, ahora = Date.now() } = deps;
  const st = rd();
  let liquidadas = 0, anuladas = 0;
  for (const p of Object.values(st.picks || {})) {
    if (p.status !== 'ACTIVE') continue;
    const ko = Date.parse(p.kickoff_at || 0);
    if (!ko || ahora - ko < 2.5 * 3600e3) continue;              // el partido tiene que haber terminado
    let sc = null;
    try { sc = typeof scoreFor === 'function' ? scoreFor(p) : null; } catch { sc = null; }
    if (!sc || sc.homeGoals == null || sc.awayGoals == null) {
      if (ahora - ko > 72 * 3600e3) { p.status = 'VOID'; p.result = 'void'; p.void_why = 'sin marcador a las 72 h'; p.settled_at = new Date().toISOString(); anuladas++; }
      continue;
    }
    const res = settlement.settle(p.market_id, { homeGoals: sc.homeGoals, awayGoals: sc.awayGoals });
    if (!res || res === 'unknown') { p.status = 'VOID'; p.result = 'unknown'; p.void_why = 'el liquidador no reconoce el mercado'; p.settled_at = new Date().toISOString(); anuladas++; continue; }
    p.result = res;
    p.units = r2((UNIDADES[res] || (() => 0))(p.odds));
    p.final_score = { home: sc.homeGoals, away: sc.awayGoals };
    p.status = 'SETTLED';
    p.settled_at = new Date().toISOString();
    liquidadas++;
  }
  if (liquidadas || anuladas) { st.at = new Date().toISOString(); wr(st); }
  return { liquidadas, anuladas };
}

// ── SEGUIMIENTO ─────────────────────────────────────────────────────────────────────────────────────────
const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length;
  return +Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)).toFixed(2); };

function agrega(list) {
  const cerradas = list.filter((p) => p.status === 'SETTLED');
  const u = cerradas.reduce((s, p) => s + (p.units || 0), 0);
  const clv = cerradas.map((p) => p.clv_pct).filter((x) => Number.isFinite(x));
  const g = cerradas.filter((p) => p.result === 'won' || p.result === 'half_won').length;
  return {
    n: cerradas.length, w: g, l: cerradas.filter((p) => p.result === 'lost' || p.result === 'half_lost').length,
    push: cerradas.filter((p) => p.result === 'push').length,
    units: r2(u), roi_pct: cerradas.length ? r2(100 * u / cerradas.length) : null,
    hit_pct: cerradas.length ? r2(100 * g / cerradas.length) : null,
    clv_avg_pct: clv.length ? r2(clv.reduce((a, b) => a + b, 0) / clv.length) : null,
    clv_n: clv.length, clv_sd: sd(clv),
  };
}

function track() {
  const st = rd();
  const all = Object.values(st.picks || {});
  const byFam = {};
  for (const p of all) (byFam[p.family] = byFam[p.family] || []).push(p);
  return {
    rule: RULE,
    total: all.length,
    active: all.filter((p) => p.status === 'ACTIVE').length,
    voided: all.filter((p) => p.status === 'VOID').length,
    overall: agrega(all),
    by_family: Object.fromEntries(Object.entries(byFam).map(([k, v]) => [k, agrega(v)])),
    recent: all.filter((p) => p.status === 'SETTLED').sort((a, b) => String(b.settled_at).localeCompare(String(a.settled_at))).slice(0, 40),
    open: all.filter((p) => p.status === 'ACTIVE').sort((a, b) => String(a.kickoff_at).localeCompare(String(b.kickoff_at))).slice(0, 40),
    at: st.at || null,
    doctrina: 'Familias nuevas EN SOMBRA: se anotan y se liquidan solas, no publican picks y no tocan el feed. Salen de la misma matriz de marcador del motor de goles, así que no hay estructura nueva sin medir; lo que falta es muestra. El tablero de familias las juzga con la misma vara que a todas.',
  };
}

module.exports = { RULE, record, closes, settle, track, contrario };
