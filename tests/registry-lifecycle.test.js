// tests/registry-lifecycle.test.js — Fase H. Capa PURA (sin DB): closing eligibility (§4), política/anti-look-ahead
// (§5-6), resolver de settlement (§9-11), commitment eligibility + merkle (§15), contrato downstream (§13).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const elig = require(R + '/signal-registry/lifecycleEligibility');
const policy = require(R + '/signal-registry/closingPolicy');
const provider = require(R + '/signal-registry/settlementProvider');
const hashing = require(R + '/signal-registry/hashing');
const sm = require(R + '/signal-registry/stateMachine');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const EPOCH = '2026-06-26T17:29:19.815Z';
const KICK = '2026-07-01T18:00:00.000Z';
const baseSig = (over = {}) => ({
  published_at: '2026-06-28T10:00:00.000Z', event_start_at: KICK, verification_status: 'verified', score_eligible: true,
  canonical_event_id: 'ev1', canonical_market_id: 'mk1', canonical_outcome_id: 'home',
  signal_payload: { market_type: '1x2', period: 'regulation_90m', predicted_outcome: 'home' }, ...over,
});
const C = (over) => elig.closingEligible(baseSig(over), { verifiedEpoch: EPOCH, hasProviderMapping: true });

console.log('\n§4 CLOSING ELIGIBILITY');
ok('1. señal post-epoch oficial → elegible', C().eligible);
ok('2. pre-epoch excluida', !C({ published_at: '2026-06-20T10:00:00Z' }).eligible && C({ published_at: '2026-06-20T10:00:00Z' }).reasons.includes('pre_epoch'));
ok('3. internal_validation excluida', !C({ metadata: { scope: 'internal_validation' } }).eligible);
ok('3b. internal_validation_pre_epoch excluida', !C({ scope: 'internal_validation_pre_epoch' }).eligible);
ok('4. V2 diagnostic excluida', !C({ experimental: true }).eligible && !C({ scope: 'v2_diagnostic' }).eligible);
ok('sin canonical event → no elegible', !C({ canonical_event_id: null }).eligible);
ok('sin market/period/outcome → no elegible', !C({ canonical_market_id: null, signal_payload: { period: 'regulation_90m' } }).eligible);
ok('publicada tras kickoff → no elegible', !C({ published_at: '2026-07-01T19:00:00Z' }).eligible);
ok('sin provider mapping → no elegible', !elig.closingEligible(baseSig(), { verifiedEpoch: EPOCH, hasProviderMapping: false }).eligible);
ok('legacy_unverified excluida', !C({ verification_status: 'legacy_unverified' }).eligible);
ok('draft/candidate no publicado → no elegible', !C({ registry_status: 'draft' }).eligible);

console.log('\n§5-6 CLOSING POLICY / ANTI-LOOK-AHEAD');
const cap = (i) => policy.classifyCapture(i, KICK);
ok('5/6. set completo pre-kickoff (fresco) → AVAILABLE', cap({ observedAt: '2026-07-01T17:50:00Z', providerUpdatedAt: '2026-07-01T17:48:00Z', closingOdds: '2.0' }).status === 'AVAILABLE');
ok('7. quote actualizada post-kickoff → EVENT_STARTED (no usable)', cap({ observedAt: '2026-07-01T17:59:00Z', providerUpdatedAt: '2026-07-01T18:05:00Z', closingOdds: '2.0' }).status === 'EVENT_STARTED');
ok('7b. observada post-kickoff → EVENT_STARTED', cap({ observedAt: '2026-07-01T18:10:00Z', closingOdds: '2.0' }).status === 'EVENT_STARTED');
ok('8. quote vieja → STALE (usable, marcada)', cap({ observedAt: '2026-07-01T16:00:00Z', providerUpdatedAt: '2026-07-01T16:00:00Z', closingOdds: '2.0' }).status === 'STALE');
ok('9. suspendido → MARKET_SUSPENDED', cap({ suspended: true, observedAt: '2026-07-01T17:00:00Z', closingOdds: '2.0' }).status === 'MARKET_SUSPENDED');
ok('10. sin mercado equivalente → NO_EQUIVALENT_MARKET', cap({ noEquivalentMarket: true }).status === 'NO_EQUIVALENT_MARKET');
ok('sin dato → UNAVAILABLE', cap({ observedAt: null }).status === 'UNAVAILABLE');
ok('provider error → PROVIDER_ERROR', cap({ providerError: true }).status === 'PROVIDER_ERROR');
ok('policy version definida', policy.CLOSING_POLICY_VERSION === 'closing-policy-1' && policy.OFFICIAL_CLOSING_SOURCE === 'consensus_no_vig');
ok('clv components reproducibles + etiquetados', (() => { const x = policy.clvComponents({ publishedOdds: '2.0', closingOdds: '1.8', closingSource: 'consensus_no_vig' }); return x.entry_implied_probability === 0.5 && Math.abs(x.closing_implied_probability - 0.5556) < 0.001 && x.closing_source === 'consensus_no_vig'; })());

console.log('\n§9-11 SETTLEMENT PROVIDER (regulation 1X2)');
const r = (i) => provider.resolveRegulation1x2(i);
ok('1. home win', r({ providerStatus: 'final', regulationHomeGoals: 2, regulationAwayGoals: 0 }).result_outcome === 'home');
ok('2. draw', r({ providerStatus: 'final', regulationHomeGoals: 1, regulationAwayGoals: 1 }).result_outcome === 'draw');
ok('3. away win', r({ providerStatus: 'final', regulationHomeGoals: 0, regulationAwayGoals: 2 }).result_outcome === 'away');
ok('4/5. solo reglamentario (ET/pens NO incluidos: usa regulationGoals)', r({ providerStatus: 'final', regulationHomeGoals: 1, regulationAwayGoals: 1, hasExtraTimeOrPens: true }).result_outcome === 'draw');
ok('6. provisional', r({ providerStatus: 'live', regulationHomeGoals: 1, regulationAwayGoals: 0 }).settlement_status === 'provisional' && !r({ providerStatus: 'live', regulationHomeGoals: 1, regulationAwayGoals: 0 }).is_final);
ok('7. final', r({ providerStatus: 'final', regulationHomeGoals: 1, regulationAwayGoals: 0 }).is_final === true);
ok('8. cancelled → void', r({ cancelled: true }).result_outcome === 'void' && r({ cancelled: true }).settlement_status === 'cancelled');
ok('11. postponed → no liquida', r({ postponed: true }).settlement_status === 'postponed' && r({ postponed: true }).is_final === false);
ok('12. abandoned → unresolved', r({ abandoned: true }).settlement_status === 'unresolved');
ok('13. sin marcador → unresolved (no se infiere)', r({ providerStatus: 'final' }).settlement_status === 'unresolved');
ok('policy version settlement', provider.SETTLEMENT_POLICY_VERSION === 'settlement-policy-1' && provider.PROVIDER === 'espn_scoreboard');

console.log('\n§15 COMMITMENT ELIGIBILITY + MERKLE');
const CE = (over) => elig.commitmentEligible(baseSig(over), { verifiedEpoch: EPOCH });
ok('1. señal oficial elegible', CE().eligible);
ok('2. pre-epoch excluida del commitment', !CE({ published_at: '2026-06-20T10:00:00Z' }).eligible);
ok('3. internal/V2 excluidas del commitment', !CE({ experimental: true }).eligible && !CE({ scope: 'internal_validation' }).eligible);
ok('not_score_eligible excluida', !CE({ score_eligible: false }).eligible);
ok('4/8. merkle determinístico + reproducible', hashing.merkleRoot(['a', 'b', 'c']) === hashing.merkleRoot(['a', 'b', 'c']));
ok('merkle cambia si cambia una hoja', hashing.merkleRoot(['a', 'b', 'c']) !== hashing.merkleRoot(['a', 'b', 'x']));

console.log('\n§13 DOWNSTREAM (admin states)');
ok('4. quarantine bloquea downstream público', sm.downstreamPolicy('QUARANTINED').public === false);
ok('retracted conserva (visible) sin alerts', sm.downstreamPolicy('RETRACTED').public === true && sm.downstreamPolicy('RETRACTED').alerts === false);
ok('void: settlement administrativo', sm.downstreamPolicy('ADMINISTRATIVE_VOID').settlement === 'administrative');

console.log(`\n=== RESULTADO ===\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
