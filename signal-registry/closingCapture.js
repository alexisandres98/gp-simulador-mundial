// signal-registry/closingCapture.js — Fase H §5-7 (evoluciona Sprint 5). Captura de cierre SIN look-ahead,
// idempotente por benchmark_type, con estado de captura detallado (closing_status), política oficial de closing
// y componentes de CLV. NUNCA usa una cuota actualizada después del kickoff. Si no hay dato confiable pre-kickoff
// → closing_status=UNAVAILABLE (no se interpola ni se inventa). NO toca la señal original.
'use strict';
const db = require('../database/client');
const repo = require('./repositories');
const policy = require('./closingPolicy');
const { appendEvent } = require('./eventLog');

function err(code) { const e = new Error(code); e.code = code; return e; }

// captureClosing(signalId, input, opts) → snapshot de cierre (idempotente por benchmark_type).
//   input: { benchmarkType, providerId, externalMarketId, externalOutcomeId, bestBid, bestAsk, midpoint, lastTrade,
//            executablePrice, closingOdds, closingProbability, closingSource, snapshotId, observedAt,
//            providerUpdatedAt, kickoffAt, eventStartAt, market, period, outcome, canonicalEventId, publishedOdds,
//            suspended, postponed, mappingError, noEquivalentMarket, providerError, captureMethod, metadata }
async function captureClosing(signalId, input = {}, opts = {}) {
  const sig = await repo.signals.byId(signalId);
  if (!sig) throw err('signal_not_found');
  const benchmarkType = input.benchmarkType || 'last_valid_pre_event_executable';
  const kickoffAt = input.kickoffAt || input.eventStartAt || sig.event_start_at;

  // estado de captura + anti-look-ahead (§5)
  const cap = policy.classifyCapture(input, kickoffAt);
  // una cuota CON precio pero actualizada/observada tras el kickoff se RECHAZA explícitamente (no look-ahead).
  if (cap.status === 'EVENT_STARTED') throw err('look_ahead_rejected');
  // postponed: el evento se pospuso → no hay cierre todavía (no es error)
  const closingStatus = input.postponed ? 'UNAVAILABLE' : cap.status;
  const reasonCode = input.postponed ? 'POSTPONED' : cap.reason;
  const legacyStatus = input.postponed ? 'postponed' : policy.legacyCaptureStatus(closingStatus);
  const usable = !input.postponed && cap.usable;

  const observedAt = input.observedAt || null;
  const clv = usable ? policy.clvComponents({ publishedOdds: input.publishedOdds, closingOdds: input.closingOdds, closingSource: input.closingSource, closingProbability: input.closingProbability }) : null;

  const run = async (client) => {
    if (await repo.closing.exists(signalId, benchmarkType)) return { skipped: true, reason: 'already_captured' };
    const row = await repo.closing.insert({
      signal_id: signalId, benchmark_type: benchmarkType, provider_id: input.providerId, external_market_id: input.externalMarketId,
      external_outcome_id: input.externalOutcomeId, best_bid: input.bestBid, best_ask: input.bestAsk, midpoint: input.midpoint,
      last_trade: input.lastTrade, executable_price: input.executablePrice, snapshot_id: input.snapshotId,
      observed_at: observedAt, event_start_at: kickoffAt, capture_status: legacyStatus, capture_method: input.captureMethod || 'scheduler',
      metadata: input.metadata || {},
      canonical_event_id: input.canonicalEventId || sig.canonical_event_id, market: input.market, period: input.period, outcome: input.outcome,
      closing_odds: usable ? input.closingOdds : null, closing_probability: usable ? input.closingProbability : null,
      closing_source: usable ? (input.closingSource || policy.OFFICIAL_CLOSING_SOURCE) : null,
      provider_updated_at: input.providerUpdatedAt || null, kickoff_at: kickoffAt,
      closing_status: closingStatus, closing_reason_code: reasonCode, closing_policy_version: policy.CLOSING_POLICY_VERSION, clv_components: clv,
      capture_source: input.captureSource || 'automatic', best_closing_odds: usable ? input.bestClosingOdds : null,
      best_closing_sportsbook: usable ? input.bestClosingSportsbook : null, source_group_count: input.sourceGroupCount, source_set_count: input.sourceSetCount,
    }, client);
    if (row) await appendEvent(client, signalId, { eventType: 'closing_captured', reasonCode: closingStatus, actorId: opts.actorId, payload: { benchmark_type: benchmarkType, closing_status: closingStatus, reason: reasonCode }, projection: { closing_captured: true } });
    return { closing: row, captureStatus: legacyStatus, closingStatus, reasonCode, usable };
  };
  return opts.client ? run(opts.client) : db.withTransaction(run);
}

module.exports = { captureClosing };
