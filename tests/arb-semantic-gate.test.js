// tests/arb-semantic-gate.test.js — Fase R.1 §27 (Semantics). El gate debe BLOQUEAR cualquier combinación que
// no demuestre cobertura exhaustiva + reglas de settlement idénticas/no-ambiguas. Un falso arbitraje = fallo
// crítico (§2). Tests PUROS (sin DB).
'use strict';
const path = require('path');
const G = require(path.join(__dirname, '..', 'arb-engine', 'semanticGate'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// helper: identidad neutral de una leg con defaults "limpios" (1X2 regulation, reglas explícitas).
function leg(over = {}) {
  return Object.assign({
    canonical_event_id: 'ev1', market_family: 'MATCH_RESULT', period: 'REGULATION', line: null,
    outcome_code: 'HOME', proposition_id: null, side: 'HOME',
    includes_extra_time: false, includes_penalties: false, draw_possible: true,
    void_policy: 'void_if_void', postponement_policy: 'remains_open',
    settlement_source: 'fifa_official', currency: 'USD',
  }, over);
}
const sub = (r) => r.blockers.map(b => b.code);
const isBlocked = (r, code) => !r.ok && r.reason === 'BLOCKED_SEMANTIC_MISMATCH' && sub(r).includes(code);

console.log('\n== §27.1 1X2 regulation exacto → OK ==');
let r = G.checkSemantics([leg({ outcome_code: 'HOME', side: 'HOME' }), leg({ outcome_code: 'DRAW', side: 'DRAW' }), leg({ outcome_code: 'AWAY', side: 'AWAY' })]);
ok('1X2 HOME/DRAW/AWAY completo y consistente → ok', r.ok, JSON.stringify(sub(r)));

console.log('\n== §27.2 qualify separado ==');
let q = G.checkSemantics([
  leg({ market_family: 'QUALIFY', period: 'INCLUDING_ET_PENALTIES', outcome_code: 'TEAM_A', side: 'TEAM_A', proposition_id: 'tie1', includes_extra_time: true, includes_penalties: true, draw_possible: false }),
  leg({ market_family: 'QUALIFY', period: 'INCLUDING_ET_PENALTIES', outcome_code: 'TEAM_B', side: 'TEAM_B', proposition_id: 'tie1', includes_extra_time: true, includes_penalties: true, draw_possible: false }),
]);
ok('qualify 2-way con ET/penales consistente → ok', q.ok, JSON.stringify(sub(q)));
// nunca mezclar qualify con 1X2 regulation
let qm = G.checkSemantics([
  leg({ market_family: 'QUALIFY', period: 'INCLUDING_ET_PENALTIES', outcome_code: 'TEAM_A', side: 'TEAM_A' }),
  leg({ market_family: 'MATCH_RESULT', period: 'REGULATION', outcome_code: 'HOME', side: 'HOME' }),
]);
ok('qualify(ET) vs 1X2(regulation) → BLOCKED (family+period mismatch)', isBlocked(qm, 'FAMILY_MISMATCH') && sub(qm).includes('PERIOD_MISMATCH'), JSON.stringify(sub(qm)));

console.log('\n== §27.3 extra time mismatch bloqueado ==');
let et = G.checkSemantics([
  leg({ outcome_code: 'HOME', side: 'HOME', includes_extra_time: false }),
  leg({ outcome_code: 'DRAW', side: 'DRAW', includes_extra_time: true }),  // ¡difiere!
  leg({ outcome_code: 'AWAY', side: 'AWAY', includes_extra_time: false }),
]);
ok('includes_extra_time difiere → BLOCKED_SEMANTIC_MISMATCH (SETTLEMENT_RULES_MISMATCH)', isBlocked(et, 'SETTLEMENT_RULES_MISMATCH'), JSON.stringify(sub(et)));

console.log('\n== §27.4 draw/no-draw mismatch bloqueado ==');
let dr = G.checkSemantics([
  leg({ outcome_code: 'HOME', side: 'HOME', draw_possible: true }),
  leg({ outcome_code: 'AWAY', side: 'AWAY', draw_possible: false }),  // draw distinto + falta DRAW
]);
ok('draw_possible difiere → BLOCKED (SETTLEMENT_RULES_MISMATCH)', isBlocked(dr, 'SETTLEMENT_RULES_MISMATCH'), JSON.stringify(sub(dr)));

console.log('\n== §27.5 total 2.5 vs 2.25 bloqueado ==');
let tl = G.checkSemantics([
  leg({ market_family: 'TOTAL_GOALS', outcome_code: 'OVER', side: 'OVER', line: 2.5, draw_possible: false }),
  leg({ market_family: 'TOTAL_GOALS', outcome_code: 'UNDER', side: 'UNDER', line: 2.25, draw_possible: false }),  // ¡línea distinta!
]);
ok('total 2.5 vs 2.25 → BLOCKED (LINE_MISMATCH)', isBlocked(tl, 'LINE_MISMATCH'), JSON.stringify(sub(tl)));
// misma línea → ok
let tok = G.checkSemantics([
  leg({ market_family: 'TOTAL_GOALS', outcome_code: 'OVER', side: 'OVER', line: 2.5, draw_possible: false }),
  leg({ market_family: 'TOTAL_GOALS', outcome_code: 'UNDER', side: 'UNDER', line: 2.5, draw_possible: false }),
]);
ok('total 2.5 over/under misma línea → ok', tok.ok, JSON.stringify(sub(tok)));

console.log('\n== §27.6 void policy mismatch ==');
let vp = G.checkSemantics([
  leg({ outcome_code: 'HOME', side: 'HOME', void_policy: 'void_if_postponed' }),
  leg({ outcome_code: 'DRAW', side: 'DRAW', void_policy: 'remains_open' }),
  leg({ outcome_code: 'AWAY', side: 'AWAY', void_policy: 'remains_open' }),
]);
ok('void_policy difiere → BLOCKED (VOID_POLICY_MISMATCH)', isBlocked(vp, 'VOID_POLICY_MISMATCH'), JSON.stringify(sub(vp)));

console.log('\n== §27.7 postponement mismatch ==');
let pp = G.checkSemantics([
  leg({ outcome_code: 'HOME', side: 'HOME', postponement_policy: 'void_if_postponed' }),
  leg({ outcome_code: 'DRAW', side: 'DRAW', postponement_policy: 'remains_open' }),
  leg({ outcome_code: 'AWAY', side: 'AWAY', postponement_policy: 'remains_open' }),
]);
ok('postponement_policy difiere → BLOCKED (POSTPONEMENT_MISMATCH)', isBlocked(pp, 'POSTPONEMENT_MISMATCH'), JSON.stringify(sub(pp)));

console.log('\n== §27.8 non-exhaustive outcomes bloqueados ==');
let ne = G.checkSemantics([
  leg({ outcome_code: 'HOME', side: 'HOME' }),
  leg({ outcome_code: 'DRAW', side: 'DRAW' }),
]); // falta AWAY
ok('1X2 sin AWAY → BLOCKED (NON_EXHAUSTIVE_OUTCOMES)', isBlocked(ne, 'NON_EXHAUSTIVE_OUTCOMES'), JSON.stringify(sub(ne)));
let ov = G.checkSemantics([
  leg({ outcome_code: 'HOME', side: 'HOME' }),
  leg({ outcome_code: 'HOME', side: 'HOME' }),
  leg({ outcome_code: 'AWAY', side: 'AWAY' }),
]); // HOME repetido
ok('outcomes solapados (HOME×2) → BLOCKED (OVERLAPPING_OUTCOMES)', isBlocked(ov, 'OVERLAPPING_OUTCOMES'), JSON.stringify(sub(ov)));

console.log('\n== Extra: ambigüedad / fuente / moneda / proposición / umbral ==');
// reglas ambiguas (caso mercados champion: includes_et null) → BLOQUEA (default seguro §2)
let amb = G.checkSemantics([
  leg({ market_family: 'BINARY', outcome_code: 'YES', side: 'YES', proposition_id: 'T', includes_extra_time: null, draw_possible: false }),
  leg({ market_family: 'BINARY', outcome_code: 'NO', side: 'NO', proposition_id: 'T', includes_extra_time: null, draw_possible: false }),
]);
ok('reglas ambiguas (null) → BLOCKED (AMBIGUOUS_RULES)', isBlocked(amb, 'AMBIGUOUS_RULES'), JSON.stringify(sub(amb)));
// settlement_source distinto → bloquea
let ss = G.checkSemantics([leg({ outcome_code: 'HOME', side: 'HOME', settlement_source: 'fifa_official' }), leg({ outcome_code: 'DRAW', side: 'DRAW', settlement_source: 'espn' }), leg({ outcome_code: 'AWAY', side: 'AWAY', settlement_source: 'fifa_official' })]);
ok('settlement_source distinto → BLOCKED (SETTLEMENT_SOURCE_INCOMPATIBLE)', isBlocked(ss, 'SETTLEMENT_SOURCE_INCOMPATIBLE'), JSON.stringify(sub(ss)));
// moneda distinta → bloquea
let cu = G.checkSemantics([leg({ outcome_code: 'HOME', side: 'HOME', currency: 'USD' }), leg({ outcome_code: 'DRAW', side: 'DRAW', currency: 'EUR' }), leg({ outcome_code: 'AWAY', side: 'AWAY', currency: 'USD' })]);
ok('moneda distinta → BLOCKED (CURRENCY_MISMATCH)', isBlocked(cu, 'CURRENCY_MISMATCH'), JSON.stringify(sub(cu)));
// binario con proposiciones (sujetos) distintos → no es partición
let pm = G.checkSemantics([
  leg({ market_family: 'BINARY', outcome_code: 'YES', side: 'YES', proposition_id: 'T1', includes_extra_time: false, draw_possible: false }),
  leg({ market_family: 'BINARY', outcome_code: 'NO', side: 'NO', proposition_id: 'T2', includes_extra_time: false, draw_possible: false }),  // ¡otro sujeto!
]);
ok('binario YES@T1 + NO@T2 (sujetos distintos) → BLOCKED (PROPOSITION_MISMATCH)', isBlocked(pm, 'PROPOSITION_MISMATCH'), JSON.stringify(sub(pm)));
// binario YES/NO mismo sujeto y reglas → ok
let bok = G.checkSemantics([
  leg({ market_family: 'BINARY', outcome_code: 'YES', side: 'YES', proposition_id: 'T', includes_extra_time: false, includes_penalties: false, draw_possible: false }),
  leg({ market_family: 'BINARY', outcome_code: 'NO', side: 'NO', proposition_id: 'T', includes_extra_time: false, includes_penalties: false, draw_possible: false }),
]);
ok('binario YES/NO mismo sujeto, reglas explícitas → ok', bok.ok, JSON.stringify(sub(bok)));
// 1 leg → insuficiente
ok('1 leg → BLOCKED (INSUFFICIENT_LEGS)', !G.checkSemantics([leg()]).ok, '');
// umbral único: toda falla reporta reason=BLOCKED_SEMANTIC_MISMATCH
ok('toda falla → reason BLOCKED_SEMANTIC_MISMATCH', [et, dr, tl, vp, pp, ne, amb].every(x => x.reason === 'BLOCKED_SEMANTIC_MISMATCH'), '');

console.log('\n== legIdentity adapter ==');
const idn = G.legIdentity({ side: 'yes', rulesFingerprint: 'rule-fp-2:sha256:abc', currency: 'USD', canonical_outcome_id: 'T', rules: { marketPeriod: 'REGULATION', includesExtraTime: false, includesPenalties: false, drawPossible: false, resolutionSource: 'fifa_official' } }, { market_family: 'BINARY', canonical_event_id: 'ev9' });
ok('legIdentity mapea side→outcome_code MAYÚSCULA', idn.outcome_code === 'YES' && idn.side === 'YES');
ok('legIdentity extrae reglas del bloque rules', idn.includes_extra_time === false && idn.settlement_source === 'fifa_official' && idn.period === 'REGULATION');
ok('legIdentity hereda canonical_event_id/family del marketMeta', idn.canonical_event_id === 'ev9' && idn.market_family === 'BINARY');
ok('legIdentity proposition_id desde canonical_outcome_id', idn.proposition_id === 'T');

console.log(`\n${fail === 0 ? '✅' : '❌'} arb-semantic-gate: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
