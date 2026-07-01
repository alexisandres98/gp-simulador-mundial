// arb-engine/feeEngine.js — motor de fees VERSIONADO (Sprint 3). Aritmética decimal.
// NO hardcodea una fee global. Distingue proveedor/fórmula/taker. Si la fee no es fiable → `unknown`
// y la oportunidad NO puede ser Pure Arb ejecutable. V1 usa TAKER (ejecución inmediata).
//
// Schedules versionados (en código; la tabla provider_fee_schedules los persiste/auditará). Fuente y
// fecha de verificación incluidas. No se cuenta una fee dos veces; se calcula la de ENTRADA (taker).

'use strict';
const D = require('./decimal');

const SCHEDULES = {
  // Polymarket Fee V2 (30-mar-2026): la fee dejó de ser 0%. Por categoría: DEPORTES 3%, política 4%, cripto 7%.
  // El arb-engine solo cubre mercados del Mundial (deportes) → 3%. Aparte hay gas de Polygon (no modelado aquí).
  // Subir de 0→3% ENDURECE el gate (correcto): menos falsos "pure_arb". Fuente: docs.polymarket.com/trading/fees.
  polymarket: { version: 'pm-fee-2', feeType: 'flat_rate', rate: '0.03', status: 'known', taker: true, source: 'polymarket Fee V2 (sports 3%)', checkedAt: '2026-07-01' },
  // Kalshi: fee taker = ceil_cents(0.07 × contracts × price × (1−price)). Fórmula pública.
  kalshi: { version: 'ks-fee-1', feeType: 'kalshi_formula', coefficient: '0.07', status: 'known', taker: true, source: 'kalshi fee schedule', checkedAt: '2026-06-21' },
};

// redondeo HACIA ARRIBA al centavo (Kalshi redondea la fee hacia arriba)
function ceilCents(scaled) {
  const cent = D.fromStr('0.01');
  // ceil(scaled / cent) * cent
  let q = scaled / cent; // división entera de BigInts escalados → (scaled/F)/(0.01) ... cuidado con escala
  // hacemos: units = scaled / cent_scaled, con techo
  const rem = scaled % cent;
  let units = scaled / cent;
  if (rem > 0n) units += 1n;
  return units * cent;
}

// computeFee({ provider, quantity, price, marketStatusKnown, override }) → { fee, feeStatus, scheduleVersion, breakdown }
function computeFee({ provider, quantity, price, override } = {}) {
  const sched = (override && override.schedule) || SCHEDULES[provider];
  if (!sched || sched.status === 'unknown') {
    return { fee: null, feeStatus: 'unknown', scheduleVersion: sched ? sched.version : null, breakdown: { reason: 'no_reliable_fee' } };
  }
  const q = D.fromStr(quantity), p = D.fromStr(price);
  let feeScaled;
  if (sched.feeType === 'flat_rate') {
    // fee = rate × notional(=q×p)  (entrada taker). rate 0 → fee 0.
    feeScaled = D.mul(D.fromStr(sched.rate), D.mul(q, p));
  } else if (sched.feeType === 'kalshi_formula') {
    // fee = ceil_cents( coef × q × p × (1−p) )
    const oneMinusP = D.sub(D.ONE, p);
    const raw = D.mul(D.fromStr(sched.coefficient), D.mul(q, D.mul(p, oneMinusP)));
    feeScaled = ceilCents(raw);
  } else {
    return { fee: null, feeStatus: 'unknown', scheduleVersion: sched.version, breakdown: { reason: 'unsupported_fee_type' } };
  }
  return {
    fee: D.toStr(feeScaled), feeStatus: 'known', scheduleVersion: sched.version,
    breakdown: { feeType: sched.feeType, provider, source: sched.source, checkedAt: sched.checkedAt },
    _scaledFee: feeScaled,
  };
}

function schedule(provider) { return SCHEDULES[provider] || null; }

module.exports = { computeFee, schedule, ceilCents, SCHEDULES };
