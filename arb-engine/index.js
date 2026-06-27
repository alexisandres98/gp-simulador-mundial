// arb-engine/index.js — orquestación de la evaluación de arbitraje (Sprint 3). PURO (sin DB), testable.
// candidate → eligibility → arb math (binary/1x2) → classification → confidence → opportunity key → evaluation.

'use strict';
const cfg = require('./config');
const eligibility = require('./eligibility');
const binaryArb = require('./binaryArb');
const oneXTwoArb = require('./oneXTwoArb');
const classifier = require('./classifier');
const confidence = require('./confidence');
const semanticGate = require('./semanticGate');
const { opportunityKey } = require('./opportunityKey');

// familia de mercado por defecto según la estructura del candidato (si no viene explícita). Conservador.
const FAMILY_BY_STRATEGY = { '1x2': 'MATCH_RESULT', binary: 'BINARY' };

const VERSIONS = {
  engine: cfg.ENGINE_VERSION,
  feeEngine: 'fee-1', bookWalker: 'bw-1', classifier: 'cls-1', confidence: 'conf-1',
};

// evaluateCandidate(candidate, opts) → evaluation (inmutable, una por conjunto de snapshots)
// candidate: { canonicalEventId, canonicalMarketId, strategy:'binary'|'1x2', mappingStatus, mappingVersion,
//   rulesFingerprint, legs:[{ provider, externalMarketId, externalOutcomeId, canonicalOutcomeId, side,
//   asks, bids, snapshotId, snapshotReceivedAt, marketStatus, freshness, currency, payoutKnown,
//   equivalenceScore, isLive, priceSource, period, rulesFingerprint, feeOverride, hardConflicts,
//   mappingStatus, outcomeMappingStatus }] }
function evaluateCandidate(candidate, opts = {}) {
  const params = { ...cfg.params, ...(opts.params || {}) };
  const now = opts.now || Date.now();
  const legs = candidate.legs || [];

  // 1) elegibilidad por pata + edad de snapshot + skew
  const legEligibility = legs.map(l => eligibility.checkLeg(l, params));
  const snapshotAge = legs.map(l => eligibility.checkSnapshotAge(l, now, params));
  const timeSkew = eligibility.checkTimeSkew(legs, params.maxLegTimeSkewMs);

  // 2) patas para el cálculo (lado ASK = lo que se compra)
  const calcLegs = legs.map(l => ({
    provider: l.provider, side: l.side, priceSource: l.priceSource || 'direct_ask',
    levels: l.asks || [], tickSize: l.tickSize, minimumOrderSize: l.minimumOrderSize,
    period: l.period, rulesFingerprint: l.rulesFingerprint, feeOverride: l.feeOverride,
    externalMarketId: l.externalMarketId, canonicalOutcomeId: l.canonicalOutcomeId,
  }));
  const arbOpts = { minNetRoi: params.minNetRoi, executionBufferBps: params.executionBufferBps, maxCapital: opts.maxCapital };
  const calc = candidate.strategy === '1x2' ? oneXTwoArb.evaluate(calcLegs, arbOpts) : binaryArb.evaluate(calcLegs, arbOpts);
  const evaluation = calc.evaluation || null;
  const maxSize = calc.maxSize || null;

  const hasDerivedAsk = legs.some(l => l.priceSource === 'derived_from_complement_bid');

  // 3) clasificación conservadora
  let classification, reasons = [], warnings = [];
  if (!calc.structureOk) { classification = 'rejected'; reasons = [calc.reason || 'invalid_structure']; }
  else {
    const c = classifier.classify({
      evaluation, legEligibility, timeSkew, snapshotAge, mappingStatus: candidate.mappingStatus,
      hasDerivedAsk, volatility: opts.volatility, minNetRoi: params.minNetRoi, maxSkewMs: params.maxLegTimeSkewMs,
      minExecutableCapital: params.minExecutableCapital,
    });
    classification = c.classification; reasons = c.reasons; warnings = c.warnings;
  }

  // 3b) GATE SEMÁNTICO (Fase R.1). Un candidato solo puede ser EJECUTABLE (pure_arb/execution_sensitive) si
  //     prueba cobertura exhaustiva + reglas de settlement idénticas/no-ambiguas. Ante cualquier duda → rejected
  //     con semantic_mismatch (§2). Solo añade rechazos: nunca eleva una clasificación. Verdicto siempre adjunto.
  const marketMeta = {
    canonical_event_id: candidate.canonicalEventId || null,
    market_family: candidate.marketFamily || FAMILY_BY_STRATEGY[candidate.strategy] || null,
    period: candidate.period || null,
    line: candidate.line != null ? candidate.line : null,
  };
  const identities = legs.map(l => semanticGate.legIdentity({
    canonical_event_id: l.canonical_event_id || candidate.canonicalEventId,
    market_family: l.market_family, period: l.period, line: l.line,
    outcome_code: l.outcome_code, side: l.side, proposition_id: l.proposition_id, canonical_outcome_id: l.canonicalOutcomeId,
    includes_extra_time: l.includes_extra_time, includes_penalties: l.includes_penalties, draw_possible: l.draw_possible,
    void_policy: l.void_policy, postponement_policy: l.postponement_policy, settlement_source: l.settlement_source,
    currency: l.currency, rulesFingerprint: l.rulesFingerprint, rules: l.rules,
  }, marketMeta));
  const semantic = semanticGate.checkSemantics(identities, { policy: opts.semanticPolicy });
  const strict = opts.semanticStrict != null ? opts.semanticStrict : cfg.flags.semanticStrict;
  // El MOTOR degrada solo ante incompatibilidad PROBADA (semantic.fatal): legs con familia/período/línea/
  // fingerprint/reglas/outcome discordantes y NO nulos. La AMBIGÜEDAD (datos faltantes) no degrada aquí; la
  // capa de producto (R.4) exigirá semantic.ok (sin ambigüedad) antes de mostrar una oportunidad como ejecutable.
  if (strict && semantic.fatal && (classification === 'pure_arb' || classification === 'execution_sensitive')) {
    classification = 'rejected';
    reasons = ['semantic_mismatch:' + (semantic.sub_reason || 'unknown')];
  }

  // 4) confianza explicable (separada del beneficio)
  const conf = confidence.score({
    mappingStatus: candidate.mappingStatus, manualReviewApproved: candidate.manualReviewApproved,
    rulesComplete: !!candidate.rulesFingerprint, freshness: worstFreshness(legs),
    timeSkewMs: timeSkew.skewMs, maxSkewMs: params.maxLegTimeSkewMs, hasDerivedAsk,
    minDepthConsumed: evaluation && evaluation.legs ? Math.min(...evaluation.legs.map(l => l.depthConsumed)) : null,
    volatility: opts.volatility && opts.volatility.label, providerErrorRate: opts.providerErrorRate,
    feeStatus: evaluation ? evaluation.feeStatus : 'unknown',
  });

  const oppKey = opportunityKey({ canonicalMarketId: candidate.canonicalMarketId, strategy: candidate.strategy, legs });

  return {
    opportunityKey: oppKey,
    canonicalEventId: candidate.canonicalEventId || null,
    canonicalMarketId: candidate.canonicalMarketId || null,
    strategy: candidate.strategy,
    classification, reasons, warnings,
    mappingVersion: candidate.mappingVersion || null,
    rulesFingerprint: candidate.rulesFingerprint || null,
    snapshotIds: legs.map(l => l.snapshotId).filter(Boolean),
    legTimeSkewMs: timeSkew.skewMs,
    semantic,  // Fase R.1: verdicto del gate semántico (ok/reason/sub_reason/blockers) — siempre presente
    evaluation, maxSize,
    confidence: conf,
    versions: VERSIONS,
    evaluatedAt: new Date(now).toISOString(),
  };
}

function worstFreshness(legs) {
  const order = ['stale', 'unknown', 'aging', 'fresh'];
  let worst = 'fresh';
  for (const l of legs) { const f = l.freshness || 'unknown'; if (order.indexOf(f) < order.indexOf(worst)) worst = f; }
  return worst;
}

// ---------- runner shadow (evalúa candidatos y, si write on, persiste) ----------
async function runShadow({ candidates, now } = {}) {
  const cands = candidates || [];
  const counts = { candidates: cands.length, pure_arb: 0, execution_sensitive: 0, conditional: 0, price_discrepancy: 0, rejected: 0, errors: 0 };
  const evaluations = [];
  for (const c of cands) {
    try {
      const ev = evaluateCandidate(c, { now });
      counts[ev.classification] = (counts[ev.classification] || 0) + 1;
      evaluations.push(ev);
    } catch { counts.errors++; }
  }
  // persistencia best-effort (solo si write on + DB)
  let persisted = null;
  if (cfg.flags.writeEnabled && cfg.platform.db.configured) {
    try {
      const persist = require('./persist');
      const t0 = Date.now();
      const run = await persist.startRun();
      let written = 0, dup = 0;
      for (const ev of evaluations) { const r = await persist.persistEvaluation(ev, run.id); if (r.written) written++; else if (r.duplicate) dup++; }
      await persist.finishRun(run.id, counts.errors ? 'partial' : 'success', counts, Date.now() - t0);
      persisted = { runId: run.id, written, duplicate: dup };
    } catch (e) { persisted = { error: 'persist_failed' }; }
  }
  return { counts, evaluations, persisted, writeEnabled: cfg.flags.writeEnabled };
}

// ---------- admin status (sin secretos; no ejecuta evaluación) ----------
async function adminStatus() {
  const out = {
    flags: { engineEnabled: cfg.flags.engineEnabled, writeEnabled: cfg.flags.writeEnabled, schedulerEnabled: cfg.flags.schedulerEnabled, allowAutoPublication: cfg.flags.allowAutoPublication, autoPublicationRequestedButBlocked: cfg.flags.autoPublicationRequestedButBlocked },
    params: { minNetRoi: cfg.params.minNetRoi, executionBufferBps: cfg.params.executionBufferBps, maxLegTimeSkewMs: cfg.params.maxLegTimeSkewMs, minExecutableCapital: cfg.params.minExecutableCapital },
    versions: VERSIONS, counts: null, scheduler: null,
  };
  if (cfg.platform.db.configured) { try { out.counts = await require('./persist').counts(); } catch { /* noop */ } }
  try { out.scheduler = require('./scheduler').status(); } catch { /* noop */ }
  return out;
}

module.exports = { evaluateCandidate, runShadow, adminStatus, VERSIONS };
