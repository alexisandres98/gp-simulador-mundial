// value-engine/oddsNormalization.js — Sprint 7 §9. Normaliza odds → decimal + probabilidad implícita cruda.
'use strict';

// toDecimal(value, format) → decimal_odds (number) | null
function toDecimal(value, format = 'decimal') {
  if (value == null || value === '') return null;
  if (format === 'decimal') { const d = parseFloat(value); return Number.isFinite(d) && d > 1 ? d : null; }
  if (format === 'american') {
    const a = parseFloat(value); if (!Number.isFinite(a) || a === 0) return null;
    return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
  }
  if (format === 'fractional') {
    const m = String(value).match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/); if (!m) return null;
    const numr = parseFloat(m[1]), den = parseFloat(m[2]); if (!den) return null;
    return 1 + numr / den;
  }
  if (format === 'probability') { const p = parseFloat(value); return (Number.isFinite(p) && p > 0 && p < 1) ? 1 / p : null; }
  return null;
}

// normalizeQuote({ odds, format, quoteStatus, quoteTimestamp, ... }) → { decimal_odds, raw_implied_probability, valid, reason }
function normalizeQuote(q = {}) {
  const decimal = toDecimal(q.odds, q.format || 'decimal');
  if (decimal == null) return { valid: false, reason: 'invalid_odds', decimal_odds: null, raw_implied_probability: null };
  if (!(decimal > 1) || !Number.isFinite(decimal)) return { valid: false, reason: 'odds_out_of_range', decimal_odds: null, raw_implied_probability: null };
  if (q.quoteStatus && q.quoteStatus !== 'open') return { valid: false, reason: 'quote_' + q.quoteStatus, decimal_odds: decimal, raw_implied_probability: 1 / decimal };
  const raw = 1 / decimal;
  return { valid: true, reason: null, decimal_odds: +decimal.toFixed(6), raw_implied_probability: +raw.toFixed(8), quote_status: q.quoteStatus || 'open', quote_timestamp: q.quoteTimestamp || null };
}

module.exports = { toDecimal, normalizeQuote };
