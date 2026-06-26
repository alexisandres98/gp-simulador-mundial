// signal-registry/lifecycleEligibility.js — Fase H §4 (closing) y §15 (commitments). CAPA PURA, sin DB.
// Decide qué FUTURA señal puede recibir closing/entrar al commitment. Hoy signals=0 → todo esto es contrato
// probado con datos sintéticos. NO crea señales ni candidates.
'use strict';
const cfg = require('./config');

const ms = v => { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); };

// scopes/tags que NUNCA son elegibles (validaciones internas, shadow, challenger V2, candidatos/draft).
const EXCLUDED_SCOPES = ['internal_validation', 'internal_validation_pre_epoch', 'shadow', 'challenger_diagnostic', 'v2_diagnostic'];
function scopeOf(sig) { return (sig.metadata && sig.metadata.scope) || sig.scope || sig.eligibility_scope || null; }

// closingEligible(signal, ctx) → { eligible, reasons[] } (§4).
//   ctx: { verifiedEpoch, hasProviderMapping }
function closingEligible(sig = {}, ctx = {}) {
  const reasons = [];
  const epochMs = ms(ctx.verifiedEpoch !== undefined ? ctx.verifiedEpoch : cfg.params.verifiedEpoch);
  const published = ms(sig.published_at);
  const kickoff = ms(sig.event_start_at);
  const scope = scopeOf(sig);

  if (sig.experimental) reasons.push('experimental_v2');                                   // V2 challenger / diagnostic
  if (sig.legacy || sig.verification_status === 'legacy_unverified') reasons.push('legacy_unverified');
  if (EXCLUDED_SCOPES.includes(scope)) reasons.push('excluded_scope:' + scope);
  if (sig.registry_status === 'draft' || sig.visibility === 'candidate' || sig.is_candidate) reasons.push('not_published');
  if (!epochMs) reasons.push('epoch_not_configured');
  else if (published == null || published < epochMs) reasons.push('pre_epoch');
  if (sig.verification_status && sig.verification_status !== 'verified') reasons.push('verification_status:' + sig.verification_status);
  if (!sig.canonical_event_id) reasons.push('no_canonical_event');
  const market = sig.canonical_market_id || (sig.signal_payload && sig.signal_payload.market_type) || sig.market;
  if (!market) reasons.push('no_market');
  const period = (sig.signal_payload && sig.signal_payload.period) || sig.period;
  if (!period) reasons.push('no_period');
  const outcome = sig.canonical_outcome_id || sig.direction || (sig.signal_payload && sig.signal_payload.predicted_outcome) || sig.outcome;
  if (!outcome) reasons.push('no_outcome');
  if (published != null && kickoff != null && published >= kickoff) reasons.push('published_after_kickoff');
  if (ctx.hasProviderMapping === false) reasons.push('no_provider_mapping');

  return { eligible: reasons.length === 0, reasons, market: market || null, period: period || null, outcome: outcome || null };
}

// commitmentEligible(signal) → { eligible, reasons[] } (§15). Solo señales oficiales elegibles entran al
// merkle commitment: excluye pre-epoch / internal_validation / V2 diagnostics / legacy / no-score-eligible.
function commitmentEligible(sig = {}, ctx = {}) {
  const reasons = [];
  const epochMs = ms(ctx.verifiedEpoch !== undefined ? ctx.verifiedEpoch : cfg.params.verifiedEpoch);
  const published = ms(sig.published_at);
  if (sig.experimental) reasons.push('experimental');
  if (sig.legacy || sig.verification_status === 'legacy_unverified') reasons.push('legacy');
  if (EXCLUDED_SCOPES.includes(scopeOf(sig))) reasons.push('excluded_scope');
  if (!sig.score_eligible) reasons.push('not_score_eligible');
  if (sig.verification_status && sig.verification_status !== 'verified') reasons.push('not_verified');
  if (epochMs && published != null && published < epochMs) reasons.push('pre_epoch');
  return { eligible: reasons.length === 0, reasons };
}

module.exports = { closingEligible, commitmentEligible, EXCLUDED_SCOPES, scopeOf };
