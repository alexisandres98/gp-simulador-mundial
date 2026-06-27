// sportsbook-providers/valueDryRun.js — Post-shadow Bloque K. Ejecuta el pipeline COMPLETO de Value en
// DRY-RUN (con VALUE_ENGINE_WRITE_ENABLED=false): sets sincronizados (H) → outliers semánticos (I) →
// source independence verificada (J) → no-vig/consenso/ensemble/clasificación (Sprint 7) → registros SHADOW.
// NUNCA escribe value_evaluations/value_opportunities/pick_candidates/señales/métricas oficiales ni alertas.
'use strict';
const db = require('../database/client');
const setAssembly = require('./setAssembly');
const outliers = require('./outliers');
const sourceCatalog = require('./sourceCatalog');
const valueMetadata = require('./valueMetadata');
const evaluate = require('../value-engine/evaluate');
const vcfg = require('../value-engine/config');

const OUTCOMES = ['home', 'draw', 'away'];

// lee current state de eventos YA enlazados a canonical (sin enlace → no entra a consenso/Value).
async function linkedEvents(provider) {
  const r = await db.query(
    `SELECT canonical_event_id, external_event_id, sportsbook_code, independence_group, external_outcome_id,
            odds_decimal, quote_status, is_live, provider_update, observed_at, period, market_family, metadata
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

// buildEventInput — arma el input del Value Engine para UN evento canonical-matched: sets sincronizados (H) +
// outliers (I) + grupos verificados (J) + GP. Reutilizado por dry-run (shadow) y por el write oficial (Fase E).
async function buildEventInput(canonicalEventId, rows, { now = null, catalog = {}, gpResolver = null } = {}) {
  const { sets, rejected } = setAssembly.assembleSets(rows, { now, maxSkewMs: vcfg.params.maxBookOutcomeSkewMs, maxAgeMs: vcfg.params.maxQuoteAgePrematchMs });
  const od = outliers.detectOutliers(sets);
  const clean = od.clean;
  const cls = sourceCatalog.classify(clean.map(s => s.sportsbook), catalog);
  const meta = rows[0] && rows[0].metadata ? rows[0].metadata : {};
  const label = `${meta.home_team || '?'} vs ${meta.away_team || '?'}`;
  const gp = gpResolver ? ((await gpResolver({ canonicalEventId, label, meta })) || null) : null;
  const gpMeta = gp ? { model_version: gp.model_version || null, elo_snapshot: gp.elo_snapshot || null, calc_ts: gp.calc_ts || null } : null;
  const input = {
    canonicalEventId, canonicalMarketId: null,
    gp, predictionMarket: null,
    sportsbooks: clean.map(s => ({ sportsbook: s.sportsbook, independence_group: s.independence_group, quotes: s.quotes, fresh: true })),
    bestPrices: bestPrices(clean),
    mappingMatched: true, outcomeMatched: true, hardConflicts: 0, rulesOk: true,
    freshnessOk: clean.length > 0, eventStarted: false,
    mappingVersion: 'sportsbook-canonical-1', rulesVersion: 'rule-fp-2', priceStable: true,
    snapshotIds: [],
    verifiedIndependenceGroups: cls.verified_independence_groups,  // J: STRONG solo cuenta verificados
    criticalContradiction: od.hasUnresolved,                       // I: outlier sin resolver bloquea STRONG
  };
  return { input, label, sets, clean, rejected, cls, gpMeta, outliers: od.outliers };
}

// runOfficial — Fase E (activación interna): escribe value_evaluations/value_opportunities OFICIALES internas
// vía ve.evaluateAndPersist (idempotente por input_hash). Picks DEBE estar off → no crea candidates ni señales.
// Requiere VALUE_ENGINE_ENABLED=true + VALUE_ENGINE_WRITE_ENABLED=true en el entorno.
async function runOfficial({ provider = 'the_odds_api', now = null, gpResolver = null } = {}) {
  const ve = require('../value-engine');
  const catalog = await sourceCatalog.load(provider).catch(() => ({}));
  const events = await linkedEvents(provider);
  const out = { provider, events: events.size, evaluated: 0, persisted: 0, opportunities: 0, candidates: 0, by_class: {}, write_enabled: ve.cfg.flags.valueWrite, picks_enabled: ve.cfg.flags.picksEnabled, rows: [] };
  for (const [canonicalEventId, rows] of events) {
    const { input, label } = await buildEventInput(canonicalEventId, rows, { now, catalog, gpResolver });
    if (!input.sportsbooks.length) continue;  // sin sets frescos → no se evalúa
    const r = await ve.evaluateAndPersist(input, {});
    for (const o of Object.keys(r.classifications)) { out.evaluated++; const c = r.classifications[o]; out.by_class[c] = (out.by_class[c] || 0) + 1; }
    out.persisted += (r.evaluations || []).length;
    out.candidates += (r.candidates || []).length;
    out.rows.push({ canonicalEventId, label, classifications: r.classifications });
  }
  return out;
}

// writeEvalMetadata — UPDATE aditivo de las columnas de metadata (Checkpoint 2.2). NO toca probs/edges/quality_score.
async function writeEvalMetadata(id, m) {
  // Fase P: el modelo oficial efectivo (V1 hasta el cutover; V2 después). Enum controlado (sin inyección).
  const OFFICIAL = /v2/i.test(process.env.GP_OFFICIAL_MODEL || 'v1') ? 'V2' : 'V1';
  await db.query(
    `UPDATE value_evaluations SET
       evaluation_mode=$2, validation_run_id=$3, registry_eligible=false, pick_candidate_eligible=false, public_eligible=false,
       official_gp_model='${OFFICIAL}', challenger_gp_model='V2', challenger_official_weight=0,
       best_sportsbook_code=$4, best_sportsbook_name=$5, best_price_observed_at=$6, best_price_provider_updated_at=$7, best_price_deep_link=$8,
       raw_sportsbook_count=$9, usable_sportsbook_count=$10, verified_sportsbook_count=$11, unverified_sportsbook_count=$12, duplicate_skin_count=$13, verified_independence_group_count=$14,
       gp_vs_consensus_pp=$15, ensemble_vs_consensus_pp=$16, consensus_vs_best_price_break_even_pp=$17, edge_source_code=$18,
       quality_raw_points=$19, quality_max_points=$20, quality_normalized_percent=$21, quality_components=$22, quality_policy_version=$23,
       detail = COALESCE(detail,'{}'::jsonb) || jsonb_build_object('quality_diagnostic_v2_score',$24::numeric,'quality_diagnostic_v2_components',$25::jsonb,'best_price_comparables',$26::jsonb)
     WHERE id=$1 AND COALESCE(evaluation_mode,'') <> 'internal_validation_pre_epoch'`,
    [id, m.evaluation_mode, m.validation_run_id, m.best_sportsbook_code, m.best_sportsbook_name, m.best_price_observed_at, m.best_price_provider_updated_at, m.best_price_deep_link,
     m.raw_sportsbook_count, m.usable_sportsbook_count, m.verified_sportsbook_count, m.unverified_sportsbook_count, m.duplicate_skin_count, m.verified_independence_group_count,
     m.gp_vs_consensus_pp, m.ensemble_vs_consensus_pp, m.consensus_vs_best_price_break_even_pp, m.edge_source_code,
     m.quality_raw_points, m.quality_max_points, m.quality_normalized_percent, JSON.stringify(m.quality_components), m.quality_policy_version,
     m.quality_diagnostic_v2_score, JSON.stringify(m.quality_diagnostic_v2_components), JSON.stringify(m._best_comparables || [])]);
}

// runValidation — Checkpoint 2.2 §12: rerun controlado. evaluateAndPersist (matemática SIN cambios) + poblado
// de metadata aditiva. evaluation_mode='internal_validation' (NO oficial). Picks/Registry off. No crea señales.
async function runValidation({ provider = 'the_odds_api', now = null, gpResolver = null, evaluationMode = 'internal_validation' } = {}) {
  const ve = require('../value-engine');
  const validationRunId = require('crypto').randomUUID();
  const catalog = await sourceCatalog.load(provider).catch(() => ({}));
  const events = await linkedEvents(provider);
  const out = { provider, validation_run_id: validationRunId, events: events.size, evaluated: 0, persisted: 0, metadata_written: 0, best_book_present: 0, by_class: {}, write_enabled: ve.cfg.flags.valueWrite, picks_enabled: ve.cfg.flags.picksEnabled };
  for (const [cei, rows] of events) {
    const built = await buildEventInput(cei, rows, { now, catalog, gpResolver });
    if (!built.input.sportsbooks.length) continue;
    const r = await ve.evaluateAndPersist(built.input, {});
    for (const o of Object.keys(r.classifications)) { out.evaluated++; out.by_class[r.classifications[o]] = (out.by_class[r.classifications[o]] || 0) + 1; }
    for (const evalRow of (r.evaluations || [])) {
      out.persisted++;
      const md = valueMetadata.computeMetadata(built, evalRow, { evaluationMode, validationRunId, catalog });
      await writeEvalMetadata(evalRow.id, md);
      out.metadata_written++;
      if (md.best_sportsbook_code) out.best_book_present++;
    }
  }
  // tag de scope SOLO en opportunities nuevas de este run (NO re-taguea las pre-epoch existentes)
  await db.query(`UPDATE value_opportunities SET evaluation_mode=$1, registry_eligible=false, pick_candidate_eligible=false, public_eligible=false WHERE evaluation_mode IS NULL`, [evaluationMode]).catch(() => {});
  return out;
}

// runDryRun({ provider, now, gpResolver, persistShadow }) → resumen. gpResolver(event)→gp|null (opcional).
async function runDryRun({ provider = 'the_odds_api', now = null, gpResolver = null, persistShadow = null } = {}) {
  const catalog = await sourceCatalog.load(provider).catch(() => ({}));
  const events = await linkedEvents(provider);
  const policy = { ensemble: vcfg.VERSIONS.ensemble, no_vig: vcfg.OFFICIAL_NO_VIG, classification: vcfg.VERSIONS.classification };
  const summary = { provider, evaluated: 0, blocked: 0, pass: 0, watch: 0, lean: 0, strong: 0, events: events.size, evaluations: [], policy_versions: policy };

  for (const [canonicalEventId, rows] of events) {
    const built = await buildEventInput(canonicalEventId, rows, { now, catalog, gpResolver });
    const { input, label, sets, clean, rejected, cls, gpMeta } = built;
    const od = { outliers: built.outliers };

    const result = evaluate.evaluateMarket(input);
    for (const o of OUTCOMES) {
      const ev = result.outcomes[o];
      const c = ev.classification;
      const isBlocked = (ev.strong_blockers && ev.strong_blockers.some(b => ['consensus_unavailable', 'mapping_not_matched', 'outcome_not_matched', 'stale', 'event_started'].includes(b))) || clean.length === 0;
      summary.evaluated++;
      if (clean.length === 0) summary.blocked++;
      else summary[c] = (summary[c] || 0) + 1;
      const md = ev._detail && ev._detail.uncertainty && Array.isArray(ev._detail.uncertainty.contributions)
        ? (ev._detail.uncertainty.contributions.find(x => x.code === 'no_vig_method_disagreement') || {}).points || null : null;
      summary.evaluations.push({
        canonical_event_id: canonicalEventId, external_event_id: rows[0].external_event_id, selection: o,
        event_label: label, classification: clean.length === 0 ? 'blocked' : c,
        reason_codes: ev.rejection_reasons || [], strong_blockers: ev.strong_blockers || [],
        // §6: probabilidades del pipeline
        gp_probability: ev.gp_probability, sportsbook_consensus_probability: ev.sportsbook_consensus_probability,
        ensemble_probability: ev.ensemble_probability, conservative_probability: ev.conservative_probability,
        // §6: precio y value
        best_decimal_odds: ev.best_decimal_odds, break_even_probability: ev.break_even_probability, fair_odds: ev.fair_odds,
        minimum_acceptable_odds: ev.minimum_acceptable_odds, maximum_acceptable_price: ev.maximum_acceptable_price,
        raw_edge_pp: ev.raw_edge_pp, adjusted_edge_pp: ev.adjusted_edge_pp, raw_ev: ev.raw_ev, adjusted_ev: ev.adjusted_ev,
        // §6: calidad/consenso
        source_count: ev.source_count, verified_independence_groups: cls.verified_independence_groups,
        consensus_completeness: result.consensus.status === 'ok' ? 'complete' : 'incomplete',
        no_vig_methods: { official: vcfg.OFFICIAL_NO_VIG, alt: vcfg.VERSIONS.noVigAlt }, method_disagreement: md,
        uncertainty_score: ev.uncertainty_score, quality_score: ev.quality_score, freshness_ok: input.freshnessOk,
        // §6 + regla 6: versiones + snapshot del modelo
        policy_versions: { ...policy, mapping: ev.mapping_version, no_vig: ev.no_vig_version, classification: ev.classification_version },
        model_version: ev.model_version, gp_meta: gpMeta,
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

// runOperational — Fase J §3. Modo OPERATIVO continuo: evaluation_mode='internal_operational'. NO escribe si la
// ingesta anterior falló o está stale (§3). Tras evaluar, marca pick_candidate_eligible=true SOLO en las STRONG
// sin blockers (la Candidate Factory toma esas). registry_eligible/public siguen false. NO crea señales ni picks.
async function runOperational({ provider = 'the_odds_api', now = null, gpResolver = null } = {}) {
  const st = (await db.query(`SELECT last_success_at FROM sportsbook_provider_state WHERE provider_name=$1 LIMIT 1`, [provider]).catch(() => ({ rows: [] }))).rows[0];
  const maxAge = parseInt(process.env.SPORTSBOOK_MAX_QUOTE_AGE_MS, 10) || 600000;
  const nowMs = now ? +new Date(now) : Date.now();
  if (!st || !st.last_success_at || (nowMs - +new Date(st.last_success_at)) > maxAge * 2) return { skipped: true, reason: 'stale_or_failed_ingestion' };
  const out = await runValidation({ provider, now, gpResolver, evaluationMode: 'internal_operational' });
  await db.query(
    `UPDATE value_evaluations SET pick_candidate_eligible = true
       WHERE evaluation_mode='internal_operational' AND classification='strong'
         AND COALESCE(jsonb_array_length(strong_blockers),0) = 0`).catch(() => {});
  return { ...out, mode: 'internal_operational' };
}

module.exports = { runDryRun, runOfficial, runValidation, runOperational, buildEventInput, linkedEvents, bestPrices };
