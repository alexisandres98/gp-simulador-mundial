// canonical-graph/config.js — flags, thresholds y pesos del Canonical Event Graph (Sprint 2).
// Centraliza TODO lo configurable (no disperso). Reutiliza el flag base de plataforma de Sprint 0.1.

'use strict';
const platform = require('../database/config');

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// Flags, con validación cruzada conservadora (write requiere graph; auto-match requiere graph+write).
function resolveFlags() {
  const graphEnabled = bool(process.env.CANONICAL_GRAPH_ENABLED, false);
  const writeReq = bool(process.env.CANONICAL_GRAPH_WRITE_ENABLED, false);
  const autoReq = bool(process.env.CANONICAL_AUTO_MATCH_ENABLED, false);
  const writeEnabled = graphEnabled && writeReq;
  const autoMatchEnabled = graphEnabled && writeEnabled && autoReq;
  return {
    graphEnabled, writeEnabled, autoMatchEnabled,
    configurationValid: (!writeReq || graphEnabled) && (!autoReq || (graphEnabled && writeReq)),
    warning: (autoReq && !(graphEnabled && writeReq)) ? 'auto_match_requires_graph_and_write'
      : (writeReq && !graphEnabled) ? 'write_requires_graph' : null,
  };
}
const flags = resolveFlags();

// Thresholds (escala 0-100). Un hard conflict SIEMPRE prevalece sobre el score.
const thresholds = {
  eventMatch: num(process.env.CANONICAL_EVENT_MATCH_THRESHOLD, 95),
  eventReview: num(process.env.CANONICAL_EVENT_REVIEW_THRESHOLD, 75),
  marketMatch: num(process.env.CANONICAL_MARKET_MATCH_THRESHOLD, 95),
  marketReview: num(process.env.CANONICAL_MARKET_REVIEW_THRESHOLD, 75),
  outcomeMatch: num(process.env.CANONICAL_OUTCOME_MATCH_THRESHOLD, 95),
};

// Pesos del scoring de eventos. Identidad de PARTIDO (suman 100 si todo coincide): participantes +
// competición + proximidad de kickoff + temporada. Identidad de TORNEO: competición + temporada.
const eventWeights = {
  participants: num(process.env.CANONICAL_W_PARTICIPANTS, 55),
  competition: num(process.env.CANONICAL_W_COMPETITION, 20),
  timeProximity: num(process.env.CANONICAL_W_TIME, 20),
  season: num(process.env.CANONICAL_W_SEASON, 5),
};
const tournamentWeights = {
  competition: num(process.env.CANONICAL_TW_COMPETITION, 60),
  season: num(process.env.CANONICAL_TW_SEASON, 40),
};
const marketWeights = {
  family: num(process.env.CANONICAL_W_FAMILY, 40),
  period: num(process.env.CANONICAL_W_PERIOD, 25),
  rulesFingerprint: num(process.env.CANONICAL_W_RULES, 25),
  resolutionSource: num(process.env.CANONICAL_W_RESOLUTION, 10),
};

// Ventanas de tiempo para candidatos
const timeWindows = {
  matchMinutes: num(process.env.CANONICAL_MATCH_WINDOW_MIN, 90),   // partidos: ±90 min (kickoffs pueden diferir)
};

module.exports = { platform, flags, thresholds, eventWeights, tournamentWeights, marketWeights, timeWindows };
