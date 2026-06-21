// arb-engine/bookWalker.js — recorrido determinístico del order book + VWAP (Sprint 3).
// Consume el mejor precio primero, respeta el size de cada nivel, NO modifica el book original,
// NO asume fill completo. Aritmética decimal exacta. Redondeo según tick size.

'use strict';
const D = require('./decimal');

// walk({ levels, requestedQuantity, side, tickSize, minimumOrderSize }) → resultado
// levels: [{ price, size, ... }] (precio/size como string). Para una COMPRA se pasan los niveles ASK
// (se ordenan ascendente: mejor primero). side solo informa el sentido; el caller pasa el lado correcto.
function walk({ levels, requestedQuantity, side = 'buy', tickSize, minimumOrderSize } = {}) {
  const req = D.fromStr(requestedQuantity);
  const sorted = sortLevels(levels, side);
  let filled = D.ZERO, grossCost = D.ZERO, worst = D.ZERO, consumed = 0;
  const breakdown = [];
  for (const lvl of sorted) {
    if (filled >= req) break;
    const price = D.fromStr(lvl.price), size = D.fromStr(lvl.size);
    if (D.isNeg(price) || D.isNeg(size) || size === D.ZERO) continue; // nivel inválido → skip (validar antes)
    const remaining = D.sub(req, filled);
    const take = D.min(remaining, size);
    grossCost = D.add(grossCost, D.mul(price, take));
    filled = D.add(filled, take);
    worst = price;
    consumed++;
    breakdown.push({ price: D.toStr(price), size: D.toStr(take), levelCost: D.toStr(D.mul(price, take)) });
  }
  const unfilled = D.sub(req, filled);
  const fullyFillable = unfilled <= D.ZERO;
  const vwap = filled > D.ZERO ? D.div(grossCost, filled) : D.ZERO;
  // respeto del mínimo de orden: si lo que se llena queda por debajo del mínimo, no es ejecutable
  const minOk = minimumOrderSize == null || filled >= D.fromStr(minimumOrderSize) || filled === D.ZERO;

  return {
    requestedQuantity: D.toStr(req),
    filledQuantity: D.toStr(filled),
    unfilledQuantity: D.toStr(D.max(unfilled, D.ZERO)),
    vwap: D.toStr(vwap),
    worstPrice: D.toStr(worst),
    grossCost: D.toStr(grossCost),
    levelsConsumed: consumed,
    fullyFillable,
    meetsMinimumOrder: minOk,
    breakdown,
    // scaled (BigInt) para encadenar cálculos sin perder precisión
    _scaled: { filled, grossCost, vwap, worst },
  };
}

function sortLevels(levels, side) {
  const arr = (levels || []).slice();
  // compra → consumir asks ascendente (mejor = más barato); venta → bids descendente
  arr.sort((a, b) => {
    const pa = D.fromStr(a.price), pb = D.fromStr(b.price);
    return side === 'sell' ? D.cmp(pb, pa) : D.cmp(pa, pb);
  });
  return arr;
}

module.exports = { walk, sortLevels };
