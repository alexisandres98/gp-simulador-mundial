// canonical-graph/review.js — persistencia de resultados de matching (Sprint 2). Gated por flags.
// write off → dry-run (no escribe). write on + auto-match off → TODO a la cola de revisión.
// auto-match on → solo equivalencias muy claras (market+outcome matched, 0 hard conflicts, datos completos)
// se escriben como mappings 'matched' (con creación CONTROLADA de canónicos); el resto va a revisión.
// Best-effort: un fallo de persistencia no rompe el análisis.

'use strict';
const cfg = require('./config');
const index = require('./index');
const repo = require('./repositories/graphRepository');
const dbRepos = require('../database/repositories');
const metrics = require('./metrics');

function isAutoMatchable(r) {
  const hard = [...(r.event.conflicts || []), ...(r.market.conflicts || [])].filter(c => c.severity === 'hard');
  return cfg.flags.autoMatchEnabled
    && r.event.status === 'matched' && r.market.status === 'matched'
    && (r.outcomes[0] && r.outcomes[0].status === 'matched')
    && hard.length === 0
    && !r.a.criticalDataMissing && !r.b.criticalDataMissing;
}

// find-or-create CONTROLADO de un canonical_market (+ evento) para una equivalencia matched.
// Busca primero un mapeo existente de A; si existe, reutiliza su canonical_market.
async function findOrCreateCanonical(r, providerAId) {
  const a = r.a;
  const existing = await dbRepos.mappings.findMarketMapping(providerAId, a.externalMarketId).catch(() => null);
  if (existing && existing.canonical_market_id) return existing.canonical_market_id;
  const ev = await dbRepos.canonicalEvents.insert({
    eventType: a.eventType, sport: a.sport, competition: a.competition, season: a.season,
    homeParticipant: (a.participants[0] || {}).code || null, awayParticipant: (a.participants[1] || {}).code || null,
    status: 'scheduled', metadata: { scope: a.scope, category: a.category },
  });
  const mk = await dbRepos.canonicalMarkets.insert({
    canonicalEventId: ev.id, marketType: a.family, period: a.period,
    drawPossible: a.normalizedRules.drawPossible, includesExtraTime: a.normalizedRules.includesExtraTime,
    includesPenalties: a.normalizedRules.includesPenalties, qualificationMarket: a.normalizedRules.qualificationMarket,
    rulesFingerprint: a.rulesFingerprint, metadata: { family: a.family },
  });
  return mk.id;
}

// persistResults(results, { providerA, providerB }) → resumen. No lanza.
async function persistResults(results, { providerA, providerB } = {}) {
  for (const r of results) metrics.recordResult(r);
  if (!cfg.flags.writeEnabled) return { persisted: false, reason: 'write_disabled', analyzed: results.length };

  let mappings = 0, reviews = 0, decisions = 0, autoMatches = 0;
  let provA = null, provB = null;
  try { provA = await dbRepos.providers.findByCode(providerA); provB = await dbRepos.providers.findByCode(providerB); } catch { /* noop */ }

  for (const r of results) {
    const hard = [...(r.event.conflicts || []), ...(r.market.conflicts || [])].filter(c => c.severity === 'hard');
    try {
      await repo.recordDecision({
        mappingEntityType: 'market', newStatus: r.market.status, newScore: r.market.score,
        decisionSource: 'auto', algorithmVersion: index.VERSIONS.marketMatcher,
        evidence: { eventStatus: r.event.status, evidence: r.market.evidence, hardConflicts: hard.map(c => c.code) },
      });
      decisions++;
    } catch { /* best-effort */ }

    if (isAutoMatchable(r) && provA && provB) {
      try {
        const canonicalMarketId = await findOrCreateCanonical(r, provA.id);
        await dbRepos.mappings.upsertMarketMapping({ providerId: provA.id, externalMarketId: r.a.externalMarketId, canonicalMarketId, mappingStatus: 'matched', mappingMethod: 'auto', equivalenceScore: r.market.score / 100, metadata: { evidence: r.market.evidence } });
        await dbRepos.mappings.upsertMarketMapping({ providerId: provB.id, externalMarketId: r.b.externalMarketId, canonicalMarketId, mappingStatus: 'matched', mappingMethod: 'auto', equivalenceScore: r.market.score / 100, metadata: { evidence: r.market.evidence } });
        mappings += 2; autoMatches++;
      } catch { /* best-effort */ }
    } else {
      try {
        await repo.upsertReviewItem({
          entityType: 'market', providerA, providerB,
          externalIdA: r.a.externalMarketId, externalIdB: r.b.externalMarketId,
          candidatePayload: { titleA: r.a.title, titleB: r.b.title, family: r.a.family, eventStatus: r.event.status, marketStatus: r.market.status },
          score: r.market.score, conflicts: hard, evidence: r.market.evidence,
          priority: r.market.status === 'conditional' ? 3 : r.market.status === 'needs_review' ? 2 : 1,
        });
        reviews++;
      } catch { /* best-effort */ }
    }
  }
  metrics.record('autoMatches', autoMatches);
  return { persisted: true, analyzed: results.length, mappings, reviews, decisions, autoMatches };
}

module.exports = { persistResults, isAutoMatchable, findOrCreateCanonical };
