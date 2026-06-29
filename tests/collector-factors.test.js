// tests/collector-factors.test.js — Grupo 2 (jun-29). Verifica la fusión de observaciones del collector
// (clima + noticias) como factores que ajustan la probabilidad GP, y la derivación FACT/INFERENCE.
// Puro, sin DB. Correr: node --test tests/collector-factors.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cf = require('../context-engine/collectorFactors');
const er = require('../collector/entityResolver');

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sum = (v) => v.home + v.draw + v.away;

test('weatherFactors: deriva factores adversos y respeta el cap total', () => {
  const fx = cf.weatherFactors({ weather_factors: ['HEAVY_RAIN', 'STRONG_WIND', 'HIGH_HUMIDITY', 'EXTREME_HEAT'] });
  assert.ok(fx.length >= 1);
  const total = fx.reduce((s, f) => s + (f.drawPp || 0), 0);
  assert.ok(total <= 0.0301, 'cap de clima ~3pp');
  for (const f of fx) { assert.equal(f.evidence, 'inference'); assert.equal(f.dir, 'draw'); }
});

test('weatherFactors: clima ordinario / vacío → sin factores', () => {
  assert.equal(cf.weatherFactors(null).length, 0);
  assert.equal(cf.weatherFactors({ weather_factors: [] }).length, 0);
  assert.equal(cf.weatherFactors({ weather_factors: ['MILD'] }).length, 0);
});

test('newsFactors: FACT pesa más que INFERENCE; RUMOR y review_required se descartan', () => {
  const claims = [
    { factor_code: 'PLAYER_CONFIRMED_OUT', fact_or_inference: 'FACT', confidence: 0.85, team_id: 'H', review_status: 'auto' },
    { factor_code: 'PLAYER_DOUBTFUL', fact_or_inference: 'INFERENCE', confidence: 0.5, team_id: 'A', review_status: 'auto' },
    { factor_code: 'PLAYER_CONFIRMED_OUT', fact_or_inference: 'RUMOR', confidence: 0, team_id: 'H', review_status: 'auto' },
    { factor_code: 'PLAYER_SUSPENDED', fact_or_inference: 'FACT', confidence: 0.85, team_id: 'A', review_status: 'review_required' },
  ];
  const nf = cf.newsFactors(claims, 'H', 'A');
  const out = nf.filter(f => f.rawCode === 'PLAYER_CONFIRMED_OUT');
  assert.equal(out.length, 1, 'rumor descartado');
  assert.equal(out[0].evidence, 'fact');
  const dbt = nf.find(f => f.rawCode === 'PLAYER_DOUBTFUL');
  assert.equal(dbt.evidence, 'inference');
  assert.ok(Math.abs(out[0].teamPp) > Math.abs(dbt.teamPp), 'FACT out pesa más que INFERENCE doubtful');
  assert.ok(!nf.some(f => f.rawCode === 'PLAYER_SUSPENDED'), 'review_required descartado');
});

test('newsFactors: claim sin team_id resoluble → no se aplica (no se adivina)', () => {
  const claims = [{ factor_code: 'PLAYER_CONFIRMED_OUT', fact_or_inference: 'FACT', confidence: 0.85, team_id: null, review_status: 'auto' }];
  assert.equal(cf.newsFactors(claims, 'H', 'A').length, 0);
});

test('fuse: baja confirmada del local + lluvia → baja la prob del local, sube empate, normaliza a 1', () => {
  const base = { home: 0.52, draw: 0.27, away: 0.21 };
  const fused = cf.fuse(base, {
    weatherRow: { weather_factors: ['HEAVY_RAIN'] },
    claims: [{ factor_code: 'PLAYER_CONFIRMED_OUT', fact_or_inference: 'FACT', confidence: 0.85, team_id: 'H', review_status: 'auto' }],
    homeId: 'H', awayId: 'A',
  });
  assert.ok(approx(sum(fused.adjusted), 1, 1e-6), 'vector normalizado');
  assert.ok(fused.adjusted.home < base.home, 'local baja');
  assert.ok(fused.adjusted.draw > base.draw, 'empate sube');
  assert.ok(fused.confirmedAvailability.has('H'), 'disponibilidad del local CONFIRMADA por fuente');
});

test('fuse: sin observaciones del collector → vector intacto', () => {
  const base = { home: 0.5, draw: 0.3, away: 0.2 };
  const fused = cf.fuse(base, { weatherRow: null, claims: [], homeId: 'H', awayId: 'A' });
  assert.deepEqual(fused.adjusted, base);
  assert.equal(fused.factors.length, 0);
});

test('resolveTeamFocus: atribuye al equipo dominante; ambiguo → null', () => {
  const fx = { home_id: 'BRA', away_id: 'JPN', home_aliases: ['Brazil', 'Brasil'], away_aliases: ['Japan', 'Japón'] };
  assert.equal(er.resolveTeamFocus('Brazil confirm Brazil star Neymar ruled out vs Japan', fx), 'BRA');
  assert.equal(er.resolveTeamFocus('Brazil and Japan preview', fx), null, 'una mención cada uno → ambiguo');
});
