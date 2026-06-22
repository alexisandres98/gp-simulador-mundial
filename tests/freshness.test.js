// tests/freshness.test.js — Sprint 8A §21,§22. Contrato de frescura + degradación segura (PUROS).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const fresh = require(R + '/freshness');
const degr = require(R + '/freshness/degradation');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const now = Date.now();
// freshness
ok('freshness: timestamp null → unknown', fresh.evaluate(null, 'sportsbook_quote', now).status === 'unknown');
ok('freshness: reciente → fresh', fresh.evaluate(new Date(now - 30 * 1000).toISOString(), 'sportsbook_quote', now).status === 'fresh');
ok('freshness: intermedio → aging', fresh.evaluate(new Date(now - 5 * 60 * 1000).toISOString(), 'sportsbook_quote', now).status === 'aging');
ok('freshness: viejo → stale', fresh.evaluate(new Date(now - 30 * 60 * 1000).toISOString(), 'sportsbook_quote', now).status === 'stale');
ok('freshness: tipo desconocido → unknown', fresh.classify(1000, 'inexistente') === 'unknown');
ok('freshness: isUsable fresh/aging sí, stale no', fresh.isUsable('fresh') && fresh.isUsable('aging') && !fresh.isUsable('stale') && !fresh.isUsable('unknown'));
ok('freshness: contrato versionado', fresh.CONTRACT_VERSION === 'freshness-1' && fresh.evaluate(null, 'pick_gp').contract_version === 'freshness-1');

// degradación
const allFresh = degr.decide({ sportsbooks: 'fresh', predictionMarkets: 'fresh', signalRegistry: 'fresh', closing: 'fresh' });
ok('degradación: todo fresco → value ok, picks ok, simulador disponible', allFresh.valueEngine === 'ok' && allFresh.picksGp === 'ok' && allFresh.simulator === 'available');
const noSb = degr.decide({ sportsbooks: 'down', predictionMarkets: 'fresh', signalRegistry: 'fresh', closing: 'fresh' });
ok('degradación: sportsbooks down → value blocked + no new picks', noSb.valueEngine === 'blocked' && noSb.picksGp === 'no_new_picks');
ok('degradación: simulador SIEMPRE disponible aunque caiga todo', degr.decide({ sportsbooks: 'down', predictionMarkets: 'down', signalRegistry: 'down', closing: 'down' }).simulator === 'available');
const kalshiDown = degr.decide({ sportsbooks: 'fresh', predictionMarkets: 'stale', signalRegistry: 'fresh', closing: 'fresh' });
ok('degradación: PM degradado → arb degraded + aviso incertidumbre', kalshiDown.arb === 'degraded' && kalshiDown.warnings.includes('prediction_markets_degraded_uncertainty_up'));
ok('degradación: closing caído → aviso CLV pendiente', degr.decide({ sportsbooks: 'fresh', predictionMarkets: 'fresh', signalRegistry: 'fresh', closing: 'down' }).warnings.includes('closing_unavailable_clv_pending'));
ok('degradación: NUNCA sube de grado por degradación (STRONG→lean)', degr.neverUpgradeOnDegradation('strong', true) === 'lean' && degr.neverUpgradeOnDegradation('strong', false) === 'strong');

console.log(`\nfreshness: ${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
