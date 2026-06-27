// signal-registry/closingResolver.js — Fase H.1 §3-4. Cableado AUTOMÁTICO de closing: desde una señal oficial
// futura resuelve el consenso no-vig de grupos independientes VERIFICADOS del último set completo válido
// PRE-kickoff y persiste el closing snapshot, sin CLI. Reusa setAssembly + value-engine/{noVig,consensus} +
// valueMetadata. Estados operativos: NOT_DUE | CAPTURED | UNAVAILABLE | RETRYABLE | FINAL_NO_DATA | BLOCKED.
'use strict';
const db = require('../database/client');
const cfg = require('./config');
const setAssembly = require('../sportsbook-providers/setAssembly');
const valueMetadata = require('../sportsbook-providers/valueMetadata');
const sourceCatalog = require('../sportsbook-providers/sourceCatalog');
const noVig = require('../value-engine/noVig');
const consensus = require('../value-engine/consensus');
const vcfg = require('../value-engine/config');
const { captureClosing } = require('./closingCapture');

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const OUT = ['home', 'draw', 'away'];

// loader por defecto: quotes 1X2 del canonical event con provider_update <= kickoff (anti-look-ahead a nivel dato).
async function defaultQuoteLoader(canonicalEventId, kickoffIso, provider) {
  const r = await db.query(
    `SELECT data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id,
            independence_group, odds_decimal, quote_status, is_live, provider_update, observed_at, metadata
       FROM sportsbook_quote_current
      WHERE canonical_event_id=$1 AND market_family='1x2'
        AND provider_update IS NOT NULL AND provider_update <= $2
        AND ($3::text IS NULL OR data_provider=$3)
      ORDER BY provider_update DESC`,
    [canonicalEventId, kickoffIso, provider || null]);
  return r.rows;
}

// computeConsensusNoVig(sets, catalog) → consenso oficial de grupos VERIFICADOS, o {status:'unavailable'}.
function computeConsensusNoVig(sets, catalog = {}) {
  const verified = sets.filter(s => (catalog[s.sportsbook] && catalog[s.sportsbook].verification_status) === 'verified');
  if (!verified.length) return { status: 'unavailable', reason: 'no_verified_groups', verified: 0 };
  const method = vcfg.OFFICIAL_NO_VIG === 'no-vig-power-1' ? 'power' : 'proportional';
  const books = [];
  for (const s of verified) {
    const raws = OUT.map(o => 1 / Number(s.quotes[o].odds));
    const nv = noVig.removeVig(raws, { method });
    if (nv.official.status !== 'ok') continue;
    const p = {}; OUT.forEach((o, i) => { p[o] = nv.official.probabilities[i]; });
    books.push({ sportsbook: s.sportsbook, independence_group: s.independence_group, probabilities: p, complete: true, fresh: true });
  }
  if (!books.length) return { status: 'unavailable', reason: 'no_valid_books', verified: verified.length };
  const cons = consensus.compute(books);
  if (cons.status !== 'ok') return { status: 'unavailable', reason: cons.reason || 'consensus_unavailable' };
  return { status: 'ok', consensus: cons, verifiedSets: verified, bookCount: books.length, groupCount: cons.independence_groups };
}

// resolveClosing(signal, opts) — orquesta y captura. opts: { now, catalog, provider, quoteLoader, adminStatus, captureSource }
//   signal: { id, canonical_event_id, event_start_at, market, period, outcome, published_odds }
async function resolveClosing(signal, opts = {}) {
  const now = opts.now != null ? +new Date(opts.now) : Date.now();
  const kickoff = +new Date(signal.event_start_at);
  const kickoffIso = new Date(kickoff).toISOString();
  const window = cfg.params.closingMaxPrestartWindowMs || (3 * 3600 * 1000);
  const graceAfter = int(process.env.SIGNAL_CLOSING_POST_KICKOFF_GRACE_MS, 6 * 3600 * 1000);
  const market = signal.market || (signal.signal_payload && signal.signal_payload.market_type) || '1x2';
  const period = signal.period || (signal.signal_payload && signal.signal_payload.period) || 'regulation_90m';
  const outcome = signal.outcome || signal.direction || (signal.signal_payload && signal.signal_payload.predicted_outcome);
  const publishedOdds = signal.published_odds || (signal.signal_payload && signal.signal_payload.published_odds) || null;
  const captureSource = opts.captureSource || 'automatic';

  if (opts.adminStatus === 'DATA_ERROR') return { state: 'BLOCKED', reason: 'admin_data_error' };
  if (!Number.isFinite(kickoff)) return { state: 'BLOCKED', reason: 'no_kickoff' };
  if (now < kickoff - window) return { state: 'NOT_DUE', reason: 'before_window' };

  const loader = opts.quoteLoader || defaultQuoteLoader;
  const rows = await loader(signal.canonical_event_id, kickoffIso, opts.provider);
  const captureUnavailable = async (reasonCode) => {
    const r = await captureClosing(signal.id, { kickoffAt: kickoffIso, market, period, outcome, canonicalEventId: signal.canonical_event_id, captureSource, captureMethod: 'scheduler', metadata: { reason: reasonCode } }, { actorId: opts.actorId });
    return r;
  };

  if (!rows.length) {
    if (now >= kickoff + graceAfter) { await captureUnavailable('FINAL_NO_DATA'); return { state: 'FINAL_NO_DATA' }; }
    if (now >= kickoff) { await captureUnavailable('NO_PRECLOSE_DATA'); return { state: 'UNAVAILABLE', reason: 'no_data' }; }
    return { state: 'RETRYABLE', reason: 'no_data_yet' };
  }

  const catalog = opts.catalog || {};
  const { sets } = setAssembly.assembleSets(rows, { now: kickoff, maxSkewMs: vcfg.params.maxBookOutcomeSkewMs, maxAgeMs: window });
  const cn = computeConsensusNoVig(sets, catalog);
  if (cn.status !== 'ok') {
    if (now >= kickoff) { await captureUnavailable('NO_VERIFIED_CONSENSUS'); return { state: 'UNAVAILABLE', reason: cn.reason }; }
    return { state: 'RETRYABLE', reason: cn.reason };
  }

  const prob = cn.consensus.median_probability[outcome];
  if (!Number.isFinite(prob) || prob <= 0) {
    if (now >= kickoff) { await captureUnavailable('INVALID_CONSENSUS'); return { state: 'UNAVAILABLE', reason: 'invalid_consensus' }; }
    return { state: 'RETRYABLE', reason: 'invalid_consensus' };
  }
  const officialOdds = +(1 / prob).toFixed(6);
  const best = valueMetadata.bestBookForOutcome(cn.verifiedSets, outcome, catalog);
  // último provider_update válido (máximo entre los sets verificados, todos <= kickoff por el loader)
  const lastUpdate = cn.verifiedSets.map(s => s.provider_update).sort().slice(-1)[0];
  const lastObserved = cn.verifiedSets.map(s => s.observed_at).filter(Boolean).sort().slice(-1)[0] || lastUpdate;

  const cap = await captureClosing(signal.id, {
    benchmarkType: 'last_valid_pre_event_executable', closingOdds: officialOdds, closingProbability: +prob.toFixed(8),
    closingSource: 'consensus_no_vig', publishedOdds, observedAt: lastObserved, providerUpdatedAt: lastUpdate, kickoffAt: kickoffIso,
    market, period, outcome, canonicalEventId: signal.canonical_event_id, captureSource, captureMethod: 'scheduler',
    bestClosingOdds: best ? best.odds : null, bestClosingSportsbook: best ? best.best_sportsbook_code : null,
    sourceGroupCount: cn.groupCount, sourceSetCount: cn.bookCount,
    metadata: { dispersion: cn.consensus.dispersion, sportsbooks: cn.consensus.sportsbooks_included },
  }, { actorId: opts.actorId });

  if (cap.skipped) return { state: 'CAPTURED', skipped: true, reason: 'already_captured' };
  return { state: 'CAPTURED', closingStatus: cap.closingStatus, official_closing_probability: +prob.toFixed(8), official_closing_odds: officialOdds, source_group_count: cn.groupCount, source_set_count: cn.bookCount, best_sportsbook: best ? best.best_sportsbook_code : null };
}

module.exports = { resolveClosing, computeConsensusNoVig, defaultQuoteLoader };
