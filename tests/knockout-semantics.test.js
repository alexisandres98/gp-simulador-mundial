// tests/knockout-semantics.test.js — Fase M.5. Semántica de eliminatoria + market_semantics_gate (PURO).
'use strict';
const path = require('path');
const ko = require(path.join(__dirname, '..', 'context-engine', 'knockout'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

(async () => {
  console.log('\n§M.5 QUALIFY');
  const reg = { home: 0.50, draw: 0.27, away: 0.23 };
  const q = ko.qualifyProbabilities(reg);
  ok('qualify suma 1 entre ambos equipos', close(q.team_a_qualifies + q.team_b_qualifies, 1));
  ok('el favorito en 90\' es más favorito a clasificar', q.team_a_qualifies > reg.home && q.team_a_qualifies > q.team_b_qualifies);
  ok('clasificar ≠ ganar en 90\' (incluye el reparto del empate)', !close(q.team_a_qualifies, reg.home));
  // empate perfecto en 90' → 50/50 a clasificar (sin ventaja de penales)
  const even = ko.qualifyProbabilities({ home: 0.30, draw: 0.40, away: 0.30 });
  ok('90\' simétrico → 50/50 a clasificar', close(even.team_a_qualifies, 0.5, 1e-6));
  // ventaja en penales mueve la clasificación
  const pen = ko.qualifyProbabilities({ home: 0.30, draw: 0.40, away: 0.30 }, { penaltyHomeEdge: 0.1 });
  ok('ventaja en penales sube la prob de clasificar del local', pen.team_a_qualifies > 0.5);
  ok('prórroga/penales modelados por separado (components)', pen.components.et_draw_prob === 0.33 && pen.components.penalty_home_edge === 0.1);

  console.log('\n§M.5 MARKET SEMANTICS GATE (bloqueante)');
  const reg1x2 = { market_code: '1X2', period_code: 'REGULATION' };
  const qualify = { market_code: 'QUALIFY', period_code: 'FULL_MATCH' };
  ok('comparar 1X2 vs 1X2 → OK', ko.marketSemanticsGate(reg1x2, reg1x2).ok === true);
  ok('comparar QUALIFY vs QUALIFY → OK', ko.marketSemanticsGate(qualify, qualify).ok === true);
  ok('comparar QUALIFY (modelo) vs 1X2 (cuota) → BLOQUEADO', ko.marketSemanticsGate(qualify, reg1x2).ok === false && ko.marketSemanticsGate(qualify, reg1x2).reason === 'MARKET_MISMATCH');
  ok('comparar 1X2 (modelo) vs QUALIFY (cuota) → BLOQUEADO', ko.marketSemanticsGate(reg1x2, qualify).ok === false);
  ok('mismo market pero distinto period → PERIOD_MISMATCH', ko.marketSemanticsGate({ market_code: '1X2', period_code: 'REGULATION' }, { market_code: '1X2', period_code: 'FULL_MATCH' }).reason === 'PERIOD_MISMATCH');
  ok('market desconocido → bloqueado', ko.marketSemanticsGate({ market_code: 'FOO' }, reg1x2).ok === false);

  console.log(`\n[knockout-semantics] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
