// metrics-engine/brier.js — Sprint 6 §10. Brier score. Definiciones EXPLÍCITAS y versionadas.
'use strict';

// brierBinary(p, y) → (p − y)²   con y ∈ {0,1}
function brierBinary(p, y) {
  const pp = num(p), yy = y ? 1 : 0;
  if (pp === null) return null;
  return (pp - yy) ** 2;
}

// brierMulticlass(probs, winningKey) → Σ (p_k − y_k)²   (SUMA, sin dividir entre clases). Versión brier_multiclass_v1.
// probs: { home, draw, away } (o cualquier conjunto de outcomes). winningKey: la clave del outcome real.
function brierMulticlass(probs, winningKey) {
  if (!probs || winningKey == null) return null;
  let sum = 0;
  for (const k of Object.keys(probs)) {
    const p = num(probs[k]); if (p === null) return null;
    const y = (k === winningKey) ? 1 : 0;
    sum += (p - y) ** 2;
  }
  return sum;
}

// validProbs(probs) → suma ≈ 1 y todas en [0,1]
function validProbs(probs) {
  if (!probs) return false;
  let s = 0;
  for (const k of Object.keys(probs)) { const p = num(probs[k]); if (p === null || p < 0 || p > 1) return false; s += p; }
  return Math.abs(s - 1) <= 0.01;
}

function num(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }

module.exports = { brierBinary, brierMulticlass, validProbs, VERSION: 'brier_multiclass_v1', BINARY_VERSION: 'brier_binary_v1' };
