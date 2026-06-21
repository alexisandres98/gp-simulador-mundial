// canonical-graph/metrics.js — métricas internas del Canonical Event Graph (Sprint 2). En memoria.
'use strict';

function blank() {
  return {
    eventsDiscovered: 0, eventCandidates: 0, eventMatched: 0, eventConditional: 0, eventRejected: 0, eventNeedsReview: 0,
    marketsDiscovered: 0, marketCandidates: 0, marketMatched: 0, marketConditional: 0, marketRejected: 0, marketNeedsReview: 0,
    outcomesDiscovered: 0, outcomesMatched: 0, outcomesRejected: 0,
    hardConflictsByType: {}, rulesMissing: 0, rulesChanged: 0,
    manualApprovals: 0, manualRejections: 0, autoMatches: 0, mappingReversals: 0,
    scoreSum: 0, scoreCount: 0, reviewBacklog: 0,
  };
}
let store = blank();

function recordResult(r) {
  store.marketCandidates++;
  bump('event', r.event.status); bump('market', r.market.status);
  store.scoreSum += r.event.score; store.scoreCount++;
  for (const c of [...(r.event.conflicts || []), ...(r.market.conflicts || [])]) if (c.severity === 'hard') store.hardConflictsByType[c.code] = (store.hardConflictsByType[c.code] || 0) + 1;
  for (const o of r.outcomes || []) { store.outcomesDiscovered++; if (o.status === 'matched') store.outcomesMatched++; else if (o.status === 'rejected') store.outcomesRejected++; }
  if (r.a && r.a.ambiguousTerms && r.a.ambiguousTerms.includes('rules_missing')) store.rulesMissing++;
}
function bump(kind, status) {
  const map = { matched: 'Matched', conditional: 'Conditional', rejected: 'Rejected', needs_review: 'NeedsReview' };
  const key = `${kind}${map[status] || ''}`;
  if (store[key] != null) store[key]++;
}
function record(field, n = 1) { if (typeof store[field] === 'number') store[field] += n; }

function snapshot() {
  return { ...store, avgScore: store.scoreCount ? +(store.scoreSum / store.scoreCount).toFixed(1) : null };
}
function reset() { store = blank(); }

module.exports = { recordResult, record, snapshot, reset };
