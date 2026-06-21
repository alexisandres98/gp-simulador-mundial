// canonical-graph/index.js — orquestación del matching (Sprint 2). PIPELINE PURO (sin DB), testable.
// extraer descriptores → generar candidatos → match evento → mercado → outcomes. Explicable y conservador.
// La persistencia/review (con flags) vive en review.js; esto solo decide.

'use strict';
const semanticExtractor = require('./semanticExtractor');
const candidateGenerator = require('./candidateGenerator');
const eventMatcher = require('./eventMatcher');
const marketMatcher = require('./marketMatcher');
const outcomeMatcher = require('./outcomeMatcher');
const taxonomy = require('./taxonomy');
const aliases = require('./participantAliases');
const ruleNormalizer = require('./ruleNormalizer');
const ruleFingerprint = require('./ruleFingerprint');

const VERSIONS = {
  taxonomy: taxonomy.TAXONOMY_VERSION,
  alias: aliases.ALIAS_VERSION,
  ruleNormalizer: ruleNormalizer.RULE_NORMALIZER_VERSION,
  ruleFingerprint: ruleFingerprint.FINGERPRINT_VERSION,
  eventMatcher: eventMatcher.EVENT_MATCHER_VERSION,
  marketMatcher: marketMatcher.MARKET_MATCHER_VERSION,
  outcomeMatcher: outcomeMatcher.OUTCOME_MATCHER_VERSION,
};

// describe(market, provider, opts) → descriptor semántico
function describe(market, provider, opts) { return semanticExtractor.extractDescriptor(market, provider, opts); }

// matchPair(descA, descB) → { event, market, outcomes, descriptors }
function matchPair(a, b) {
  const event = eventMatcher.matchEvents(a, b);
  const market = marketMatcher.matchMarkets(a, b, event.status);
  const outcomes = outcomeMatcher.matchOutcomes(a, b, market.status);
  return { event, market, outcomes, a, b };
}

// matchProviders(marketsA, marketsB, providerA, providerB, opts) → { results, candidateCount, stats }
function matchProviders(marketsA, marketsB, providerA, providerB, opts = {}) {
  const descA = (marketsA || []).map(m => describe(m, providerA, opts.a || {}));
  const descB = (marketsB || []).map(m => describe(m, providerB, opts.b || {}));
  // bucketing por EVENTO (no por familia) para que pares cross-familia del MISMO evento se comparen
  // y se clasifiquen (la mayoría rejected; win-vs-qualify → conditional). Universo pequeño → es viable.
  const candidates = candidateGenerator.generateCandidates(descA, descB, { level: 'event' });
  const results = candidates.map(({ a, b, bucket }) => ({ bucket, ...matchPair(a, b) }));
  return { results, candidateCount: candidates.length, descriptorsA: descA.length, descriptorsB: descB.length, versions: VERSIONS };
}

// ---------- API admin (sin secretos; no ejecuta matching) ----------
const cfg = require('./config');
const metrics = require('./metrics');

async function adminStatus() {
  const out = {
    flags: { enabled: cfg.flags.graphEnabled, writeEnabled: cfg.flags.writeEnabled, autoMatchEnabled: cfg.flags.autoMatchEnabled, configurationValid: cfg.flags.configurationValid, warning: cfg.flags.warning },
    thresholds: cfg.thresholds, versions: VERSIONS, metrics: metrics.snapshot(), counts: null,
  };
  if (cfg.platform.db.configured) { try { out.counts = await require('./repositories/graphRepository').statusCounts(); } catch { /* noop */ } }
  return out;
}
async function reviewList(status, limit, offset) { return require('./repositories/graphRepository').listReview(status || 'pending', limit || 50, offset || 0); }
async function reviewGet(id) { return require('./repositories/graphRepository').getReviewItem(id); }
// reviewDecide(id, { decision, reviewedBy, notes }) — registra también el historial de decisión (manual).
async function reviewDecide(id, { decision, reviewedBy, notes }) {
  const repo = require('./repositories/graphRepository');
  const item = await repo.getReviewItem(id);
  if (!item) return null;
  const statusMap = { approve: 'approved', reject: 'rejected', conditional: 'conditional', dismiss: 'dismissed' };
  const newStatus = statusMap[decision] || 'pending';
  const updated = await repo.decideReview(id, { decision, status: newStatus, reviewedBy, notes });
  await repo.recordDecision({ mappingEntityType: item.entity_type, previousStatus: 'pending', newStatus, newScore: item.score, decisionSource: 'manual', reviewedBy, reason: notes || decision }).catch(() => {});
  return updated;
}

module.exports = { describe, matchPair, matchProviders, VERSIONS, adminStatus, reviewList, reviewGet, reviewDecide };
