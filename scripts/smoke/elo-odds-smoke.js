#!/usr/bin/env node
'use strict';
// Smoke del rating alimentado con cuotas (clubs-engine/eloOdds.js): la actualización con cuotas converge hacia
// la esperanza implícita del cierre, la de resultado replica applyClubElo, la regresión de temporada y el
// parseo de env. Sin red, sin server, sin db. Uso: node scripts/smoke/elo-odds-smoke.js
const assert = require('assert');
const EO = require('../../clubs-engine/eloOdds');

let pasos = 0;
const ok = (msg) => { pasos++; console.log('  ok ', msg); };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

// ── 1. esperanza del mercado y su inversa ───────────────────────────────────────────────────────────────
{
  const fair = { home: 0.55, draw: 0.25, away: 0.20 };
  close(EO.marketExpectancy(fair), 0.675, 1e-9, 'p_local + ½·p_empate');
  assert.strictEqual(EO.marketExpectancy(null), null);
  assert.strictEqual(EO.marketExpectancy({ home: 0.9, draw: 0.9, away: 0.9 }), null, 'no suma 1 → null');
  const d = EO.ratingDiffFromExpectancy(0.675);
  close(EO.winExpectancy(1500 + d, 1500, 0), 0.675, 1e-9, 'ratingDiffFromExpectancy invierte la logística');
  close(EO.winExpectancy(1500, 1500, 60), 1 / (1 + Math.pow(10, -60 / 400)), 1e-12, 'localía suma al local');
  ok('esperanza implícita 0,675 ↔ diferencia de Elo (inversa exacta); distribuciones inválidas → null');
}

// ── 2. actualización con RESULTADO = applyClubElo (K=30, factor G, localía) ────────────────────────────
{
  const eH = 1550, eA = 1480, hfa = 50;
  const we = 1 / (1 + Math.pow(10, -((eH + hfa) - eA) / 400));
  close(EO.resultDelta(eH, eA, hfa, 1, 0), 30 * 1 * (1 - we), 1e-12, 'victoria por 1');
  close(EO.resultDelta(eH, eA, hfa, 3, 1), 30 * 1.5 * (1 - we), 1e-12, 'victoria por 2 → G=1,5');
  close(EO.resultDelta(eH, eA, hfa, 4, 0), 30 * ((11 + 4) / 8) * (1 - we), 1e-12, 'victoria por 4 → G=(11+4)/8');
  close(EO.resultDelta(eH, eA, hfa, 1, 1), 30 * (0.5 - we), 1e-12, 'empate → W=0,5');
  close(EO.resultDelta(eH, eA, hfa, 0, 2), 30 * 1.5 * (0 - we), 1e-12, 'derrota por 2');
  assert.strictEqual(EO.marginFactor(0, 0), 1); assert.strictEqual(EO.marginFactor(2, 0), 1.5); assert.strictEqual(EO.marginFactor(5, 0), 2);
  ok('resultDelta replica la fórmula de applyClubElo en 5 casos (K=30, G por margen, W del resultado)');
}

// ── 3. serie sintética: el Elo de cuotas converge hacia la implícita ──────────────────────────────────
{
  const fair = { home: 0.62, draw: 0.22, away: 0.16 }; // el mercado cotiza SIEMPRE lo mismo para este cruce
  const target = EO.marketExpectancy(fair);
  const hfa = 45;
  for (const K of [60, 250]) {
    let eH = 1500, eA = 1500, prevGap = Infinity, steps = 0;
    for (let i = 0; i < 60; i++) {
      const d = EO.oddsDelta(eH, eA, hfa, fair, K);
      eH += d; eA -= d; steps++;
      const gap = Math.abs(EO.winExpectancy(eH, eA, hfa) - target);
      assert.ok(gap <= prevGap + 1e-12, `K=${K}: la brecha no crece (paso ${i}: ${gap} > ${prevGap})`);
      prevGap = gap;
      if (gap < 1e-4) break;
    }
    close(EO.winExpectancy(eH, eA, hfa), target, 1e-3, `K=${K}: converge a la implícita`);
    assert.ok(K === 60 ? steps <= 60 : steps <= 12, `K=${K}: ${steps} pasos`); // K=250 cierra ~72 % de la brecha por partido
    ok(`K=${K}: esperanza del Elo → ${target.toFixed(4)} en ${steps} pasos, brecha monótona (sin sobrepasar)`);
  }
  // mercado que cambia: el rating lo sigue (subida de p_local ⇒ sube el local)
  let eH = 1500, eA = 1500;
  for (let i = 0; i < 10; i++) { const d = EO.oddsDelta(eH, eA, hfa, fair, 250); eH += d; eA -= d; }
  const before = eH;
  const d2 = EO.oddsDelta(eH, eA, hfa, { home: 0.75, draw: 0.17, away: 0.08 }, 250);
  assert.ok(d2 > 0 && before + d2 > before, 'el mercado sube al local → el rating sube');
  const d3 = EO.oddsDelta(eH, eA, hfa, { home: 0.30, draw: 0.30, away: 0.40 }, 250);
  assert.ok(d3 < 0, 'el mercado baja al local → el rating baja');
  ok('la dirección del Δ sigue al mercado; sin resultado de por medio');
}

// ── 4. combinedDelta: modos y reserva sin cierre ───────────────────────────────────────────────────────
{
  const args = { eH: 1520, eA: 1500, hfa: 50, hg: 2, ag: 0, fair: { home: 0.5, draw: 0.28, away: 0.22 }, kOdds: 100, kResult: 30 };
  const dO = EO.oddsDelta(1520, 1500, 50, args.fair, 100), dR = EO.resultDelta(1520, 1500, 50, 2, 0, 30);
  const o = EO.combinedDelta({ ...args, mode: 'odds' }); close(o.delta, dO, 1e-12, 'odds'); assert.strictEqual(o.used, 'odds');
  const r = EO.combinedDelta({ ...args, mode: 'results' }); close(r.delta, dR, 1e-12, 'results'); assert.strictEqual(r.used, 'results');
  const h = EO.combinedDelta({ ...args, mode: 'hybrid', w: 0.75 }); close(h.delta, 0.75 * dO + 0.25 * dR, 1e-12, 'hybrid'); assert.strictEqual(h.used, 'hybrid');
  const nf = EO.combinedDelta({ ...args, fair: null, mode: 'odds' }); close(nf.delta, dR, 1e-12, 'sin cierre → resultado'); assert.strictEqual(nf.used, 'results');
  const nn = EO.combinedDelta({ ...args, fair: null, hg: NaN, ag: NaN, mode: 'odds' }); assert.strictEqual(nn.delta, 0); assert.strictEqual(nn.used, 'none');
  ok('combinedDelta: odds / results / hybrid(w) y reserva al resultado cuando no hay cierre; nada → 0');
}

// ── 5. regresión de temporada ─────────────────────────────────────────────────────────────────────────
{
  const elos = { a: 1700, b: 1400, c: 1500 };
  assert.deepStrictEqual(EO.regressSeason(elos, 0), { a: 1700, b: 1400, c: 1500 }, 'α=0 arrastra tal cual');
  assert.deepStrictEqual(EO.regressSeason(elos, 1), { a: 1500, b: 1500, c: 1500 }, 'α=1 reinicia al prior');
  const r = EO.regressSeason(elos, 0.2);
  close(r.a, 1660, 1e-9, 'α=0,2: 1700 → 1660'); close(r.b, 1420, 1e-9, 'α=0,2: 1400 → 1420'); close(r.c, 1500, 1e-9, 'la media no se mueve');
  assert.strictEqual(elos.a, 1700, 'no muta el mapa de entrada');
  const r2 = EO.regressSeason(elos, 0.5, 1550); close(r2.a, 1625, 1e-9, 'media distinta (1550)');
  ok('regressSeason: α=0 identidad, α=1 reinicio, α=0,2 acerca un 20 % a la media, sin mutar');
}

// ── 6. overlay y parseo de env ────────────────────────────────────────────────────────────────────────
{
  const ov = EO.applyToOverlay({}, 'h', 'a', 1500, 1480, 12.34, 0, 0);
  assert.deepStrictEqual(ov, { h: 1512.3, a: 1467.7 }, 'redondeo a décimas, visitante recibe −Δ');
  const ov2 = EO.applyToOverlay({}, 'h', 'a', 1350, 1500, 10, -150, 0); // el local jugaba con prior de división −150
  assert.deepStrictEqual(ov2, { h: 1510, a: 1490 }, 'el prior de copa se resta al guardar');
  assert.strictEqual(EO.eloSource({}), 'results'); assert.strictEqual(EO.eloSource({ GP_CLUB_ELO_SOURCE: 'odds' }), 'odds');
  assert.strictEqual(EO.eloSource({ GP_CLUB_ELO_SOURCE: 'ODDS ' }), 'odds'); assert.strictEqual(EO.eloSource({ GP_CLUB_ELO_SOURCE: 'x' }), 'results');
  assert.strictEqual(EO.K_ODDS, 250, 'default K_odds = el del backtest'); assert.strictEqual(EO.W_HYBRID, 0.75);
  const p = EO.oddsParams({}); assert.deepStrictEqual(p, { kOdds: 250, w: 0.75, mode: 'odds' });
  const p2 = EO.oddsParams({ GP_CLUB_ELO_ODDS_K: '120', GP_CLUB_ELO_ODDS_W: '0.5', GP_CLUB_ELO_ODDS_MODE: 'hybrid' }); assert.deepStrictEqual(p2, { kOdds: 120, w: 0.5, mode: 'hybrid' });
  const p3 = EO.oddsParams({ GP_CLUB_ELO_ODDS_K: '-5', GP_CLUB_ELO_ODDS_W: '7', GP_CLUB_ELO_ODDS_MODE: 'zzz' }); assert.deepStrictEqual(p3, { kOdds: 250, w: 0.75, mode: 'odds' });
  ok('applyToOverlay (décimas, prior de copa) · GP_CLUB_ELO_SOURCE default results · params: K=250/w=0,75 del backtest, overrides y defaults sanos');
}

console.log(`\nelo-odds-smoke: ${pasos} bloques OK`);
