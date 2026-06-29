// tests/live-context.test.js — Grupo 3 (jun-29). Verifica el contexto en vivo reactivo: una tarjeta roja
// ajusta la probabilidad en vivo penalizando al equipo sancionado. Correr: node --test tests/live-context.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { liveMatchProbs, liveEventAdjustments, liveProbsFromLambdas } = require('../engine');

test('liveProbsFromLambdas: marcador en contra mueve la prob hacia quien gana + normaliza', () => {
  const even = liveProbsFromLambdas(1.5, 1.1, 0, 0, 30);
  const losing = liveProbsFromLambdas(1.5, 1.1, 0, 1, 30); // local 0-1
  assert.ok(losing.home < even.home, 'ir perdiendo baja la prob del local');
  assert.ok(losing.away > even.away, 'ir ganando sube la prob del visitante');
  const s = losing.home + losing.draw + losing.away;
  assert.ok(Math.abs(s - 1) < 1e-6, 'normalizada');
});
test('liveProbsFromLambdas: mulH/mulA (roja) reducen la expectativa del sancionado', () => {
  const base = liveProbsFromLambdas(1.6, 1.2, 0, 0, 40);
  const redHome = liveProbsFromLambdas(1.6, 1.2, 0, 0, 40, { mulH: 0.7, mulA: 1.12 });
  assert.ok(redHome.home < base.home && redHome.away > base.away);
});

test('liveEventAdjustments: cuenta rojas por lado y penaliza con Elo negativo', () => {
  const a = liveEventAdjustments([{ type: 'red', side: 'home' }, { type: 'yellow', side: 'away' }, { type: 'goal', side: 'home' }]);
  assert.equal(a.homeReds, 1);
  assert.equal(a.awayReds, 0);
  assert.ok(a.homeElo < 0, 'la roja del local penaliza al local');
  assert.equal(a.awayElo, 0);
});

test('liveEventAdjustments: sin rojas → sin ajuste', () => {
  const a = liveEventAdjustments([{ type: 'goal', side: 'home' }, { type: 'yellow', side: 'home' }]);
  assert.equal(a.homeElo, 0);
  assert.equal(a.awayElo, 0);
});

test('liveMatchProbs: roja del local baja su prob de ganar y sube la del visitante', () => {
  const base = liveMatchProbs(1800, 1700, 0, 0, 30);
  const adj = liveEventAdjustments([{ type: 'red', side: 'home' }]);
  const after = liveMatchProbs(1800, 1700, 0, 0, 30, { eloAdjH: adj.homeElo, eloAdjA: adj.awayElo });
  assert.ok(after.home < base.home, 'baja prob del local');
  assert.ok(after.away > base.away, 'sube prob del visitante');
  const s = after.home + after.draw + after.away;
  assert.ok(Math.abs(s - 1) < 1e-6, 'normalizada');
});

test('liveMatchProbs: backward-compatible sin opts', () => {
  const a = liveMatchProbs(1800, 1700, 1, 0, 60);
  const b = liveMatchProbs(1800, 1700, 1, 0, 60, {});
  assert.deepEqual(a, b);
  assert.equal(a.live, true);
});

test('liveMatchProbs: el efecto de la roja es menor cuanto menos tiempo queda', () => {
  const adj = liveEventAdjustments([{ type: 'red', side: 'home' }]);
  const early = liveMatchProbs(1750, 1750, 0, 0, 10, { eloAdjH: adj.homeElo });
  const late = liveMatchProbs(1750, 1750, 0, 0, 85, { eloAdjH: adj.homeElo });
  const baseEarly = liveMatchProbs(1750, 1750, 0, 0, 10);
  const baseLate = liveMatchProbs(1750, 1750, 0, 0, 85);
  const dropEarly = baseEarly.home - early.home;
  const dropLate = baseLate.home - late.home;
  assert.ok(dropEarly > dropLate, 'la roja temprana mueve más la prob que la tardía');
});
