// arb-engine/payoutNormalizer.js — normaliza contratos a una unidad consistente (Sprint 3).
// Binario payout $1: price∈[0,1], payout_if_winner=1, payout_if_loser=0, currency USD, multiplier 1.
// No mezcla centavos/dólares/porcentajes/odds. Aritmética decimal. Marca incompatibilidades.

'use strict';
const D = require('./decimal');

// normalizeContract({ provider, price, side, currency, contractMultiplier, outcomeType }) → { ok, contract|reason }
function normalizeContract(m = {}) {
  const currency = (m.currency || 'USD').toUpperCase();
  if (currency !== 'USD') return { ok: false, reason: 'currency_incompatible', detail: currency };
  const multiplier = m.contractMultiplier != null ? D.fromStr(m.contractMultiplier) : D.ONE;
  if (D.cmp(multiplier, D.ZERO) <= 0) return { ok: false, reason: 'invalid_multiplier' };

  let price = D.fromStr(m.price);
  // payout binario $1: el precio debe estar en [0,1]
  if (D.cmp(price, D.ZERO) < 0 || D.cmp(price, D.ONE) > 0) return { ok: false, reason: 'price_out_of_range', detail: D.toStr(price) };

  return {
    ok: true,
    contract: {
      provider: m.provider || null,
      normalizedPrice: D.toStr(price),
      normalizedPayout: '1',
      payoutIfLoser: '0',
      currency: 'USD',
      contractMultiplier: D.toStr(multiplier),
      side: m.side || null,
      outcomeType: m.outcomeType || null,
      _scaledPrice: price, _scaledMultiplier: multiplier,
    },
  };
}

// normalizeQuantity(quantity, contractMultiplier) → cantidad efectiva (shares de payout $1)
function normalizeQuantity(quantity, contractMultiplier) {
  const q = D.fromStr(quantity), mult = contractMultiplier != null ? D.fromStr(contractMultiplier) : D.ONE;
  return D.toStr(D.mul(q, mult));
}

module.exports = { normalizeContract, normalizeQuantity };
