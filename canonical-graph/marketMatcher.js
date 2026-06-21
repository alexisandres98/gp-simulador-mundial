// canonical-graph/marketMatcher.js — equivalencia de MERCADOS (Sprint 2). Solo tras evento compatible.
'use strict';
const conflictsMod = require('./conflicts');
const scoring = require('./scoring');
const MARKET_MATCHER_VERSION = 'market-matcher-1';

// matchMarkets(a, b, eventStatus) → { kind, status, score, conflicts, evidence, version, explanation }
function matchMarkets(a, b, eventStatus) {
  // precondición: el evento debe estar matched o conditional (compatible). Si no, no se compara mercado.
  if (eventStatus === 'rejected') return result('rejected', 0, [{ code: 'EVENT_NOT_EQUIVALENT', severity: 'hard', explanation: 'Evento no equivalente' }], []);
  if (eventStatus === 'needs_review') return result('needs_review', 0, [], [], 'Evento pendiente de revisión');

  const conflicts = conflictsMod.marketConflicts(a, b);
  const { score, evidence } = scoring.scoreMarket(a, b);
  const criticalDataMissing = !!(a.marketDataMissing || b.marketDataMissing); // reglas faltantes
  let status = scoring.decide('market', score, conflicts, { criticalDataMissing });
  // si el evento es conditional, el mercado NO puede ser matched (la incertidumbre se propaga)
  if (eventStatus === 'conditional' && status === 'matched') status = 'conditional';
  return result(status, score, conflicts, evidence);
}

function result(status, score, conflicts, evidence, note) {
  const hard = (conflicts || []).filter(c => c.severity === 'hard');
  const explanation = note || (status === 'rejected' && hard.length ? `Rechazado: ${hard.map(c => c.code).join(', ')}`
    : status === 'conditional' ? `Condicionado: ${hard.map(c => c.code).join(', ') || 'evento condicional'}`
    : status === 'matched' ? `Mercado equivalente (score ${score}): ${(evidence || []).join(', ')}`
    : `A revisión / rechazado (score ${score})`);
  return { kind: 'market', status, score, conflicts: conflicts || [], evidence: evidence || [], version: MARKET_MATCHER_VERSION, explanation };
}

module.exports = { matchMarkets, MARKET_MATCHER_VERSION };
