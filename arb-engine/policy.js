// arb-engine/policy.js — Fase R.3 §12/§13. Policy versionada `arbitrage-policy-1` + síntesis del ESTADO de la
// oportunidad combinando todos los gates: semántico (R.1), contemporaneidad temporal + capacidad (R.2),
// cálculo neto (fees/slippage/depth) y elegibilidad. Una oportunidad EXECUTABLE debe pasar TODOS los gates
// (§12). Ante duda → THEORETICAL_ONLY / PARTIAL_EXECUTION_RISK / BLOCKED — nunca "ganancia garantizada" sin
// capacidad+settlement+frescura confirmados (§10). Sin override silencioso. Thresholds versionados, no se
// modifican para fabricar oportunidades. PURO (sin IO).
'use strict';
const D = require('./decimal');

const POLICY_VERSION = 'arbitrage-policy-1';
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

// estados §12 (orden de severidad para el cliente)
const STATES = ['BLOCKED', 'EXPIRED', 'SUSPENDED', 'STALE', 'DEGRADED', 'THEORETICAL_ONLY',
  'PARTIAL_EXECUTION_RISK', 'EXECUTABLE', 'VALIDATING', 'DETECTED', 'SETTLED'];

function policy(env = process.env) {
  return {
    version: POLICY_VERSION,
    minNetMargin: num(env.ARB_POLICY_MIN_NET_MARGIN, num(env.ARB_MIN_NET_ROI, 0.005)),
    minExecutableCapital: num(env.ARB_POLICY_MIN_EXEC_CAPITAL, num(env.ARB_MIN_EXECUTABLE_CAPITAL, 25)),
    minExecutableSize: num(env.ARB_POLICY_MIN_EXEC_SIZE, 1),
    minIndependentVenues: num(env.ARB_POLICY_MIN_VENUES, 2),
    requireFeesKnown: true,
    requireCapacityConfirmed: true,        // EXECUTABLE exige capacidad CONFIRMED (no inventada)
    requireSemanticOk: true,               // EXECUTABLE exige semantic.ok (sin ambigüedad)
    requireTemporalOk: true,               // EXECUTABLE exige contemporaneidad
    allowedFamilies: ['MATCH_RESULT', 'MATCH_RESULT_2WAY', 'QUALIFY', 'TOTAL_GOALS', 'BINARY', 'TOURNAMENT_WINNER', 'BTTS'],
    allowedCurrencies: ['USD'],
    autoExecution: false,                  // INVARIANTE: nunca ejecución automática
    publicEnabled: false,                  // INVARIANTE: nunca público en esta fase
  };
}

// classifyOpportunity(ev, p) → { state, executable, gates:[{name,ok,detail}], reasons:[], policy_version }
// ev: evaluación del motor (classification, semantic, temporal, capacity, evaluation{netRoi,netProfit,
//     capitalRequired,feeStatus,fullyFillable}, legs implícitas en evaluation.legs).
function classifyOpportunity(ev, p = policy()) {
  const e = ev.evaluation || {};
  const sem = ev.semantic || { ok: false, fatal: false };
  const tmp = ev.temporal || { ok: false, reasons: [] };
  const cap = ev.capacity || { capacity_status: 'UNKNOWN' };
  const cls = ev.classification;
  const tReasons = tmp.reasons || [];
  const gates = [];
  const gate = (name, ok, detail) => { gates.push({ name, ok: !!ok, detail }); return !!ok; };

  // métricas de cálculo
  const grossPos = e.grossProfit != null && D.cmp(D.fromStr(String(e.grossProfit)), D.ZERO) > 0;
  const netPos = e.netProfit != null && D.cmp(D.fromStr(String(e.netProfit)), D.ZERO) > 0;
  const roiOk = e.netRoi != null && D.cmp(D.fromStr(String(e.netRoi)), D.fromStr(String(p.minNetMargin))) >= 0;
  const feesKnown = e.feeStatus === 'known';
  const fullyFillable = !!e.fullyFillable;
  const venues = new Set((e.legs || []).map(l => l.provider)).size;

  // gates duros (cualquiera roto y sería ejecutable → no lo es)
  const gSemantic = gate('semantic', sem.ok, sem.sub_reason);
  const gTemporal = gate('temporal', tmp.ok, tReasons[0]);
  const gCapacity = gate('capacity_confirmed', cap.capacity_status === 'CONFIRMED', cap.capacity_status);
  const gFees = gate('fees_known', feesKnown);
  const gNet = gate('positive_net_margin', netPos && roiOk);
  const gFill = gate('fully_fillable', fullyFillable);
  const gVenues = gate('independent_venues', venues >= p.minIndependentVenues, venues);
  const gFamily = gate('allowed_family', !sem.blockers || !sem.blockers.some(b => b.code === 'UNSUPPORTED_FAMILY'));

  // 1) bloqueos terminales por contemporaneidad/estado
  if (sem.fatal) return out('BLOCKED', false, gates, ['semantic_fatal:' + (sem.sub_reason || '')], p);
  if (tReasons.includes('EVENT_STARTED')) return out('EXPIRED', false, gates, ['event_started'], p);
  if (tReasons.includes('LEG_SUSPENDED')) return out('SUSPENDED', false, gates, ['leg_suspended'], p);
  if (tReasons.includes('LEG_STALE') || tReasons.includes('DERIVED_LEG_STALE') || tReasons.includes('CROSS_LEG_SPREAD_EXCEEDED') || tReasons.includes('FUTURE_SNAPSHOT') || tReasons.includes('MISSING_TIMESTAMP')) {
    return out('STALE', false, gates, tReasons, p);
  }

  // 2) ni siquiera hay edge bruto / rechazo duro del motor → BLOCKED (no es oportunidad)
  if (cls === 'rejected' || cls === 'conditional' || !grossPos) return out('BLOCKED', false, gates, ev.reasons || ['no_edge'], p);

  // 3) hay edge: ¿es EXECUTABLE (todos los gates) o degradada?
  const executableGates = gSemantic && gTemporal && gCapacity && gFees && gNet && gFill && gVenues && gFamily;
  if (executableGates) return out('EXECUTABLE', true, gates, [], p);

  // 4) edge bruto presente pero no cierra como ejecutable → razón del degradado
  // capacidad no confirmada / semántica ambigua → THEORETICAL_ONLY; capacidad parcial / fill parcial → PARTIAL
  if (!gFees || !gNet || !gFill && cap.capacity_status === 'UNKNOWN' || !gSemantic || cap.capacity_status === 'UNKNOWN') {
    return out('THEORETICAL_ONLY', false, gates, degradeReasons(gates), p);
  }
  if (cap.capacity_status === 'CONSERVATIVE' || !gFill || ev.warnings && ev.warnings.length) {
    return out('PARTIAL_EXECUTION_RISK', false, gates, degradeReasons(gates), p);
  }
  return out('THEORETICAL_ONLY', false, gates, degradeReasons(gates), p);
}

function degradeReasons(gates) { return gates.filter(g => !g.ok).map(g => g.name); }
function out(state, executable, gates, reasons, p) {
  return { state, executable: !!executable, gates, reasons, policy_version: p.version };
}

module.exports = { policy, classifyOpportunity, POLICY_VERSION, STATES };
