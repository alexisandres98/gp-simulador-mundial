// arb-engine/lifecycle.js — estados del ciclo de vida de una oportunidad (Sprint 3).
// detected → active → aging → expired ; invalidated (cambio de mapping/rules/estado) ; rejected.
'use strict';

// nextStatus({ current, classification, lastValidatedAt, now, expectedIntervalMs, expiryMultiplier,
//              mappingVersion, prevMappingVersion, rulesFingerprint, prevRulesFingerprint }) → status
function nextStatus(ctx) {
  const { classification } = ctx;
  // invalidación: cambió la base de equivalencia
  if (ctx.prevMappingVersion && ctx.mappingVersion && ctx.prevMappingVersion !== ctx.mappingVersion) return 'invalidated';
  if (ctx.prevRulesFingerprint && ctx.rulesFingerprint && ctx.prevRulesFingerprint !== ctx.rulesFingerprint) return 'invalidated';

  if (classification === 'rejected' || classification === 'conditional' || classification === 'price_discrepancy') {
    return ctx.current ? ctx.current === 'active' || ctx.current === 'detected' ? 'expired' : ctx.current : 'rejected';
  }
  // pure_arb / execution_sensitive positivos
  if (!ctx.current) return 'detected';
  if (ctx.current === 'detected') return 'active';
  return 'active';
}

// isExpired(lastSeenAt, now, expectedIntervalMs, multiplier) → bool
function isExpired(lastSeenAt, now, expectedIntervalMs, multiplier) {
  if (!lastSeenAt) return true;
  const age = now - new Date(lastSeenAt).getTime();
  return age > (expectedIntervalMs || 10000) * (multiplier || 3);
}

// agingOrActive(lastValidatedAt, now, expectedIntervalMs) → 'active' | 'aging'
function agingOrActive(lastValidatedAt, now, expectedIntervalMs) {
  if (!lastValidatedAt) return 'aging';
  return (now - new Date(lastValidatedAt).getTime()) <= (expectedIntervalMs || 10000) ? 'active' : 'aging';
}

module.exports = { nextStatus, isExpired, agingOrActive };
