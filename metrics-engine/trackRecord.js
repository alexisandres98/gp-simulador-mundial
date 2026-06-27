// metrics-engine/trackRecord.js — Fase I. Track record reproducible: por cada señal oficial post-epoch liquidada
// construye un METRIC FACT inmutable y versionado que CONGELA la probabilidad publicada (del payload inmutable;
// NO recalcula el modelo), el closing oficial (closing-policy-1) y el settlement final → Brier/log loss (reusa
// Sprint 6) + CLV (vs break-even) + ROI teórico flat-1-unit. Cohortes por estado administrativo. Empty → N/A
// (sample_size=0, nunca ceros engañosos). NO crea Picks/candidates ni publica nada.
'use strict';
const crypto = require('crypto');
const db = require('../database/client');
const cfg = require('./config');
const brier = require('./brier');
const logLoss = require('./logLoss');
const calibration = require('./calibration');

const POLICY = 'metrics-track-1';
// el Verified Epoch lo fija el Signal Registry (env compartido); metrics-engine/config no lo expone.
const VERIFIED_EPOCH = () => cfg.params.verifiedEpoch || process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH || null;
const ms = v => { if (!v) return null; const d = (v instanceof Date) ? v : new Date(v); return isNaN(d.getTime()) ? null : d.getTime(); };
const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const sha = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const EXCLUDED_SCOPES = ['internal_validation', 'internal_validation_pre_epoch', 'shadow', 'v2_diagnostic', 'challenger_diagnostic'];

// elegibilidad de Metrics (§3 + §11). Devuelve eligible | held | excluded + razón. NUNCA incluye pre-epoch,
// internal validation, V2 diagnostics, shadow, drafts, candidates, legacy.
function eligibility(sig, settlement, adminStatus, ctx = {}) {
  const epochMs = ms(ctx.verifiedEpoch !== undefined ? ctx.verifiedEpoch : VERIFIED_EPOCH());
  const published = ms(sig.published_at);
  const scope = (sig.metadata && sig.metadata.scope) || sig.scope || null;
  const E = r => ({ eligibility: 'excluded', reason: r });
  const H = r => ({ eligibility: 'held', reason: r });
  if (sig.experimental) return E('experimental_v2');
  if (sig.legacy || sig.verification_status === 'legacy_unverified') return E('legacy_unverified');
  if (EXCLUDED_SCOPES.includes(scope)) return E('excluded_scope:' + scope);
  if (sig.registry_status !== 'published' || sig.visibility === 'candidate' || sig.is_candidate) return E('not_published');
  if (!epochMs || published == null || published < epochMs) return E('pre_epoch');
  if (sig.signal_type !== 'model_prediction_v1') return E('schema_not_authorized:' + sig.signal_type);
  if (sig.verification_status !== 'verified' || !sig.score_eligible) return E('not_registry_eligible');
  if (adminStatus === 'DATA_ERROR') return E('data_error');
  if (adminStatus === 'ADMINISTRATIVE_VOID') return E('administrative_void');
  if (adminStatus === 'QUARANTINED') return H('quarantined');
  const st = settlement && settlement.settlement_status;
  if (!st || !['final', 'won', 'lost'].includes(st)) return H('settlement_not_final');
  if (adminStatus === 'RETRACTED') return E('retracted_visible'); // visible en cohorte, fuera de primaria
  return { eligibility: 'eligible', reason: null };
}

// buildFact — congela todo y computa métricas. SIEMPRE construye el fact (visibilidad/auditoría); el flag
// metrics_eligibility decide si entra a agregados primarios.
function buildFact(sig, closing, settlement, adminStatus, ctx = {}) {
  const payload = sig.signal_payload || {};
  const probs = payload.probabilities || {};
  const outcome = sig.direction || payload.predicted_outcome || null;
  const pHome = num(probs.home), pDraw = num(probs.draw), pAway = num(probs.away);
  const pOutcome = outcome && probs[outcome] != null ? num(probs[outcome]) : null;
  const publishedOdds = num(payload.published_odds);
  const breakEven = publishedOdds ? +(1 / publishedOdds).toFixed(8) : null;
  const elig = eligibility(sig, settlement, adminStatus, ctx);
  const st = settlement && settlement.settlement_status;
  const resultOutcome = settlement && settlement.result_outcome;
  const settledFinal = ['final', 'won', 'lost'].includes(st) && ['home', 'draw', 'away'].includes(resultOutcome);

  // Brier/log loss SOLO con settlement final factual (reusa Sprint 6). Sin settlement → null (no se inventa).
  const brierScore = settledFinal && pHome != null && pDraw != null && pAway != null ? brier.brierMulticlass({ home: pHome, draw: pDraw, away: pAway }, resultOutcome) : null;
  const ll = settledFinal && pHome != null ? logLoss.logLossMulticlass({ home: pHome, draw: pDraw, away: pAway }, resultOutcome) : null;

  // CLV desde closing oficial (closing-policy-1). closing.closing_probability = prob no-vig del outcome.
  const closingStatus = closing ? closing.closing_status : null;
  const closingProb = closing && closingStatus === 'AVAILABLE' ? num(closing.closing_probability) : null;
  const closingOdds = closing && closingStatus === 'AVAILABLE' ? num(closing.closing_odds) : null;
  // §2 semántica corregida (clv-semantics-2). NO es "no-vig vs no-vig": compara el precio de ENTRADA (1/best
  // published odds) contra el precio JUSTO del cierre (consenso no-vig).
  //   entry_price_vs_closing_fair_gap = official_closing_probability - published_break_even_probability (>0 = la cuota tomada era mejor que el precio justo del cierre).
  const entryVsClosingGap = (closingProb != null && breakEven != null) ? +(closingProb - breakEven).toFixed(8) : null;
  //   price_clv = published_odds / closing_fair_odds - 1, con closing_fair_odds = 1/official_closing_probability.
  const closingFairOdds = closingProb ? 1 / closingProb : null;
  const priceClv = (publishedOdds && closingFairOdds) ? +(publishedOdds / closingFairOdds - 1).toFixed(8) : null;
  //   market_move_no_vig = closing_no_vig - publication_no_vig: SOLO si se congeló el consenso no-vig al publicar.
  //   No se congela hoy (payload no lo trae) → null (no se inventa el dato).
  const pubNoVig = num(payload.publication_consensus_no_vig);
  const marketMoveNoVig = (closingProb != null && pubNoVig != null) ? +(closingProb - pubNoVig).toFixed(8) : null;
  // aliases DEPRECADOS (clv-semantics-1) por compatibilidad — mismos valores, no es no-vig vs no-vig.
  const clvProb = entryVsClosingGap, clvOdds = priceClv;

  // ROI teórico flat 1 unit (§10). theoretical, flat_1_unit_v1, executed_by_gp=false.
  let profit = null, ret = null;
  if (settledFinal) {
    const won = resultOutcome === outcome;
    profit = won ? +(publishedOdds - 1).toFixed(8) : -1; ret = won ? publishedOdds : 0;
  } else if (['void', 'cancelled'].includes(st)) { profit = 0; ret = 1; } // stake devuelto
  // postponed/abandoned/unresolved/provisional/administrative_void → ROI null (no liquidado / fuera de primaria)

  const fact = {
    signal_id: sig.id, registry_sequence: sig.chain_position != null ? Number(sig.chain_position) : null,
    canonical_event_id: sig.canonical_event_id || null, market: payload.market_type || sig.market || '1x2',
    period: payload.period || sig.period || 'regulation_90m', outcome,
    published_at: sig.published_at || null, kickoff_at: sig.event_start_at || null,
    official_model: 'V1', model_version: sig.model_version || null, policy_version: 'registry-policy-1',
    published_probability_home: pHome, published_probability_draw: pDraw, published_probability_away: pAway,
    published_outcome_probability: pOutcome, published_odds: publishedOdds, published_break_even_probability: breakEven,
    published_sportsbook: payload.published_sportsbook || null,
    closing_status: closingStatus, official_closing_probability: closingProb, official_closing_odds: closingOdds,
    closing_policy_version: closing ? closing.closing_policy_version : null, closing_snapshot_id: closing ? closing.closing_snapshot_id || closing.id || null : null,
    settlement_status: st || null, result_outcome: resultOutcome || null, settlement_result: resultOutcome || null,
    settlement_version: settlement ? settlement.settlement_version : null, settlement_policy_version: settlement ? settlement.settlement_policy_version : null,
    brier_score: brierScore, log_loss: ll, clv_probability: clvProb, clv_odds: clvOdds,
    entry_price_vs_closing_fair_gap: entryVsClosingGap, price_clv: priceClv, market_move_no_vig: marketMoveNoVig, clv_semantics_version: 'clv-semantics-2',
    flat_unit_profit: profit, flat_unit_return: ret,
    administrative_status: adminStatus || 'ACTIVE', metrics_eligibility: elig.eligibility, exclusion_reason: elig.reason,
    metrics_policy_version: POLICY,
  };
  fact.input_hash = sha({
    s: sig.id, p: { pHome, pDraw, pAway, publishedOdds }, pub: sig.published_at, ver: settlement ? settlement.settlement_version : null,
    st: st || null, ro: resultOutcome || null, cs: closingStatus, cp: closingProb, adm: adminStatus || 'ACTIVE', pol: POLICY,
  });
  return fact;
}

// carga la entrada por señal: closing efectivo + settlement efectivo (última versión) + estado admin.
async function loadInputs(client = db) {
  const sigs = (await client.query(`SELECT * FROM signals WHERE chain_position IS NOT NULL ORDER BY chain_position ASC`)).rows;
  const out = [];
  for (const sig of sigs) {
    const closing = (await client.query(`SELECT * FROM signal_closing_snapshots WHERE signal_id=$1 ORDER BY created_at DESC LIMIT 1`, [sig.id])).rows[0] || null;
    const settlement = (await client.query(`SELECT * FROM signal_settlements WHERE signal_id=$1 ORDER BY settlement_version DESC LIMIT 1`, [sig.id])).rows[0] || null;
    const adminState = (await client.query(`SELECT admin_status FROM signal_admin_state WHERE signal_id=$1`, [sig.id])).rows[0] || null;
    out.push({ sig, closing, settlement, adminStatus: adminState ? adminState.admin_status : 'ACTIVE' });
  }
  return out;
}

// persistFact — append-only, idempotente por input_hash. Si el input cambió (nuevo hash) y existe un fact
// efectivo previo de la señal → lo marca effective=false y enlaza supersedes (§5: no sobrescribe, versiona).
async function persistFact(fact, client = db) {
  const dup = (await client.query(`SELECT metric_fact_id FROM metric_facts WHERE input_hash=$1`, [fact.input_hash])).rows[0];
  if (dup) return { idempotent: true, metric_fact_id: dup.metric_fact_id };
  const prev = (await client.query(`SELECT metric_fact_id FROM metric_facts WHERE signal_id=$1 AND effective=true ORDER BY created_at DESC LIMIT 1`, [fact.signal_id])).rows[0];
  const cols = Object.keys(fact);
  const r = await client.query(
    `INSERT INTO metric_facts (${cols.join(',')}, supersedes_metric_fact_id, effective)
     VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}, $${cols.length + 1}, true) RETURNING metric_fact_id`,
    [...cols.map(c => fact[c]), prev ? prev.metric_fact_id : null]);
  if (prev) await client.query(`UPDATE metric_facts SET effective=false WHERE metric_fact_id=$1`, [prev.metric_fact_id]);
  return { metric_fact_id: r.rows[0].metric_fact_id, superseded: prev ? prev.metric_fact_id : null };
}

// rebuild — construye/persiste facts para todas las señales. Con 0 señales → 0 facts (no-op sano).
async function rebuild(opts = {}) {
  if (!cfg.flags.writeEnabled || !db.isConfigured()) return { built: 0, reason: 'disabled' };
  const inputs = await loadInputs();
  const ctx = { verifiedEpoch: VERIFIED_EPOCH() };
  let built = 0, idempotent = 0;
  for (const it of inputs) {
    const fact = buildFact(it.sig, it.closing, it.settlement, it.adminStatus, ctx);
    const r = await persistFact(fact);
    if (r.idempotent) idempotent++; else built++;
  }
  return { signals: inputs.length, built, idempotent };
}

// ---------- agregación + cohortes (§11-12) + snapshots (§13) ----------
const median = xs => { const a = xs.filter(Number.isFinite).slice().sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mean = xs => { const a = xs.filter(Number.isFinite); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };

// computeAggregate(facts) — sobre facts ELEGIBLES (primaria). Empty → N/A (value null + sample_size 0).
function computeAggregate(eligibleFacts) {
  const n = eligibleFacts.length;
  if (!n) return { sample_size: 0, status: 'insufficient_sample', note: 'Sin señales oficiales liquidadas desde el Verified Epoch' };
  const won = eligibleFacts.filter(f => f.result_outcome === f.outcome).length;
  const lost = eligibleFacts.filter(f => ['home', 'draw', 'away'].includes(f.result_outcome) && f.result_outcome !== f.outcome).length;
  const profits = eligibleFacts.map(f => num(f.flat_unit_profit)).filter(Number.isFinite);
  const risked = profits.length, profit = profits.reduce((a, b) => a + b, 0);
  const clvs = eligibleFacts.map(f => num(f.clv_probability)).filter(Number.isFinite);
  const calPoints = [];
  for (const f of eligibleFacts) for (const o of ['home', 'draw', 'away']) { const p = num(f['published_probability_' + o]); if (p != null && f.result_outcome) calPoints.push({ p, y: f.result_outcome === o ? 1 : 0 }); }
  const rel = calPoints.length ? calibration.reliability(calPoints, { buckets: cfg.params.calibrationBuckets || 10 }) : { ece: null, bins: [], n: 0 };
  return {
    sample_size: n, status: n < (cfg.params.sampleInsufficientMax || 29) ? 'insufficient_sample' : 'ok',
    settled: n, won, lost,
    theoretical_units_risked: risked, theoretical_profit: +profit.toFixed(6), theoretical_roi: risked ? +(profit / risked).toFixed(6) : null, theoretical_yield: risked ? +(profit / risked).toFixed(6) : null,
    economic_label: 'theoretical · flat_1_unit_v1 · executed_by_gp=false',
    avg_published_odds: mean(eligibleFacts.map(f => num(f.published_odds))), avg_closing_odds: mean(eligibleFacts.map(f => num(f.official_closing_odds))),
    clv_available: clvs.length, clv_average: clvs.length ? +mean(clvs).toFixed(8) : null, clv_median: clvs.length ? +median(clvs).toFixed(8) : null,
    positive_clv_rate: clvs.length ? +(clvs.filter(x => x > 0).length / clvs.length).toFixed(6) : null,
    brier_mean: mean(eligibleFacts.map(f => num(f.brier_score))), log_loss_mean: mean(eligibleFacts.map(f => num(f.log_loss))),
    ece: rel.ece, ece_sample: rel.n, calibration_bins: rel.bins,
  };
}

// cohortCounts(allEffectiveFacts) — §11. Counts por estado administrativo + CLV availability. Nada se oculta.
function cohortCounts(facts) {
  const by = s => facts.filter(f => (f.administrative_status || 'ACTIVE') === s).length;
  return {
    ALL_OFFICIAL_SIGNALS: facts.length,
    SETTLED_ELIGIBLE: facts.filter(f => f.metrics_eligibility === 'eligible').length,
    OPEN: facts.filter(f => f.metrics_eligibility === 'held' && f.exclusion_reason === 'settlement_not_final').length,
    RETRACTED: by('RETRACTED'), QUARANTINED: by('QUARANTINED'), CORRECTED: by('CORRECTED'),
    DATA_ERROR: by('DATA_ERROR'), ADMINISTRATIVE_VOID: by('ADMINISTRATIVE_VOID'),
    CLV_AVAILABLE: facts.filter(f => f.clv_probability != null).length,
    CLV_UNAVAILABLE: facts.filter(f => f.metrics_eligibility === 'eligible' && f.clv_probability == null).length,
  };
}

async function effectiveFacts(client = db) {
  return (await client.query(`SELECT * FROM metric_facts WHERE effective=true ORDER BY registry_sequence ASC`)).rows;
}

// snapshot — agrega y persiste snapshots versionados (global + por competición/market). Empty → snapshot N/A.
async function snapshot(opts = {}) {
  if (!cfg.flags.writeEnabled || !db.isConfigured()) return { created: 0, reason: 'disabled' };
  const facts = await effectiveFacts();
  // §13: con cero facts NO se crea snapshot (no-op, no fabricar valores). Evita spam de snapshots N/A por tick.
  if (!facts.length && !opts.force) return { created: 0, reason: 'no_facts', sample_size: 0 };
  const eligible = facts.filter(f => f.metrics_eligibility === 'eligible');
  const maxSeq = facts.reduce((m, f) => Math.max(m, Number(f.registry_sequence) || 0), 0) || null;
  const maxSettle = facts.reduce((m, f) => Math.max(m, Number(f.settlement_version) || 0), 0) || null;
  const payload = { aggregate: computeAggregate(eligible), cohorts: cohortCounts(facts) };
  const r = await db.query(
    `INSERT INTO metric_track_snapshots (scope, scope_key, metrics_policy_version, sample_size, metrics_payload, source_max_sequence, source_max_settlement_version)
     VALUES ('global','all',$1,$2,$3,$4,$5) RETURNING snapshot_id`,
    [POLICY, eligible.length, JSON.stringify(payload), maxSeq, maxSettle]);
  return { created: 1, snapshot_id: r.rows[0].snapshot_id, sample_size: eligible.length };
}

// status — preview admin (§15). Empty → N/A explícito, nunca ceros engañosos.
async function status() {
  if (!db.isConfigured()) return { enabled: cfg.flags.enabled, sample_size: 0, note: 'db not configured' };
  const facts = await effectiveFacts().catch(() => []);
  const eligible = facts.filter(f => f.metrics_eligibility === 'eligible');
  const agg = computeAggregate(eligible);
  const lastSnap = (await db.query(`SELECT snapshot_id, sample_size, created_at FROM metric_track_snapshots ORDER BY created_at DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows[0] || null;
  const present = v => (agg.sample_size === 0 || v == null) ? 'N/A' : v;
  return {
    metrics_policy_version: POLICY, verified_epoch: VERIFIED_EPOCH(),
    flags: { enabled: cfg.flags.enabled, write: cfg.flags.writeEnabled, scheduler: cfg.flags.schedulerEnabled, admin_preview: cfg.flags.adminPreviewEnabled, public: cfg.flags.publicEnabled },
    official_signals: facts.length, settled_eligible: eligible.length, open: agg.open || 0,
    sample_size: agg.sample_size, empty_state: agg.sample_size === 0 ? 'Sin señales oficiales liquidadas desde el Verified Epoch.' : null,
    cards: {
      theoretical_roi: present(agg.theoretical_roi), theoretical_profit_units: present(agg.theoretical_profit),
      brier: present(agg.brier_mean), log_loss: present(agg.log_loss_mean), avg_clv: present(agg.clv_average),
      positive_clv_rate: present(agg.positive_clv_rate), ece: present(agg.ece),
    },
    cohorts: cohortCounts(facts), last_snapshot: lastSnap,
  };
}

// ---------- §17 first-signal readiness gate ----------
// readiness({ canonicalEventId, ... }) → { ready, blockers[], block_reason }. Default: BLOQUEAR si falta mapping ESPN.
async function readiness(eventCtx = {}) {
  const blockers = [];
  const cei = eventCtx.canonicalEventId;
  if (!cei) { blockers.push('NO_CANONICAL_EVENT'); return { ready: false, blockers, block_reason: 'NO_CANONICAL_EVENT' }; }
  const checks = {
    canonical_event: !!(await db.query(`SELECT 1 FROM canonical_events WHERE id=$1`, [cei])).rows[0],
    sportsbook_quotes: !!(await db.query(`SELECT 1 FROM sportsbook_quote_current WHERE canonical_event_id=$1 AND market_family='1x2' LIMIT 1`, [cei])).rows[0],
    espn_fixture_mapping: !!(await db.query(`SELECT 1 FROM signal_event_fixture_mappings WHERE canonical_event_id=$1`, [cei])).rows[0],
    registry_operational: !!VERIFIED_EPOCH(),
    metrics_operational: cfg.flags.enabled,
  };
  if (!checks.canonical_event) blockers.push('NO_CANONICAL_EVENT');
  if (!checks.sportsbook_quotes) blockers.push('NO_SPORTSBOOK_SETS');
  if (!checks.espn_fixture_mapping) blockers.push('MISSING_RESULT_PROVIDER_MAPPING');
  if (!checks.registry_operational) blockers.push('REGISTRY_NOT_OPERATIONAL');
  if (!checks.metrics_operational) blockers.push('METRICS_NOT_OPERATIONAL');
  // §17: la opción por defecto es BLOQUEAR por MISSING_RESULT_PROVIDER_MAPPING (salvo override manual auditado).
  const block_reason = blockers.includes('MISSING_RESULT_PROVIDER_MAPPING') ? 'MISSING_RESULT_PROVIDER_MAPPING' : (blockers[0] || null);
  return { ready: blockers.length === 0, blockers, block_reason, checks };
}

module.exports = { POLICY, eligibility, buildFact, persistFact, rebuild, computeAggregate, cohortCounts, snapshot, status, readiness, loadInputs, effectiveFacts };
