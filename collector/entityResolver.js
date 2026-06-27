// collector/entityResolver.js — Fase O §8/§9/§10. Entity resolution + deduplicación + contradicciones. PURO.
// Resuelve documento→fixture por aliases de equipos (NO por similitud textual débil). Matches ambiguos → review,
// sin impacto. Dedup por hash/url. Contradicciones entre claims → eleva uncertainty / suspende factor.
'use strict';
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// resolveEvent(text, fixtures, teamAliases) → {selected_event_id, candidate_events, confidence, method, review_required}
// fixtures: [{id, home_id, away_id, home_aliases:[], away_aliases:[], kickoff}]. Requiere AMBOS equipos presentes.
function resolveEvent(text, fixtures = []) {
  const t = norm(text);
  const hits = [];
  for (const f of fixtures) {
    const hasHome = (f.home_aliases || []).some(a => a && t.includes(norm(a)));
    const hasAway = (f.away_aliases || []).some(a => a && t.includes(norm(a)));
    if (hasHome && hasAway) hits.push(f.id);
  }
  if (hits.length === 1) return { selected_event_id: hits[0], candidate_events: hits, confidence: 0.9, method: 'both_teams_alias', review_required: false };
  if (hits.length === 0) return { selected_event_id: null, candidate_events: [], confidence: 0, method: 'no_match', review_required: false };
  return { selected_event_id: null, candidate_events: hits, confidence: 0.4, method: 'ambiguous_multi', review_required: true }; // ambiguo → review, sin impacto
}

// clasifica propagación: ORIGINAL vs REPUBLICATION (mismo content hash) vs INDEPENDENT_CONFIRMATION (otro grupo de fuente).
function classifyPropagation(claim, priorClaims = []) {
  const sameHash = priorClaims.find(p => p.claim_text_hash === claim.claim_text_hash);
  if (sameHash) return 'REPUBLICATION';
  const sameFactorOtherSource = priorClaims.find(p => p.factor_code === claim.factor_code && p.subject_id === claim.subject_id && p.source_group !== claim.source_group);
  if (sameFactorOtherSource) return 'INDEPENDENT_CONFIRMATION';
  return 'ORIGINAL_SOURCE';
}

// detecta contradicción para un (factor, subject, event): p.ej. OUT vs available/negado, o FACT vs FACT opuesto.
// Devuelve { conflict, action, uncertainty_bump }. action: suspend|raise_uncertainty|none. Nunca elige el favorable.
function resolveContradictions(claims = []) {
  const out = [];
  // OUT vs (negación / starter confirmado) del mismo jugador
  const byPlayer = {};
  for (const c of claims) { const k = (c.subject_id || '') + '|' + (c.event_id || ''); (byPlayer[k] = byPlayer[k] || []).push(c); }
  for (const [k, arr] of Object.entries(byPlayer)) {
    const out_ = arr.some(c => c.factor_code === 'PLAYER_CONFIRMED_OUT' && !c.negated);
    const in_ = arr.some(c => (c.factor_code === 'PLAYER_CONFIRMED_STARTER') || (c.factor_code === 'PLAYER_CONFIRMED_OUT' && c.negated) || c.factor_code === 'PLAYER_RETURNED_TO_TRAINING');
    if (out_ && in_) {
      // resolver por tier/timestamp; si no se puede, suspender
      const sorted = arr.slice().sort((a, b) => (tierRank(b.tier) - tierRank(a.tier)) || (new Date(b.source_published_at || 0) - new Date(a.source_published_at || 0)));
      const top = sorted[0];
      const decisive = top && top.tier === 'TIER_1_OFFICIAL';
      out.push({ subject: k, conflict: true, action: decisive ? 'resolved_by_tier1' : 'suspend', uncertainty_bump: decisive ? 0.1 : 0.5, winner: decisive ? top.factor_code : null });
    }
  }
  return out;
}
function tierRank(t) { return { TIER_1_OFFICIAL: 4, TIER_2_HIGH_REPUTATION: 3, TIER_3_APPROVED_SPECIALIST: 2, TIER_4_UNVERIFIED: 1, BLOCKED: 0 }[t] || 1; }

module.exports = { resolveEvent, classifyPropagation, resolveContradictions, tierRank };
