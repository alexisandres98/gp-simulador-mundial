// tests/arb-temporal-capacity.test.js — Fase R.2 §7/§9/§11. Contemporaneidad temporal de legs + honestidad de
// capacidad. Una combinación de precios que nunca coexistió NO es activa; una cuota visible NO acepta cualquier
// tamaño. Tests PUROS.
'use strict';
const path = require('path');
const T = require(path.join(__dirname, '..', 'arb-engine', 'temporalSync'));
const C = require(path.join(__dirname, '..', 'arb-engine', 'capacity'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const NOW = Date.parse('2026-06-27T22:00:00Z');
const at = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
const tleg = (o = {}) => Object.assign({ snapshotReceivedAt: at(5), isLive: false, marketStatus: 'open' }, o);
const params = { maxLegTimeSkewMs: 3000, maxSnapshotAgePrematchMs: 120000, maxSnapshotAgeLiveMs: 15000 };

console.log('\n== §9 contemporaneidad temporal ==');
let r = T.evaluate([tleg({ snapshotReceivedAt: at(5) }), tleg({ snapshotReceivedAt: at(5) })], { now: NOW, params });
ok('legs frescas, spread 0 → ok', r.ok, JSON.stringify(r.reasons));
ok('evidencia: oldest/newest/spread/max_age presentes', r.evidence.oldest_leg_at && r.evidence.newest_leg_at && r.evidence.cross_leg_time_spread_ms === 0 && r.evidence.max_leg_age_ms >= 5000);

let stale = T.evaluate([tleg({ snapshotReceivedAt: at(5) }), tleg({ snapshotReceivedAt: at(200) })], { now: NOW, params });
ok('una leg vieja (200s prematch) → LEG_STALE', !stale.ok && stale.reasons.includes('LEG_STALE'), JSON.stringify(stale.reasons));

let dstale = T.evaluate([tleg({ snapshotReceivedAt: at(5) }), tleg({ snapshotReceivedAt: at(200), priceSource: 'derived_from_complement_bid' })], { now: NOW, params });
ok('leg DERIVADA vieja → DERIVED_LEG_STALE (anti Kalshi YES-ask viejo)', dstale.reasons.includes('DERIVED_LEG_STALE'), JSON.stringify(dstale.reasons));

let spread = T.evaluate([tleg({ snapshotReceivedAt: at(5) }), tleg({ snapshotReceivedAt: at(10) })], { now: NOW, params });
ok('spread 5s > 3s límite → CROSS_LEG_SPREAD_EXCEEDED (nunca coexistieron)', !spread.ok && spread.reasons.includes('CROSS_LEG_SPREAD_EXCEEDED'), JSON.stringify(spread.reasons));
ok('spread evidencia = 5000ms', spread.evidence.cross_leg_time_spread_ms === 5000);

let susp = T.evaluate([tleg(), tleg({ suspended: true })], { now: NOW, params });
ok('leg suspendida → LEG_SUSPENDED', !susp.ok && susp.reasons.includes('LEG_SUSPENDED'));
let closed = T.evaluate([tleg(), tleg({ marketStatus: 'closed' })], { now: NOW, params });
ok('market no abierto → LEG_SUSPENDED', closed.reasons.includes('LEG_SUSPENDED'));

let started = T.evaluate([tleg(), tleg({ eventStarted: true })], { now: NOW, params });
ok('evento iniciado → EVENT_STARTED (no es arb prematch)', !started.ok && started.reasons.includes('EVENT_STARTED'));
let startedAt = T.evaluate([tleg({ eventStartAt: at(60) }), tleg({ eventStartAt: at(60) })], { now: NOW, params });
ok('eventStartAt en el pasado → EVENT_STARTED', startedAt.reasons.includes('EVENT_STARTED'));

let miss = T.evaluate([tleg(), tleg({ snapshotReceivedAt: null })], { now: NOW, params });
ok('timestamp faltante → MISSING_TIMESTAMP', !miss.ok && miss.reasons.includes('MISSING_TIMESTAMP'));
let fut = T.evaluate([tleg(), tleg({ snapshotReceivedAt: new Date(NOW + 120000).toISOString() })], { now: NOW, params });
ok('snapshot futuro (reloj desincronizado) → FUTURE_SNAPSHOT', fut.reasons.includes('FUTURE_SNAPSHOT'));
ok('policy versionada', r.policy_version === 'arbitrage-temporal-1');

console.log('\n== §7/§11 honestidad de capacidad ==');
const cleg = (o = {}) => Object.assign({ provider: 'p', side: 'yes', asks: [{ price: '0.5', size: '100' }, { price: '0.51', size: '50' }] }, o);
let confirmed = C.assess([cleg(), cleg({ provider: 'q' })]);
ok('todas con profundidad → CONFIRMED', confirmed.capacity_status === 'CONFIRMED', JSON.stringify(confirmed));
ok('tamaño confirmado = leg más débil (150)', confirmed.confirmed_executable_size === 150);

let maxstake = C.assess([cleg(), { provider: 'sb', side: 'home', asks: [], maxStake: 200 }]);
ok('leg con max_stake conocido → CONFIRMED via max_stake', maxstake.capacity_status === 'CONFIRMED' && maxstake.per_leg[1].source === 'max_stake');

let unknown = C.assess([cleg(), { provider: 'sb', side: 'home', asks: [], stake_limit_status: 'unknown' }]);
ok('una leg sin profundidad y max_stake unknown → CONSERVATIVE', unknown.capacity_status === 'CONSERVATIVE', JSON.stringify(unknown.notes));
ok('nota: capacidad UNKNOWN NO inventada', unknown.notes.includes('UNKNOWN_CAPACITY_NOT_INVENTED'));
ok('leg limitante = la UNKNOWN (size 0)', unknown.limiting_leg_index === 1 && unknown.confirmed_executable_size === 0);

let allUnknown = C.assess([{ provider: 'a', asks: [], stake_limit_status: 'unknown' }, { provider: 'b', asks: [], stake_limit_status: 'unknown' }]);
ok('todas UNKNOWN → capacity_status UNKNOWN', allUnknown.capacity_status === 'UNKNOWN' && allUnknown.notes.includes('NO_LEG_CAPACITY_CONFIRMED'));

console.log(`\n${fail === 0 ? '✅' : '❌'} arb-temporal-capacity: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
