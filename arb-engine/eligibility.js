// arb-engine/eligibility.js — reglas de elegibilidad de una pata/oportunidad (Sprint 3).
// Conservador: registra el MOTIVO EXACTO de rechazo. Solo `matched` + 0 hard conflicts + fresh +
// fee conocida + book válido + currency/payout conocidos puede ser Pure Arb ejecutable.

'use strict';
const D = require('./decimal');
const { validateBook } = require('./bookValidator');
const fees = require('./feeEngine');

// checkLeg(leg, params) → { eligible, reasons[] }
// leg: { provider, mappingStatus, outcomeMappingStatus, hardConflicts, rulesFingerprint, marketStatus,
//        freshness, currency, payoutKnown, equivalenceScore, asks:[{price,size}], snapshotReceivedAt, isLive }
function checkLeg(leg, params = {}) {
  const reasons = [];
  if (leg.mappingStatus !== 'matched') reasons.push('mapping_not_matched:' + leg.mappingStatus);
  if (leg.outcomeMappingStatus && leg.outcomeMappingStatus !== 'matched') reasons.push('outcome_not_matched');
  if ((leg.hardConflicts || 0) > 0) reasons.push('hard_conflicts');
  if (!leg.rulesFingerprint) reasons.push('rules_fingerprint_missing');
  if (leg.marketStatus && leg.marketStatus !== 'open') reasons.push('market_not_open:' + leg.marketStatus);
  if (leg.freshness === 'stale' || leg.freshness === 'unknown') reasons.push('snapshot_' + leg.freshness);
  if ((leg.currency || 'USD').toUpperCase() !== 'USD') reasons.push('currency_incompatible');
  if (leg.payoutKnown === false) reasons.push('payout_unknown');
  if (leg.equivalenceScore != null && leg.equivalenceScore < (params.minEquivalenceScore != null ? params.minEquivalenceScore : 0.95)) reasons.push('equivalence_below_threshold');
  // fee conocida
  const sched = fees.schedule(leg.provider);
  if (leg.feeOverride && leg.feeOverride.schedule && leg.feeOverride.schedule.status === 'unknown') reasons.push('fee_unknown');
  else if (!sched && !(leg.feeOverride && leg.feeOverride.schedule)) reasons.push('fee_unknown');
  // book válido + precio disponible
  if (!leg.asks || !leg.asks.length) reasons.push('no_executable_price');
  else { const v = validateBook({ asks: leg.asks, bids: leg.bids }); if (!v.ok) reasons.push('invalid_book:' + v.reason); }
  return { eligible: reasons.length === 0, reasons };
}

// checkTimeSkew(legs, maxSkewMs) → { ok, skewMs, reason? }
function checkTimeSkew(legs, maxSkewMs) {
  const ts = legs.map(l => l.snapshotReceivedAt ? new Date(l.snapshotReceivedAt).getTime() : null).filter(Number.isFinite);
  if (ts.length < legs.length) return { ok: false, skewMs: null, reason: 'missing_snapshot_timestamp' };
  const skew = Math.max(...ts) - Math.min(...ts);
  return { ok: skew <= maxSkewMs, skewMs: skew, reason: skew > maxSkewMs ? 'leg_time_skew' : null };
}

// checkSnapshotAge(leg, now, params) → { ok, ageMs, reason? }
function checkSnapshotAge(leg, now, params) {
  if (!leg.snapshotReceivedAt) return { ok: false, ageMs: null, reason: 'missing_snapshot_timestamp' };
  const t = new Date(leg.snapshotReceivedAt).getTime();
  if (t > now + 60000) return { ok: false, ageMs: t - now, reason: 'future_snapshot' };
  const age = now - t;
  const maxAge = leg.isLive ? params.maxSnapshotAgeLiveMs : params.maxSnapshotAgePrematchMs;
  return { ok: age <= maxAge, ageMs: age, reason: age > maxAge ? 'snapshot_too_old' : null };
}

module.exports = { checkLeg, checkTimeSkew, checkSnapshotAge };
