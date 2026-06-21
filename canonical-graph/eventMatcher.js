// canonical-graph/eventMatcher.js — equivalencia de EVENTOS (Sprint 2). Explicable y conservador.
'use strict';
const conflictsMod = require('./conflicts');
const scoring = require('./scoring');
const cfg = require('./config');
const EVENT_MATCHER_VERSION = 'event-matcher-1';

// matchEvents(a, b) → { kind, status, score, conflicts, evidence, version, explanation }
function matchEvents(a, b) {
  const conflicts = conflictsMod.eventConflicts(a, b, { timeWindowMin: cfg.timeWindows.matchMinutes });
  const { score, evidence } = scoring.scoreEvent(a, b);
  const criticalDataMissing = !!(a.eventDataMissing || b.eventDataMissing); // identidad del evento (participantes)
  const status = scoring.decide('event', score, conflicts, { criticalDataMissing });
  return {
    kind: 'event', status, score, conflicts, evidence,
    version: EVENT_MATCHER_VERSION,
    explanation: explain(status, score, conflicts, evidence, criticalDataMissing),
  };
}

function explain(status, score, conflicts, evidence, missing) {
  const hard = conflicts.filter(c => c.severity === 'hard');
  if (status === 'rejected' && hard.length) return `Rechazado por conflicto: ${hard.map(c => c.code).join(', ')}`;
  if (status === 'conditional') return `Condicionado por diferencia material: ${hard.map(c => c.code).join(', ')}`;
  if (status === 'needs_review' && missing) return 'A revisión: faltan datos críticos (participante o reglas)';
  if (status === 'matched') return `Equivalente (score ${score}): ${evidence.join(', ')}`;
  if (status === 'needs_review') return `A revisión (score ${score} insuficiente para auto-match)`;
  return `Rechazado (score ${score} bajo, sin evidencia de equivalencia)`;
}

module.exports = { matchEvents, EVENT_MATCHER_VERSION };
