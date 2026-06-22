// signal-registry/eligibility.js — Sprint 5 §16. Elegibilidad para el (futuro) track record. Puro.
// Una señal SOLO puede contar para el track record si cumple TODO. Las que no, se registran igual
// (transparencia) pero con score_eligible=false y verification_status que explica por qué.
'use strict';
const cfg = require('./config');

const ms = v => { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); };

// evaluate(signal, ctx) → { score_eligible, verification_status, legacy, experimental, reasons[] }
//   ctx = { now, schemaValid, sourceRefCount, minSourceRefs, verifiedEpoch, outcomeKnown, legacyImport }
function evaluate(signal, ctx = {}) {
  const now = ctx.now || Date.now();
  const reasons = [];
  const experimental = !!signal.experimental;
  const epoch = ctx.verifiedEpoch !== undefined ? ctx.verifiedEpoch : cfg.params.verifiedEpoch;
  const published = ms(signal.published_at) || now;
  const eventStart = ms(signal.event_start_at);
  const marketClose = ms(signal.market_close_at);
  const inputCutoff = ms(signal.input_cutoff_at);

  // 1) Imports históricos / retroactivos → nunca verificados.
  if (ctx.legacyImport || signal.legacy) {
    reasons.push('legacy_import');
    return done(false, 'legacy_unverified', true, experimental, reasons);
  }

  // 2) Epoch del registro verificable.
  const epochMs = ms(epoch);
  if (!epochMs) reasons.push('verified_epoch_not_configured');
  else if (published < epochMs) { reasons.push('before_verified_epoch'); return done(false, 'legacy_unverified', true, experimental, reasons); }

  // 3) Experimental (GP Intelligence V2) → registrado pero fuera del track record.
  if (experimental) { reasons.push('experimental'); return done(false, 'experimental', false, true, reasons); }

  // 4) Versiones obligatorias.
  if (!signal.model_version) reasons.push('model_version_missing');
  if (!signal.methodology_version) reasons.push('methodology_version_missing');

  // 5) Payload válido + source references suficientes.
  if (ctx.schemaValid === false) reasons.push('invalid_payload');
  const minRefs = ctx.minSourceRefs != null ? ctx.minSourceRefs : 1;
  if ((ctx.sourceRefCount || 0) < minRefs) reasons.push('insufficient_source_references');

  // 6) input_cutoff_at <= published_at (no usar datos posteriores a la publicación).
  if (inputCutoff != null && published != null && inputCutoff > published) reasons.push('input_after_publication');

  // 7) Temporalidad: publicada ANTES del evento / cierre, y outcome aún no conocido.
  let late = false;
  if (eventStart != null && published >= eventStart) { reasons.push('published_after_event_start'); late = true; }
  if (marketClose != null && published >= marketClose) { reasons.push('published_after_market_close'); late = true; }
  if (ctx.outcomeKnown) { reasons.push('outcome_already_known'); late = true; }

  if (late) return done(false, 'late', false, false, reasons);
  if (reasons.filter(r => r !== 'verified_epoch_not_configured').length) return done(false, 'verified', false, false, reasons);

  return done(true, 'verified', false, false, reasons);

  function done(score_eligible, verification_status, legacy, experimental, reasons) {
    return { score_eligible, verification_status, legacy, experimental, reasons };
  }
}

module.exports = { evaluate };
