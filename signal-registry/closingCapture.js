// signal-registry/closingCapture.js — Sprint 5 §25-26. Captura de benchmark de cierre SIN look-ahead.
// observed_at <= event_start_at. Si no hay dato válido → capture_status='unavailable' (no se estima/interpola).
'use strict';
const db = require('../database/client');
const cfg = require('./config');
const repo = require('./repositories');
const { appendEvent } = require('./eventLog');

function err(code) { const e = new Error(code); e.code = code; return e; }

// captureClosing(signalId, input, opts) → snapshot de cierre (idempotente por benchmark_type).
//   input: { benchmarkType, providerId, externalMarketId, externalOutcomeId, bestBid, bestAsk, midpoint,
//            lastTrade, executablePrice, snapshotId, observedAt, eventStartAt, captureMethod }
async function captureClosing(signalId, input = {}, opts = {}) {
  const sig = await repo.signals.byId(signalId);
  if (!sig) throw err('signal_not_found');
  const benchmarkType = input.benchmarkType || 'last_valid_pre_event_executable';
  const eventStartAt = input.eventStartAt || sig.event_start_at;

  // determinar estado de captura
  let captureStatus = 'captured';
  let observedAt = input.observedAt || null;
  if (input.postponed) captureStatus = 'postponed';
  else if (input.suspended) captureStatus = 'suspended';
  else if (!observedAt || (input.bestBid == null && input.bestAsk == null && input.midpoint == null && input.executablePrice == null)) {
    captureStatus = 'unavailable'; observedAt = observedAt || null;
  } else if (eventStartAt && new Date(observedAt).getTime() > new Date(eventStartAt).getTime()) {
    // NO look-ahead: un snapshot posterior al inicio NO se usa
    throw err('look_ahead_rejected');
  }

  const run = async (client) => {
    if (await repo.closing.exists(signalId, benchmarkType)) return { skipped: true, reason: 'already_captured' };
    const row = await repo.closing.insert({
      signal_id: signalId, benchmark_type: benchmarkType, provider_id: input.providerId, external_market_id: input.externalMarketId,
      external_outcome_id: input.externalOutcomeId, best_bid: input.bestBid, best_ask: input.bestAsk, midpoint: input.midpoint,
      last_trade: input.lastTrade, executable_price: input.executablePrice, snapshot_id: input.snapshotId,
      observed_at: observedAt, event_start_at: eventStartAt, capture_status: captureStatus, capture_method: input.captureMethod || 'scheduler',
      metadata: input.metadata || {},
    }, client);
    if (row) await appendEvent(client, signalId, { eventType: 'closing_captured', reasonCode: captureStatus, actorId: opts.actorId, payload: { benchmark_type: benchmarkType, capture_status: captureStatus }, projection: { closing_captured: true } });
    return { closing: row, captureStatus };
  };
  return opts.client ? run(opts.client) : db.withTransaction(run);
}

module.exports = { captureClosing };
