// arb-engine/oneXTwoArb.js — arbitraje 1X2 de 3 patas (home/draw/away) (Sprint 3).
// Solo si los 3 outcomes son exhaustivos, mismas reglas/periodo, draw disponible, no duplicados.
'use strict';
const { evaluateArb } = require('./arbCore');
const { findMaxSize } = require('./sizeOptimizer');

// validateStructure(legs) → { ok, reason? }. 3 patas exhaustivas y mutuamente excluyentes.
function validateStructure(legs) {
  if (!Array.isArray(legs) || legs.length !== 3) return { ok: false, reason: '1x2_requires_3_legs' };
  const sides = legs.map(l => (l.side || '').toLowerCase());
  const need = ['home', 'draw', 'away'];
  for (const n of need) if (!sides.includes(n)) return { ok: false, reason: 'missing_' + n };
  if (new Set(sides).size !== 3) return { ok: false, reason: 'duplicate_outcome' };
  // mismas reglas/periodo en las 3 patas (si vienen marcadas)
  const periods = new Set(legs.map(l => l.period).filter(Boolean));
  if (periods.size > 1) return { ok: false, reason: 'period_mismatch' };
  const fps = new Set(legs.map(l => l.rulesFingerprint).filter(Boolean));
  if (fps.size > 1) return { ok: false, reason: 'rules_mismatch' };
  return { ok: true };
}

function evaluate(legs, opts = {}) {
  const v = validateStructure(legs);
  if (!v.ok) return { strategy: '1x2', structureOk: false, reason: v.reason };
  const maxSize = findMaxSize(legs, opts);
  const refQ = opts.referenceQuantity || maxSize.maxQuantity || '0';
  const evaluation = (refQ !== '0') ? evaluateArb(legs, refQ, opts) : (maxSize.evaluation || evaluateArb(legs, '1', opts));
  return { strategy: '1x2', structureOk: true, evaluation, maxSize };
}

module.exports = { evaluate, validateStructure };
