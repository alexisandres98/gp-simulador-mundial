// tests/player-intel.test.js — capa de inteligencia por jugador: fusión + razones explicables.
'use strict';
const { playerIntel } = require('../player-intel/engine');
const { fitPlayers } = require('../prop-engine/players');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const hist = require('../data/player-props-history.json');
const F = fitPlayers(hist.matches);
const byName = re => Object.values(F.players).find(p => re.test(p.name));

const mbappe = byName(/Mbapp/);
const doue = byName(/Désiré Doué/);

console.log('== estrella titular ==');
const A = playerIntel(F, mbappe.pid, { teamLambda: 2.0, projectedStarter: true, confirmedStarter: null, availability: null });
t('proyección presente y anytime alto', A && A.projection.anytime_goal > 0.4);
t('rol STARTER_PROJECTED', A.role === 'STARTER_PROJECTED' && A.reasons.includes('ROLE_STARTER_PROJECTED'));
t('muestra sólida + producción élite', A.reasons.includes('SAMPLE_STRONG') && A.reasons.includes('RATES_ELITE'));
t('λ alto → TEAM_ATTACK_UP', A.reasons.includes('TEAM_ATTACK_UP'));
t('confianza MEDIUM/HIGH', A.confidence === 'HIGH' || A.confidence === 'MEDIUM');

console.log('== suplente muestra chica (caso Doué) ==');
const B = playerIntel(F, doue.pid, { teamLambda: 2.0, projectedStarter: false, availability: null });
t('rol suplente', B.role === 'BENCH_PROJECTED' && B.reasons.includes('ROLE_BENCH'));
t('minutos de suplente (30), no 88', B.projection.minutes === 30);
t('confianza LOW', B.confidence === 'LOW');

console.log('== alineación confirmada pisa la proyección ==');
const C = playerIntel(F, doue.pid, { teamLambda: 2.0, projectedStarter: false, confirmedStarter: true, availability: null });
t('confirmado titular → STARTER_CONFIRMED y minutos completos', C.role === 'STARTER_CONFIRMED' && C.projection.minutes > 80);

console.log('== disponibilidad ==');
const D = playerIntel(F, mbappe.pid, { projectedStarter: true, availability: { status: 'OUT', prob_miss: 0.8, corroborated: true } });
t('OUT corroborado → AVAIL_OUT y confianza LOW', D.reasons.includes('AVAIL_OUT') && D.confidence === 'LOW');
const E = playerIntel(F, mbappe.pid, { projectedStarter: true, availability: { status: 'OUT', prob_miss: 0.45, corroborated: false } });
t('OUT sin corroborar → AVAIL_UNVERIFIED (no AVAIL_OUT)', E.reasons.includes('AVAIL_UNVERIFIED') && !E.reasons.includes('AVAIL_OUT'));
const G = playerIntel(F, mbappe.pid, { projectedStarter: true, availability: { status: 'DOUBT', prob_miss: 0.4, corroborated: true } });
t('DOUBT → AVAIL_DOUBT', G.reasons.includes('AVAIL_DOUBT'));

console.log('== pid inexistente ==');
t('pid desconocido → null', playerIntel(F, 'pl_nope', {}) === null);

console.log(`\n[player-intel] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
