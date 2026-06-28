// gp-product/confidence.js — Fuente ÚNICA de verdad de la confianza del análisis GP (Corte 2.1 A.1).
// El MISMO valor canónico (LOW/MEDIUM/HIGH) controla badge, color, Decision Memo, texto de riesgo,
// Data Trust y CTA en el cliente. La narrativa NUNCA debe inventar un nivel distinto (ni "moderada"
// cuando el valor es LOW). Módulo PURO (sin IO) → testeable.
'use strict';

const LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

// Calcula el nivel canónico de confianza de forma determinística desde señales del análisis.
// inputs:
//  - uncertaintyScore: 0–100 (mayor = más incertidumbre del modelo) | null
//  - contextCompleteness: 0–1 | null
//  - dataFreshness: 'FRESH'|'AGING'|'STALE' | null
//  - risks: array de códigos de riesgo ya calculados (LARGE_MARKET_DISAGREEMENT, etc.)
function computeConfidence({ uncertaintyScore = null, contextCompleteness = null, dataFreshness = null, risks = [] } = {}) {
  let score = 0;
  if (uncertaintyScore != null && Number.isFinite(Number(uncertaintyScore))) {
    const u = Number(uncertaintyScore);
    if (u >= 50) score -= 2;
    else if (u >= 30) score -= 1;
    else if (u <= 15) score += 1;
  }
  if (contextCompleteness != null && Number.isFinite(Number(contextCompleteness))) {
    const c = Number(contextCompleteness);
    if (c >= 0.8) score += 1;
    else if (c < 0.4) score -= 1;
  }
  if (dataFreshness === 'STALE') score -= 1;
  const r = new Set(risks || []);
  if (r.has('LARGE_MARKET_DISAGREEMENT')) score -= 1;
  if (r.has('MODEL_UNCERTAINTY')) score -= 1;
  if (r.has('LINEUP_NOT_CONFIRMED')) score -= 1;
  if (r.has('CONTEXT_INCOMPLETE')) score -= 1;
  if (score <= -2) return 'LOW';
  if (score >= 2) return 'HIGH';
  return 'MEDIUM';
}

function isValidLevel(x) { return LEVELS.indexOf(x) >= 0; }

module.exports = { LEVELS, computeConfidence, isValidLevel };
