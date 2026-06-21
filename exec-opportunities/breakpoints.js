// exec-opportunities/breakpoints.js — Sprint 4 §40. Hardening del size optimizer.
// El optimizer del motor (sizeOptimizer.findMaxSize) usa BÚSQUEDA BINARIA asumiendo que el net ROI
// decrece monótonamente con la cantidad. Pero la fee de Kalshi redondea con ceil() y existen ticks,
// minimum sizes y breakpoints del book → puede haber pequeños saltos discretos.
// Aquí construimos: (1) un ORÁCULO por scan denso, (2) una búsqueda exhaustiva en breakpoints como
// reemplazo seguro, y (3) un comparador que verifica la condición del spec:
//   "El optimizador nunca puede devolver un tamaño mayor NO elegible, ni perder un tamaño elegible
//    materialmente superior."
'use strict';

const D = require('../arb-engine/decimal');
const { evaluateArb } = require('../arb-engine/arbCore');
const { findMaxSize } = require('../arb-engine/sizeOptimizer');

// feasibility de una cantidad (mismos criterios que el motor).
function feasibleAt(legs, qStr, opts) {
  const minNetRoi = D.fromStr(String(opts.minNetRoi || '0'));
  const maxCapital = opts.maxCapital != null ? D.fromStr(String(opts.maxCapital)) : null;
  const ev = evaluateArb(legs, qStr, opts);
  const okRoi = D.cmp(ev._scaled.netRoi, minNetRoi) >= 0;
  const okCap = maxCapital == null || D.cmp(ev._scaled.totalCost, maxCapital) <= 0;
  return { ok: ev.fullyFillable && ev.feeStatus === 'known' && okRoi && okCap, ev };
}

function maxDepth(legs) {
  let hi = null;
  for (const leg of legs) {
    let depth = D.ZERO;
    for (const lv of (leg.levels || [])) { const s = D.fromStr(lv.size); if (D.isPos(s)) depth = D.add(depth, s); }
    hi = hi == null ? depth : D.min(hi, depth);
  }
  return hi || D.ZERO;
}

// enumerateBreakpoints(legs) → cantidades candidatas (frontera de cada nivel acumulado, por pata).
// En esas fronteras cambia el precio marginal → cambia el VWAP y la fee. El óptimo elegible está
// en una frontera o donde una restricción (capital/ROI) se vuelve vinculante.
function enumerateBreakpoints(legs) {
  const set = new Set(['1']); // mínimo 1 contrato
  for (const leg of legs) {
    let cum = D.ZERO;
    const sorted = (leg.levels || []).slice().sort((a, b) => D.cmp(D.fromStr(a.price), D.fromStr(b.price)));
    for (const lv of sorted) {
      const s = D.fromStr(lv.size);
      if (!D.isPos(s)) continue;
      cum = D.add(cum, s);
      set.add(D.toStr(cum));
    }
  }
  return Array.from(set).map(s => D.fromStr(s)).sort((a, b) => D.cmp(a, b));
}

// breakpointMaxSize(legs, opts) → reemplazo seguro: evalúa cada frontera y, en el cruce de factibilidad,
// hace una micro-búsqueda binaria DENTRO del segmento (la restricción de capital es continua).
function breakpointMaxSize(legs, opts = {}) {
  const hi = maxDepth(legs);
  if (!D.isPos(hi)) return { maxQuantity: '0', evaluation: null, reason: 'no_depth' };
  const bps = enumerateBreakpoints(legs).filter(q => D.cmp(q, hi) <= 0);
  let bestQ = D.ZERO, bestEv = null, lastFeasible = D.ZERO, firstInfeasible = null;

  for (const q of bps) {
    const f = feasibleAt(legs, D.toStr(q), opts);
    if (f.ok) { if (D.cmp(q, bestQ) > 0) { bestQ = q; bestEv = f.ev; } lastFeasible = q; }
    else if (firstInfeasible == null && D.cmp(q, lastFeasible) > 0) { firstInfeasible = q; }
  }
  // micro-búsqueda binaria entre la última frontera factible y la primera no factible (cruce continuo)
  if (firstInfeasible != null) {
    let lo = lastFeasible, hiB = firstInfeasible;
    const one = D.fromStr('1');
    for (let i = 0; i < 48 && D.cmp(D.sub(hiB, lo), one) > 0; i++) {
      const mid = (lo + hiB) / 2n;
      const f = feasibleAt(legs, D.toStr(mid), opts);
      if (f.ok) { lo = mid; if (D.cmp(mid, bestQ) > 0) { bestQ = mid; bestEv = f.ev; } } else { hiB = mid; }
    }
  }
  if (!bestEv || !D.isPos(bestQ)) return { maxQuantity: '0', evaluation: null, reason: 'no_feasible_size' };
  return { maxQuantity: D.toStr(bestQ), evaluation: bestEv };
}

// denseScanMaxSize(legs, opts, { maxSteps }) → ORÁCULO: prueba q = step, 2·step, ... hasta la profundidad.
// Caro; solo para tests con profundidades modestas. step se ajusta para no exceder maxSteps evaluaciones.
function denseScanMaxSize(legs, opts = {}, { maxSteps = 4000 } = {}) {
  const hi = maxDepth(legs);
  if (!D.isPos(hi)) return { maxQuantity: '0', evaluation: null, reason: 'no_depth' };
  const hiNum = parseFloat(D.toStr(hi));
  const step = Math.max(1, Math.ceil(hiNum / maxSteps));
  let bestQ = 0, bestEv = null;
  for (let q = step; q <= hiNum + 1e-9; q += step) {
    const qq = Math.min(q, hiNum);
    const f = feasibleAt(legs, String(qq), opts);
    if (f.ok && qq > bestQ) { bestQ = qq; bestEv = f.ev; }
  }
  // y la frontera exacta
  const fHi = feasibleAt(legs, D.toStr(hi), opts);
  if (fHi.ok && hiNum > bestQ) { bestQ = hiNum; bestEv = fHi.ev; }
  if (!bestEv || bestQ <= 0) return { maxQuantity: '0', evaluation: null, reason: 'no_feasible_size' };
  return { maxQuantity: String(bestQ), evaluation: bestEv };
}

// compareOptimizers(legs, opts, { materialPct, materialAbs }) → diagnóstico para el hardening test.
//   binaryFeasible        : el resultado de la binaria del motor ES elegible (no devuelve tamaño no elegible).
//   missesMaterial        : la binaria pierde un tamaño elegible materialmente superior frente al oráculo.
function compareOptimizers(legs, opts = {}, { materialPct = 0.02, materialAbs = 5, oracleSteps = 4000 } = {}) {
  const binary = findMaxSize(legs, opts);
  const breakpoint = breakpointMaxSize(legs, opts);
  const oracle = denseScanMaxSize(legs, opts, { maxSteps: oracleSteps });

  const bq = parseFloat(binary.maxQuantity || '0');
  const oq = parseFloat(oracle.maxQuantity || '0');

  // ¿El tamaño de la binaria es realmente elegible?
  const binaryFeasible = bq <= 0 ? true : feasibleAt(legs, String(bq), opts).ok;

  // ¿Pierde un tamaño materialmente superior?
  const gap = oq - bq;
  const missesMaterial = gap > materialAbs && (oq > 0 ? gap / oq > materialPct : false);

  return {
    binary: binary.maxQuantity, breakpoint: breakpoint.maxQuantity, oracle: oracle.maxQuantity,
    binaryFeasible, missesMaterial, gap,
    ok: binaryFeasible && !missesMaterial,
  };
}

module.exports = { enumerateBreakpoints, breakpointMaxSize, denseScanMaxSize, compareOptimizers, feasibleAt, maxDepth };
