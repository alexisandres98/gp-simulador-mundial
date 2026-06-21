// canonical-graph/conflicts.js — detección de conflictos MATERIALES (Sprint 2). Precisión-primero:
// un score textual alto NUNCA puede superar un hard conflict. Cada conflicto es explicable.
// Conflicto = { code, severity:'hard'|'soft', field, left, right, explanation }.

'use strict';

function C(code, severity, field, left, right, explanation) { return { code, severity, field, left, right, explanation }; }

// ---------- conflictos de EVENTO ----------
// a, b: descriptores { sport, competition, season, scope, stage, category, participants:[code], scheduledStart }
function eventConflicts(a, b, { timeWindowMin = 90 } = {}) {
  const conflicts = [];
  if (a.sport && b.sport && a.sport !== b.sport) conflicts.push(C('SPORT_MISMATCH', 'hard', 'sport', a.sport, b.sport, 'Deportes distintos'));
  // categoría (género/edad): masculino vs femenino, absoluta vs sub-20
  if (a.category && b.category && a.category !== b.category) conflicts.push(C('CATEGORY_MISMATCH', 'hard', 'category', a.category, b.category, 'Categoría distinta (género/edad)'));
  // scope: torneo vs partido
  if (a.scope && b.scope && a.scope !== b.scope && (a.scope === 'tournament' || b.scope === 'tournament')) {
    conflicts.push(C('TOURNAMENT_VS_MATCH', 'hard', 'scope', a.scope, b.scope, 'Uno es de torneo y otro de partido'));
    return conflicts; // no tiene sentido seguir comparando
  }
  if (a.scope === 'tournament' && b.scope === 'tournament') {
    if (a.competition && b.competition && norm(a.competition) !== norm(b.competition)) conflicts.push(C('COMPETITION_MISMATCH', 'hard', 'competition', a.competition, b.competition, 'Competición distinta'));
    if (a.season && b.season && String(a.season) !== String(b.season)) conflicts.push(C('SEASON_MISMATCH', 'hard', 'season', a.season, b.season, 'Temporada distinta'));
    return conflicts; // en torneo el equipo es a nivel de OUTCOME, no de evento
  }
  // scope partido: comparar participantes + fecha + competición + fase
  if (a.competition && b.competition && norm(a.competition) !== norm(b.competition)) conflicts.push(C('COMPETITION_MISMATCH', 'hard', 'competition', a.competition, b.competition, 'Competición distinta'));
  // Solo afirmamos incompatibilidad si AMBOS lados tienen el set COMPLETO (≥2 en un partido).
  // Si uno está incompleto (1 participante resuelto), es dato faltante → needs_review, no rechazo.
  const pa = setOf(a.participants), pb = setOf(b.participants);
  if (pa.size >= 2 && pb.size >= 2 && !sameSet(pa, pb)) conflicts.push(C('PARTICIPANTS_INCOMPATIBLE', 'hard', 'participants', [...pa].join(','), [...pb].join(','), 'Participantes incompatibles'));
  if (a.stage && b.stage && norm(a.stage) !== norm(b.stage)) conflicts.push(C('STAGE_MISMATCH', 'hard', 'stage', a.stage, b.stage, 'Fase distinta'));
  if (a.scheduledStart && b.scheduledStart) {
    const diffMin = Math.abs(new Date(a.scheduledStart) - new Date(b.scheduledStart)) / 60000;
    if (Number.isFinite(diffMin) && diffMin > timeWindowMin) conflicts.push(C('DATE_TOO_FAR', 'hard', 'scheduled_start', a.scheduledStart, b.scheduledStart, `Fechas distantes (${Math.round(diffMin)} min > ${timeWindowMin})`));
  }
  return conflicts;
}

// ---------- conflictos de MERCADO / REGLAS ----------
// a, b: descriptores { family, period, normalizedRules, rulesFingerprint, settlementTrigger }
function marketConflicts(a, b) {
  const conflicts = [];
  const ra = a.normalizedRules || {}, rb = b.normalizedRules || {};
  if (a.family && b.family && a.family !== b.family) {
    const fams = new Set([a.family, b.family]);
    if (fams.has('tournament_winner')) conflicts.push(C('TOURNAMENT_VS_MATCH', 'hard', 'market_family', a.family, b.family, 'Torneo vs partido'));
    else if (fams.has('match_winner') && fams.has('qualify')) conflicts.push(C('OUTCOME_WIN_VS_QUALIFY', 'hard', 'market_family', a.family, b.family, 'Ganar el partido vs clasificarse'));
    else conflicts.push(C('FAMILY_MISMATCH', 'hard', 'market_family', a.family, b.family, 'Familia de mercado distinta'));
  }
  // estado del mercado incompatible (uno cerrado/cancelado/settled y otro abierto)
  const closed = s => ['settled', 'cancelled', 'closed'].includes(s);
  if (a.marketStatus && b.marketStatus && closed(a.marketStatus) !== closed(b.marketStatus)) {
    conflicts.push(C('MARKET_STATUS_CONFLICT', 'hard', 'status', a.marketStatus, b.marketStatus, 'Uno cerrado/cancelado y otro abierto'));
  }
  // periodo: mitad-vs-completo es mercado DISTINTO (rejecting); 90m-vs-prórroga es diferencia material (conditional)
  if (a.period && b.period && a.period !== 'unspecified' && b.period !== 'unspecified' && a.period !== b.period) {
    const half = /half/.test(a.period) || /half/.test(b.period);
    conflicts.push(C(half ? 'PERIOD_HALF_MISMATCH' : 'PERIOD_MISMATCH', 'hard', 'period', a.period, b.period, half ? 'Mitad vs partido completo' : '90 min vs incluyendo prórroga'));
  }
  // win vs qualify
  const sa = ra.settlementTrigger, sb = rb.settlementTrigger;
  if (sa && sb && sa !== sb && (sa === 'qualification' || sb === 'qualification')) {
    conflicts.push(C('OUTCOME_WIN_VS_QUALIFY', 'hard', 'settlement_trigger', sa, sb, 'Ganar el partido vs clasificarse'));
  }
  if (ra.qualificationMarket !== rb.qualificationMarket && (ra.qualificationMarket === true || rb.qualificationMarket === true)) {
    conflicts.push(C('OUTCOME_WIN_VS_QUALIFY', 'hard', 'qualification_market', ra.qualificationMarket, rb.qualificationMarket, 'Uno es mercado de clasificación'));
  }
  // empate posible (solo si ambos definidos y difieren)
  if (ra.drawPossible != null && rb.drawPossible != null && ra.drawPossible !== rb.drawPossible) {
    conflicts.push(C('DRAW_MISMATCH', 'hard', 'draw_possible', ra.drawPossible, rb.drawPossible, 'Empate permitido vs binario sin empate'));
  }
  // penales (solo si ambos definidos y difieren)
  if (ra.includesPenalties != null && rb.includesPenalties != null && ra.includesPenalties !== rb.includesPenalties) {
    conflicts.push(C('PENALTIES_MISMATCH', 'hard', 'includes_penalties', ra.includesPenalties, rb.includesPenalties, 'Incluye penales vs no'));
  }
  // cancelación / postponement
  if (ra.postponementPolicy && rb.postponementPolicy && ra.postponementPolicy !== rb.postponementPolicy) {
    conflicts.push(C('CANCELLATION_MISMATCH', 'hard', 'postponement_policy', ra.postponementPolicy, rb.postponementPolicy, 'Política de aplazamiento distinta'));
  }
  // resolución (soft: puede ser compatible aunque difiera el texto)
  if (ra.resolutionSource && rb.resolutionSource && ra.resolutionSource !== rb.resolutionSource) {
    conflicts.push(C('RESOLUTION_SOURCE_DIFF', 'soft', 'resolution_source', ra.resolutionSource, rb.resolutionSource, 'Fuente de resolución distinta (revisar compatibilidad)'));
  }
  return conflicts;
}

function hardCount(conflicts) { return conflicts.filter(c => c.severity === 'hard').length; }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
function setOf(arr) { return new Set((arr || []).map(x => (x && x.code) ? x.code : x).filter(Boolean)); }
function sameSet(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }

module.exports = { eventConflicts, marketConflicts, hardCount, C };
