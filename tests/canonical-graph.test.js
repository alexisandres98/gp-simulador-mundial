// tests/canonical-graph.test.js — tests del Canonical Event Graph (Sprint 2, sin DB).
// Ejecutar: node tests/canonical-graph.test.js
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const G = require(R + '/canonical-graph');
const aliases = require(R + '/canonical-graph/participantAliases');
const taxonomy = require(R + '/canonical-graph/taxonomy');
const ruleNormalizer = require(R + '/canonical-graph/ruleNormalizer');
const ruleFp = require(R + '/canonical-graph/ruleFingerprint');
const conflicts = require(R + '/canonical-graph/conflicts');
const { cases } = require(R + '/canonical-graph/fixtures/golden');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

console.log('Canonical Event Graph — tests Sprint 2\n');

// ---- Participant normalization ----
console.log('Participantes / aliases');
{
  ok('USA = United States', aliases.resolve('USA').code === aliases.resolve('United States').code);
  ok('U.S. / USMNT → USA', aliases.resolve('U.S.').code === 'USA' && aliases.resolve('USMNT').code === 'USA');
  ok('South Korea = Korea Republic', aliases.resolve('South Korea').code === aliases.resolve('Korea Republic').code);
  ok('mayúsculas/acentos/puntuación', aliases.resolve('  ESPAÑA!! ').code === aliases.resolve('Spain').code);
  ok('equipo desconocido → null (no fuzzy)', aliases.resolve('Wakanda') === null);
  ok('sin colisiones peligrosas entre selecciones', aliases.collisions().length === 0, JSON.stringify(aliases.collisions()));
  ok('Brazil ≠ Argentina', aliases.resolve('Brazil').code !== aliases.resolve('Argentina').code);
}

// ---- Taxonomía ----
console.log('Taxonomía');
{
  ok('clasifica tournament_winner', taxonomy.classifyMarketFamily('Brazil to win the World Cup') === 'tournament_winner');
  ok('clasifica qualify', taxonomy.classifyMarketFamily('Germany to qualify to the next round', { qualificationMarket: true }) === 'qualify');
  ok('clasifica match_1x2 con draw', taxonomy.classifyMarketFamily('match result 1x2', { drawPossible: true }) === 'match_1x2');
  ok('period unspecified si no hay reglas', taxonomy.classifyPeriod({}) === 'unspecified');
  ok('period extra time', taxonomy.classifyPeriod({ includesExtraTime: true }) === 'full_match_including_extra_time');
}

// ---- Reglas + fingerprint ----
console.log('Reglas / fingerprint');
{
  const r90 = ruleNormalizer.normalize({ description: 'Winner within 90 minutes regulation. Draw possible.' }).normalizedRules;
  const ret = ruleNormalizer.normalize({ description: 'Winner including extra time and penalties.' }).normalizedRules;
  ok('detecta 90m (no extra time)', r90.includesExtraTime === false);
  ok('detecta extra time + penales', ret.includesExtraTime === true && ret.includesPenalties === true);
  ok('fingerprint determinístico estable', ruleFp.fingerprint(r90) === ruleFp.fingerprint(r90));
  ok('fingerprint cambia ante regla material', ruleFp.fingerprint(r90) !== ruleFp.fingerprint(ret));
  const reformat = ruleNormalizer.normalize({ description: '  winner   WITHIN 90 minutes regulation.   draw  possible. ' }).normalizedRules;
  ok('formato/espacios NO cambian fingerprint', ruleFp.fingerprint(r90) === ruleFp.fingerprint(reformat));
}

// ---- Conflicts ----
console.log('Conflicts');
{
  const a = { sport: 'football', scope: 'match', participants: [{ code: 'BRA' }, { code: 'ARG' }], scheduledStart: '2026-06-21T16:00:00Z', competition: 'world_cup', category: 'men_senior' };
  const b = { ...a, participants: [{ code: 'BRA' }, { code: 'CHI' }] };
  ok('participantes incompatibles → hard', conflicts.eventConflicts(a, b).some(c => c.code === 'PARTICIPANTS_INCOMPATIBLE' && c.severity === 'hard'));
  const m1 = { family: 'match_winner', period: 'regulation_90m', normalizedRules: { drawPossible: true } };
  const m2 = { family: 'match_winner', period: 'full_match_including_extra_time', normalizedRules: { drawPossible: false } };
  const mc = conflicts.marketConflicts(m1, m2);
  ok('period mismatch detectado', mc.some(c => c.code === 'PERIOD_MISMATCH'));
  ok('draw mismatch detectado', mc.some(c => c.code === 'DRAW_MISMATCH'));
}

// ---- Golden dataset ----
console.log('\nGolden dataset (40 casos)');
let falsePositives = 0, correct = 0, total = 0;
let tpMatched = 0, goldenMatched = 0, sysMatched = 0;
const byCat = {};
for (const cse of cases) {
  const r = G.matchPair(G.describe(cse.a.market, cse.a.provider), G.describe(cse.b.market, cse.b.provider));
  const actual = { event: r.event.status, market: r.market.status, outcome: (r.outcomes[0] || {}).status };
  let caseOk = true;
  for (const lvl of ['event', 'market', 'outcome']) {
    if (cse.expect[lvl] !== undefined) {
      total++;
      if (actual[lvl] === cse.expect[lvl]) correct++; else caseOk = false;
      // FALSO POSITIVO material: el sistema dice 'matched' en un nivel donde el golden espera NO-matched
      if (cse.expect[lvl] !== 'matched' && actual[lvl] === 'matched') { falsePositives++; console.log(`    ⚠️ FALSO POSITIVO: ${cse.id} ${lvl} matched (esperado ${cse.expect[lvl]})`); }
    }
  }
  // precision/recall de la equivalencia final (outcome para campeón; market para partidos sin outcome)
  if (cse.category === 'matched') {
    goldenMatched++;
    const finalMatched = actual.outcome === 'matched' || (cse.expect.outcome === undefined && actual.market === 'matched');
    if (finalMatched) tpMatched++;
    if (finalMatched) sysMatched++;
  } else if (actual.outcome === 'matched') { sysMatched++; }
  byCat[cse.category] = byCat[cse.category] || { n: 0, ok: 0 };
  byCat[cse.category].n++; if (caseOk) byCat[cse.category].ok++;
}
for (const [cat, v] of Object.entries(byCat)) console.log(`  ${cat}: ${v.ok}/${v.n} casos con estado esperado`);
const precision = sysMatched ? tpMatched / sysMatched : 1;
const recall = goldenMatched ? tpMatched / goldenMatched : 1;
console.log(`  precision auto-match: ${(precision * 100).toFixed(1)}% · recall: ${(recall * 100).toFixed(1)}% · false positives: ${falsePositives}`);

ok('CERO falsos positivos materiales (no aprueba lo que no debe)', falsePositives === 0);
ok('precisión auto-match = 100%', precision === 1);
ok('todos los casos golden con estado esperado', correct === total, `${correct}/${total}`);
ok('recall de matched razonable (≥0.8)', recall >= 0.8, `recall=${recall.toFixed(2)}`);

console.log(`\n${fail === 0 ? '✅' : '❌'} Canonical Graph: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail === 0 ? 0 : 1);
