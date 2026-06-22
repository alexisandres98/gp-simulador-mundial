// tests/alerts.test.js — Sprint 8A §98,§99,§100 (puros). Dedup, quiet hours, elegibilidad, definiciones,
// validación de preferencias y onboarding (lógica pura, sin DB).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const { dedupKey } = require(R + '/alerts/dedup');
const quiet = require(R + '/alerts/quietHours');
const { canAlert } = require(R + '/alerts/eligibility');
const defs = require(R + '/alerts/definitions');
const prefs = require(R + '/user-preferences');

// dedup
const k1 = dedupKey({ userRef: 'u1', type: 'new_pick_gp', entityId: 'pk1', materialStateVersion: 'v1' });
const k2 = dedupKey({ userRef: 'u1', type: 'new_pick_gp', entityId: 'pk1', materialStateVersion: 'v1' });
const k3 = dedupKey({ userRef: 'u1', type: 'new_pick_gp', entityId: 'pk1', materialStateVersion: 'moved' });
ok('dedup: misma observación → misma clave', k1 === k2);
ok('dedup: cambio material → clave distinta', k1 !== k3);

// quiet hours
const tz = 'America/Santo_Domingo'; // UTC-4 (sin DST)
const at2amUTC = new Date('2026-06-22T06:00:00Z'); // 02:00 local
const at2pmUTC = new Date('2026-06-22T18:00:00Z'); // 14:00 local
ok('quiet: hora local correcta por timezone', quiet.localHour(at2amUTC, tz) === 2);
ok('quiet: dentro de quiet nocturno (22→7)', quiet.inQuietHours(at2amUTC, tz, { start: 22, end: 7 }) === true);
ok('quiet: fuera de quiet de día', quiet.inQuietHours(at2pmUTC, tz, { start: 22, end: 7 }) === false);
ok('quiet: in_app siempre se entrega', quiet.channelDecision({ channel: 'in_app', severity: 'info', date: at2amUTC, timezone: tz, quiet: { start: 22, end: 7 } }) === 'deliver');
ok('quiet: email no crítico en quiet → deferred', quiet.channelDecision({ channel: 'email', severity: 'info', date: at2amUTC, timezone: tz, quiet: { start: 22, end: 7 } }) === 'deferred');
ok('quiet: email crítico en quiet → deliver', quiet.channelDecision({ channel: 'email', severity: 'critical', date: at2amUTC, timezone: tz, quiet: { start: 22, end: 7 } }) === 'deliver');
ok('quiet: timezone inválida cae a UTC sin romper', typeof quiet.localHour(at2amUTC, 'Nope/Nope') === 'number');

// elegibilidad
ok('elig: pick no publicada no alerta', canAlert({ type: 'new_pick_gp', published: false, classification: 'strong' }).ok === false);
ok('elig: LEAN no se envía como pick', canAlert({ type: 'new_pick_gp', published: true, classification: 'lean' }).reason === 'pick_requires_strong');
ok('elig: pick STRONG publicada sí', canAlert({ type: 'new_pick_gp', published: true, classification: 'strong' }, { types: ['new_pick_gp'] }).ok === true);
ok('elig: tipo no suscrito se filtra', canAlert({ type: 'new_executable_arb', published: true }, { types: ['new_pick_gp'] }).reason === 'type_not_subscribed');
ok('elig: only_picks filtra arb', canAlert({ type: 'new_executable_arb', published: true }, { signal_filters: { only_picks: true } }).reason === 'only_picks');
ok('elig: min_edge filtra bajo umbral', canAlert({ type: 'new_strong_signal', published: true, edge: 0.01 }, { signal_filters: { min_edge: 0.03 } }).reason === 'below_min_edge');
ok('elig: tipo desconocido rechazado', canAlert({ type: 'inventado', published: true }).reason === 'unknown_type');
ok('defs: severidad de new_pick_gp = important', defs.severityOf('new_pick_gp') === 'important');

// preferencias: validación
ok('prefs: odds format inválido rechazado', prefs.validate({ preferred_odds_format: 'martian' }).ok === false);
ok('prefs: timezone inválida rechazada', prefs.validate({ timezone: 'Nope/Nope' }).ok === false);
ok('prefs: timezone válida aceptada', prefs.validate({ timezone: 'Europe/Madrid' }).ok === true);
ok('prefs: payload enorme rechazado', prefs.validate({ teams: Array(100000).fill('x') }).error === 'payload_too_large');
ok('prefs: arrays se limitan y limpian', (() => { const v = prefs.validate({ teams: ['ARG', 'BRA', 123] }); return v.ok && v.value.teams.length === 2; })());
ok('prefs: language inválido rechazado', prefs.validate({ language: 'xx' }).ok === false);
ok('prefs: defaults conservadores (email/telegram off, in_app on)', prefs.DEFAULTS.alert_preferences.channels.in_app === true && prefs.DEFAULTS.alert_preferences.channels.email === false);

console.log(`\nalerts (puros): ${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
