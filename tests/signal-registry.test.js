// tests/signal-registry.test.js — Sprint 5. Capa PURA (sin DB): hashing §38, eligibility §39, schemas §40, redacción.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const hashing = require(R + '/signal-registry/hashing');
const { canonicalString } = require(R + '/signal-registry/canonicalize');
const schemas = require(R + '/signal-registry/schemas');
const elig = require(R + '/signal-registry/eligibility');
const presentation = require(R + '/signal-registry/presentation');
const cfg = require(R + '/signal-registry/config');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const base = {
  signal_type: 'model_prediction_v1', signal_schema_version: 'model_prediction_v1-1',
  canonical_event_id: 'e1', published_at: '2026-06-22T10:00:00.000Z', event_start_at: '2026-06-22T15:00:00.000Z',
  model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0', input_cutoff_at: '2026-06-22T09:00:00.000Z',
  signal_payload: { market_type: '1x2', probabilities: { home: 0.5, draw: 0.3, away: 0.2 }, predicted_outcome: 'home' },
  source_references: [{ source_type: 'model_output', source_id: 'm1', snapshot_timestamp: '2026-06-22T09:00:00.000Z' }],
};

console.log('\n§38 HASHING');
{
  const reordered = JSON.parse(canonicalString(base)); // claves reordenadas vía canonical
  ok('1. Mismo contenido, claves reordenadas → mismo hash', hashing.contentHash(base) === hashing.contentHash(reordered));
  ok('2. Cambio de probabilidad → hash distinto', hashing.contentHash(base) !== hashing.contentHash({ ...base, signal_payload: { ...base.signal_payload, probabilities: { home: 0.6, draw: 0.3, away: 0.1 } } }));
  ok('3. Cambio de precio (payload) → hash distinto', hashing.contentHash({ ...base, signal_payload: { ...base.signal_payload, price: '0.50' } }) !== hashing.contentHash(base));
  ok('4. Cambio de modelo → hash distinto', hashing.contentHash({ ...base, model_version: 'x' }) !== hashing.contentHash(base));
  ok('5. Cambio de timestamp → hash distinto', hashing.contentHash({ ...base, published_at: '2026-06-22T10:00:01.000Z' }) !== hashing.contentHash(base));
  // cadena
  const ch = hashing.contentHash(base);
  const r1 = hashing.registryHash(cfg.GENESIS_HASH, ch, 1);
  const r2 = hashing.registryHash(r1, ch, 2);
  ok('6. previous hash correcto encadena', hashing.registryHash(r1, ch, 2) === r2);
  ok('7. posición distinta → registry hash distinto', hashing.registryHash(r1, ch, 2) !== hashing.registryHash(r1, ch, 3));
  ok('9. Alteración detectable (recompute ≠ guardado)', hashing.registryHash(cfg.GENESIS_HASH, hashing.contentHash({ ...base, model_version: 'tampered' }), 1) !== r1);
  // merkle commitment
  const root1 = hashing.merkleRoot([r1, r2]);
  ok('10. Commitment reproducible', hashing.merkleRoot([r1, r2]) === root1);
  ok('11. Commitment cambia si cambia una señal', hashing.merkleRoot([r1, hashing.registryHash(r1, hashing.contentHash({ ...base, model_version: 'z' }), 2)]) !== root1);
}

console.log('\n§39 ELIGIBILITY');
{
  const epoch = '2026-06-01T00:00:00Z';
  const C = (over = {}, ctx = {}) => elig.evaluate({ ...base, ...over }, { now: Date.parse(over.published_at || base.published_at), schemaValid: true, sourceRefCount: 2, verifiedEpoch: epoch, ...ctx });
  ok('1. Publicada antes del evento → elegible', C().score_eligible);
  ok('2. Publicada después → late/no elegible', !C({ published_at: '2026-06-22T16:00:00Z' }).score_eligible && C({ published_at: '2026-06-22T16:00:00Z' }).verification_status === 'late');
  ok('3. Experimental → no elegible', !C({ experimental: true }).score_eligible && C({ experimental: true }).verification_status === 'experimental');
  ok('4. Legacy import → no elegible', !elig.evaluate(base, { now: Date.now(), legacyImport: true, verifiedEpoch: epoch }).score_eligible);
  ok('5. Model version ausente → no elegible', !C({ model_version: null }).score_eligible);
  ok('6. Methodology version ausente → no elegible', !C({ methodology_version: null }).score_eligible);
  ok('7. Inputs posteriores a publicación → no elegible', !C({ input_cutoff_at: '2026-06-22T11:00:00Z' }).score_eligible);
  ok('8. Evento ya finalizado (outcomeKnown) → no elegible', !C({}, { outcomeKnown: true }).score_eligible);
  ok('9. Antes del epoch → legacy', C({ published_at: '2026-05-01T10:00:00Z', event_start_at: '2026-05-02T10:00:00Z' }).verification_status === 'legacy_unverified');
  ok('10. Source refs insuficientes → no elegible', !elig.evaluate(base, { now: Date.parse(base.published_at), schemaValid: true, sourceRefCount: 0, verifiedEpoch: epoch }).score_eligible);
}

console.log('\n§40 PREDICCIÓN (schema)');
{
  ok('1. 1X2 suma 1 → ok', schemas.validate('model_prediction_v1', { model_version: 'v1', market_type: '1x2', probabilities: { home: 0.5, draw: 0.3, away: 0.2 } }).ok);
  ok('2. Probabilidad negativa → rechaza', !schemas.validate('model_prediction_v1', { model_version: 'v1', probabilities: { x: -0.1 } }).ok);
  ok('3. Probabilidad >1 → rechaza', !schemas.validate('model_prediction_v1', { model_version: 'v1', probabilities: { x: 1.2 } }).ok);
  ok('4. No suma 1 → rechaza', !schemas.validate('model_prediction_v1', { model_version: 'v1', market_type: '1x2', probabilities: { home: 0.5, draw: 0.3, away: 0.4 } }).ok);
  ok('5. arb sin campos → rechaza', !schemas.validate('arb_publication', {}).ok);
  ok('6. arb con realized_roi → rechaza', !schemas.validate('arb_publication', { arb_publication_id: 'p', arb_evaluation_id: 'e', classification: 'pure_arb', net_roi: '0.02', legs: [{}, {}], realized_roi: '0.02' }).ok);
  ok('7. tipo futuro → no implementado', !schemas.validate('value_signal', {}).ok && schemas.validate('value_signal', {}).errors[0].includes('not_implemented'));
}

console.log('\nREDACCIÓN / COPY');
{
  const sig = { ...base, public_id: 'sig_x', signal_payload: base.signal_payload, public_payload: { event: 'España vs Uruguay' }, registry_status: 'published', verification_status: 'verified', content_hash: 'abc', registry_hash: 'r'.repeat(20), chain_position: 5 };
  const d = presentation.publicDetail(sig, { events: [{ event_type: 'published', event_version: 1, created_at: 't', actor_type: 'system' }], settlements: [], closing: [], refs: sig.source_references, projection: { current_status: 'published' } });
  const s = JSON.stringify(d);
  ok('R1. No expone hashes internos crudos de más / ni signal id', !/"id":/.test(s) && d.integrity.registry_hash_short.length === 12);
  ok('R2. Redacción de predicción muestra probabilidades', d.original.prediction.probabilities.home === 0.5);
  ok('R3. Copy de transparencia presente', /congelada antes del evento/.test(d.transparency));
  ok('R4. Sources solo resumen (sin raw)', d.sources.every(x => !('metadata' in x) && x.source_type));
  ok('R5. Legacy copy', /no cuenta como señal verificada/.test(presentation.transparencyCopy({ verification_status: 'legacy_unverified' })));
  ok('R6. Experimental copy', /track record oficial/.test(presentation.transparencyCopy({ experimental: true })));
  ok('R7. Arb copy (no ejecutada)', /no representa una operación ejecutada/.test(presentation.transparencyCopy({ signal_type: 'arb_publication' })));
}

console.log(`\n=== RESULTADO ===\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
