// signal-registry/publisher.js — Sprint 5. Registra una señal inmutable. published_at es SERVER-SIDE.
// Flujo: schema → eligibility → (dry-run | cadena). Soporta client externo para atomicidad con Sprint 4.
'use strict';
const crypto = require('crypto');
const db = require('../database/client');
const cfg = require('./config');
const schemas = require('./schemas');
const eligibility = require('./eligibility');
const hashing = require('./hashing');
const chain = require('./chain');

function newPublicId() { return 'sig_' + crypto.randomBytes(9).toString('hex'); }
function err(code) { const e = new Error(code); e.code = code; return e; }

// register(input, opts) → { signal } | { dryRun, valid, errors, eligibility, contentHashPreview }
//   input: contenido lógico de la señal (NUNCA published_at desde el cliente).
//   opts:  { sourceRefs[], actorId, client?, now?, outcomeKnown?, legacyImport?, minSourceRefs? }
async function register(input, opts = {}) {
  if (!cfg.flags.enabled) throw err('registry_disabled');
  const now = opts.now || Date.now();
  const nowIso = new Date(now).toISOString();

  // 1) schema
  const v = schemas.validate(input.signal_type, input.signal_payload || {});

  // 2) construir la señal (timestamps server-side)
  const experimental = input.signal_type === 'gp_intelligence_experiment' ? true : !!input.experimental;
  const sourceRefs = opts.sourceRefs || [];
  const elig = eligibility.evaluate({
    ...input, experimental, published_at: nowIso, methodology_version: input.methodology_version || methodologyFor(input),
  }, { now, schemaValid: v.ok, sourceRefCount: sourceRefs.length, minSourceRefs: opts.minSourceRefs, outcomeKnown: opts.outcomeKnown, legacyImport: opts.legacyImport });

  const signal = {
    signal_type: input.signal_type,
    signal_schema_version: v.schemaVersion,
    public_id: input.public_id || newPublicId(),
    visibility: input.visibility || 'internal',
    registry_status: 'published',
    verification_status: elig.verification_status,
    score_eligible: elig.score_eligible,
    experimental: elig.experimental,
    legacy: elig.legacy,
    canonical_event_id: input.canonical_event_id || null,
    canonical_market_id: input.canonical_market_id || null,
    canonical_outcome_id: input.canonical_outcome_id || null,
    direction: input.direction || null,
    event_start_at: input.event_start_at || null,
    market_close_at: input.market_close_at || null,
    source_created_at: input.source_created_at || nowIso,
    published_at: nowIso,           // SERVER-SIDE, no se acepta del frontend
    locked_at: nowIso,
    input_cutoff_at: input.input_cutoff_at || null,
    model_version: input.model_version || null,
    methodology_version: input.methodology_version || methodologyFor(input),
    mapping_version: input.mapping_version || null,
    rules_version: input.rules_version || null,
    normalizer_version: input.normalizer_version || null,
    signal_payload: input.signal_payload || {},
    public_payload: input.public_payload || null,
    snapshot_ids: input.snapshot_ids || [],
    prediction_edition: input.prediction_edition || null,
    supersedes_signal_id: input.supersedes_signal_id || null,
    metadata: { ...(input.metadata || {}), schema_errors: v.ok ? undefined : v.errors, eligibility_reasons: elig.reasons },
  };

  // 3) dry-run si write está apagado
  if (!cfg.flags.writeEnabled) {
    const preview = hashing.contentHash({ ...signal, source_references: sourceRefs });
    return { dryRun: true, valid: v.ok, errors: v.errors, eligibility: elig, contentHashPreview: preview, signal };
  }

  // payload inválido NO se persiste como señal oficial
  if (!v.ok) throw err('invalid_payload:' + v.errors.join(','));

  // 4) persistir en la cadena (transacción propia o externa para atomicidad con Sprint 4)
  const run = async (client) => chain.appendSignalTx(client, signal, sourceRefs, { actorId: opts.actorId });
  const row = opts.client ? await run(opts.client) : await db.withTransaction(run);
  return { signal: row };
}

function methodologyFor(input) {
  if (input.signal_type === 'model_prediction_v1') return cfg.V1_METHODOLOGY_VERSION;
  return input.methodology_version || null;
}

module.exports = { register, newPublicId };
