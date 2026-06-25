// sportsbook-providers/normalizer.js — Sprint 8A §7,§10. Arma sets 1X2 (home/draw/away) por casa desde la
// respuesta cruda del proveedor y aplica la VALIDACIÓN del §10. Rechaza incompletos/live/suspended/stale/
// invertidos/prórroga/"to qualify"/kickoff incierto. Reutiliza la normalización de cuotas de Sprint 7.
'use strict';
const cfg = require('./config');
const { toDecimal } = require('../value-engine/oddsNormalization');

// implied prob cruda desde decimal (1/odds). Sin de-vig aquí (eso es del Value Engine).
function impliedProb(decimal) { return decimal > 1 ? +(1 / decimal).toFixed(8) : null; }

// mapea un outcome del proveedor a home|draw|away según los nombres del evento.
function classifyOutcome(name, home, away) {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'draw' || n === 'tie' || n === 'empate') return 'draw';
  if (home && n === String(home).trim().toLowerCase()) return 'home';
  if (away && n === String(away).trim().toLowerCase()) return 'away';
  return null;
}

// resuelve operator/independence group desde el catálogo (skins del mismo operador NO son independientes).
function resolveSource(sportsbookCode, catalog) {
  const meta = catalog && catalog[sportsbookCode];
  return {
    operator_group: (meta && meta.operator_group) || sportsbookCode,
    // sin metadata explícita, cada casa es su propio grupo (conservador: no asume independencia falsa)
    independence_group: (meta && meta.independence_group) || sportsbookCode,
    sportsbook_name: (meta && meta.sportsbook_name) || null,
    source_role: (meta && meta.source_role) || 'market_consensus',
    jurisdiction: (meta && meta.jurisdiction) || null,
  };
}

// buildSetsForEvent(event, { catalog, now, dataProvider }) → { sets:[...], rejected:[...] }
// Cada set válido: { sportsbook_code, ...source, outcomes:{home,draw,away}, market_family:'1x2', period, last_update }
function buildSetsForEvent(event, { catalog = {}, now = null, dataProvider = 'the_odds_api' } = {}) {
  const P = cfg.params;
  const nowMs = now != null ? +new Date(now) : Date.now();
  const sets = [], rejected = [];
  if (!event || !event.id) return { sets, rejected: [{ reason: 'invalid_event' }] };

  // kickoff: prematch real → debe estar en el futuro (con buffer). Sin commence_time → incierto → rechazo.
  const commenceMs = event.commence_time ? +new Date(event.commence_time) : NaN;
  if (!Number.isFinite(commenceMs)) return { sets, rejected: [{ event: event.id, reason: 'kickoff_unknown' }] };
  if (commenceMs <= nowMs + P.eventStartBufferMs) return { sets, rejected: [{ event: event.id, reason: 'event_started_or_imminent' }] };

  for (const bk of (event.bookmakers || [])) {
    const code = bk && bk.key;
    if (!code) { rejected.push({ event: event.id, reason: 'no_book_key' }); continue; }
    const market = (bk.markets || []).find(m => m.key === 'h2h');
    if (!market) { rejected.push({ event: event.id, book: code, reason: 'no_h2h_market' }); continue; }
    // frescura de la cuota (§10): last_update no debe ser stale
    const luMs = (market.last_update || bk.last_update) ? +new Date(market.last_update || bk.last_update) : nowMs;
    if (Number.isFinite(luMs) && (nowMs - luMs) > P.maxQuoteAgeMs) { rejected.push({ event: event.id, book: code, reason: 'quote_stale' }); continue; }

    const o = { home: null, draw: null, away: null };
    let bad = false;
    for (const out of (market.outcomes || [])) {
      const slot = classifyOutcome(out.name, event.home_team, event.away_team);
      if (!slot) { bad = true; break; }                       // outcome no reconocido → set inválido
      const dec = toDecimal(out.price, 'decimal');
      if (!(dec > 1)) { bad = true; break; }                  // cuota inválida
      if (o[slot]) { bad = true; break; }                     // duplicado (p.ej. home/away invertido se detecta como duplicado)
      o[slot] = { external_outcome_id: `${code}:${event.id}:${slot}`, odds_decimal: dec, implied_probability: impliedProb(dec), name: out.name };
    }
    if (bad) { rejected.push({ event: event.id, book: code, reason: 'invalid_outcomes' }); continue; }
    if (!o.home || !o.draw || !o.away) { rejected.push({ event: event.id, book: code, reason: 'incomplete_1x2' }); continue; } // draw ausente → rechazo

    const src = resolveSource(code, catalog);
    sets.push({
      data_provider: dataProvider, sportsbook_code: code, ...src,
      external_event_id: event.id, market_family: '1x2', period: 'regulation', is_live: false,
      last_update: Number.isFinite(luMs) ? new Date(luMs).toISOString() : null,
      commence_time: event.commence_time, home_team: event.home_team, away_team: event.away_team,
      competition: event.sport_title || event.competition || null,
      outcomes: o,
    });
  }
  return { sets, rejected };
}

// aplana sets → filas de quote (una por outcome) listas para persistir en sportsbook_quotes.
function setsToQuoteRows(sets, ingestionRunId) {
  const rows = [];
  for (const s of sets) {
    for (const slot of ['home', 'draw', 'away']) {
      const oc = s.outcomes[slot];
      rows.push({
        data_provider: s.data_provider, sportsbook_code: s.sportsbook_code, sportsbook_name: s.sportsbook_name,
        operator_group: s.operator_group, independence_group: s.independence_group, source_role: s.source_role,
        jurisdiction: s.jurisdiction, external_event_id: s.external_event_id, external_market_id: `${s.sportsbook_code}:${s.external_event_id}:1x2`,
        external_outcome_id: oc.external_outcome_id, market_family: s.market_family, period: s.period, is_live: false,
        odds_format: 'decimal', odds_decimal: oc.odds_decimal, implied_probability: oc.implied_probability, raw_implied_probability: oc.implied_probability,
        quote_status: 'open', quote_timestamp: s.last_update, stake_limit_status: 'unknown', maximum_stake: null,
        normalizer_version: cfg.NORMALIZER_VERSION, ingestion_run_id: ingestionRunId,
        metadata: { outcome_slot: slot, outcome_name: oc.name, commence_time: s.commence_time,
                    home_team: s.home_team, away_team: s.away_team, competition: s.competition },
      });
    }
  }
  return rows;
}

module.exports = { buildSetsForEvent, setsToQuoteRows, classifyOutcome, impliedProb, resolveSource };
