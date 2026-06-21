// exec-opportunities/eligibility.js — Sprint 4. Política de ELEGIBILIDAD para publicación. Puro, sin DB.
// Una evaluación del motor NO equivale a una oportunidad publicable. Aquí se aplica un estándar SUPERIOR
// al de detección. Conservador: ante la duda, NO elegible.
'use strict';

const cfg = require('./config');
const dec = require('../arb-engine/decimal');

// gte(a, b) con aritmética decimal exacta (sin float binario). a,b strings.
function gte(a, b) { try { return dec.cmp(dec.fromStr(a), dec.fromStr(b)) >= 0; } catch { return false; } }
function gt(a, b) { try { return dec.cmp(dec.fromStr(a), dec.fromStr(b)) > 0; } catch { return false; } }

// checkEligibility(ev, ctx, opts) → { eligible, reasons[], warnings[], requiresExecutionSensitiveOptIn }
//   ev  = evaluación del motor (evaluateCandidate output).
//   ctx = { mappingStatus, outcomeMappingStatus, hardConflicts, marketStatus, freshness,
//           deepLinksValid, jurisdictionMetadataAvailable, now, evaluationAgeMs }
//   opts = { allowExecutionSensitive } (override del default conservador de config)
function checkEligibility(ev, ctx = {}, opts = {}) {
  const reasons = [];
  const warnings = [];
  const e = (ev && ev.evaluation) || {};
  const pub = cfg.publication;
  const allowExecSensitive = opts.allowExecutionSensitive != null ? !!opts.allowExecutionSensitive : pub.allowExecutionSensitive;

  // 1) Clasificación: solo pure_arb o execution_sensitive (este último, opt-in explícito).
  const cls = ev && ev.classification;
  let requiresExecutionSensitiveOptIn = false;
  if (cls === 'pure_arb') {
    // ok
  } else if (cls === 'execution_sensitive') {
    requiresExecutionSensitiveOptIn = true;
    if (!allowExecSensitive) reasons.push('execution_sensitive_not_allowed');
    else warnings.push('execution_sensitive_requires_label'); // debe mostrarse etiquetada y con warning
  } else {
    // conditional / price_discrepancy / rejected / needs_review → nunca publicable como arbitraje ejecutable.
    reasons.push('classification_not_publishable:' + String(cls));
  }

  // 2) Equivalencia / mapping.
  if (ctx.mappingStatus !== 'matched') reasons.push('mapping_not_matched');
  if (ctx.outcomeMappingStatus && ctx.outcomeMappingStatus !== 'matched') reasons.push('outcome_not_matched');
  if ((ctx.hardConflicts || 0) > 0) reasons.push('hard_conflicts');
  if (!ev || !ev.rulesFingerprint) reasons.push('rules_fingerprint_missing');

  // 3) Fees conocidas (sin esto jamás se publica).
  if (e.feeStatus !== 'known') reasons.push('fee_unknown');

  // 4) Estado de mercado y frescura.
  if (ctx.marketStatus && ctx.marketStatus !== 'open') reasons.push('market_not_open:' + ctx.marketStatus);
  if (ctx.freshness === 'stale' || ctx.freshness === 'unknown') reasons.push('snapshot_' + ctx.freshness);

  // 5) Estructura ejecutable.
  if (e.fullyFillable === false) reasons.push('not_full_fill');
  if (!(e.netProfit != null && gt(e.netProfit, '0'))) reasons.push('net_profit_not_positive');

  // 6) Umbrales de PUBLICACIÓN (más estrictos que los del motor).
  if (!(e.netRoi != null && gte(e.netRoi, pub.minNetRoi))) reasons.push('net_roi_below_publication_threshold');
  const maxCap = ev && ev.maxSize && ev.maxSize.evaluation ? ev.maxSize.evaluation.capitalRequired : null;
  if (!(maxCap != null && gte(maxCap, pub.minExecutableCapital))) reasons.push('executable_size_below_publication_minimum');

  // 7) Edad de la evaluación.
  if (ctx.evaluationAgeMs != null && ctx.evaluationAgeMs > pub.maxEvaluationAgeMs) reasons.push('evaluation_too_old');

  // 8) Deep links válidos (si la capa de deep links está activa).
  if (cfg.flags.deepLinksEnabled && ctx.deepLinksValid === false) reasons.push('deep_links_invalid');

  // 9) Metadata de jurisdicción disponible (si no, es warning, no bloqueo duro).
  if (ctx.jurisdictionMetadataAvailable === false) warnings.push('jurisdiction_metadata_unknown');

  return {
    eligible: reasons.length === 0,
    reasons,
    warnings,
    requiresExecutionSensitiveOptIn,
    classification: cls || null,
  };
}

module.exports = { checkEligibility };
