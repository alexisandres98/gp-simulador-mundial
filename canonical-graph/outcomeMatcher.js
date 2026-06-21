// canonical-graph/outcomeMatcher.js — equivalencia de OUTCOMES (Sprint 2).
// NO asume YES=home. El significado de YES se deriva del contrato (participante del outcome + mercado).
'use strict';
const OUTCOME_MATCHER_VERSION = 'outcome-matcher-1';

// matchOutcomes(a, b, marketStatus) → [{ kind, sideA, sideB, status, evidence, conflicts, version, explanation }]
// Para mercados binarios (campeón/ganador): el YES de cada proveedor refiere a su outcomeParticipant.
function matchOutcomes(a, b, marketStatus) {
  if (marketStatus === 'rejected') return [one('rejected', 'YES', 'YES', [], [{ code: 'MARKET_NOT_EQUIVALENT', severity: 'hard' }], 'Mercado no equivalente')];
  if (marketStatus === 'needs_review') return [one('needs_review', 'YES', 'YES', [], [], 'Mercado pendiente')];

  const pa = a.outcomeParticipant && a.outcomeParticipant.code;
  const pb = b.outcomeParticipant && b.outcomeParticipant.code;
  if (!pa || !pb) return [one('needs_review', 'YES', 'YES', [], [], 'Participante del outcome no resuelto')];

  if (pa === pb) {
    // YES↔YES = mismo participante. Estado heredado del mercado (matched→matched, conditional→conditional).
    const status = marketStatus === 'conditional' ? 'conditional' : 'matched';
    return [
      one(status, 'YES', 'YES', ['same_outcome_participant:' + pa], [], `YES↔YES = ${pa}`),
      one(status, 'NO', 'NO', ['complement_of:' + pa], [], `NO↔NO = no ${pa}`),
    ];
  }
  // YES refiere a equipos DISTINTOS → outcomes incompatibles (no es el mismo resultado)
  return [one('rejected', 'YES', 'YES', [], [{ code: 'OUTCOME_PARTICIPANT_MISMATCH', severity: 'hard', left: pa, right: pb, explanation: 'YES refiere a participantes distintos' }], `YES=${pa} vs YES=${pb}`)];
}

function one(status, sideA, sideB, evidence, conflicts, explanation) {
  return { kind: 'outcome', sideA, sideB, status, evidence, conflicts: conflicts || [], version: OUTCOME_MATCHER_VERSION, explanation };
}

module.exports = { matchOutcomes, OUTCOME_MATCHER_VERSION };
