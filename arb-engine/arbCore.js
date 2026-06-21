// arb-engine/arbCore.js — evaluación de arbitraje de N patas complementarias payout $1 (Sprint 3).
// Binario (2) y 1X2 (3) comparten esta lógica. Aritmética decimal. El slippage YA está en el VWAP del
// book walking (NO se resta otra fee de slippage → no doble conteo). El execution_buffer es SEPARADO
// (riesgo operativo, no fee). ROI = net_profit / capital_required (definición única).

'use strict';
const D = require('./decimal');
const { walk } = require('./bookWalker');
const fees = require('./feeEngine');

// evaluateArb(legs, quantity, opts) → evaluación a cantidad fija q.
// legs: [{ provider, levels, side, priceSource, ... }]. opts: { executionBufferBps }.
function evaluateArb(legs, quantity, opts = {}) {
  const q = D.fromStr(quantity);
  const bufferBps = D.fromStr(String(opts.executionBufferBps || 0));
  let rawCost = D.ZERO, feeTotal = D.ZERO, fullyFillable = true, feeStatus = 'known';
  const legOut = [];
  for (const leg of legs) {
    const w = walk({ levels: leg.levels, requestedQuantity: quantity, side: 'buy', tickSize: leg.tickSize, minimumOrderSize: leg.minimumOrderSize });
    if (!w.fullyFillable || !w.meetsMinimumOrder) fullyFillable = false;
    const f = fees.computeFee({ provider: leg.provider, quantity: w.filledQuantity, price: w.vwap, override: leg.feeOverride });
    if (f.feeStatus !== 'known') feeStatus = 'unknown';
    const grossCost = w._scaled.grossCost;
    const feeScaled = f._scaledFee || D.ZERO;
    rawCost = D.add(rawCost, grossCost);
    feeTotal = D.add(feeTotal, feeScaled);
    legOut.push({
      provider: leg.provider, side: leg.side, priceSource: leg.priceSource || 'direct_ask',
      bestPrice: leg.levels && leg.levels[0] ? D.toStr(D.fromStr(leg.levels[0].price)) : null,
      vwap: w.vwap, worstPrice: w.worstPrice, grossCost: w.grossCost,
      fee: f.fee, feeStatus: f.feeStatus, feeScheduleVersion: f.scheduleVersion,
      depthConsumed: w.levelsConsumed, fullyFillable: w.fullyFillable,
      _scaled: { grossCost, fee: feeScaled, vwap: w._scaled.vwap },
    });
  }
  const buffer = D.mul(D.div(bufferBps, D.fromStr('10000')), rawCost); // bps × rawCost
  const payout = q; // N patas complementarias payout $1 → payout = cantidad
  const totalCost = D.add(D.add(rawCost, feeTotal), buffer);
  const capitalRequired = totalCost;
  const grossProfit = D.sub(payout, rawCost);
  const netProfit = D.sub(payout, totalCost);
  const grossRoi = D.cmp(rawCost, D.ZERO) > 0 ? D.div(grossProfit, rawCost) : D.ZERO;
  const netRoi = D.cmp(capitalRequired, D.ZERO) > 0 ? D.div(netProfit, capitalRequired) : D.ZERO;

  // price limit por pata (hint interno para Sprint 4): cuánto puede subir el precio antes de perder el edge
  const netPerShare = D.cmp(q, D.ZERO) > 0 ? D.div(netProfit, q) : D.ZERO;
  legOut.forEach(l => { l.maxAcceptablePrice = D.toStr(D.add(l._scaled.vwap, netPerShare)); });

  return {
    quantity: D.toStr(q), payout: D.toStr(payout),
    rawCost: D.toStr(rawCost), feeTotal: D.toStr(feeTotal), feeStatus,
    executionBuffer: D.toStr(buffer), totalCost: D.toStr(totalCost), capitalRequired: D.toStr(capitalRequired),
    grossProfit: D.toStr(grossProfit), netProfit: D.toStr(netProfit),
    grossRoi: D.toStr(grossRoi), netRoi: D.toStr(netRoi),
    fullyFillable, legs: legOut,
    _scaled: { netProfit, netRoi, rawCost, totalCost },
  };
}

module.exports = { evaluateArb };
