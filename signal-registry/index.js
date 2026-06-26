// signal-registry/index.js — Sprint 5. Fachada del registro inmutable. Gating por flags. Requerirla no conecta nada.
'use strict';
const db = require('../database/client');
const cfg = require('./config');
const publisher = require('./publisher');
const repo = require('./repositories');
const hashing = require('./hashing');
const presentation = require('./presentation');
const verifier = require('./verifier');
const settlement = require('./settlement');
const corrections = require('./corrections');
const closingCapture = require('./closingCapture');
const { appendEvent } = require('./eventLog');

function err(code) { const e = new Error(code); e.code = code; return e; }

async function adminStatus() {
  const out = { flags: cfg.flags, params: { verifiedEpoch: cfg.params.verifiedEpoch }, layerVersion: cfg.LAYER_VERSION, counts: null };
  if (cfg.platform.db.configured) { try { out.counts = await repo.statusCounts(); } catch { /* noop */ } }
  return out;
}

// ---------- publicación de predicción oficial V1 (§19) ----------
async function publishModelPrediction(input, opts = {}) {
  return publisher.register({ ...input, signal_type: 'model_prediction_v1', model_version: input.model_version || cfg.V1_METHODOLOGY_VERSION }, opts);
}

// ---------- integración Sprint 4: una publicación de arb crea su señal (§18) ----------
// Pensado para correr DENTRO de la transacción de publish de Sprint 4 (opts.client) → atomicidad:
// "no signal record → no public publication".
async function captureArbPublication({ publication, evaluation = {}, actorId, client, now } = {}) {
  if (!publication) throw err('publication_required');
  const pl = publication.public_payload || {};
  const sourceRefs = [
    { source_type: 'arb_publication', source_id: publication.id || null, source_version: publication.risk_disclosure_version || null },
    { source_type: 'arb_evaluation', source_id: publication.evaluation_id || evaluation.id || null, source_version: evaluation.engine_version || null, content_hash: evaluation.input_hash || null },
    { source_type: 'canonical_mapping', source_version: publication.published_mapping_version || null },
    { source_type: 'rules_snapshot', source_version: publication.published_rules_fingerprint || null },
  ];
  for (const sid of (evaluation.snapshot_ids || [])) sourceRefs.push({ source_type: 'normalized_snapshot', source_id: String(sid) });

  const input = {
    signal_type: 'arb_publication',
    canonical_event_id: publication.canonical_event_id || evaluation.canonical_event_id || null,
    canonical_market_id: publication.canonical_market_id || evaluation.canonical_market_id || null,
    model_version: evaluation.engine_version || 'arb-engine-1',
    methodology_version: evaluation.engine_version || 'arb-engine-1',
    mapping_version: publication.published_mapping_version || null,
    rules_version: publication.published_rules_fingerprint || null,
    visibility: publication.visibility || 'internal',
    public_id: undefined,
    public_payload: pl,
    signal_payload: {
      arb_publication_id: publication.id || null, arb_evaluation_id: publication.evaluation_id || evaluation.id || null,
      classification: pl.classification || evaluation.classification, net_roi: (pl.economics && pl.economics.net_roi) || evaluation.net_roi,
      net_profit: (pl.sizing && pl.sizing.estimated_net_profit_at_max) || null,
      max_executable_capital: (pl.sizing && pl.sizing.max_executable_capital) || null,
      legs: (pl.legs || []).map(l => ({ provider: l.provider, side: l.side, best_price: l.best_price, vwap: l.vwap, fee: l.fee })),
      realized_roi: null,
    },
    snapshot_ids: [],
  };
  return publisher.register(input, { sourceRefs, actorId, client, now, minSourceRefs: 2 });
}

// ---------- experimento V2 (§20) ----------
async function captureExperiment({ modelAnalysisRunId, control, challenger, delta, factorPolicyVersion, randomSeed, dataQuality }, opts = {}) {
  return publisher.register({
    signal_type: 'gp_intelligence_experiment', experimental: true, model_version: 'gp-intelligence-0.2.0',
    methodology_version: 'gp-intelligence-0.2.0',
    signal_payload: { model_analysis_run_id: modelAnalysisRunId, control_output: control, challenger_output: challenger, delta, factor_policy_version: factorPolicyVersion, random_seed: randomSeed, data_quality: dataQuality },
  }, { sourceRefs: [{ source_type: 'model_analysis_run', source_id: modelAnalysisRunId }], ...opts });
}

// ---------- lifecycle ----------
async function withdraw(signalId, { reason, actorId } = {}) {
  return db.withTransaction(c => appendEvent(c, signalId, { eventType: 'withdrawn', reasonCode: reason || 'withdrawn', actorId, payload: { reason }, projection: { current_status: 'withdrawn' } }));
}
const settle = (signalId, input, opts) => settlement.settle(signalId, input, opts);
const settleFromProvider = (signalId, input, opts) => settlement.settleFromProvider(signalId, input, opts);
const addCorrection = (signalId, input, opts) => corrections.addCorrection(signalId, input, opts);
const markDisputed = (signalId, input, opts) => corrections.markDisputed(signalId, input, opts);
const captureClosing = (signalId, input, opts) => closingCapture.captureClosing(signalId, input, opts);

// ---------- lectura pública ----------
async function listPublic({ signalType = null, verification = null, scoreEligible = null, limit = 50, offset = 0 } = {}) {
  if (!cfg.flags.publicEnabled) return { items: [], enabled: false };
  const rows = await repo.signals.list({ signalType, verification, scoreEligible, limit, offset });
  const now = Date.now();
  const items = [];
  for (const sig of rows) {
    if (sig.visibility === 'internal') continue; // solo beta/public en la vista pública
    const proj = await repo.projection.get(sig.id);
    items.push(presentation.publicCard(sig, proj, now));
  }
  return { items, enabled: true };
}

async function loadBundle(sig) {
  return {
    events: await repo.events.listForSignal(sig.id),
    settlements: await repo.settlements.listForSignal(sig.id),
    closing: await repo.closing.listForSignal(sig.id),
    refs: await repo.sourceRefs.listForSignal(sig.id),
    projection: await repo.projection.get(sig.id),
  };
}

async function getPublic(publicId) {
  if (!cfg.flags.publicEnabled) return { error: 'not_enabled' };
  const sig = await repo.signals.byPublicId(publicId);
  if (!sig || sig.visibility === 'internal') return { error: 'not_found' };
  return { detail: presentation.publicDetail(sig, await loadBundle(sig)) };
}

async function verify(publicId) { return verifier.verifySignal(publicId); }
async function verifyChain(opts) { return verifier.verifyChain(opts); }
async function listCommitments({ limit = 60 } = {}) { return repo.commitments.list({ limit }); }

// ---------- commitment diario (§15) idempotente + elegibilidad ----------
// SOLO entran señales oficiales elegibles (excluye pre-epoch / internal_validation / V2 diagnostics / legacy /
// no-score-eligible). Con 0 elegibles NO se fabrica un root que parezca contener señales (skipped explícito).
async function commitDay(date) {
  const elig = require('./lifecycleEligibility');
  const rows = await repo.signals.rangeByDate(date);
  if (!rows.length) return { skipped: true, reason: 'no_signals', date };
  const eligible = rows.filter(r => elig.commitmentEligible(r).eligible);
  if (!eligible.length) return { skipped: true, reason: 'no_eligible_signals', date, scanned: rows.length };
  const ordered = eligible.slice().sort((a, b) => Number(a.chain_position) - Number(b.chain_position));
  const root = hashing.merkleRoot(ordered.map(r => r.registry_hash));
  const c = await repo.commitments.upsert({
    commitment_date: date, first_chain_position: Number(ordered[0].chain_position), last_chain_position: Number(ordered[ordered.length - 1].chain_position),
    signal_count: ordered.length, root_hash: root, algorithm: cfg.COMMITMENT_ALGO,
  });
  return c ? { commitment: c, eligible: ordered.length, scanned: rows.length } : { skipped: true, reason: 'already_committed', date };
}

module.exports = {
  cfg, adminStatus, publishModelPrediction, captureArbPublication, captureExperiment,
  withdraw, settle, settleFromProvider, addCorrection, markDisputed, captureClosing,
  listPublic, getPublic, verify, verifyChain, listCommitments, commitDay,
  repo, publisher, verifier, presentation, loadBundle,
};
