// signal-registry/presentation.js — Sprint 5 §29-31. Redacción pública (lista blanca). Sin raw payloads ni IDs internos.
'use strict';

const COPY = {
  frozen: 'Esta señal fue congelada antes del evento. El contenido original no se modifica después de publicarse.',
  corrections: 'Las correcciones se añaden al historial sin borrar la versión anterior.',
  legacy: 'Esta predicción precede al inicio del registro verificable y no cuenta como señal verificada.',
  experimental: 'Experimento GP Intelligence. No forma parte del track record oficial.',
  arb: 'Oportunidad observada y publicada; no representa una operación ejecutada por GP.',
};

function ageSeconds(iso, now) { if (!iso) return null; const t = new Date(iso).getTime(); return isNaN(t) ? null : Math.max(0, Math.round((now - t) / 1000)); }
function transparencyCopy(sig) {
  if (sig.legacy || sig.verification_status === 'legacy_unverified') return COPY.legacy;
  if (sig.experimental) return COPY.experimental;
  if (sig.signal_type === 'arb_publication') return COPY.arb;
  return COPY.frozen;
}

// card para la lista pública
function publicCard(sig, projection, now = Date.now()) {
  return {
    public_id: sig.public_id,
    signal_type: sig.signal_type,
    event: (sig.public_payload && sig.public_payload.event) || null,
    headline: predictionHeadline(sig),
    published_age_seconds: ageSeconds(sig.published_at, now),
    verification_status: sig.verification_status,
    score_eligible: sig.score_eligible,
    experimental: sig.experimental,
    legacy: sig.legacy,
    settlement_status: (projection && projection.settlement_status) || null,
    current_status: (projection && projection.current_status) || sig.registry_status,
  };
}

function predictionHeadline(sig) {
  const pl = sig.signal_payload || {};
  if (sig.signal_type === 'model_prediction_v1' && pl.probabilities) {
    const p = pl.probabilities;
    if (p.home != null) return `1X2 ${(p.home * 100).toFixed(0)}/${(p.draw * 100).toFixed(0)}/${(p.away * 100).toFixed(0)}`;
    const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
    return top ? `${top[0]} ${(top[1] * 100).toFixed(0)}%` : null;
  }
  if (sig.signal_type === 'arb_publication') return (sig.public_payload && sig.public_payload.badge) || 'Arbitraje';
  return null;
}

// detalle público redactado
function publicDetail(sig, bundle = {}, now = Date.now()) {
  const { events = [], settlements = [], closing = [], refs = [], projection = null } = bundle;
  return {
    public_id: sig.public_id,
    signal_type: sig.signal_type,
    signal_schema_version: sig.signal_schema_version,
    // señal original (congelada)
    original: {
      event: (sig.public_payload && sig.public_payload.event) || null,
      market: (sig.public_payload && sig.public_payload.market) || null,
      headline: predictionHeadline(sig),
      prediction: redactPayload(sig),
      published_at: sig.published_at,
      published_age_seconds: ageSeconds(sig.published_at, now),
      source_created_at: sig.source_created_at,
      input_cutoff_at: sig.input_cutoff_at,
      event_start_at: sig.event_start_at,
      market_close_at: sig.market_close_at,
      direction: sig.direction,
      model_version: sig.model_version,
      methodology_version: sig.methodology_version,
    },
    // fuentes (resumen, sin raw)
    sources: refs.map(r => ({ source_type: r.source_type, source_version: r.source_version || null, snapshot_timestamp: r.snapshot_timestamp || null })),
    // integridad
    integrity: {
      content_hash: sig.content_hash,
      registry_hash: sig.registry_hash,
      registry_hash_short: sig.registry_hash ? sig.registry_hash.slice(0, 12) : null,
      chain_position: sig.chain_position,
      previous_registry_hash_short: sig.previous_registry_hash ? sig.previous_registry_hash.slice(0, 12) : null,
    },
    // estado de scoring y verificación
    status: {
      registry_status: (projection && projection.current_status) || sig.registry_status,
      verification_status: sig.verification_status,
      score_eligible: sig.score_eligible,
      experimental: sig.experimental,
      legacy: sig.legacy,
    },
    // resultado (settlement, todas las versiones visibles)
    settlement: settlements.map(s => ({
      version: s.settlement_version, status: s.settlement_status, result_type: s.result_type,
      winning_outcome_id: s.winning_outcome_id, is_final: s.is_final, void_reason: s.void_reason,
      correction_reason: s.correction_reason, settled_at: s.settled_at, source: s.settlement_source,
      realized_roi: s.realized_roi, // null para arb (no ejecutado)
    })),
    // historial append-only
    history: events.map(e => ({ event_type: e.event_type, version: e.event_version, reason: e.reason_code, at: e.created_at, actor_type: e.actor_type })),
    // benchmark de cierre (sin calcular CLV)
    closing_benchmarks: closing.map(c => ({ benchmark_type: c.benchmark_type, capture_status: c.capture_status, executable_price: c.executable_price, midpoint: c.midpoint, observed_at: c.observed_at })),
    transparency: transparencyCopy(sig),
    methodology_note: 'Registro con evidencia de integridad y detección de modificaciones. La señal se publica, se congela, se verifica y se liquida; cualquier corrección permanece visible.',
  };
}

// redacta el payload según tipo (nunca expone snapshots crudos / internals)
function redactPayload(sig) {
  const pl = sig.signal_payload || {};
  if (sig.signal_type === 'model_prediction_v1') {
    return { probabilities: pl.probabilities || null, predicted_outcome: pl.predicted_outcome || null, expected_goals: pl.expected_goals || null, market_type: pl.market_type || null };
  }
  if (sig.signal_type === 'arb_publication') {
    return { classification: pl.classification, net_roi: pl.net_roi, max_executable_capital: pl.max_executable_capital || null, legs: (pl.legs || []).map(l => ({ provider: l.provider, side: l.side })) };
  }
  if (sig.signal_type === 'gp_intelligence_experiment') {
    return { delta: pl.delta || null, note: 'Experimento (control V1 vs challenger V2).' };
  }
  return null;
}

module.exports = { publicCard, publicDetail, predictionHeadline, transparencyCopy, COPY };
