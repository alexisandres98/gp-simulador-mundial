// metrics-engine/logLoss.js — Sprint 6 §11. Log loss con clipping versionado (no oculta confianza extrema errónea).
'use strict';
const cfg = require('./config');

function clip(p, eps) { return Math.min(1 - eps, Math.max(eps, p)); }

// logLossBinary(p, y) → −[y·ln(p) + (1−y)·ln(1−p)]
function logLossBinary(p, y, eps = cfg.params.logLossEpsilon) {
  const pp = num(p); if (pp === null) return null;
  const c = clip(pp, eps), yy = y ? 1 : 0;
  return -(yy * Math.log(c) + (1 - yy) * Math.log(1 - c));
}

// logLossMulticlass(probs, winningKey) → −ln(p_outcome_real)
function logLossMulticlass(probs, winningKey, eps = cfg.params.logLossEpsilon) {
  if (!probs || winningKey == null) return null;
  const p = num(probs[winningKey]); if (p === null) return null;
  return -Math.log(clip(p, eps));
}

function num(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }

module.exports = { logLossBinary, logLossMulticlass, VERSION: 'log_loss_multiclass_v1', BINARY_VERSION: 'log_loss_binary_v1' };
