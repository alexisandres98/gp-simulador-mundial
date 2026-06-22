// value-engine/index.js — Sprint 7. Fachada del Value Engine + Picks. Gating por flags. No conecta al requerir.
'use strict';
const cfg = require('./config');
const repo = require('./repositories');
const { evaluateMarket } = require('./evaluate');
const picks = require('./picks');

async function adminStatus() {
  const out = { flags: cfg.flags, params: { thresholds: cfg.params.thresholds, weights: cfg.params.weights }, versions: cfg.VERSIONS, officialNoVig: cfg.OFFICIAL_NO_VIG, counts: null, picks: null };
  if (cfg.platform.db.configured) {
    try { out.counts = await repo.evaluations.counts(); } catch { /* noop */ }
    try { out.picks = await repo.publications.counts(); } catch { /* noop */ }
  }
  return out;
}

// evaluateAndPersist(input, opts) → { evaluations, candidates }. Persiste si write on. Crea candidatas SOLO de STRONG.
async function evaluateAndPersist(input, opts = {}) {
  const result = evaluateMarket(input);
  const out = { classifications: {}, evaluations: [], candidates: [] };
  for (const o of Object.keys(result.outcomes)) {
    const ev = result.outcomes[o];
    out.classifications[o] = ev.classification;
    if (!cfg.flags.valueWrite) continue;
    const row = await repo.evaluations.insert(ev);
    out.evaluations.push(row);
    const oppKey = `${ev.canonical_event_id}|${ev.canonical_market_id}|${ev.selection}`;
    const opp = await repo.opportunities.upsert({ opportunity_key: oppKey, canonical_event_id: ev.canonical_event_id, canonical_market_id: ev.canonical_market_id, canonical_outcome_id: ev.canonical_outcome_id, selection: ev.selection, status: ev.classification === 'strong' ? 'strong' : ev.classification, current_evaluation_id: row.id, best_adjusted_ev: ev.adjusted_ev, best_adjusted_edge_pp: ev.adjusted_edge_pp, best_decimal_odds: ev.best_decimal_odds });
    // candidata a pick SOLO si STRONG elegible y picks habilitado
    if (cfg.flags.picksEnabled && row.classification === 'strong') {
      const c = await picks.createCandidate(row, { opportunityId: opp.id, sportsbookCode: opts.sportsbookCode, deepLink: opts.deepLink, marketLabel: opts.marketLabel, contextStatus: opts.contextStatus });
      if (c.created) out.candidates.push(c.candidate);
    }
  }
  return out;
}

// lecturas públicas (gated)
async function publicValueSignals({ limit = 50 } = {}) {
  if (!cfg.flags.valuePublic) return { items: [], enabled: false };
  const rows = await repo.evaluations.recent({ limit });
  return { enabled: true, items: rows.map(publicEval) };
}
function publicEval(e) {
  return { classification: e.classification, selection: e.selection, ensemble_probability: numN(e.ensemble_probability), conservative_probability: numN(e.conservative_probability),
    sportsbook_consensus: numN(e.sportsbook_consensus_probability), gp_probability: numN(e.gp_probability), best_decimal_odds: numN(e.best_decimal_odds), fair_odds: numN(e.fair_odds),
    minimum_acceptable_odds: numN(e.minimum_acceptable_odds), adjusted_edge_pp: numN(e.adjusted_edge_pp), quality_score: e.quality_score, uncertainty_score: e.uncertainty_score, calculated_at: e.created_at };
}
async function publicPicks({ limit = 50 } = {}) {
  if (!cfg.flags.picksPublic) return { items: [], enabled: false };
  const rows = await repo.publications.listPublic({ limit });
  return { enabled: true, items: rows.map(p => ({ public_id: p.public_id, ...p.public_payload, status: p.publication_status, current_odds: numN(p.current_odds), published_at: p.published_at })) };
}
async function publicPick(publicId) {
  if (!cfg.flags.picksPublic) return { error: 'not_enabled' };
  const p = await repo.publications.byPublicId(publicId);
  if (!p || !['published', 'price_moved', 'closed', 'settlement_pending', 'settled', 'void', 'disputed'].includes(p.publication_status)) return { error: 'not_found' };
  return { detail: { public_id: p.public_id, ...p.public_payload, status: p.publication_status, current_odds: numN(p.current_odds), published_at: p.published_at, history: await repo.history.forPublication(p.id) } };
}
function numN(v) { const x = parseFloat(v); return Number.isFinite(x) ? x : null; }

module.exports = { cfg, adminStatus, evaluateAndPersist, picks, repo, publicValueSignals, publicPicks, publicPick, evaluateMarket };
