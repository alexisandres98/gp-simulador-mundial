// canonical-graph/taxonomy.js — taxonomía canónica (Sprint 2). Extensible: usa constantes + metadata,
// no enums rígidos en la lógica. Clasificación determinística desde título + reglas normalizadas.

'use strict';
const TAXONOMY_VERSION = 'taxonomy-1';

const EVENT_TYPE = ['sports_match', 'sports_tournament', 'sports_stage', 'election', 'price_event', 'economic_event', 'entertainment_event', 'other'];
const EVENT_SCOPE = ['match', 'tournament', 'stage', 'team', 'player', 'season'];
const MARKET_FAMILY = ['match_winner', 'match_1x2', 'qualify', 'tournament_winner', 'binary_event', 'total', 'btts', 'handicap', 'other'];
const PERIOD = ['regulation_90m', 'full_match_including_extra_time', 'first_half', 'second_half', 'tournament', 'season', 'unspecified'];
const OUTCOME_TYPE = ['home', 'draw', 'away', 'yes', 'no', 'team', 'participant', 'over', 'under', 'other'];
// modificadores de settlement (claves; los valores viven en normalized_rules + metadata)
const SETTLEMENT_MODIFIERS = ['includes_extra_time', 'includes_penalties', 'draw_possible', 'qualification_market', 'dead_heat_rule', 'void_if_postponed', 'void_if_abandoned', 'postponement_window', 'reschedule_policy', 'resolution_source', 'resolution_deadline'];

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// classifyMarketFamily(title, rules?) → family. Conservador: ante señales mixtas → 'other'.
function classifyMarketFamily(title, rules = {}) {
  const t = norm(title);
  if (rules.qualificationMarket === true || /\b(to qualify|qualify|advance|reach the|progres)\b/.test(t)) return 'qualify';
  if (/\b(win|winner|champion|lift)\b.*\b(world cup|tournament|trophy|title)\b/.test(t) || /\b(tournament winner|to win the world cup|to win the tournament)\b/.test(t)) return 'tournament_winner';
  if (rules.drawPossible === true || /\b(1x2|match result|full[- ]time result|three[- ]way)\b/.test(t)) return 'match_1x2';
  if (/\b(moneyline|match winner|to win the match|wins match|to win)\b/.test(t)) return 'match_winner';
  if (/\b(over|under|total goals|o\/u)\b/.test(t)) return 'total';
  if (/\b(both teams to score|btts|gg\/ng)\b/.test(t)) return 'btts';
  if (/\bhandicap|spread|\+\d|\-\d\b/.test(t)) return 'handicap';
  return 'binary_event';
}

// classifyPeriod(rules) → period. Si las reglas no lo dicen, 'unspecified' (NO se asume 90m).
function classifyPeriod(rules = {}) {
  if (rules.marketPeriod && PERIOD.includes(rules.marketPeriod)) return rules.marketPeriod;
  if (rules.includesExtraTime === true || rules.includesPenalties === true) return 'full_match_including_extra_time';
  if (rules.includesExtraTime === false && rules.includesPenalties === false) return 'regulation_90m';
  return 'unspecified';
}

// scopeForFamily(family) → event_scope típico
function scopeForFamily(family) {
  if (family === 'tournament_winner') return 'tournament';
  // qualify se trata como contexto de PARTIDO (eliminatoria): el evento puede coincidir con un
  // match_winner del mismo cruce; la diferencia win-vs-qualify se captura a nivel de MERCADO.
  return 'match';
}
function eventTypeForFamily(family) {
  return (family === 'tournament_winner') ? 'sports_tournament' : 'sports_match';
}

module.exports = {
  TAXONOMY_VERSION, EVENT_TYPE, EVENT_SCOPE, MARKET_FAMILY, PERIOD, OUTCOME_TYPE, SETTLEMENT_MODIFIERS,
  classifyMarketFamily, classifyPeriod, scopeForFamily, eventTypeForFamily, norm,
};
