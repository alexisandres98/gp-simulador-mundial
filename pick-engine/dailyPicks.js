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

  // Casas por evento en UNA pasada agrupada (antes: subquery correlacionado por fila sobre sportsbook_goal_quote_current,
  // que al crecer la tabla a ~400K filas causó statement timeout y dejó mudo el motor de picks del 1 al 5 de julio).
  // Dos mapas porque el conteo original es distinct por familia match_winner y distinct global (no equivalen a una suma).
  const booksMW = {}, booksAll = {};
  for (const b of (await query(
    `SELECT canonical_event_id, count(distinct sportsbook_code)::int books
     FROM sportsbook_goal_quote_current WHERE market_family='match_winner' GROUP BY 1`)).rows) booksMW[b.canonical_event_id] = b.books;
  for (const b of (await query(
    `SELECT canonical_event_id, count(distinct sportsbook_code)::int books
     FROM sportsbook_goal_quote_current GROUP BY 1`)).rows) booksAll[b.canonical_event_id] = b.books;

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
  // Equipos+kickoff del lineage. Solo se añaden eventos que NO vinieron ya de value_evaluations (canónicos primero),
  // ni por id NI por PAR DE EQUIPOS: desde que el mismo partido existe bajo id canónico Y sintético (canónicos
  // aprobados 4-jul + pipeline de goles sintético), sin el dedupe por par se publicaban picks DUPLICADAS del
  // mismo partido (una clickeable y una no).
  const pairKey = (a, b) => [a, b].sort().join('~');
  const rowsMW = (await query(
    `SELECT DISTINCT ON (gv.canonical_event_id, gv.market_id)
       gv.canonical_event_id, gv.market_id, gv.gp_probability::float gp, gv.market_consensus_probability::float mkt,
       gv.best_decimal_odds::float odds, s.factor_lineage
     FROM goal_value_shadow gv
     LEFT JOIN LATERAL (SELECT factor_lineage FROM goal_model_snapshots g WHERE g.canonical_event_id=gv.canonical_event_id ORDER BY created_at DESC LIMIT 1) s ON true
     WHERE gv.market_family='match_winner' AND gv.gp_probability > 0 AND gv.gp_probability < 1 AND gv.created_at > now() - interval '2 days'
     ORDER BY gv.canonical_event_id, gv.market_id, gv.created_at DESC`)).rows;
  const canonicalIds = new Set(Object.keys(evMap)); // eventos que ya vinieron de value_evaluations
  const canonicalPairs = new Set(Object.values(evMap).filter(e => e.homeId && e.awayId).map(e => pairKey(e.homeId, e.awayId)));
  for (const r of rowsMW) {
    if (canonicalIds.has(r.canonical_event_id)) continue; // ya canónico → no duplicar (3 filas MW comparten evento)
    const m = /^MATCH_WINNER_(HOME|DRAW|AWAY)$/.exec(r.market_id); if (!m) continue;
    const sel = m[1].toLowerCase();
    const lin = (Array.isArray(r.factor_lineage) ? r.factor_lineage[0] : null) || {};
    const homeId = lin.home_team_id || null, awayId = lin.away_team_id || null, kickoff = lin.kickoff_at || null;
    if (!homeId || !awayId || !kickoff || new Date(kickoff).getTime() <= nowMs) continue;
    if (canonicalPairs.has(pairKey(homeId, awayId))) continue; // mismo partido ya canónico → no duplicar
    const e = evMap[r.canonical_event_id] || (evMap[r.canonical_event_id] = {
      eventId: r.canonical_event_id, home: teamNameById(homeId), away: teamNameById(awayId),
      homeId, awayId, kickoff, selections: {},
    });
    e.selections[sel] = { model: r.gp, market: r.mkt, bestOdds: r.odds, books: Number(booksMW[r.canonical_event_id] || 0) };
  }
  const events = Object.values(evMap);

  // Goles: value reciente. Los eventos de goles usan ids SINTÉTICOS (desacoplados de canonical_events), así que los
  // equipos + kickoff salen del factor_lineage del snapshot (igual que evaluateGoalPicks), NO de un JOIN canónico
  // (que perdería el 99% de los próximos). Filtro prepartido en JS por el kickoff del lineage.
  const rowsGoals = (await query(
    `SELECT DISTINCT ON (gv.canonical_event_id, gv.market_id)
       gv.canonical_event_id, gv.market_id, gv.market_family, gv.gp_probability::float gp,
       gv.market_consensus_probability::float mkt, gv.adjusted_edge_pp::float edge, gv.best_decimal_odds::float odds,
       s.factor_lineage
     FROM goal_value_shadow gv
     LEFT JOIN LATERAL (SELECT factor_lineage FROM goal_model_snapshots g WHERE g.canonical_event_id=gv.canonical_event_id ORDER BY created_at DESC LIMIT 1) s ON true
     WHERE gv.created_at > now() - interval '2 days'
     ORDER BY gv.canonical_event_id, gv.market_id, gv.created_at DESC`)).rows;

  let goalMarkets = [];
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
      books: Number(booksAll[g.canonical_event_id] || 0), familyApproved: !!GOAL_FAMILY_APPROVED[g.market_family],
    });
  }
  // Dedupe por PAR DE EQUIPOS: si el mismo partido tiene mercados de goles bajo id canónico Y sintético,
  // se queda el canónico (clickeable, abre cockpit) y se descartan los sintéticos duplicados.
  const goalCanonPairs = new Set(goalMarkets.filter(g => canonicalIds.has(g.eventId)).map(g => pairKey(g.homeId, g.awayId)));
  goalMarkets = goalMarkets.filter(g => canonicalIds.has(g.eventId) || !goalCanonPairs.has(pairKey(g.homeId, g.awayId)));

  // ── PROPS de EQUIPO (córners/tarjetas) + PROPS de JUGADOR ─────────────────────────────────────────────────
  // Estos value rows viven SIEMPRE bajo eventos CANÓNICOS (la ingesta de props solo corre para canónicos,
  // que ahora se auto-aprueban) → join directo a canonical_events para equipos/kickoff.
  const rowsPropsAll = (await query(
    `SELECT DISTINCT ON (gv.canonical_event_id, gv.market_id)
       gv.canonical_event_id, gv.market_id, gv.market_family, gv.gp_probability::float gp,
       gv.market_consensus_probability::float mkt, gv.adjusted_edge_pp::float edge, gv.best_decimal_odds::float odds,
       ce.home_participant, ce.away_participant, ce.scheduled_start
     FROM goal_value_shadow gv JOIN canonical_events ce ON ce.id=gv.canonical_event_id
     WHERE gv.market_family IN ('corners_total','cards_total','player_goal','player_shots','player_sot')
       AND ce.scheduled_start > now() AND gv.created_at > now() - interval '36 hours'
       AND gv.gp_probability > 0 AND gv.gp_probability < 1
     ORDER BY gv.canonical_event_id, gv.market_id, gv.created_at DESC`)).rows;
  // casas por (evento, familia) y por (evento, familia, jugador) en una pasada agrupada
  const booksProp = {}, booksPlayer = {};
  for (const b of (await query(
    `SELECT canonical_event_id, market_family, team_scope, count(distinct sportsbook_code)::int books
     FROM sportsbook_goal_quote_current
     WHERE market_family IN ('corners_total','cards_total','player_goal','player_shots','player_sot')
     GROUP BY 1,2,3`)).rows) {
    if (/^player_/.test(b.market_family)) booksPlayer[b.canonical_event_id + '|' + b.market_family + '|' + (b.team_scope || '')] = b.books;
    else booksProp[b.canonical_event_id + '|' + b.market_family] = (booksProp[b.canonical_event_id + '|' + b.market_family] || 0) + b.books;
  }
  // roster (pid → nombre/equipo) para las labels de jugador
  let ROSTER = {};
  try {
    const hist = require('../data/player-props-history.json');
    for (const m of hist.matches) for (const p of m.players) ROSTER[p.pid] = { name: p.name, team: p.team };
  } catch { /* sin dataset → picks de jugador sin nombre no se publican */ }
  const PROP_FAMILY_APPROVED = { corners_total: true, cards_total: true }; // gates del backtest LOO del prop-engine
  const availability = deps.playerAvailability || {}; // pid → { status, prob_miss, corroborated } (capa de observación)
  const starters = deps.projectedStarters || null;     // Set<pid> del once probable (server); null = sin proyección
  const confirmedXi = deps.confirmedXi || null;        // pairKey → Set<pid> del once CONFIRMADO (alineación oficial)

  const propMarkets = [], playerMarkets = [];
  for (const g of rowsPropsAll) {
    const base = {
      eventId: g.canonical_event_id, home: g.home_participant, away: g.away_participant, kickoff: g.scheduled_start,
      homeId: teamId(g.home_participant), awayId: teamId(g.away_participant),
    };
    if (!base.kickoff || new Date(base.kickoff).getTime() <= nowMs) continue;
    if (g.market_family === 'corners_total' || g.market_family === 'cards_total') {
      const pm = /^(CORNERS|CARDS)_(OVER|UNDER)_(\d+)_(\d+)$/.exec(g.market_id); if (!pm) continue;
      propMarkets.push({
        ...base, family: g.market_family, marketId: g.market_id, side: pm[2].toLowerCase(), line: Number(pm[3]) + Number(pm[4]) / 10,
        modelProb: g.gp, marketProb: g.mkt, edgePp: g.edge, bestOdds: g.odds, bestBook: null,
        books: Number(booksProp[g.canonical_event_id + '|' + g.market_family] || 0),
        familyApproved: !!PROP_FAMILY_APPROVED[g.market_family],
      });
    } else {
      // market_id de jugador: PLAYER_GOAL_<pid> | PLAYER_SHOTS_<pid>_2_5 | PLAYER_SOT_<pid>_1_5
      const mm = /^PLAYER_(GOAL|SHOTS|SOT)_(pl_[A-Za-z0-9]+)(?:_(\d+)_(\d+))?$/.exec(g.market_id); if (!mm) continue;
      const pid = mm[2], meta = ROSTER[pid]; if (!meta) continue;
      // Disponibilidad del observer: objeto { status, prob_miss, corroborated } (compat con string legado).
      // OUT/SUSPENDED SIN corroborar (1 sola fuente) degrada a DOUBT: un titular suelto no tumba una pick,
      // pero sí la frena si la duda es sustancial (gate en curate).
      const avRaw = availability[pid] || null;
      const av = typeof avRaw === 'string' ? { status: avRaw, prob_miss: 0.5, corroborated: true } : avRaw;
      const avRisk = !av ? null : ((av.status === 'OUT' || av.status === 'SUSPENDED') && av.corroborated === false) ? 'DOUBT' : av.status;
      // Once CONFIRMADO por alineación oficial (si ya salió) pisa a la proyección histórica.
      const cxi = confirmedXi ? confirmedXi[pairKey(base.homeId, base.awayId)] : null;
      playerMarkets.push({
        ...base, family: g.market_family, marketId: g.market_id, player: meta.name, pid,
        side: mm[1] === 'GOAL' ? 'yes' : 'over', line: mm[3] != null ? Number(mm[3]) + Number(mm[4]) / 10 : null,
        modelProb: g.gp, impliedMedian: g.mkt, bestOdds: g.odds, bestBook: null,
        books: Number(booksPlayer[g.canonical_event_id + '|' + g.market_family + '|' + pid] || 0),
        availabilityRisk: avRisk, availabilityMiss: av ? Number(av.prob_miss) || 0 : 0,
        isStarter: cxi ? cxi.has(pid) : (starters ? starters.has(pid) : null),
      });
    }
  }

  const res = curate({ events, goalMarkets, propMarkets, playerMarkets, config });

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
  // PROPS de equipo: la mejor por (evento, familia) — CORNERS y CARDS por separado.
  const propById = {}; propMarkets.forEach(g => { propById[g.eventId + '|' + g.marketId] = g; });
  const bestPropByEF = {};
  for (const g of res.eligible.props) {
    const k = g.eventId + '|' + g.family;
    if (!bestPropByEF[k] || g.edgePp > bestPropByEF[k].edgePp) bestPropByEF[k] = g;
  }
  for (const g of Object.values(bestPropByEF)) {
    const gm = propById[g.eventId + '|' + g.marketId] || {};
    picks.push(record(g.family, g.eventId, {
      home: g.home, away: g.away, homeId: gm.homeId, awayId: gm.awayId, kickoff: g.kickoff,
      is_canonical: true,
      market_id: g.marketId, side: g.side, line: g.line,
      best_odds: g.bestOdds, best_book: g.bestBook, books: g.books,
      model_prob: g.modelProb, market_prob: g.marketProb, confidence: g.confidence, edge_pp: g.edgePp,
    }, g.eventId + '|' + g.marketId));
  }
  // PROPS de jugador: la más PROBABLE por evento (blend modelo/mercado; mercado eficiente → no se caza edge).
  const playerById = {}; playerMarkets.forEach(g => { playerById[g.eventId + '|' + g.marketId] = g; });
  const bestPlayerByEvent = {};
  for (const g of res.eligible.player) {
    const cur = bestPlayerByEvent[g.eventId];
    if (!cur || g.confidence > cur.confidence || (g.confidence === cur.confidence && g.bestOdds > cur.bestOdds)) bestPlayerByEvent[g.eventId] = g;
  }
  for (const g of Object.values(bestPlayerByEvent)) {
    const gm = playerById[g.eventId + '|' + g.marketId] || {};
    picks.push(record('PLAYER', g.eventId, {
      home: g.home, away: g.away, homeId: gm.homeId, awayId: gm.awayId, kickoff: g.kickoff,
      is_canonical: true,
      market_id: g.marketId, side: g.side, line: g.line,
      player_name: g.player, pid: g.pid, player_family: g.playerFamily, availability_risk: g.availabilityRisk,
      best_odds: g.bestOdds, best_book: g.bestBook, books: g.books,
      model_prob: g.modelProb, market_prob: g.marketProb, confidence: g.confidence, edge_pp: g.edgePp,
    }, g.eventId + '|' + g.marketId));
  }

  return { picks, counts: res.counts, considered: { events: events.length, goalMarkets: goalMarkets.length, propMarkets: propMarkets.length, playerMarkets: playerMarkets.length } };
}

function record(family, eventId, fields, key) {
  return {
    pick_id: stableId('dp', key),
    family,
    event: { canonical_event_id: eventId, is_canonical: !!fields.is_canonical, home: fields.home, away: fields.away, home_team_id: fields.homeId, away_team_id: fields.awayId, kickoff_at: fields.kickoff },
    selection_code: fields.selection_code || null,
    market_id: fields.market_id || null, side: fields.side || null, line: (fields.line != null ? fields.line : null),
    player_name: fields.player_name || null, pid: fields.pid || null, player_family: fields.player_family || null,
    availability_risk: fields.availability_risk || null,
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
    // Cada pata gana/pierde/empuja; se decide al FINAL. Un push de la pata de goles NO puede enmascarar una
    // pata 1X2 perdedora (bug: el return 'PUSH' cortaba el loop antes de mirar el 1X2 → inflaba el track
    // record reembolsando combos que debían perder). Regla de casa: si alguna pata pierde → LOSS; si ninguna
    // pierde pero hay push → PUSH (la pata push se elimina, el combo se liquida por las restantes); todas ganan → WIN.
    let allWin = true, anyPush = false;
    for (const leg of (pick.legs || [])) {
      if (leg.type === '1X2') { const actual = hg > ag ? 'home' : hg === ag ? 'draw' : 'away'; if (leg.selection !== actual) allWin = false; }
      else if (leg.type === 'GOALS') { if (total === leg.line) { anyPush = true; } else { const over = total > leg.line; if (!(leg.side === 'over' ? over : !over)) allWin = false; } }
    }
    return !allWin ? 'LOSS' : anyPush ? 'PUSH' : 'WIN';
  }
  return 'PENDING';
}

module.exports = { buildDailyPicks, settleOne, teamId, GOAL_FAMILY_APPROVED };
