// arb-engine/bookValidator.js — valida un order book antes de calcular (Sprint 3).
// Detecta books cruzados, NaN/Infinity, precios fuera de rango, size<=0, orden incorrecto, duplicados.
// NO consume un book inválido en silencio: devuelve { ok, reason, detail }.

'use strict';
const D = require('./decimal');

// validateSide(levels, side) → { ok, reason?, sorted? }. side 'bid'|'ask'.
function validateSide(levels, side) {
  if (!Array.isArray(levels)) return { ok: false, reason: 'no_levels' };
  if (!levels.length) return { ok: false, reason: 'empty_book' };
  const seen = new Set();
  for (const lv of levels) {
    if (lv == null) return { ok: false, reason: 'null_level' };
    const pn = Number(lv.price), sn = Number(lv.size);
    if (!Number.isFinite(pn) || !Number.isFinite(sn)) return { ok: false, reason: 'nan_or_infinity', detail: JSON.stringify(lv) };
    const p = D.fromStr(lv.price), s = D.fromStr(lv.size);
    if (D.cmp(p, D.ZERO) < 0 || D.cmp(p, D.ONE) > 0) return { ok: false, reason: 'price_out_of_range', detail: lv.price };
    if (D.cmp(s, D.ZERO) <= 0) return { ok: false, reason: 'non_positive_size', detail: lv.size };
    const key = D.toStr(p);
    if (seen.has(key)) return { ok: false, reason: 'duplicate_price_level', detail: key };
    seen.add(key);
  }
  return { ok: true };
}

// validateCross(bids, asks) → { ok, reason? }. best_bid > best_ask = cruzado inválido.
function validateCross(bids, asks) {
  if (!bids || !asks || !bids.length || !asks.length) return { ok: true }; // un solo lado: no se evalúa cruce
  const bestBid = bids.map(l => D.fromStr(l.price)).reduce((a, b) => D.max(a, b));
  const bestAsk = asks.map(l => D.fromStr(l.price)).reduce((a, b) => D.min(a, b));
  if (D.cmp(bestBid, bestAsk) > 0) return { ok: false, reason: 'INVALID_CROSSED_BOOK', detail: `bid ${D.toStr(bestBid)} > ask ${D.toStr(bestAsk)}` };
  return { ok: true };
}

// validateBook({ bids, asks }) — valida lo que exista. Para arbitraje solo se necesita el lado ASK del buy.
function validateBook(book = {}) {
  if (book.asks) { const a = validateSide(book.asks, 'ask'); if (!a.ok) return a; }
  if (book.bids) { const b = validateSide(book.bids, 'bid'); if (!b.ok) return b; }
  const cross = validateCross(book.bids, book.asks);
  if (!cross.ok) return cross;
  return { ok: true };
}

module.exports = { validateSide, validateCross, validateBook };
