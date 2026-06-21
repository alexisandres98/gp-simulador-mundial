// canonical-graph/scoring.js — scoring explicable + decisión (Sprint 2). Pesos centralizados en config.
// REGLA DURA: un hard conflict SIEMPRE prevalece sobre el score. Precisión-primero.

'use strict';
const cfg = require('./config');

// Conflictos que significan "mercado/evento DISTINTO" → rejected.
const REJECTING = new Set(['SPORT_MISMATCH', 'CATEGORY_MISMATCH', 'TOURNAMENT_VS_MATCH', 'COMPETITION_MISMATCH', 'SEASON_MISMATCH', 'PARTICIPANTS_INCOMPATIBLE', 'STAGE_MISMATCH', 'DATE_TOO_FAR', 'FAMILY_MISMATCH', 'DRAW_MISMATCH', 'PERIOD_HALF_MISMATCH', 'OUTCOME_PARTICIPANT_MISMATCH', 'MARKET_STATUS_CONFLICT']);
// Conflictos de "misma exposición con diferencia material" → conditional (nunca matched, pero relacionado).
const DIFFERENCING = new Set(['PERIOD_MISMATCH', 'OUTCOME_WIN_VS_QUALIFY', 'PENALTIES_MISMATCH', 'CANCELLATION_MISMATCH']);

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');
function tokenSim(a, b) {
  const ta = new Set(norm(a).split(/\s+/).filter(Boolean)), tb = new Set(norm(b).split(/\s+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const x of ta) if (tb.has(x)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

// scoreEvent(a, b) → { score, evidence }. Identidad explícita: torneo = competición+temporada;
// partido = participantes + competición + proximidad de kickoff (+ temporada).
function scoreEvent(a, b) {
  const ev = []; let s = 0;
  const compSame = a.competition && b.competition && norm(a.competition) === norm(b.competition);
  const seasonSame = (a.season == null && b.season == null) || (a.season && b.season && String(a.season) === String(b.season));
  if (a.scope === 'tournament' && b.scope === 'tournament') {
    const tw = cfg.tournamentWeights;
    if (compSame) { s += tw.competition; ev.push('same_tournament'); }
    if (seasonSame) { s += tw.season; ev.push('same_season'); }
    return { score: Math.round(Math.min(100, s)), evidence: ev };
  }
  const w = cfg.eventWeights;
  const pa = new Set((a.participants || []).map(p => p.code || p)), pb = new Set((b.participants || []).map(p => p.code || p));
  if (pa.size && pb.size && sameSet(pa, pb)) { s += w.participants; ev.push('same_participants'); }
  if (compSame) { s += w.competition; ev.push('same_competition'); }
  if (a.scheduledStart && b.scheduledStart) {
    const diffMin = Math.abs(new Date(a.scheduledStart) - new Date(b.scheduledStart)) / 60000;
    if (Number.isFinite(diffMin)) { const prox = Math.max(0, 1 - diffMin / (cfg.timeWindows.matchMinutes || 90)); s += w.timeProximity * prox; if (prox > 0.5) ev.push(`kickoff_within_${Math.round(diffMin)}min`); }
  } else if (!a.scheduledStart && !b.scheduledStart) { s += w.timeProximity * 0.5; } // sin fecha en ambos: parcial
  if (seasonSame && a.season) { s += w.season; ev.push('same_season'); }
  return { score: Math.round(Math.min(100, s)), evidence: ev };
}

// scoreMarket(a, b) → { score, evidence }
function scoreMarket(a, b) {
  const w = cfg.marketWeights; const ev = []; let s = 0;
  if (a.family && a.family === b.family) { s += w.family; ev.push('same_family'); }
  if (a.period && a.period === b.period && a.period !== 'unspecified') { s += w.period; ev.push('same_period'); }
  else if (a.period === 'unspecified' || b.period === 'unspecified') { s += w.period * 0.5; } // desconocido: no penaliza del todo
  if (a.rulesFingerprint && a.rulesFingerprint === b.rulesFingerprint) { s += w.rulesFingerprint; ev.push('same_rules_fingerprint'); }
  const ra = a.normalizedRules || {}, rb = b.normalizedRules || {};
  if (ra.resolutionSource && ra.resolutionSource === rb.resolutionSource) { s += w.resolutionSource; ev.push('same_resolution_source'); }
  return { score: Math.round(Math.min(100, s)), evidence: ev };
}

// decide(kind, score, conflicts, { criticalDataMissing }) → status explicable
function decide(kind, score, conflicts = [], opts = {}) {
  const hard = conflicts.filter(c => c.severity === 'hard');
  const rejecting = hard.filter(c => REJECTING.has(c.code));
  const differencing = hard.filter(c => DIFFERENCING.has(c.code));
  const matchT = kind === 'event' ? cfg.thresholds.eventMatch : kind === 'market' ? cfg.thresholds.marketMatch : cfg.thresholds.outcomeMatch;
  const reviewT = kind === 'event' ? cfg.thresholds.eventReview : kind === 'market' ? cfg.thresholds.marketReview : cfg.thresholds.eventReview;

  if (rejecting.length) return 'rejected';
  if (opts.criticalDataMissing) return 'needs_review';
  if (differencing.length) return 'conditional';   // misma exposición, diferencia material → nunca matched
  if (score >= matchT) return 'matched';
  if (score >= reviewT) return 'needs_review';
  return 'rejected';
}

function sameSet(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }

module.exports = { scoreEvent, scoreMarket, decide, REJECTING, DIFFERENCING, tokenSim };
