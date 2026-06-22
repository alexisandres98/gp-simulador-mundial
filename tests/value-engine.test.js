// tests/value-engine.test.js — Sprint 7. Capa PURA: odds §58, completeness §59, no-vig §60, consenso §61,
// ensemble §63, value §64, clasificación + golden §69. Sin DB.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const odds = require(R + '/value-engine/oddsNormalization');
const noVig = require(R + '/value-engine/noVig');
const consensus = require(R + '/value-engine/consensus');
const ensemble = require(R + '/value-engine/ensemble');
const cls = require(R + '/value-engine/classification');
const { evaluateMarket } = require(R + '/value-engine/evaluate');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const near = (a, b, t = 1e-4) => Math.abs(a - b) <= t;

// helper: construye un mercado 1X2 con N books (grupos indep), GP, PM y mejor cuota.
function market(over = {}) {
  const q = (h, d, a) => ({ home: { odds: h }, draw: { odds: d }, away: { odds: a } });
  const books = over.books || [
    { sportsbook: 'A', independence_group: 'g1', quotes: q(1.95, 3.8, 6.0), fresh: true },
    { sportsbook: 'B', independence_group: 'g2', quotes: q(1.97, 3.7, 5.8), fresh: true },
    { sportsbook: 'C', independence_group: 'g3', quotes: q(1.93, 3.9, 6.1), fresh: true },
    { sportsbook: 'D', independence_group: 'g4', quotes: q(1.96, 3.75, 5.9), fresh: true },
  ];
  return {
    canonicalEventId: 'e1', canonicalMarketId: 'm1',
    gp: { probabilities: over.gp || { home: 0.60, draw: 0.25, away: 0.15 }, model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0', sampleStatus: over.sampleStatus || 'developing', calibrationStatus: 'identity', data_quality: 0.7 },
    predictionMarket: over.pm === null ? null : { probabilities: over.pm || { home: 0.58, draw: 0.26, away: 0.16 }, lowLiquidity: over.lowLiquidity || false, derived: false },
    sportsbooks: books,
    bestPrices: over.bestPrices || { home: { decimalOdds: 2.0 }, draw: { decimalOdds: 4.0 }, away: { decimalOdds: 6.5 } },
    mappingMatched: over.mappingMatched !== false, outcomeMatched: over.outcomeMatched !== false, hardConflicts: over.hardConflicts || 0,
    rulesOk: over.rulesOk !== false, freshnessOk: over.freshnessOk !== false, eventStarted: over.eventStarted || false,
    mappingVersion: 'v1', rulesVersion: 'rule-fp-2', priceStable: true, snapshotIds: ['s1', 's2'],
  };
}
const home = m => evaluateMarket(m).outcomes.home;

console.log('\n§58 ODDS');
ok('1. decimal válido', near(odds.normalizeQuote({ odds: '2.0' }).raw_implied_probability, 0.5));
ok('2/3. American +/-', odds.toDecimal('+150', 'american') === 2.5 && odds.toDecimal('-200', 'american') === 1.5);
ok('4. fractional 5/2', near(odds.toDecimal('5/2', 'fractional'), 3.5));
ok('5. probability', near(odds.toDecimal('0.25', 'probability'), 4));
ok('6. odds ≤1 rechazadas', odds.normalizeQuote({ odds: '0.9' }).valid === false);
ok('7. NaN rechazado', odds.normalizeQuote({ odds: 'abc' }).valid === false);
ok('9. quote stale/closed', odds.normalizeQuote({ odds: '2.0', quoteStatus: 'closed' }).valid === false);

console.log('\n§60 NO-VIG');
{
  const nv = noVig.proportional([0.5, 0.3, 0.27]);
  ok('1. proportional', near(nv.probabilities[0], 0.5 / 1.07));
  ok('2. overround', near(nv.overround, 0.07));
  ok('3. suma=1', near(nv.probabilities.reduce((a, b) => a + b, 0), 1));
  const pw = noVig.power([0.5, 0.3, 0.27]);
  ok('4/5. power converge, suma=1', pw.status === 'ok' && near(pw.probabilities.reduce((a, b) => a + b, 0), 1));
  ok('7. versiones', nv.method === 'no-vig-proportional-1' && pw.method === 'no-vig-power-1');
  ok('9. incompleto (2 outcomes) → inválido para no-vig 1X2... (proporcional acepta ≥2; el motor exige 3)', noVig.proportional([0.5]).status === 'invalid');
}

console.log('\n§61 CONSENSO');
{
  const c = consensus.compute([
    { sportsbook: 'A', independence_group: 'g1', probabilities: { home: 0.55, draw: 0.27, away: 0.18 }, complete: true, fresh: true },
    { sportsbook: 'B', independence_group: 'g2', probabilities: { home: 0.56, draw: 0.26, away: 0.18 }, complete: true, fresh: true },
    { sportsbook: 'C', independence_group: 'g3', probabilities: { home: 0.80, draw: 0.12, away: 0.08 }, complete: true, fresh: true }, // outlier
    { sportsbook: 'A2', independence_group: 'g1', probabilities: { home: 0.55, draw: 0.27, away: 0.18 }, complete: true, fresh: true }, // skin de g1
  ]);
  ok('2. outlier no domina (mediana)', c.median_probability.home < 0.62);
  ok('4/5. dos skins g1 no cuentan doble (4 books / 3 grupos)', c.source_count === 4 && c.independence_groups === 3);
  ok('3. stale excluido', consensus.compute([{ sportsbook: 'X', probabilities: { home: 0.5, draw: 0.3, away: 0.2 }, complete: true, fresh: false }]).status === 'unavailable');
  ok('7. una sola fuente → no se llama consenso (source_count=1, independence=1)', consensus.compute([{ sportsbook: 'X', independence_group: 'g1', probabilities: { home: 0.5, draw: 0.3, away: 0.2 }, complete: true, fresh: true }]).independence_groups === 1);
  ok('8. exclusiones auditadas', c.exclusions !== undefined);
}

console.log('\n§63 ENSEMBLE');
{
  const e = ensemble.compute({ sportsbook_consensus: { home: 0.55, draw: 0.27, away: 0.18 }, gp: { probabilities: { home: 0.62, draw: 0.24, away: 0.14 }, sampleStatus: 'developing' }, prediction_markets: { home: 0.58, draw: 0.26, away: 0.16 } });
  ok('1. weights suman 1', near(e.weights_used.reduce((a, w) => a + w.weight, 0), 1));
  ok('5. logit pooling produce prob', e.ensemble_probability.home > 0.55 && e.ensemble_probability.home < 0.62);
  ok('2. fuente ausente reponderada', ensemble.compute({ sportsbook_consensus: { home: 0.55, draw: 0.27, away: 0.18 } }).weights_used[0].weight === 1);
  ok('3. GP sample insuficiente limita peso', ensemble.compute({ sportsbook_consensus: { home: 0.55, draw: 0.27, away: 0.18 }, gp: { probabilities: { home: 0.9, draw: 0.05, away: 0.05 }, sampleStatus: 'insufficient' } }).weights_used.find(w => w.source === 'gp').weight < 0.2);
  ok('4. V2 nunca en ensemble oficial', /peso oficial 0/.test(e.note));
  ok('9. reproducible', JSON.stringify(e.ensemble_probability) === JSON.stringify(ensemble.compute({ sportsbook_consensus: { home: 0.55, draw: 0.27, away: 0.18 }, gp: { probabilities: { home: 0.62, draw: 0.24, away: 0.14 }, sampleStatus: 'developing' }, prediction_markets: { home: 0.58, draw: 0.26, away: 0.16 } }).ensemble_probability));
}

console.log('\n§64 VALUE + CLASIFICACIÓN + §69 GOLDEN');
{
  // STRONG: edge alto, consenso completo, baja incertidumbre, calidad alta, precio cumple mínimo
  const strong = home(market({ gp: { home: 0.63, draw: 0.23, away: 0.14 }, pm: { home: 0.61, draw: 0.25, away: 0.14 }, bestPrices: { home: { decimalOdds: 1.95 } }, sampleStatus: 'established' }));
  ok('STRONG: edge>0, EV>0', strong.adjusted_edge_pp > 0 && strong.adjusted_ev > 0);
  ok('14. STRONG correcto', strong.classification === 'strong', JSON.stringify(strong.strong_blockers));
  // PASS: sin edge (cuota baja)
  const passC = home(market({ gp: { home: 0.55, draw: 0.27, away: 0.18 }, pm: { home: 0.55, draw: 0.27, away: 0.18 }, bestPrices: { home: { decimalOdds: 1.5 } } }));
  ok('11/19. cuota baja → PASS (quality alta + edge≤0)', passC.classification === 'pass');
  // WATCH: edge pequeño
  const watch = home(market({ gp: { home: 0.60, draw: 0.255, away: 0.145 }, pm: { home: 0.59, draw: 0.26, away: 0.15 }, bestPrices: { home: { decimalOdds: 1.85 } } }));
  ok('12/13. edge pequeño → WATCH/LEAN (no STRONG)', ['watch', 'lean'].includes(watch.classification), watch.classification);
  // 15. hard conflict NUNCA STRONG
  const hc = home(market({ gp: { home: 0.63, draw: 0.23, away: 0.14 }, bestPrices: { home: { decimalOdds: 1.95 } }, hardConflicts: 1 }));
  ok('15. hard conflict nunca STRONG (→PASS)', hc.classification === 'pass');
  // 16. stale nunca STRONG
  const stale = home(market({ gp: { home: 0.63, draw: 0.23, away: 0.14 }, bestPrices: { home: { decimalOdds: 1.95 } }, freshnessOk: false }));
  ok('16. stale nunca STRONG', stale.classification !== 'strong');
  // 17. insufficient sources nunca STRONG
  const fewSrc = home(market({ gp: { home: 0.63, draw: 0.23, away: 0.14 }, bestPrices: { home: { decimalOdds: 1.95 } }, books: [{ sportsbook: 'A', independence_group: 'g1', quotes: { home: { odds: 1.95 }, draw: { odds: 3.8 }, away: { odds: 6 } }, fresh: true }] }));
  ok('17. pocas fuentes (1) nunca STRONG', fewSrc.classification !== 'strong' && fewSrc.strong_blockers.includes('insufficient_sources'));
  // 18. precio debajo del mínimo
  const lowPrice = home(market({ gp: { home: 0.63, draw: 0.23, away: 0.14 }, bestPrices: { home: { decimalOdds: 1.55 } } }));
  ok('18. precio bajo el mínimo → no STRONG', lowPrice.classification !== 'strong');
  // 20. idempotencia (mismo input → mismo input_hash)
  const m = market({ gp: { home: 0.63, draw: 0.23, away: 0.14 } });
  ok('20. idempotencia (input_hash estable)', home(m).input_hash === home(m).input_hash);
  // §69 condición: 0 falsas STRONG → todas las STRONG deben pasar strongEligible
  ok('GOLDEN: STRONG implica strong_blockers vacío', strong.strong_blockers.length === 0);
}

console.log('\n§59 COMPLETENESS');
{
  // falta draw → book incompleto → no aporta al consenso
  const m = market({ books: [{ sportsbook: 'A', independence_group: 'g1', quotes: { home: { odds: 1.95 }, away: { odds: 6 } }, fresh: true }, { sportsbook: 'B', independence_group: 'g2', quotes: { home: { odds: 1.97 }, draw: { odds: 3.7 }, away: { odds: 5.8 } }, fresh: true }] });
  const ev = evaluateMarket(m);
  ok('2. falta draw → book excluido del consenso', ev.consensus.source_count === 1);
  // 7. mercado live rechazado
  const live = evaluateMarket(market({ books: [{ sportsbook: 'A', independence_group: 'g1', quotes: { home: { odds: 1.95 }, draw: { odds: 3.8 }, away: { odds: 6 } }, is_live: true, fresh: true }, { sportsbook: 'B', independence_group: 'g2', quotes: { home: { odds: 1.97 }, draw: { odds: 3.7 }, away: { odds: 5.8 } }, fresh: true }] }));
  ok('7. mercado live excluido', live.consensus.source_count === 1);
}

console.log(`\n=== RESULTADO ===\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
