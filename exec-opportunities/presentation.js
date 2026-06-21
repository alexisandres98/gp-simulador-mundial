// exec-opportunities/presentation.js — Sprint 4. Construye el payload PÚBLICO desde una evaluación del motor.
// Principio: REDACCIÓN por lista blanca. Nunca se hace spread del objeto crudo. No se exponen:
//   snapshot ids, input_hash, order books completos, versiones internas de seguridad, ni secretos.
// El payload es "simple en la superficie, riguroso al profundizar": la card es una proyección del detalle.
'use strict';

const cfg = require('./config');

// ---------- formateadores (display, además de los valores numéricos crudos) ----------
const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
function pct(v, dp = 2) { const x = n(v); return x === null ? null : (x * 100).toFixed(dp) + '%'; }
function cents(price, dp = 1) { const x = n(price); return x === null ? null : (x * 100).toFixed(dp) + '¢'; }
function money(v, dp = 2) { const x = n(v); return x === null ? null : '$' + x.toFixed(dp); }
function ageSeconds(fromISO, now) {
  if (!fromISO) return null;
  const t = new Date(fromISO).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

// Etiqueta de producto en español (nunca "garantizado").
function classLabel(classification) {
  if (classification === 'pure_arb') return 'Arbitraje ejecutable estimado';
  if (classification === 'execution_sensitive') return 'Arbitraje sensible a ejecución';
  return 'No publicable';
}
function classBadge(classification) {
  if (classification === 'pure_arb') return 'PURE ARB';
  if (classification === 'execution_sensitive') return 'EXEC-SENSITIVE';
  return classification;
}

// Traducción de códigos de warning del motor → texto humano (es).
const WARNING_TEXT = {
  derived_ask: 'Uno de los precios es derivado del complemento (no es un ask directo).',
  thin_executable_size: 'Tamaño ejecutable fino: poca profundidad disponible.',
  high_volatility: 'Volatilidad alta en la ventana reciente: el precio puede moverse rápido.',
  near_time_skew_limit: 'Los snapshots de las patas están cerca del límite de diferencia temporal.',
  thin_margin: 'Margen neto fino: cualquier movimiento de precio puede eliminarlo.',
};
// Riesgos estructurales que SIEMPRE aplican (sección 14G del spec).
const STRUCTURAL_RISKS = [
  'El precio puede cambiar antes de completar ambas operaciones.',
  'La profundidad observada puede desaparecer.',
  'Cada pata se ejecuta por separado: existe riesgo de ejecución parcial.',
  'La elegibilidad depende de tu jurisdicción.',
  'Las plataformas son de terceros; sus fees y reglas pueden variar.',
  'Una suspensión o anulación (void) del mercado puede afectar el resultado.',
];

// Resumen de equivalencia de reglas (solo "confirmada" si el grafo canónico lo dice).
function rulesSummary(mappingStatus, rulesFingerprint) {
  const matched = mappingStatus === 'matched' && !!rulesFingerprint;
  return {
    equivalence: matched ? 'confirmed' : 'unconfirmed',
    label: matched ? 'Equivalencia de reglas confirmada' : 'Equivalencia de reglas no confirmada',
    // Dimensiones que el Canonical Graph compara (período/prórroga/penales/empate/settlement/cancelación).
    dimensions: ['período', 'prórroga', 'penales', 'empate', 'settlement', 'cancelación', 'fuente de resolución'],
  };
}

// ---------- leg público (sin order book completo) ----------
function publicLeg(legEval, legMeta) {
  return {
    provider: legMeta.provider || legEval.provider || null,
    provider_label: providerLabel(legMeta.provider || legEval.provider),
    outcome: legMeta.outcomeName || legMeta.side || legEval.side || null,
    side: legEval.side || null,
    quantity: legEval.quantity != null ? String(legEval.quantity) : null,
    best_price: legEval.bestPrice != null ? String(legEval.bestPrice) : null,
    best_price_cents: cents(legEval.bestPrice),
    vwap: legEval.vwap != null ? String(legEval.vwap) : null,
    vwap_cents: cents(legEval.vwap),
    worst_price: legEval.worstPrice != null ? String(legEval.worstPrice) : null,
    worst_price_cents: cents(legEval.worstPrice),
    // precio límite por pata: por encima de esto el margen estimado cae bajo el mínimo.
    max_acceptable_price: legEval.maxAcceptablePrice != null ? String(legEval.maxAcceptablePrice) : null,
    max_acceptable_price_cents: cents(legEval.maxAcceptablePrice),
    fee: legEval.fee != null ? String(legEval.fee) : null,
    fee_display: money(legEval.fee),
    fee_status: legEval.feeStatus || null,
    levels_consumed: legEval.depthConsumed != null ? legEval.depthConsumed : null,
    price_source: legEval.priceSource || null,
    price_source_label: legEval.priceSource === 'derived_from_complement_bid' ? 'derivado del complemento' : 'ask directo',
    snapshot_age_ms: legMeta.snapshotAgeMs != null ? legMeta.snapshotAgeMs : null,
  };
}

function providerLabel(code) {
  const map = { polymarket: 'Polymarket', kalshi: 'Kalshi' };
  return map[String(code || '').toLowerCase()] || (code ? String(code) : null);
}

// buildPublicPayload(ev, ctx) → payload redactado para la vista de DETALLE pública.
//   ev  = salida de arb-engine evaluateCandidate (o adaptada desde DB; ver adapters.js).
//   ctx = { publicId, event, market, detectedAt, lastValidatedAt, expiresAt, now,
//           jurisdictionStatus, deepLinks, legMeta:[{provider, side, outcomeName, snapshotAgeMs}] }
function buildPublicPayload(ev, ctx = {}) {
  const now = ctx.now || Date.now();
  const e = ev.evaluation || {};
  const legMeta = ctx.legMeta || [];
  const maxEval = (ev.maxSize && ev.maxSize.evaluation) || null;

  // Beneficio neto estimado al tamaño máximo (no al tamaño de referencia=1).
  const maxCapital = maxEval ? maxEval.capitalRequired : null;
  const maxNetProfit = maxEval ? maxEval.netProfit : null;
  const maxNetRoi = maxEval ? maxEval.netRoi : (e.netRoi != null ? e.netRoi : null);

  const payload = {
    public_id: ctx.publicId || null,
    title: classLabel(ev.classification),
    badge: classBadge(ev.classification),
    event: ctx.event || null,                       // p.ej. "España vs. Uruguay"
    market: ctx.market || null,                     // p.ej. "Ganador del partido — 90 minutos"
    classification: ev.classification,
    strategy: ev.strategy || null,

    // tiempos
    detected_at: ctx.detectedAt || null,
    last_validated_at: ctx.lastValidatedAt || null,
    detected_age_seconds: ageSeconds(ctx.detectedAt, now),
    validation_age_seconds: ageSeconds(ctx.lastValidatedAt, now),
    expires_at: ctx.expiresAt || null,
    leg_time_skew_ms: ev.legTimeSkewMs != null ? ev.legTimeSkewMs : null,

    // desglose económico (al tamaño de referencia)
    economics: {
      gross_margin: e.grossRoi != null ? String(e.grossRoi) : null,
      gross_margin_pct: pct(e.grossRoi),
      fees_total: e.feeTotal != null ? String(e.feeTotal) : null,
      fees_total_display: money(e.feeTotal),
      // coste por profundidad = peor caso de slippage del VWAP frente al mejor precio (informativo)
      book_slippage_total: e.bookSlippageTotal != null ? String(e.bookSlippageTotal) : null,
      execution_buffer_total: e.executionBuffer != null ? String(e.executionBuffer) : null,
      execution_buffer_display: money(e.executionBuffer),
      net_margin: e.netRoi != null ? String(e.netRoi) : null,
      net_margin_pct: pct(e.netRoi),
      net_roi: e.netRoi != null ? String(e.netRoi) : null,
      raw_cost: e.rawCost != null ? String(e.rawCost) : null,
      total_cost: e.totalCost != null ? String(e.totalCost) : null,
      payout: e.payout != null ? String(e.payout) : null,
      fee_status: e.feeStatus || null,
    },

    // tamaño ejecutable (al máximo, con su ROI propio)
    sizing: {
      max_executable_capital: maxCapital != null ? String(maxCapital) : null,
      max_executable_capital_display: money(maxCapital),
      estimated_net_profit_at_max: maxNetProfit != null ? String(maxNetProfit) : null,
      estimated_net_profit_at_max_display: money(maxNetProfit),
      net_roi_at_max: maxNetRoi != null ? String(maxNetRoi) : null,
      net_roi_at_max_pct: pct(maxNetRoi),
      max_quantity: ev.maxSize && ev.maxSize.maxQuantity != null ? String(ev.maxSize.maxQuantity) : null,
    },

    // confianza = "calidad de ejecución estimada" (no es probabilidad de ganar)
    confidence: {
      score: ev.confidence ? ev.confidence.score : null,
      label: ev.confidence ? ev.confidence.label : null,
      label_es: confLabelEs(ev.confidence && ev.confidence.label),
      // razones: solo los factores que penalizaron (sin exponer la fórmula interna completa)
      reasons: (ev.confidence && Array.isArray(ev.confidence.factors)
        ? ev.confidence.factors.filter(f => f.warning).map(f => ({ factor: f.factor, note: f.warning }))
        : []),
    },

    // equivalencia de reglas
    rules: rulesSummary(ev.mappingStatusForDisplay || ctx.mappingStatus, ev.rulesFingerprint),
    mapping_status: ctx.mappingStatus || ev.mappingStatusForDisplay || null,

    // patas (sin order books completos)
    legs: (e.legs || []).map((lg, i) => publicLeg(lg, legMeta[i] || {})),

    // warnings traducidos + riesgos estructurales
    warnings: (ev.warnings || []).map(w => ({ code: w, text: WARNING_TEXT[w] || w })),
    structural_risks: STRUCTURAL_RISKS,

    // jurisdicción y deep links (pueden venir nulos si el flag está apagado)
    jurisdiction_status: ctx.jurisdictionStatus || 'unknown',
    deep_links: ctx.deepLinks || [],

    // metodología (versiones públicas seguras; no internas de seguridad)
    methodology: {
      engine_version: ev.versions ? ev.versions.engine : null,
      fee_engine_version: ev.versions ? ev.versions.feeEngine : null,
      classifier_version: ev.versions ? ev.versions.classifier : null,
      layer_version: cfg.LAYER_VERSION,
      payload_version: cfg.PAYLOAD_VERSION,
      risk_disclosure_version: cfg.RISK_DISCLOSURE_VERSION,
    },

    disclaimer: 'Estimación basada en precios y profundidad observados. Las condiciones pueden cambiar antes de completar ambas operaciones. Verifica fees, reglas y elegibilidad directamente con cada plataforma.',
  };

  return payload;
}

function confLabelEs(label) {
  if (label === 'high') return 'alta';
  if (label === 'medium') return 'media';
  if (label === 'low') return 'baja';
  return null;
}

// buildCardPayload(payload) → proyección compacta para la lista (la card no muestra la complejidad).
function buildCardPayload(payload) {
  if (!payload) return null;
  return {
    public_id: payload.public_id,
    badge: payload.badge,
    classification: payload.classification,
    event: payload.event,
    market: payload.market,
    // métrica principal = NETO (nunca destacar el bruto por encima del neto)
    net_margin_pct: payload.economics.net_margin_pct,
    max_executable_capital_display: payload.sizing.max_executable_capital_display,
    estimated_net_profit_at_max_display: payload.sizing.estimated_net_profit_at_max_display,
    validation_age_seconds: payload.validation_age_seconds,
    detected_age_seconds: payload.detected_age_seconds,
    expires_at: payload.expires_at,
    confidence_label_es: payload.confidence.label_es,
    rules_confirmed: payload.rules.equivalence === 'confirmed',
    legs: payload.legs.map(l => ({ provider_label: l.provider_label, outcome: l.outcome, best_price_cents: l.best_price_cents })),
    jurisdiction_status: payload.jurisdiction_status,
    has_warnings: (payload.warnings || []).length > 0,
  };
}

module.exports = {
  buildPublicPayload,
  buildCardPayload,
  // helpers exportados para tests
  _fmt: { pct, cents, money, ageSeconds, classLabel, classBadge },
  STRUCTURAL_RISKS,
  WARNING_TEXT,
};
