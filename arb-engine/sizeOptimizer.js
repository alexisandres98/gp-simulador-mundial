// arb-engine/sizeOptimizer.js — busca el máximo tamaño ejecutable (Sprint 3). Determinístico.
// El net ROI decrece monótonamente con la cantidad (el VWAP empeora al consumir profundidad), así que
// se usa BÚSQUEDA BINARIA sobre cantidades válidas. No prueba cada centavo.

'use strict';
const D = require('./decimal');
const { evaluateArb } = require('./arbCore');

// findMaxSize(legs, { minNetRoi, maxCapital, executionBufferBps }) → { maxQuantity, evaluation }
function findMaxSize(legs, opts = {}) {
  const minNetRoi = D.fromStr(String(opts.minNetRoi || '0'));
  const maxCapital = opts.maxCapital != null ? D.fromStr(String(opts.maxCapital)) : null;
  // profundidad máxima = min de la suma de sizes por pata
  let hi = null;
  for (const leg of legs) {
    let depth = D.ZERO;
    for (const lv of (leg.levels || [])) { const s = D.fromStr(lv.size); if (D.isPos(s)) depth = D.add(depth, s); }
    hi = hi == null ? depth : D.min(hi, depth);
  }
  if (hi == null || !D.isPos(hi)) return { maxQuantity: '0', evaluation: null, reason: 'no_depth' };

  const feasible = (qScaled) => {
    if (!D.isPos(qScaled)) return { ok: false };
    const ev = evaluateArb(legs, D.toStr(qScaled), opts);
    const okRoi = D.cmp(ev._scaled.netRoi, minNetRoi) >= 0;
    const okCap = maxCapital == null || D.cmp(ev._scaled.totalCost, maxCapital) <= 0;
    return { ok: ev.fullyFillable && ev.feeStatus === 'known' && okRoi && okCap, ev };
  };

  // si ni el mínimo (1 unidad escalada) es factible → 0
  const probe = feasible(hi);
  let bestQ = D.ZERO, bestEv = null;
  if (probe.ok) { bestQ = hi; bestEv = probe.ev; }
  else {
    // búsqueda binaria del mayor q factible en (0, hi]
    let lo = D.ZERO, hiB = hi;
    const oneShare = D.fromStr('1');
    for (let i = 0; i < 64 && D.cmp(D.sub(hiB, lo), oneShare) > 0; i++) {
      const mid = (lo + hiB) / 2n;
      const f = feasible(mid);
      if (f.ok) { lo = mid; bestQ = mid; bestEv = f.ev; } else { hiB = mid; }
    }
  }
  if (!bestEv || !D.isPos(bestQ)) return { maxQuantity: '0', evaluation: null, reason: 'no_feasible_size' };
  return { maxQuantity: D.toStr(bestQ), evaluation: bestEv };
}

// evaluateAtReferenceSizes(legs, sizes[], opts) → evaluaciones a tamaños de referencia (informativo)
function evaluateAtReferenceSizes(legs, sizes, opts = {}) {
  return (sizes || []).map(q => ({ quantity: String(q), evaluation: evaluateArb(legs, String(q), opts) }));
}

module.exports = { findMaxSize, evaluateAtReferenceSizes };
