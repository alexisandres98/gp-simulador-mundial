// pick-engine/dailyPicks.js — Capa de PRODUCTO de picks diarias (visión "tipster mejorado").
// Envuelve pick-engine/curate (selección pura, validada 12/13 en backtest) y le añade: lectura de datos en vivo
// (value_evaluations 1X2 + goal_value_shadow goles), estructura de registro persistible, y liquidación por marcador.
// AUTO-PUBLICACIÓN: no hay aprobación manual; lo que pasa el gate se publica. FEED EFÍMERO: el usuario solo ve las
// picks ACTIVE (prepartido / del día); al liquidarse pasan a SETTLED y desaparecen de su feed (el track record
// completo queda solo para admin). Gated en server.js por GP_DAILY_PICKS_ENABLED (default OFF).
'use strict';
const crypto = require('crypto');
const { curate } = require('./curate');
const { TEAMS } = require('../data/tournament');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const ALIAS_TO_ID = {}, ID_TO_NAME = {};
TEAMS.forEach(t => { [t.en, t.name, t.id, ...(t.aliases || [])].filter(Boolean).forEach(a => { ALIAS_TO_ID[norm(a)] = t.id; }); ID_TO_NAME[t.id] = t.name || t.en || t.id; });
function teamId(name) { return ALIAS_TO_ID[norm(name)] || null; }
function teamNameById(id) { return ID_TO_NAME[id] || id; }

function parseGoalMid(mid) {
  const m = /^TOTAL_GOALS_(OVER|UNDER)_(\d+)_(\d+)$/.exec(String(mid || ''));
  if (!m) return null;
  return { side: m[1].toLowerCase(), line: Number(m[2]) + Number(m[3]) / 10 };
}
// Familias de goles aprobadas en calibración (G4). Hoy en DB solo fluye match_total.
const GOAL_FAMILY_APPROVED = { match_total: true, team_total: true, winning_margin: true, btts: false };

const stableId = (prefix, key) => prefix + '_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

// ── Construye las picks diarias ACTIVE (prepartido) a partir de datos en vivo. ───────────────────────────────
// deps.query: fn(sql, params) -> { rows }.  deps.now: ms.  Devuelve { picks:[...], counts, considered }.
async function buildDailyPicks(deps) {
  const query = deps.query, nowMs = deps.now || Date.now();
  const config = deps.config || {};

  // 1X2: evaluación MÁS FRESCA por (evento, selección) de eventos PRÓXIMOS. Se usa la última (created_at DESC), no la
  // de mayor edge (que puede ser un outlier viejo/stale). Se descartan evals corruptas (gp fuera de (0,1), p.ej. gp=0%
  // del favorito) que romperían la coherencia de dirección.
  const rows1x2 = (await query(
    `SELECT DISTINCT ON (v.canonical_event_id, v.selection)
       v.canonical_event_id, v.selection, v.gp_probability::float gp, v.sportsbook_consensus_probability::float mkt,
       v.best_decimal_odds::float odds, v.independence_group_count::int books,
       ce.home_participant, ce.away_participant, ce.scheduled_start
     FROM value_evaluations v JOIN canonical_events ce ON ce.id=v.canonical_event_id
     WHERE ce.scheduled_start > now() AND v.created_at > now() - interval '2 days'
       AND v.gp_probability > 0 AND v.gp_probability < 1
     ORDER BY v.canonical_event_id, v.selection, v.created_at DESC`)).rows;

  const evMap = {};
  for (const r of rows1x2) {
    const e = evMap[r.canonical_event_id] || (evMap[r.canonical_event_id] = {
      eventId: r.canonical_event_id, home: r.home_participant, away: r.away_participant,
      homeId: teamId(r.home_participant), awayId: teamId(r.away_participant),
      kickoff: r.scheduled_start, selections: {},
    });
    e.selections[r.selection] = { model: r.gp, market: r.mkt, bestOdds: r.odds, books: r.books };
  }

  // SÓLIDAS también desde match_winner (1X2) de eventos NO canónicos (ids sintéticos, vía persistMatchWinnerValue).
  // Equipos+kickoff del lineage. Solo se añaden eventos que NO vinieron ya de value_evaluations (canónicos primero).
  const rowsMW = (await query(
    `SELECT DISTINCT ON (gv.canonical_event_id, gv.market_id)
       gv.canonical_event_id, gv.market_id, gv.gp_probability::float gp, gv.market_consensus_probability::float mkt,
       gv.best_decimal_odds::float odds, s.factor_lineage,
       (SELECT count(distinct sportsbook_code)::int FROM sportsbook_goal_quote_current q WHERE q.canonical_event_id=gv.canonical_event_id AND q.market_family='match_winner') books
     FROM goal_value_shadow gv
     LEFT JOIN LATERAL (SELECT factor_lineage FROM goal_model_snapshots g WHERE g.canonical_event_id=gv.canonical_event_id ORDER BY created_at DESC LIMIT 1) s ON true
     WHERE gv.market_family='match_winner' AND gv.gp_probability > 0 AND gv.gp_probability < 1 AND gv.created_at > now() - interval '2 days'
     ORDER BY gv.canonical_event_id, gv.market_id, gv.created_at DESC`)).rows;
  const canonicalIds = new Set(Object.keys(evMap)); // eventos que ya vinieron de value_evaluations
  for (const r of rowsMW) {
    if (canonicalIds.has(r.canonical_event_id)) continue; // ya canónico → no duplicar (3 filas MW comparten evento)
    const m = /^MATCH_WINNER_(HOME|DRAW|AWAY)$/.exec(r.market_id); if (!m) continue;
    const sel = m[1].toLowerCase();
    const lin = (Array.isArray(r.factor_lineage) ? r.factor_lineage[0] : null) || {};
    const homeId = lin.home_team_id || null, awayId = lin.away_team_id || null, kickoff = lin.kickoff_at || null;
    if (!homeId || !awayId || !kickoff || new Date(kickoff).getTime() <= nowMs) continue;
    const e = evMap[r.canonical_event_id] || (evMap[r.canonical_event_id] = {
      eventId: r.canonical_event_id, home: teamNameById(homeId), away: teamNameById(awayId),
      homeId, awayId, kickoff, selections: {},
    });
    e.selections[sel] = { model: r.gp, market: r.mkt, bestOdds: r.odds, books: Number(r.books || 0) };
  }
  const events = Object.values(evMap);

  // Goles: value reciente. Los eventos de goles usan ids SINTÉTICOS (desacoplados de canonical_events), así que los
  // equipos + kickoff salen del factor_lineage del snapshot (igual que evaluateGoalPicks), NO de un JOIN canónico
  // (que perdería el 99% de los próximos). Filtro prepartido en JS por el kickoff del lineage.
  const rowsGoals = (await query(
    `SELECT DISTINCT ON (gv.canonical_event_id, gv.market_id)
       gv.canonical_event_id, gv.market_id, gv.market_family, gv.gp_probability::float gp,
       gv.market_consensus_probability::float mkt, gv.adjusted_edge_pp::float edge, gv.best_decimal_odds::float odds,
       s.factor_lineage,
       (SELECT count(distinct sportsbook_code)::int FROM sportsbook_goal_quote_current q WHERE q.canonical_event_id=gv.canonical_event_id) books
     FROM goal_value_shadow gv
     LEFT JOIN LATERAL (SELECT factor_lineage FROM goal_model_snapshots g WHERE g.canonical_event_id=gv.canonical_event_id ORDER BY created_at DESC LIMIT 1) s ON true
     WHERE gv.created_at > now() - interval '2 days'
     ORDER BY gv.canonical_event_id, gv.market_id, gv.created_at DESC`)).rows;

  const goalMarkets = [];
  for (const g of rowsGoals) {
    const p = parseGoalMid(g.market_id);
    if (!p) continue;
    const lin = (Array.isArray(g.factor_lineage) ? g.factor_lineage[0] : null) || {};
    const homeId = lin.home_team_id || null, awayId = lin.away_team_id || null, kickoff = lin.kickoff_at || null;
    if (!homeId || !awayId) continue;                                  // sin equipos no se puede mostrar/liquidar
    if (!kickoff || new Date(kickoff).getTime() <= nowMs) continue;    // solo prepartido
    goalMarkets.push({
      eventId: g.canonical_event_id, home: teamNameById(homeId), away: teamNameById(awayId), kickoff,
      homeId, awayId,
      marketId: g.market_id, family: g.market_family, side: p.side, line: p.line,
      modelProb: g.gp, marketProb: g.mkt, edgePp: g.edge, bestOdds: g.odds, bestBook: null,
      books: Number(g.books || 0), familyApproved: !!GOAL_FAMILY_APPROVED[g.market_family],
    });
  }

  const res = curate({ events, goalMarkets, config });

  // Aplana a registros persistibles (solo ELEGIBLES; prepartido garantizado por el filtro SQL).
  const picks = [];
  const evById = {}; events.forEach(e => { evById[e.eventId] = e; });
  const goalById = {}; goalMarkets.forEach(g => { goalById[g.eventId + '|' + g.marketId] = g; });

  for (const s of res.eligible.solid) {
    const ev = evById[s.eventId] || {};
    picks.push(record('SOLID', s.eventId, {
      home: s.home, away: s.away, homeId: ev.homeId, awayId: ev.awayId, kickoff: s.kickoff,
      is_canonical: canonicalIds.has(s.eventId),     // solo canónicos abren cockpit → clickeable
      selection_code: s.selection,                   // 'home' | 'away' (neutral; i18n en cliente)
      best_odds: s.bestOdds, best_book: s.bestBook, books: s.books,
      model_prob: s.modelProb, market_prob: s.marketProb, confidence: s.confidence,
    }, s.eventId + '|SOLID|' + s.selection));
  }
  // Una pick de GOLES por partido (la de mayor edge; desempate por confianza) → feed limpio, sin líneas redundantes.
  const bestGoalByEvent = {};
  for (const g of res.eligible.goals) {
    const cur = bestGoalByEvent[g.eventId];
    if (!cur || g.edgePp > cur.edgePp || (g.edgePp === cur.edgePp && g.confidence > cur.confidence)) bestGoalByEvent[g.eventId] = g;
  }
  for (const g of Object.values(bestGoalByEvent)) {
    const gm = goalById[g.eventId + '|' + g.marketId] || {};
    picks.push(record('GOALS', g.eventId, {
      home: g.home, away: g.away, homeId: gm.homeId, awayId: gm.awayId, kickoff: g.kickoff,
      is_canonical: canonicalIds.has(g.eventId),
      market_id: g.marketId, side: g.side, line: g.line,
      best_odds: g.bestOdds, best_book: g.bestBook, books: g.books,
      model_prob: g.modelProb, market_prob: g.marketProb, confidence: g.confidence, edge_pp: g.edgePp,
    }, g.eventId + '|' + g.marketId));
  }
  for (const c of res.eligible.combo) {
    const ev = evById[c.eventId] || {};
    picks.push(record('COMBO', c.eventId, {
      home: c.home, away: c.away, homeId: ev.homeId, awayId: ev.awayId, kickoff: c.kickoff,
      is_canonical: canonicalIds.has(c.eventId),
      legs: c.legs, best_odds: c.comboOdds, confidence: c.confidence,
    }, c.eventId + '|COMBO|' + c.legs.map(l => l.selection || (l.side + l.line)).join('+')));
  }

  return { picks, counts: res.counts, considered: { events: events.length, goalMarkets: goalMarkets.length } };
}

function record(family, eventId, fields, key) {
  return {
    pick_id: stableId('dp', key),
    family,
    event: { canonical_event_id: eventId, is_canonical: !!fields.is_canonical, home: fields.home, away: fields.away, home_team_id: fields.homeId, away_team_id: fields.awayId, kickoff_at: fields.kickoff },
    selection_code: fields.selection_code || null,
    market_id: fields.market_id || null, side: fields.side || null, line: (fields.line != null ? fields.line : null),
    legs: fields.legs || null,
    best_odds: fields.best_odds || null, best_book: fields.best_book || null, books: fields.books || null,
    model_prob: fields.model_prob != null ? fields.model_prob : null,
    market_prob: fields.market_prob != null ? fields.market_prob : null,
    confidence: fields.confidence != null ? fields.confidence : null,
    edge_pp: fields.edge_pp != null ? fields.edge_pp : null,
    status: 'ACTIVE', result_code: 'PENDING', settlement_code: null, clv: null,
    created_at: new Date().toISOString(), settled_at: null,
  };
}

// ── Liquidación ─────────────────────────────────────────────────────────────────────────────────────────────
// score: { homeGoals, awayGoals } en 90' reglamentario (orientado al home del pick). Devuelve result_code.
function settleOne(pick, score) {
  const hg = score.homeGoals, ag = score.awayGoals, total = hg + ag;
  if (pick.family === 'SOLID') {
    const actual = hg > ag ? 'home' : hg === ag ? 'draw' : 'away';
    return pick.selection_code === actual ? 'WIN' : 'LOSS';
  }
  if (pick.family === 'GOALS') {
    if (total === pick.line) return 'PUSH';
    const over = total > pick.line;
    return (pick.side === 'over' ? over : !over) ? 'WIN' : 'LOSS';
  }
  if (pick.family === 'COMBO') {
    let allWin = true;
    for (const leg of (pick.legs || [])) {
      if (leg.type === '1X2') { const actual = hg > ag ? 'home' : hg === ag ? 'draw' : 'away'; if (leg.selection !== actual) allWin = false; }
      else if (leg.type === 'GOALS') { if (total === leg.line) return 'PUSH'; const over = total > leg.line; if (!(leg.side === 'over' ? over : !over)) allWin = false; }
    }
    return allWin ? 'WIN' : 'LOSS';
  }
  return 'PENDING';
}

module.exports = { buildDailyPicks, settleOne, teamId, GOAL_FAMILY_APPROVED };
