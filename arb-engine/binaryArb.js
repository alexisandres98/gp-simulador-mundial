// arb-engine/binaryArb.js — arbitraje binario de 2 patas complementarias (Sprint 3).
// Comprar YES en A + Comprar NO en B (o equivalente). Valida estructura, luego usa arbCore/sizeOptimizer.
'use strict';
const { evaluateArb } = require('./arbCore');
const { findMaxSize } = require('./sizeOptimizer');

// validateStructure(legs) → { ok, reason? }. 2 patas, complementarias y exhaustivas (YES + NO).
function validateStructure(legs) {
  if (!Array.isArray(legs) || legs.length !== 2) return { ok: false, reason: 'binary_requires_2_legs' };
  const sides = legs.map(l => (l.side || '').toLowerCase());
  // patas complementarias: una cubre el evento y la otra su complemento (yes/no o home/not-home)
  const complementPair = legs[0].complementOf != null && legs[0].complementOf === legs[1].outcomeKey;
  const exhaustive = (sides.includes('yes') && sides.includes('no')) || complementPair || legs.every(l => l.exhaustivePair === true);
  if (!exhaustive) return { ok: false, reason: 'not_complementary_exhaustive' };
  return { ok: true };
}

// evaluate(legs, opts) → { strategy:'binary', structureOk, evaluation?, maxSize? }
function evaluate(legs, opts = {}) {
  const v = validateStructure(legs);
  if (!v.ok) return { strategy: 'binary', structureOk: false, reason: v.reason };
  const maxSize = findMaxSize(legs, opts);
  const refQ = opts.referenceQuantity || maxSize.maxQuantity || '0';
  const evaluation = (refQ !== '0') ? evaluateArb(legs, refQ, opts) : (maxSize.evaluation || evaluateArb(legs, '1', opts));
  return { strategy: 'binary', structureOk: true, evaluation, maxSize };
}

module.exports = { evaluate, validateStructure };
