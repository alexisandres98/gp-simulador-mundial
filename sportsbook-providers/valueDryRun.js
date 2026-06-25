// sportsbook-providers/valueDryRun.js — Post-shadow Bloque K. Ejecuta el pipeline COMPLETO de Value en
// DRY-RUN (con VALUE_ENGINE_WRITE_ENABLED=false): sets sincronizados (H) → outliers semánticos (I) →
// source independence verificada (J) → no-vig/consenso/ensemble/clasificación (Sprint 7) → registros SHADOW.
// NUNCA escribe value_evaluations/value_opportunities/pick_candidates/señales/métricas oficiales ni alertas.
'use strict';
const db = require('../database/client');
const setAssembly = require('./setAssembly');
const outliers = require('./outliers');
const sourceCatalog = require('./sourceCatalog');
const evaluate = require('../value-engine/evaluate');
const vcfg = require('../value-engine/config');

const OUTCOMES = ['home', 'draw', 'away'];

// lee current state de eventos YA enlazados a canonical (sin enlace → no entra a consenso/Value).
async function linkedEvents(provider) {
  const r = await db.query(
    `SELECT canonical_event_id, external_event_id, sportsbook_code, independence_group, external_outcome_id,
            odds_decimal, quote_status, is_live, provider_update, period, market_family, metadata
     FROM sportsbook_quote_current
     WHERE data_provider=$1 AND canonical_event_id IS NOT NULL AND market_family='1x2'
     ORDER BY canonical_event_id`, [provider]);
  const byEvent = new Map();
  for (const row of r.rows) {
    const k = row.canonical_event_id;
    if (!byEvent.has(k)) byEvent.set(k, []);
    byEvent.get(k).push(row);
  }
  return byEvent;
}

function bestPrices(cleanSets) {
  const bp = {};
  for (const o of OUTCOMES) {
    let best = null;
    for (const s of cleanSets) { const od = s.quotes[o] && s.quotes[o].odds; if (od && (best == null || od > best)) best = od; }
    if (best != null) bp[o] = { decimalOdds: best };
  }
  return bp;
}

// runDryRun({ provider, now, gpResolver, persistShadow }) → resumen. gpResolver(event)→gp|null (opcional).
async function runDryRun({ provider = 'the_odds_api', now = null, gpResolver = null, persistShadow = null } = {}) {
  const catalog = await sourceCatalog.load(provider).catch(() => ({}));
  const events = await linkedEvents(provider);
  const policy = { ensemble: vcfg.VERSIONS.ensemble, no_vig: vcfg.OFFICIAL_NO_VIG, classification: vcfg.VERSIONS.classification };
  const summary = { provider, evaluated: 0, blocked: 0, pass: 0, watch: 0, lean: 0, strong: 0, events: events.size, evaluations: [], policy_versions: policy };

  for (const [canonicalEventId, rows] of events) {
    // H: sets sincronizados
    const { sets, rejected } = setAssembly.assembleSets(rows, { now, maxSkewMs: vcfg.params.maxBookOutcomeSkewMs, maxAgeMs: vcfg.params.maxQuoteAgePrematchMs });
    // I: outliers semánticos
    const od = outliers.detectOutliers(sets);
    const clean = od.clean;
    // J: grupos independientes verificados entre las casas LIMPIAS
    const cls = sourceCatalog.classify(clean.map(s => s.sportsbook), catalog);

    const meta = rows[0] && rows[0].metadata ? rows[0].metadata : {};
    const label = `${meta.home_team || '?'} vs ${meta.away_team || '?'}`;
    const gp = gpResolver ? (gpResolver({ canonicalEventId, label, meta }) || null) : null;

    const input = {
      canonicalEventId, canonicalMarketId: null,
      gp, predictionMarket: null,
      sportsbooks: clean.map(s => ({ sportsbook: s.sportsbook, independence_group: s.independence_group, quotes: s.quotes, fresh: true })),
      bestPrices: bestPrices(clean),
      mappingMatched: true, outcomeMatched: true, hardConflicts: 0, rulesOk: true,
      freshnessOk: clean.length > 0, eventStarted: false,
      mappingVersion: 'sportsbook-canonical-1', rulesVersion: 'rule-fp-2', priceStable: true,
      snapshotIds: [],
      // Bloque J: STRONG cuenta SOLO grupos verificados; Bloque I: outlier sin resolver bloquea STRONG
      verifiedIndependenceGroups: cls.verified_independence_groups,
      criticalContradiction: od.hasUnresolved,
    };

    const result = evaluate.evaluateMarket(input);
    for (const o of OUTCOMES) {
      const ev = result.outcomes[o];
      const c = ev.classification;
      const isBlocked = (ev.strong_blockers && ev.strong_blockers.some(b => ['consensus_unavailable', 'mapping_not_matched', 'outcome_not_matched', 'stale', 'event_started'].includes(b))) || clean.length === 0;
      summary.evaluated++;
      if (clean.length === 0) summary.blocked++;
      else summary[c] = (summary[c] || 0) + 1;
      summary.evaluations.push({
        canonical_event_id: canonicalEventId, external_event_id: rows[0].external_event_id, selection: o,
        event_label: label, classification: clean.length === 0 ? 'blocked' : c,
        reason_codes: ev.rejection_reasons || [], strong_blockers: ev.strong_blockers || [],
        source_count: ev.source_count, verified_independence_groups: cls.verified_independence_groups,
        consensus_completeness: result.consensus.status === 'ok' ? 'complete' : 'incomplete',
        no_vig_methods: { official: vcfg.OFFICIAL_NO_VIG }, method_disagreement: null,
        ensemble_probability: ev.ensemble_probability, uncertainty_score: ev.uncertainty_score, quality_score: ev.quality_score,
        best_decimal_odds: ev.best_decimal_odds, minimum_acceptable_odds: ev.minimum_acceptable_odds, maximum_acceptable_price: ev.maximum_acceptable_price,
        freshness_ok: input.freshnessOk, policy_versions: policy,
        _diagnostics: { sets: sets.length, clean: clean.length, rejected, outliers: od.outliers },
      });
    }
  }

  // K: persistencia SOLO a tablas shadow, gateada, nunca oficial.
  if (persistShadow || vcfg.flags.valueShadowRuns) await persistShadowRun(summary);
  return summary;
}

async function persistShadowRun(summary) {
  if (!db.isConfigured()) return;
  await db.withTransaction(async (c) => {
    const run = (await c.query(
      `INSERT INTO sportsbook_value_shadow_runs (status, evaluated, blocked, pass, watch, lean, strong, policy_versions, summary, finished_at)
       VALUES ('success',$1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING id`,
      [summary.evaluated, summary.blocked, summary.pass || 0, summary.watch || 0, summary.lean || 0, summary.strong || 0,
       JSON.stringify(summary.policy_versions), JSON.stringify({ events: summary.events })])).rows[0];
    for (const e of summary.evaluations) {
      await c.query(
        `INSERT INTO sportsbook_value_shadow_evaluations
          (shadow_run_id, canonical_event_id, external_event_id, selection, event_label, classification, reason_codes, strong_blockers,
           source_count, verified_independence_groups, consensus_completeness, no_vig_methods, method_disagreement,
           ensemble_probability, uncertainty_score, quality_score, best_decimal_odds, minimum_acceptable_odds, maximum_acceptable_price, freshness_ok, policy_versions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [run.id, e.canonical_event_id, e.external_event_id, e.selection, e.event_label, e.classification,
         JSON.stringify(e.reason_codes), JSON.stringify(e.strong_blockers), e.source_count, e.verified_independence_groups,
         e.consensus_completeness, JSON.stringify(e.no_vig_methods), e.method_disagreement, e.ensemble_probability,
         e.uncertainty_score, e.quality_score, e.best_decimal_odds, e.minimum_acceptable_odds, e.maximum_acceptable_price,
         e.freshness_ok, JSON.stringify(e.policy_versions)]);
    }
    summary.shadow_run_id = run.id;
  });
}

module.exports = { runDryRun, linkedEvents, bestPrices };
