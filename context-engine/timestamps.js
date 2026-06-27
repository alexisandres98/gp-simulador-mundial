// context-engine/timestamps.js — Fase N.2. Jerarquía de timestamps para forward-testing sin leakage.
// PURO. Clasifica la calidad temporal de una observación y aplica la regla forward-only: un dato cuyo único
// timestamp fiable es INGESTION_OBSERVED solo puede usarse en evaluaciones POSTERIORES a su first_seen_at (nunca
// retroactivamente). UNKNOWN → impacto 0. Penaliza confianza vs SOURCE_PUBLISHED.
'use strict';
const ms = v => { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); };

const QUALITY = ['SOURCE_PUBLISHED', 'PROVIDER_UPDATED', 'INGESTION_OBSERVED', 'MANUAL_VERIFIED', 'UNKNOWN'];
// confianza temporal base por calidad (penalty vs SOURCE_PUBLISHED)
const QUALITY_CONFIDENCE = { SOURCE_PUBLISHED: 1.0, PROVIDER_UPDATED: 0.85, MANUAL_VERIFIED: 0.8, INGESTION_OBSERVED: 0.5, UNKNOWN: 0 };

// Determina la calidad de timestamp a partir de lo disponible. manualVerified requiere evidencia (source_reference).
function classifyTimestamp(obs) {
  if (ms(obs.source_published_at) != null || ms(obs.published_at) != null) return 'SOURCE_PUBLISHED';
  if (ms(obs.provider_updated_at) != null) return 'PROVIDER_UPDATED';
  if (obs.manual_verified === true && obs.source_reference) return 'MANUAL_VERIFIED';
  if (ms(obs.first_seen_at) != null || ms(obs.observed_at) != null) return 'INGESTION_OBSERVED';
  return 'UNKNOWN';
}

// El timestamp "efectivo" que debe respetar el cutoff, según la calidad.
function effectiveTimestamp(obs, quality = classifyTimestamp(obs)) {
  switch (quality) {
    case 'SOURCE_PUBLISHED': return ms(obs.source_published_at) ?? ms(obs.published_at);
    case 'PROVIDER_UPDATED': return ms(obs.provider_updated_at);
    case 'MANUAL_VERIFIED': return ms(obs.published_at) ?? ms(obs.first_seen_at) ?? ms(obs.observed_at);
    case 'INGESTION_OBSERVED': return ms(obs.first_seen_at) ?? ms(obs.observed_at); // forward-only: vale desde first_seen_at
    default: return null; // UNKNOWN
  }
}

// ¿Puede esta observación usarse en una evaluación con este cutoff? Forward-only para INGESTION_OBSERVED.
function usableAt(obs, cutoff) {
  const cut = ms(cutoff); if (cut == null) return { usable: false, reason: 'no_cutoff', quality: 'UNKNOWN', confidence: 0 };
  const quality = classifyTimestamp(obs);
  if (quality === 'UNKNOWN') return { usable: false, reason: 'unknown_timestamp', quality, confidence: 0 };
  if (quality === 'MANUAL_VERIFIED' && !obs.source_reference) return { usable: false, reason: 'manual_without_evidence', quality, confidence: 0 };
  const ts = effectiveTimestamp(obs, quality);
  if (ts == null) return { usable: false, reason: 'no_effective_timestamp', quality, confidence: 0 };
  if (ts > cut) return { usable: false, reason: 'after_cutoff', quality, confidence: 0 };
  return { usable: true, reason: 'ok', quality, confidence: QUALITY_CONFIDENCE[quality] };
}

// first_seen_at NUNCA se backdatea: si ya existe uno previo, se conserva el más temprano.
function reconcileFirstSeen(existingFirstSeen, nowSeen) {
  const e = ms(existingFirstSeen), n = ms(nowSeen);
  if (e == null) return nowSeen;
  if (n == null) return existingFirstSeen;
  return e <= n ? existingFirstSeen : nowSeen;
}

module.exports = { QUALITY, QUALITY_CONFIDENCE, classifyTimestamp, effectiveTimestamp, usableAt, reconcileFirstSeen };
