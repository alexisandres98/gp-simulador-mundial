// exec-opportunities/calculatorService.js — Sprint 4 §15-16. Calculadora de capital SERVER-SIDE.
// Matemática y general. NO pregunta bankroll ni recomienda % de patrimonio. NO guarda el capital introducido.
// Recalcula siempre server-side con la última evaluación válida; si expiró, NO devuelve el cálculo antiguo.
// Usa la búsqueda en BREAKPOINTS (segura ante la no-monotonicidad por ceil de fees) — ver breakpoints.js.
'use strict';

const cfg = require('./config');
const D = require('../arb-engine/decimal');
const { breakpointMaxSize } = require('./breakpoints');

const money = v => { const x = parseFloat(v); return Number.isFinite(x) ? '$' + x.toFixed(2) : null; };
const cents = v => { const x = parseFloat(v); return Number.isFinite(x) ? (x * 100).toFixed(1) + '¢' : null; };
const pct = v => { const x = parseFloat(v); return Number.isFinite(x) ? (x * 100).toFixed(2) + '%' : null; };

// validateInput(input) → { ok, reason } | { ok:true, capital, minRoi, bufferBps }
function validateInput(input = {}) {
  const cap = parseFloat(input.capital);
  if (!Number.isFinite(cap)) return { ok: false, reason: 'capital_invalid' };
  if (cap <= 0) return { ok: false, reason: 'capital_must_be_positive' };
  const maxCap = parseFloat(cfg.calculator.maxCapital);
  if (cap > maxCap) return { ok: false, reason: 'capital_exceeds_limit' };

  // ROI mínimo opcional: el efectivo nunca baja del mínimo de publicación.
  let minRoi = cfg.publication.minNetRoi;
  if (input.minRoi != null && input.minRoi !== '') {
    const r = parseFloat(input.minRoi);
    if (!Number.isFinite(r) || r < 0) return { ok: false, reason: 'min_roi_invalid' };
    if (D.cmp(D.fromStr(String(r)), D.fromStr(cfg.publication.minNetRoi)) > 0) minRoi = String(r);
  }

  // Buffer de ejecución: solo admin puede tocarlo, y NUNCA por debajo del mínimo seguro.
  let bufferBps = cfg.calculator.minExecutionBufferBps;
  if (input.executionBufferBps != null && input.isAdmin) {
    const b = parseInt(input.executionBufferBps, 10);
    if (Number.isFinite(b)) bufferBps = Math.max(b, cfg.calculator.minExecutionBufferBps);
  }
  return { ok: true, capital: String(cap), minRoi, bufferBps };
}

// calculate(input, source) → resultado.
//   input  = { capital, minRoi?, executionBufferBps?, isAdmin? }
//   source = { legs, strategy, evaluationId, validUntil, expired, legMeta, now }
//            'legs' son las patas de la ÚLTIMA evaluación válida (revalidada por el caller).
function calculate(input, source = {}) {
  const now = source.now || Date.now();

  // 1) Si la oportunidad expiró, no devolver silenciosamente el cálculo antiguo.
  if (source.expired) {
    return { available: false, message: 'Esta oportunidad ya no está disponible con los precios observados.', calculated_at: new Date(now).toISOString(), evaluation_id: source.evaluationId || null };
  }

  // 2) Validar input.
  const v = validateInput(input);
  if (!v.ok) return { available: true, feasible: false, error: v.reason, message: inputErrorMessage(v.reason), calculated_at: new Date(now).toISOString() };

  const opts = { minNetRoi: v.minRoi, maxCapital: v.capital, executionBufferBps: v.bufferBps };

  // 3) Recalcular server-side: máximo tamaño que cabe en el capital al ROI exigido (búsqueda segura).
  const res = breakpointMaxSize(source.legs || [], opts);
  if (!res.evaluation || !(parseFloat(res.maxQuantity) > 0)) {
    return {
      available: true, feasible: false,
      message: 'Con ese capital y ROI mínimo no hay un tamaño ejecutable en la profundidad observada.',
      calculated_at: new Date(now).toISOString(), valid_until: source.validUntil || null, evaluation_id: source.evaluationId || null,
      warnings: ['no_feasible_size_for_capital'],
    };
  }

  const e = res.evaluation;
  const legMeta = source.legMeta || [];
  const strategy = source.strategy || (e.legs.length === 3 ? '1x2' : 'binary');

  const legs = e.legs.map((lg, i) => ({
    provider: lg.provider,
    provider_label: providerLabel(lg.provider),
    outcome: (legMeta[i] && legMeta[i].outcomeName) || lg.side,
    side: lg.side,
    contracts: e.quantity,
    capital_on_platform: lg.grossCost,
    capital_on_platform_display: money(lg.grossCost),
    fee: lg.fee,
    fee_display: money(lg.fee),
    vwap_cents: cents(lg.vwap),
    // precio límite por pata: no ejecutar por encima de esto.
    price_limit: lg.maxAcceptablePrice,
    price_limit_cents: cents(lg.maxAcceptablePrice),
  }));

  const out = {
    available: true,
    feasible: true,
    strategy,
    contracts_per_leg: e.quantity,
    legs,
    capital_required: e.capitalRequired,
    capital_required_display: money(e.capitalRequired),
    payout: e.payout,
    payout_display: money(e.payout),
    // beneficio mínimo estimado (cualquier resultado, por ser patas complementarias payout $1)
    estimated_min_profit: e.netProfit,
    estimated_min_profit_display: money(e.netProfit),
    net_roi: e.netRoi,
    net_roi_pct: pct(e.netRoi),
    fees_total: e.feeTotal,
    fees_total_display: money(e.feeTotal),
    execution_buffer: e.executionBuffer,
    execution_buffer_bps: v.bufferBps,
    calculated_at: new Date(now).toISOString(),
    valid_until: source.validUntil || null,
    evaluation_id: source.evaluationId || null,
    warnings: [
      'El cálculo asume que la profundidad observada sigue disponible; revalida antes de ejecutar.',
      'Cada pata se ejecuta por separado: existe riesgo de ejecución parcial.',
    ],
    disclaimer: 'Estimación basada en los últimos precios observados. No es una oferta ni garantiza ejecución.',
  };

  // Escenarios YES/NO para binario (ambos pagan lo mismo por ser complementarios).
  if (strategy === 'binary') {
    out.scenario_yes_payout = e.payout;
    out.scenario_no_payout = e.payout;
  }
  return out;
}

function providerLabel(code) { const m = { polymarket: 'Polymarket', kalshi: 'Kalshi' }; return m[String(code || '').toLowerCase()] || code || null; }

function inputErrorMessage(reason) {
  const map = {
    capital_invalid: 'Ingresa un capital válido.',
    capital_must_be_positive: 'El capital debe ser mayor que cero.',
    capital_exceeds_limit: 'El capital supera el máximo permitido por la calculadora.',
    min_roi_invalid: 'El ROI mínimo no es válido.',
  };
  return map[reason] || 'Entrada no válida.';
}

module.exports = { calculate, validateInput };
